/**
 * Auto-install do hook universal de Claude Code activity tracking.
 *
 * Idempotente: se ~/.claude/.archprime-config.json já existe, é no-op.
 * Caso contrário, dispara o installer em background (fire-and-forget),
 * usando email da session do `pto` (se disponível) ou git config global.
 *
 * NÃO bloqueia o caller — installer roda detached, output silencioso por
 * padrão. Falhas (rede, email não detectado, etc.) são silenciadas — não
 * devem quebrar o fluxo principal do `pto`.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execSync } from 'node:child_process';

const CONFIG_PATH = path.join(os.homedir(), '.claude', '.archprime-config.json');
const INSTALLER_URL =
  'https://raw.githubusercontent.com/ArchPrime-official/PrimeSquads-primeteam-ops/main/install-claude-tracking.sh';

export interface EnsureClaudeTrackingOptions {
  /** Suprimir output do installer. Default true (uso em start/postinstall). */
  silent?: boolean;
  /** Re-rodar mesmo se já instalado (útil pra refresh de path_regex). */
  forceRefresh?: boolean;
  /** Override do email. Senão tenta env, depois git config. */
  email?: string;
}

export interface EnsureClaudeTrackingResult {
  status: 'already_installed' | 'install_started' | 'skipped_no_email' | 'skipped_ci';
  email?: string;
}

/**
 * Garante que o tracking universal está instalado em ~/.claude/.
 *
 * Para uso em pto setup (com silent=false para feedback visível) e em
 * pto start / postinstall (silent=true).
 */
export function ensureClaudeTrackingInstalled(
  opts: EnsureClaudeTrackingOptions = {},
): EnsureClaudeTrackingResult {
  const { silent = true, forceRefresh = false, email } = opts;

  // Skip em ambientes não-interativos a menos que email seja explícito
  if (process.env.CI === 'true' && !email) {
    return { status: 'skipped_ci' };
  }

  if (!forceRefresh && fs.existsSync(CONFIG_PATH)) {
    return { status: 'already_installed' };
  }

  const resolvedEmail =
    email ||
    process.env.ARCHPRIME_EMAIL ||
    tryGitGlobalEmail() ||
    trySupabaseSessionEmail();

  if (!resolvedEmail) {
    return { status: 'skipped_no_email' };
  }

  const command = `curl -fsSL ${INSTALLER_URL} | ARCHPRIME_EMAIL='${resolvedEmail.replace(/'/g, "'\\''")}' bash`;

  const child = spawn('bash', ['-c', command], {
    detached: true,
    stdio: silent ? 'ignore' : 'inherit',
    env: { ...process.env, ARCHPRIME_EMAIL: resolvedEmail },
  });
  child.on('error', () => { /* silently ignore */ });
  child.unref();

  return { status: 'install_started', email: resolvedEmail };
}

function tryGitGlobalEmail(): string {
  try {
    const out = execSync('git config --global user.email', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim();
  } catch {
    return '';
  }
}

function trySupabaseSessionEmail(): string {
  // Reads pto's own session file (~/.primeteam/session.json) saved post-login
  // to extract the company email without prompting.
  try {
    const sessionPath = path.join(os.homedir(), '.primeteam', 'session.json');
    if (!fs.existsSync(sessionPath)) return '';
    const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    return (session?.email || '').toString().trim();
  } catch {
    return '';
  }
}
