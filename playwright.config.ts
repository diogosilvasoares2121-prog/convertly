import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests run the real built extension (dist/) in Chromium, with the
 * network forced offline. See tests/e2e/fixtures.ts.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }], ['json', { outputFile: 'e2e-results/results.json' }]],
  use: {
    trace: 'retain-on-failure',
    actionTimeout: 30_000,
  },
});
