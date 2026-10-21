import { expect, test } from '@playwright/test';
import { mockProduction } from './production-fixtures';
import { jsonRoute } from './stage-fixtures';

/** Regressions found on the live Explore pass, 2026-10-21. */
const unavailable = { error:'Saving workspace records is not available yet.', code:'feature_unavailable', message:'Saving workspace records is not available yet.', field_errors:[], retryable:false };
const meck = { id:'us-county:37119', place:'Mecklenburg County', state:'NC', label:'Mecklenburg County, NC', timezone:'America/New_York' };

for (const viewport of [{ width:390, height:844 }, { width:1440, height:900 }]) test(`the Get involved search keeps its icon inside one borderless field at ${viewport.width}px`, async ({ page }) => {
  await page.setViewportSize(viewport);
  const listings = (route: Parameters<typeof jsonRoute>[0]) => jsonRoute(route, { ...unavailable, error:'Local listings are not available yet.', message:'Local listings are not available yet.' }, 503);
  const network = await mockProduction(page, { '/api/opportunities': listings, '/api/explore/organizations': listings });
  await page.goto('/app/explore/activities?view=main');
  const label = page.locator('label.ex-opportunity-search');
  const input = label.locator('input[type="search"]');
  await expect(input).toBeVisible();
  expect(await label.evaluate(element => getComputedStyle(element).display)).toBe('flex');
  expect(await input.evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('0px');
  const icon = await label.locator('svg').boundingBox(), field = await input.boundingBox();
  expect(icon && field).toBeTruthy();
  expect(icon!.y + icon!.height / 2).toBeGreaterThan(field!.y);
  expect(icon!.y + icon!.height / 2).toBeLessThan(field!.y + field!.height);
  expect(icon!.x + icon!.width).toBeLessThanOrEqual(field!.x + 1);
  expect(network.blocked).toEqual([]);
});

test('a notebook that could not load says so instead of looking empty', async ({ page }) => {
  let collectionFails = true;
  const network = await mockProduction(page, {
    '/api/frontend/workspace': route => collectionFails ? jsonRoute(route, unavailable, 503) : jsonRoute(route, { records:[], revision:1, availability:'ready', complete:true, pendingOperations:[] }),
  });
  await page.goto('/app/explore/notes?view=main');
  await expect(page.getByRole('heading', { name:'Your notes could not load' })).toBeVisible();
  await expect(page.getByText('Your notebook is ready')).toHaveCount(0);
  collectionFails = false;
  await page.getByRole('button', { name:'Try again', exact:true }).click();
  await expect(page.getByText('Your notebook is ready')).toBeVisible();
  await expect(page.getByRole('heading', { name:'Your notes could not load' })).toHaveCount(0);
  expect(network.blocked).toEqual([]);
});

test('an area save sends its revision as X-Halo-If-Match, never If-Match, and closes on success', async ({ page }) => {
  const saves: Record<string,string>[] = [];
  const network = await mockProduction(page, {
    '/api/explore/area': async route => {
      if (route.request().method() === 'GET') return jsonRoute(route, { revision:1, place:null });
      saves.push(route.request().headers());
      return jsonRoute(route, { place:meck, revision:2 });
    },
    '/api/locations/search': route => jsonRoute(route, { candidates:[meck] }),
  });
  await page.goto('/app/explore');
  await page.getByRole('button', { name:'Choose an area', exact:true }).click();
  await page.getByLabel('City or county').fill('Mecklenburg');
  await page.getByRole('button', { name:'Use this area', exact:true }).click();
  await page.getByRole('button', { name:'Mecklenburg County, NC' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.ex-area-toggle')).toContainText('Mecklenburg County, NC');
  expect(saves).toHaveLength(1);
  expect(saves[0]['x-halo-if-match']).toBe('1');
  expect(saves[0]['if-match']).toBeUndefined();
  expect(network.blocked).toEqual([]);
});

test('the map source note sits with the layer count, not loose above the tools', async ({ page }) => {
  const note = '1 of 2 systems have no mapped service area; they carry severity but no coordinates.';
  const network = await mockProduction(page, {
    '/api/map': (route, url) => jsonRoute(route, { layer:url.searchParams.get('layer') ?? 'water', features:[], assembled_at:'2026-10-13T14:00:00Z', note }),
  });
  await page.goto('/map?access=owned&layer=water');
  const placed = page.locator('.halo-map-top .halo-map-count .halo-map-source-note');
  await expect(placed).toHaveText(note);
  await expect(page.locator('.halo-map-main > p.halo-map-count')).toHaveCount(0);
  expect(network.blocked).toEqual([]);
});

test('moving between Explore views starts the new view at its top', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const network = await mockProduction(page);
  await page.goto('/app/explore');
  await page.locator('.ex-community-bridge').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  await page.locator('.ex-community-bridge').click();
  await expect(page.getByRole('heading', { name: 'Your community' })).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(5);
  await page.getByRole('button', { name: /Keep this question in My notes/ }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: /Keep this question in My notes/ }).click();
  await expect(page.getByLabel('Title (required)')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(5);
  expect(network.blocked).toEqual([]);
});

test('the hub map preview says when a layer has no mapped records instead of showing a bare map', async ({ page }) => {
  // Live, 2026-10-21: the stored facilities layer was complete with 0 features until the daily rebuild.
  const network = await mockProduction(page, { '/api/map': (route, url) => jsonRoute(route, url.searchParams.get('layer') === 'facilities'
    ? { count:0, layer:'facilities', scope:'NC-08', features:[], selection:'Active major facilities and repeat violators.', assembled_at:'2026-10-21T01:24:01.962Z', prebuilt:true }
    : { layer:url.searchParams.get('layer') ?? 'water', features:[], assembled_at:'2026-10-13T14:00:00Z' }) });
  await page.goto('/app/explore');
  await page.getByLabel('Preview map layer').selectOption('facilities');
  await expect(page.locator('.ex-map-layer-description')).toHaveText('No mapped records in this layer right now. Open the map for its source note.');
  expect(network.blocked).toEqual([]);
});
