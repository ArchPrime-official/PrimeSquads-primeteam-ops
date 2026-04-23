#!/usr/bin/env node
/**
 * postinstall hook — runs automatically after `npm install`.
 *
 * Written in plain Node ESM (no tsx / no deps) so it works BEFORE
 * devDependencies are guaranteed to resolve.
 *
 * Behavior:
 * - session file exists + valid → "ready" banner (shows logged email)
 * - session file exists + expired → "refresh needed" banner
 * - session file missing → "next step: npm run login" banner
 *
 * We do NOT auto-exec `npm run login` here because:
 * - CI/docker/nested installs are non-interactive (browser can't open)
 * - User might install without intent to log in yet
 *
 * Banner is a big, visible "next-step direction" right after npm install
 * completes. Addresses the "após instalação levar para login" feedback.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SESSION_FILE = path.join(os.homedir(), '.primeteam', 'session.json');

const BANNER_TOP = '\n╭───────────────────────────────────────────────────────────╮';
const BANNER_BOT = '╰───────────────────────────────────────────────────────────╯\n';

function padRight(text, width) {
  const len = text.length;
  return text + ' '.repeat(Math.max(0, width - len));
}

function loadSession() {
  if (!fs.existsSync(SESSION_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function isExpired(session) {
  if (!session || !session.expires_at) return true;
  return session.expires_at <= Math.floor(Date.now() / 1000);
}

function printNeedLogin() {
  console.log(BANNER_TOP);
  console.log('│ ' + padRight('👋 primeteam-ops instalado.', 58) + '│');
  console.log('│ ' + padRight('', 58) + '│');
  console.log('│ ' + padRight('Próximo passo — setup guiado:', 58) + '│');
  console.log('│ ' + padRight('', 58) + '│');
  console.log('│ ' + padRight('  npm run setup', 58) + '│');
  console.log('│ ' + padRight('', 58) + '│');
  console.log('│ ' + padRight('O wizard vai checar o ambiente, habilitar o', 58) + '│');
  console.log('│ ' + padRight('comando global `pto` e fazer seu login Google.', 58) + '│');
  console.log(BANNER_BOT);
}

function printExpired(session) {
  const expiredAt = new Date(session.expires_at * 1000).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
  console.log(BANNER_TOP);
  console.log('│ ' + padRight(`⚠ Sessão expirou em ${expiredAt}`, 58) + '│');
  console.log('│ ' + padRight('', 58) + '│');
  console.log('│ ' + padRight('Renove: npm run refresh', 58) + '│');
  console.log('│ ' + padRight('(ou: npm run login se o refresh falhar)', 58) + '│');
  console.log(BANNER_BOT);
}

function printReady(session) {
  const emailLine = `✓ Pronto. Logado como ${session.email}`;
  console.log(BANNER_TOP);
  console.log('│ ' + padRight(emailLine, 58) + '│');
  console.log('│ ' + padRight('', 58) + '│');
  console.log('│ ' + padRight('Rotina diária: npm start (ou `pto` se linkado)', 58) + '│');
  console.log('│ ' + padRight('Claude Code:   claude', 58) + '│');
  console.log('│ ' + padRight('Chief:         /PrimeteamOps:agents:ops-chief', 58) + '│');
  console.log(BANNER_BOT);
}

function printCorrupted() {
  console.log(BANNER_TOP);
  console.log('│ ' + padRight('⚠ Arquivo de sessão corrompido.', 58) + '│');
  console.log('│ ' + padRight('Rode `npm run login` para refazer o login.', 58) + '│');
  console.log(BANNER_BOT);
}

function main() {
  // Silenciar em contextos CI / non-TTY
  if (process.env.CI === 'true' || !process.stdout.isTTY) {
    return;
  }

  const rawExists = fs.existsSync(SESSION_FILE);
  if (!rawExists) {
    printNeedLogin();
    return;
  }

  const session = loadSession();
  if (!session) {
    printCorrupted();
    return;
  }

  if (isExpired(session)) {
    printExpired(session);
    return;
  }

  printReady(session);
}

try {
  main();
} catch {
  // Silencioso em caso de erro — não quebrar npm install
}
