/**
 * Auto-update do hook universal `~/.claude/hooks/log-claude-activity.cjs`.
 *
 * Cobre o gap onde usuários EXISTENTES (que já rodaram setup uma vez)
 * ficavam com hook antigo indefinidamente — `ensureClaudeTrackingInstalled`
 * só roda na primeira vez.
 *
 * Estratégia:
 *  - Lê versão local via marker `// @hook-version X.Y.Z` no topo do arquivo
 *  - GET HTTPS do raw URL com timeout 1500ms (fail-soft em rede ruim)
 *  - Compara semver — se remoto > local, sobrescreve atomicamente
 *  - Permission preservada (0o755 para ser executável pelo Claude Code)
 *  - Throttle: max 1 check por dia (state em ~/.primeteam/hook-update-state.json)
 *  - Silent total — never blocks, never prompts
 *
 * Chamado de `cli/start.ts` (silent, fire-and-forget).
 *
 * Added: 2026-05-14 (B.FOLLOWUP — closing wiring gap pra usuários existentes)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { SESSION_DIR } from './paths.js';

const LOCAL_HOOK_PATH = path.join(os.homedir(), '.claude', 'hooks', 'log-claude-activity.cjs');
const REMOTE_HOOK_URL =
  'https://raw.githubusercontent.com/ArchPrime-official/PrimeSquads-primeteam-ops/main/hooks/log-claude-activity.cjs';
const STATE_PATH = path.join(SESSION_DIR, 'hook-update-state.json');
const REQUEST_TIMEOUT_MS = 1500;
const MIN_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const VERSION_MARKER = /^\/\/\s*@hook-version\s+(\d+\.\d+\.\d+)/m;

interface UpdaterState {
  last_check_at: string;
  last_local_version: string | null;
  last_remote_version: string | null;
  last_action: 'no_op' | 'updated' | 'skipped_no_local' | 'skipped_network';
}

interface EnsureHookOptions {
  /** Force update mesmo se cache diz que checou recentemente. Default false. */
  force?: boolean;
  /** Silent total (sem console output). Default true (chamado de start). */
  silent?: boolean;
}

interface EnsureHookResult {
  status: 'no_op' | 'updated' | 'skipped_throttled' | 'skipped_no_local' |
          'skipped_network' | 'skipped_invalid_remote' | 'skipped_no_marker';
  localVersion?: string | null;
  remoteVersion?: string | null;
}

function readState(): UpdaterState | null {
  if (!fs.existsSync(STATE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function writeState(state: UpdaterState): void {
  try {
    fs.mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });
  } catch {
    /* ignore */
  }
}

function extractVersion(content: string): string | null {
  const m = content.match(VERSION_MARKER);
  return m ? m[1] : null;
}

/** Compara semver "1.2.3" vs "1.2.4" — retorna -1 / 0 / 1. */
function semverCompare(a: string, b: string): number {
  const aP = a.split('.').map((x) => parseInt(x, 10));
  const bP = b.split('.').map((x) => parseInt(x, 10));
  for (let i = 0; i < Math.max(aP.length, bP.length); i++) {
    const ai = aP[i] ?? 0;
    const bi = bP[i] ?? 0;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }
  return 0;
}

function fetchRemote(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return resolve(null);
    }

    // Cache-bust query string — Fastly raw.githubusercontent.com mantém cache
    // por PoP até 5min, mas check de versão pra desbloquear bugs precisa
    // ser fresh. Custo: ~150ms a mais quando PoP precisa repuxar do origem.
    // Aceitavel dado que o updater roda 1x/dia.
    const cacheBuster = `${parsed.search ? '&' : '?'}_=${Date.now()}`;

    const req = https.request(
      {
        method: 'GET',
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search + cacheBuster,
        port: parsed.port || 443,
        headers: {
          'User-Agent': 'pto-hook-updater/1.0',
          Accept: 'text/plain',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(null);
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          // Hard cap em 256KB pra evitar abuse
          if (body.length > 256 * 1024) {
            req.destroy();
            resolve(null);
          }
        });
        res.on('end', () => resolve(body));
        res.on('error', () => resolve(null));
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

/**
 * Sobrescreve atomicamente: write to .tmp, rename. Garante que o hook
 * nunca fica num estado parcialmente escrito (Claude Code podia ler
 * arquivo truncado durante a escrita).
 */
function atomicWrite(target: string, content: string): boolean {
  const tmp = `${target}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, content, { mode: 0o755 });
    fs.renameSync(tmp, target);
    return true;
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    return false;
  }
}

export async function ensureHookUpToDate(
  opts: EnsureHookOptions = {},
): Promise<EnsureHookResult> {
  const { force = false, silent = true } = opts;
  const log = silent ? () => {} : (msg: string) => console.log(msg);

  // Hook local nem instalado — `ensureClaudeTrackingInstalled` cuida do
  // primeiro setup; updater só age sobre hooks já existentes.
  if (!fs.existsSync(LOCAL_HOOK_PATH)) {
    return { status: 'skipped_no_local' };
  }

  // Throttle: 24h desde última check (mesmo que tenha falhado)
  if (!force) {
    const state = readState();
    if (state?.last_check_at) {
      const since = Date.now() - new Date(state.last_check_at).getTime();
      if (Number.isFinite(since) && since < MIN_CHECK_INTERVAL_MS) {
        return {
          status: 'skipped_throttled',
          localVersion: state.last_local_version,
          remoteVersion: state.last_remote_version,
        };
      }
    }
  }

  // Lê versão local
  let localContent: string;
  try {
    localContent = fs.readFileSync(LOCAL_HOOK_PATH, 'utf-8');
  } catch {
    return { status: 'skipped_no_local' };
  }
  const localVersion = extractVersion(localContent);
  if (!localVersion) {
    // Hook pre-versionado (sem marker @hook-version). Faz UPDATE incondicional —
    // o objetivo do feature é exatamente cobrir esse cenário (usuários antigos).
    log('  (hook local sem marker — buscando latest)');
  }

  // Fetch remoto
  const remoteContent = await fetchRemote(REMOTE_HOOK_URL);
  if (!remoteContent) {
    writeState({
      last_check_at: new Date().toISOString(),
      last_local_version: localVersion,
      last_remote_version: null,
      last_action: 'skipped_network',
    });
    return { status: 'skipped_network', localVersion };
  }

  const remoteVersion = extractVersion(remoteContent);
  if (!remoteVersion) {
    // Remoto sem marker — algo estranho, não confia
    writeState({
      last_check_at: new Date().toISOString(),
      last_local_version: localVersion,
      last_remote_version: null,
      last_action: 'no_op',
    });
    return { status: 'skipped_invalid_remote', localVersion };
  }

  // Decisão de update
  let shouldUpdate = false;
  if (!localVersion) {
    // Local sem marker = "hook antigo pre-versioning" → atualiza incondicionalmente
    shouldUpdate = true;
  } else if (semverCompare(remoteVersion, localVersion) > 0) {
    shouldUpdate = true;
  }

  if (!shouldUpdate) {
    writeState({
      last_check_at: new Date().toISOString(),
      last_local_version: localVersion,
      last_remote_version: remoteVersion,
      last_action: 'no_op',
    });
    return { status: 'no_op', localVersion, remoteVersion };
  }

  // Sanity check: remoto deve ser .cjs válido (começa com #!/usr/bin/env node ou similar)
  if (!remoteContent.startsWith('#!') && !remoteContent.startsWith('//')) {
    writeState({
      last_check_at: new Date().toISOString(),
      last_local_version: localVersion,
      last_remote_version: remoteVersion,
      last_action: 'no_op',
    });
    return { status: 'skipped_invalid_remote', localVersion, remoteVersion };
  }

  // Atomic write
  const ok = atomicWrite(LOCAL_HOOK_PATH, remoteContent);
  writeState({
    last_check_at: new Date().toISOString(),
    last_local_version: ok ? remoteVersion : localVersion,
    last_remote_version: remoteVersion,
    last_action: ok ? 'updated' : 'no_op',
  });

  log(`  ✓ hook atualizado: ${localVersion ?? '(sem versão)'} → ${remoteVersion}`);
  return {
    status: ok ? 'updated' : 'no_op',
    localVersion: ok ? remoteVersion : localVersion,
    remoteVersion,
  };
}

/**
 * Versão fire-and-forget para chamar de `pto start`.
 * Nunca lança, nunca bloqueia, nunca printa.
 */
export function ensureHookUpToDateInBackground(): void {
  ensureHookUpToDate({ silent: true }).catch(() => {
    /* swallow — never break pto */
  });
}
