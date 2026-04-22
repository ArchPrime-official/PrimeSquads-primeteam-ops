#!/usr/bin/env node
import { login } from './login.js';
import { whoami } from './whoami.js';
import { logout } from './logout.js';

const USAGE = `primeteam-ops — CLI de autenticação do squad

Uso:
  npm run login     # Login Google OAuth (abre navegador)
  npm run whoami    # Mostra user + roles + expiração
  npm run logout    # Remove session local

Flow:
  1. login abre servidor local em http://localhost:54321/callback
  2. Navegador abre com Google OAuth (via Supabase)
  3. Você faz login com @archprime.io
  4. JWT salvo em ~/.primeteam/session.json (chmod 600, gitignored)
  5. Use whoami pra confirmar role

Logs: operações ficam em ~/.primeteam/session.json localmente, não saem da sua máquina.`;

async function main(): Promise<void> {
  const cmd = process.argv[2];

  try {
    switch (cmd) {
      case 'login':
        await login();
        break;
      case 'whoami':
        await whoami();
        break;
      case 'logout':
        await logout();
        break;
      case '--help':
      case '-h':
      case undefined:
        console.log(USAGE);
        break;
      default:
        console.error(`✗ Comando desconhecido: ${cmd}`);
        console.error('');
        console.error(USAGE);
        process.exit(1);
    }
  } catch (err) {
    console.error('✗ Erro:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
