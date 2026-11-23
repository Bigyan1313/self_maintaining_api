import { defineConfig } from '@playwright/test';
const real = process.env.E2E_REAL === 'true';
export default defineConfig({
  testDir: './e2e',
  testMatch: real ? 'real.spec.ts' : 'dashboard.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    env: { VITE_USE_MOCKS: real ? 'false' : 'true', VITE_E2E_FIXTURES: real ? 'false' : 'true' },
  },
});
