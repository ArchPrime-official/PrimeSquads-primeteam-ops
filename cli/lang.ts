import * as p from '@clack/prompts';
import pc from 'picocolors';
import {
  loadPreferences,
  saveLocale,
  resetLocale as resetLocalePrefs,
  resolveLocale,
} from './preferences.js';
import {
  LOCALE_LABEL,
  SUPPORTED_LOCALES,
  SupportedLocale,
  isSupportedLocale,
  detectLocale,
} from './i18n/detect.js';
import { changeLocale, t } from './i18n/index.js';

/**
 * Comando `pto lang [action] [value]`
 *   pto lang                     — mostra idioma atual + origem
 *   pto lang set <pt-BR|it|en>   — define e persiste
 *   pto lang set                 — abre prompt interativo
 *   pto lang auto                — re-detecta do sistema
 *   pto lang reset               — apaga preferência
 */
export async function lang(action?: string, value?: string): Promise<void> {
  if (!action) {
    await showCurrent();
    return;
  }

  switch (action) {
    case 'set':
      await setLocale(value);
      return;
    case 'auto': {
      const detected = detectLocale();
      const saved = saveLocale(detected, false);
      await changeLocale(detected);
      console.log(`${pc.green('✓')} ${t('cli:lang.auto_detected', { label: LOCALE_LABEL[saved.locale] })}`);
      return;
    }
    case 'reset':
      resetLocalePrefs();
      console.log(`${pc.green('✓')} ${t('cli:lang.reset')}`);
      return;
    default:
      console.error(
        `Ação desconhecida: ${action}. Use: pto lang [set <locale> | auto | reset]`,
      );
      process.exit(1);
  }
}

async function showCurrent(): Promise<void> {
  const { locale, source } = resolveLocale();
  const sourceKey = `cli:lang.source_${source}`;
  const sourceText = t(sourceKey);
  console.log('');
  console.log(
    `  ${pc.bold(t('cli:lang.current', { label: LOCALE_LABEL[locale] }))}`,
  );
  console.log(`  ${pc.dim(sourceText)}`);
  console.log('');
  console.log(
    `  ${pc.cyan('→')} Trocar: ${pc.cyan('pto lang set <pt-BR|it|en>')}`,
  );
  console.log('');
}

async function setLocale(value?: string): Promise<void> {
  let locale: SupportedLocale | undefined;

  if (value) {
    if (!isSupportedLocale(value)) {
      console.error(`${pc.red('✗')} ${t('cli:lang.unsupported', { value })}`);
      process.exit(1);
    }
    locale = value;
  } else {
    const prefs = loadPreferences();
    const initial = prefs ? SUPPORTED_LOCALES.indexOf(prefs.locale) : 0;
    const result = await p.select({
      message: t('cli:lang.choose'),
      initialValue: SUPPORTED_LOCALES[initial],
      options: SUPPORTED_LOCALES.map((l) => ({
        value: l,
        label: LOCALE_LABEL[l],
      })),
    });
    if (p.isCancel(result)) {
      p.cancel(t('cli:setup.cancelled', { cmd: 'pto lang set' }));
      process.exit(0);
    }
    locale = result as SupportedLocale;
  }

  saveLocale(locale, true);
  await changeLocale(locale);
  console.log(`${pc.green('✓')} ${t('cli:lang.saved', { label: LOCALE_LABEL[locale] })}`);
}

/**
 * First-run prompt para o setup: detecta idioma do sistema e oferece
 * confirmar ou trocar. Chamado pelo wizard `pto setup` no primeiro run.
 */
export async function firstRunPickLocale(): Promise<SupportedLocale> {
  const existing = loadPreferences();
  if (existing?.chosen_by_user) return existing.locale;

  const detected = detectLocale();
  const hintByLocale: Record<SupportedLocale, string> = {
    'pt-BR': 'Detectado do seu sistema',
    it: 'Rilevato dal tuo sistema',
    en: 'Detected from your system',
  };

  // Mensagem em 3 idiomas para não assumir que o usuário entende o detectado
  const multilingual = `Escolha o idioma / Scegli la lingua / Choose language:`;

  const result = await p.select({
    message: multilingual,
    initialValue: detected,
    options: SUPPORTED_LOCALES.map((l) => ({
      value: l,
      label: `${LOCALE_LABEL[l]}${l === detected ? ` ${pc.dim(`← ${hintByLocale[l]}`)}` : ''}`,
    })),
  });

  if (p.isCancel(result)) {
    // fallback: usa o detectado sem marcar chosen_by_user
    saveLocale(detected, false);
    await changeLocale(detected);
    return detected;
  }

  const chosen = result as SupportedLocale;
  saveLocale(chosen, true);
  await changeLocale(chosen);
  return chosen;
}
