import ora from 'ora';
import pc from 'picocolors';
import { formatRelativeTime, userError, handleError } from './ui.js';
import { refreshStoredSession, loadSession } from './session.js';

/**
 * Comando `pto refresh` — renova manualmente o acesso usando o token de
 * renovação armazenado. Útil antes de operações longas ou quando o acesso
 * está prestes a expirar.
 *
 * Automaticamente chamado por `pto start` quando a sessão está perto de
 * expirar (janela default: 10 min).
 */
export async function refresh(): Promise<void> {
  const current = loadSession();
  if (!current) {
    userError({
      title: 'você não está logada/o',
      why: 'não encontrei sua sessão neste computador',
      what: 'rode: pto login',
    });
    process.exit(1);
  }

  const spinner = ora('Renovando seu acesso...').start();
  try {
    const fresh = await refreshStoredSession();
    spinner.succeed(
      `Acesso renovado — ${pc.bold(fresh.email)} ${pc.dim(
        `(expira ${formatRelativeTime(fresh.expires_at)})`,
      )}`,
    );
  } catch (err) {
    spinner.stop();
    handleError(err, 'rode: pto login para entrar de novo');
    process.exit(1);
  }
}
