#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// flow-runner.mjs — Grava o FLUXO COMPLETO de uma função da plataforma Lovarch
// (multi-tela: dropdowns → prompt → loading real → resultado) como screencast MP4.
//
// Diferente do render-motion.mjs (anima 1 tela via preset HTML determinístico),
// este NAVEGA o app REAL e captura "o que acontece quando clica em cada coisa".
// Generaliza o grava-corso.mjs do curso para qualquer função, config-driven.
//
// LOGIN: pergunta com qual PrimeVoice gravar (seletor interativo) e obtém a sessão
// pela Edge Function `primevoices-session` (Lovarch) — NINGUÉM precisa de token do
// Supabase nem de senha; só do shared secret do gateway (motion-engine/config/gateway.json).
//
// USO:
//   cd /Users/pablo/PrimeTeam
//   node motion-engine/scripts/flow-runner.mjs <flow.json>
//   node motion-engine/scripts/flow-runner.mjs flows/video-generation.json --account olimpia
//
// flow.json (DSL):
//   {
//     "name": "video-generation",
//     "account": "olimpia",                 // opcional: pula o seletor
//     "viewport": {"width":1600,"height":900},
//     "out": "flow-video-generation.mp4",
//     "steps": [
//       {"action":"goto","module":"video"},
//       {"action":"wait","ms":2500},
//       {"action":"pickMode","mode":"Crea"},
//       {"action":"pickChip","from":["Nano Banana 2","FLUX 2 Pro"],"to":"FLUX 2 Pro"},
//       {"action":"type","text":"Soggiorno minimale, luce calda"},
//       {"action":"upload","asset":"/path/base.png"},
//       {"action":"clickText","text":"Video"},
//       {"action":"generate","label":"img","timeout":120000},
//       {"action":"generateVideo","timeout":300000},
//       {"action":"click","x":800,"y":140}
//     ]
//   }
// ─────────────────────────────────────────────────────────────────────────────
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(__dirname, '..');
const OUT = path.join(ENGINE, 'out');
const BASE = process.env.LOVARCH_URL || 'https://app.lovarch.com';
const GATEWAY = path.join(ENGINE, 'config', 'gateway.json');

const ACCOUNTS = ['marco', 'caterina', 'tommaso', 'vittoria', 'lorenzo', 'olimpia', 'salvo'];
const rnd = () => 0.5; // determinístico-ish; jitter visual não precisa de RNG real
const sleep = (p, ms) => p.waitForTimeout(ms);

// Cursor sintético (mesmo do grava-corso comprovado)
const CURSOR = `(()=>{let lx=innerWidth/2,ly=innerHeight/2;const mk=()=>{try{if(!document.body||document.getElementById('__cur'))return;const c=document.createElement('div');c.id='__cur';c.style.cssText='position:fixed;z-index:2147483647;left:0;top:0;pointer-events:none;will-change:transform';c.innerHTML='<svg width=28 height=28 viewBox="0 0 24 24"><path d="M3 1 L3 19 L8 14.5 L11.5 22 L14.5 20.7 L11 13.3 L18 13.3 Z" fill=#fff stroke="rgba(0,0,0,.6)" stroke-width=1.3/></svg>';const r=document.createElement('div');r.id='__ring';r.style.cssText='position:fixed;z-index:2147483646;width:40px;height:40px;border-radius:50%;left:0;top:0;pointer-events:none;background:rgba(201,153,92,.5);transform:translate(-50%,-50%) scale(0);transition:transform .25s ease';document.body.appendChild(c);document.body.appendChild(r);c.style.transform='translate('+lx+'px,'+ly+'px)';r.style.left=lx+'px';r.style.top=ly+'px';}catch(e){}};addEventListener('mousemove',e=>{lx=e.clientX;ly=e.clientY;const c=document.getElementById('__cur'),r=document.getElementById('__ring');if(c)c.style.transform='translate('+lx+'px,'+ly+'px)';if(r){r.style.left=lx+'px';r.style.top=ly+'px';}},true);addEventListener('mousedown',()=>{const r=document.getElementById('__ring');if(r){r.style.transition='transform .12s ease';r.style.transform='translate(-50%,-50%) scale(1)';}},true);addEventListener('mouseup',()=>{const r=document.getElementById('__ring');if(r){r.style.transition='transform .3s ease';r.style.transform='translate(-50%,-50%) scale(0)';}},true);if(document.readyState!=='loading')mk();document.addEventListener('DOMContentLoaded',mk);setInterval(mk,500);})();`;

// ─── helpers de interação (portados do grava-corso validado) ───
async function moveTo(p, b) { await p.mouse.move(b.x + b.w / 2, b.y + b.h / 2, { steps: 26 }); await sleep(p, 320); }
async function clickBox(p, b) { await moveTo(p, b); await p.mouse.down(); await sleep(p, 70); await p.mouse.up(); await sleep(p, 430); }
async function findBtn(p, label, { bottomOnly = false, last = false } = {}) {
  return await p.evaluate(({ label, bottomOnly, last }) => {
    let c = [...document.querySelectorAll('button')].filter(b => { const t = (b.innerText || '').trim(); if (!(t === label || t.startsWith(label))) return false; if (bottomOnly) { const r = b.getBoundingClientRect(); return r.bottom > innerHeight - 230 && r.width > 0; } return b.getBoundingClientRect().width > 0; });
    if (!c.length) return null; const b = last ? c[c.length - 1] : c[0]; const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, { label, bottomOnly, last });
}
async function findAny(p, label) {
  // busca AMPLA (toggles/tabs que não são <button>): button, role, a, div/span clicáveis
  return await p.evaluate((label) => {
    const sel = 'button,[role=button],[role=tab],[role=switch],[role=radio],a,label,div,span';
    const els = [...document.querySelectorAll(sel)].filter(e => {
      const txt = (e.innerText || e.textContent || '').trim();
      const title = (e.getAttribute('title') || '').trim();
      const aria = (e.getAttribute('aria-label') || '').trim();
      const hit = [txt, title, aria].some(v => v === label || (v && v.startsWith(label)));
      if (!hit) return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.width < 400 && r.height < 120; // evita containers grandes
    });
    if (!els.length) return null;
    // pega o mais "específico" (menor área) que contém o texto
    els.sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return (ra.width * ra.height) - (rb.width * rb.height); });
    const r = els[0].getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, label);
}
async function clickLabel(p, label, { required = true } = {}) { let b = await findBtn(p, label); if (!b) b = await findAny(p, label); if (!b) { if (required) throw new Error('botão não achado: ' + label); console.log('  (aviso) não achei, pulando:', label); return; } await clickBox(p, b); }
// clica ESPECIFICAMENTE por title/aria-label (toggles de ícone: Immagine/Video etc.)
async function findByTitle(p, title) {
  return await p.evaluate((title) => {
    const els = [...document.querySelectorAll('button,[role=button],[role=switch],[role=tab],a')].filter(e => {
      const t = (e.getAttribute('title') || '').trim(), a = (e.getAttribute('aria-label') || '').trim();
      return t === title || a === title;
    });
    if (!els.length) return null;
    els.sort((x, y) => { const rx = x.getBoundingClientRect(), ry = y.getBoundingClientRect(); return (rx.width * rx.height) - (ry.width * ry.height); });
    const r = els[0].getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, title);
}
async function clickTitle(p, title, { required = true } = {}) { const b = await findByTitle(p, title); if (!b) { if (required) throw new Error('toggle (title) não achado: ' + title); console.log('  (aviso) title não achado, pulando:', title); return; } await clickBox(p, b); }
async function findGenerate(p) { return await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /bg-accent/.test(x.className) && /rounded-xl/.test(x.className) && /text-white/.test(x.className) && x.getBoundingClientRect().bottom > innerHeight - 230); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }); }
async function typeInto(p, text) { const loc = p.locator('textarea[data-prompt-bar="true"], textarea').first(); await loc.waitFor({ state: 'attached', timeout: 15000 }); const box = await loc.boundingBox().catch(() => null); if (box) await moveTo(p, { x: box.x, y: box.y, w: box.width, h: box.height }); await loc.click({ force: true }).catch(() => { }); await sleep(p, 250); await loc.fill('', { force: true }).catch(() => { }); try { for (const ch of text) { await p.keyboard.type(ch); await sleep(p, 10); } } catch (e) { await loc.fill(text, { force: true }).catch(() => { }); } await sleep(p, 500); }
async function mainImgSrc(p) { return await p.evaluate(() => { let best = null, area = 0; for (const im of document.querySelectorAll('img')) { const r = im.getBoundingClientRect(); const a = r.width * r.height; if (r.width > 520 && a > area) { area = a; best = im.currentSrc || im.src; } } return best; }); }
async function generateAndWait(p, label, timeoutMs = 120000) { const sb = await mainImgSrc(p); const g = await findGenerate(p); if (!g) throw new Error('gerar não achado'); await clickBox(p, g); console.log('  gerando (' + label + ')...'); try { await p.waitForFunction(() => [...document.querySelectorAll('*')].some(e => /Generando|Convertendo|Applicando/i.test(e.textContent || '') && e.getBoundingClientRect().width > 0), null, { timeout: 9000 }); } catch (e) { } try { await p.waitForFunction((s) => { const gen = [...document.querySelectorAll('*')].some(e => /Generando|Convertendo|Applicando/i.test(e.textContent || '') && e.getBoundingClientRect().width > 0); if (gen) return false; let best = null, area = 0; for (const im of document.querySelectorAll('img')) { const r = im.getBoundingClientRect(); const a = r.width * r.height; if (r.width > 520 && a > area) { area = a; best = im.currentSrc || im.src; } } return best && best !== s; }, sb, { timeout: timeoutMs }); } catch (e) { console.log('  (aviso) espera:', e.message); } await sleep(p, 3000); console.log('  pronto (' + label + ')'); }
async function waitVideo(p, timeoutMs = 300000) { try { await p.waitForFunction(() => [...document.querySelectorAll('*')].some(e => /Generando|Elaborando|Creando|Processing|Rendering/i.test(e.textContent || '') && e.getBoundingClientRect().width > 0), null, { timeout: 15000 }); } catch (e) { } try { await p.waitForFunction(() => { const gen = [...document.querySelectorAll('*')].some(e => /Generando|Elaborando|Creando|Processing|Rendering/i.test(e.textContent || '') && e.getBoundingClientRect().width > 0); if (gen) return false; return [...document.querySelectorAll('video')].some(v => v.getBoundingClientRect().width > 300); }, null, { timeout: timeoutMs }); } catch (e) { console.log('  (aviso) espera vídeo:', e.message); } }
async function pickMode(p, target) { const MODES = ['Arredo', 'Pianta', 'Crea', 'Stili', 'Modifica']; let chip = null; for (const m of MODES) { chip = await findBtn(p, m, { bottomOnly: true }); if (chip) break; } if (!chip) throw new Error('chip de modo não achado'); await clickBox(p, chip); await sleep(p, 700); const b = await findBtn(p, target, { last: true }); if (b) { await clickBox(p, b); await sleep(p, 900); return; } await clickBox(p, chip); throw new Error('item de modo não achado: ' + target); }
async function pickChip(p, from, to) { let chip = null; for (const c of from) { chip = await findBtn(p, c, { bottomOnly: true }); if (chip) break; } if (!chip) { console.log('  (aviso) chip não achado p/', to); return; } await clickBox(p, chip); await sleep(p, 700); const b = await findBtn(p, to, { last: true }); if (b) { await clickBox(p, b); await sleep(p, 800); console.log('  set:', to); } else { console.log('  (aviso) opção não achada:', to); await clickBox(p, chip); } await p.mouse.click(800, 140).catch(() => { }); await sleep(p, 500); }
async function uploadAsset(p, asset) { const fi = p.locator('input[type=file]').first(); await fi.setInputFiles(asset).catch(e => console.error('  upload falhou:', e.message)); await sleep(p, 2800); }

// ─── login via Edge Function primevoices-session ───
function loadGateway() {
  let url, secret;
  if (fs.existsSync(GATEWAY)) { const g = JSON.parse(fs.readFileSync(GATEWAY, 'utf8')); url = g.url; secret = g.secret; }
  url = process.env.PRIMEVOICES_GATEWAY_URL || url || `${BASE.replace('app.', '').replace('https://', 'https://cuxbydmyahjaplzkthkr.supabase.co')}`;
  secret = process.env.PRIMEVOICES_GATEWAY_SECRET || secret;
  if (!secret) throw new Error('Falta o gateway secret (motion-engine/config/gateway.json ou env PRIMEVOICES_GATEWAY_SECRET).');
  let anon;
  if (fs.existsSync(GATEWAY)) { anon = JSON.parse(fs.readFileSync(GATEWAY, 'utf8')).anon; }
  anon = process.env.LOVARCH_ANON_KEY || anon;
  return { url, secret, anon };
}
async function getSession(alias) {
  const { url, secret } = loadGateway();
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret }, body: JSON.stringify({ alias }) });
  const j = await r.json();
  if (!j.ok) throw new Error('primevoices-session: ' + (j.error || r.status));
  return j;
}
const REST = 'https://cuxbydmyahjaplzkthkr.supabase.co/rest/v1';
// REGRA (Pablo): toda geração FICA salva na galeria do PrimeVoice. Vídeo persiste
// sozinho; imagem (Crea) só ao "Salva" → aqui garantimos via REST. Assim, se a
// captura falhar, recuperamos o asset da galeria em vez de re-gerar (custa créditos).
async function biggestMedia(p) {
  return await p.evaluate(() => {
    let best = null, area = 0, type = 'image';
    for (const v of document.querySelectorAll('video')) { const r = v.getBoundingClientRect(); const a = r.width * r.height; if (r.width > 300 && a > area) { area = a; best = v.currentSrc || v.src; type = 'video'; } }
    if (!best) for (const im of document.querySelectorAll('img')) { const r = im.getBoundingClientRect(); const a = r.width * r.height; if (r.width > 480 && a > area) { area = a; best = im.currentSrc || im.src; type = 'image'; } }
    return best ? { url: best, type } : null;
  });
}
async function downloadTo(url, dest) { const r = await fetch(url); if (!r.ok) return false; fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer())); return true; }
async function persistGallery(ctx, media, renderMode) {
  // só insere imagem (vídeo a plataforma já insere sozinha); evita não-http
  if (!media || media.type !== 'image' || !/^https?:/.test(media.url)) return null;
  const body = [{ user_id: ctx.uid, asset_type: 'image', asset_url: media.url, render_mode: renderMode || 'crea', metadata: { source: 'flow-runner' } }];
  const r = await fetch(`${REST}/render_assets`, { method: 'POST', headers: { apikey: ctx.anon, Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(body) });
  if (!r.ok) { console.log('  (aviso) persist galeria falhou:', r.status); return null; }
  const j = await r.json(); return j[0]?.id || null;
}
async function grabResult(p, ctx, label, renderMode) {
  const media = await biggestMedia(p);
  if (!media) { console.log('  (aviso) nenhum resultado detectado p/ salvar'); return; }
  const ext = media.type === 'video' ? 'mp4' : (media.url.split('.').pop().split('?')[0].slice(0, 4) || 'png');
  const dest = path.join(OUT, `asset-${label}.${ext}`);
  const ok = await downloadTo(media.url, dest).catch(() => false);
  console.log(`  💾 resultado ${media.type}${ok ? ' baixado→' + path.basename(dest) : ''}`);
  if (media.type === 'image') { const id = await persistGallery(ctx, media, renderMode).catch(() => null); if (id) console.log('  💾 salvo na galeria do PrimeVoice (render_assets id=' + id + ')'); }
}

function askAccount() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('\nCom qual PrimeVoice gravar?');
    ACCOUNTS.forEach((a, i) => console.log(`  ${i + 1}) ${a}`));
    rl.question('Número (1-7): ', (ans) => { rl.close(); const i = parseInt(ans, 10) - 1; resolve(ACCOUNTS[i] || ACCOUNTS[0]); });
  });
}

// ─── executor de um passo ───
async function runStep(p, s, ctx) {
  switch (s.action) {
    case 'goto': await p.goto(`${BASE}/new-home?m=${s.module}`, { waitUntil: 'domcontentloaded' }); await sleep(p, s.ms || 3000); break;
    case 'wait': await sleep(p, s.ms || 1000); break;
    case 'clickText': await clickLabel(p, s.text, { required: s.required !== false }); break;
    case 'clickTitle': await clickTitle(p, s.title, { required: s.required !== false }); break;
    case 'screenshot': { fs.mkdirSync(OUT, { recursive: true }); await p.screenshot({ path: path.join(OUT, s.name || 'step.png') }); console.log('  📸', s.name); break; }
    case 'pickMode': await pickMode(p, s.mode); ctx.renderMode = (s.mode || '').toLowerCase(); break;
    case 'pickChip': await pickChip(p, s.from, s.to); break;
    case 'type': await typeInto(p, s.text); break;
    case 'upload': await uploadAsset(p, s.asset); break;
    case 'generate': await generateAndWait(p, s.label || 'gen', s.timeout || 120000); await grabResult(p, ctx, s.label || 'gen', ctx.renderMode); break;
    case 'generateVideo': { const g = await findGenerate(p); if (!g) throw new Error('Genera vídeo não achado'); await clickBox(p, g); console.log('  gerando VÍDEO (pode levar minutos)...'); await waitVideo(p, s.timeout || 300000); await sleep(p, 6000); await grabResult(p, ctx, s.label || 'video', 'video'); break; }
    case 'click': await p.mouse.click(s.x, s.y).catch(() => { }); await sleep(p, s.ms || 500); break;
    default: console.log('  (aviso) ação desconhecida:', s.action);
  }
}

async function main() {
  const a = process.argv.slice(2);
  const flowArg = a.find(x => !x.startsWith('--'));
  if (!flowArg) { console.error('USO: flow-runner.mjs <flow.json> [--account <alias>]'); process.exit(1); }
  const flowPath = path.isAbsolute(flowArg) ? flowArg : (fs.existsSync(path.join(ENGINE, flowArg)) ? path.join(ENGINE, flowArg) : path.resolve(process.cwd(), flowArg));
  const flow = JSON.parse(fs.readFileSync(flowPath, 'utf8'));
  const accFlag = a.includes('--account') ? a[a.indexOf('--account') + 1] : null;
  const account = accFlag || flow.account || await askAccount();

  console.log(`\n▶ Flow "${flow.name}" — conta: ${account}`);
  const view = flow.viewport || { width: 1600, height: 900 };
  const session = await getSession(account);
  console.log(`  ✓ sessão de ${session.session.user?.email} via EF`);
  const { anon } = loadGateway();
  const gctx = { uid: session.session.user?.id, token: session.session.access_token, anon: anon || session.session.access_token, renderMode: null };

  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: view, deviceScaleFactor: 1, recordVideo: { dir: OUT, size: view } });
  await ctx.addInitScript(({ key, sess, uid }) => {
    localStorage.setItem(key, JSON.stringify(sess));
    localStorage.setItem('lovarch_onboarding_wizard_completed', 'true');
    if (uid) { localStorage.setItem(`setup_completed_${uid}`, 'true'); localStorage.setItem(`academy_wizard_completed_${uid}`, 'true'); }
  }, { key: session.storageKey, sess: session.session, uid: session.session.user?.id });
  await ctx.addInitScript(CURSOR);

  const page = await ctx.newPage();
  let err;
  try { for (const s of flow.steps) { console.log(`  · ${s.action}${s.module || s.mode || s.to || s.text ? ' ' + (s.module || s.mode || s.to || s.text) : ''}`); await runStep(page, s, gctx); } }
  catch (e) {
    err = e; console.error('  ERRO:', e.message);
    // REGRA: em erro, NÃO re-gerar — tentar recuperar o último asset da galeria do PrimeVoice
    try {
      const r = await fetch(`${REST}/render_assets?user_id=eq.${gctx.uid}&order=created_at.desc&limit=1&select=asset_type,asset_url,created_at`, { headers: { apikey: gctx.anon, Authorization: `Bearer ${gctx.token}` } });
      const a = (await r.json())[0];
      if (a) console.log(`  ♻ recuperável da galeria (sem re-gerar): ${a.asset_type} ${a.created_at}\n     ${a.asset_url}`);
    } catch (e2) { /* noop */ }
  }
  await sleep(page, 1200);
  const vid = page.video();
  await ctx.close();
  await browser.close();

  const webm = vid ? await vid.path() : null;
  if (!webm) { console.error('✗ sem vídeo'); process.exit(2); }
  const outName = flow.out || `flow-${flow.name}.mp4`;
  const outPath = path.isAbsolute(outName) ? outName : path.join(OUT, outName);
  console.log('  ffmpeg webm→mp4...');
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', outPath], { stdio: 'inherit' });
  fs.rmSync(webm, { force: true });
  if (ff.status !== 0) { console.error('✗ ffmpeg falhou'); process.exit(1); }
  const kb = Math.round(fs.statSync(outPath).size / 1024);
  console.log(`${err ? '⚠ com erro nos passos, mas' : '✓'} vídeo: ${outPath} (${kb} KB)`);
  process.exit(err ? 2 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
