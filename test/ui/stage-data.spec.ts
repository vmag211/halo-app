import { expect, test } from '@playwright/test';
import type { Route } from '@playwright/test';
import { jsonRoute, mockStage, stageProfile, stageUserId } from './stage-fixtures';

const reading = (aqi = 73) => ({
  air: { aqi, severity: 'moderate', source: 'open-meteo', is_measured: false, dominant_pollutant: 'PM2.5', sentence: 'Current outdoor reading.' },
  uv: { index: 0, severity: 'good', peak_window: null },
  pollen: null, mold: null,
  score: { display_score: 63, severity: 'moderate', is_partial: true, missing_inputs: ['pollen', 'mold'], included_inputs: ['air', 'uv'], inputs: { air: 29, uv: 0, pollen: null, mold: null } },
  retrieved_at: '2026-10-01T14:00:00Z', cached: false,
});
const learned = (why: string | null) => ({ topic: 'air', title: 'Air quality', locale: 'en', what_it_is: 'General educational air information.', why_yours: why, household_note: null, protect: [], sources: [] });

test('production displays actual partial readings, zero UV, model provenance, and no fixture data', async ({ page }) => {
  const { requests, blocked } = await mockStage(page, { overrides: { '/api/daily-score': route => jsonRoute(route, reading()) } });
  await page.goto('/today');
  await expect(page.getByRole('link', { name: /Air quality\. Not scored\. 73 AQI/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /UV index\. Not scored\. 0\.0 UV index/ })).toBeVisible();
  await expect(page.getByText('Partial score. Missing inputs: pollen, mold.')).toBeVisible();
  await expect(page.getByText('Percentages compare the available risk readings, not portions of your final score.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Pollen\. No data/ })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Sample household');
  await expect(page.locator('body')).not.toContainText('September 30, 2026');
  await page.getByRole('link', { name: /Air quality\. Not scored\. 73 AQI/ }).click();
  await expect(page.locator('.halo-ph-reading-capsule b')).toHaveText('73');
  await expect(page.getByText('Open-Meteo', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('This is a modeled estimate.', { exact: true })).toBeVisible();
  expect(requests.some(request => request.path.startsWith('/api/daily-score'))).toBe(true);
  expect(blocked).toEqual([]);
  expect(requests.every(request => request.method === 'GET')).toBe(true);
});

test('a confirmed missing location redirects to onboarding and clears stale readings', async ({ page }) => {
  const { blocked } = await mockStage(page, { overrides: { '/api/daily-score': route => jsonRoute(route, { error: 'private server text' }, 400) } });
  await page.goto('/today');
  await expect(page).toHaveURL(/\/onboarding\?entry=1&next=%2Ftoday/);
  await expect(page.locator('body')).not.toContainText('private server text');
  const caches = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('halo.frontend.v1.')));
  expect(caches).toEqual([]); expect(blocked).toEqual([]);
});

test('profile failure without a completed marker returns to entry instead of treating fixture household as real', async ({ page }) => {
  await mockStage(page, { overrides: { '/api/profile': route => jsonRoute(route, { error: 'not for display' }, 503) } });
  await page.goto('/factors/air');
  await expect(page).toHaveURL(/\/onboarding\?entry=1&next=%2Ffactors%2Fair/);
  await expect(page.locator('body')).not.toContainText('not for display');
  await expect(page.locator('body')).not.toContainText('37 AQI');
});

test('verified device can read its cached evidence during profile outage without household claims', async ({ page }) => {
  await mockStage(page, { overrides: {
    '/api/profile': route => jsonRoute(route, { error: 'temporary outage' }, 503),
    '/api/daily-score': route => jsonRoute(route, { error: 'temporary outage' }, 503),
    '/api/home-guard': route => jsonRoute(route, { error: 'temporary outage' }, 503),
  } });
  await page.addInitScript(({ id, data }) => {
    localStorage.setItem('halo.onboarded', JSON.stringify({ version: 1, identity: id, complete: true }));
    localStorage.setItem(`halo.frontend.v1.${id}.daily`, JSON.stringify({ version: 1, data, receivedAt: '2026-10-01T14:00:00Z', retrievedAt: data.retrieved_at }));
  }, { id: stageUserId, data: reading(61) });
  await page.goto('/today');
  await expect(page.getByRole('link', { name: /Air quality\. Not scored\. 61 AQI/ })).toBeVisible();
  await expect(page.getByText(/Your profile could not be checked/)).toBeVisible();
  await expect(page.getByText(/General household guidance/)).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Young children and adults');
  await expect(page).toHaveURL(/\/today$/);
});

test('refresh aborts the prior Learn request before it can publish old reading context', async ({ page }) => {
  let dailyCount = 0; let learnCount = 0; let release: (() => void) | undefined;
  const wait = new Promise<void>(resolve => { release = resolve; });
  await mockStage(page, { overrides: {
    '/api/daily-score': route => jsonRoute(route, reading(++dailyCount === 1 ? 44 : 85)),
    '/api/learn': async (route, url) => {
      // A later history response can restart Learn for the same reading. Hold
      // every old-context request so the test checks cancellation, not timing.
      if (url.searchParams.get('value') === '44') { ++learnCount; await wait; await jsonRoute(route, learned('OLD_PRIVATE_READING_CONTEXT')).catch(() => {}); }
      else await jsonRoute(route, learned('The current AQI explanation is for 85.'));
    },
  } });
  await page.goto('/factors/air');
  await expect(page.locator('.halo-ph-reading-capsule b')).toHaveText('44');
  await expect.poll(() => learnCount).toBeGreaterThanOrEqual(1);
  await page.evaluate(() => {
    Object.assign(window, { stageOldContextRendered: false });
    new MutationObserver(() => { if (document.body.textContent?.includes('OLD_PRIVATE_READING_CONTEXT')) Object.assign(window, { stageOldContextRendered: true }); }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.getByRole('button', { name: 'Refresh readings', exact: true }).click();
  release?.();
  await expect(page.locator('.halo-ph-reading-capsule b')).toHaveText('85');
  await expect(page.getByText('The current AQI explanation is for 85.')).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { stageOldContextRendered?: boolean }).stageOldContextRendered)).toBe(false);
});

test('identity notification synchronously hides household explanation while the next profile loads', async ({ page }) => {
  let profileCount = 0; let pendingProfile: Route | undefined;
  await mockStage(page, { overrides: {
    '/api/profile': async route => { if (++profileCount === 1) await jsonRoute(route, stageProfile); else pendingProfile = route; },
    '/api/daily-score': route => jsonRoute(route, reading()),
    '/api/learn': route => jsonRoute(route, learned('PRIVATE_HOUSEHOLD_EXPLANATION')),
  } });
  await page.goto('/factors/air');
  await expect(page.getByText('PRIVATE_HOUSEHOLD_EXPLANATION')).toBeVisible();
  const visibleAfterEvent = await page.evaluate(() => {
    window.dispatchEvent(new Event('halo:identity-changed'));
    return document.body.textContent?.includes('PRIVATE_HOUSEHOLD_EXPLANATION');
  });
  expect(visibleAfterEvent).toBe(false);
  await expect(page.getByRole('status', { name: 'Checking your profile' })).toBeVisible();
  await expect.poll(() => !!pendingProfile).toBe(true);
  await jsonRoute(pendingProfile!, { onboarded: false, onboarding_complete: false, profile: null, household: {}, household_set: false });
  await expect(page).toHaveURL(/\/onboarding\?entry=1/);
});

test('unknown factor and household routes render only a 404 without loading household data', async ({ page }) => {
  const { requests, blocked } = await mockStage(page);
  for (const path of ['/factors/not-a-factor', '/household/not-a-member']) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: '404', exact: true })).toBeVisible();
    await expect(page.getByTestId('stage-product')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toHaveCount(0);
  }
  expect(requests).toEqual([]);
  expect(blocked).toEqual([]);
});

test('rate-limit countdown expires after a successful soft refresh clears the error', async ({ page }) => {
  await page.clock.install();
  let dailyCalls = 0;
  await mockStage(page, { overrides: {
    '/api/daily-score': route => ++dailyCalls === 2
      ? jsonRoute(route, { error: 'Readings were just refreshed.', retry_after_seconds: 300 }, 429)
      : jsonRoute(route, reading()),
  } });
  await page.goto('/today');
  const refresh = page.locator('.halo-stage-refresh button');
  await expect(refresh).toHaveText('Refresh readings');
  await refresh.click();
  await expect(refresh).toHaveText(/Try again in \d+s/);
  await expect(refresh).toBeDisabled();
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/daily-score' && response.status() === 200);
  await page.evaluate(() => window.dispatchEvent(new Event('halo:settings-changed')));
  await refreshed;
  await expect.poll(() => dailyCalls).toBe(3);
  await expect(refresh).not.toHaveText('Updating readings');
  await page.clock.fastForward(301_000);
  await expect(refresh).toHaveText('Refresh readings');
  await expect(refresh).toBeEnabled();
});
