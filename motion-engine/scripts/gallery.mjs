#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// gallery.mjs — Lê (e baixa) a GALERIA de um PrimeVoice (tabela render_assets).
//
// REGRA (Pablo, 2026-06-27): toda geração feita pelo flow-runner é a geração REAL
// da plataforma e fica SALVA NA GALERIA do PrimeVoice usado. Portanto, em caso de
// erro/timeout na captura, NUNCA re-gerar às cegas — BUSCAR aqui o asset já gerado
// (economiza créditos e tempo).
//
// USO:
//   cd /Users/pablo/PrimeTeam
//   node motion-engine/scripts/gallery.mjs list olimpia --type image --limit 10
//   node motion-engine/scripts/gallery.mjs latest olimpia --type image --download
//
// Login via EF primevoices-session; SELECT em render_assets via REST (RLS = próprio user).
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(__dirname, '..');
const OUT = path.join(ENGINE, 'out');
const G = JSON.parse(fs.readFileSync(path.join(ENGINE, 'config', 'gateway.json'), 'utf8'));
// anon key (pública) p/ o header apikey do PostgREST
const ANON = process.env.LOVARCH_ANON_KEY || G.anon ||
  'fallback'; // se ausente, o gallery pede via env; ver nota abaixo
const REF = 'cuxbydmyahjaplzkthkr';
const REST = `https://${REF}.supabase.co/rest/v1`;

async function getSession(alias) {
  const r = await fetch(G.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': G.secret }, body: JSON.stringify({ alias }) });
  const j = await r.json(); if (!j.ok) throw new Error('login: ' + j.error); return j;
}

async function fetchAssets(alias, { type, limit = 10 } = {}) {
  const s = await getSession(alias);
  const uid = s.session.user.id;
  const token = s.session.access_token;
  const anon = ANON !== 'fallback' ? ANON : token; // PostgREST aceita o JWT como apikey também
  let url = `${REST}/render_assets?user_id=eq.${uid}&order=created_at.desc&limit=${limit}` +
    `&select=id,asset_type,asset_url,thumbnail_url,render_mode,created_at,metadata`;
  if (type) url += `&asset_type=eq.${type}`;
  const r = await fetch(url, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`render_assets ${r.status}: ${await r.text()}`);
  return { uid, email: s.session.user.email, assets: await r.json() };
}

async function download(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return dest;
}

async function main() {
  const [cmd, alias, ...rest] = process.argv.slice(2);
  const type = rest.includes('--type') ? rest[rest.indexOf('--type') + 1] : null;
  const limit = rest.includes('--limit') ? Number(rest[rest.indexOf('--limit') + 1]) : 10;
  const doDownload = rest.includes('--download');
  if (!cmd || !alias) { console.error('USO: gallery.mjs list|latest <alias> [--type image|video] [--limit N] [--download]'); process.exit(1); }

  const { email, assets } = await fetchAssets(alias, { type, limit });
  if (!assets.length) { console.log(`(galeria vazia p/ ${email}${type ? ' tipo ' + type : ''})`); return; }

  if (cmd === 'list') {
    console.log(`Galeria de ${email}${type ? ' (' + type + ')' : ''} — ${assets.length} mais recentes:`);
    for (const a of assets) console.log(`  ${a.created_at}  ${a.asset_type.padEnd(5)}  ${a.render_mode || '-'}  ${a.asset_url}`);
  } else if (cmd === 'latest') {
    const a = assets[0];
    console.log(`Último asset de ${email}: ${a.asset_type} (${a.render_mode || '-'}, ${a.created_at})`);
    console.log(a.asset_url);
    if (doDownload) {
      const ext = a.asset_type === 'video' ? 'mp4' : (a.asset_url.split('.').pop().split('?')[0] || 'png');
      const dest = path.join(OUT, `gallery-${alias}-latest.${ext}`);
      await download(a.asset_url, dest);
      console.log('✓ baixado:', dest);
    }
  } else { console.error('comando inválido:', cmd); process.exit(1); }
}
main().catch(e => { console.error(e); process.exit(1); });
