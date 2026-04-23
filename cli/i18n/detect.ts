export type SupportedLocale = 'pt-BR' | 'it' | 'en';

export const SUPPORTED_LOCALES: SupportedLocale[] = ['pt-BR', 'it', 'en'];

export const LOCALE_LABEL: Record<SupportedLocale, string> = {
  'pt-BR': 'Português (Brasil)',
  it: 'Italiano',
  en: 'English',
};

/**
 * Detecta o locale preferido do sistema operacional seguindo a cascata
 * POSIX (funciona em Linux/macOS) e fallback para Intl (macOS/Windows):
 *
 *   LC_ALL > LC_MESSAGES > LANG > LANGUAGE > Intl > 'en'
 *
 * Resultados típicos:
 *   "pt_BR.UTF-8" → "pt-BR"
 *   "it_IT.UTF-8" → "it"
 *   "en_US.UTF-8" → "en"
 *   "C" / "POSIX" → "en"
 */
export function detectLocale(): SupportedLocale {
  const raw =
    process.env.LC_ALL ||
    process.env.LC_MESSAGES ||
    process.env.LANG ||
    process.env.LANGUAGE?.split(':')[0] ||
    (typeof Intl !== 'undefined'
      ? new Intl.DateTimeFormat().resolvedOptions().locale
      : '') ||
    'en';

  const normalized = raw.replace('_', '-').split('.')[0].toLowerCase();

  if (normalized.startsWith('pt')) return 'pt-BR';
  if (normalized.startsWith('it')) return 'it';
  if (normalized === 'c' || normalized === 'posix' || !normalized) return 'en';
  return 'en';
}

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && SUPPORTED_LOCALES.includes(value as SupportedLocale);
}
