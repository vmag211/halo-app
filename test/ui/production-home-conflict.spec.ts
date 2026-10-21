import { expect, test } from '@playwright/test';
import { sampleAssets } from '../../lib/frontend/home-maintenance-preview';
import { homeId, mockProduction } from './production-fixtures';
import { jsonRoute } from './stage-fixtures';

// A stale-revision refusal must bring the latest record into view, or "review the latest
// version" can only be done by reloading the whole app. The draft stays separate.
const original = { ...sampleAssets[0], id:'owned-filter', title:'Kitchen filter upkeep', revision:1, homeContextId:homeId };
for (const transport of ['receipt', 'http-409'] as const) test(`a refused revision (${transport}) reloads the latest record and keeps the draft`, async ({ page }) => {
  let server = original, assetReads = 0, writes = 0;
  const network = await mockProduction(page, {
    '/api/frontend/workspace': (route, url) => {
      const assets = url.searchParams.get('collection') === 'assets';
      if (assets) assetReads++;
      return jsonRoute(route, { records:assets ? [server] : [], revision:server.revision, availability:'ready', complete:true, pendingOperations:[] });
    },
    '/api/frontend/workspace/commands': route => {
      const command = route.request().postDataJSON(); writes++;
      expect(command.expectedRevision).toBe(1);
      const message = 'This record changed. Your draft is kept. Review the latest version before saving.';
      return transport === 'receipt'
        ? jsonRoute(route, { operationId:command.operationId, status:'failed', changes:{}, code:'conflict', message })
        : jsonRoute(route, { error:message, code:'conflict', message }, 409);
    },
  });
  await page.goto(`/app/homeguard/maintenance?homeView=edit&record=${original.id}`);
  const label = page.getByRole('textbox', { name:'Asset or routine label' });
  await expect(label).toHaveValue(original.title);
  await label.fill('My kitchen filter');
  server = { ...original, title:'Filter changed on another device', revision:2 };
  const readsBefore = assetReads;
  await page.getByRole('button', { name:'Save routine changes' }).click();
  await expect(page.getByText(/changed\. .*Review the latest version before saving\./).first()).toBeVisible();
  await expect.poll(() => assetReads).toBeGreaterThan(readsBefore);
  await expect(label).toHaveValue('My kitchen filter');
  await page.getByRole('button', { name:'Workspace overview' }).click();
  await expect(page.getByRole('button', { name:/^Filter changed on another device/ })).toBeVisible();
  expect(writes).toBe(1);
  expect(network.blocked).toEqual([]);
});
