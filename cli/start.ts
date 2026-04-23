import pc from 'picocolors';
import { update } from './update.js';
import { maybeRefresh, readSessionHealth } from './session.js';
import { readPackageVersion, getHeadSha } from './git.js';
import { getRepoRoot } from './paths.js';
import { loadState, recordStart } from './state.js';
import { formatRelativeTime } from './ui.js';

/**
 * Comando `pto start` (default) — rotina diária. Agrega o que o usuário
 * precisa ver todo dia numa só tela:
 *   1. Checa atualizações do squad (silent fetch)
 *   2. Refresca session se estiver prestes a expirar
 *   3. Mostra briefing: versão, identidade, novidades, 3 próximos comandos
 */
export async function start(): Promise<void> {
  const repoRoot = getRepoRoot();
  const version = readPackageVersion(repoRoot);
  const sha = getHeadSha(repoRoot);
  const state = loadState();

  // 1. Update check (silent fetch — não força pull)
  const updateResult = await update({ silent: true, dryRun: true });

  // 2. Refresh silencioso se session está prestes a expirar
  const refreshResult = await maybeRefresh();

  // 3. Briefing
  printBriefing({
    version,
    sessionHealth: readSessionHealth(),
    updateResult,
    refreshed: refreshResult.refreshed,
    lastStartAt: state.last_start_at,
  });

  // 4. Grava state
  recordStart(sha, version);
}

function greetByHour(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Boa madrugada';
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function dateLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

interface BriefingArgs {
  version: string | null;
  sessionHealth: ReturnType<typeof readSessionHealth>;
  updateResult: Awaited<ReturnType<typeof update>>;
  refreshed: boolean;
  lastStartAt: string | null;
}

function printBriefing(args: BriefingArgs): void {
  const { version, sessionHealth, updateResult, refreshed, lastStartAt } = args;

  const who = sessionHealth.status === 'valid' || sessionHealth.status === 'expiring'
    ? sessionHealth.session.email
    : null;

  const name = who ? who.split('@')[0] : null;
  const greeting = name
    ? `${greetByHour()}, ${pc.bold(name)}`
    : `${greetByHour()}`;

  console.log('');
  console.log(`  ${greeting} — ${pc.dim(dateLabel())}`);
  console.log('');

  // Linha 1: versão do squad
  const versionLine = version ? `v${version}` : 'versão desconhecida';
  let versionStatus: string;
  if (updateResult.checked) {
    if (updateResult.messages.length > 0) {
      versionStatus = pc.yellow(
        `(${updateResult.messages.length} nov${updateResult.messages.length === 1 ? 'a' : 'as'} disponível${
          updateResult.messages.length === 1 ? '' : 'eis'
        })`,
      );
    } else {
      versionStatus = pc.dim('(em dia)');
    }
  } else if (updateResult.skippedReason) {
    versionStatus = pc.dim(`(${updateResult.skippedReason})`);
  } else {
    versionStatus = pc.dim('(não consegui verificar remoto)');
  }
  console.log(`  ${pc.dim('Squad')}        ${versionLine} ${versionStatus}`);

  // Linha 2: identidade
  if (sessionHealth.status === 'valid') {
    console.log(
      `  ${pc.dim('Sessão')}       ${sessionHealth.session.email} ${pc.dim(
        `(expira ${formatRelativeTime(sessionHealth.session.expires_at)})`,
      )}`,
    );
  } else if (sessionHealth.status === 'expiring') {
    const tag = refreshed ? pc.green('renovada agora') : pc.yellow('renove em breve');
    console.log(
      `  ${pc.dim('Sessão')}       ${sessionHealth.session.email} ${pc.dim(
        `(${tag})`,
      )}`,
    );
  } else if (sessionHealth.status === 'expired') {
    console.log(`  ${pc.dim('Sessão')}       ${pc.red('expirou')} — rode ${pc.cyan('pto refresh')}`);
  } else if (sessionHealth.status === 'missing') {
    console.log(`  ${pc.dim('Sessão')}       ${pc.yellow('não logado')} — rode ${pc.cyan('pto login')}`);
  } else {
    console.log(`  ${pc.dim('Sessão')}       ${pc.red('arquivo de sessão corrompido')} — rode ${pc.cyan('pto login')}`);
  }

  // Linha 3: último uso
  if (lastStartAt) {
    const lastSec = Math.floor(new Date(lastStartAt).getTime() / 1000);
    console.log(`  ${pc.dim('Último uso')}   ${formatRelativeTime(lastSec)}`);
  } else {
    console.log(`  ${pc.dim('Último uso')}   ${pc.dim('primeira vez hoje')}`);
  }

  // Novidades (se houver)
  if (updateResult.messages.length > 0) {
    console.log('');
    console.log(`  ${pc.bold(pc.yellow('Novidades pendentes:'))}`);
    for (const m of updateResult.messages.slice(0, 5)) {
      console.log(`    ${pc.dim('·')} ${m}`);
    }
    if (updateResult.messages.length > 5) {
      console.log(`    ${pc.dim(`... e mais ${updateResult.messages.length - 5}`)}`);
    }
    console.log('');
    console.log(`  ${pc.cyan('→')} aplique com: ${pc.cyan('pto update')}`);
  }

  // Próximos comandos — contextuais
  console.log('');
  console.log(`  ${pc.bold('O que você pode fazer agora')}`);

  if (sessionHealth.status === 'missing' || sessionHealth.status === 'corrupted') {
    console.log(`    ${pc.cyan('→')} ${pc.cyan('pto login')}    entrar com sua conta Google @archprime.io`);
    console.log(`    ${pc.cyan('→')} ${pc.cyan('pto setup')}    primeira vez? use o passo-a-passo guiado`);
    console.log(`    ${pc.cyan('→')} ${pc.cyan('pto doctor')}   verificar se o ambiente está OK`);
  } else {
    console.log(`    ${pc.cyan('→')} ${pc.cyan('claude')}                              abrir Claude Code`);
    console.log(`    ${pc.cyan('→')} ${pc.cyan('/PrimeteamOps:agents:ops-chief')}     ativar o chief no Claude`);
    console.log(`    ${pc.cyan('→')} ${pc.cyan('pto whoami')}                          ver seus papéis`);
  }

  console.log('');
  console.log(pc.dim(`  Dica: rode ${pc.cyan('pto')} todo dia — atualiza, verifica e mostra onde você parou.`));
  console.log('');
}
