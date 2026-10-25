import { expect, test } from '@playwright/test';
import { sampleAssets } from '../../lib/frontend/home-maintenance-preview';
import { homeId, mockProduction, settingsSnapshot } from './production-fixtures';
import { jsonRoute, stageProfile } from './stage-fixtures';

// Release network tests (2026-10-25). A save the server never recorded (an injected 500 or 503, or a
// request lost on the way out) used to lock its surface: the status check answered 404 and the only way
// out was a reload, which also dropped the draft. The check now sends the same save again under the same
// id, which the server applies at most once. A device that knows it is offline is refused as offline,
// never as an unconfirmed save.

const notRecorded = (route: Parameters<typeof jsonRoute>[0]) => jsonRoute(route, { error: 'No such operation.', code: 'not_found' }, 404);

test('My Week: a task save the server never recorded is sent again under the same id by Check save status', async ({ page }) => {
  let snapshot: { actions: unknown[]; metas: Record<string, unknown>; unresolvedOperations: string[] } = { actions: [], metas: {}, unresolvedOperations: [] };
  const ids: string[] = []; let checks = 0;
  const network = await mockProduction(page, {
    '/api/frontend/actions': route => jsonRoute(route, snapshot),
    '/api/frontend/actions/commands': async route => {
      const body = route.request().postDataJSON(); ids.push(body.operationId);
      expect(route.request().headers()['idempotency-key']).toBe(body.operationId);
      if (ids.length === 1) return jsonRoute(route, { error: 'Server error' }, 500);
      snapshot = { actions: body.seeds.map((seed: object) => ({ ...seed, id: 'canonical-task-1', revision: 1, state: 'saved', date: body.date })), metas: body.metadata, unresolvedOperations: [] };
      return jsonRoute(route, { operationId: body.operationId, status: 'succeeded', snapshot });
    },
    '/api/operations': async (route, url) => { checks++; expect(url.searchParams.get('operationId')).toBe(ids[0]); return notRecorded(route); },
  });
  await page.goto('/plan');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  const sheet = page.locator('#week-task-detail');
  await sheet.getByLabel('Task title').fill('Water the new seedlings');
  await sheet.getByRole('button', { name: 'Save task', exact: true }).click();
  await expect(sheet.getByRole('button', { name: 'Check save status', exact: true })).toBeVisible();
  await expect(sheet.getByLabel('Task title')).toHaveValue('Water the new seedlings');
  expect(ids).toHaveLength(1);
  await sheet.getByRole('button', { name: 'Check save status', exact: true }).click();
  // Confirmed: the sheet closes and the task shows, saved once under the original id.
  await expect(page.locator('#week-task-detail')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Water the new seedlings/ }).first()).toBeVisible();
  expect(checks).toBe(1);
  expect(ids).toEqual([ids[0], ids[0]]);
  expect(network.blocked).toEqual([]);
});

test('My Week: a delete whose answer was lost closes its sheet once the check confirms it, so it cannot be sent again', async ({ page }) => {
  const task = { id: 'task-1', key: 'personal:compost', title: 'Turn the compost', reason: 'A task you deliberately added in My Week.', origin: 'Personal', date: '', state: 'saved', revision: 1 };
  let snapshot: Record<string, unknown> = { actions: [task], metas: {}, unresolvedOperations: [] }; const ids: string[] = [];
  await mockProduction(page, {
    '/api/frontend/actions': route => jsonRoute(route, snapshot),
    '/api/frontend/actions/commands': async route => { ids.push(route.request().postDataJSON().operationId); snapshot = { actions: [], metas: {}, unresolvedOperations: [] }; await route.abort('failed'); },
    '/api/operations': async route => jsonRoute(route, { operationId: ids[0], status: 'succeeded', snapshot }),
  });
  await page.goto('/plan');
  await page.getByRole('button', { name: /Turn the compost/ }).first().click();
  const sheet = page.locator('#week-task-detail');
  await sheet.getByRole('button', { name: 'Delete task' }).click();
  await sheet.getByRole('button', { name: 'Yes, delete' }).click();
  await sheet.getByRole('button', { name: 'Check save status', exact: true }).click();
  await expect(page.locator('#week-task-detail')).toHaveCount(0);
  await expect(page.getByText('Your change was saved.')).toBeVisible();
  expect(ids).toHaveLength(1);
});

test('My Week: the weekly review sheet offers its own status check for an unconfirmed plan', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const task = { id: 'task-1', key: 'personal:seed-packets', title: 'Sort seed packets', reason: 'A task you deliberately added in My Week.', origin: 'Personal', date: '', state: 'saved', revision: 1 };
  let snapshot: Record<string, unknown> = { actions: [task], metas: {}, unresolvedOperations: [] }; let lostId = '';
  await mockProduction(page, {
    '/api/frontend/actions': route => jsonRoute(route, snapshot),
    '/api/frontend/actions/commands': async route => { const body = route.request().postDataJSON(); lostId = body.operationId; snapshot = { ...snapshot, preferences: body.preferences }; await route.abort('failed'); },
    '/api/operations': async (route, url) => { expect(url.searchParams.get('operationId')).toBe(lostId); await jsonRoute(route, { operationId: lostId, status: 'succeeded', snapshot }); },
  });
  await page.goto('/plan');
  await page.getByRole('button', { name: 'Plan my weekly review' }).click();
  const sheet = page.locator('#week-review-planning');
  await sheet.getByLabel('Weekly focus').selectOption({ label: 'Sort seed packets' });
  await sheet.getByRole('button', { name: 'Review my changes' }).click();
  await sheet.getByRole('button', { name: 'Apply week plan' }).click();
  await expect(sheet.getByRole('button', { name: 'Check save status', exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'Check save status', exact: true }).click();
  await expect(sheet.getByText('Saved. The existing task result was recovered.')).toBeVisible();
});

test('Homeguard: a routine save the server never recorded is sent again under the same id', async ({ page }) => {
  const original = { ...sampleAssets[0], id: 'owned-filter', title: 'Kitchen filter upkeep', revision: 1, homeContextId: homeId };
  let server = original; const ids: string[] = []; let checks = 0;
  const network = await mockProduction(page, {
    '/api/frontend/workspace': (route, url) => jsonRoute(route, { records: url.searchParams.get('collection') === 'assets' ? [server] : [], revision: server.revision, availability: 'ready', complete: true, pendingOperations: [] }),
    '/api/frontend/workspace/commands': async route => {
      const command = route.request().postDataJSON(); ids.push(command.operationId);
      if (ids.length === 1) return jsonRoute(route, { error: 'Service unavailable' }, 503);
      server = { ...command.record, revision: 2 };
      return jsonRoute(route, { operationId: command.operationId, status: 'succeeded', changes: { assets: [server] }, revisions: { assets: 2 } });
    },
    '/api/operations': async (route, url) => { checks++; expect(url.searchParams.get('operationId')).toBe(ids[0]); return notRecorded(route); },
  });
  await page.goto(`/app/homeguard/maintenance?homeView=edit&record=${original.id}`);
  const label = page.getByRole('textbox', { name: 'Asset or routine label' });
  await label.fill('Kitchen filter, new cartridge');
  await page.getByRole('button', { name: 'Save routine changes' }).click();
  await expect(page.getByText('This save is not confirmed yet. Check its status. Your draft is kept as sent.')).toBeVisible();
  await page.getByRole('button', { name: 'Check save status' }).first().click();
  await expect(page.locator('[data-home-heading]')).toHaveText('Kitchen filter, new cartridge');
  expect(checks).toBe(1);
  expect(ids).toEqual([ids[0], ids[0]]);
  expect(network.blocked).toEqual([]);
});

test('Journal: an unconfirmed check-in offers a status check on the Journal itself', async ({ page }) => {
  let lostId = '', record: Record<string, unknown> | null = null;
  await mockProduction(page, {
    '/api/frontend/workspace/commands': async route => { const command = route.request().postDataJSON(); lostId = command.operationId; record = command.record; await route.abort('failed'); },
    '/api/operations': async (route, url) => { expect(url.searchParams.get('operationId')).toBe(lostId); await jsonRoute(route, { operationId: lostId, status: 'succeeded', changes: { weekJournal: [{ ...record, revision: 1 }] }, revisions: { weekJournal: 2 } }); },
  });
  await page.goto('/app/journal?view=main');
  await page.getByRole('button', { name: 'Felt fine', exact: true }).click();
  await page.getByRole('button', { name: 'Save check-in', exact: true }).click();
  await expect(page.getByText('The result is not confirmed. Check its status before trying again.')).toBeVisible();
  await page.getByRole('button', { name: 'Check save status', exact: true }).click();
  await expect(page.getByText('Check-in saved.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update check-in', exact: true })).toBeVisible();
});

test('Settings: a save the server never recorded is sent again under the same id', async ({ page }) => {
  const ids: string[] = [];
  const network = await mockProduction(page, {
    '/api/settings': async route => {
      if (route.request().method() === 'GET') return jsonRoute(route, settingsSnapshot);
      const body = route.request().postDataJSON(); ids.push(body.operationId);
      if (ids.length === 1) return jsonRoute(route, { error: 'Server error' }, 500);
      return jsonRoute(route, { operationId: body.operationId, status: 'succeeded', snapshot: { ...settingsSnapshot, revision: 2, display: { ...settingsSnapshot.display, appearance: 'light' } } });
    },
    '/api/operations': async (route, url) => { expect(url.searchParams.get('domain')).toBe('settings'); return notRecorded(route); },
  });
  await page.goto('/settings');
  await page.locator('[data-setting-panel="display"]').click();
  await page.getByRole('radio', { name: 'Light', exact: true }).check();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check save status', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check save status', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check save status', exact: true })).toHaveCount(0);
  await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode', 'light');
  expect(ids).toEqual([ids[0], ids[0]]);
  expect(network.blocked).toEqual([]);
});

test('Summary: a summary requested offline is refused as offline, not left unconfirmed', async ({ page }) => {
  let prepares = 0;
  await mockProduction(page, {
    '/api/summaries': async route => { if (route.request().method() === 'GET') return jsonRoute(route, { items: [], complete: true, unresolvedOperations: [] }); prepares++; return jsonRoute(route, { error: 'unexpected' }, 500); },
  });
  await page.goto('/app/homeguard/summary?view=main');
  const create = page.getByRole('button', { name: 'Create household PDF', exact: true });
  await expect(create).toBeEnabled();
  await page.context().setOffline(true);
  await create.click();
  await expect(page.getByText('You are offline. Your changes are still here.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check summary status' })).toHaveCount(0);
  await page.context().setOffline(false);
  expect(prepares).toBe(0);
});

test('Readings: a failed refresh is still named while the profile needs reconnecting', async ({ page }) => {
  let failing = false;
  await mockProduction(page, {
    '/api/profile': route => failing ? jsonRoute(route, { error: 'Server error' }, 500) : jsonRoute(route, { ...stageProfile, home_context: { id: homeId, revision: 1 }, profile: { ...stageProfile.profile, home_context_id: homeId } }),
    '/api/daily-score': route => failing ? jsonRoute(route, { error: 'Server error' }, 500) : jsonRoute(route, { air: null, uv: null, pollen: null, mold: null, score: null, retrieved_at: '2026-10-01T14:00:00Z' }),
  });
  await page.goto('/today');
  await expect(page.getByTestId('production-product')).toBeVisible();
  failing = true;
  await page.reload();
  const status = page.locator('.halo-f-offline');
  await expect(status).toContainText('Reconnect your profile to make changes.');
  await expect(status).toContainText('Some readings are unavailable. Previous readings keep their original dates.');
});
