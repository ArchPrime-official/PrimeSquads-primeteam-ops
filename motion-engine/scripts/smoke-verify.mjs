#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// smoke-verify.mjs — Métrica OBJETIVA de fidelidade (SSIM via ffmpeg).
// É o "juiz" do loop de precisão: o agente re-renderiza/ajusta o preset até o
// score passar do threshold. NUNCA declarar "pronto" sem este número.
//
// DOIS MODOS:
//
// 1) RECRIAÇÃO vs SCREENSHOT REAL (o coração do modo "screenshot→recria"):
//    Renderiza UM frame do preset (no tempo t) e compara contra o ground-truth real.
//      node .../smoke-verify.mjs --preset scene-planning.html --truth ground-truth/mod-planning.png
//      node .../smoke-verify.mjs --preset render-studio-motion.html --truth gt.png --t 16000
//
// 2) VÍDEO vs VÍDEO (regressão: garantir que um re-render bate com a referência):
//      node .../smoke-verify.mjs --video out/x.mp4 --ref /path/original.mp4
//
// Saída: SSIM (0..1) + veredito PASS/FAIL contra --threshold (default 0.95).
// Exit code 0 = PASS, 1 = FAIL  (para usar em loops de shell / CI).
// ─────────────────────────────────────────────────────────────────────────────
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(__dirname, '..');
const PRESETS = path.join(ENGINE, 'presets');
const OUT = path.join(ENGINE, 'out');

function args(argv) {
  const a = argv.slice(2), o = {};
  for (let i = 0; i < a.length; i += 2) o[a[i].replace(/^--/, '')] = a[i + 1];
  return o;
}
function resolveMaybe(p) {
  if (!p) return p;
  if (path.isAbsolute(p)) return p;
  // tenta relativo ao engine, depois ao cwd
  const e = path.join(ENGINE, p);
  return fs.existsSync(e) ? e : path.resolve(process.cwd(), p);
}

// SSIM entre dois arquivos (PNG ou MP4) via ffmpeg. Retorna o "All" médio.
function ssim(aPath, bPath) {
  const r = spawnSync('ffmpeg', ['-i', aPath, '-i', bPath, '-lavfi', 'ssim', '-f', 'null', '-'],
    { encoding: 'utf8' });
  const out = (r.stderr || '') + (r.stdout || '');
  const m = out.match(/All:([0-9.]+)/);
  if (!m) { console.error('ERRO ffmpeg ssim:\n' + out.split('\n').slice(-5).join('\n')); process.exit(2); }
  return parseFloat(m[1]);
}

// Renderiza 1 frame estático do preset no tempo t → PNG
async function renderFrame(preset, t, width, height) {
  const presetPath = path.join(PRESETS, preset);
  const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--disable-lcd-text'] });
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto('file://' + presetPath, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    await Promise.all(Array.from(document.images).map(im => im.complete ? 0
      : new Promise(res => { im.onload = im.onerror = res; })));
  });
  await page.waitForTimeout(200);
  const dur = await page.evaluate(() => window.__DURATION || 0);
  const tt = (t == null) ? dur : Number(t);   // default: frame final (estado "parado")
  await page.evaluate((x) => window.__render(x), tt);
  await page.waitForTimeout(80);
  fs.mkdirSync(OUT, { recursive: true });
  const png = path.join(OUT, '.verify-frame.png');
  const stage = (await page.$('.stage')) || (await page.$('body'));
  await stage.screenshot({ path: png });
  await browser.close();
  return png;
}

async function main() {
  const o = args(process.argv);
  const threshold = o.threshold ? Number(o.threshold) : 0.95;
  let score, label;

  if (o.video && o.ref) {
    score = ssim(resolveMaybe(o.video), resolveMaybe(o.ref));
    label = `vídeo ${path.basename(o.video)} vs ref ${path.basename(o.ref)}`;
  } else if (o.preset && o.truth) {
    const width = o.width ? Number(o.width) : 1920;
    const height = o.height ? Number(o.height) : 1080;
    const frame = await renderFrame(o.preset, o.t, width, height);
    score = ssim(frame, resolveMaybe(o.truth));
    label = `recriação ${o.preset} vs real ${path.basename(o.truth)}`;
  } else {
    console.error('USO: --preset X.html --truth gt.png [--t ms]  |  --video a.mp4 --ref b.mp4  [--threshold 0.95]');
    process.exit(2);
  }

  const pass = score >= threshold;
  console.log(`SSIM ${score.toFixed(5)}  (threshold ${threshold})  →  ${pass ? '✓ PASS' : '✗ FAIL'}  [${label}]`);
  process.exit(pass ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(2); });
