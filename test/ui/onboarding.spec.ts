import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // The preview must not touch auth, providers or any live data route.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' && !url.pathname.startsWith('/api/') ? route.continue() : route.abort();
  });
});

async function welcome(page: Page, scenario = 'default') {
  await page.goto(`/onboarding/preview?scenario=${scenario}`);
  await expect(page.getByRole('button', { name: 'Get started', exact: true })).toBeEnabled();
}
async function address(page: Page, scenario = 'default') {
  await welcome(page, scenario);
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
}
async function household(page: Page, scenario = 'default') {
  await address(page, scenario);
  await page.getByLabel('Address or ZIP code', { exact: true }).fill('28025');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Who lives here?' })).toBeVisible();
}
async function home(page: Page, scenario = 'default') {
  await household(page, scenario);
  await page.getByRole('button', { name: 'Skip this', exact: true }).click();
}
async function reveal(page: Page, scenario = 'default', water = 'utility') {
  await home(page, scenario);
  await page.locator('#halo-water').selectOption(water);
  await page.getByRole('button', { name: 'See my results', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Results reveal' })).toBeAttached();
  await expect(page.getByRole('button', { name: 'See my results', exact: true })).toBeEnabled();
}

test('complete flow, keyboard chips, back/forward and privacy', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await household(page);
  const adult = page.getByRole('button', { name: 'Adult', exact: true });
  await adult.focus(); await page.keyboard.press('Space');
  await expect(adult).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('#halo-address')).toHaveValue('28025');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.locator('#halo-address')).toHaveValue('28025');
  await page.goForward();
  await expect(adult).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.locator('#halo-year').fill('1964');
  await page.locator('#halo-water').selectOption('not_sure');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Skip this', exact: true }).click();
  await expect(page.locator('#halo-year')).toHaveValue('1964');
  await expect(page.locator('#halo-water')).toHaveValue('not_sure');
  await page.getByRole('button', { name: 'See my results', exact: true }).click();
  await expect(page.locator('.halo-reveal-line')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'See my results', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'See my results', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Onboarding flow complete' })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify({ local: localStorage, session: sessionStorage, history: history.state, url: location.href }))).not.toContain('28025');
  expect(await page.locator('body').innerText()).not.toContain('\u2014');
  expect(errors).toEqual([]);
});

test('validation retains values and focuses the invalid field', async ({ page }) => {
  await address(page);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('#halo-address')).toBeFocused();
  await expect(page.getByText('Enter an address or ZIP code.', { exact: true })).toBeVisible();
  await page.locator('#halo-address').fill('28025');
  await expect(page.locator('#halo-address')).toHaveAttribute('aria-invalid', 'false');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Skip this', exact: true }).click();
  await page.locator('#halo-year').fill('1699');
  await page.getByRole('button', { name: 'See my results', exact: true }).click();
  await expect(page.locator('#halo-year')).toBeFocused();
  await expect(page.getByText('Enter a four-digit year, or leave this blank.', { exact: true })).toBeVisible();
  await page.locator('#halo-year').fill('9999'); await page.locator('#halo-year').blur();
  await expect(page.getByText("That year hasn't happened yet.", { exact: true })).toBeVisible();
  await page.locator('#halo-year').fill('');
  await page.getByRole('button', { name: 'See my results', exact: true }).click();
  await expect(page.locator('#halo-water')).toBeFocused();
  await page.locator('#halo-water').selectOption('well');
  await page.getByRole('button', { name: 'See my results', exact: true }).click();
  await expect(page.getByText('Private well (no utility)', { exact: true })).toBeVisible();
});

for (const [scenario, expected] of [
  ['default', 'PFOS found above the limit'], ['below', 'Nothing found above federal limits'],
  ['well', 'Private well (no utility)'], ['spring', 'Spring (no utility)'],
  ['no-utility', 'No utility matched your address'], ['boundary-failed', "Couldn't check right now"],
  ['no-results', 'No published water results yet for your utility.'], ['unregulated', 'Found compounds with no federal limit'],
  ['lookup-failed', "Couldn't check right now"], ['radon-missing', 'Not available for this county'],
  ['outside', 'Covers North Carolina only'], ['air-missing', 'No data'], ['unknown-severity', 'No data'],
  ['null-fields', 'No data'], ['air-error', "Couldn't check right now"], ['home-error', "Couldn't check right now"], ['all-error', "Couldn't check right now"],
]) {
  test(`honest reveal: ${scenario}`, async ({ page }) => {
    await reveal(page, scenario);
    await expect(page.locator('.halo-result').filter({ hasText: expected }).first()).toBeVisible();
    if (scenario.endsWith('error')) {
      await expect(page.getByText('Some checks could not be completed. This is not a finding about your environment.')).toBeVisible();
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await expect(page.getByText('Some checks could not be completed. This is not a finding about your environment.')).toBeHidden();
    }
  });
}

for (const scenario of ['captcha', 'signin', 'session-timeout']) {
  test(`session retry: ${scenario}`, async ({ page }) => {
    await page.goto(`/onboarding/preview?scenario=${scenario}`);
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Get started', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Get started', exact: true })).toBeEnabled();
  });
}
for (const scenario of ['address-not-found', 'rate-limited', 'address-error', 'timeout']) {
  test(`address retry retains input: ${scenario}`, async ({ page }) => {
    await address(page, scenario);
    await page.locator('#halo-address').fill('28025');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('#halo-address')).toHaveValue('28025');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Who lives here?' })).toBeVisible();
  });
}
test('household and home retries retain selections', async ({ page }) => {
  await household(page, 'household-error');
  await page.getByRole('button', { name: 'Teen', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Teen', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A little about your home.' })).toBeVisible();
  await home(page, 'home-save-error');
  await page.locator('#halo-water').selectOption('spring');
  await page.getByRole('button', { name: 'See my results', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('#halo-water')).toHaveValue('spring');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Spring (no utility)', { exact: true })).toBeVisible();
});

test('geolocation only on request, denied and typed override', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 35.409, longitude: -80.579 });
  await address(page);
  await expect(page.locator('#halo-address')).toHaveValue('');
  await page.getByRole('button', { name: 'Use my location', exact: true }).click();
  await expect(page.locator('#halo-address')).toHaveValue('Using your current location');
  await page.locator('#halo-address').fill('28025');
  await expect(page.locator('#halo-address')).toHaveValue('28025');
  await page.evaluate(() => Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (_ok: unknown, failure: (error: object) => void) => failure({ code: 1 }) } }));
  await page.getByRole('button', { name: 'Use my location', exact: true }).click();
  await expect(page.getByText("Couldn't get your location. Please type your address instead.")).toBeVisible();
  await page.evaluate(() => Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined }));
  await page.getByRole('button', { name: 'Use my location', exact: true }).click();
  await expect(page.getByText("This device can't share its location. Please type your address.")).toBeVisible();
});

test('late request cannot advance after Back; offline status recovers', async ({ page, context }) => {
  await address(page);
  await page.locator('#halo-address').fill('28025');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Who lives here?' })).toBeHidden();
  await context.setOffline(true);
  await expect(page.getByText("You're offline.", { exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText("You're offline.", { exact: true })).toBeHidden();
});

test('handwriting completes before subtitle; CTA never waits for animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await welcome(page);
  await expect(page.locator('canvas[data-writing="writing"]')).toBeVisible();
  await expect(page.locator('.halo-welcome-subtitle')).toHaveCSS('opacity', '0');
  await expect(page.locator('canvas[data-writing="complete"]')).toBeVisible();
  await expect(page.locator('.halo-welcome-subtitle')).toHaveCSS('opacity', '1');
});

for (const colorScheme of ['light', 'dark'] as const) for (const width of [320, 375]) {
  test(`approved screen comparison ${colorScheme} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await welcome(page);
    // Match the isolated product baseline, without fractional toolbar offsets
    // or the development-only Next.js indicator overlapping the capture.
    await page.addStyleTag({ content: '.halo-preview-toolbar, nextjs-portal { display: none !important; }' });
    const product = page.locator('.halo-app');
    const shot = async (screen: number, state = 'default') => {
      await expect(product).toHaveCSS('background-color', colorScheme === 'light' ? 'rgb(238, 248, 247)' : 'rgb(8, 23, 37)');
      await expect(product).toHaveCSS('border-top-width', '1px');
      await page.evaluate(() => document.fonts.ready);
      await expect(product).toHaveScreenshot(`${colorScheme}-${width}-${screen}-${state}.png`, { animations: 'disabled', maxDiffPixelRatio: 0.005 });
      expect(await product.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    };
    await shot(1);
    await page.getByRole('button', { name: 'Get started', exact: true }).click(); await shot(2);
    await page.locator('#halo-address').fill('28025');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Who lives here?' })).toBeVisible(); await shot(3);
    await page.getByRole('button', { name: 'Skip this', exact: true }).click(); await shot(4);
    await page.locator('#halo-water').selectOption('utility');
    await page.getByRole('button', { name: 'See my results', exact: true }).click();
    await expect(page.getByRole('button', { name: 'See my results', exact: true })).toBeEnabled(); await shot(5);
  });
}

for (const width of [430, 1280]) test(`responsive layout ${width} and enlarged text`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await household(page);
  await page.addStyleTag({ content: '.halo-app p, .halo-app label, .halo-app button { font-size: 200%; line-height: 1.5; }' });
  expect(await page.locator('.halo-app').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  for (const button of await page.locator('.halo-app button').all()) {
    const box = await button.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});
