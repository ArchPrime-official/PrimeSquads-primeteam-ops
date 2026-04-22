import { clearSession, loadSession } from './session.js';
import { createAuthenticatedClient } from './supabase.js';

export async function logout(): Promise<void> {
  const session = loadSession();
  if (!session) {
    console.log('ℹ Nenhuma session local encontrada — nada a fazer');
    return;
  }

  // Best-effort: invalida a session no Supabase também. Se falhar, segue com o clear local.
  try {
    const supabase = createAuthenticatedClient(session.access_token, session.refresh_token);
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // ignora — o que importa é o clear local
  }

  clearSession();
  console.log(`✓ Logout ok (session local removida: ${session.email})`);
}
