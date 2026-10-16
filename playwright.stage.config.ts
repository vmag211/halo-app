import { defineConfig } from '@playwright/test';

const stageTestUrl=process.env.HALO_STAGE_TEST_URL??'http://127.0.0.1:3014';
if(!['127.0.0.1','localhost'].includes(new URL(stageTestUrl).hostname))throw new Error('Stage frontend tests require an isolated local server.');

export default defineConfig({
  testDir: './test/ui', testMatch: ['stage-*.spec.ts', 'luna-live.spec.ts'],
  fullyParallel: true, workers: 2, timeout: 45000, expect: { timeout: 10000 },
  outputDir: 'test-results/stage', reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/stage' }]],
  updateSnapshots: 'none',
  use: { baseURL: stageTestUrl, browserName: 'chromium', channel: 'chrome', viewport: { width: 375, height: 850 }, colorScheme: 'light', contextOptions: { reducedMotion: 'reduce', serviceWorkers: 'block' }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: process.env.HALO_STAGE_EXTERNAL_SERVER === '1' ? undefined : { command: 'node scripts/stage-test-server.mjs', url: 'http://127.0.0.1:3014/onboarding/preview', reuseExistingServer: false, timeout: 240000 },
});
