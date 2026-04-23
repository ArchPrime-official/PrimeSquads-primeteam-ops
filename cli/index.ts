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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readPkgVersion(): string {
  // Walk up looking for package.json (funciona em dev via tsx e em dist/ via npm link)
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

const program = new Command();

program
  .name('pto')
  .description(
    'CLI do squad primeteam-ops.\n' +
      'Rode `pto` todo dia para verificar atualizações e sua sessão.\n' +
      'Primeira vez? Rode `pto setup`.',
  )
  .version(readPkgVersion(), '-v, --version', 'mostra a versão do CLI');

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

program.parseAsync(process.argv).catch((err) => {
  console.error('\n✗', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
