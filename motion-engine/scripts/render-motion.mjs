#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// render-motion.mjs — Render determinístico frame-a-frame de um preset HTML de
// tela Lovarch para MP4. Reconstrução do pipeline que vivia em /tmp (perdido).
//
// CONTRATO DO PRESET (todos os presets em ../presets/*.html expõem):
//   window.__DURATION        → duração em ms
//   window.__CONTENT         → Object.assign({defaults}, window.__CONTENT||{})
//                              (sobrescrevível via addInitScript ANTES do load)
//   window.__render(T)        → função PURA do tempo (T em ms), pinta o frame
//   boot()                    → chama __render(0) no load (sem requestAnimationFrame)
//
// O render é externo: para cada frame f chamamos window.__render(f*1000/fps),
// tiramos screenshot frame-perfect e concatenamos com ffmpeg. 100% determinístico.
//
// USO:
//   cd /Users/pablo/PrimeTeam
//   node motion-engine/scripts/render-motion.mjs <clip.json>
//   node motion-engine/scripts/render-motion.mjs --preset scene-planning.html --out test.mp4
//
// clip.json (schema):
//   {
//     "preset": "scene-planning.html",        // relativo a motion-engine/presets/
//     "out": "21-pianificazione-MOTION.mp4",  // relativo a motion-engine/out/
//     "fps": 30,                               // default 30
//     "width": 1920, "height": 1080,           // default 1920x1080
//     "duration_ms": null,                     // null = usa window.__DURATION do preset
//     "content": { "name": "Olimpia", "avatar": "https://..." }  // overrides de __CONTENT (opcional)
//   }
// ─────────────────────────────────────────────────────────────────────────────
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(__dirname, '..');           // motion-engine/
const PRESETS = path.join(ENGINE, 'presets');
const OUT = path.join(ENGINE, 'out');

// ─── Parse argumentos: ou um clip.json, ou flags soltas ───
function parseArgs(argv) {
  const a = argv.slice(2);
  if (a[0] && !a[0].startsWith('--')) {
    const clipPath = path.isAbsolute(a[0]) ? a[0] : path.resolve(process.cwd(), a[0]);
    return JSON.parse(fs.readFileSync(clipPath, 'utf8'));
  }
  const cfg = {};
  for (let i = 0; i < a.length; i += 2) {
    const k = a[i].replace(/^--/, '');
    cfg[k] = a[i + 1];
  }
  if (cfg.fps) cfg.fps = Number(cfg.fps);
  if (cfg.width) cfg.width = Number(cfg.width);
  if (cfg.height) cfg.height = Number(cfg.height);
  if (cfg.duration_ms) cfg.duration_ms = Number(cfg.duration_ms);
  return cfg;
}

async function main() {
  const clip = parseArgs(process.argv);
  if (!clip.preset) {
    console.error('ERRO: faltou "preset". Ex: --preset scene-planning.html --out test.mp4');
    process.exit(1);
  }
  const fps = clip.fps || 30;
  const width = clip.width || 1920;
  const height = clip.height || 1080;
  const presetPath = path.join(PRESETS, clip.preset);
  if (!fs.existsSync(presetPath)) {
    console.error(`ERRO: preset não encontrado: ${presetPath}`);
    process.exit(1);
  }
  const outName = clip.out || clip.preset.replace(/\.html$/, '') + '.mp4';
  fs.mkdirSync(OUT, { recursive: true });
  const outPath = path.isAbsolute(outName) ? outName : path.join(OUT, outName);
  const framesDir = fs.mkdtempSync(path.join(OUT, '.frames-'));

  console.log(`▶ Render: ${clip.preset} → ${path.relative(ENGINE, outPath)}  (${width}×${height} @ ${fps}fps)`);

  const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--disable-lcd-text'] });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  // Injeta overrides de __CONTENT ANTES do load (Object.assign do preset os respeita)
  if (clip.content && Object.keys(clip.content).length) {
    await page.addInitScript((c) => { window.__CONTENT = c; }, clip.content);
  }

  await page.goto('file://' + presetPath, { waitUntil: 'networkidle' });

  // Garante fontes + todas as imagens carregadas (assets remotos do Supabase storage)
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const imgs = Array.from(document.images);
    await Promise.all(imgs.map(im => im.complete ? Promise.resolve()
      : new Promise(res => { im.onload = im.onerror = res; })));
    // espera vídeos embutidos carregarem (frames de vídeo real dentro da animação)
    const vids = Array.from(document.querySelectorAll('video'));
    await Promise.all(vids.map(v => v.readyState >= 2 ? Promise.resolve()
      : new Promise(res => { v.addEventListener('loadeddata', res, { once: true }); v.addEventListener('error', res, { once: true }); setTimeout(res, 6000); })));
  });
  await page.waitForTimeout(200); // settle de layout

  const duration = clip.duration_ms || await page.evaluate(() => window.__DURATION || 9000);
  const totalFrames = Math.max(1, Math.round(duration / 1000 * fps));
  console.log(`  duração ${duration}ms → ${totalFrames} frames`);

  const stage = (await page.$('.stage')) || (await page.$('body'));
  for (let f = 0; f < totalFrames; f++) {
    const t = f * 1000 / fps;
    await page.evaluate((tt) => window.__render(tt), t);
    // se a animação tem um <video data-anim> sendo seekado (frames de vídeo real), espera o seeked
    await page.evaluate(() => { const v = document.querySelector('video[data-anim]'); if (v && v.seeking) return new Promise(r => { v.addEventListener('seeked', r, { once: true }); setTimeout(r, 400); }); });
    await stage.screenshot({ path: path.join(framesDir, String(f).padStart(5, '0') + '.png') });
    if (f % 30 === 0 || f === totalFrames - 1) {
      process.stdout.write(`\r  frame ${f + 1}/${totalFrames}`);
    }
  }
  process.stdout.write('\n');
  await browser.close();

  // ─── ffmpeg: frames → MP4 (H.264, yuv420p para compat universal) ───
  console.log('  ffmpeg encode...');
  const ff = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-framerate', String(fps),
    '-i', path.join(framesDir, '%05d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18',
    '-movflags', '+faststart',
    outPath,
  ], { stdio: 'inherit' });
  fs.rmSync(framesDir, { recursive: true, force: true });
  if (ff.status !== 0) { console.error('ERRO: ffmpeg falhou'); process.exit(1); }

  const kb = Math.round(fs.statSync(outPath).size / 1024);
  console.log(`✓ OK: ${outPath} (${kb} KB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
