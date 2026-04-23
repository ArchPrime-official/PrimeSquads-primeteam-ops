import * as p from '@clack/prompts';
import pc from 'picocolors';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getRepoRoot } from './paths.js';
import {
  isGitInstalled,
  isGitRepo,
  readPackageVersion,
} from './git.js';
import { readSessionHealth } from './session.js';
import { login } from './login.js';
import {
  loadState,
  markSetupStep,
  updateState,
  SetupStepName,
} from './state.js';

/**
 * Comando `pto setup` — wizard de primeira execução (idempotente).
 *
 * Cada step é skipado se já foi feito em execução anterior. Se o usuário
 * cancelar, o state fica parcial e o wizard retoma do último step pendente.
 *
 * Steps:
 *   1. node_version        — verifica Node >= 20
 *   2. git_installed       — verifica git na path
 *   3. clone_location      — confirma onde está o clone (getRepoRoot)
 *   4. deps_installed      — garante node_modules / reinstala se pediu
 *   5. bin_linked          — oferece npm link (comando global `pto`)
 *   6. logged_in           — oferece pto login
 *   7. identity_confirmed  — confirma via whoami + mostra roles
 */
export async function setup(options: { reset?: boolean } = {}): Promise<void> {
  const state = loadState();

  if (options.reset) {
    updateState({
      setup_completed_at: null,
      setup_started_at: new Date().toISOString(),
      setup_steps: {},
    });
  } else if (state.setup_completed_at) {
    p.intro(pc.yellow('⚠ Setup já foi concluído anteriormente.'));
    const again = await p.confirm({
      message: 'Quer rodar de novo mesmo assim?',
      initialValue: false,
    });
    if (p.isCancel(again) || !again) {
      p.outro('OK, nada a fazer. Rode `pto doctor` para verificar seu ambiente.');
      return;
    }
    updateState({ setup_completed_at: null, setup_steps: {} });
  } else if (!state.setup_started_at) {
    updateState({ setup_started_at: new Date().toISOString() });
  }

  p.intro(pc.bgYellow(pc.black(' pto setup ')));
  p.note(
    'Vou te guiar passo-a-passo para deixar o CLI funcionando.\n' +
      'A qualquer momento você pode cancelar com Ctrl+C — retomamos de onde parou.',
    'Bem-vinda/o',
  );

  // STEP 1 — Node version
  await runStep('node_version', async () => {
    const major = parseInt(process.versions.node.split('.')[0], 10);
    if (major < 20) {
      p.log.error(
        `Você tem Node v${process.versions.node}. Precisamos de v20 ou superior.`,
      );
      p.log.info('Atualize em https://nodejs.org e rode `pto setup` de novo.');
      throw new Error('node_version');
    }
    p.log.success(`Node v${process.versions.node} — OK.`);
  });

  // STEP 2 — git
  await runStep('git_installed', async () => {
    if (!isGitInstalled()) {
      p.log.error('git não está instalado.');
      p.log.info('Instale em https://git-scm.com e rode `pto setup` de novo.');
      throw new Error('git_installed');
    }
    p.log.success('git — OK.');
  });

  // STEP 3 — clone location
  const repoRoot = getRepoRoot();
  await runStep('clone_location', async () => {
    if (!isGitRepo(repoRoot)) {
      p.log.error(`Este diretório não é um clone git: ${pc.dim(repoRoot)}`);
      p.log.info(
        'Clone o squad: git clone https://github.com/ArchPrime-official/PrimeSquads-primeteam-ops.git',
      );
      throw new Error('clone_location');
    }
    const v = readPackageVersion(repoRoot);
    p.log.success(`Clone detectado em ${pc.dim(repoRoot)} ${v ? pc.dim(`(v${v})`) : ''}`);
  });

  // STEP 4 — deps
  await runStep('deps_installed', async () => {
    const nm = path.join(repoRoot, 'node_modules');
    if (!fs.existsSync(nm)) {
      const s = p.spinner();
      s.start('Instalando dependências (npm install)...');
      try {
        await runCmd('npm', ['install', '--silent'], repoRoot);
        s.stop('Dependências instaladas.');
      } catch (err) {
        s.stop(pc.red('Falha em npm install.'));
        p.log.error(err instanceof Error ? err.message : String(err));
        throw err;
      }
    } else {
      p.log.success('node_modules — OK.');
    }
  });

  // STEP 5 — bin global (npm link)
  await runStep('bin_linked', async () => {
    if (isBinAvailable('pto')) {
      p.log.success('Comando `pto` já disponível globalmente — OK.');
      return;
    }

    const wantsLink = await p.confirm({
      message:
        'Quer habilitar o comando `pto` globalmente? ' +
        pc.dim('(Senão, use `npm start` no diretório do squad.)'),
      initialValue: true,
    });
    if (p.isCancel(wantsLink)) throw new Error('cancelled');

    if (!wantsLink) {
      markSetupStep('bin_linked', 'skipped');
      p.log.info(
        `OK — use ${pc.cyan('npm start')} dentro de ${pc.dim(repoRoot)}.`,
      );
      return;
    }

    const s = p.spinner();
    s.start('Linkando comando `pto`...');
    try {
      await runCmd('npm', ['link'], repoRoot);
      if (isBinAvailable('pto')) {
        s.stop('Comando `pto` disponível em qualquer lugar do terminal.');
      } else {
        s.stop(pc.yellow('Linkei, mas `pto` não apareceu no PATH.'));
        p.log.warn(
          'Pode ser que você precise reiniciar o terminal, ' +
            `ou rodar manualmente: ${pc.cyan('sudo npm link')} dentro de ${pc.dim(repoRoot)}`,
        );
        markSetupStep('bin_linked', 'skipped');
        return;
      }
    } catch (err) {
      s.stop(pc.red('Falha em npm link.'));
      p.log.warn(
        'Isso normalmente é permissão. Tente manualmente:\n' +
          `  cd ${repoRoot}\n` +
          `  sudo npm link\n\n` +
          `Ou pule este passo — use ${pc.cyan('npm start')} dentro do clone.`,
      );
      p.log.error(err instanceof Error ? err.message : String(err));
      markSetupStep('bin_linked', 'skipped');
      return;
    }
  });

  // STEP 6 — login
  await runStep('logged_in', async () => {
    const health = readSessionHealth();
    if (health.status === 'valid') {
      p.log.success(`Já logada/o como ${pc.bold(health.session.email)} — OK.`);
      return;
    }

    const wantsLogin = await p.confirm({
      message: 'Fazer login Google agora? (abre o navegador)',
      initialValue: true,
    });
    if (p.isCancel(wantsLogin)) throw new Error('cancelled');

    if (!wantsLogin) {
      markSetupStep('logged_in', 'skipped');
      p.log.info(`OK — faça depois com ${pc.cyan('pto login')}.`);
      return;
    }

    await login();
  });

  // STEP 7 — identity confirmation
  await runStep('identity_confirmed', async () => {
    const health = readSessionHealth();
    if (health.status !== 'valid' && health.status !== 'expiring') {
      p.log.info('Pulei a confirmação — você pulou o login.');
      markSetupStep('identity_confirmed', 'skipped');
      return;
    }
    p.log.success(`Você está logada/o como ${pc.bold(health.session.email)}.`);
  });

  updateState({ setup_completed_at: new Date().toISOString() });

  p.note(
    `${pc.cyan('→')} ${pc.cyan('pto')} ${pc.dim('            # rotina diária (roda sempre que abrir o terminal)')}\n` +
      `${pc.cyan('→')} ${pc.cyan('claude')} ${pc.dim('         # abrir Claude Code no diretório do squad')}\n` +
      `${pc.cyan('→')} ${pc.cyan('pto doctor')} ${pc.dim('     # se algo não funcionar, roda este diagnóstico')}`,
    'O que fazer agora',
  );
  p.outro(pc.green('Pronto — você está no ar.'));
}

async function runStep(step: SetupStepName, fn: () => Promise<void>): Promise<void> {
  const state = loadState();
  const current = state.setup_steps[step];
  if (current === 'done') {
    // já concluído, skip silencioso
    return;
  }
  try {
    await fn();
    const after = loadState();
    // Só marca done se o próprio step não marcou algo diferente (skipped).
    if (!after.setup_steps[step] || after.setup_steps[step] === 'pending') {
      markSetupStep(step, 'done');
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'cancelled') {
      p.cancel('Setup cancelado — rode `pto setup` de novo quando quiser continuar.');
      process.exit(0);
    }
    throw err;
  }
}

function isBinAvailable(bin: string): boolean {
  try {
    execSync(`command -v ${bin}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function runCmd(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${cmd} exited ${code}`));
    });
    child.on('error', reject);
  });
}
