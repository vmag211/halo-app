import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { jsonRoute, mockStage, stageProfile } from './stage-fixtures';

const factors = ['air', 'uv', 'pollen', 'mold', 'pfas', 'radon', 'lead'] as const;
const members = ['toddler', 'child', 'teen', 'adult', 'senior', 'pregnant', 'respiratory'] as const;
// Deliberately different from approved preview values. These are response
// fixtures in the existing backend shape, never calls to a live service.
const daily = {
  air: { aqi: 101, source: 'airnow', is_measured: true, dominant_pollutant: 'O3', severity: 'elevated', sentence: 'Outdoor ozone is elevated\u2014check the current reading.' },
  uv: { index: 2.6, severity: 'good', peak_window: { start: '09:30', end: '13:45', max: 6.7 } },
  pollen: { tree: 4, grass: 0, weed: 1, dominant: 'tree', severity: 'high', categories: { tree: { value: 4, severity: 'high' }, grass: { value: 0, severity: 'good' }, weed: { value: 1, severity: 'good' } } },
  mold: { risk: 'low', severity: 'good', is_proxy: true, basis: { humidity_pct: 44, precip_pct: 12 } },
  score: { display_score: 62, severity: 'moderate', is_partial: false, included_inputs: ['air', 'uv', 'pollen', 'mold'], missing_inputs: [], inputs: { air: 43, uv: 13, pollen: 7, mold: 4 } },
  retrieved_at: '2026-10-01T14:00:00Z',
};
const home = {
  water: { status: 'measured', is_measured: true, coverage: 'complete', pws_name: 'Cabarrus Utility', latest_sample_iso: '2026-08-12',
    scored_contaminants: [{ contaminant: 'PFOA', value_ppt: 3.7, limit_ppt: 4, risk: 71, severity: 'moderate', is_enforceable: true, exceeds_limit: false, date_iso: '2026-08-12', basis: 'federal_mcl' }],
    contaminants: { PFOA: [{ value_ppt: 5.1, date_iso: '2026-02-12' }, { value_ppt: 3.7, date_iso: '2026-08-12' }] },
    excluded_from_score: [] },
  radon: { zone: 1, county: 'Cabarrus', severity: 'high' },
  lead: { level: 'moderate', is_estimate: true, sentence: 'Review building-era information\u2014a test provides direct evidence.' },
  breakdown: [{ key: 'water', score: 29, severity: 'moderate' }, { key: 'radon', score: 36, severity: 'high' }],
  score: { display_score: 31, severity: 'high', included_inputs: ['water', 'radon'], missing_inputs: [], is_partial: false, water_risk: 71, radon_risk: 64 },
  assembled_at: '2026-10-01T14:00:00Z',
};

async function filledStage(page: Page, allMembers = false) {
  const profile = structuredClone(stageProfile);
  profile.profile.home_year = 2001;
  if (allMembers) for (const member of members) profile.household[`has_${member}`] = true;
  return mockStage(page, { overrides: {
    '/api/profile': async route => jsonRoute(route, profile),
    '/api/daily-score': async route => jsonRoute(route, daily),
    '/api/home-guard': async route => jsonRoute(route, home),
    '/api/history': async route => jsonRoute(route, { from: '2026-09-29', to: '2026-10-01', count: 2, history: [
      { date: '2026-09-29', values: { aqi: 91, uv_index: 1.8, pollen: { tree: 3, grass: 0, weed: 2 } } },
      { date: '2026-10-01', values: { aqi: 101, uv_index: 2.6, pollen: { tree: 4, grass: 0, weed: 1 } } },
    ] }),
    '/api/learn': async (route, url) => jsonRoute(route, { topic: url.searchParams.get('topic'), title: 'Current reading guidance', locale: 'en', what_it_is: 'General educational information\u2014read it alongside the source.', why_yours: 'This explanation uses the returned reading.', household_note: 'Selected household categories provide context.', protect: ['Review the current reading.', 'Check the source and its date.', 'Discuss specific concerns with a qualified professional.'], sources: [{ label: 'EPA guidance', url: 'https://www.epa.gov/', retrieved: '2026-10-01' }] }),
  } });
}

async function ready(page: Page, route: string) {
  await page.goto(route);
  await expect(page.getByTestId('stage-product')).toBeVisible();
  await expect(page.getByRole('status', { name: /Checking your profile|Loading readings/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh readings', exact: true })).toBeVisible();
  await expect(page.getByText('Updating the explanation for your reading.', { exact: true })).toHaveCount(0);
  await page.evaluate(async () => { await document.fonts.ready; });
}

async function cleanSurface(page: Page) {
  const surface = page.getByTestId('stage-product');
  await expect(surface).not.toContainText(/Sample preview|Sample household|Sample profile|sample AQI|sample forecast|sample values|Example reply|September 30, 2026|Iredell/);
  const text = await surface.evaluate(node => node.textContent + [...node.querySelectorAll('[aria-label],[alt],[title]')].map(element => ['aria-label', 'alt', 'title'].map(key => element.getAttribute(key) || '').join(' ')).join(' '));
  expect(text).not.toContain('\u2014');
  const geometry = await surface.evaluate(node => ({ overflow: document.documentElement.scrollWidth > innerWidth || node.scrollWidth > node.clientWidth, offenders: [...node.querySelectorAll('*')].filter(element => { const box = element.getBoundingClientRect(); return box.width && (box.left < -1 || box.right > innerWidth + 1) && getComputedStyle(element).position !== 'absolute' && getComputedStyle(element).position !== 'fixed'; }).slice(0, 8).map(element => ({ tag: element.tagName, class: element.className, text: element.textContent?.slice(0, 60) })) }));
  expect(geometry.overflow, JSON.stringify(geometry.offenders)).toBe(false);
  const overlappingLabels = await page.getByRole('navigation', { name: 'Main navigation' }).evaluate(nav => {
    const labels = [...nav.querySelectorAll('a > span, button > span')];
    return labels.flatMap((label, index) => labels.slice(index + 1).flatMap(next => {
      const a = label.getBoundingClientRect(), b = next.getBoundingClientRect();
      return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1 ? [`${label.textContent} overlaps ${next.textContent}`] : [];
    }));
  });
  expect(overlappingLabels, 'Bottom navigation labels must not overlap at enlarged text sizes.').toEqual([]);
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  await page.mouse.move(0, 0);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled', caret: 'hide' });
}

for (const appearance of ['light', 'dark'] as const) for (const width of [320, 375]) {
  test(`${appearance} ${width}: live screen geometry and API values`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 850 });
    await page.emulateMedia({ colorScheme: appearance, reducedMotion: 'reduce' });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const network = await filledStage(page);
    for (const route of ['/today', '/home', '/family', ...factors.map(factor => `/factors/${factor}`)]) {
      await ready(page, route);
      await cleanSurface(page);
      if (route === '/today') {
        await expect(page.locator('.halo-ph-ring-center strong')).toHaveText('62');
        await expect(page.getByTestId('factor-scorecard')).toHaveCount(4);
        await expect(page.locator('.halo-ph-overview')).not.toContainText('PFAS');
      }
      if (route === '/home') { await expect(page.locator('.halo-ph-ring-center strong')).toHaveText('31'); await expect(page.getByTestId('factor-scorecard')).toHaveCount(3); }
      if (route === '/factors/air') { await expect(page.locator('.halo-ph-reading-capsule')).toContainText('101'); await expect(page.locator('.halo-ph-detail-score strong')).toHaveText('Not scored'); }
      if (['/factors/uv', '/factors/pollen', '/factors/mold'].includes(route)) await expect(page.locator('#reading-overview h2')).not.toContainText('not available');
      if (route === '/factors/pfas') await expect(page.locator('.halo-ph-reading-capsule')).toContainText('3.7ppt PFOA');
      if (route === '/factors/lead') { await expect(page.locator('.halo-ph-detail-score strong')).toHaveText('Not scored'); await expect(page.locator('.halo-ph-reading-capsule')).toContainText('2001'); }
      await screenshot(page, info, route.slice(1).replaceAll('/', '-'));
    }
    expect(errors).toEqual([]); expect(network.blocked).toEqual([]);
  });

  test(`${appearance} ${width}: 150 percent text and all household categories`, async ({ page }, info) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: 850 });
    await page.emulateMedia({ colorScheme: appearance, reducedMotion: 'reduce' });
    await page.addInitScript(() => localStorage.setItem('halo.device.accessibility', JSON.stringify({ scale: 150, reduced: true, contrast: false })));
    const network = await filledStage(page, true);
    for (const route of ['/today', '/home', '/family', ...factors.map(factor => `/factors/${factor}`), ...members.map(member => `/household/${member}`)]) {
      await ready(page, route);
      await expect(page.getByTestId('stage-product')).toHaveAttribute('data-text-scale', '150');
      await cleanSurface(page);
      if (route === '/home') { await expect(page.locator('.halo-home-person')).toHaveCount(7); await screenshot(page, info, 'home-all-members-150'); }
      if (route.startsWith('/household/')) await expect(page.locator('.halo-home-member-tag')).toHaveText('Selected household category');
      if (route === '/factors/pfas' || route === '/household/respiratory') await screenshot(page, info, route.slice(1).replaceAll('/', '-') + '-150');
    }
    expect(network.blocked).toEqual([]);
  });
}

test('missing readings never render fixture scores, dates, households, or Luna example replies', async ({ page }, info) => {
  test.setTimeout(120_000);
  const network = await mockStage(page);
  for (const route of ['/today', '/home', '/family', ...factors.map(factor => `/factors/${factor}`)]) {
    await ready(page, route); await cleanSurface(page);
    if (route === '/today' || route === '/home') await expect(page.locator('.halo-ph-ring-center strong')).toHaveText('No data');
    if (route.startsWith('/factors/')) await expect(page.locator('.halo-ph-detail-score strong')).toHaveText('No data');
    await expect(page.locator('.halo-ph-ring-segment')).toHaveCount(0);
  }
  await ready(page, '/home');
  await expect(page.locator('.halo-home-person')).toHaveCount(2);
  await expect(page.locator('.halo-home-person[data-member="child"]')).toBeVisible();
  await expect(page.locator('.halo-home-person[data-member="adult"]')).toBeVisible();
  await page.getByRole('button', { name: 'Open Luna', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Luna' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Luna' })).not.toContainText(/Example reply|Interactive design preview|Nothing is sent|Preview/);
  await screenshot(page, info, 'luna-live-missing');
  expect(network.blocked).toEqual([]);
});

test('all factor section links support keyboard focus and back navigation', async ({ page }) => {
  test.setTimeout(120_000);
  const network = await filledStage(page);
  for (const factor of factors) {
    const parent = ['pfas', 'radon', 'lead'].includes(factor) ? '/home' : '/today';
    await ready(page, parent);
    await page.locator(`a[href="/factors/${factor}"][data-testid="factor-scorecard"]`).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/factors/${factor}$`));
    const nav = page.getByRole('navigation', { name: 'On this factor page' });
    for (const [name, id] of [['Summary', 'reading-overview'], ['Details', 'reading-detail'], ['Tips', 'protection'], ['References', 'reading-sources']]) {
      await nav.getByRole('link', { name, exact: true }).focus(); await page.keyboard.press('Enter');
      await expect(page.locator(`#${id}`)).toBeFocused();
      expect(new URL(page.url()).hash).toBe(`#${id}`);
      expect(await page.locator(`#${id}`).evaluate(node => node.getBoundingClientRect().top >= document.querySelector('.halo-f-header')!.getBoundingClientRect().bottom)).toBe(true);
    }
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${parent}$`));
  }
  expect(network.blocked).toEqual([]);
});

test('PFAS chart labels retain the returned compound', async ({ page }) => {
  await filledStage(page);
  await ready(page, '/factors/pfas');
  await expect(page.locator('.halo-ph-trend')).toContainText('PFOA');
  await expect(page.locator('.halo-ph-trend')).not.toContainText('PFOS');
  await page.getByText('View readings as a table', { exact: true }).click();
  await expect(page.getByRole('table')).not.toContainText('PFOS');
});
