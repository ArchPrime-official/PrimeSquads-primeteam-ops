import http from 'node:http';
import { AddressInfo } from 'node:net';
import open from 'open';
import pc from 'picocolors';
import { CALLBACK_PATH, CALLBACK_PORT, CALLBACK_URL } from './config.js';
import { saveSession, StoredSession } from './session.js';
import { createPkceClient } from './supabase.js';
import { userError, translateError, formatRelativeTime } from './ui.js';

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos

const SUCCESS_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>primeteam-ops</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0F0F10; color: #F5F5F7; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { text-align: center; padding: 3rem; border: 1px solid rgba(201,153,92,0.3); border-radius: 12px; background: #141416; max-width: 420px; }
    h1 { color: #C9995C; margin: 0 0 1rem; font-size: 2rem; }
    p { margin: 0.25rem 0; opacity: 0.85; line-height: 1.5; }
    .hint { margin-top: 2rem; opacity: 0.5; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>✓ Tudo certo</h1>
    <p>Você está logada/o na plataforma PrimeTeam.</p>
    <p>Seu acesso está guardado com segurança neste computador.</p>
    <p class="hint">Pode fechar esta aba e voltar para o terminal.</p>
  </div>
</body>
</html>`;

const ERROR_HTML = (msg: string) => `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>primeteam-ops — erro</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0F0F10; color: #F5F5F7; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { text-align: center; padding: 3rem; border: 1px solid rgba(220,38,38,0.4); border-radius: 12px; background: #141416; max-width: 480px; }
    h1 { color: #DC2626; margin: 0 0 1rem; }
    p { margin: 0.25rem 0; opacity: 0.85; line-height: 1.5; }
    .hint { margin-top: 1.5rem; opacity: 0.6; font-size: 0.875rem; }
    pre { background: #000; padding: 1rem; border-radius: 6px; text-align: left; overflow-x: auto; font-size: 0.8rem; opacity: 0.7; }
  </style>
</head>
<body>
  <div class="card">
    <h1>✗ O login não completou</h1>
    <p>Volte para o terminal e rode <code>pto login</code> de novo.</p>
    <p class="hint">Se continuar sem funcionar, avise o Pablo.</p>
    <pre>${msg.replace(/</g, '&lt;')}</pre>
  </div>
</body>
</html>`;

export async function login(): Promise<void> {
  console.log(`${pc.yellow('🔐')} ${pc.bold('Entrar na plataforma PrimeTeam')}`);
  console.log('');

  const supabase = createPkceClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: CALLBACK_URL,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data.url) {
    const translated = translateError(error) ?? {
      title: 'não consegui começar o login',
      why: error?.message ?? 'erro desconhecido',
      what: 'tente de novo em 1 minuto',
    };
    userError(translated);
    process.exit(1);
  }

  const code = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('timeout — login não completou em 5 minutos'));
    }, LOGIN_TIMEOUT_MS);

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const receivedCode = url.searchParams.get('code');
      const oauthError = url.searchParams.get('error');
      const errorDesc = url.searchParams.get('error_description');

      if (oauthError) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(ERROR_HTML(`${oauthError}: ${errorDesc ?? ''}`));
        clearTimeout(timeout);
        server.close();
        reject(new Error(`${oauthError} — ${errorDesc ?? ''}`));
        return;
      }

      if (!receivedCode) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(ERROR_HTML('o navegador voltou sem o código de autorização'));
        clearTimeout(timeout);
        server.close();
        reject(new Error('callback sem code'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(SUCCESS_HTML);
      clearTimeout(timeout);
      server.close();
      resolve(receivedCode);
    });

    server.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    server.listen(CALLBACK_PORT, '127.0.0.1', () => {
      server.address() as AddressInfo;
      console.log(
        `  ${pc.cyan('→')} Vou abrir seu navegador para você entrar com ${pc.bold('@archprime.io')}.`,
      );
      console.log(`  ${pc.dim('(se não abrir, eu te mostro o link pra colar à mão)')}`);
      console.log('');
      open(data.url).catch(() => {
        console.log(pc.yellow('  ⚠ Não consegui abrir o navegador automaticamente.'));
        console.log(`  ${pc.cyan('→')} Abra este link manualmente:`);
        console.log('  ' + data.url);
        console.log('');
      });
      console.log(pc.dim('  Esperando você autorizar... (até 5 minutos)'));
    });
  });

  const { data: sessionData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError || !sessionData.session) {
    const translated = translateError(exchangeError) ?? {
      title: 'o login não completou',
      why: exchangeError?.message ?? 'erro desconhecido',
      what: 'rode: pto login de novo',
    };
    userError(translated);
    process.exit(1);
  }

  const s = sessionData.session;
  if (!s.user.email) {
    userError({
      title: 'não recebi seu email do Google',
      why: 'resposta inesperada do servidor',
      what: 'tente de novo: pto login',
    });
    process.exit(1);
  }

  const stored: StoredSession = {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    user_id: s.user.id,
    email: s.user.email,
  };

  saveSession(stored);

  const name = stored.email.split('@')[0];
  console.log('');
  console.log(
    `${pc.green('✓')} Bem-vinda/o, ${pc.bold(name)} — acesso guardado com segurança neste computador.`,
  );
  console.log(pc.dim(`  (expira ${formatRelativeTime(stored.expires_at)})`));
  console.log('');
  console.log(`  ${pc.cyan('→')} Próximo: rode ${pc.cyan('pto whoami')} para ver seus papéis.`);
  console.log('');
}
