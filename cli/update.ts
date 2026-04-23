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
    result.skippedReason = 'esta pasta não é um clone do squad';
    if (!silent)
      console.error(`${pc.red('✗')} Esta pasta não é um clone do squad primeteam-ops.`);
    return result;
  }

  if (branch !== 'main') {
    result.skippedReason = `você está no canal ${branch} (só atualiza no principal)`;
    if (!silent) {
      console.log(
        `${pc.yellow('⚠')} Você está num canal alternativo (${pc.bold(branch)}) — update pulei por segurança.\n` +
          `  ${pc.cyan('→')} volte para o canal principal: ${pc.cyan('git checkout main')}`,
      );
    }
    return result;
  }

  if (hasUncommittedChanges(repoRoot)) {
    result.skippedReason = 'você tem alterações não salvas no clone';
    if (!silent) {
      console.log(
        `${pc.yellow('⚠')} Você tem alterações não salvas no clone — update pulei por segurança.\n` +
          `  ${pc.cyan('→')} se você não lembra do que modificou, rode ${pc.cyan('pto doctor')} e avise o Pablo.`,
      );
    }
    return result;
  }

  const spinner = silent ? null : ora('Verificando atualizações do squad...').start();
  try {
    await fetchRemote('origin', { cwd: repoRoot, timeoutMs: 15_000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (spinner)
      spinner.fail(`Não consegui conectar ao GitHub agora. ${pc.dim('Verifique sua internet.')}`);
    result.skippedReason = 'sem conexão com GitHub';
    if (process.env.PTO_DEBUG === '1') console.error(pc.dim(msg));
    return result;
  }

  const behind = countCommitsBehind('main', 'origin', repoRoot);
  result.checked = true;

  if (behind === null || behind === 0) {
    if (spinner) spinner.succeed('Seu squad está em dia — nenhuma novidade.');
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
      `${pc.bold(String(behind))} nov${behind === 1 ? 'a' : 'as'} atualizaç${behind === 1 ? 'ão' : 'ões'} disponível${
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
        `${pc.cyan('→')} Só verifiquei — rode ${pc.cyan('pto update')} para aplicar.`,
      );
    }
    return result;
  }

  const pullSpin = silent ? null : ora('Aplicando as atualizações...').start();
  try {
    await pullFastForward('origin', 'main', { cwd: repoRoot, timeoutMs: 60_000 });
    result.pulled = true;
    result.commitsApplied = behind;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (pullSpin)
      pullSpin.fail(
        `Não consegui aplicar as atualizações. ${pc.dim('Avise o Pablo com o output de pto doctor.')}`,
      );
    if (process.env.PTO_DEBUG === '1') console.error(pc.dim(msg));
    return result;
  }

  if (pullSpin) pullSpin.succeed('Atualizações aplicadas.');

  if (shaBefore && packageLockChanged(shaBefore, 'HEAD', repoRoot)) {
    const npmSpin = silent
      ? null
      : ora('Algumas dependências mudaram — atualizando...').start();
    try {
      await runNpmInstall(repoRoot);
      result.depsReinstalled = true;
      if (npmSpin) npmSpin.succeed('Dependências atualizadas.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (npmSpin)
        npmSpin.fail(
          `Não consegui atualizar as dependências. ${pc.dim('Rode npm install manualmente, ou avise o Pablo.')}`,
        );
      if (process.env.PTO_DEBUG === '1') console.error(pc.dim(msg));
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
