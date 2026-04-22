import http from 'node:http';
import { AddressInfo } from 'node:net';
import open from 'open';
import { CALLBACK_PATH, CALLBACK_PORT, CALLBACK_URL } from './config.js';
import { saveSession, StoredSession } from './session.js';
import { createPkceClient } from './supabase.js';

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos

const SUCCESS_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>primeteam-ops — login ok</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0F0F10; color: #F5F5F7; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { text-align: center; padding: 3rem; border: 1px solid rgba(201,153,92,0.3); border-radius: 12px; background: #141416; }
    h1 { color: #C9995C; margin: 0 0 1rem; font-size: 2rem; }
    p { margin: 0; opacity: 0.7; }
    .close { margin-top: 2rem; opacity: 0.5; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>✓ Login OK</h1>
    <p>Sessão gravada em <code>~/.primeteam/session.json</code></p>
    <p class="close">Pode fechar esta aba.</p>
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
    .card { text-align: center; padding: 3rem; border: 1px solid rgba(220,38,38,0.4); border-radius: 12px; background: #141416; }
    h1 { color: #DC2626; margin: 0 0 1rem; }
    pre { background: #000; padding: 1rem; border-radius: 6px; text-align: left; overflow-x: auto; }
  </style>
</head>
<body>
  <div class="card">
    <h1>✗ Erro no login</h1>
    <pre>${msg.replace(/</g, '&lt;')}</pre>
  </div>
</body>
</html>`;

export async function login(): Promise<void> {
  console.log('🔐 primeteam-ops login');

  const supabase = createPkceClient();

  // Prepara a URL de autorização do Google via Supabase OAuth
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: CALLBACK_URL,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data.url) {
    console.error('✗ Falha ao iniciar OAuth:', error?.message ?? 'URL ausente');
    process.exit(1);
  }

  // Servidor local para capturar o callback
  const code = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('timeout — login não concluído em 5 minutos'));
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
        reject(new Error(`OAuth error: ${oauthError} — ${errorDesc}`));
        return;
      }

      if (!receivedCode) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(ERROR_HTML('Callback sem parâmetro ?code='));
        clearTimeout(timeout);
        server.close();
        reject(new Error('Callback sem code'));
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
      const address = server.address() as AddressInfo;
      console.log(`   Aguardando callback em http://localhost:${address.port}${CALLBACK_PATH}`);
      console.log('   Abrindo navegador para login Google...');
      open(data.url).catch(() => {
        console.log('');
        console.log('   (não consegui abrir o navegador automaticamente)');
        console.log('   Abra esta URL manualmente:');
        console.log('   ' + data.url);
      });
    });
  });

  // Troca o code por session via PKCE
  const { data: sessionData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError || !sessionData.session) {
    console.error('✗ Falha ao trocar code por session:', exchangeError?.message ?? 'session ausente');
    process.exit(1);
  }

  const s = sessionData.session;
  if (!s.user.email) {
    console.error('✗ Session sem email do usuário');
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

  console.log('');
  console.log(`✓ Logado como ${stored.email}`);
  console.log(`   Session em ~/.primeteam/session.json (chmod 600)`);
  console.log('');
  console.log('Próximo: npm run whoami   # verificar role + permissões');
}
