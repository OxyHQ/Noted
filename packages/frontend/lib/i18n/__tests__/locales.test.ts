import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// From the catalogue, not the entry point: the entry reaches
// `expo-localization`, and a question about which JSON files exist does not
// need a native module — importing one took the whole suite red on `main`.
import { resolveSupportedLocale, SUPPORTED_LOCALES } from '../catalogue';
import en from '../locales/en.json';

const localesDirectory = path.resolve(__dirname, '../locales');

function leafKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('translation catalogues', () => {
  it('ships a complete catalogue for every supported language', () => {
    const englishKeys = leafKeys(en).sort();

    for (const { code } of SUPPORTED_LOCALES) {
      const locale = JSON.parse(fs.readFileSync(path.join(localesDirectory, `${code}.json`), 'utf8'));
      const localeKeys = leafKeys(locale).filter((key) => !key.startsWith('meta.')).sort();
      expect(localeKeys, code).toEqual(englishKeys);
    }
  });

  it('supports fifteen major languages plus Catalan', () => {
    expect(SUPPORTED_LOCALES).toHaveLength(16);
    expect(SUPPORTED_LOCALES.map(({ code }) => code)).toContain('ca');
  });

  it('normalizes device and legacy regional locale tags', () => {
    expect(resolveSupportedLocale('pt-BR')).toBe('pt');
    expect(resolveSupportedLocale('zh-Hans-CN')).toBe('zh');
    expect(resolveSupportedLocale('es_MX')).toBe('es');
    expect(resolveSupportedLocale('unsupported')).toBe('en');
  });
});
