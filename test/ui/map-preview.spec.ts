import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

// These are editable wireframe interaction checks, not approved visual baselines.
// Never let a fixture test reach live auth, API providers, or external map tiles.
const observations = new WeakMap<Page, { forbidden: string[]; errors: string[] }>();
test.beforeEach(async ({ page }) => {
  const state = { forbidden: [] as string[], errors: [] as string[] };
  observations.set(page, state);
  page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/') || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
      state.forbidden.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      await route.abort();
      return;
    }
    await route.continue();
  });
});
test.afterEach(async ({ page }) => {
  expect(observations.get(page)?.forbidden, 'Preview must not request external providers or live APIs').toEqual([]);
  expect(observations.get(page)?.errors, 'No uncaught browser errors').toEqual([]);
});

async function openMap(page: Page, query = '') {
  await page.goto(`/foundation/preview/map?layer=water&appearance=dark&motion=reduce&${query}`);
  await expect(page.getByTestId('map-product')).toBeVisible();
  await expect(page).toHaveURL(/mapScenario=/);
}
async function openReadyMap(page: Page, query = '') {
  await openMap(page, query);
  await expect(page.getByText('Loading map data.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('application')).toBeVisible();
}
async function assertFits(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  const dialog = page.getByRole('dialog');
  if (await dialog.count()) {
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
  }
}
async function scratchScreenshot(page: Page, name: string) {
  const directory = resolve('test-results/map-review');
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, `${name}.png`), animations: 'disabled', fullPage: true });
}

test('four layers support keyboard navigation, wrap, and reset water filters', async ({ page }) => {
  await openReadyMap(page);
  const group = page.getByRole('radiogroup', { name: 'Map layer' });
  await expect(group.getByRole('radio')).toHaveCount(4);
  await page.getByLabel('Water comparison', { exact: true }).selectOption('pfos');
  await group.getByRole('radio', { name: 'Water', exact: true }).focus();
  for (const name of ['Radon', 'Facilities', 'Air', 'Water']) {
    await page.keyboard.press('ArrowRight');
    await expect(group.getByRole('radio', { name, exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(group.getByRole('radio', { name, exact: true })).toBeFocused();
  }
  await expect(page.getByLabel('Water comparison', { exact: true })).toHaveValue('overall');
  await expect(page.getByRole('slider', { name: 'Water sample quarter' })).toHaveAttribute('aria-valuetext', 'Latest');
});

test('all seven water comparisons and layer-specific legends are available', async ({ page }) => {
  await openReadyMap(page);
  const comparison = page.getByLabel('Water comparison', { exact: true });
  await expect(comparison.locator('option')).toHaveCount(7);
  for (const value of ['overall', 'pfoa', 'pfos', 'pfhxs', 'pfna', 'genx', 'hazard']) {
    await comparison.selectOption(value);
    await expect(comparison).toHaveValue(value);
    if (value !== 'overall') expect(new URL(page.url()).searchParams.get('contaminant')).toBe(value);
  }
  await page.getByRole('button', { name: 'Standard change information' }).click();
  await expect(page.getByRole('dialog')).toContainText('proposed change');
  await page.getByRole('button', { name: 'Close sheet' }).click();
  for (const [layer, meaning] of [['Radon', 'regional potential'], ['Facilities', 'not every regulated site'], ['Air', 'monitoring stations']]) {
    await page.getByRole('radio', { name: layer, exact: true }).click();
    await page.getByRole('button', { name: 'Legend', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText(meaning);
    await page.getByRole('button', { name: 'Close sheet' }).click();
  }
});

test('list search includes unlocated systems and distinguishes zero from missing water results', async ({ page }) => {
  await openReadyMap(page);
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await page.getByRole('searchbox').fill('Unmapped');
  await expect(page.locator('.halo-map-results > button')).toHaveCount(2);
  await page.getByRole('button', { name: /Unmapped Community Water/ }).click();
  await expect(page.getByRole('dialog')).toContainText('No mapped location');
  await expect(page.getByRole('dialog')).toContainText('6.2 ppt');
  await page.getByRole('button', { name: 'Close sheet' }).click();
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await page.getByRole('searchbox').fill('Does not exist');
  await expect(page.getByRole('status').filter({ hasText: 'No matching locations' })).toBeVisible();
  await openReadyMap(page, 'system=SAMPLE-04');
  await expect(page.getByRole('dialog')).toContainText('0 ppt');
  await expect(page.getByRole('dialog')).toContainText('No detection reported');
  await expect(page.getByRole('img', { name: /^0 ppt, supplied limit 4 ppt/ })).toBeVisible();
  await openReadyMap(page, 'system=SAMPLE-13');
  await expect(page.getByRole('dialog')).toContainText('Population served: No data');
  await expect(page.getByRole('dialog')).toContainText('No date available');
  await expect(page.getByRole('dialog')).not.toContainText('0 ppt');
  await openReadyMap(page, 'system=SAMPLE-06');
  await expect(page.getByRole('dialog')).toContainText('Detected, not scored');
  await expect(page.getByRole('dialog')).toContainText('Lithium');
});

for (const feature of [
  { layer: 'water', id: 'SAMPLE-01', title: 'Meadow Water', copy: 'Latest sample:' },
  { layer: 'radon', id: 'Union County', title: 'Union County', copy: 'County-level radon potential' },
  { layer: 'facilities', id: 'facility-1', title: 'Piedmont Works (sample)', copy: '6 of 12' },
  { layer: 'air', id: 'air-1', title: 'Meadow monitoring station (sample)', copy: 'PM2.5' },
  { layer: 'water', id: 'home', title: 'Your home', copy: 'Today score from the sample session' },
]) test(`direct-linked ${feature.layer} ${feature.id} details close without navigating away`, async ({ page }) => {
  await page.goto(`/foundation/preview/map?layer=${feature.layer}&system=${encodeURIComponent(feature.id)}&motion=reduce`);
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { name: feature.title, exact: true })).toBeVisible();
  await expect(sheet).toContainText(feature.copy);
  const history = await page.evaluate(() => window.history.length);
  await sheet.getByRole('button', { name: 'Close sheet' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(/\/foundation\/preview\/map/);
  expect(new URL(page.url()).searchParams.has('system')).toBeFalsy();
  expect(await page.evaluate(() => window.history.length)).toBe(history);
});

test('layer result lists open each kind of feature without stacking sheets', async ({ page }) => {
  await openReadyMap(page);
  for (const [layer, name, copy] of [
    ['Water', 'Meadow Water', '5.8 ppt'], ['Radon', 'Union County', 'County-level radon potential'],
    ['Facilities', 'Piedmont Works (sample)', 'Programs currently in violation'], ['Air', 'Meadow monitoring station (sample)', 'Dominant pollutant'],
  ]) {
    await page.getByRole('radio', { name: layer, exact: true }).click();
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await page.getByRole('searchbox').fill(name);
    await page.locator('.halo-map-results > button').first().click();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(page.getByRole('dialog')).toContainText(copy);
    await page.getByRole('button', { name: 'Close sheet' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});

test('fit and previous view preserve filters and return to the same rendered atlas', async ({ page }) => {
  await openReadyMap(page, 'contaminant=pfoa');
  await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-fonts','ready');
  await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-context','ready');
  const initial=await page.getByRole('application').screenshot();
  await expect(page.getByRole('button',{name:'Previous view',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Fit layer',exact:true}).click();
  await expect(page.getByTestId('map-canvas')).not.toHaveAttribute('data-zoom','8');
  await expect(page.getByLabel('Water comparison',{exact:true})).toHaveValue('pfoa');
  await page.getByRole('button',{name:'Previous view',exact:true}).click();
  await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-zoom','8');
  expect(createHash('sha256').update(await page.getByRole('application').screenshot()).digest('hex')).toBe(createHash('sha256').update(initial).digest('hex'));
  await expect(page.getByRole('button',{name:'Previous view',exact:true})).toBeDisabled();
});

test('record search intersects visible scope, recovers empty matches and sorts missing positions last', async ({ page }) => {
  await openReadyMap(page);
  await page.getByRole('button',{name:'Find a location',exact:true}).click();
  const rows=page.locator('.halo-map-results > button');
  await expect(rows).toHaveCount(15);
  await page.getByRole('button',{name:'In this view',exact:true}).click();
  expect(await rows.count()).toBeLessThan(15);
  await page.getByRole('searchbox').fill('unmapped');
  await expect(rows).toHaveCount(0);
  await page.getByRole('button',{name:'Show all records',exact:true}).click();
  await expect(rows).toHaveCount(15);
  await page.getByLabel('Sort results',{exact:true}).selectOption('nearest');
  await expect(rows.nth(13)).toContainText('No mapped location');
  await expect(rows.nth(14)).toContainText('No mapped location');
  await expect(page.getByRole('dialog')).toContainText('not necessarily your supplier');
  await page.getByRole('searchbox').fill('sample-04 longleaf');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Longleaf');
});

test('focus a searched public record, then return without putting household coordinates in the URL', async ({ page }) => {
  await openReadyMap(page,'contaminant=pfoa');
  await page.getByRole('button',{name:'Find a location',exact:true}).click();
  await page.getByRole('searchbox').fill('Longleaf');
  await page.locator('.halo-map-results > button').click();
  await page.getByRole('button',{name:'Focus on map',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-selection','SAMPLE-04');
  await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-zoom','10');
  expect(new URL(page.url()).searchParams.has('lat')).toBe(false);
  expect(new URL(page.url()).searchParams.has('lng')).toBe(false);
  await expect(page.getByRole('application')).toBeFocused();
  await page.getByRole('button',{name:'Previous view',exact:true}).click();
  await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-zoom','8');
  await expect(page.getByTestId('map-canvas')).not.toHaveAttribute('data-selection');
});

test('unlocated records stay useful but cannot claim a map position', async ({ page }) => {
  await openReadyMap(page,'system=SAMPLE-14');
  await expect(page.getByRole('button',{name:'Focus on map',exact:true})).toBeDisabled();
  await expect(page.getByRole('dialog')).toContainText('No mapped location is available');
});

test('labels are optional, the symbol key matches the layer, and numbers use app fonts', async ({ page }) => {
  await openReadyMap(page);
  await page.getByRole('button',{name:'Show map labels',exact:true}).click();
  await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-labels','hidden');
  await expect(page.getByRole('button',{name:'Show map labels',exact:true})).toHaveAttribute('aria-pressed','false');
  const font=await page.getByRole('application').evaluate(el=>getComputedStyle(el).fontFamily);
  expect(font).toMatch(/onest/i);
  expect(await page.getByTestId('map-product').evaluate(el=>getComputedStyle(el).fontVariantNumeric)).toContain('tabular-nums');
  for(const layer of ['Water','Facilities','Air','Radon']){
    await page.getByRole('radio',{name:layer,exact:true}).click();
    await expect(page.locator(`.halo-map-key .halo-map-symbol[data-layer="${layer.toLowerCase()}"]`).first()).toBeVisible();
    await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-labels','hidden');
  }
});

for(const [width,scale] of [[320,150],[375,100],[1440,100]]) test(`new map tools and record finder fit ${width}px at ${scale}%`,async({page})=>{
  await page.setViewportSize({width,height:850});
  await openReadyMap(page,`scale=${scale}`);
  await expect(page.getByRole('button',{name:'Fit layer',exact:true})).toBeVisible();
  await assertFits(page);
  await page.getByRole('button',{name:'Find a location',exact:true}).click();
  await assertFits(page);
  await page.getByRole('searchbox').fill('water');
  await assertFits(page);
  await scratchScreenshot(page,`finder-${width}-${scale}`);
});

test('Learn replaces location sheet, keeps context, traps focus, and browser Back closes once', async ({ page }) => {
  await openReadyMap(page, 'contaminant=pfos');
  const initialLength = await page.evaluate(() => window.history.length);
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await page.getByRole('searchbox').fill('Meadow Water');
  await page.locator('.halo-map-results > button').click();
  await page.getByRole('button', { name: 'Understand these water results' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('dialog')).toContainText('PFOS 8.3 ppt');
  expect(await page.evaluate(() => window.history.length)).toBe(initialLength + 1);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBeTruthy();
  await page.getByText('What this information cannot tell you', { exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('cannot confirm the concentration at your tap');
  await page.getByRole('button', { name: 'Back to location' }).click();
  await expect(page.getByRole('dialog')).toContainText('5.8 ppt');
  await page.getByRole('button', { name: 'Understand these water results' }).click();
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Water comparison', { exact: true })).toHaveValue('pfos');
});

test('district includes nine counties, five expandable compounds, unlocated context and county navigation', async ({ page }) => {
  await openReadyMap(page);
  await page.getByRole('button', { name: 'See the full NC-08 picture' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.locator('.halo-map-district-county')).toHaveCount(9);
  await expect(sheet.locator('.halo-map-district-partial')).toHaveCount(3);
  await expect(sheet.locator('.halo-map-district-compound')).toHaveCount(5);
  await sheet.locator('.halo-map-district-compound summary').first().click();
  await expect(sheet.locator('.halo-map-district-compound[open]')).toContainText('2 of 5 systems');
  await sheet.getByText('See the unlocated sample systems', { exact: true }).click();
  await expect(sheet).toContainText('Unmapped Community Water');
  await expect(sheet).toContainText('membership is unknown');
  await sheet.getByRole('button', { name: 'Explore Union County on the map' }).click();
  await expect(sheet).toHaveCount(1);
  await expect(sheet).toContainText('County-level radon potential');
  await expect(page).toHaveURL(/layer=radon/);
  await page.goBack();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Water', exact: true })).toHaveAttribute('aria-checked', 'true');
});

for (const [scenario, expected] of [
  ['ready', '66,600'], ['population-missing', 'Population served is unavailable'],
  ['population-partial', 'At least'], ['district-zero', 'No over-limit result was returned'],
  ['district-error', 'District information could not load'], ['district-geography', 'The district picture is incomplete'],
  ['comparison-missing', 'No substitute percentage is shown'],
]) test(`district ${scenario} never substitutes fabricated totals`, async ({ page }) => {
  await openMap(page, `mapScenario=${scenario}&panel=district`);
  const sheet = page.getByRole('dialog');
  await expect(sheet).toContainText(expected);
  if (scenario === 'district-error' || scenario === 'district-geography') {
    await expect(sheet.locator('.halo-map-district-total')).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Try district again' }).click();
    await expect(sheet.locator('.halo-map-district-total')).toHaveText('66,600');
  } else if (scenario === 'district-zero') {
    await expect(sheet.locator('.halo-map-district-total')).toHaveText('0');
  } else if (scenario === 'comparison-missing') {
    await expect(sheet.locator('.halo-map-district-bar-row')).toHaveCount(0);
  }
});

test('quarter keyboard selection shows pending then commits, with Latest reset', async ({ page }) => {
  await openReadyMap(page);
  const quarter = page.getByRole('slider', { name: 'Water sample quarter' });
  await quarter.focus();
  await quarter.press('ArrowLeft');
  await expect(page.locator('.halo-map-timeline')).toContainText('Loading Q4 2025');
  await expect(page).toHaveURL(/quarter=2025Q4/);
  await expect(quarter).toHaveAttribute('aria-valuetext', 'Q4 2025');
  await page.getByRole('button', { name: 'Return to latest samples' }).click();
  await expect(quarter).toHaveAttribute('aria-valuetext', 'Latest');
  await expect(page).not.toHaveURL(/quarter=/);
});

test('failed quarter restores selection and existing readings; an empty quarter is not an all-clear', async ({ page }) => {
  await openReadyMap(page, 'mapScenario=quarter-error');
  const quarter = page.getByRole('slider', { name: 'Water sample quarter' });
  await quarter.focus(); await quarter.press('ArrowLeft');
  await expect(page.getByRole('status').filter({ hasText: 'That quarter could not load' })).toBeVisible();
  await expect(quarter).toHaveAttribute('aria-valuetext', 'Latest');
  await expect(page).not.toHaveURL(/quarter=/);
  await expect(page.locator('.halo-map-count')).toContainText('15 systems');
  await openReadyMap(page, 'mapScenario=quarter-empty');
  await quarter.focus(); await quarter.press('ArrowLeft');
  await expect(page.getByText('No samples in this quarter.', { exact: true })).toBeVisible();
  await expect(page.getByText('This does not mean there were no contaminants.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Return to Latest', exact: true }).click();
  await expect(page.getByText('No samples in this quarter.', { exact: true })).toHaveCount(0);
});

test('offline saved water restricts quarters and uncached layers, reconnect recovers', async ({ page }) => {
  await openReadyMap(page, 'mapScenario=offline');
  const quarter = page.getByRole('slider', { name: 'Water sample quarter' });
  await quarter.focus(); await quarter.press('Home');
  await expect(page.getByText('This quarter is not saved. Reconnect to load it.', { exact: true })).toBeVisible();
  await expect(quarter).toHaveAttribute('aria-valuetext', 'Latest');
  await page.getByRole('radio', { name: 'Air', exact: true }).click();
  await expect(page.getByTestId('map-product').getByRole('alert')).toContainText('Reconnect to load this layer');
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('No saved results for this layer');
  await expect(page.locator('.halo-map-results > button')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close sheet' }).click();
  await page.getByRole('button', { name: 'Simulate reconnect' }).click();
  await expect(page.getByTestId('map-product').getByRole('alert')).toHaveCount(0);
  await openMap(page, 'mapScenario=offline-empty');
  await expect(page.getByRole('slider', { name: 'Water sample quarter' })).toBeDisabled();
});

test('map failure retains district text; missing household does not offer location', async ({ page }) => {
  await openMap(page, 'mapScenario=map-unavailable');
  await expect(page.getByText('The map couldn’t load on this device. The district summary is still available.', { exact: true })).toBeVisible();
  await expect(page.locator('.halo-map-district-county')).toHaveCount(9);
  await page.getByRole('button', { name: 'Try the map again' }).click();
  await expect(page.getByRole('application')).toBeVisible();
  for (const scenario of ['no-location', 'outside-nc']) {
    await openReadyMap(page, `mapScenario=${scenario}`);
    await expect(page.getByRole('button', { name: 'Locate your home' })).toHaveCount(0);
    await expect(page.locator('.halo-map-comparison')).toHaveCount(0);
  }
});

test('invalid deep-link values recover safely, single-quarter hides timeline, em dashes absent', async ({ page }) => {
  await openMap(page, 'contaminant=invalid&quarter=invalid&system=invalid');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Water comparison', { exact: true })).toHaveValue('overall');
  await expect(page.locator('body')).not.toContainText('\u2014');
  await openMap(page, 'mapScenario=single-quarter');
  await expect(page.getByRole('slider', { name: 'Water sample quarter' })).toHaveCount(0);
});

test('canvas keyboard pan, zoom and locate redraw the atlas; layer switching preserves the view', async ({ page }) => {
  await openReadyMap(page);
  await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-context', 'ready');
  const canvas = page.getByRole('application');
  await page.getByRole('button', { name: 'Locate your home' }).click();
  const pixels = async () => createHash('sha256').update(await canvas.evaluate(element => (element as HTMLCanvasElement).toDataURL())).digest('hex');
  const initial = await pixels();
  await canvas.focus(); await canvas.press('ArrowRight');
  await expect.poll(pixels).not.toBe(initial);
  const panned = await pixels();
  await canvas.press('+');
  await expect.poll(pixels).not.toBe(panned);
  const zoomed = await pixels();
  await page.getByRole('radio', { name: 'Air', exact: true }).click();
  await expect(page.getByText('Loading layer data…', { exact: false })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Water', exact: true }).click();
  await expect(page.getByText('Loading water data…', { exact: false })).toHaveCount(0);
  await expect.poll(pixels).toBe(zoomed);
  await page.getByRole('button', { name: 'Locate your home' }).click();
  await expect.poll(pixels).toBe(initial);
});

test('map under Explore retains selected layer within the preview session', async ({ page }) => {
  await openReadyMap(page);
  await page.getByRole('radio', { name: 'Air', exact: true }).click();
  // The local Next dev indicator overlaps the first mobile tab. Exercise the
  // real link through its keyboard interaction rather than force-clicking it.
  await page.getByRole('link', { name: 'Today', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/foundation\/preview\/?\?.*tab=today/);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Explore', exact: true }).click();
  await page.getByRole('link', { name: /Explore the map/ }).click();
  await expect(page).toHaveURL(/\/foundation\/preview\/map/);
  await expect(page.getByRole('radio', { name: 'Air', exact: true })).toHaveAttribute('aria-checked', 'true');
});

test('failed local atlas asset exposes district fallback without contacting a map service', async ({ page }) => {
  await page.route('**/data/map-preview-geography.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await openMap(page);
  await expect(page.getByText('The map couldn’t load on this device. The district summary is still available.', { exact: true })).toBeVisible();
  await expect(page.locator('.halo-map-district-county')).toHaveCount(9);
});

test('uncached deep links never display unavailable fixture readings or district totals', async ({ page }) => {
  await openMap(page, 'mapScenario=offline-empty&system=SAMPLE-01');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).not.toContainText('5.8 ppt');
  await expect(page.getByRole('dialog')).not.toContainText('8.3 ppt');
  await openMap(page, 'mapScenario=offline-empty&system=SAMPLE-01&learn=pfas');
  await expect(page.getByRole('dialog')).not.toContainText('8.3 ppt');
  await expect(page.getByRole('dialog')).toContainText('No reading is available');
  await openMap(page, 'mapScenario=offline&panel=district');
  await expect(page.getByRole('dialog')).toContainText('District information could not load');
  await expect(page.locator('.halo-map-district-total')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try district again' })).toHaveCount(0);
});

test('loading, slow, empty and session review states offer a working recovery', async ({ page }) => {
  for (const scenario of ['loading', 'slow']) {
    await openMap(page, `mapScenario=${scenario}`);
    await expect(page.getByText('Loading map data.', { exact: true })).toBeVisible();
    if (scenario === 'slow') await expect(page.getByText('This source is taking longer. Your location stays in view.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Finish sample loading' }).click();
    await expect(page.getByText('Loading map data.', { exact: true })).toHaveCount(0);
  }
  await openReadyMap(page, 'mapScenario=empty');
  await expect(page.getByText('No data for this layer in the area you’re viewing.', { exact: true })).toBeVisible();
  await page.locator('.halo-map-state').getByRole('button', { name: 'Zoom out', exact: true }).click();
  await expect(page.getByText('No data for this layer in the area you’re viewing.', { exact: true })).toHaveCount(0);
  await openMap(page, 'mapScenario=session-required');
  await expect(page.getByText('Verify your session to load map data.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByTestId('map-product').getByRole('alert')).toHaveCount(0);
});

for (const appearance of ['dark', 'light']) for (const width of [320, 375, 600]) {
  test(`${appearance} ${width}px with 150% text fits map and district`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto(`/foundation/preview/map?layer=water&appearance=${appearance}&scale=150&motion=reduce`);
    await expect(page.getByTestId('map-product')).toHaveAttribute('data-text-scale', '150');
    await assertFits(page);
    await page.getByRole('button', { name: 'See the full NC-08 picture' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await assertFits(page);
    await page.getByRole('button', { name: 'Close sheet' }).click();
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await assertFits(page);
  });
}

for (const appearance of ['dark', 'light']) test(`scratch ${appearance} review screenshots, not approval baselines`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/foundation/preview/map?layer=water&appearance=${appearance}&motion=reduce`);
  await expect(page.getByRole('application')).toBeVisible();
  await expect(page.getByText('Loading map data.', { exact: true })).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await scratchScreenshot(page, `${appearance}-map`);
  await page.getByRole('button', { name: 'See the full NC-08 picture' }).click();
  await expect(page.getByRole('dialog')).toContainText('66,600');
  await scratchScreenshot(page, `${appearance}-district`);
});

test('patterns have a distinct renderer and a persistent precise-location alternative', async ({ page }) => {
  await openReadyMap(page);
  const canvas=page.getByRole('application');
  const pixels=()=>canvas.evaluate(el=>(el as HTMLCanvasElement).toDataURL());
  const heat=await pixels();
  await expect(page.getByRole('button',{name:'Legend',exact:true})).toContainText('Over-limit system density');
  await page.getByRole('button',{name:'Locations',exact:true}).click();
  await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-presentation','locations');
  await expect.poll(pixels).not.toBe(heat);
  await page.reload();
  await expect(page.getByRole('button',{name:'Locations',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Patterns',exact:true}).click();
  await page.getByRole('button',{name:'Legend',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('not contamination spreading');
});

test('area brief compiles visible records, coverage, and selected-system context without a new score', async ({ page }) => {
  await openReadyMap(page);
  await page.getByRole('button',{name:'Open area brief'}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toContainText('13 of 15 returned systems have a map location');
  await expect(dialog).toContainText('35 km smoothing radius');
  await expect(dialog).toContainText('No household risk or new score');
  const counts=await dialog.locator('.halo-map-brief-metrics dd').allTextContents();
  expect(Number(counts[0])).toBeGreaterThan(0);
  expect(Number(counts[1])).toBeLessThanOrEqual(Number(counts[0]));
  await scratchScreenshot(page,'refined-area-brief');
  await dialog.getByRole('button',{name:'Review your system'}).click();
  await expect(dialog).toContainText('SAMPLE-01');
  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await openReadyMap(page,'mapScenario=no-location&mapSheet=brief');
  await expect(dialog.getByRole('button',{name:'Review your system'})).toHaveCount(0);
  await openReadyMap(page,'mapScenario=offline-empty&mapSheet=brief');
  await expect(dialog).toContainText('Load this layer');
  await expect(dialog.locator('.halo-map-brief-metrics')).toHaveCount(0);
});

for(const [width,height] of [[1440,1000],[1257,708],[375,667]]) test(`refined atlas at ${width}x${height} keeps controls usable`,async({page})=>{
  await page.setViewportSize({width,height});
  await openReadyMap(page);
  await assertFits(page);
  await page.getByRole('button',{name:'Patterns',exact:true}).click();
  await page.getByRole('button',{name:'Legend',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button',{name:'Close sheet'}).click();
  await scratchScreenshot(page,`refined-atlas-${width}`);
  for(const layer of ['Radon','Facilities','Air']){
    await page.getByRole('radio',{name:layer,exact:true}).click();
    await expect(page.getByRole('button',{name:'Open area brief'})).toBeEnabled();
    await assertFits(page);
    await page.getByRole('button',{name:'Open area brief'}).click();
    await expect(page.getByRole('dialog')).toContainText('Read the pattern.');
    await page.getByRole('button',{name:'Close sheet'}).click();
  }
});

for (const [width, scale] of [[320, '150'], [375, '100'], [1440, '100']]) test(`cartographic workbench ${width}px at ${scale}% separates geography and reading dock`, async ({ page }) => {
  await page.setViewportSize({ width: Number(width), height: width === 1440 ? 1000 : 850 });
  await openReadyMap(page, `scale=${scale}`);
  const viewport = await page.getByTestId('map-viewport').boundingBox();
  const filters = await page.locator('.halo-map-top').boundingBox();
  const legend = await page.getByRole('button', { name: 'Legend', exact: true }).boundingBox();
  expect(viewport!.height).toBeGreaterThanOrEqual(350);
  expect(filters!.y + filters!.height).toBeLessThanOrEqual(viewport!.y + 1);
  expect(legend!.y).toBeGreaterThanOrEqual(viewport!.y + viewport!.height - 1);
  await expect(page.locator('.halo-map-count')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Legend', exact: true })).toContainText('Record density, not concentration');
  await assertFits(page);
  await page.getByLabel('Water comparison', { exact: true }).selectOption('pfoa');
  await page.getByRole('button', { name: 'List', exact: true }).click();
  const list = page.getByRole('dialog');
  await list.getByRole('searchbox').fill('Longleaf');
  await expect(list).toContainText('0 ppt');
  await expect(list).toContainText('Nov 4, 2025');
  await list.getByRole('button', { name: /Longleaf Water/ }).click();
  await expect(list.locator('.halo-map-selected-reading')).toContainText('0 ppt');
  await expect(list.locator('.halo-map-selected-reading')).toContainText('parts per trillion');
  await expect(list.locator('.halo-map-thresholds section[data-selected="true"]')).toContainText('PFOA');
  await page.getByRole('button', { name: 'Close sheet' }).click();
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await list.getByRole('searchbox').fill('Sandhill');
  await expect(list).toContainText('No detection reported');
  await assertFits(page);
  await page.getByRole('button', { name: 'Close sheet' }).click();
  await scratchScreenshot(page, `workbench-${width}-${scale}`);
});

for (const appearance of ['light', 'dark']) test(`high-end cartography ${appearance} preserves each layer's legend and source values`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/foundation/preview/map?layer=water&appearance=${appearance}&motion=reduce`);
  await expect(page.getByText('Loading map data.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('application')).toBeVisible();
  for (const [layer, label] of [['Water','System result categories'],['Radon','County radon potential'],['Facilities','Reported compliance'],['Air','Monitor AQI categories']]) {
    await page.getByRole('radio', { name: layer, exact: true }).click();
    await expect(page.getByText('Loading map data.', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Legend', exact: true })).toContainText(label);
    await assertFits(page);
    const dock=await page.locator('.halo-map-bottom').boundingBox();
    const navigation=await page.getByRole('navigation',{name:'Main navigation'}).boundingBox();
    expect(dock!.y+dock!.height).toBeLessThanOrEqual(navigation!.y);
    await scratchScreenshot(page, `cartography-${appearance}-${layer.toLowerCase()}`);
  }
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('42 AQI');
  await expect(page.getByRole('dialog')).toContainText('Sep 30, 2026');
});
