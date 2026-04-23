#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { login } from './login.js';
import { whoami } from './whoami.js';
import { logout } from './logout.js';
import { refresh } from './refresh.js';
import { doctor } from './doctor.js';
import { update } from './update.js';
import { start } from './start.js';
import { setup } from './setup.js';
import { lang } from './lang.js';
import { onboarding } from './onboarding.js';
import { initI18n } from './i18n/index.js';
import { resolveLocale } from './preferences.js';
import { isSupportedLocale } from './i18n/detect.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readPkgVersion(): string {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    try {
      const raw = readFileSync(path.join(dir, 'package.json'), 'utf-8');
      const pkg = JSON.parse(raw);
      if (pkg.name === 'primeteam-ops-cli') return pkg.version ?? '0.0.0';
    } catch {
      /* sobe */
    }
    dir = path.dirname(dir);
  }
  return '0.0.0';
}

async function bootstrapLocale(rawLang?: string): Promise<void> {
  const flag = rawLang && isSupportedLocale(rawLang) ? rawLang : undefined;
  const { locale } = resolveLocale(flag);
  await initI18n(locale);
}

async function main(): Promise<void> {
  // Pré-parse do --lang para inicializar i18n antes de qualquer texto
  // (commander parse só roda dentro de parseAsync; precisamos de i18n para as
  // descrições de comandos). Busca primeira ocorrência de --lang=X ou --lang X.
  let langFlag: string | undefined;
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith('--lang=')) {
      langFlag = arg.slice(7);
      break;
    }
    if (arg === '--lang' && process.argv[i + 1]) {
      langFlag = process.argv[i + 1];
      break;
    }
  }
  await bootstrapLocale(langFlag);

  const program = new Command();

  program
    .name('pto')
    .description(
      'CLI do squad primeteam-ops.\n' +
        'Rode `pto` todo dia para verificar atualizações e sua sessão.\n' +
        'Primeira vez? Rode `pto setup`.',
    )
    .version(readPkgVersion(), '-v, --version', 'mostra a versão do CLI')
    .option('--lang <locale>', 'idioma (pt-BR | it | en) — só para esta execução');

  program
    .command('start', { isDefault: true })
    .description('rotina diária: verifica atualizações + sua sessão + mostra onde você parou')
    .action(async () => {
      await start();
    });

  program
    .command('setup')
    .description('primeira vez — passo-a-passo guiado para deixar tudo funcionando')
    .option('--reset', 'reseta o estado e roda todos os steps de novo')
    .action(async (opts) => {
      await setup({ reset: opts.reset });
    });

  program
    .command('login')
    .description('entrar com sua conta Google @archprime.io (abre o navegador)')
    .action(async () => {
      await login();
    });

  program
    .command('whoami')
    .description('mostra quem está logada/o, seus papéis, e quando expira')
    .action(async () => {
      await whoami();
    });

  program
    .command('logout')
    .description('remove sua sessão local')
    .action(async () => {
      await logout();
    });

  program
    .command('refresh')
    .description('renova sua sessão manualmente (usa o token de renovação)')
    .action(async () => {
      await refresh();
    });

  program
    .command('doctor')
    .description('diagnóstico do ambiente (node, git, porta, conexão, sessão)')
    .action(async () => {
      await doctor();
    });

  program
    .command('update')
    .description('atualiza o squad (git pull do remoto)')
    .option('--dry-run', 'só mostra o que mudou, sem aplicar')
    .action(async (opts) => {
      const result = await update({ dryRun: opts.dryRun });
      process.exit(result.pulled || !result.checked || result.commitsApplied === 0 ? 0 : 1);
    });

  program
    .command('lang [action] [value]')
    .description('mostra ou muda o idioma do CLI (set, auto, reset)')
    .action(async (action, value) => {
      await lang(action, value);
    });

  program
    .command('onboarding [action] [role]')
    .description('controla o tour de primeiro uso (status | done | reset)')
    .action((action, role) => {
      onboarding(action, role);
    });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error('\n✗', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
