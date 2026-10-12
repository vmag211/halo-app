import { test, expect, type Page } from '@playwright/test';

const root = '/foundation/preview/expanded/?motion=full';
async function calls(page: Page) {
  return page.evaluate(() => (window as unknown as { haloMotionCalls: string[] }).haloMotionCalls);
}
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['127.0.0.1', 'localhost'].includes(url.hostname) && !url.pathname.startsWith('/api/') ? route.continue() : route.abort();
  });
  await page.addInitScript(() => {
    const state = window as unknown as { haloMotionCalls: string[] };
    state.haloMotionCalls = [];
    const original = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      if (this.hasAttribute('data-interface-entering')) state.haloMotionCalls.push(this.className.toString());
      return original.apply(this, args);
    };
  });
});

test('meaningful dashboard surfaces reveal, with immediately usable controls and no permanent transforms', async ({ page }) => {
  await page.goto(root);
  await expect(page.getByTestId('foundation-product')).toHaveAttribute('data-interface-motion', 'on');
  await expect.poll(() => calls(page)).toEqual(expect.arrayContaining([expect.stringContaining('mw-calendar')]));
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await page.getByLabel('Task title', { exact: true }).fill('A stable task draft');
  await expect(page.getByLabel('Task title', { exact: true })).toHaveValue('A stable task draft');
  await expect.poll(() => page.locator('[data-interface-entering]').count()).toBe(0);
  await expect(page.getByLabel('Task title', { exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Save task', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save task', exact: true }).click();
  await expect(page.locator('.mw-task-open').filter({ hasText: 'A stable task draft' })).toBeVisible();
});

test('disclosures animate their content once per open without replaying while typing', async ({ page }) => {
  await page.goto(root);
  await expect(page.getByTestId('foundation-product')).toHaveAttribute('data-interface-motion', 'on');
  await page.locator('.mw-week-details > summary').click();
  await expect.poll(async () => (await calls(page)).some(name => name.includes('mw-board-summary'))).toBe(true);
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect.poll(() => page.locator('[data-interface-entering]').count()).toBe(0);
  const before = await calls(page);
  await page.getByLabel('Task title', { exact: true }).pressSequentially('Keep the form still');
  expect(await calls(page)).toEqual(before);
});

test('device reduced motion wins even when review mode asks for full motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(root);
  await expect(page.getByRole('button', { name: 'Add task', exact: true })).toBeVisible();
  await expect(page.getByTestId('foundation-product')).not.toHaveAttribute('data-interface-motion', 'on');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.getByLabel('Task title', { exact: true })).toBeVisible();
  expect(await page.getByRole('dialog').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  expect(await calls(page)).toEqual([]);
  await page.getByRole('button', { name: 'Close sheet', exact: true }).click();
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await expect(page.locator('.halo-env').first()).toHaveAttribute('data-moving', 'false');
});

test('settings and Homeguard reuse the motion system without replacing forms or hiding content', async ({ page }) => {
  await page.goto(root);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect.poll(() => calls(page)).toEqual(expect.arrayContaining([expect.stringContaining('hp-settings-group')]));
  await page.getByRole('button', { name: /^Home & household/ }).click();
  await page.getByLabel('Building year (optional)').fill('2001');
  await expect(page.getByLabel('Building year (optional)')).toHaveValue('2001');
  await page.getByRole('button', { name: 'All settings', exact: true }).click();
  await page.getByRole('button', { name: /^Home & household/ }).click();
  await expect(page.getByLabel('Building year (optional)')).toHaveValue('2001');
  await page.getByRole('link', { name: 'Homeguard', exact: true }).click();
  await expect(page.locator('.halo-env__canopy-light').first()).toBeAttached();
  await expect(page.locator('.halo-env').first()).toHaveAttribute('data-moving', 'true');
});

test('map tool entrances leave the map canvas and its coordinate system stationary', async ({ page }) => {
  await page.goto('/foundation/preview/map/?motion=system');
  await expect(page.getByTestId('map-product')).toHaveAttribute('data-interface-motion', 'on');
  await expect.poll(() => calls(page)).toEqual(expect.arrayContaining([expect.stringContaining('halo-map-top')]));
  const canvas = page.locator('.halo-map-canvas-host');
  await expect(canvas).toBeVisible();
  expect(await canvas.evaluate(node => node.closest('[data-interface-managed]'))).toBeNull();
  await page.getByRole('button', { name: 'About this map', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => calls(page)).toEqual(expect.arrayContaining([expect.stringContaining('halo-f-sheet')]));
});

test('forced colors starts static and can safely return to interface motion', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto(root);
  await expect(page.getByRole('button', { name: 'Add task', exact: true })).toBeVisible();
  await expect(page.getByTestId('foundation-product')).not.toHaveAttribute('data-interface-motion', 'on');
  expect(await calls(page)).toEqual([]);
  await page.emulateMedia({ forcedColors: 'none' });
  await expect(page.getByTestId('foundation-product')).toHaveAttribute('data-interface-motion', 'on');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect.poll(() => calls(page)).toEqual(expect.arrayContaining([expect.stringContaining('hp-settings-group')]));
});
