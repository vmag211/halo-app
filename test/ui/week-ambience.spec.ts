import { test, expect } from '@playwright/test';

const root = '/foundation/preview/expanded/?tab=plan&motion=system&appearance=dark';
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['localhost', '127.0.0.1'].includes(url.hostname) && !url.pathname.startsWith('/api/') ? route.continue() : route.abort();
  });
});

test('landscapes load on demand, retain the agenda and have touch-size controls', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', request => { if (/week-(?:lake|coast|forest)\.webp/.test(request.url())) requested.push(request.url()); });
  await page.goto(root.replace('tab=plan', 'tab=today'));
  expect(requested).toHaveLength(0);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'My Week', exact: true }).click();
  const scene = page.locator('.mw-ambience');
  await expect(scene).toHaveAttribute('data-scene', 'lake');
  await expect(scene.locator('img')).toHaveJSProperty('complete', true);
  expect(requested).toHaveLength(1);
  for (const control of await scene.getByRole('button').all()) {
    const box = await control.boundingBox(); expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('button', { name: 'Next landscape', exact: true }).click();
  await expect(scene).toHaveAttribute('data-scene', 'coast');
  await expect(scene.getByRole('status')).toHaveText('Tidal light landscape selected.');
  expect(requested).toHaveLength(2);
  await page.getByRole('button', { name: 'Next landscape', exact: true }).click();
  await expect(scene).toHaveAttribute('data-scene', 'forest');
  await expect(page.getByRole('button', { name: 'Add task', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.locator('#week-task-detail')).toBeVisible();
});

test('water pixels actually move independently and pause without losing the scenery', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(root);
  const scene = page.locator('.mw-ambience'), water = scene.locator('canvas');
  await expect(scene).toHaveAttribute('data-moving', 'true');
  await expect(water).toHaveAttribute('data-running', 'true');
  const initial = await water.evaluate((node: HTMLCanvasElement) => node.toDataURL());
  await expect.poll(() => water.evaluate((node: HTMLCanvasElement) => node.toDataURL())).not.toBe(initial);
  await expect(scene.locator('img')).toHaveCSS('transform', 'none');
  await page.getByRole('button', { name: 'Pause landscape', exact: true }).click();
  await expect(scene).toHaveAttribute('data-moving', 'false');
  const paused = await water.evaluate((node: HTMLCanvasElement) => node.toDataURL());
  await page.waitForTimeout(150);
  expect(await water.evaluate((node: HTMLCanvasElement) => node.toDataURL())).toBe(paused);
  await page.getByRole('button', { name: 'Resume landscape', exact: true }).click();
  await expect(scene).toHaveAttribute('data-moving', 'true');
});

test('rapid manual scene changes retain only useful layers and dissolve cached scenes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(root);
  const scene = page.locator('.mw-ambience');
  await expect(scene).toHaveAttribute('data-moving', 'true');
  for (const name of ['coast', 'forest', 'lake', 'coast']) {
    await page.getByRole('button', { name: 'Next landscape', exact: true }).click();
    await expect(scene).toHaveAttribute('data-scene', name);
    const layer = scene.locator(`.mw-ambience-layer[data-landscape=${name}]`);
    await expect(layer).toHaveCSS('animation-name', 'mw-landscape-dissolve');
    const opacity = await layer.evaluate(node => getComputedStyle(node).opacity);
    await expect.poll(() => layer.evaluate(node => getComputedStyle(node).opacity)).not.toBe(opacity);
    await expect(scene.locator('.mw-ambience-layer')).toHaveCount(2);
  }
  expect(errors).toEqual([]);
});

test('two-minute scene dwell pauses offscreen and when the document is hidden', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install();
  await page.goto(root);
  const scene = page.locator('.mw-ambience');
  await expect(scene).toHaveAttribute('data-rotation', 'true');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(scene).toHaveAttribute('data-moving', 'false');
  await page.clock.fastForward(125_000);
  await expect(scene).toHaveAttribute('data-scene', 'lake');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(scene).toHaveAttribute('data-moving', 'true');
  await page.locator('.mw-calendar-options').scrollIntoViewIfNeeded();
  await expect(scene).toHaveAttribute('data-moving', 'false');
  await page.clock.fastForward(125_000);
  await expect(scene).toHaveAttribute('data-scene', 'lake');
  await scene.scrollIntoViewIfNeeded();
  await expect(scene).toHaveAttribute('data-rotation', 'true');
  await page.clock.fastForward(121_000);
  await expect(scene).toHaveAttribute('data-scene', 'coast');
  await expect(scene.getByRole('status')).toBeEmpty();
});

test('device reduction wins even over full motion and manual next stays immediate', async ({ page }) => {
  await page.goto(root.replace('motion=system', 'motion=full'));
  const scene = page.locator('.mw-ambience');
  await expect(scene).toHaveAttribute('data-moving', 'false');
  await expect(scene.getByRole('button', { name: 'Pause landscape', exact: true })).toHaveCount(0);
  await scene.getByRole('button', { name: 'Next landscape', exact: true }).click();
  await expect(scene).toHaveAttribute('data-scene', 'coast');
  await expect(scene.locator('.mw-ambience-layer')).toHaveCSS('transition-duration', '0s');
  await expect(scene.locator('.mw-ambience-haze-back')).toHaveCSS('animation-name', 'none');
});

test('save-data and higher contrast keep the wallpaper static', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => { Object.defineProperty(navigator, 'connection', { configurable: true, value: Object.assign(new EventTarget(), { saveData: true }) }); });
  await page.goto(root);
  await expect(page.locator('.mw-ambience')).toHaveAttribute('data-moving', 'false');
  await page.getByRole('button', { name: 'Next landscape', exact: true }).click();
  await expect(page.locator('.mw-ambience')).toHaveAttribute('data-scene', 'coast');
  await page.goto(`${root}&contrast=true`);
  await expect(page.locator('.mw-ambience')).toHaveAttribute('data-moving', 'false');
  await expect(page.locator('.mw-ambience-art')).not.toBeVisible();
});

test('failed and stalled scene requests retain the current view and can skip to the next', async ({ page }) => {
  await page.route('**/week-coast.webp', route => route.abort());
  await page.goto(root);
  await page.getByRole('button', { name: 'Next landscape', exact: true }).click();
  await expect(page.locator('.mw-ambience').getByRole('status')).toContainText('could not load');
  await expect(page.locator('.mw-ambience')).toHaveAttribute('data-scene', 'lake');
  await page.getByRole('button', { name: 'Next landscape', exact: true }).click();
  await expect(page.locator('.mw-ambience')).toHaveAttribute('data-scene', 'forest');
  await page.unroute('**/week-coast.webp');
  await page.route('**/week-coast.webp', () => {});
  await page.clock.install();
  await page.goto(root);
  await page.getByRole('button', { name: 'Next landscape', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Next landscape', exact: true })).toBeDisabled();
  await page.clock.fastForward(12_100);
  await expect(page.getByRole('button', { name: 'Next landscape', exact: true })).toBeEnabled();
  await expect(page.locator('.mw-ambience')).toHaveAttribute('data-scene', 'lake');
});

test('a failed canvas leaves a static image and functional calendar', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { HTMLCanvasElement.prototype.getContext = (() => { throw new Error('Canvas unavailable'); }) as typeof HTMLCanvasElement.prototype.getContext; });
  await page.goto(root);
  await expect(page.locator('.mw-ambience img')).toBeVisible();
  await page.getByRole('button', { name: 'Next landscape', exact: true }).click();
  await expect(page.locator('.mw-ambience')).toHaveAttribute('data-scene', 'coast');
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await expect(page.locator('.mw-days button')).toHaveCount(42);
  expect(errors).toEqual([]);
});

test('ambient settings stop wallpaper movement while preserving manual selection', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(root);
  await expect(page.locator('.mw-ambience')).toHaveAttribute('data-moving', 'true');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /^Display & accessibility/ }).click();
  await page.getByRole('switch', { name: 'Ambient animation', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'My Week', exact: true }).click();
  await expect(page.locator('.mw-ambience')).toHaveAttribute('data-moving', 'false');
  await page.getByRole('button', { name: 'Next landscape', exact: true }).click();
  await expect(page.locator('.mw-ambience')).toHaveAttribute('data-scene', 'coast');
});

for (const appearance of ['light', 'dark']) test(`wallpaper keeps the ${appearance} phone layout at larger text`, async ({ page }, info) => {
  for (const [width, scale] of [[320, 150], [390, 100], [768, 100], [1440, 100]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${root.replace('appearance=dark', `appearance=${appearance}`)}&scale=${scale}`);
    await expect(page.getByRole('heading', { name: 'Your day', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add task', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const scene = await page.locator('.mw-ambience').boundingBox();
    const app = await page.getByTestId('foundation-product').boundingBox();
    expect(scene!.x).toBeGreaterThanOrEqual(app!.x - 1);
    expect(scene!.x + scene!.width).toBeLessThanOrEqual(app!.x + app!.width + 1);
    expect(scene!.width).toBeLessThanOrEqual(430);
    await page.screenshot({ path: info.outputPath(`week-landscape-${appearance}-${width}.png`), fullPage: true });
  }
});
