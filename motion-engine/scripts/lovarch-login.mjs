#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// lovarch-login.mjs — Login autônomo (sem senha) numa das 7 contas de captura.
// Usa a Management API do Supabase (SUPABASE_ACCESS_TOKEN no env) para:
//   1. obter as api-keys (anon) do projeto Lovarch
//   2. gerar um magic-link (admin/generate_link, service-role)  → token_hash
//   3. verificar (anon)                                          → session
// Retorna o JSON de sessão pronto para injetar em localStorage.
//
// É a base do capture-ground-truth.mjs. Quem NÃO tem acesso ao repo Lovarch usa
// o modo "screenshot→recria" (não precisa disto). Isto é só para atualizar o
// ground-truth via produção (quem tem as 7 contas + SUPABASE_ACCESS_TOKEN).
//
// USO (módulo):  import { getSession } from './lovarch-login.mjs'
// USO (CLI):     node lovarch-login.mjs marco@archprime.io
//
// Requer env: SUPABASE_ACCESS_TOKEN  (token da Management API; já presente na
// máquina do Pablo). Project ref e domínio configuráveis via env (defaults abaixo).
// ─────────────────────────────────────────────────────────────────────────────
const REF = process.env.LOVARCH_PROJECT_REF || 'cuxbydmyahjaplzkthkr';
const MGMT = 'https://api.supabase.com';
const PROJ = `https://${REF}.supabase.co`;
export const STORAGE_KEY = `sb-${REF}-auth-token`;

// As 7 contas PrimeVoices (dados reais populados — ver data/capture-infra.md)
export const ACCOUNTS = {
  marco:    'marco@archprime.io',    // renders, caosometro, DISC/SWOT
  caterina: 'caterina@archprime.io', // finanças, computo, pricing
  tommaso:  'tommaso@archprime.io',  // projetos, contratos, timeline
  vittoria: 'vittoria@archprime.io', // conteúdos, moodboard, lead magnet
  lorenzo:  'lorenzo@archprime.io',  // automações, CRM, operações
  olimpia:  'olimpia@archprime.io',  // renders, branding, portfolio
  salvo:    'salvo@archprime.io',    // social, leads locais, calendário
};

function mgmtToken() {
  const t = process.env.SUPABASE_ACCESS_TOKEN;
  if (!t) throw new Error('Falta SUPABASE_ACCESS_TOKEN no env (token da Management API).');
  return t;
}

async function anonKey() {
  const r = await fetch(`${MGMT}/v1/projects/${REF}/api-keys`, {
    headers: { Authorization: `Bearer ${mgmtToken()}` },
  });
  if (!r.ok) throw new Error(`Management api-keys ${r.status}: ${await r.text()}`);
  const keys = await r.json();
  const anon = keys.find(k => k.name === 'anon' || k.name === 'anon_key' || k.type === 'anon');
  if (!anon?.api_key) throw new Error('anon key não encontrada na Management API');
  return anon.api_key;
}

// Gera magic-link (service-role admin) e verifica → session. Sem service-role
// exposto: usamos a Management API que faz a operação admin server-side.
async function generateLink(email) {
  // A Management API expõe admin generate_link via o endpoint auth admin do projeto,
  // mas requer service_role. Obtemos service_role pela Management API (secrets).
  const r = await fetch(`${MGMT}/v1/projects/${REF}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${mgmtToken()}` },
  });
  if (!r.ok) throw new Error(`Management api-keys(reveal) ${r.status}: ${await r.text()}`);
  const keys = await r.json();
  const svc = keys.find(k => (k.name === 'service_role' || k.type === 'service_role'));
  if (!svc?.api_key) throw new Error('service_role não revelada pela Management API');
  const gl = await fetch(`${PROJ}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: svc.api_key, Authorization: `Bearer ${svc.api_key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  if (!gl.ok) throw new Error(`generate_link ${gl.status}: ${await gl.text()}`);
  const j = await gl.json();
  return j.properties?.hashed_token || j.hashed_token || j.token_hash;
}

export async function getSession(emailOrAlias) {
  const email = ACCOUNTS[emailOrAlias] || emailOrAlias;
  const anon = await anonKey();
  const tokenHash = await generateLink(email);
  const v = await fetch(`${PROJ}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash }),
  });
  if (!v.ok) throw new Error(`verify ${v.status}: ${await v.text()}`);
  const s = await v.json();
  // Formato que o supabase-js espera em localStorage:
  return {
    access_token: s.access_token, token_type: 'bearer',
    expires_in: s.expires_in, expires_at: s.expires_at,
    refresh_token: s.refresh_token, user: s.user,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const who = process.argv[2] || 'marco';
  getSession(who).then(s => {
    console.error(`✓ sessão de ${ACCOUNTS[who] || who} obtida (expira em ${s.expires_in}s)`);
    process.stdout.write(JSON.stringify(s));
  }).catch(e => { console.error('✗', e.message); process.exit(1); });
}
