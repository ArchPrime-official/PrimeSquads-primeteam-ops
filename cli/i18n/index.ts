import i18next, { type i18n, type TFunction } from 'i18next';
import Backend from 'i18next-fs-backend';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SupportedLocale, SUPPORTED_LOCALES } from './detect.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Sobe de cli/i18n/ (ou dist/i18n/) para a raiz do pacote e entra em locales/
const LOCALES_PATH = path.resolve(__dirname, '..', '..', 'locales', '{{lng}}', '{{ns}}.json');

// Fallback caso __dirname esteja em dist/
const LOCALES_PATH_FROM_DIST = path.resolve(__dirname, '..', 'locales', '{{lng}}', '{{ns}}.json');

export const I18N_NAMESPACES = ['cli', 'errors', 'html', 'agent'] as const;
export type I18nNamespace = (typeof I18N_NAMESPACES)[number];

let initialized = false;

export async function initI18n(locale: SupportedLocale): Promise<i18n> {
  if (initialized) {
    await i18next.changeLanguage(locale);
    return i18next;
  }

  // Detecta se estamos rodando de dist/ (compilado) ou cli/ (tsx)
  // para resolver o loadPath corretamente
  const fs = await import('node:fs');
  const testPath = path.resolve(__dirname, '..', '..', 'locales', 'en', 'cli.json');
  const loadPath = fs.existsSync(testPath) ? LOCALES_PATH : LOCALES_PATH_FROM_DIST;

  await i18next.use(Backend).init({
    lng: locale,
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LOCALES],
    ns: ['cli', 'errors', 'html', 'agent'],
    defaultNS: 'cli',
    backend: { loadPath },
    interpolation: { escapeValue: false },
    returnNull: false,
    returnEmptyString: false,
  });

  // Pré-carrega os namespaces para uso síncrono depois
  await i18next.loadNamespaces(['cli', 'errors', 'html', 'agent']);

  initialized = true;
  return i18next;
}

/**
 * Tradução com fallback automático para a chave literal se o i18n não
 * foi inicializado (ex: erro ocorreu antes do bootstrap). Isso evita crash
 * durante erros fatais no boot.
 */
export const t: TFunction = ((key: string, options?: Record<string, unknown>) => {
  if (!initialized) return key;
  return i18next.t(key, options) as string;
}) as unknown as TFunction;

export async function changeLocale(locale: SupportedLocale): Promise<void> {
  if (!initialized) {
    await initI18n(locale);
    return;
  }
  await i18next.changeLanguage(locale);
}

export function currentLocale(): SupportedLocale {
  if (!initialized) return 'en';
  return (i18next.language || 'en') as SupportedLocale;
}
