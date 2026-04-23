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
          name: `porta ${CALLBACK_PORT} (login OAuth)`,
          status: 'fail',
          detail: 'em uso por outro processo',
          hint:
            'Feche VS Code, Docker ou outra instância do pto e tente de novo. ' +
            `Para descobrir o processo: lsof -i :${CALLBACK_PORT}`,
        });
      } else {
        resolve({
          name: `porta ${CALLBACK_PORT}`,
          status: 'warn',
          detail: `erro inesperado: ${err.message}`,
        });
      }
      server.close();
    });
    server.once('listening', () => {
      server.close(() => {
        resolve({
          name: `porta ${CALLBACK_PORT} (login OAuth)`,
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
      // 401 = rota existe, só pede auth (esperado)
      return { name: 'conectividade Supabase', status: 'ok', detail: 'acessível' };
    }
    return {
      name: 'conectividade Supabase',
      status: 'warn',
      detail: `retornou HTTP ${res.status}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: 'conectividade Supabase',
      status: 'fail',
      detail: 'sem resposta do servidor',
      hint: `Verifique sua internet. Detalhe técnico: ${msg}`,
    };
  }
}

function checkSession(): Check {
  const h = readSessionHealth();
  switch (h.status) {
    case 'missing':
      return {
        name: 'sessão de login',
        status: 'warn',
        detail: 'você não fez login ainda',
        hint: 'Rode: pto login',
      };
    case 'corrupted':
      return {
        name: 'sessão de login',
        status: 'fail',
        detail: 'arquivo de sessão corrompido',
        hint: 'Rode: pto login',
      };
    case 'expired':
      return {
        name: 'sessão de login',
        status: 'fail',
        detail: `expirou ${formatRelativeTime(
          Math.floor(Date.now() / 1000) - h.expiredSinceSec,
        )}`,
        hint: 'Rode: pto refresh  (ou pto login se refresh falhar)',
      };
    case 'expiring':
      return {
        name: 'sessão de login',
        status: 'warn',
        detail: `${h.session.email} (expira ${formatRelativeTime(h.session.expires_at)})`,
        hint: 'Rode: pto refresh',
      };
    case 'valid':
      return {
        name: 'sessão de login',
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
        name: 'clone do squad',
        status: 'fail',
        detail: 'não é um repositório git',
        hint: 'Clone novamente: git clone https://github.com/ArchPrime-official/PrimeSquads-primeteam-ops.git',
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
    name: 'branch atual',
    status: status.branch === 'main' ? 'ok' : 'warn',
    detail: status.branch ?? 'desconhecida',
    hint: status.branch !== 'main' ? 'Fora do main (esperado só se for dev).' : undefined,
  });

  if (status.dirty) {
    results.push({
      name: 'mudanças locais',
      status: 'warn',
      detail: 'você tem arquivos modificados no clone',
      hint: 'Vai bloquear pto update — faça commit ou git stash antes.',
    });
  } else {
    results.push({ name: 'mudanças locais', status: 'ok', detail: 'clone limpo' });
  }

  if (status.behind !== null && status.behind > 0) {
    results.push({
      name: 'atualizações do squad',
      status: 'warn',
      detail: `${status.behind} atualizaç${status.behind === 1 ? 'ão' : 'ões'} pendente${
        status.behind === 1 ? '' : 's'
      }`,
      hint: 'Rode: pto update',
    });
  } else if (status.behind === 0) {
    results.push({
      name: 'atualizações do squad',
      status: 'ok',
      detail: 'em dia com o remoto',
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
    console.log(pc.red(`  ${failures} problema${failures === 1 ? '' : 's'} precisa${failures === 1 ? '' : 'm'} de atenção.`));
    process.exitCode = 1;
  } else if (warnings > 0) {
    console.log(pc.yellow(`  ${warnings} aviso${warnings === 1 ? '' : 's'} (não bloqueia, mas veja acima).`));
  } else {
    console.log(pc.green('  Tudo certo — ambiente saudável.'));
  }
  console.log('');
}
