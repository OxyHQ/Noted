import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The app resolves `@/…` through babel-plugin-module-resolver, which vitest
  // does not run; without this the suite fails to load rather than fail an
  // assertion.
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, '.') },
  },
  test: {
    globals: true,
    environment: 'node',
    // Scoped to the platform-free logic. Anything importing expo-sqlite, React
    // Native or a native module belongs in a device run, not here — a green
    // suite built on mocks of those would only be testing the mocks.
    include: ['lib/**/__tests__/**/*.test.ts', 'lib/**/*.test.ts'],
  },
});
