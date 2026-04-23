import pc from 'picocolors';
import { update } from './update.js';
import { maybeRefresh, readSessionHealth } from './session.js';
import { readPackageVersion, getHeadSha } from './git.js';
import { getRepoRoot } from './paths.js';
import { loadState, recordStart } from './state.js';
import { formatRelativeTime } from './ui.js';
import { t } from './i18n/index.js';

export async function start(): Promise<void> {
  const repoRoot = getRepoRoot();
  const version = readPackageVersion(repoRoot);
  const sha = getHeadSha(repoRoot);
  const state = loadState();

  const updateResult = await update({ silent: true, dryRun: true });
  const refreshResult = await maybeRefresh();

  printBriefing({
    version,
    sessionHealth: readSessionHealth(),
    updateResult,
    refreshed: refreshResult.refreshed,
    lastStartAt: state.last_start_at,
  });

  recordStart(sha, version);
}

function greetByHour(): string {
  const h = new Date().getHours();
  if (h < 5) return t('cli:start.greeting_late');
  if (h < 12) return t('cli:start.greeting_morning');
  if (h < 18) return t('cli:start.greeting_afternoon');
  return t('cli:start.greeting_evening');
}

function dateLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

interface BriefingArgs {
  version: string | null;
  sessionHealth: ReturnType<typeof readSessionHealth>;
  updateResult: Awaited<ReturnType<typeof update>>;
  refreshed: boolean;
  lastStartAt: string | null;
}

function printBriefing(args: BriefingArgs): void {
  const { version, sessionHealth, updateResult, refreshed, lastStartAt } = args;

  const who = sessionHealth.status === 'valid' || sessionHealth.status === 'expiring'
    ? sessionHealth.session.email
    : null;
  const name = who ? who.split('@')[0] : null;
  const greeting = name ? `${greetByHour()}, ${pc.bold(name)}` : greetByHour();

  console.log('');
  console.log(`  ${greeting} — ${pc.dim(dateLabel())}`);
  console.log('');

  const versionLine = version ? `v${version}` : '?';
  let versionStatus: string;
  if (updateResult.checked) {
    if (updateResult.messages.length > 0) {
      const count = updateResult.messages.length;
      const key = count === 1 ? 'cli:start.updates_available_one' : 'cli:start.updates_available_other';
      versionStatus = pc.yellow(`(${t(key, { count })})`);
    } else {
      versionStatus = pc.dim(`(${t('cli:start.up_to_date')})`);
    }
  } else if (updateResult.skippedReason) {
    versionStatus = pc.dim(`(${updateResult.skippedReason})`);
  } else {
    versionStatus = pc.dim('(...)');
  }
  console.log(`  ${pc.dim(t('cli:start.squad_label'))}        ${versionLine} ${versionStatus}`);

  if (sessionHealth.status === 'valid') {
    console.log(
      `  ${pc.dim(t('cli:start.session_label'))}       ${sessionHealth.session.email} ${pc.dim(
        t('cli:start.session_expires_in', { when: formatRelativeTime(sessionHealth.session.expires_at) }),
      )}`,
    );
  } else if (sessionHealth.status === 'expiring') {
    const tag = refreshed ? pc.green(t('cli:start.renewed_now')) : pc.yellow(t('cli:start.renew_soon'));
    console.log(
      `  ${pc.dim(t('cli:start.session_label'))}       ${sessionHealth.session.email} ${pc.dim(`(${tag})`)}`,
    );
  } else if (sessionHealth.status === 'expired') {
    console.log(`  ${pc.dim(t('cli:start.session_label'))}       ${pc.red(t('cli:start.session_expired_short', { cmd: pc.cyan('pto refresh') }))}`);
  } else if (sessionHealth.status === 'missing') {
    console.log(`  ${pc.dim(t('cli:start.session_label'))}       ${pc.yellow(t('cli:start.session_missing_short', { cmd: pc.cyan('pto login') }))}`);
  } else {
    console.log(`  ${pc.dim(t('cli:start.session_label'))}       ${pc.red(t('cli:start.session_corrupted_short', { cmd: pc.cyan('pto login') }))}`);
  }

  if (lastStartAt) {
    const lastSec = Math.floor(new Date(lastStartAt).getTime() / 1000);
    console.log(`  ${pc.dim(t('cli:start.last_use_label'))}   ${formatRelativeTime(lastSec)}`);
  } else {
    console.log(`  ${pc.dim(t('cli:start.last_use_label'))}   ${pc.dim(t('cli:start.first_time_today'))}`);
  }

  if (updateResult.messages.length > 0) {
    console.log('');
    console.log(`  ${pc.bold(pc.yellow(t('cli:start.updates_pending_heading')))}`);
    for (const m of updateResult.messages.slice(0, 5)) {
      console.log(`    ${pc.dim('·')} ${m}`);
    }
    if (updateResult.messages.length > 5) {
      console.log(`    ${pc.dim(`... +${updateResult.messages.length - 5}`)}`);
    }
    console.log('');
    console.log(`  ${pc.cyan('→')} ${t('cli:start.apply_hint', { cmd: pc.cyan('pto update') })}`);
  }

  console.log('');
  console.log(`  ${pc.bold(t('cli:start.what_to_do_heading'))}`);

  if (sessionHealth.status === 'missing' || sessionHealth.status === 'corrupted') {
    console.log(`    ${pc.cyan('→')} ${pc.cyan('pto login')}    ${t('cli:start.action_login')}`);
    console.log(`    ${pc.cyan('→')} ${pc.cyan('pto setup')}    ${t('cli:start.action_setup')}`);
    console.log(`    ${pc.cyan('→')} ${pc.cyan('pto doctor')}   ${t('cli:start.action_doctor')}`);
  } else {
    console.log(`    ${pc.cyan('→')} ${pc.cyan('claude')}                              ${t('cli:start.action_open_claude')}`);
    console.log(`    ${pc.cyan('→')} ${pc.cyan('/PrimeteamOps:agents:ops-chief')}     ${t('cli:start.action_activate_chief')}`);
    console.log(`    ${pc.cyan('→')} ${pc.cyan('pto whoami')}                          ${t('cli:start.action_whoami')}`);
  }

  console.log('');
  console.log(pc.dim(`  ${t('cli:start.daily_hint', { cmd: pc.cyan('pto') })}`));
  console.log('');
}
