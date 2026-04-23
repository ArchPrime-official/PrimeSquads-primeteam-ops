import ora from 'ora';
import pc from 'picocolors';
import { formatRelativeTime } from './ui.js';
import { refreshStoredSession, loadSession } from './session.js';

/**
 * Comando `pto refresh` — renova manualmente o access_token usando o
 * refresh_token armazenado. Útil quando o usuário sabe que vai executar
 * operações longas e quer garantir que a session aguenta.
 *
 * Automaticamente chamado por `pto start` quando a session está prestes
 * a expirar (janela default: 10 min).
 */
export async function refresh(): Promise<void> {
  const current = loadSession();
  if (!current) {
    console.error(
      `${pc.red('✗')} Você não está logado.\n` +
        `  ${pc.cyan('→')} rode ${pc.cyan('pto login')} primeiro.`,
    );
    process.exit(1);
  }

  const spinner = ora('Renovando sua sessão...').start();
  try {
    const fresh = await refreshStoredSession();
    spinner.succeed(
      `Sessão renovada — logada como ${pc.bold(fresh.email)} ` +
        pc.dim(`(expira ${formatRelativeTime(fresh.expires_at)})`),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    spinner.fail(msg);
    process.exit(1);
  }
}
