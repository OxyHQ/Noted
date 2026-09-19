/**
 * That `OxyProvider` is actually told to follow the Oxy-resolved language.
 *
 * Oxy resolves which language the app shows (the signed-in account's primary
 * locale, or the device/guest locale when signed out) and calls back into
 * whatever `onChange` the `language` prop names — Noted keeps its own
 * `i18n-js` catalogue and store untouched, and only has to wire that one
 * callback to `useI18nStore`. A source check, because the provider tree
 * (fonts, splash screen, the Oxy runtime, …) is not reachable from this node
 * suite, and the bug this protects against — the prop silently missing, or
 * pointed at the wrong store method — has no other test surface.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HERE = import.meta.dirname;
const read = (path: string): string => readFileSync(join(HERE, '..', '..', path), 'utf8');

const ROOT_LAYOUT = read('app/_layout.tsx');

describe('the file this checks', () => {
  it('is the file it thinks it is', () => {
    expect(ROOT_LAYOUT).toContain('function RootLayout');
    expect(ROOT_LAYOUT).toContain('<OxyProvider');
  });
});

describe('the language config', () => {
  it('is passed to OxyProvider, not merely imported', () => {
    const providerAt = ROOT_LAYOUT.indexOf('<OxyProvider');
    const languageAt = ROOT_LAYOUT.indexOf('language={{');
    const closingAt = ROOT_LAYOUT.indexOf('</OxyProvider>');

    expect(providerAt).toBeGreaterThanOrEqual(0);
    expect(languageAt).toBeGreaterThan(providerAt);
    expect(languageAt).toBeLessThan(closingAt);
  });

  it('follows the catalogue this app actually ships, not a hardcoded list', () => {
    expect(ROOT_LAYOUT).toContain("import { SUPPORTED_LOCALES } from '@/lib/i18n'");
    expect(ROOT_LAYOUT).toContain('supportedLocales: SUPPORTED_LANGUAGE_CODES');
  });

  it('writes a resolved locale into the app store, not just local state', () => {
    expect(ROOT_LAYOUT).toContain("import { useI18nStore } from '@/lib/stores/i18n-store'");
    expect(ROOT_LAYOUT).toContain('useI18nStore.getState().setLocale(locale)');
  });

  it('reports a failed onChange instead of leaving it unhandled', () => {
    expect(ROOT_LAYOUT).toContain(
      "import { handleLanguageError } from '@/lib/i18n/handleLanguageError'",
    );
    expect(ROOT_LAYOUT).toContain('onError: handleLanguageError');
  });
});
