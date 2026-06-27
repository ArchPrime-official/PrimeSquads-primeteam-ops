#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// capture-ground-truth.mjs — Captura screenshots REAIS das telas Lovarch em
// PRODUÇÃO (app.lovarch.com), logado nas 7 contas de captura. Atualiza o
// ground-truth/ que serve de referência para recriar/animar os presets.
//
// Não precisa do repo Lovarch nem de dev server nem do patch de realtime:
// roda contra produção. Requer SUPABASE_ACCESS_TOKEN (Management API).
//
// USO:
//   cd /Users/pablo/PrimeTeam
//   node motion-engine/scripts/capture-ground-truth.mjs            # todos os módulos
//   node motion-engine/scripts/capture-ground-truth.mjs planning   # um módulo
// ─────────────────────────────────────────────────────────────────────────────
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSession, STORAGE_KEY } from './lovarch-login.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(__dirname, '..');
const GT = path.join(ENGINE, 'ground-truth');
const BASE = process.env.LOVARCH_URL || 'https://app.lovarch.com';

// Módulo new-home (?m=<key>) → conta com dados ricos para aquela tela.
// Ver data/lovarch-screen-registry.md para a tabela completa e ressalvas.
const MODULES = [
  { key: 'render',        account: 'olimpia',  file: 'mod-render.png' },
  { key: 'video',         account: 'olimpia',  file: 'mod-video.png' },
  { key: 'moodboard',     account: 'olimpia',  file: 'mod-moodboard.png' },
  { key: 'branding',      account: 'olimpia',  file: 'mod-branding.png' },
  { key: 'content_studio',account: 'vittoria', file: 'mod-content.png' },
  { key: 'archchat',      account: 'marco',    file: 'mod-archchat.png' },
  { key: 'caosometro',    account: 'marco',    file: 'mod-caosometro.png' },
  { key: 'disc',          account: 'marco',    file: 'mod-disc.png' },
  { key: 'swot',          account: 'marco',    file: 'mod-swot.png' },
  { key: 'finance',       account: 'caterina', file: 'mod-finance.png' },
  { key: 'planning',      account: 'caterina', file: 'mod-planning.png' },
  { key: 'crm',           account: 'lorenzo',  file: 'mod-crm.png' },
  { key: 'projects',      account: 'tommaso',  file: 'mod-projects.png' },
  { key: 'portal',        account: 'tommaso',  file: 'mod-portal.png' },
  // ─── faltantes (rumo a 100%) ───
  { key: 'contracts',     account: 'tommaso',  file: 'mod-contracts.png' },
  { key: 'kpi',           account: 'caterina', file: 'mod-kpi.png' },
  { key: 'social',        account: 'salvo',    file: 'mod-social.png' },
  { key: 'audiences',     account: 'salvo',    file: 'mod-audiences.png' },
  { key: 'campaigns',     account: 'lorenzo',  file: 'mod-campaigns.png' },
  { key: 'editorial',     account: 'vittoria', file: 'mod-editorial.png' },
  { key: 'brochure',      account: 'vittoria', file: 'mod-brochure.png' },
  { key: 'site_builder',  account: 'marco',    file: 'mod-site_builder.png' },
  { key: 'formazione',    account: 'marco',    file: 'mod-formazione.png' },
  { key: 'sfide',         account: 'marco',    file: 'mod-sfide.png' },
  { key: 'results',       account: 'marco',    file: 'mod-results.png' },
  { key: 'settings',      account: 'marco',    file: 'mod-settings.png' },
  { key: 'referral',      account: 'marco',    file: 'mod-referral.png' },
  { key: 'bonus',         account: 'marco',    file: 'mod-bonus.png' },
  { key: 'feedback',      account: 'marco',    file: 'mod-feedback.png' },
];

async function captureForAccount(browser, account, modules) {
  const session = await getSession(account);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  // injeta sessão + flags de onboarding ANTES de qualquer navegação
  await ctx.addInitScript(({ key, sess, uid }) => {
    localStorage.setItem(key, JSON.stringify(sess));
    localStorage.setItem('lovarch_onboarding_wizard_completed', 'true');
    if (uid) {
      localStorage.setItem(`setup_completed_${uid}`, 'true');
      localStorage.setItem(`academy_wizard_completed_${uid}`, 'true');
    }
  }, { key: STORAGE_KEY, sess: session, uid: session.user?.id });

  const page = await ctx.newPage();
  for (const m of modules) {
    const url = `${BASE}/new-home?m=${m.key}`;
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForTimeout(2500); // deixa animações/dados assentarem
      const out = path.join(GT, m.file);
      await page.screenshot({ path: out });
      console.log(`  ✓ ${account.padEnd(9)} ${m.key.padEnd(15)} → ${m.file}`);
    } catch (e) {
      console.log(`  ✗ ${account.padEnd(9)} ${m.key.padEnd(15)} FALHOU: ${e.message.split('\n')[0]}`);
    }
  }
  await ctx.close();
}

async function main() {
  const only = process.argv[2];
  const wanted = only ? MODULES.filter(m => m.key === only) : MODULES;
  if (!wanted.length) { console.error(`módulo "${only}" não existe no registry`); process.exit(1); }
  fs.mkdirSync(GT, { recursive: true });

  // agrupa por conta (1 login por conta, captura vários módulos)
  const byAccount = {};
  for (const m of wanted) (byAccount[m.account] ||= []).push(m);

  console.log(`▶ Captura ground-truth de ${BASE} — ${wanted.length} tela(s), ${Object.keys(byAccount).length} conta(s)`);
  const browser = await chromium.launch();
  for (const [account, mods] of Object.entries(byAccount)) {
    await captureForAccount(browser, account, mods);
  }
  await browser.close();
  console.log('✓ ground-truth atualizado em', path.relative(process.cwd(), GT));
}
main().catch(e => { console.error(e); process.exit(1); });
