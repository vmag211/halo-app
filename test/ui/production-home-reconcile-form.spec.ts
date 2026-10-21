import { expect, test } from '@playwright/test';
import { sampleAssets } from '../../lib/frontend/home-maintenance-preview';
import { homeId, mockProduction } from './production-fixtures';
import { jsonRoute } from './stage-fixtures';

// A save whose answer was lost stays unconfirmed until its status is checked. Once the check
// confirms it, the form finishes exactly as a direct success does (draft cleared, record shown);
// a check that finds it failed keeps the draft for a deliberate retry. Nothing is claimed early.
const original = { ...sampleAssets[0], id:'owned-filter', title:'Kitchen filter upkeep', revision:1, homeContextId:homeId };
for (const outcome of ['succeeded', 'failed'] as const) test(`a lost routine save checked as ${outcome}`, async ({ page }) => {
  let server = original, pending: { operationId:string; record:typeof original } | null = null, writes = 0;
  const network = await mockProduction(page, {
    '/api/frontend/workspace': (route, url) => jsonRoute(route, { records:url.searchParams.get('collection') === 'assets' ? [server] : [], revision:server.revision, availability:'ready', complete:true, pendingOperations:[] }),
    '/api/frontend/workspace/commands': route => { const command = route.request().postDataJSON(); writes++; pending = { operationId:command.operationId, record:command.record }; return route.abort('failed'); },
    '/api/operations': (route, url) => {
      const operationId = url.searchParams.get('operationId')!;
      expect(operationId).toBe(pending?.operationId);
      if (outcome === 'failed') return jsonRoute(route, { operationId, status:'failed', changes:{}, message:'The change was not saved. Your draft is kept.' });
      server = { ...pending!.record, revision:2 };
      return jsonRoute(route, { operationId, status:'succeeded', changes:{ assets:[server] }, revisions:{ assets:2 } });
    },
  });
  await page.goto(`/app/homeguard/maintenance?homeView=edit&record=${original.id}`);
  const label = page.getByRole('textbox', { name:'Asset or routine label' });
  await label.fill('Kitchen filter, new cartridge');
  await page.getByRole('button', { name:'Save routine changes' }).click();
  // Unconfirmed: nothing claimed, the draft held as sent.
  await expect(page.getByText('This save is not confirmed yet. Check its status. Your draft is kept as sent.')).toBeVisible();
  await expect(label).toBeDisabled();
  await expect(label).toHaveValue('Kitchen filter, new cartridge');
  await page.getByRole('button', { name:'Check save status' }).first().click();
  if (outcome === 'succeeded') {
    await expect(page.locator('[data-home-heading]')).toHaveText('Kitchen filter, new cartridge');
    await expect(label).toHaveCount(0);
    await page.getByText('Manage routine', { exact:true }).click();
    await page.getByRole('button', { name:'Edit schedule & details' }).click();
    // The reopened form shows the saved record, not the outdated draft.
    await expect(label).toHaveValue('Kitchen filter, new cartridge');
    await expect(label).toBeEnabled();
  } else {
    await expect(page.getByText('The change was not saved. Your draft is kept.').first()).toBeVisible();
    await expect(label).toBeEnabled();
    await expect(label).toHaveValue('Kitchen filter, new cartridge');
    await expect(page.getByRole('button', { name:'Save routine changes' })).toBeEnabled();
  }
  expect(writes).toBe(1);
  expect(network.blocked).toEqual([]);
});
