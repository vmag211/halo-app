import { expect, test } from '@playwright/test';
import type { TestRecord } from '../../lib/frontend/home-test-preview';
import { applyReviewActionCommand, type ActionSnapshot } from '../../lib/frontend/production/action-service';
import { homeId, mockProduction } from './production-fixtures';
import { jsonRoute } from './stage-fixtures';

// Service responses are deliberately controlled. This checks the connected
// frontend contract, not actual lab testing or measured benefit from an action.
test('a household concern leads to a test, tracked action and later compatible result', async ({ page }, info) => {
  test.setTimeout(90000);
  const records: TestRecord[] = [];
  let collectionRevision = 1, writes = 0, actionWrites = 0;
  let actions: ActionSnapshot = { actions:[], metas:{}, unresolvedOperations:[] };
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const network = await mockProduction(page, {
    '/api/frontend/workspace': (route, url) => jsonRoute(route, { records:url.searchParams.get('collection') === 'tests' ? records : [], revision:collectionRevision, availability:'ready', complete:true, pendingOperations:[] }),
    '/api/frontend/workspace/commands': async route => {
      const command = route.request().postDataJSON();
      expect(command.kind).toBe('write'); expect(command.collection).toBe('tests');
      expect(route.request().headers()['idempotency-key']).toBe(command.operationId);
      expect(route.request().headers()['x-halo-home-context']).toBe(homeId);
      const index = records.findIndex(record => record.id === command.record.id);
      expect(command.expectedRevision).toBe(index < 0 ? null : records[index].revision);
      const canonical = { ...command.record, revision:(index < 0 ? 0 : records[index].revision) + 1 } as TestRecord;
      if (index < 0) records.push(canonical); else records[index] = canonical;
      writes++; collectionRevision++;
      await jsonRoute(route, { operationId:command.operationId, status:'succeeded', changes:{ tests:records }, revisions:{ tests:collectionRevision } });
    },
    '/api/frontend/actions': route => jsonRoute(route, actions),
    '/api/frontend/actions/commands': async route => {
      const command = route.request().postDataJSON();
      expect(route.request().headers()['idempotency-key']).toBe(command.operationId);
      expect(route.request().headers()['x-halo-home-context']).toBe(homeId);
      const next = applyReviewActionCommand(actions, command, () => `server-action-${++actionWrites}`);
      expect(next).not.toBeNull(); actions = { ...next!, unresolvedOperations:[] };
      await jsonRoute(route, { operationId:command.operationId, status:'succeeded', snapshot:actions });
    },
  });
  await page.setViewportSize({ width:390, height:844 });
  await page.goto('/app/homeguard');
  const initialScore = await page.locator('.halo-environment-score').getAttribute('aria-label');
  await page.getByTestId('factor-scorecard').filter({ hasText:'Radon' }).click();
  await expect(page.locator('.halo-ph-detail')).toHaveAttribute('data-factor', 'radon');
  await expect(page.getByRole('heading', { name:'Small steps that help', exact:true })).toBeVisible();
  await page.getByRole('link', { name:'Back to your overview', exact:true }).click();
  await page.locator('#home-workspace .how-priority').getByRole('link', { name:'Plan a test', exact:true }).click();

  async function prepare(label: string, day: string) {
    await page.getByLabel('Test label (required)').fill(label);
    await page.getByRole('combobox', { name:'Test kind (required)', exact:true }).selectOption('radon');
    await page.getByLabel('Sample medium (required)').selectOption('air');
    await page.getByLabel('Home or site context (required)').selectOption(homeId);
    await page.getByLabel('Purpose (required)').fill('Document the level in the lower-level room.');
    await page.getByLabel('Proposed test date (optional)').fill(day);
    await page.getByRole('button', { name:'Save test plan', exact:true }).click();
    await expect(page.getByRole('heading', { name:label, exact:true })).toBeVisible();
  }
  async function result(label: string, day: string, end: string, value: string) {
    await page.getByRole('button', { name:'I arranged this test', exact:true }).click();
    await page.getByRole('button', { name:'Record collection', exact:true }).click();
    await page.getByLabel('Collection start date (required)').fill(day);
    await page.getByLabel('Collection end date (required)').fill(end);
    await page.getByLabel('Sample location label (required)').fill('Lower-level room');
    await page.getByLabel('Collection or test method (optional)').fill('Reported short-duration kit');
    await page.getByRole('button', { name:'Save collection', exact:true }).click();
    await page.getByRole('button', { name:'Enter results', exact:true }).click();
    await page.getByRole('textbox', { name:/^Analyte or parameter/ }).fill('Radon');
    await page.getByLabel('Original reported value or text', { exact:true }).fill(value);
    await page.getByLabel('Original reported unit', { exact:true }).fill('pCi/L');
    await page.getByRole('combobox', { name:'Reporting qualifier', exact:true }).selectOption('measured');
    await page.getByRole('textbox', { name:/^Result or report date/ }).fill(end);
    await page.getByLabel('I compared these fields with my original report').check();
    await page.getByRole('button', { name:'Save confirmed transcription', exact:true }).click();
    await expect(page.getByRole('heading', { name:label, exact:true })).toBeVisible();
    await expect(page.getByRole('table')).toContainText(value);
  }

  await prepare('Initial home radon report', '2026-09-01');
  const firstId = records[0].id;
  await page.getByRole('button', { name:'Save to My Week', exact:true }).click();
  await page.getByLabel('All-day date (optional)').fill('2026-09-01');
  await page.getByRole('button', { name:'Save action', exact:true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('navigation', { name:'Main navigation', exact:true }).getByRole('link', { name:'My Week', exact:true }).click();
  // Open the canonical task through its service-restored deep link, then record
  // completion using the same editor rather than creating a second action.
  await page.goto(`/app/plan?weekTask=${actions.actions[0].id}`);
  await page.getByRole('combobox', { name:'Status', exact:true }).selectOption('completed');
  await page.getByRole('button', { name:/Save changes|Save task/, exact:true }).click();
  await expect.poll(() => actions.actions[0].state).toBe('completed');
  expect(actions.actions).toHaveLength(1);
  await page.goto(`/app/homeguard/tests?view=main&homeView=detail&record=${firstId}`);
  await result('Initial home radon report', '2026-09-01', '2026-09-03', '5.0');
  await page.getByRole('link', { name:'Back to Homeguard', exact:true }).click();
  await expect(page.locator('.halo-environment-score')).toHaveAttribute('aria-label', initialScore!);
  await page.locator('#home-workspace .how-add-menu > summary').click();
  await page.locator('#home-workspace').getByRole('link', { name:'Plan a test', exact:true }).click();
  await prepare('Later home radon report', '2026-10-01');
  await result('Later home radon report', '2026-10-01', '2026-10-03', '3.0');
  await page.getByRole('button', { name:/Compare records/ }).click();
  await page.getByLabel('Compare with another record').selectOption(firstId);
  await expect(page.getByRole('heading', { name:'Compatible reported values', exact:true })).toBeVisible();
  await expect(page.getByRole('table')).toContainText('5.0 pCi/L');
  await expect(page.getByRole('table')).toContainText('3.0 pCi/L');
  await expect(page.getByText(/A difference is not a safety assessment or evidence that a HALO action caused a change/)).toBeVisible();
  await page.reload();
  await page.getByLabel('Compare with another record').selectOption(firstId);
  await expect(page.getByRole('heading', { name:'Compatible reported values', exact:true })).toBeVisible();
  expect(records).toHaveLength(2); expect(records[0].rows[0].originalValue).toBe('5.0');
  expect(records[1].rows[0].originalValue).toBe('3.0'); expect(writes).toBe(8);
  expect(actions.actions).toHaveLength(1); expect(network.blocked).toEqual([]); expect(errors).toEqual([]);
  await page.screenshot({ path:info.outputPath('later-compatible-result.png'), fullPage:true });
});
