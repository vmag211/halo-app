import { test, expect, type Page } from '@playwright/test';

async function landsOn(page: Page, id: string) {
  const target = page.locator(`#${id}`);
  await expect(target).toBeFocused();
  await expect.poll(async () => target.evaluate(node => {
    const top = node.getBoundingClientRect().top;
    const header = document.querySelector('.halo-f-header')!.getBoundingClientRect().bottom;
    return top >= header && top < innerHeight - 100;
  })).toBeTruthy();
  expect(new URL(page.url()).hash).toBe(`#${id}`);
}

for (const factor of ['air', 'uv', 'pollen', 'mold', 'pfas', 'radon', 'lead']) {
  test(`${factor}: section links scroll and the step deck cycles in place`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/foundation/preview/factor/${factor}/?appearance=dark&motion=reduce`);
    const nav = page.getByRole('navigation', { name: 'On this factor page' });
    for (const [name, id] of [['Summary', 'reading-overview'], ['Details', 'reading-detail'], ['Tips', 'protection'], ['References', 'reading-sources']]) {
      await nav.getByRole('link', { name, exact: true }).click();
      await landsOn(page, id);
    }
    await nav.getByRole('link', { name: 'Tips', exact: true }).click();
    const steps = page.locator('.halo-ph-step-list > li');
    const count = await steps.count();
    expect(count).toBeGreaterThan(1);
    const deck = page.getByRole('region', { name: 'Practical tips' });
    await deck.scrollIntoViewIfNeeded();
    const height = await deck.evaluate(node => node.getBoundingClientRect().height);
    for (let step = 1; step <= count; step++) {
      const next = step % count + 1;
      const button = deck.locator(':scope > button').last();
      await expect(button).toHaveAccessibleName(`Next step, step ${next}`);
      await button.click();
      await expect(steps.nth(next - 1)).toHaveAttribute('data-active', 'true');
      await expect(deck.getByRole('heading', { name: `Step ${next}`, exact: true })).toBeVisible();
      await expect(deck.getByRole('heading')).toHaveCount(1);
      await expect(button).toBeFocused();
      expect(await deck.evaluate(node => node.getBoundingClientRect().height)).toBeCloseTo(height, 0);
    }
    await deck.getByRole('button', { name: `Previous step, step ${count}`, exact: true }).press('Enter');
    await expect(steps.last()).toHaveAttribute('data-active', 'true');
    await expect(steps.first()).toHaveAttribute('inert', '');
    await expect(steps.last()).toHaveCSS('animation-name', 'none');
    await page.setViewportSize({ width: 320, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    expect(errors).toEqual([]);
  });
}

test('full-motion scrolling, reordered family link and respiratory label', async ({ page }, info) => {
  await page.goto('/foundation/preview/?tab=today&motion=reduce');
  const lastCard = page.getByTestId('factor-scorecard').last();
  const family = page.locator('.halo-ph-family-link');
  expect(await family.evaluate((node, card) => Boolean(card!.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING), await lastCard.elementHandle())).toBeTruthy();
  await page.goto('/foundation/preview/?tab=home&motion=reduce&scale=150');
  await expect(page.locator('.halo-home-person[data-member="respiratory"]')).toContainText('Respiratory Issue(s)');
  await page.setViewportSize({ width: 320, height: 850 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.goto('/foundation/preview/factor/mold/?appearance=dark&motion=full');
  await page.getByRole('navigation', { name: 'On this factor page' }).getByRole('link', { name: 'Tips', exact: true }).click();
  await landsOn(page, 'protection');
  await page.getByRole('button', { name: 'Next step, step 2', exact: true }).click();
  await expect(page.locator('#tip-mold-2')).toHaveAttribute('data-active', 'true');
  await expect(page.locator('#tip-mold-2')).toHaveCSS('animation-name', 'halo-step-forward');
  await expect(page.locator('#tip-mold-1')).toHaveCSS('flex-direction', 'column');
  await page.screenshot({ path: info.outputPath('numbered-tips.png'), animations: 'disabled' });
});

for (const appearance of ['light', 'dark']) test(`Today solid tints and rounded navigation fit ${appearance}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/foundation/preview/?tab=today&appearance=${appearance}&motion=reduce`);
  const cards = page.getByTestId('factor-scorecard');
  await expect(cards).toHaveCount(4);
  const colors = [];
  for (const card of await cards.all()) {
    await expect(card).toHaveCSS('background-image', 'none');
    colors.push(await card.evaluate(node => getComputedStyle(node).backgroundColor));
  }
  expect(new Set(colors).size).toBe(4);
  await expect(page.locator('.halo-f-tabs')).toHaveCSS('border-radius', '28px');
  await page.screenshot({ path: info.outputPath(`today-${appearance}.png`), fullPage: true });
  await page.goto(`/foundation/preview/factor/pfas/?tab=today&appearance=${appearance}&motion=reduce&scale=150`);
  await expect(page.getByRole('link', { name: 'Homeguard', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(new URL(page.url()).searchParams.get('tab')).toBe('home');
  await page.setViewportSize({ width: 320, height: 850 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  const deck = page.getByRole('region', { name: 'Practical tips' });
  await deck.getByRole('button', { name: 'Next step, step 2', exact: true }).click();
  await expect(deck.getByRole('heading', { name: 'Step 2', exact: true })).toBeVisible();
});
