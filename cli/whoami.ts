import { loadSession, isExpired } from './session.js';
import { createAuthenticatedClient } from './supabase.js';

export async function whoami(): Promise<void> {
  const session = loadSession();
  if (!session) {
    console.log('✗ Não logado');
    console.log('  Use: npm run login');
    process.exit(1);
  }

  if (isExpired(session)) {
    console.log('✗ Session expirada em ' + new Date(session.expires_at * 1000).toISOString());
    console.log('  Use: npm run login');
    process.exit(1);
  }

  const supabase = createAuthenticatedClient(session.access_token, session.refresh_token);

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    console.log('✗ Session inválida (Supabase rejeitou o token)');
    console.log('  ' + (userError?.message ?? 'user ausente'));
    console.log('  Use: npm run login');
    process.exit(1);
  }

  const user = userData.user;

  // Lê roles da tabela user_roles (RLS permite o próprio usuário ler suas roles)
  const { data: roles, error: rolesError } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);

  if (rolesError) {
    console.log('⚠ Logado mas não consegui ler roles:', rolesError.message);
    console.log('');
    console.log(`  Email:    ${user.email}`);
    console.log(`  User ID:  ${user.id}`);
    return;
  }

  const roleList = (roles ?? []).map((r) => r.role as string).sort();
  const rolesDisplay = roleList.length > 0 ? roleList.join(', ') : '(sem role atribuída)';

  console.log(`✓ Logado`);
  console.log('');
  console.log(`  Email:     ${user.email}`);
  console.log(`  User ID:   ${user.id}`);
  console.log(`  Roles:     ${rolesDisplay}`);
  console.log(`  Expira em: ${new Date(session.expires_at * 1000).toLocaleString('pt-BR')}`);
}
