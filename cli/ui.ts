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

/**
 * Template canônico de mensagem de erro para humanos:
 *   sintoma em 1 linha (title)
 *   Porque: causa em 1 linha (sem jargão)
 *   Faça:   ação concreta (comando ou pessoa a contatar)
 *
 * Printa direto em stderr. Retorna o exit code sugerido pelo caller.
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
  console.error(`  ${pc.dim('Porque:')} ${why}`);
  console.error(`  ${pc.dim('Faça: ')}  ${what}`);
  if (detail && process.env.PTO_DEBUG === '1') {
    console.error('');
    console.error(pc.dim(`  Detalhe técnico: ${detail}`));
  }
  console.error('');
}

export interface HumanizedError {
  title: string;
  why: string;
  what: string;
  detail?: string;
}

/**
 * Traduz erros técnicos comuns (Supabase, OAuth, rede, filesystem) em
 * mensagens humanas no formato { title, why, what }.
 *
 * Se nenhum padrão bater, retorna null — o caller decide o fallback.
 */
export function translateError(err: unknown): HumanizedError | null {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  const lower = raw.toLowerCase();

  // Rede — conexão
  if (code === 'ENOTFOUND' || lower.includes('enotfound')) {
    return {
      title: 'não consegui falar com o servidor',
      why: 'sua internet caiu ou o servidor está fora do ar',
      what: 'verifique sua conexão e tente de novo em 1 minuto',
      detail: raw,
    };
  }
  if (
    code === 'ECONNREFUSED' ||
    lower.includes('econnrefused') ||
    lower.includes('fetch failed')
  ) {
    return {
      title: 'não consegui me conectar',
      why: 'o servidor não respondeu',
      what: 'verifique sua internet. Se persistir, avise o Pablo',
      detail: raw,
    };
  }
  if (code === 'ETIMEDOUT' || lower.includes('etimedout') || lower.includes('timeout')) {
    return {
      title: 'a operação demorou demais',
      why: 'a internet está lenta ou o servidor travou',
      what: 'tente de novo em 1 minuto',
      detail: raw,
    };
  }

  // Porta ocupada (login OAuth)
  if (code === 'EADDRINUSE' || lower.includes('eaddrinuse') || lower.includes('address already in use')) {
    return {
      title: 'a porta de login está ocupada',
      why: 'outro programa (ou outra aba do pto) está usando a porta 54321',
      what: 'feche outras janelas do pto e tente de novo',
      detail: raw,
    };
  }

  // Permissões filesystem
  if (code === 'EACCES' || lower.includes('eacces') || lower.includes('permission denied')) {
    return {
      title: 'sem permissão para este arquivo',
      why: 'o sistema bloqueou a operação',
      what: 'tente rodar de novo como admin (sudo) ou avise o Pablo',
      detail: raw,
    };
  }

  // OAuth / Supabase
  if (
    lower.includes('state mismatch') ||
    lower.includes('invalid state') ||
    lower.includes('state_mismatch')
  ) {
    return {
      title: 'o login no navegador não completou a tempo',
      why: 'a página ficou aberta demais, ou foi aberta em mais de uma aba',
      what: 'feche todas as abas de login e rode: pto login',
      detail: raw,
    };
  }
  if (lower.includes('refresh') && (lower.includes('invalid') || lower.includes('revoked') || lower.includes('expired'))) {
    return {
      title: 'seu acesso precisa ser renovado',
      why: 'sua permissão de renovação expirou ou você saiu de outro lugar',
      what: 'rode: pto login (leva 30 segundos)',
      detail: raw,
    };
  }
  if (
    raw.includes('401') ||
    lower.includes('unauthorized') ||
    lower.includes('jwt expired')
  ) {
    return {
      title: 'sua sessão expirou',
      why: 'acontece depois de algumas horas — segurança padrão',
      what: 'rode: pto refresh (ou pto login se refresh falhar)',
      detail: raw,
    };
  }
  if (raw.includes('403') || lower.includes('forbidden') || lower.includes('42501')) {
    return {
      title: 'você não tem permissão para isso',
      why: 'essa área é restrita ao seu papel no time',
      what: 'se acha que deveria ter acesso, fale com o Pablo',
      detail: raw,
    };
  }
  if (raw.includes('500') || lower.includes('internal server error')) {
    return {
      title: 'problema no nosso servidor',
      why: 'algo deu errado do lado do Supabase',
      what: 'tente de novo em 1 minuto. Se persistir, avise o Pablo',
      detail: raw,
    };
  }

  // PKCE / callback — traduções específicas
  if (lower.includes('pkce')) {
    return {
      title: 'o login foi interrompido',
      why: 'começou em outro terminal ou foi cancelado no navegador',
      what: 'rode: pto login',
      detail: raw,
    };
  }
  if (lower.includes('callback sem code') || lower.includes('callback')) {
    return {
      title: 'o navegador voltou sem completar o login',
      why: 'você pode ter fechado a aba antes de autorizar',
      what: 'rode: pto login e complete a autorização',
      detail: raw,
    };
  }

  return null;
}

/**
 * Trata um erro desconhecido: se for traduzível, usa userError().
 * Senão, imprime uma mensagem genérica + hint para ver o detalhe técnico.
 */
export function handleError(err: unknown, fallbackWhat = 'tente de novo ou rode pto doctor'): void {
  const translated = translateError(err);
  if (translated) {
    userError(translated);
    return;
  }
  const raw = err instanceof Error ? err.message : String(err);
  userError({
    title: 'algo deu errado',
    why: 'erro inesperado',
    what: fallbackWhat,
    detail: raw,
  });
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
