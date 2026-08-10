/**
 * That the app's own native module can still be configured by Gradle.
 *
 * `modules/noted-capture` is the recorder. Nothing in CI builds Android — no
 * test, no typecheck and no bundle touches its `build.gradle` — so a change
 * there is invisible until somebody runs `expo run:android`, and what they get
 * is a build that fails before compiling a line of Kotlin. It had been failing
 * that way: the file called `safeExtGet('minSdkVersion', 24)`, which is a helper
 * each Expo package defines inside its OWN build file and no module inherits.
 *
 * This cannot run Gradle, so it holds the two CONFIGURATION shapes that broke
 * it, both one-line edits that look harmless in review. It cannot catch the
 * second bug found the same afternoon — a Kotlin type error in the same file —
 * and nothing short of compiling Android can. That is the honest gap: the
 * durable fix is an Android job in CI, and until there is one, this module is
 * only ever verified by somebody running `expo run:android` by hand.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MODULES = join(import.meta.dirname, '../../..', 'modules');

/** Every local native module's Android build file. */
const buildFiles = readdirSync(MODULES)
  .filter((entry) => statSync(join(MODULES, entry)).isDirectory() && !entry.startsWith('__'))
  .map((name) => ({ name, path: join(MODULES, name, 'android', 'build.gradle') }))
  .filter((module) => {
    try {
      statSync(module.path);
      return true;
    } catch {
      return false;
    }
  })
  .map((module) => ({ ...module, source: readFileSync(module.path, 'utf8') }));

describe('the local native modules', () => {
  it('are actually being read', () => {
    // A vacuity floor. A traversal that found nothing would pass every
    // assertion below, which is exactly what a renamed directory produces.
    expect(buildFiles.length).toBeGreaterThan(0);
    expect(buildFiles.map((module) => module.name)).toContain('noted-capture');
  });

  it.each(buildFiles.map((module) => [module.name, module] as const))(
    '%s calls no helper Gradle has never heard of',
    (_name, module) => {
      // `safeExtGet` is defined by each Expo package inside its own build file.
      // Calling it from a module that does not define it fails at CONFIGURATION,
      // so the error names a decorated `DefaultConfig` object and not the line
      // that caused it.
      expect(module.source).not.toMatch(/(?<!\.)\bsafeExtGet\s*\(/);
    },
  );

  it.each(buildFiles.map((module) => [module.name, module] as const))(
    '%s declares the versions the Expo plugin requires',
    (_name, module) => {
      // `expo-module-gradle-plugin` refuses to configure a module without them,
      // and the refusal surfaces as a failure in `node_modules/expo` rather than
      // here — which sends whoever hits it looking in the wrong package.
      expect(module.source).toMatch(/versionCode\s+\d+/);
      expect(module.source).toMatch(/versionName\s+['"]/);
    },
  );
});
