import { createRequire } from 'node:module';

import { afterEach, expect, it } from 'vitest';

import appJson from '../../app.json';

type ExpoConfig = {
  name?: string;
  ios?: { bundleIdentifier?: string };
  android?: { package?: string };
};

const require = createRequire(import.meta.url);
const configPath = require.resolve('../../app.config.js');
const previousVariant = process.env.APP_VARIANT;

afterEach(() => {
  if (previousVariant === undefined) delete process.env.APP_VARIANT;
  else process.env.APP_VARIANT = previousVariant;
});

/** app.config.js resolved over app.json, read fresh under the given APP_VARIANT. */
function resolveConfig(variant?: string): ExpoConfig {
  if (variant === undefined) delete process.env.APP_VARIANT;
  else process.env.APP_VARIANT = variant;
  delete require.cache[configPath];
  const build = require(configPath) as (context: { config: ExpoConfig }) => ExpoConfig;
  return build({ config: structuredClone(appJson.expo) as ExpoConfig });
}

it('production is so.oxy.noted on both platforms', () => {
  const expo = resolveConfig();
  expect(expo.android?.package).toBe('so.oxy.noted');
  expect(expo.ios?.bundleIdentifier).toBe('so.oxy.noted');
  expect(expo.name).toBe('Noted');
});

it('APP_VARIANT=development is so.oxy.noted.dev with its own name', () => {
  const expo = resolveConfig('development');
  expect(expo.android?.package).toBe('so.oxy.noted.dev');
  expect(expo.ios?.bundleIdentifier).toBe('so.oxy.noted.dev');
  expect(expo.name).toBe('Noted (Dev)');
});
