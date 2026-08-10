/**
 * Which languages the app ships, and how a device tag maps onto them.
 *
 * Its own module because it is pure data and a pure function, while
 * `index.ts` reaches `expo-localization` to ask what the device is set to.
 * A test about which catalogues exist has no business loading a native
 * module — and when it did, it failed with `__DEV__ is not defined` and took
 * the whole suite red on `main`, over a question answerable from JSON files.
 *
 * The boundary is the one `vitest.config.ts` already states: platform-free
 * logic is testable in node, anything touching a native module belongs to a
 * device run.
 */

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

const supportedCodes = new Set<string>(SUPPORTED_LOCALES.map(({ code }) => code));

/** Converts a device BCP-47 tag (such as pt-BR) to a supported language. */
export function resolveSupportedLocale(locale?: string | null): SupportedLocale {
  const language = locale?.trim().toLowerCase().split(/[-_]/)[0];
  return (language && supportedCodes.has(language) ? language : 'en') as SupportedLocale;
}
