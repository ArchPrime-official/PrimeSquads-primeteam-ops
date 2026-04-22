import path from 'node:path';
import os from 'node:os';

// Supabase config — estas credenciais são públicas por design (anon key).
// A anon key sozinha não dá acesso a nada — toda query passa pelas policies RLS.
// O JWT pessoal de cada usuário (~/.primeteam/session.json) é o que autoriza acesso.
export const SUPABASE_URL = 'https://xmqmuxwlecjbpubjdkoj.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhtcW11eHdsZWNqYnB1Ympka29qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNzQzNzAsImV4cCI6MjA4Nzk1MDM3MH0.fzHfYzJNeCUnG6DjoHYPPbUg3Q1paMPGaDruiDGe1MU';

// OAuth callback
export const CALLBACK_PORT = 54321;
export const CALLBACK_PATH = '/callback';
export const CALLBACK_URL = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;

// Session storage (per-user, chmod 600)
export const SESSION_DIR = path.join(os.homedir(), '.primeteam');
export const SESSION_FILE = path.join(SESSION_DIR, 'session.json');
