import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // test/fixtures holds throwaway repos whose tests run only inside the validator container.
    exclude: [...configDefaults.exclude, 'test/fixtures/**'],
    // Resets and migrates the dedicated `sma_test` database once before the suite.
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 15_000,
    hookTimeout: 60_000,
  },
});
