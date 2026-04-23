import fs from 'node:fs';
import { PREFERENCES_FILE, ensureConfigDir } from './paths.js';
import {
  detectLocale,
  isSupportedLocale,
  SupportedLocale,
} from './i18n/detect.js';

export interface Preferences {
  version: 1;
  locale: SupportedLocale;
  detected_at: string;
  chosen_by_user: boolean;
  last_updated_at: string;
}

export type LocaleSource = 'flag' | 'env' | 'file' | 'auto' | 'default';

export interface ResolvedLocale {
  locale: SupportedLocale;
  source: LocaleSource;
  prefs: Preferences | null;
}

const DEFAULT_PREFS = (locale: SupportedLocale, chosenByUser: boolean): Preferences => ({
  version: 1,
  locale,
  detected_at: new Date().toISOString(),
  chosen_by_user: chosenByUser,
  last_updated_at: new Date().toISOString(),
});

export function loadPreferences(): Preferences | null {
  if (!fs.existsSync(PREFERENCES_FILE)) return null;
  try {
    const raw = fs.readFileSync(PREFERENCES_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      isSupportedLocale(parsed.locale)
    ) {
      return parsed as Preferences;
    }
  } catch {
    // silencioso — retorna null, caller decide o fallback
  }
  return null;
}

export function savePreferences(prefs: Preferences): void {
  ensureConfigDir();
  fs.writeFileSync(PREFERENCES_FILE, JSON.stringify(prefs, null, 2), { mode: 0o600 });
}

export function saveLocale(locale: SupportedLocale, chosenByUser = true): Preferences {
  const existing = loadPreferences();
  const next: Preferences = existing
    ? { ...existing, locale, chosen_by_user: chosenByUser, last_updated_at: new Date().toISOString() }
    : DEFAULT_PREFS(locale, chosenByUser);
  savePreferences(next);
  return next;
}

export function resetLocale(): void {
  if (fs.existsSync(PREFERENCES_FILE)) fs.unlinkSync(PREFERENCES_FILE);
}

/**
 * Resolve o locale seguindo a cadeia de precedência:
 *   flag CLI > env PTOPS_LANG > preferences.json > detect do sistema > 'en'
 */
export function resolveLocale(cliFlag?: string): ResolvedLocale {
  if (cliFlag && isSupportedLocale(cliFlag)) {
    return { locale: cliFlag, source: 'flag', prefs: loadPreferences() };
  }
  const envVal = process.env.PTOPS_LANG;
  if (envVal && isSupportedLocale(envVal)) {
    return { locale: envVal, source: 'env', prefs: loadPreferences() };
  }
  const prefs = loadPreferences();
  if (prefs) {
    return { locale: prefs.locale, source: 'file', prefs };
  }
  const detected = detectLocale();
  return { locale: detected, source: 'auto', prefs: null };
}

export function hasChosenLocale(): boolean {
  return loadPreferences()?.chosen_by_user === true;
}
