import pc from 'picocolors';
import { loadSession, isExpired } from './session.js';
import { createAuthenticatedClient } from './supabase.js';
import { formatRelativeTime, userErrorByCode, handleError } from './ui.js';
import { t } from './i18n/index.js';

function describeRole(role: string): string {
  // Labels vêm de cli.json > roles.{role}; se não existir, devolve o raw.
  const localized = t(`cli:roles.${role}`);
  return localized === `cli:roles.${role}` ? role : localized;
}

export async function whoami(): Promise<void> {
  const session = loadSession();
  if (!session) {
    userErrorByCode('not_logged');
    process.exit(1);
  }

  if (isExpired(session)) {
    userErrorByCode('session_expired');
    process.exit(1);
  }

  const supabase = createAuthenticatedClient(session.access_token, session.refresh_token);

  try {
    const { data: userData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !userData.user) {
      userErrorByCode('session_invalid', { detail: authErr?.message });
      process.exit(1);
    }

    const user = userData.user;

    const { data: roles, error: rolesError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const name = (user.email ?? '').split('@')[0] || 'amigo';

    console.log('');
    console.log(`  ${pc.green('✓')} ${t('cli:whoami.logged_as', { name: pc.bold(name) })}`);
    console.log('');
    console.log(`  ${pc.dim(t('cli:whoami.email_label'))}        ${user.email}`);

    if (rolesError) {
      console.log(
        `  ${pc.dim(t('cli:whoami.roles_label'))}       ${pc.yellow(t('cli:whoami.roles_unavailable'))} ${pc.dim(t('cli:whoami.roles_unavailable_hint'))}`,
      );
    } else {
      const roleList = (roles ?? []).map((r) => r.role as string).sort();
      if (roleList.length === 0) {
        console.log(`  ${pc.dim(t('cli:whoami.roles_label'))}       ${pc.yellow(t('cli:whoami.no_role'))}`);
      } else {
        const labels = roleList.map(describeRole).join(', ');
        console.log(`  ${pc.dim(t('cli:whoami.roles_label'))}       ${labels}`);
      }
    }

    const when = formatRelativeTime(session.expires_at);
    const abs = new Date(session.expires_at * 1000).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    console.log(
      `  ${pc.dim(t('cli:whoami.expires_label'))}       ${when} ${pc.dim(`(${abs})`)}`,
    );
    console.log('');
  } catch (err) {
    handleError(err);
    process.exit(1);
  }
}
