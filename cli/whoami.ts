import pc from 'picocolors';
import { loadSession, isExpired } from './session.js';
import { createAuthenticatedClient } from './supabase.js';
import { formatRelativeTime, userError, handleError } from './ui.js';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Dona/dono do time (acesso total)',
  financeiro: 'Financeiro',
  marketing: 'Marketing',
  comercial: 'Comercial',
  cs: 'Customer Success',
  admin: 'Admin',
};

function describeRole(role: string): string {
  return ROLE_LABEL[role] ?? role;
}

export async function whoami(): Promise<void> {
  const session = loadSession();
  if (!session) {
    userError({
      title: 'você não está logada/o',
      why: 'não encontrei uma sessão ativa neste computador',
      what: 'rode: pto login',
    });
    process.exit(1);
  }

  if (isExpired(session)) {
    userError({
      title: 'sua sessão expirou',
      why: 'acontece depois de algumas horas — segurança padrão',
      what: 'rode: pto refresh (ou pto login se o refresh falhar)',
    });
    process.exit(1);
  }

  const supabase = createAuthenticatedClient(session.access_token, session.refresh_token);

  try {
    const { data: userData, error: userError_ } = await supabase.auth.getUser();
    if (userError_ || !userData.user) {
      userError({
        title: 'sua sessão parece inválida',
        why: 'o servidor não reconheceu seu acesso',
        what: 'rode: pto login',
        detail: userError_?.message,
      });
      process.exit(1);
    }

    const user = userData.user;

    const { data: roles, error: rolesError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const name = (user.email ?? '').split('@')[0] || 'amigo';

    console.log('');
    console.log(`  ${pc.green('✓')} Logada/o como ${pc.bold(name)}`);
    console.log('');
    console.log(`  ${pc.dim('Email')}        ${user.email}`);

    if (rolesError) {
      console.log(
        `  ${pc.dim('Papéis')}       ${pc.yellow('não consegui ler agora')} ${pc.dim('(tente pto refresh)')}`,
      );
    } else {
      const roleList = (roles ?? []).map((r) => r.role as string).sort();
      if (roleList.length === 0) {
        console.log(`  ${pc.dim('Papéis')}       ${pc.yellow('nenhum papel atribuído — fale com o Pablo')}`);
      } else {
        const labels = roleList.map(describeRole).join(', ');
        console.log(`  ${pc.dim('Papéis')}       ${labels}`);
      }
    }

    console.log(
      `  ${pc.dim('Expira')}       ${formatRelativeTime(session.expires_at)} ` +
        pc.dim(`(${new Date(session.expires_at * 1000).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })})`),
    );
    console.log('');
  } catch (err) {
    handleError(err);
    process.exit(1);
  }
}
