import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/ui',
  fullyParallel: true,
  workers: 3,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  snapshotPathTemplate: '{testDir}/../../docs/onboarding/approved/screenshots/{arg}{ext}',
  // Approved screenshots are immutable. Never accept a changed UI as its own baseline.
  updateSnapshots: 'none',
  use: {
    baseURL: process.env.HALO_TEST_BASE_URL ?? 'http://127.0.0.1:3010',
    browserName: 'chromium', channel: 'chrome',
    viewport: { width: 375, height: 850 },
    colorScheme: 'light', contextOptions: { reducedMotion: 'reduce' },
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
  webServer: process.env.HALO_TEST_BASE_URL ? undefined : {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3010',
    url: 'http://127.0.0.1:3010/onboarding/preview',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
