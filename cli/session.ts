import fs from 'node:fs';
import { SESSION_DIR, SESSION_FILE } from './paths.js';
import { createAuthenticatedClient, createRefreshClient } from './supabase.js';

// Também re-exporta os paths para compat com imports antigos (se houver).
export { SESSION_DIR, SESSION_FILE };

export interface StoredSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user_id: string;
  email: string;
  roles?: string[];
}

/**
 * Busca as roles do usuário em `user_roles` usando o JWT atual.
 * Retorna `null` se a query falhou (login/refresh continuam — degradação
 * graciosa). Retorna `[]` se o usuário não tem nenhuma role atribuída.
 */
export async function fetchUserRoles(
  accessToken: string,
  refreshToken: string,
  userId: string,
): Promise<string[] | null> {
  try {
    const sb = createAuthenticatedClient(accessToken, refreshToken);
    const { data, error } = await sb
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);
    if (error) return null;
    return (data ?? []).map((r) => r.role as string).sort();
  } catch {
    return null;
  }
}

export type SessionHealth =
  | { status: 'valid'; session: StoredSession; expiresInSec: number }
  | { status: 'expiring'; session: StoredSession; expiresInSec: number }
  | { status: 'expired'; session: StoredSession; expiredSinceSec: number }
  | { status: 'missing' }
  | { status: 'corrupted' };

// Limite abaixo do qual consideramos que vale refrescar preventivamente.
// 1h default — nosso JWT Supabase dura 1h por padrão, então iniciamos o refresh
// se sobrou menos de 10min (ou se o caller passar um limiar maior).
export const DEFAULT_EXPIRING_WINDOW_SEC = 10 * 60;

export function loadSession(): StoredSession | null {
  if (!fs.existsSync(SESSION_FILE)) return null;
  try {
    const raw = fs.readFileSync(SESSION_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as StoredSession;
    if (
      typeof parsed.access_token !== 'string' ||
      typeof parsed.refresh_token !== 'string' ||
      typeof parsed.expires_at !== 'number' ||
      typeof parsed.email !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession): void {
  fs.mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), { mode: 0o600 });
}

export function clearSession(): void {
  if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
}

export function isExpired(session: StoredSession): boolean {
  const nowSec = Math.floor(Date.now() / 1000);
  return session.expires_at <= nowSec;
}

export function isExpiringSoon(
  session: StoredSession,
  windowSec = DEFAULT_EXPIRING_WINDOW_SEC,
): boolean {
  const nowSec = Math.floor(Date.now() / 1000);
  return session.expires_at - nowSec < windowSec;
}

/**
 * Diagnóstico estruturado — usado por doctor, start, whoami.
 * Detecta session file ausente, corrompido, expirado ou prestes a expirar.
 */
export function readSessionHealth(
  expiringWindowSec = DEFAULT_EXPIRING_WINDOW_SEC,
): SessionHealth {
  if (!fs.existsSync(SESSION_FILE)) return { status: 'missing' };
  const session = loadSession();
  if (!session) return { status: 'corrupted' };

  const nowSec = Math.floor(Date.now() / 1000);
  const deltaSec = session.expires_at - nowSec;

  if (deltaSec <= 0) {
    return { status: 'expired', session, expiredSinceSec: -deltaSec };
  }
  if (deltaSec < expiringWindowSec) {
    return { status: 'expiring', session, expiresInSec: deltaSec };
  }
  return { status: 'valid', session, expiresInSec: deltaSec };
}

/**
 * Troca o refresh_token por um novo access_token + refresh_token,
 * grava em disco e devolve a session atualizada. Usado manualmente
 * por `pto refresh` e automaticamente por `pto start` quando a session
 * está próxima de expirar.
 */
export async function refreshStoredSession(): Promise<StoredSession> {
  const current = loadSession();
  if (!current) {
    throw new Error('session ausente — rode `pto login` antes de refresh');
  }

  const client = createRefreshClient();
  const { data, error } = await client.auth.refreshSession({
    refresh_token: current.refresh_token,
  });

  if (error) {
    const msg = error.message || 'erro desconhecido';
    // Refresh token revogado / expirado → limpa e manda relogar.
    if (
      msg.toLowerCase().includes('invalid') ||
      msg.toLowerCase().includes('refresh') ||
      msg.toLowerCase().includes('expired')
    ) {
      throw new Error(
        'refresh_token inválido ou revogado — rode `pto login` para entrar de novo',
      );
    }
    throw new Error(`falha ao refrescar session: ${msg}`);
  }

  const s = data.session;
  if (!s || !s.user.email) {
    throw new Error('Supabase devolveu session inválida no refresh');
  }

  const fresh: StoredSession = {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    user_id: s.user.id,
    email: s.user.email,
  };

  const roles = await fetchUserRoles(fresh.access_token, fresh.refresh_token, fresh.user_id);
  if (roles !== null) fresh.roles = roles;

  saveSession(fresh);
  return fresh;
}

/**
 * Se a session está prestes a expirar dentro da janela dada, refresca
 * silenciosamente. Retorna `{ refreshed: true }` se refrescou,
 * `{ refreshed: false }` se não precisou ou se falhou (erro propagado só
 * se caller passar `throwOnError: true`).
 */
export async function maybeRefresh(
  windowSec = DEFAULT_EXPIRING_WINDOW_SEC,
  options: { throwOnError?: boolean } = {},
): Promise<{ refreshed: boolean; session: StoredSession | null; error?: string }> {
  const health = readSessionHealth(windowSec);
  if (health.status !== 'expiring' && health.status !== 'expired') {
    return {
      refreshed: false,
      session: health.status === 'valid' ? health.session : null,
    };
  }
  try {
    const fresh = await refreshStoredSession();
    return { refreshed: true, session: fresh };
  } catch (err) {
    if (options.throwOnError) throw err;
    return {
      refreshed: false,
      session: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
