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
import { firstRunPickLocale } from './lang.js';
import { hasChosenLocale } from './preferences.js';
import { t } from './i18n/index.js';

const SQUAD_CLONE_URL = 'https://github.com/ArchPrime-official/PrimeSquads-primeteam-ops.git';

export async function setup(options: { reset?: boolean } = {}): Promise<void> {
  const state = loadState();

  if (options.reset) {
    updateState({
      setup_completed_at: null,
      setup_started_at: new Date().toISOString(),
      setup_steps: {},
    });
  } else if (state.setup_completed_at) {
    p.intro(pc.yellow(`⚠ ${t('cli:setup.already_done_warn')}`));
    const again = await p.confirm({
      message: t('cli:setup.already_done_ask'),
      initialValue: false,
    });
    if (p.isCancel(again) || !again) {
      p.outro(t('cli:setup.already_done_skip', { cmd: 'pto doctor' }));
      return;
    }
    updateState({ setup_completed_at: null, setup_steps: {} });
  } else if (!state.setup_started_at) {
    updateState({ setup_started_at: new Date().toISOString() });
  }

  // Se o usuário ainda não escolheu idioma, roda o first-run picker.
  // Isso carrega t() com a língua correta já para o resto do wizard.
  if (!hasChosenLocale()) {
    await firstRunPickLocale();
  }

  p.intro(pc.bgYellow(pc.black(` ${t('cli:setup.title')} `)));
  p.note(t('cli:setup.welcome_message'), t('cli:setup.welcome_heading'));

  await runStep('node_version', async () => {
    const major = parseInt(process.versions.node.split('.')[0], 10);
    if (major < 20) {
      p.log.error(t('cli:setup.node_fail', { version: process.versions.node }));
      p.log.info(t('cli:setup.node_hint', { cmd: 'pto setup' }));
      throw new Error('node_version');
    }
    p.log.success(t('cli:setup.node_ok', { version: process.versions.node }));
  });

  await runStep('git_installed', async () => {
    if (!isGitInstalled()) {
      p.log.error(t('cli:setup.git_fail'));
      p.log.info(t('cli:setup.git_hint', { cmd: 'pto setup' }));
      throw new Error('git_installed');
    }
    p.log.success(t('cli:setup.git_ok'));
  });

  const repoRoot = getRepoRoot();
  await runStep('clone_location', async () => {
    if (!isGitRepo(repoRoot)) {
      p.log.error(t('cli:setup.clone_fail', { path: pc.dim(repoRoot) }));
      p.log.info(t('cli:setup.clone_hint', { url: SQUAD_CLONE_URL }));
      throw new Error('clone_location');
    }
    const v = readPackageVersion(repoRoot);
    const msg = v
      ? t('cli:setup.clone_ok', { path: pc.dim(repoRoot), version: v })
      : t('cli:setup.clone_ok_no_version', { path: pc.dim(repoRoot) });
    p.log.success(msg);
  });

  await runStep('deps_installed', async () => {
    const nm = path.join(repoRoot, 'node_modules');
    if (!fs.existsSync(nm)) {
      const s = p.spinner();
      s.start(t('cli:setup.deps_installing'));
      try {
        await runCmd('npm', ['install', '--silent'], repoRoot);
        s.stop(t('cli:setup.deps_done'));
      } catch (err) {
        s.stop(pc.red(t('cli:setup.deps_fail')));
        p.log.error(err instanceof Error ? err.message : String(err));
        throw err;
      }
    } else {
      p.log.success(t('cli:setup.deps_ok'));
    }
  });

  await runStep('bin_linked', async () => {
    if (isBinAvailable('pto')) {
      p.log.success(t('cli:setup.bin_already'));
      return;
    }
    const wantsLink = await p.confirm({
      message: t('cli:setup.bin_ask'),
      initialValue: true,
    });
    if (p.isCancel(wantsLink)) throw new Error('cancelled');
    if (!wantsLink) {
      markSetupStep('bin_linked', 'skipped');
      p.log.info(t('cli:setup.bin_skipped', { path: pc.dim(repoRoot) }));
      return;
    }
    const s = p.spinner();
    s.start(t('cli:setup.bin_linking'));
    try {
      await runCmd('npm', ['link'], repoRoot);
      if (isBinAvailable('pto')) {
        s.stop(t('cli:setup.bin_done'));
      } else {
        s.stop(pc.yellow(t('cli:setup.bin_path_warn')));
        p.log.warn(t('cli:setup.bin_restart_hint'));
        markSetupStep('bin_linked', 'skipped');
        return;
      }
    } catch (err) {
      s.stop(pc.red(t('cli:setup.bin_link_failed')));
      p.log.warn(t('cli:setup.bin_manual_hint', { path: repoRoot }));
      p.log.error(err instanceof Error ? err.message : String(err));
      markSetupStep('bin_linked', 'skipped');
      return;
    }
  });

  await runStep('logged_in', async () => {
    const health = readSessionHealth();
    if (health.status === 'valid') {
      p.log.success(t('cli:setup.login_already', { email: pc.bold(health.session.email) }));
      return;
    }
    const wantsLogin = await p.confirm({
      message: t('cli:setup.login_ask'),
      initialValue: true,
    });
    if (p.isCancel(wantsLogin)) throw new Error('cancelled');
    if (!wantsLogin) {
      markSetupStep('logged_in', 'skipped');
      p.log.info(t('cli:setup.login_skipped', { cmd: 'pto login' }));
      return;
    }
    await login();
  });

  await runStep('identity_confirmed', async () => {
    const health = readSessionHealth();
    if (health.status !== 'valid' && health.status !== 'expiring') {
      p.log.info(t('cli:setup.identity_skipped'));
      markSetupStep('identity_confirmed', 'skipped');
      return;
    }
    p.log.success(t('cli:setup.identity_ok', { email: pc.bold(health.session.email) }));
  });

  updateState({ setup_completed_at: new Date().toISOString() });

  p.note(
    `${pc.cyan('→')} ${t('cli:setup.what_now_daily', { cmd: pc.cyan('pto') })}\n` +
      `${pc.cyan('→')} ${t('cli:setup.what_now_claude', { cmd: pc.cyan('claude') })}\n` +
      `${pc.cyan('→')} ${t('cli:setup.what_now_doctor', { cmd: pc.cyan('pto doctor') })}`,
    t('cli:setup.what_now_heading'),
  );
  p.outro(pc.green(t('cli:setup.all_done')));
}

async function runStep(step: SetupStepName, fn: () => Promise<void>): Promise<void> {
  const state = loadState();
  const current = state.setup_steps[step];
  if (current === 'done') return;
  try {
    await fn();
    const after = loadState();
    if (!after.setup_steps[step] || after.setup_steps[step] === 'pending') {
      markSetupStep(step, 'done');
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'cancelled') {
      p.cancel(t('cli:setup.cancelled', { cmd: 'pto setup' }));
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
