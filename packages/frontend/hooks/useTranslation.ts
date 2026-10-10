import { useCallback } from 'react';
import i18n from '@/lib/i18n';
import { useI18nStore } from '@/lib/stores/i18n-store';

/**
 * Custom hook for using translations in components.
 * Uses Zustand store so locale changes propagate to ALL components.
 */
export function useTranslation() {
  const locale = useI18nStore((s) => s.locale);
  const setLocale = useI18nStore((s) => s.setLocale);

  // Stable until the language changes. The store's locale is passed rather
  // than read from `i18n.locale` (the store keeps the two in step), so it is a
  // real input: hooks that list `t` re-run on a language switch and on nothing
  // else. A fresh function per render made every such hook re-run each render.
  const t = useCallback(
    (key: string, params?: Record<string, unknown>) => i18n.t(key, { ...params, locale }),
    [locale],
  );

  return { t, locale, changeLocale: setLocale };
}
