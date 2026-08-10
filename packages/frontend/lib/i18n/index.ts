import { I18n } from 'i18n-js';
import { getLocales } from 'expo-localization';
import ar from './locales/ar.json';
import bn from './locales/bn.json';
import ca from './locales/ca.json';
import de from './locales/de.json';
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import hi from './locales/hi.json';
import id from './locales/id.json';
import ja from './locales/ja.json';
import mr from './locales/mr.json';
import pt from './locales/pt.json';
import ru from './locales/ru.json';
import sw from './locales/sw.json';
import ur from './locales/ur.json';
import zh from './locales/zh.json';

export const SUPPORTED_LOCALES = [
  { code: 'en', nativeLabel: 'English', direction: 'ltr' },
  { code: 'zh', nativeLabel: '简体中文', direction: 'ltr' },
  { code: 'hi', nativeLabel: 'हिन्दी', direction: 'ltr' },
  { code: 'es', nativeLabel: 'Español', direction: 'ltr' },
  { code: 'fr', nativeLabel: 'Français', direction: 'ltr' },
  { code: 'ar', nativeLabel: 'العربية', direction: 'rtl' },
  { code: 'bn', nativeLabel: 'বাংলা', direction: 'ltr' },
  { code: 'pt', nativeLabel: 'Português', direction: 'ltr' },
  { code: 'ru', nativeLabel: 'Русский', direction: 'ltr' },
  { code: 'ur', nativeLabel: 'اردو', direction: 'rtl' },
  { code: 'id', nativeLabel: 'Bahasa Indonesia', direction: 'ltr' },
  { code: 'de', nativeLabel: 'Deutsch', direction: 'ltr' },
  { code: 'ja', nativeLabel: '日本語', direction: 'ltr' },
  { code: 'sw', nativeLabel: 'Kiswahili', direction: 'ltr' },
  { code: 'mr', nativeLabel: 'मराठी', direction: 'ltr' },
  { code: 'ca', nativeLabel: 'Català', direction: 'ltr' },
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]['code'];

const translations = { ar, bn, ca, de, en, es, fr, hi, id, ja, mr, pt, ru, sw, ur, zh };
const supportedCodes = new Set<string>(SUPPORTED_LOCALES.map(({ code }) => code));

/** Converts a device BCP-47 tag (such as pt-BR) to a supported language. */
export function resolveSupportedLocale(locale?: string | null): SupportedLocale {
  const language = locale?.trim().toLowerCase().split(/[-_]/)[0];
  return (language && supportedCodes.has(language) ? language : 'en') as SupportedLocale;
}

function getDeviceLocale(): SupportedLocale {
  const locale = getLocales()[0];
  return resolveSupportedLocale(locale?.languageTag ?? locale?.languageCode);
}

const i18n = new I18n(translations);
i18n.locale = getDeviceLocale();
i18n.enableFallback = true;
i18n.defaultLocale = 'en';
i18n.missingBehavior = 'error';

export default i18n;
