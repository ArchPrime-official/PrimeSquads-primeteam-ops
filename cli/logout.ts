import { clearSession, loadSession } from './session.js';
import { createAuthenticatedClient } from './supabase.js';
import { success, info } from './ui.js';
import { t } from './i18n/index.js';

export async function logout(): Promise<void> {
  const session = loadSession();
  if (!session) {
    info(t('cli:logout.already_out'));
    return;
  }

  try {
    const supabase = createAuthenticatedClient(session.access_token, session.refresh_token);
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // ignora — o importante é limpar localmente
  }

  clearSession();
  success(t('cli:logout.goodbye', { name: session.email.split('@')[0] }));
}
