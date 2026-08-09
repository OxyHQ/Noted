import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The app resolves `@/…` through babel-plugin-module-resolver, which vitest
  // does not run; without this the suite fails to load rather than fail an
  // assertion.
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
      // `react-native`'s entry point is Flow, which Vite cannot parse, so any
      // module that merely reads `Platform.OS` is otherwise unreachable from a
      // node test. Only the platform boundary is replaced; the code under test
      // is untouched.
      'react-native': path.resolve(import.meta.dirname, 'lib/__tests__/react-native-stub.ts'),
    },
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
