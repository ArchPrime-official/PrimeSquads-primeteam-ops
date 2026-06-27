#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// seed-demo-data.mjs — Popula dados de DEMO realistas (italiano, arquitetura) nas
// 7 contas PrimeVoices, para os módulos que ficavam em empty-state. NÃO é legacy:
// são tabelas/painéis da new-home atual (ver data/coverage-status.md).
//
// Idempotente: só insere se a conta tem 0 registros naquela tabela (guard por count).
// Requer SUPABASE_ACCESS_TOKEN (Management API; só o admin). Rodar quando contas
// forem recriadas/resetadas.  Cobre: audiences, campaigns(+metrics→results),
// brochures, instagram_posts (social).
//
// USO:  node motion-engine/scripts/seed-demo-data.mjs
// ─────────────────────────────────────────────────────────────────────────────
const REF = 'cuxbydmyahjaplzkthkr';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error('Falta SUPABASE_ACCESS_TOKEN'); process.exit(1); }

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'supabase-cli/1.0' },
    body: JSON.stringify({ query }),
  });
  const j = await r.json();
  if (!r.ok || j.message) throw new Error('SQL: ' + (j.message || r.status) + '\n' + query.slice(0, 200));
  return j;
}
const q = s => `'${String(s).replace(/'/g, "''")}'`;

const EMAILS = ['marco','caterina','tommaso','vittoria','lorenzo','olimpia','salvo'].map(a => `${a}@archprime.io`);

// ─── templates de dados (italiano · studio di architettura) ───
const AUDIENCES = [
  ['Proprietari 35-55 · ristrutturazione', 'Famiglie benestanti che vogliono ristrutturare casa', { age: '35-55', location: 'Milano', income: 'alto' }, 45000, 'solution_aware'],
  ['Giovani coppie · prima casa', 'Coppie 28-40 al primo acquisto immobiliare', { age: '28-40', location: 'Lombardia' }, 28000, 'unaware'],
  ['Investitori immobiliari', 'Investitori in cerca di valorizzazione immobili', { age: '40-60' }, 12000, 'product_aware'],
  ['Studi partner · B2B', 'Studi di architettura per collaborazioni', { type: 'B2B' }, 5000, 'most_aware'],
];
const CAMPAIGNS = [
  ['Lancio Primavera Ristrutturazioni', 'instagram', 'awareness', 3000, 50, 'active', { impressions: 45200, clicks: 1820, spend: 1240, conversions: 38, ctr: 4.02, cpa: 32.6 }],
  ['Retargeting Preventivi', 'facebook', 'conversions', 1500, 30, 'active', { impressions: 18900, clicks: 980, spend: 720, conversions: 52, ctr: 5.18, cpa: 13.8 }],
  ['Brand Awareness Studio', 'instagram', 'reach', 2000, 40, 'paused', { impressions: 62000, clicks: 1100, spend: 900, conversions: 12, ctr: 1.77, cpa: 75 }],
];
const BROCHURES = [
  [{ title: 'Studio — Portfolio 2026', subtitle: 'Architettura & Interior Design', manifesto: 'Trasformiamo spazi in esperienze.', services: ['Ristrutturazione', 'Interior Design', 'Progettazione 3D'], contact: { email: 'info@studio.it', phone: '+39 02 1234567' } }, 'completed'],
  [{ title: 'Servizi & Listino', subtitle: 'Pacchetti di progettazione', services: ['Render fotorealistici', 'Direzione lavori', 'Consulenza'], contact: { email: 'info@studio.it' } }, 'completed'],
];
const IG_CAPTIONS = [
  ['Ristrutturazione completata a Milano ✨ #architettura #interiordesign', 1240, 48],
  ['Render vs realtà: il nostro ultimo progetto 🏛', 980, 33],
  ['Dettagli che fanno la differenza · rovere e pietra naturale', 1530, 61],
  ['Prima e dopo: soggiorno luminoso 🌅', 2110, 92],
  ['Nuovo cantiere in partenza! Seguiteci 👷', 870, 27],
];
const IG_MEDIA = 'https://cuxbydmyahjaplzkthkr.supabase.co/storage/v1/object/public/render-images/776dffbc-f128-43eb-bca5-93fb1430d80d/1781691091322.jpeg';

async function run() {
  const rows = (await sql(`select email, id from auth.users where email in (${EMAILS.map(q).join(',')})`));
  const users = Object.fromEntries(rows.map(r => [r.email, r.id]));
  let summary = [];

  for (const email of EMAILS) {
    const uid = users[email]; if (!uid) continue;
    const out = [];

    // audiences (guard)
    const aud = (await sql(`select count(*)::int n from audiences where user_id=${q(uid)}`))[0].n;
    if (aud === 0) {
      const vals = AUDIENCES.map(([n, d, dem, sz, aw]) =>
        `(${q(uid)},${q(n)},${q(d)},${q(JSON.stringify(dem))}::jsonb,${sz},ARRAY['instagram','facebook'],${q(aw)},true)`).join(',');
      await sql(`insert into audiences (user_id,name,description,demographics,size_estimate,platforms,awareness_level,is_active) values ${vals}`);
      out.push(`+${AUDIENCES.length} audiences`);
    }

    // campaigns (+metrics → alimenta results) (guard)
    const camp = (await sql(`select count(*)::int n from campaigns where user_id=${q(uid)}`))[0].n;
    if (camp === 0) {
      const vals = CAMPAIGNS.map(([n, pl, ob, bt, bd, st, m]) =>
        `(${q(uid)},${q(n)},${q(ob)},${q(pl)},${bt},${bd},${q(st)},${q(JSON.stringify(m))}::jsonb,now()-interval '20 days',now()+interval '20 days')`).join(',');
      await sql(`insert into campaigns (user_id,name,objective,platform,budget_total,budget_daily,status,metrics,start_date,end_date) values ${vals}`);
      out.push(`+${CAMPAIGNS.length} campaigns`);
    }

    // brochures (guard)
    const broc = (await sql(`select count(*)::int n from brochures where user_id=${q(uid)}`))[0].n;
    if (broc === 0) {
      const vals = BROCHURES.map(([c, st]) => `(${q(uid)},${q(JSON.stringify(c))}::jsonb,${q(st)})`).join(',');
      await sql(`insert into brochures (user_id,content,status) values ${vals}`);
      out.push(`+${BROCHURES.length} brochures`);
    }

    // instagram_posts (guard) — só se a conta tem instagram_account
    const acct = (await sql(`select id from instagram_accounts where user_id=${q(uid)} limit 1`));
    if (acct.length) {
      const accId = acct[0].id;
      const posts = (await sql(`select count(*)::int n from instagram_posts where account_id=${q(accId)}`))[0].n;
      if (posts === 0) {
        const vals = IG_CAPTIONS.map(([cap, lk, cm], i) =>
          `(${q(accId)},${q('demo_' + accId.slice(0, 8) + '_' + i)},'IMAGE',${q(IG_MEDIA)},${q('https://instagram.com/p/demo' + i)},now()-interval '${i * 3} days',${q(cap)},${lk},${cm})`).join(',');
        await sql(`insert into instagram_posts (account_id,instagram_post_id,media_type,media_url,permalink,timestamp,caption,like_count,comments_count) values ${vals}`);
        out.push(`+${IG_CAPTIONS.length} ig_posts`);
      }
    }

    summary.push(`  ${email}: ${out.length ? out.join(', ') : '(já populado, skip)'}`);
  }
  console.log('✓ seed-demo-data concluído:\n' + summary.join('\n'));
}
run().catch(e => { console.error('✗', e.message); process.exit(1); });
