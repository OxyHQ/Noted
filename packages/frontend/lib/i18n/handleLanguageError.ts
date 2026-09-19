import { createLogger } from '@oxy.so/core/logger';

const logger = createLogger('NotedLanguage');

/**
 * `OxyProvider`'s `language` config reports a failed `onChange` here rather
 * than throwing into render — a rejected `setLocale` (a missing catalog
 * entry, say) must not take the whole app tree down over a chrome-language
 * mismatch. Its own module, not inline in `app/_layout.tsx`: that file pulls
 * in the whole native provider stack (fonts, gesture handling, the Oxy
 * runtime, …), which a test for this one pure function has no business
 * dragging in — and `vitest.config.ts` only collects `lib/**` anyway.
 */
export function handleLanguageError(error: unknown, locale: string): void {
  logger.error('Failed to follow the Oxy-resolved language', error, { locale });
}
