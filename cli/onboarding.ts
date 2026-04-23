import pc from 'picocolors';
import {
  resetOnboarding,
  isOnboardingDone,
  loadState,
  markOnboardingDone,
} from './state.js';
import { formatDateTime } from './ui.js';

/**
 * Comando `pto onboarding [action]`
 *   pto onboarding         — mostra status
 *   pto onboarding status  — alias
 *   pto onboarding done    — marca como feito (chamado pelo ops-chief)
 *   pto onboarding reset   — reseta para aparecer de novo
 */
export function onboarding(action?: string, roleArg?: string): void {
  const sub = action ?? 'status';
  switch (sub) {
    case 'status':
      showStatus();
      return;
    case 'done':
      markOnboardingDone(roleArg);
      console.log(`${pc.green('✓')} Tour marcado como concluído.`);
      return;
    case 'reset':
      reset();
      return;
    default:
      console.error(`Ação desconhecida: ${sub}. Use: pto onboarding [status | done | reset]`);
      process.exit(1);
  }
}

function showStatus(): void {
  const state = loadState();
  if (state.onboarding_completed_at) {
    const when = formatDateTime(
      Math.floor(new Date(state.onboarding_completed_at).getTime() / 1000),
    );
    const role = state.onboarding_tour_seen_for_role
      ? ` ${pc.dim(`(role: ${state.onboarding_tour_seen_for_role})`)}`
      : '';
    console.log(`${pc.green('✓')} Tour concluído ${pc.dim(`em ${when}`)}${role}`);
    console.log(`  ${pc.cyan('→')} resete com: ${pc.cyan('pto onboarding reset')}`);
  } else {
    console.log(`${pc.yellow('ℹ')} Você ainda não fez o tour — ele aparece na próxima vez que ativar o ops-chief.`);
  }
}

function reset(): void {
  const state = loadState();
  if (!isOnboardingDone()) {
    console.log(`${pc.yellow('ℹ')} Não havia nada para resetar — o tour ainda não foi feito.`);
    return;
  }
  const prev = state.onboarding_completed_at
    ? formatDateTime(Math.floor(new Date(state.onboarding_completed_at).getTime() / 1000))
    : '?';
  resetOnboarding();
  console.log(`${pc.green('✓')} Tour resetado ${pc.dim(`(anterior: ${prev})`)}.`);
  console.log(`  ${pc.cyan('→')} da próxima vez que ativar o ops-chief, o tour aparece de novo.`);
}
