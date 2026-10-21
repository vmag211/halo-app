import { expect, test } from '@playwright/test';
import { homeId, mockProduction } from './production-fixtures';
import { jsonRoute } from './stage-fixtures';

/**
 * Production ships with the Homeguard `workspace` and `summaries` capabilities off.
 * Their reads answer 503 feature_unavailable: a settled "not available yet", never a
 * failure with Try again, an empty library that invites a doomed save, or a sent write.
 */
const off = (message: string) => ({ error:message, code:'feature_unavailable', message, field_errors:[], retryable:false });
const workspaceOff = off('Homeguard records are not available yet. Nothing was changed.');
const summariesOff = off('Saved summaries are not available yet. Nothing was saved.');
const notice = 'Saving Homeguard records is not available yet. Nothing has changed, and the rest of Homeguard still works.';

async function capabilitiesOff(page: Parameters<typeof mockProduction>[0]) {
  const commands: string[] = [];
  const network = await mockProduction(page, {
    '/api/frontend/workspace': route => jsonRoute(route, workspaceOff, 503),
    '/api/frontend/workspace/commands': route => { commands.push(route.request().method()); return jsonRoute(route, workspaceOff, 503); },
    '/api/summaries': route => jsonRoute(route, summariesOff, 503),
  });
  return { network, commands };
}

for (const viewport of [{ width:375, height:812 }, { width:820, height:1180 }, { width:1440, height:900 }]) test(`the Homeguard overview says records are not available yet at ${viewport.width}px`, async ({ page }) => {
  await page.setViewportSize(viewport);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const { network } = await capabilitiesOff(page);
  await page.goto('/app/homeguard');
  const workspace = page.locator('#home-workspace');
  await expect(workspace.getByRole('status')).toHaveText(notice);
  await expect(workspace).not.toContainText('could not load');
  await expect(workspace.getByRole('button', { name:'Try again' })).toHaveCount(0);
  await expect(workspace.getByLabel('Add a home record')).toHaveCount(0);
  await expect(workspace.getByRole('link', { name:'Open test records' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
  expect(network.blocked).toEqual([]);
});

test('Tests and Home care show no empty library or creation entry while saving is off', async ({ page }) => {
  const { network } = await capabilitiesOff(page);
  await page.goto('/app/homeguard/tests');
  await expect(page.locator('.hg-workspace .hg-notice[role="status"]')).toHaveText(notice);
  await expect(page.getByRole('heading', { name:'Test records are not available yet' })).toBeVisible();
  await expect(page.getByText('Start your home record')).toHaveCount(0);
  await expect(page.getByText('0 records')).toHaveCount(0);
  await expect(page.getByRole('button', { name:/^Plan a test/ })).toHaveCount(0);
  await expect(page.locator('.hg-workspace').getByRole('button', { name:'Try again' })).toHaveCount(0);
  await page.goto('/app/homeguard/maintenance');
  await expect(page.getByRole('heading', { name:'Routines are not available yet' })).toBeVisible();
  await expect(page.getByRole('heading', { name:'Observations are not available yet' })).toBeVisible();
  await expect(page.getByRole('button', { name:/^Add a routine/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name:'Record suspected mold' })).toHaveCount(0);
  expect(network.blocked).toEqual([]);
});

test('a save reached by a direct link is refused locally and never sent', async ({ page }) => {
  const { network, commands } = await capabilitiesOff(page);
  await page.goto('/app/homeguard/tests?homeView=new');
  await page.getByLabel('Test label (required)').fill('Basement radon');
  await page.getByRole('combobox', { name:'Test kind (required)', exact:true }).selectOption('radon');
  await page.getByLabel('Sample medium (required)').selectOption('air');
  await page.getByLabel('Home or site context (required)').selectOption(homeId);
  await page.getByLabel('Purpose (required)').fill('Document the level downstairs.');
  await page.getByRole('button', { name:'Save test plan', exact:true }).click();
  await expect(page.getByText('Saving Homeguard records is not available yet. Nothing was saved. Your draft is kept.').first()).toBeVisible();
  await expect(page.getByLabel('Test label (required)')).toHaveValue('Basement radon');
  await expect(page.getByRole('button', { name:'Check save status' })).toHaveCount(0);
  expect(commands).toEqual([]);
  expect(network.blocked).toEqual([]);
});

test('Summary says household summaries are not available yet, without a retry', async ({ page }) => {
  const { network } = await capabilitiesOff(page);
  await page.goto('/app/homeguard/summary');
  await expect(page.getByText('Household summaries are not available yet. Nothing has changed, and your selections are kept.')).toBeVisible();
  await expect(page.getByText('This service is unavailable')).toHaveCount(0);
  await expect(page.getByText('Saved summaries', { exact:true })).toHaveCount(0);
  await expect(page.locator('.hg-workspace').getByRole('button', { name:'Try again' })).toHaveCount(0);
  await expect(page.getByRole('button', { name:'Create household PDF' })).toBeDisabled();
  await expect(page.locator('.hg-summary-cta')).toContainText('Creating a household PDF is not available yet.');
  expect(network.blocked).toEqual([]);
});

test('a real outage still reports the failure and offers Try again', async ({ page }) => {
  let fail = true;
  const network = await mockProduction(page, {
    '/api/frontend/workspace': route => fail ? jsonRoute(route, { error:'x', code:'upstream_unavailable', message:'x', retryable:true }, 503) : jsonRoute(route, { records:[], revision:1, availability:'ready', complete:true, pendingOperations:[] }),
  });
  await page.goto('/app/homeguard');
  const workspace = page.locator('#home-workspace');
  await expect(workspace).toContainText('Your home records could not load.');
  await page.goto('/app/homeguard/tests');
  await expect(page.getByRole('heading', { name:'Your test records could not load' })).toBeVisible();
  await expect(page.getByText('Start your home record')).toHaveCount(0);
  fail = false;
  await page.locator('.hg-workspace .hg-error').getByRole('button', { name:'Try again' }).click();
  await expect(page.getByRole('heading', { name:'Start your home record' })).toBeVisible();
  expect(network.blocked).toEqual([]);
});
