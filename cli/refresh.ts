import ora from 'ora';
import pc from 'picocolors';
import { formatRelativeTime, userErrorByCode, handleError } from './ui.js';
import { refreshStoredSession, loadSession } from './session.js';
import { t } from './i18n/index.js';

export async function refresh(): Promise<void> {
  const current = loadSession();
  if (!current) {
    userErrorByCode('not_logged');
    process.exit(1);
  }

  const spinner = ora(t('cli:refresh.spinner')).start();
  try {
    const fresh = await refreshStoredSession();
    spinner.succeed(
      t('cli:refresh.done', {
        email: pc.bold(fresh.email),
        when: formatRelativeTime(fresh.expires_at),
      }),
    );
  } catch (err) {
    spinner.stop();
    handleError(err);
    process.exit(1);
  }
}
