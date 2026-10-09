import { test, expect, type Page } from '@playwright/test';

const recordRoute = '/foundation/preview/expanded?tab=home&destination=tests&homeView=detail&record=test-water-september&appearance=dark&motion=reduce';
const failures = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = []; failures.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname.startsWith('/api/')) { errors.push(`Unexpected request: ${url.pathname}`); return route.abort(); }
    return route.continue();
  });
});
test.afterEach(async ({ page }) => { expect(failures.get(page)).toEqual([]); });

test('Luna identifies herself on keyboard focus and reduced motion goes straight to the recorded stage', async ({ page }) => {
  await page.goto(recordRoute);
  const body = page.locator('.hg-test-progress-body');
  // Motion preferences show the truthful final state even before the timeline is scrolled into view.
  await expect.poll(() => body.evaluate(element => parseFloat(getComputedStyle(element).getPropertyValue('--test-travel')))).toBeGreaterThan(0);
  const immediate = await body.evaluate(element => ({
    actual: new DOMMatrixReadOnly(getComputedStyle(element.querySelector('.hg-test-luna-position')!).transform).m42,
    target: parseFloat(getComputedStyle(element).getPropertyValue('--test-travel')),
    fill: new DOMMatrixReadOnly(getComputedStyle(element.querySelector('.hg-test-progress-track span')!).transform).m22,
    fillTarget: parseFloat(getComputedStyle(element).getPropertyValue('--test-fill')),
  }));
  expect(immediate.actual).toBeCloseTo(immediate.target, 0);
  expect(immediate.fill).toBeCloseTo(immediate.fillTarget, 3);
  expect(await page.locator('.hg-luna-arm').count()).toBe(2);
  await body.scrollIntoViewIfNeeded();
  await expect(body).toHaveAttribute('data-entered', 'true');
  await expect(page.getByRole('button', { name: 'Edit recorded results' })).toBeVisible();
  const luna = page.getByRole('button', { name: 'Meet Luna', exact: true });
  await luna.focus();
  await expect(page.getByRole('tooltip')).toHaveText('I’m Luna. Keeping your paperwork on track.');
  await luna.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await luna.hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  const animation = await page.locator('.hg-test-luna-position').evaluate(element => getComputedStyle(element).transitionDuration);
  expect(animation).toBe('0s');
  await expect.poll(() => page.locator('.hg-test-progress-marker svg').first().evaluate(element => getComputedStyle(element).strokeDashoffset)).toBe('0px');
  await expect(page.locator('.hg-progress-list li').filter({ has: page.getByText('Arranged', { exact: true }) })).not.toHaveClass(/is-complete/);
  await expect(page.locator('.hg-progress-list li').filter({ has: page.getByText('Awaiting result', { exact: true }) })).not.toHaveClass(/is-complete/);
  await expect(page.getByRole('button', { name: 'Edit test arrangement' })).toHaveCount(0);
});

test('full motion fills the bar, runs Luna to the latest recorded stage and staggers only genuine checks', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(recordRoute.replace('motion=reduce', 'motion=full'));
  const body = page.locator('.hg-test-progress-body');
  await body.scrollIntoViewIfNeeded();
  await expect(body).toHaveAttribute('data-entered', 'true');
  await expect(body).toHaveAttribute('data-moving', 'true');
  const transition = await page.locator('.hg-test-luna-position').evaluate(element => getComputedStyle(element).transitionDuration);
  expect(transition).toBe('4.2s');
  const paperMotion = await page.locator('.hg-luna-paper-top-two').evaluate(element => getComputedStyle(element).animationName);
  expect(paperMotion).toBe('hg-luna-paper-hop');
  const completed = page.locator('.hg-progress-list li.is-complete');
  expect(await completed.count()).toBe(3);
  const delays = await completed.evaluateAll(elements => elements.map(element => parseFloat(getComputedStyle(element).getPropertyValue('--test-check-delay'))));
  expect(delays[0]).toBe(0);
  expect(delays[1]).toBeGreaterThan(delays[0]);
  expect(delays[2]).toBeGreaterThan(delays[1]);
  expect(delays[2]).toBe(4200);
  expect(await completed.last().locator('.hg-test-progress-marker svg').evaluate(element => parseFloat(getComputedStyle(element).strokeDashoffset))).toBeGreaterThan(0);
  await expect(body).toHaveAttribute('data-moving', 'false');
  const position = await body.evaluate(element => ({
    actual: new DOMMatrixReadOnly(getComputedStyle(element.querySelector('.hg-test-luna-position')!).transform).m42,
    target: parseFloat(getComputedStyle(element).getPropertyValue('--test-travel')),
  }));
  expect(position.actual).toBeCloseTo(position.target, 0);
  for (const check of await completed.locator('.hg-test-progress-marker svg').all()) {
    await expect.poll(() => check.evaluate(element => getComputedStyle(element).strokeDashoffset)).toBe('0px');
  }
  const currentMarker = await page.locator('.hg-progress-list li[aria-current="step"] .hg-test-progress-marker').boundingBox();
  const runner = await page.locator('.hg-test-luna').boundingBox();
  expect(runner!.y + runner!.height).toBeLessThan(currentMarker!.y);
  expect(await page.locator('.hg-luna-paper-top-two').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await expect(page.locator('.hg-progress-list li[aria-current="step"]')).toContainText('Result recorded');
  await expect(page.locator('.hg-progress-list li:not(.is-complete) .hg-test-progress-marker svg')).toHaveCount(0);
});

test('follow-up is recorded only after saving the same shared Plan action, not opening its dialog', async ({ page }) => {
  await page.goto(recordRoute);
  const followup = page.locator('.hg-progress-list li').filter({ has: page.getByText('Follow-up', { exact: true }) });
  await expect(followup).not.toHaveClass(/is-complete/);
  await page.getByRole('button', { name: 'Save to Plan', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save a practical step' });
  await expect(followup).not.toHaveClass(/is-complete/);
  await dialog.getByLabel('Action title').fill('Ask about the original report');
  await dialog.getByRole('button', { name: 'Save sample action', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(followup).toHaveClass(/is-complete/);
  await expect(followup).toContainText('Saved in Plan for later');
  await page.getByRole('button', { name: 'Edit saved follow-up', exact: true }).click();
  const existing = page.getByRole('dialog', { name: 'Your saved action' });
  await expect(existing.getByLabel('Action title')).toHaveValue('Ask about the original report');
  await existing.getByRole('button', { name: 'Close and keep draft' }).click();
  await expect(page.getByRole('button', { name: 'Mark record in follow-up', exact: true })).toHaveCount(0);
  await expect(page.getByRole('table')).toContainText('1.8');
});

test('arrangement pencil edits one recorded stage without erasing the test', async ({ page }) => {
  await page.goto('/foundation/preview/expanded?tab=home&destination=tests&homeView=new&appearance=dark&motion=reduce');
  await page.getByLabel('Test label (required)').fill('Luna timeline example');
  await page.getByLabel('Sample medium (required)').selectOption('water');
  await page.getByLabel('Home or site context (required)').selectOption('sample-current-home');
  await page.getByLabel('Purpose (required)').fill('Check the editable progress stages');
  await page.getByLabel('Current progress').selectOption('arranged');
  await page.getByRole('button', { name: 'Save test plan' }).click();
  await page.getByRole('button', { name: 'Edit test arrangement', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Test arrangement', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: /I arranged this test/ }).uncheck();
  await page.getByRole('button', { name: 'Save arrangement' }).click();
  await expect(page.getByRole('heading', { name: 'Luna timeline example', exact: true })).toBeVisible();
  await expect(page.locator('.hg-progress-list li').filter({ has: page.getByText('Arranged', { exact: true }) })).not.toHaveClass(/is-complete/);
  await expect(page.getByRole('button', { name: 'Edit test details', exact: true })).toBeVisible();
});

test('missing historical steps can be recorded without changing the existing results', async ({ page }) => {
  await page.goto(recordRoute);
  await page.getByText('Fill in an earlier step', { exact: true }).click();
  await page.getByRole('button', { name: 'Record earlier test arrangement', exact: true }).click();
  await page.getByRole('checkbox', { name: /I arranged this test/ }).check();
  await page.getByRole('button', { name: 'Save arrangement', exact: true }).click();
  await expect(page.locator('.hg-progress-list li').filter({ has: page.getByText('Arranged', { exact: true }) })).toHaveClass(/is-complete/);
  await expect(page.getByRole('table')).toContainText('1.8');
  await page.getByText('Fill in an earlier step', { exact: true }).click();
  await page.getByRole('button', { name: 'Record an earlier waiting stage', exact: true }).click();
  await page.getByRole('button', { name: 'Mark awaiting result', exact: true }).click();
  await expect(page.locator('.hg-progress-list li').filter({ has: page.getByText('Awaiting result', { exact: true }) })).toHaveClass(/is-complete/);
  await expect(page.getByRole('table')).toContainText('1.8');
  await expect(page.getByText('Fill in an earlier step', { exact: true })).toHaveCount(0);
});

for (const appearance of ['dark', 'light']) {
  test(`timeline stays readable at 320px and 150% text in ${appearance}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 850 });
    await page.goto(`${recordRoute.replace('appearance=dark', `appearance=${appearance}`)}&scale=150`);
    const progress = page.getByRole('region', { name: 'Test progress', exact: true });
    await progress.scrollIntoViewIfNeeded();
    const bounds = await progress.evaluate(element => {
      const outer = element.getBoundingClientRect();
      return [...element.querySelectorAll('.hg-test-edit,.hg-test-progress-copy,.hg-test-luna')].every(child => { const rect = child.getBoundingClientRect(); return rect.left >= outer.left && rect.right <= outer.right + 1; });
    });
    expect(bounds).toBe(true);
    const pencilSize = await page.getByRole('button', { name: 'Edit test details', exact: true }).boundingBox();
    expect(pencilSize!.width).toBeGreaterThanOrEqual(44);
    expect(pencilSize!.height).toBeGreaterThanOrEqual(44);
    await page.getByRole('button', { name: 'Meet Luna' }).click();
    const tooltip = await page.getByRole('tooltip').boundingBox();
    expect(tooltip!.x + tooltip!.width).toBeLessThanOrEqual(320);
    await page.getByRole('button', { name: 'Edit collection details' }).click();
    await expect(page.getByRole('heading', { name: 'Record sample collection' })).toBeVisible();
    await expect(page.getByLabel('Collection start date (required)')).toHaveValue('2026-09-22');
  });
}
