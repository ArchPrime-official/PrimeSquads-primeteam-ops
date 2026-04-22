import fs from 'node:fs';
import { SESSION_DIR, SESSION_FILE } from './config.js';

export interface StoredSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user_id: string;
  email: string;
}

export function loadSession(): StoredSession | null {
  if (!fs.existsSync(SESSION_FILE)) return null;
  try {
    const raw = fs.readFileSync(SESSION_FILE, 'utf-8');
    return JSON.parse(raw) as StoredSession;
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
  // expires_at is a UNIX timestamp in seconds
  const nowSec = Math.floor(Date.now() / 1000);
  return session.expires_at <= nowSec;
}
