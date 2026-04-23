import ora from 'ora';
import pc from 'picocolors';
import { spawn } from 'node:child_process';
import {
  fetchRemote,
  countCommitsBehind,
  getRecentCommitMessages,
  hasUncommittedChanges,
  pullFastForward,
  getCurrentBranch,
  packageLockChanged,
  getHeadSha,
} from './git.js';
import { getRepoRoot } from './paths.js';

export interface UpdateOptions {
  dryRun?: boolean;
  silent?: boolean;
}

export interface UpdateResult {
  checked: boolean;
  pulled: boolean;
  depsReinstalled: boolean;
  commitsApplied: number;
  messages: string[];
  skippedReason?: string;
}

/**
 * Comando `pto update` — checa se o squad tem novas atualizações no remoto,
 * mostra os commits pendentes e (se autorizado) faz o pull + npm install se
 * package.json/lock mudou.
 *
 * Em modo silent (usado por `pto start`), só faz o fetch silencioso e retorna
 * o count de commits pendentes — o caller decide o que fazer.
 */
export async function update(options: UpdateOptions = {}): Promise<UpdateResult> {
  const { dryRun = false, silent = false } = options;
  const repoRoot = getRepoRoot();

  const branch = getCurrentBranch(repoRoot);
  const shaBefore = getHeadSha(repoRoot);
  const result: UpdateResult = {
    checked: false,
    pulled: false,
    depsReinstalled: false,
    commitsApplied: 0,
    messages: [],
  };

  if (!branch) {
    result.skippedReason = 'não é um repo git';
    if (!silent) console.error(`${pc.red('✗')} Este diretório não é um repositório git.`);
    return result;
  }

  if (branch !== 'main') {
    result.skippedReason = `em branch ${branch} (só atualiza no main)`;
    if (!silent) {
      console.log(
        `${pc.yellow('⚠')} Você está no branch ${pc.bold(branch)} — update pula por segurança.\n` +
          `  ${pc.cyan('→')} volte para main: ${pc.cyan('git checkout main')}`,
      );
    }
    return result;
  }

  if (hasUncommittedChanges(repoRoot)) {
    result.skippedReason = 'mudanças locais pendentes';
    if (!silent) {
      console.log(
        `${pc.yellow('⚠')} Você tem mudanças locais não commitadas — update pula por segurança.\n` +
          `  ${pc.cyan('→')} commite ou faça stash: ${pc.cyan('git status')}`,
      );
    }
    return result;
  }

  // Fetch do remoto
  const spinner = silent ? null : ora('Verificando atualizações do squad...').start();
  try {
    await fetchRemote('origin', { cwd: repoRoot, timeoutMs: 15_000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (spinner) spinner.fail(`Não consegui falar com o GitHub: ${pc.dim(msg)}`);
    result.skippedReason = 'falha no fetch';
    return result;
  }

  const behind = countCommitsBehind('main', 'origin', repoRoot);
  result.checked = true;

  if (behind === null || behind === 0) {
    if (spinner) spinner.succeed('Seu squad está em dia.');
    return result;
  }

  const messages = getRecentCommitMessages(
    'HEAD',
    `origin/main`,
    Math.min(behind, 10),
    repoRoot,
  );
  result.messages = messages;

  if (spinner) {
    spinner.succeed(
      `${pc.bold(String(behind))} atualizaç${behind === 1 ? 'ão' : 'ões'} disponível${
        behind === 1 ? '' : 'eis'
      }:`,
    );
  }

  if (!silent) {
    console.log('');
    for (const m of messages) {
      console.log(`  ${pc.dim('·')} ${m}`);
    }
    if (behind > messages.length) {
      console.log(`  ${pc.dim(`... e mais ${behind - messages.length}`)}`);
    }
    console.log('');
  }

  if (dryRun) {
    if (!silent) {
      console.log(
        `${pc.cyan('→')} Modo dry-run — rode ${pc.cyan('pto update')} sem --dry-run para aplicar.`,
      );
    }
    return result;
  }

  // Pull
  const pullSpin = silent ? null : ora('Aplicando atualizações...').start();
  try {
    await pullFastForward('origin', 'main', { cwd: repoRoot, timeoutMs: 60_000 });
    result.pulled = true;
    result.commitsApplied = behind;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (pullSpin) pullSpin.fail(`Pull falhou: ${pc.dim(msg)}`);
    return result;
  }

  if (pullSpin) pullSpin.succeed('Atualizações aplicadas.');

  // Se package.json/lock mudou, reinstala
  if (shaBefore && packageLockChanged(shaBefore, 'HEAD', repoRoot)) {
    const npmSpin = silent ? null : ora('Deps mudaram — reinstalando...').start();
    try {
      await runNpmInstall(repoRoot);
      result.depsReinstalled = true;
      if (npmSpin) npmSpin.succeed('Deps atualizadas.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (npmSpin)
        npmSpin.fail(
          `npm install falhou: ${pc.dim(msg)} — rode ${pc.cyan('npm install')} manualmente.`,
        );
    }
  }

  return result;
}

function runNpmInstall(cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['install', '--silent'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `npm install exited ${code}`));
    });
    child.on('error', reject);
  });
}
