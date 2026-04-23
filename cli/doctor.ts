import pc from 'picocolors';
import { createServer } from 'node:net';
import { execSync } from 'node:child_process';
import { readSessionHealth } from './session.js';
import {
  isGitInstalled,
  isGitRepo,
  readRepoStatus,
  readPackageVersion,
} from './git.js';
import { getRepoRoot } from './paths.js';
import { CALLBACK_PORT, SUPABASE_URL } from './config.js';
import { formatRelativeTime } from './ui.js';

type CheckStatus = 'ok' | 'warn' | 'fail';

interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
}

const ICON: Record<CheckStatus, string> = {
  ok: pc.green('✓'),
  warn: pc.yellow('⚠'),
  fail: pc.red('✗'),
};

function checkNode(): Check {
  const v = process.versions.node;
  const major = parseInt(v.split('.')[0], 10);
  if (major >= 20) {
    return { name: 'Node.js', status: 'ok', detail: `v${v}` };
  }
  return {
    name: 'Node.js',
    status: 'fail',
    detail: `v${v} (precisa de v20 ou superior)`,
    hint: 'Atualize Node: https://nodejs.org',
  };
}

function checkGit(): Check {
  if (!isGitInstalled()) {
    return {
      name: 'git',
      status: 'fail',
      detail: 'não instalado',
      hint: 'Instale git: https://git-scm.com',
    };
  }
  try {
    const v = execSync('git --version', { encoding: 'utf-8' }).trim().replace('git version ', '');
    return { name: 'git', status: 'ok', detail: v };
  } catch {
    return { name: 'git', status: 'ok', detail: 'instalado' };
  }
}

function checkGh(): Check {
  try {
    const v = execSync('gh --version', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')[0]
      ?.trim();
    return { name: 'gh (GitHub CLI)', status: 'ok', detail: v ?? 'instalado' };
  } catch {
    return {
      name: 'gh (GitHub CLI)',
      status: 'warn',
      detail: 'não instalado (opcional)',
      hint: 'Só precisa se for contribuir com o squad: https://cli.github.com',
    };
  }
}

function checkCallbackPort(): Promise<Check> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve({
          name: 'porta de login',
          status: 'fail',
          detail: 'ocupada por outro programa',
          hint: 'Feche outras janelas do pto (ou reinicie o computador) e tente de novo.',
        });
      } else {
        resolve({
          name: 'porta de login',
          status: 'warn',
          detail: `erro inesperado: ${err.message}`,
        });
      }
      server.close();
    });
    server.once('listening', () => {
      server.close(() => {
        resolve({
          name: 'porta de login',
          status: 'ok',
          detail: 'disponível',
        });
      });
    });
    server.listen(CALLBACK_PORT, '127.0.0.1');
  });
}

async function checkSupabaseReach(): Promise<Check> {
  const url = `${SUPABASE_URL}/auth/v1/health`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok || res.status === 401) {
      // 401 = rota existe, só pede acesso (esperado em /auth/v1/health)
      return { name: 'conexão com a plataforma', status: 'ok', detail: 'online' };
    }
    return {
      name: 'conexão com a plataforma',
      status: 'warn',
      detail: `resposta inesperada (HTTP ${res.status})`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: 'conexão com a plataforma',
      status: 'fail',
      detail: 'sem resposta',
      hint: `Verifique sua internet e tente de novo. ${process.env.PTO_DEBUG === '1' ? msg : ''}`,
    };
  }
}

function checkSession(): Check {
  const h = readSessionHealth();
  switch (h.status) {
    case 'missing':
      return {
        name: 'seu login',
        status: 'warn',
        detail: 'você não entrou ainda',
        hint: 'Rode: pto login',
      };
    case 'corrupted':
      return {
        name: 'seu login',
        status: 'fail',
        detail: 'os dados do login estão corrompidos',
        hint: 'Rode: pto login (para entrar de novo)',
      };
    case 'expired':
      return {
        name: 'seu login',
        status: 'fail',
        detail: `expirou ${formatRelativeTime(
          Math.floor(Date.now() / 1000) - h.expiredSinceSec,
        )}`,
        hint: 'Rode: pto refresh (ou pto login se o refresh não funcionar)',
      };
    case 'expiring':
      return {
        name: 'seu login',
        status: 'warn',
        detail: `${h.session.email} (expira ${formatRelativeTime(h.session.expires_at)})`,
        hint: 'Rode: pto refresh (renova sem precisar relogar)',
      };
    case 'valid':
      return {
        name: 'seu login',
        status: 'ok',
        detail: `${h.session.email} (expira ${formatRelativeTime(h.session.expires_at)})`,
      };
  }
}

function checkRepo(): Check[] {
  const repoRoot = getRepoRoot();
  const version = readPackageVersion(repoRoot);

  if (!isGitRepo(repoRoot)) {
    return [
      {
        name: 'pasta do squad',
        status: 'fail',
        detail: 'esta pasta não é o clone do squad',
        hint:
          'Clone de novo: git clone https://github.com/ArchPrime-official/PrimeSquads-primeteam-ops.git',
      },
    ];
  }

  const status = readRepoStatus(repoRoot);
  const results: Check[] = [];

  results.push({
    name: 'versão do squad',
    status: 'ok',
    detail: version ? `v${version}` : 'desconhecida',
  });

  results.push({
    name: 'canal atual',
    status: status.branch === 'main' ? 'ok' : 'warn',
    detail: status.branch ?? 'desconhecido',
    hint: status.branch !== 'main' ? 'Você está fora do canal padrão (normal só se estiver testando algo).' : undefined,
  });

  if (status.dirty) {
    results.push({
      name: 'alterações não salvas',
      status: 'warn',
      detail: 'você tem arquivos modificados no clone',
      hint: 'Isso bloqueia pto update. Se não lembra do que modificou, avise o Pablo.',
    });
  } else {
    results.push({ name: 'alterações não salvas', status: 'ok', detail: 'nenhuma' });
  }

  if (status.behind !== null && status.behind > 0) {
    results.push({
      name: 'atualizações do squad',
      status: 'warn',
      detail: `${status.behind} nov${status.behind === 1 ? 'a' : 'as'} disponível${
        status.behind === 1 ? '' : 'eis'
      }`,
      hint: 'Rode: pto update',
    });
  } else if (status.behind === 0) {
    results.push({
      name: 'atualizações do squad',
      status: 'ok',
      detail: 'em dia',
    });
  }

  return results;
}

/**
 * Comando `pto doctor` — healthcheck completo com saída copiável.
 * Útil quando algo não funciona: usuário copia o output e cola no Slack.
 */
export async function doctor(): Promise<void> {
  console.log(pc.bold('\n pto doctor — diagnóstico do ambiente\n'));

  // Roda em paralelo o que é paralelizável
  const [portCheck, supabaseCheck] = await Promise.all([
    checkCallbackPort(),
    checkSupabaseReach(),
  ]);

  const checks: Check[] = [
    checkNode(),
    checkGit(),
    checkGh(),
    ...checkRepo(),
    portCheck,
    supabaseCheck,
    checkSession(),
  ];

  for (const c of checks) {
    console.log(`  ${ICON[c.status]} ${c.name}: ${c.detail}`);
    if (c.hint) {
      console.log(`      ${pc.dim(c.hint)}`);
    }
  }

  const failures = checks.filter((c) => c.status === 'fail').length;
  const warnings = checks.filter((c) => c.status === 'warn').length;

  console.log('');
  if (failures > 0) {
    console.log(
      pc.red(
        `  ${failures} problema${failures === 1 ? '' : 's'} precisa${failures === 1 ? '' : 'm'} ser resolvido${failures === 1 ? '' : 's'}.`,
      ),
    );
    console.log(
      pc.dim(
        `  Se não souber como, cole este output no Slack e peça ajuda ao Pablo.`,
      ),
    );
    process.exitCode = 1;
  } else if (warnings > 0) {
    console.log(
      pc.yellow(
        `  ${warnings} aviso${warnings === 1 ? '' : 's'} — dá pra trabalhar, mas vale resolver.`,
      ),
    );
  } else {
    console.log(pc.green('  Tudo certo — seu ambiente está saudável.'));
  }
  console.log('');
}
