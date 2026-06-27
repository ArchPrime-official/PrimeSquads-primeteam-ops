#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// explore-ui.mjs — Auto-mapeia os controles reais de um módulo Lovarch para ajudar
// a montar o flow.json (flow-registry). Loga via EF primevoices-session e lista
// os botões/dropdowns/placeholder da barra inferior + chips de modo.
//
// USO:
//   cd /Users/pablo/PrimeTeam
//   node motion-engine/scripts/explore-ui.mjs render olimpia
//   node motion-engine/scripts/explore-ui.mjs video olimpia --open-dropdown
// ─────────────────────────────────────────────────────────────────────────────
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(__dirname, '..');
const BASE = process.env.LOVARCH_URL || 'https://app.lovarch.com';
const G = JSON.parse(fs.readFileSync(path.join(ENGINE, 'config', 'gateway.json'), 'utf8'));

const moduleKey = process.argv[2] || 'render';
const alias = process.argv[3] || 'olimpia';
const openDropdown = process.argv.includes('--open-dropdown');

async function getSession(a) {
  const r = await fetch(G.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': G.secret }, body: JSON.stringify({ alias: a }) });
  const j = await r.json(); if (!j.ok) throw new Error('login: ' + j.error); return j;
}
const dumpBottom = () => {
  const out = [];
  for (const el of document.querySelectorAll('button,[role=button],[role=combobox]')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.bottom > innerHeight - 280) {
      const t = ((el.innerText || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')).trim().replace(/\s+/g, ' ').slice(0, 40);
      if (t) out.push(t);
    }
  }
  const ta = document.querySelector('textarea');
  return { controls: [...new Set(out)], placeholder: ta ? ta.getAttribute('placeholder') : null };
};

const j = await getSession(alias);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.addInitScript(({ k, s, u }) => { localStorage.setItem(k, JSON.stringify(s)); localStorage.setItem('lovarch_onboarding_wizard_completed', 'true'); if (u) localStorage.setItem('setup_completed_' + u, 'true'); }, { k: j.storageKey, s: j.session, u: j.session.user?.id });
const p = await ctx.newPage();
await p.goto(`${BASE}/new-home?m=${moduleKey}`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4500);
const base = await p.evaluate(dumpBottom);
console.log(`\n=== m=${moduleKey} (conta ${alias}) ===`);
console.log('placeholder:', base.placeholder);
console.log('controles barra inferior:', JSON.stringify(base.controls, null, 0));

if (openDropdown) {
  for (const mode of ['Arredo', 'Pianta', 'Crea', 'Stili', 'Modifica']) {
    const found = await p.evaluate((m) => { const bs = [...document.querySelectorAll('button')].filter(b => (b.innerText || '').trim().startsWith(m) && b.getBoundingClientRect().bottom > innerHeight - 280 && b.getBoundingClientRect().width > 0); if (!bs.length) return false; bs[0].click(); return true; }, mode);
    if (found) { await p.waitForTimeout(900); const items = await p.evaluate(() => [...new Set([...document.querySelectorAll('[role=menuitem],[role=option],button')].map(e => (e.innerText || '').trim()).filter(t => t && t.length < 30))].slice(0, 40)); console.log(`dropdown via "${mode}" → opções:`, JSON.stringify(items)); break; }
  }
}
await b.close();
