import fs from 'node:fs';
import { STATE_FILE, ensureConfigDir } from './paths.js';

export type SetupStepName =
  | 'node_version'
  | 'git_installed'
  | 'clone_location'
  | 'deps_installed'
  | 'bin_linked'
  | 'logged_in'
  | 'identity_confirmed';

export type SetupStepStatus = 'pending' | 'done' | 'skipped';

export interface AppState {
  version: 1;
  last_start_at: string | null;
  last_start_head_sha: string | null;
  last_start_version: string | null;
  setup_started_at: string | null;
  setup_completed_at: string | null;
  setup_steps: Partial<Record<SetupStepName, SetupStepStatus>>;
  onboarding_completed_at: string | null;
  onboarding_tour_seen_for_role: string | null;
}

const DEFAULT_STATE: AppState = {
  version: 1,
  last_start_at: null,
  last_start_head_sha: null,
  last_start_version: null,
  setup_started_at: null,
  setup_completed_at: null,
  setup_steps: {},
  onboarding_completed_at: null,
  onboarding_tour_seen_for_role: null,
};

export function loadState(): AppState {
  if (!fs.existsSync(STATE_FILE)) return { ...DEFAULT_STATE };
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return { ...DEFAULT_STATE, ...parsed };
    }
  } catch {
    // fallthrough
  }
  return { ...DEFAULT_STATE };
}

export function saveState(state: AppState): void {
  ensureConfigDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

export function updateState(patch: Partial<AppState>): AppState {
  const current = loadState();
  const next = { ...current, ...patch };
  saveState(next);
  return next;
}

export function markSetupStep(step: SetupStepName, status: SetupStepStatus): void {
  const current = loadState();
  current.setup_steps[step] = status;
  saveState(current);
}

export function getSetupStep(step: SetupStepName): SetupStepStatus {
  return loadState().setup_steps[step] ?? 'pending';
}

export function isSetupComplete(): boolean {
  return loadState().setup_completed_at !== null;
}

export function recordStart(headSha: string | null, version: string | null): void {
  updateState({
    last_start_at: new Date().toISOString(),
    last_start_head_sha: headSha,
    last_start_version: version,
  });
}

export function markOnboardingDone(role?: string | null): void {
  updateState({
    onboarding_completed_at: new Date().toISOString(),
    onboarding_tour_seen_for_role: role ?? null,
  });
}

export function resetOnboarding(): void {
  updateState({
    onboarding_completed_at: null,
    onboarding_tour_seen_for_role: null,
  });
}

export function isOnboardingDone(): boolean {
  return loadState().onboarding_completed_at !== null;
}
