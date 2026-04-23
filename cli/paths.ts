import envPaths from 'env-paths';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const paths = envPaths('primeteam-ops', { suffix: '' });

// XDG config dir — preferências do usuário, state do setup, last-daily timestamp.
// Linux:   ~/.config/primeteam-ops/
// macOS:   ~/Library/Preferences/primeteam-ops/
// Windows: %APPDATA%\primeteam-ops\Config\
export const CONFIG_DIR = paths.config;
export const PREFERENCES_FILE = path.join(CONFIG_DIR, 'preferences.json');
export const STATE_FILE = path.join(CONFIG_DIR, 'state.json');

// Session continua em ~/.primeteam/ para compat com v1.1.0
// (quem já fez login não precisa relogar)
export const SESSION_DIR = path.join(os.homedir(), '.primeteam');
export const SESSION_FILE = path.join(SESSION_DIR, 'session.json');

export function ensureConfigDir(): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

// Descobre a raiz do clone do squad (onde está o package.json).
// Funciona tanto em dev (tsx cli/*.ts) quanto em prod (dist/*.js via npm link).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const content = JSON.parse(fs.readFileSync(pkg, 'utf-8'));
        if (content.name === 'primeteam-ops-cli') return dir;
      } catch {
        // próximo nível
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
