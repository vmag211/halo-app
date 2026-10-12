import { expect, test, type Page } from '@playwright/test';

const root = '/foundation/preview/expanded/?tab=plan&motion=full';
const faults = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; faults.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname.startsWith('/api/')) {
      errors.push(`Unexpected request: ${url.pathname}`); return route.abort();
    }
    return route.continue();
  });
});
test.afterEach(async ({ page }) => expect(faults.get(page)).toEqual([]));

async function pendingReply(page: Page) {
  await page.getByRole('button', { name: 'Ask Luna', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Luna', exact: true });
  await dialog.getByRole('button', { name: 'Context & privacy', exact: true }).click();
  await dialog.getByLabel('Assistant service review state').selectOption('slow');
  await dialog.getByRole('textbox', { name: 'Message Luna', exact: true }).fill('Find projects that fit my home');
  await dialog.getByRole('button', { name: 'Send message', exact: true }).click();
  const loading = dialog.locator('.halo-luna-loading');
  await expect(loading).toBeVisible();
  await expect(loading.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  return { dialog, loading };
}

test('Luna hover rotates only its mark once, then settles while still hovered', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(root);
  await expect(page.locator('.halo-f-app')).toHaveAttribute('data-animate', 'true');
  const launcher = page.getByRole('button', { name: 'Ask Luna', exact: true });
  const mark = launcher.locator('.halo-luna-mark');
  await launcher.hover();
  expect(await mark.evaluate(node => getComputedStyle(node).animationName)).toBe('halo-luna-greet');
  expect(await mark.evaluate(node => getComputedStyle(node).animationIterationCount)).toBe('1');
  expect(await launcher.evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  await expect.poll(() => mark.evaluate(node => node.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
});

test('Keyboard focus uses the same finite Luna gesture', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(root);
  await expect(page.locator('.halo-f-app')).toHaveAttribute('data-animate', 'true');
  await page.keyboard.press('Tab');
  const launcher = page.getByRole('button', { name: 'Ask Luna', exact: true });
  await launcher.focus();
  await expect(launcher).toBeFocused();
  expect(await launcher.locator('svg').evaluate(node => getComputedStyle(node).animationName)).toBe('halo-luna-greet');
});

test('Pending Luna reply releases into waves and reconstructs once without implying completion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(root);
  const { dialog, loading } = await pendingReply(page);
  const mark = loading.locator('svg');
  await expect(mark).toHaveAttribute('data-loading', 'true');
  await expect(mark.locator('.halo-luna-facets path')).toHaveCount(5);
  await expect(mark.locator('.halo-luna-wave')).toHaveCount(3);
  expect(await mark.evaluate(node => getComputedStyle(node).animationDuration)).toBe('1.8s');
  expect(await mark.evaluate(node => getComputedStyle(node).animationIterationCount)).toBe('1');
  await expect.poll(() => mark.locator('.halo-luna-waves').evaluate(node => Number(getComputedStyle(node).opacity))).toBeGreaterThan(.5);
  await expect.poll(() => mark.evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length), { timeout: 6500 }).toBe(0);
  expect(await mark.locator('.halo-luna-facets').evaluate(node => getComputedStyle(node).opacity)).toBe('1');
  expect(await mark.locator('.halo-luna-waves').evaluate(node => getComputedStyle(node).opacity)).toBe('0');
  await expect(loading).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel request', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel request', exact: true }).click();
  await expect(loading).toHaveCount(0);
});

for (const scenario of ['device', 'app'] as const) {
  test(`Luna motion honors ${scenario} reduced motion and keeps an accessible pending status`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: scenario === 'device' ? 'reduce' : 'no-preference' });
    await page.goto(scenario === 'device' ? root : root.replace('motion=full', 'motion=reduce'));
    const launcher = page.getByRole('button', { name: 'Ask Luna', exact: true });
    await launcher.hover();
    expect(await launcher.locator('svg').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
    const { loading } = await pendingReply(page);
    await expect(loading).toHaveAttribute('role', 'status');
    expect(await loading.locator('svg').evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
    expect(await loading.locator('.halo-luna-facets').evaluate(node => getComputedStyle(node).opacity)).toBe('1');
    expect(await loading.locator('.halo-luna-waves').evaluate(node => getComputedStyle(node).opacity)).toBe('0');
  });
}
