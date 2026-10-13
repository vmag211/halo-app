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
    const state = window as unknown as { haloMotionCalls: string[]; haloMotionDetails: { name: string; keyframes: unknown; options: unknown }[] };
    state.haloMotionCalls = [];
    state.haloMotionDetails = [];
    const original = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      if (this.hasAttribute('data-interface-entering')) {
        state.haloMotionCalls.push(this.className.toString());
        state.haloMotionDetails.push({ name: this.className.toString(), keyframes: args[0], options: args[1] });
      }
      return original.apply(this, args);
    };
  });
});

for (const [tab, selector, name] of [
  ['home', '.halo-home-workspace', 'halo-home-workspace'],
  ['home', '.halo-home-household', 'halo-home-household'],
  ['act', '.ex-mini-map', 'ex-mini-map'],
  ['act', '.ex-community-bridge', 'ex-community-bridge'],
]) test(`${tab} reveals ${name} when scrolling to it, not merely when the page mounts`, async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 680 });
  await page.goto(`${root}&tab=${tab}`);
  await expect(page.getByTestId('foundation-product')).toHaveAttribute('data-interface-motion', 'on');
  const surface = page.locator(selector);
  await expect(surface).toHaveAttribute('data-interface-pending', 'true');
  expect(await surface.evaluate(node => node.getBoundingClientRect().top)).toBeGreaterThan(680);
  expect((await calls(page)).some(value => value.includes(name))).toBe(false);
  await surface.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await expect.poll(async () => (await calls(page)).some(value => value.includes(name))).toBe(true);
  await page.screenshot({ path: info.outputPath(`${name}-scroll-entrance.png`), animations: 'allow' });
  const motion = await page.evaluate(target => (window as unknown as {
    haloMotionDetails: { name: string; keyframes: { opacity: number; transform: string }[]; options: { duration: number } }[];
  }).haloMotionDetails.find(item => item.name.includes(target)), name);
  expect(motion?.options.duration).toBe(580);
  expect(motion?.keyframes[0].opacity).toBeLessThanOrEqual(.25);
  expect(motion?.keyframes[0].transform).toContain('22px');
  await expect(surface).not.toHaveAttribute('data-interface-entering');
  expect(await surface.evaluate(node => getComputedStyle(node).transform)).toBe('none');
  const count = (await calls(page)).filter(value => value.includes(name)).length;
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await surface.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  expect((await calls(page)).filter(value => value.includes(name))).toHaveLength(count);
});

test('long Homeguard record pages reveal later sections independently of their stack', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 680 });
  await page.goto(`${root}&tab=home&destination=tests&homeView=detail&record=test-water-september`);
  await expect(page.getByTestId('foundation-product')).toHaveAttribute('data-interface-motion', 'on');
  const sections = page.locator('.hg-content .hg-card');
  expect(await sections.count()).toBeGreaterThan(2);
  const later = sections.last();
  expect(await later.evaluate(node => node.getBoundingClientRect().top)).toBeGreaterThan(680);
  await expect(later).toHaveAttribute('data-interface-pending', 'true');
  await later.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await expect(later).toHaveAttribute('data-interface-managed', 'true');
  expect(await page.locator('.hg-content > .hg-stack').evaluateAll(nodes => nodes.every(node => !node.hasAttribute('data-interface-managed')))).toBe(true);
});

test('project catalogue cards have independent entrances and search never reanimates an input', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 680 });
  await page.goto(`${root}&tab=act&destination=projects`);
  const cards = page.locator('.ex-generated-item');
  await expect(cards).toHaveCount(12);
  const later = cards.nth(6);
  await expect(later).toHaveAttribute('data-interface-pending', 'true');
  expect(await later.evaluate(node => node.getBoundingClientRect().top)).toBeGreaterThan(680);
  await later.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await expect(later).toHaveAttribute('data-interface-managed', 'true');
  await expect(page.locator('.ex-generated-library')).not.toHaveAttribute('data-interface-managed');
  const search = page.getByRole('searchbox', { name: 'Find a project' });
  await search.fill('bee house');
  await expect(cards).toHaveCount(1);
  await expect(search).toBeFocused();
  expect(await search.evaluate(node => node.closest('[data-interface-entering]'))).toBeNull();
  await page.locator('.ex-generated-open').click();
  await expect(page.locator('.ex-guide-cover')).toBeVisible();
  await page.locator('.ex-guide-current-step').evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await expect(page.locator('.ex-guide-current-step')).toHaveAttribute('data-interface-managed', 'true');
});

test('device motion changes finish active surfaces immediately and leave scroll content readable', async ({ page }) => {
  await page.goto(`${root}&tab=home`);
  await expect(page.getByTestId('foundation-product')).toHaveAttribute('data-interface-motion', 'on');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByTestId('foundation-product')).not.toHaveAttribute('data-interface-motion', 'on');
  await expect(page.locator('[data-interface-entering]')).toHaveCount(0);
  await page.locator('.halo-home-household').scrollIntoViewIfNeeded();
  await expect(page.locator('.halo-home-household')).toBeVisible();
  const reveals = page.locator('.halo-reveal');
  for (const reveal of await reveals.all()) {
    await expect(reveal).toHaveCSS('opacity', '1');
    await expect(reveal).toHaveCSS('transform', 'none');
    await expect(reveal).toHaveCSS('transition-duration', '0s');
  }
});

test('primary actions get finite hover and keyboard sheen without recoloring delete actions', async ({ page }) => {
  await page.goto(root);
  await expect(page.getByTestId('foundation-product')).toHaveAttribute('data-interface-motion', 'on');
  const add = page.getByRole('button', { name: 'Add task', exact: true });
  expect(await add.evaluate(node => getComputedStyle(node).backgroundImage)).toContain('linear-gradient');
  await add.focus();
  await expect(add).toBeFocused();
  await expect(add).toHaveCSS('background-position', '0px 0px');
  await page.goto(`${root}&tab=home&destination=tests`);
  await expect(page.getByTestId('foundation-product')).toHaveAttribute('data-interface-motion', 'on');
  const remove = page.getByRole('button', { name: /^Delete / }).first();
  await remove.click();
  const confirm = page.getByRole('button', { name: 'Yes, delete', exact: true });
  await expect(confirm).toBeVisible();
  expect(await confirm.evaluate(node => getComputedStyle(node).backgroundImage)).toBe('none');
  await page.getByRole('button', { name: 'No, keep it', exact: true }).click();
});

test('pressing a revealing record keeps its delete target still until the click completes', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = original.apply(this, args);
      if (this.matches('.hg-deletable-record')) {
        animation.pause();
        animation.currentTime = 1;
      }
      return animation;
    };
  });
  await page.goto(`${root}&tab=home&destination=tests`);
  await expect(page.getByTestId('foundation-product')).toHaveAttribute('data-interface-motion', 'on');
  const row = page.locator('.hg-deletable-record').first();
  await row.scrollIntoViewIfNeeded();
  await expect(row).toHaveAttribute('data-interface-entering', 'surface');
  const remove = row.getByRole('button', { name: /^Delete / });
  const bounds = await remove.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  const pressedBounds = await remove.boundingBox();
  // Allow subpixel compositor rounding, never the 22px entrance translation.
  expect(Math.abs(pressedBounds!.y - bounds!.y)).toBeLessThan(1);
  expect(pressedBounds!.x).toBeCloseTo(bounds!.x, 3);
  expect(pressedBounds!.width).toBeCloseTo(bounds!.width, 3);
  expect(pressedBounds!.height).toBeCloseTo(bounds!.height, 3);
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Yes, delete', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'No, keep it', exact: true }).click();
  await expect(row).not.toHaveAttribute('data-interface-entering');
  await expect(remove).toBeVisible();
});

test('photo-led Explore buttons have matching hover and keyboard focus depth without moving controls', async ({ page }) => {
  await page.goto(`${root}&tab=act`);
  await expect(page.getByTestId('foundation-product')).toHaveAttribute('data-interface-motion', 'on');
  for (const selector of ['.ex-involvement-cover', '.ex-generated-lead']) {
    const button = page.locator(selector);
    const photo = button.locator('.ex-photo img');
    await button.scrollIntoViewIfNeeded();
    await expect(page.locator('[data-interface-entering]')).toHaveCount(0);
    const before = await button.boundingBox();
    await button.hover();
    await expect.poll(() => photo.evaluate(node => new DOMMatrixReadOnly(getComputedStyle(node).transform).a)).toBeGreaterThanOrEqual(1.024);
    expect(await button.boundingBox()).toEqual(before);
    await page.mouse.move(0, 0);
    await page.keyboard.press('Tab');
    await button.focus();
    await expect(button).toBeFocused();
    expect(await button.evaluate(node => node.matches(':focus-visible'))).toBe(true);
    await expect.poll(() => photo.evaluate(node => new DOMMatrixReadOnly(getComputedStyle(node).transform).a)).toBeGreaterThanOrEqual(1.024);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const photo of await page.locator('.ex-involvement-cover .ex-photo img,.ex-generated-lead .ex-photo img').all()) {
    await expect(photo).toHaveCSS('transform', 'none');
    await expect(photo).toHaveCSS('filter', 'none');
    await expect(photo).toHaveCSS('transition-duration', '0s');
  }
});

test('meaningful dashboard surfaces reveal, with immediately usable controls and no permanent transforms', async ({ page }) => {
  await page.goto(root);
  await expect(page.getByTestId('foundation-product')).toHaveAttribute('data-interface-motion', 'on');
  await expect(page.locator('.mw-calendar')).toHaveCSS('animation-name', 'none');
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
