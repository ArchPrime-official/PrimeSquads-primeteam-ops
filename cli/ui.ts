import pc from 'picocolors';
import boxen from 'boxen';

export const c = pc;

export const icon = {
  ok: pc.green('✓'),
  fail: pc.red('✗'),
  warn: pc.yellow('⚠'),
  info: pc.blue('ℹ'),
  arrow: pc.cyan('→'),
  bullet: pc.dim('•'),
  spark: pc.yellow('✨'),
};

export function success(msg: string): void {
  console.log(`${icon.ok} ${msg}`);
}

export function fail(msg: string): void {
  console.error(`${icon.fail} ${msg}`);
}

export function warn(msg: string): void {
  console.warn(`${icon.warn} ${msg}`);
}

export function info(msg: string): void {
  console.log(`${icon.info} ${msg}`);
}

export function hint(msg: string): void {
  console.log(`  ${icon.arrow} ${msg}`);
}

export function heading(text: string): void {
  console.log('\n' + pc.bold(pc.yellow(text)));
  console.log(pc.dim('─'.repeat(Math.min(text.length + 4, 60))));
}

export function welcomeBox(title: string, body: string): string {
  return boxen(body, {
    padding: 1,
    margin: { top: 1, bottom: 1, left: 0, right: 0 },
    borderStyle: 'round',
    borderColor: 'yellow',
    title,
    titleAlignment: 'center',
  });
}

export function updateBox(current: string, latest: string, cmd: string): string {
  return boxen(
    `${pc.bold('Nova versão do squad disponível')}\n\n` +
      `${pc.dim('sua versão:')} ${current}\n` +
      `${pc.dim('nova versão:')} ${pc.green(latest)}\n\n` +
      `Atualize com: ${pc.cyan(cmd)}`,
    {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'yellow',
      textAlignment: 'left',
    },
  );
}

export function errorBox(title: string, why: string, what: string): string {
  return boxen(
    `${pc.red(pc.bold(title))}\n\n` +
      `${pc.dim('Porque:')} ${why}\n` +
      `${pc.dim('Faça: ')}  ${what}`,
    {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'red',
      textAlignment: 'left',
    },
  );
}

export function formatRelativeTime(unixSec: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = unixSec - now;
  if (diff < 0) {
    const past = -diff;
    if (past < 60) return `há ${past}s`;
    if (past < 3600) return `há ${Math.floor(past / 60)}min`;
    if (past < 86400) return `há ${Math.floor(past / 3600)}h`;
    return `há ${Math.floor(past / 86400)}d`;
  }
  if (diff < 60) return `em ${diff}s`;
  if (diff < 3600) return `em ${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `em ${Math.floor(diff / 3600)}h`;
  return `em ${Math.floor(diff / 86400)}d`;
}

export function formatDateTime(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}
