import { clearSession, loadSession } from './session.js';
import { createAuthenticatedClient } from './supabase.js';
import { success, info } from './ui.js';

export async function logout(): Promise<void> {
  const session = loadSession();
  if (!session) {
    info('Você já está desconectada/o — nada a fazer.');
    return;
  }

  // Best-effort: sinaliza a saída no Supabase. Se falhar, segue com a limpeza local.
  try {
    const supabase = createAuthenticatedClient(session.access_token, session.refresh_token);
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // ignora — o importante é limpar localmente
  }

  clearSession();
  success(`Tchau, ${session.email.split('@')[0]} — acesso removido deste computador.`);
}
