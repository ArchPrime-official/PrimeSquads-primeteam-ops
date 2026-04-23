import http from 'node:http';
import { AddressInfo } from 'node:net';
import open from 'open';
import pc from 'picocolors';
import { CALLBACK_PATH, CALLBACK_PORT, CALLBACK_URL } from './config.js';
import { saveSession, StoredSession } from './session.js';
import { createPkceClient } from './supabase.js';
import { userError, userErrorByCode, classifyError, formatRelativeTime } from './ui.js';
import { t } from './i18n/index.js';

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos

function successHtml(): string {
  return `<!DOCTYPE html>
<html lang="${t('html:lang_attr')}">
<head>
  <meta charset="UTF-8">
  <title>${t('html:success.title')}</title>
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
    <h1>✓ ${t('html:success.heading')}</h1>
    <p>${t('html:success.body1')}</p>
    <p>${t('html:success.body2')}</p>
    <p class="hint">${t('html:success.hint')}</p>
  </div>
</body>
</html>`;
}

function errorHtml(msg: string): string {
  return `<!DOCTYPE html>
<html lang="${t('html:lang_attr')}">
<head>
  <meta charset="UTF-8">
  <title>${t('html:error.title')}</title>
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
    <h1>✗ ${t('html:error.heading')}</h1>
    <p>${t('html:error.body1')}</p>
    <p class="hint">${t('html:error.hint')}</p>
    <pre>${msg.replace(/</g, '&lt;')}</pre>
  </div>
</body>
</html>`;
}

export async function login(): Promise<void> {
  console.log(`${pc.yellow('🔐')} ${pc.bold(t('cli:login.title'))}`);
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
    const code = classifyError(error);
    if (code) {
      userErrorByCode(code, { detail: error?.message });
    } else {
      userError({
        title: t('errors:generic.title'),
        why: error?.message ?? t('errors:generic.why'),
        what: t('errors:callback_incomplete.what'),
      });
    }
    process.exit(1);
  }

  const code = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('timeout'));
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
        res.end(errorHtml(`${oauthError}: ${errorDesc ?? ''}`));
        clearTimeout(timeout);
        server.close();
        reject(new Error(`${oauthError} — ${errorDesc ?? ''}`));
        return;
      }

      if (!receivedCode) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(errorHtml('callback sem code'));
        clearTimeout(timeout);
        server.close();
        reject(new Error('callback sem code'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(successHtml());
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
      console.log(`  ${pc.cyan('→')} ${t('cli:login.opening_browser')}`);
      console.log(`  ${pc.dim(t('cli:login.opening_hint'))}`);
      console.log('');
      open(data.url).catch(() => {
        console.log(pc.yellow(`  ⚠ ${t('cli:login.could_not_open')}`));
        console.log(`  ${pc.cyan('→')} ${t('cli:login.open_manually')}`);
        console.log('  ' + data.url);
        console.log('');
      });
      console.log(pc.dim(`  ${t('cli:login.waiting')}`));
    });
  });

  const { data: sessionData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError || !sessionData.session) {
    const errCode = classifyError(exchangeError);
    if (errCode) {
      userErrorByCode(errCode, { detail: exchangeError?.message });
    } else {
      userError({
        title: t('errors:callback_incomplete.title'),
        why: exchangeError?.message ?? t('errors:callback_incomplete.why'),
        what: t('errors:callback_incomplete.what'),
      });
    }
    process.exit(1);
  }

  const s = sessionData.session;
  if (!s.user.email) {
    userError({
      title: t('errors:generic.title'),
      why: t('errors:generic.why'),
      what: t('errors:callback_incomplete.what'),
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
    `${pc.green('✓')} ${t('cli:login.welcome', { name })}`,
  );
  console.log(pc.dim(`  ${t('cli:login.expires', { when: formatRelativeTime(stored.expires_at) })}`));
  console.log('');
  console.log(`  ${pc.cyan('→')} ${t('cli:login.next_step', { cmd: pc.cyan('pto whoami') })}`);
  console.log('');
}
