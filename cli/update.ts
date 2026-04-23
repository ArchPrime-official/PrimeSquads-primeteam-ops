import ora from 'ora';
import pc from 'picocolors';
import { spawn } from 'node:child_process';
import {
  fetchRemote,
  countCommitsBehind,
  getRecentCommitMessages,
  hasUncommittedChanges,
  pullFastForward,
  getCurrentBranch,
  packageLockChanged,
  getHeadSha,
} from './git.js';
import { getRepoRoot } from './paths.js';
import { t } from './i18n/index.js';

export interface UpdateOptions {
  dryRun?: boolean;
  silent?: boolean;
}

export interface UpdateResult {
  checked: boolean;
  pulled: boolean;
  depsReinstalled: boolean;
  commitsApplied: number;
  messages: string[];
  skippedReason?: string;
}

export async function update(options: UpdateOptions = {}): Promise<UpdateResult> {
  const { dryRun = false, silent = false } = options;
  const repoRoot = getRepoRoot();

  const branch = getCurrentBranch(repoRoot);
  const shaBefore = getHeadSha(repoRoot);
  const result: UpdateResult = {
    checked: false,
    pulled: false,
    depsReinstalled: false,
    commitsApplied: 0,
    messages: [],
  };

  if (!branch) {
    result.skippedReason = t('cli:update.not_clone');
    if (!silent) console.error(`${pc.red('✗')} ${t('cli:update.not_clone')}`);
    return result;
  }

  if (branch !== 'main') {
    result.skippedReason = t('cli:update.branch_warn', { branch });
    if (!silent) {
      console.log(
        `${pc.yellow('⚠')} ${t('cli:update.branch_warn', { branch: pc.bold(branch) })}\n` +
          `  ${pc.cyan('→')} ${t('cli:update.branch_hint', { cmd: pc.cyan('git checkout main') })}`,
      );
    }
    return result;
  }

  if (hasUncommittedChanges(repoRoot)) {
    result.skippedReason = t('cli:update.dirty_warn');
    if (!silent) {
      console.log(
        `${pc.yellow('⚠')} ${t('cli:update.dirty_warn')}\n` +
          `  ${pc.cyan('→')} ${t('cli:update.dirty_hint', { cmd: pc.cyan('pto doctor') })}`,
      );
    }
    return result;
  }

  const spinner = silent ? null : ora(t('cli:update.spinner_fetching')).start();
  try {
    await fetchRemote('origin', { cwd: repoRoot, timeoutMs: 15_000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (spinner) spinner.fail(`${t('cli:update.fetch_fail')} ${pc.dim(t('cli:update.fetch_fail_hint'))}`);
    result.skippedReason = t('cli:update.fetch_fail');
    if (process.env.PTO_DEBUG === '1') console.error(pc.dim(msg));
    return result;
  }

  const behind = countCommitsBehind('main', 'origin', repoRoot);
  result.checked = true;

  if (behind === null || behind === 0) {
    if (spinner) spinner.succeed(t('cli:update.up_to_date'));
    return result;
  }

  const messages = getRecentCommitMessages(
    'HEAD',
    'origin/main',
    Math.min(behind, 10),
    repoRoot,
  );
  result.messages = messages;

  if (spinner) {
    const key = behind === 1 ? 'cli:update.updates_found_one' : 'cli:update.updates_found_other';
    spinner.succeed(t(key, { count: behind }));
  }

  if (!silent) {
    console.log('');
    for (const m of messages) console.log(`  ${pc.dim('·')} ${m}`);
    if (behind > messages.length) {
      console.log(`  ${pc.dim(t('cli:update.more_hidden', { count: behind - messages.length }))}`);
    }
    console.log('');
  }

  if (dryRun) {
    if (!silent) {
      console.log(`${pc.cyan('→')} ${t('cli:update.dry_run_hint', { cmd: pc.cyan('pto update') })}`);
    }
    return result;
  }

  const pullSpin = silent ? null : ora(t('cli:update.applying')).start();
  try {
    await pullFastForward('origin', 'main', { cwd: repoRoot, timeoutMs: 60_000 });
    result.pulled = true;
    result.commitsApplied = behind;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (pullSpin) pullSpin.fail(`${t('cli:update.pull_fail')} ${pc.dim(t('cli:update.pull_fail_hint'))}`);
    if (process.env.PTO_DEBUG === '1') console.error(pc.dim(msg));
    return result;
  }

  if (pullSpin) pullSpin.succeed(t('cli:update.applied'));

  if (shaBefore && packageLockChanged(shaBefore, 'HEAD', repoRoot)) {
    const npmSpin = silent ? null : ora(t('cli:update.deps_updating')).start();
    try {
      await runNpmInstall(repoRoot);
      result.depsReinstalled = true;
      if (npmSpin) npmSpin.succeed(t('cli:update.deps_updated'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (npmSpin) npmSpin.fail(`${t('cli:update.deps_fail')} ${pc.dim(t('cli:update.deps_fail_hint'))}`);
      if (process.env.PTO_DEBUG === '1') console.error(pc.dim(msg));
    }
  }

  return result;
}

function runNpmInstall(cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['install', '--silent'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `npm install exited ${code}`));
    });
    child.on('error', reject);
  });
}
