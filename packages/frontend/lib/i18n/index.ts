import { I18n } from 'i18n-js';
import { getLocales } from 'expo-localization';

import { resolveSupportedLocale, type SupportedLocale } from '@/lib/i18n/catalogue';
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

export { resolveSupportedLocale, SUPPORTED_LOCALES } from '@/lib/i18n/catalogue';
export type { SupportedLocale } from '@/lib/i18n/catalogue';

const translations = { ar, bn, ca, de, en, es, fr, hi, id, ja, mr, pt, ru, sw, ur, zh };

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
