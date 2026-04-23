import pc from 'picocolors';
import { createServer } from 'node:net';
import { execSync } from 'node:child_process';
import { readSessionHealth } from './session.js';
import {
  isGitInstalled,
  isGitRepo,
  readRepoStatus,
  readPackageVersion,
} from './git.js';
import { getRepoRoot } from './paths.js';
import { CALLBACK_PORT, SUPABASE_URL } from './config.js';
import { formatRelativeTime } from './ui.js';
import { t } from './i18n/index.js';

type CheckStatus = 'ok' | 'warn' | 'fail';

interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
}

const SQUAD_CLONE_URL = 'https://github.com/ArchPrime-official/PrimeSquads-primeteam-ops.git';

const ICON: Record<CheckStatus, string> = {
  ok: pc.green('✓'),
  warn: pc.yellow('⚠'),
  fail: pc.red('✗'),
};

function checkNode(): Check {
  const v = process.versions.node;
  const major = parseInt(v.split('.')[0], 10);
  if (major >= 20) {
    return { name: t('cli:doctor.check_node'), status: 'ok', detail: `v${v}` };
  }
  return {
    name: t('cli:doctor.check_node'),
    status: 'fail',
    detail: `v${v}`,
    hint: t('cli:setup.node_hint', { cmd: 'pto setup' }),
  };
}

function checkGit(): Check {
  if (!isGitInstalled()) {
    return {
      name: t('cli:doctor.check_git'),
      status: 'fail',
      detail: t('cli:setup.git_fail'),
      hint: t('cli:setup.git_hint', { cmd: 'pto setup' }),
    };
  }
  try {
    const v = execSync('git --version', { encoding: 'utf-8' }).trim().replace('git version ', '');
    return { name: t('cli:doctor.check_git'), status: 'ok', detail: v };
  } catch {
    return { name: t('cli:doctor.check_git'), status: 'ok', detail: 'ok' };
  }
}

function checkGh(): Check {
  try {
    const v = execSync('gh --version', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')[0]
      ?.trim();
    return { name: 'gh (GitHub CLI)', status: 'ok', detail: v ?? 'ok' };
  } catch {
    return {
      name: 'gh (GitHub CLI)',
      status: 'warn',
      detail: t('cli:doctor.check_gh_optional'),
      hint: t('cli:doctor.check_gh_hint'),
    };
  }
}

function checkCallbackPort(): Promise<Check> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve({
          name: t('cli:doctor.check_port'),
          status: 'fail',
          detail: t('cli:doctor.check_port_busy'),
          hint: t('cli:doctor.check_port_hint'),
        });
      } else {
        resolve({
          name: t('cli:doctor.check_port'),
          status: 'warn',
          detail: err.message,
        });
      }
      server.close();
    });
    server.once('listening', () => {
      server.close(() => {
        resolve({
          name: t('cli:doctor.check_port'),
          status: 'ok',
          detail: t('cli:doctor.check_port_available'),
        });
      });
    });
    server.listen(CALLBACK_PORT, '127.0.0.1');
  });
}

async function checkSupabaseReach(): Promise<Check> {
  const url = `${SUPABASE_URL}/auth/v1/health`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok || res.status === 401) {
      return { name: t('cli:doctor.check_supabase'), status: 'ok', detail: t('cli:doctor.check_supabase_ok') };
    }
    return {
      name: t('cli:doctor.check_supabase'),
      status: 'warn',
      detail: `HTTP ${res.status}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: t('cli:doctor.check_supabase'),
      status: 'fail',
      detail: t('cli:doctor.check_supabase_fail'),
      hint: t('cli:doctor.check_supabase_hint') + (process.env.PTO_DEBUG === '1' ? ` (${msg})` : ''),
    };
  }
}

function checkSession(): Check {
  const h = readSessionHealth();
  switch (h.status) {
    case 'missing':
      return {
        name: t('cli:doctor.check_session_name'),
        status: 'warn',
        detail: t('cli:doctor.check_session_missing'),
        hint: t('cli:doctor.check_session_missing_hint'),
      };
    case 'corrupted':
      return {
        name: t('cli:doctor.check_session_name'),
        status: 'fail',
        detail: t('cli:doctor.check_session_corrupted'),
        hint: t('cli:doctor.check_session_corrupted_hint'),
      };
    case 'expired':
      return {
        name: t('cli:doctor.check_session_name'),
        status: 'fail',
        detail: formatRelativeTime(Math.floor(Date.now() / 1000) - h.expiredSinceSec),
        hint: t('cli:doctor.check_session_expired_hint'),
      };
    case 'expiring':
      return {
        name: t('cli:doctor.check_session_name'),
        status: 'warn',
        detail: `${h.session.email} (${formatRelativeTime(h.session.expires_at)})`,
        hint: t('cli:doctor.check_session_expiring_hint'),
      };
    case 'valid':
      return {
        name: t('cli:doctor.check_session_name'),
        status: 'ok',
        detail: `${h.session.email} (${formatRelativeTime(h.session.expires_at)})`,
      };
  }
}

function checkRepo(): Check[] {
  const repoRoot = getRepoRoot();
  const version = readPackageVersion(repoRoot);

  if (!isGitRepo(repoRoot)) {
    return [
      {
        name: t('cli:doctor.check_folder'),
        status: 'fail',
        detail: t('cli:doctor.check_folder_fail'),
        hint: t('cli:doctor.check_folder_hint', { url: SQUAD_CLONE_URL }),
      },
    ];
  }

  const status = readRepoStatus(repoRoot);
  const results: Check[] = [];

  results.push({
    name: t('cli:doctor.check_version'),
    status: 'ok',
    detail: version ? `v${version}` : '?',
  });

  results.push({
    name: t('cli:doctor.check_branch'),
    status: status.branch === 'main' ? 'ok' : 'warn',
    detail: status.branch ?? '?',
    hint: status.branch !== 'main' ? t('cli:doctor.check_branch_alt_hint') : undefined,
  });

  if (status.dirty) {
    results.push({
      name: t('cli:doctor.check_dirty'),
      status: 'warn',
      detail: t('cli:doctor.check_dirty_some'),
      hint: t('cli:doctor.check_dirty_hint'),
    });
  } else {
    results.push({
      name: t('cli:doctor.check_dirty'),
      status: 'ok',
      detail: t('cli:doctor.check_dirty_none'),
    });
  }

  if (status.behind !== null && status.behind > 0) {
    const count = status.behind;
    const key = count === 1 ? 'cli:doctor.check_updates_found_one' : 'cli:doctor.check_updates_found_other';
    results.push({
      name: t('cli:doctor.check_updates'),
      status: 'warn',
      detail: t(key, { count }),
      hint: t('cli:doctor.check_updates_hint'),
    });
  } else if (status.behind === 0) {
    results.push({
      name: t('cli:doctor.check_updates'),
      status: 'ok',
      detail: t('cli:doctor.check_updates_ok'),
    });
  }

  return results;
}

export async function doctor(): Promise<void> {
  console.log(pc.bold(`\n ${t('cli:doctor.heading')}\n`));

  const [portCheck, supabaseCheck] = await Promise.all([
    checkCallbackPort(),
    checkSupabaseReach(),
  ]);

  const checks: Check[] = [
    checkNode(),
    checkGit(),
    checkGh(),
    ...checkRepo(),
    portCheck,
    supabaseCheck,
    checkSession(),
  ];

  for (const c of checks) {
    console.log(`  ${ICON[c.status]} ${c.name}: ${c.detail}`);
    if (c.hint) console.log(`      ${pc.dim(c.hint)}`);
  }

  const failures = checks.filter((c) => c.status === 'fail').length;
  const warnings = checks.filter((c) => c.status === 'warn').length;

  console.log('');
  if (failures > 0) {
    const key = failures === 1 ? 'cli:doctor.failures_one' : 'cli:doctor.failures_other';
    console.log(pc.red(`  ${t(key, { count: failures })}`));
    console.log(pc.dim(`  ${t('cli:doctor.failure_hint')}`));
    process.exitCode = 1;
  } else if (warnings > 0) {
    const key = warnings === 1 ? 'cli:doctor.warnings_one' : 'cli:doctor.warnings_other';
    console.log(pc.yellow(`  ${t(key, { count: warnings })}`));
  } else {
    console.log(pc.green(`  ${t('cli:doctor.ok_all')}`));
  }
  console.log('');
}
