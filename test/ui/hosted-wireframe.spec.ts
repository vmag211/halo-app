import { test, expect } from '@playwright/test';

test.skip(process.env.HALO_HOSTED_REVIEW_TEST !== '1', 'Static hosted-review export only.');
test('hosted entry retains review settings and opens the shared four-tab layout', async ({ page }) => {
  const unexpected: string[] = [];
  page.on('pageerror', error => unexpected.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' || url.pathname.startsWith('/api/')) {
      unexpected.push(url.pathname); return route.abort();
    }
    return route.continue();
  });
  await page.goto('/?tab=home&appearance=light&motion=reduce&scale=115&time=day');
  await expect(page).toHaveURL(/\/foundation\/preview\/expanded\//);
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link')).toHaveText(['My Week', 'Today', 'Homeguard', 'Explore']);
  await expect(nav.getByRole('link', { name: 'Homeguard' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode', 'light');
  expect(new URL(page.url()).searchParams.get('scale')).toBe('115');
  await page.goto('/foundation/preview/expanded/?edition=legacy&motion=reduce');
  await expect(nav.getByRole('link')).toHaveText(['My Week', 'Today', 'Homeguard', 'Explore']);
  expect(unexpected).toEqual([]);
});

test('all household detail exports load without contacting a backend', async ({ page }) => {
  const unexpected: string[] = [];
  page.on('pageerror', error => unexpected.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' || url.pathname.startsWith('/api/')) {
      unexpected.push(url.pathname); return route.abort();
    }
    return route.continue();
  });
  for (const member of ['toddler', 'child', 'teen', 'adult', 'senior', 'pregnant', 'respiratory']) {
    const response = await page.goto(`/foundation/preview/household/${member}/?edition=expanded&motion=reduce`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Homeguard' })).toHaveAttribute('aria-current', 'page');
  }
  expect(unexpected).toEqual([]);
});
