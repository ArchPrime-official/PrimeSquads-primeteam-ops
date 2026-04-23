import pc from 'picocolors';
import boxen from 'boxen';
import { t, currentLocale } from './i18n/index.js';

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

/**
 * Template canônico de mensagem de erro para humanos:
 *   sintoma em 1 linha (title)
 *   Porque: causa em 1 linha (sem jargão)
 *   Faça:   ação concreta (comando ou pessoa a contatar)
 */
export function userError(params: {
  title: string;
  why: string;
  what: string;
  detail?: string;
}): void {
  const { title, why, what, detail } = params;
  console.error(`\n${pc.red('✗')} ${title}`);
  console.error('');
  console.error(`  ${pc.dim(t('errors:labels.why'))} ${why}`);
  console.error(`  ${pc.dim(t('errors:labels.what'))}  ${what}`);
  if (detail && process.env.PTO_DEBUG === '1') {
    console.error('');
    console.error(pc.dim(`  ${t('errors:labels.detail')} ${detail}`));
  }
  console.error('');
}

/**
 * Emite um erro humano resolvendo as chaves via i18n.
 * Mais direto que userError() quando você já tem o código do erro.
 */
export function userErrorByCode(
  code: string,
  options: { detail?: string; whatOverride?: string } = {},
): void {
  const title = t(`errors:${code}.title`);
  const why = t(`errors:${code}.why`);
  const what = options.whatOverride ?? t(`errors:${code}.what`);
  userError({ title, why, what, detail: options.detail });
}

/**
 * Classifica um erro técnico em um código conhecido (chave no namespace errors).
 * Retorna null se não reconhecer — o caller decide o fallback.
 */
export function classifyError(err: unknown): string | null {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  const lower = raw.toLowerCase();

  if (code === 'ENOTFOUND' || lower.includes('enotfound')) return 'host_not_found';
  if (
    code === 'ECONNREFUSED' ||
    lower.includes('econnrefused') ||
    lower.includes('fetch failed')
  ) {
    return 'network_offline';
  }
  if (code === 'ETIMEDOUT' || lower.includes('etimedout') || lower.includes('timeout')) {
    return 'timeout';
  }
  if (
    code === 'EADDRINUSE' ||
    lower.includes('eaddrinuse') ||
    lower.includes('address already in use')
  ) {
    return 'port_busy';
  }
  if (code === 'EACCES' || lower.includes('eacces') || lower.includes('permission denied')) {
    return 'no_permission_fs';
  }
  if (
    lower.includes('state mismatch') ||
    lower.includes('invalid state') ||
    lower.includes('state_mismatch')
  ) {
    return 'oauth_state_mismatch';
  }
  if (
    lower.includes('refresh') &&
    (lower.includes('invalid') || lower.includes('revoked') || lower.includes('expired'))
  ) {
    return 'refresh_invalid';
  }
  if (raw.includes('401') || lower.includes('unauthorized') || lower.includes('jwt expired')) {
    return 'session_expired';
  }
  if (raw.includes('403') || lower.includes('forbidden') || lower.includes('42501')) {
    return 'forbidden';
  }
  if (raw.includes('500') || lower.includes('internal server error')) {
    return 'server_error';
  }
  if (lower.includes('pkce')) return 'pkce_failed';
  if (lower.includes('callback sem code') || lower.includes('callback')) {
    return 'callback_incomplete';
  }
  return null;
}

/**
 * Trata um erro desconhecido: se for classificável, usa userErrorByCode.
 * Senão, imprime uma mensagem genérica com o detalhe técnico em debug.
 */
export function handleError(err: unknown, fallbackWhat?: string): void {
  const code = classifyError(err);
  const raw = err instanceof Error ? err.message : String(err);
  if (code) {
    userErrorByCode(code, { detail: raw, whatOverride: fallbackWhat });
    return;
  }
  userError({
    title: t('errors:generic.title'),
    why: t('errors:generic.why'),
    what: fallbackWhat ?? t('cli:doctor.failure_hint'),
    detail: raw,
  });
}

export function formatRelativeTime(unixSec: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = unixSec - now;
  const rtf = new Intl.RelativeTimeFormat(currentLocale(), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(diff, 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export function formatDateTime(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}
