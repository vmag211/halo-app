import { test, expect } from '@playwright/test';
import { jsonRoute, stageProfile } from './stage-fixtures';
import {mockProductionStage as mockStage} from './production-fixtures';

const retrieved = '2026-10-01T14:00:00Z';
const emptyHome = { water: null, radon: null, lead: null, score: null, action_plan: [], assembled_at: retrieved };

test('private water shows the returned testing plan without a measured score or inferred cost total', async ({ page }) => {
  const profile = structuredClone(stageProfile); profile.profile.water_source = 'well';
  const network = await mockStage(page, { overrides: {
    '/api/profile': async route => jsonRoute(route, profile),
    '/api/home-guard': async route => jsonRoute(route, { ...emptyHome,
      water: { status: 'private_well', source_type: 'well', is_measured: false, message: 'Agency testing is unavailable\u2014a lab test provides evidence.', test_plan: {
        reasons: ['This is a private supply.'],
        tests: [
          { id: 'lead_copper', rank: 2, name: 'Lead and copper', priority: 'recommended', cadence: 'Ask a local laboratory', why: 'Plumbing can affect water quality.', where: 'A certified laboratory', estimated_cost: { low: 70, high: 100 }, needs_local_context: true },
          { id: 'bacteria', rank: 1, name: 'Coliform bacteria', priority: 'critical', cadence: 'Every year', why: 'Check for bacterial contamination.', where: 'County health department', estimated_cost: { low: 15, high: 40 } },
        ],
      } },
      radon: { zone: 1, county: 'Cabarrus', severity: 'high' },
      breakdown: [{ key: 'water', score: 100, severity: 'good' }, { key: 'radon', score: 36, severity: 'high' }],
      // A malformed combined score must not turn untested private water into 100.
      score: { display_score: 100, severity: 'good', included_inputs: ['water', 'radon'], missing_inputs: [] },
    }),
  } });
  await page.goto('/home');
  await expect(page.locator('.halo-environment-score strong')).toHaveText('N/A');
  await expect(page.getByRole('heading', { name: 'Start with testing', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Open your water testing plan', exact: true }).click();
  await expect(page).toHaveURL(/\/factors\/pfas#reading-detail$/);
  const plan = page.locator('#testing-plan');
  await expect(plan.getByRole('heading', { name: 'Your testing plan' })).toBeVisible();
  await expect(plan.locator('summary')).toHaveText(['1. Coliform bacteria', '2. Lead and copper']);
  await plan.locator('summary').first().click();
  await expect(plan).toContainText('Estimated cost: $15 to $40');
  await plan.locator('summary').last().click();
  await expect(plan).toContainText('Local conditions matter for this test.');
  await expect(plan).not.toContainText('estimated total');
  await expect(page.locator('.halo-ph-detail-score strong')).toHaveText('No data');
  await expect(page.getByTestId('production-product')).not.toContainText('\u2014');
  expect(network.blocked).toEqual([]);
});

test('water lookup failure retries and unmatched utility routes to home settings', async ({ page }) => {
  let reads = 0;
  const network = await mockStage(page, { overrides: {
    '/api/home-guard': async route => { reads++; await jsonRoute(route, { ...emptyHome, water: { status: reads === 1 ? 'lookup_failed' : 'no_pwsid_available', is_measured: false } }); },
  } });
  await page.goto('/factors/pfas');
  await expect(page.getByText('This is a problem on our end, not a finding about your water.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry water lookup', exact: true }).click();
  const settings = page.getByRole('link', { name: 'Confirm your water source', exact: true });
  await expect(settings).toHaveAttribute('href', '/settings?open=home');
  await expect(page.locator('.halo-ph-detail-score strong')).toHaveText('No data');
  await settings.click();
  await expect(page).toHaveURL(/\/settings\?open=home$/);
  await expect(page.getByRole('combobox', { name: 'Water source', exact: true })).toBeVisible();
  expect(reads).toBeGreaterThanOrEqual(2);
  expect(network.requests.filter(request => request.method !== 'GET')).toEqual([]);
  expect(network.blocked).toEqual([]);
});

test('utility-wide lead and ordered action items keep their limits; absent evidence stays explicit', async ({ page }) => {
  let home: Record<string, unknown> = { ...emptyHome,
    lead: { level: 'moderate', is_estimate: true, sentence: 'Building-era guidance.', text: 'An estimate is not a tap test.', utility_inventory: { utility: 'Cabarrus Utility', needs_replacement: 12, unknown: 34, address_level: false, source: { name: 'State inventory', url: 'https://www.deq.nc.gov/', retrieved: '2026-08-01' } } },
    action_plan: [
      { key: 'plumbing', rank: 2, title: 'Request plumbing details', severity: 'moderate', reason: 'The building era is a clue\u2014confirm with records.', cost: '$15 to $40', certification: 'NSF/ANSI 53', action: 'Ask your utility about records.' },
      { key: 'radon', rank: 1, title: 'Arrange a radon test', severity: 'high', reason: 'A county zone is not a home measurement.', action: 'Use an appropriate home test.' },
    ],
  };
  const network = await mockStage(page, { overrides: { '/api/home-guard': async route => jsonRoute(route, home) } });
  await page.goto('/factors/lead');
  const evidence = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Keep the evidence in context', exact: true }) });
  await expect(evidence).toContainText('12 service lines needing replacement, and 34 with unknown material.');
  await expect(evidence).toContainText('This is utility-wide context, not a finding about your address.');
  await expect(page.locator('.halo-ph-detail-score strong')).toHaveText('Not scored');
  await expect(evidence.getByRole('link', { name: /State inventory/ })).toHaveAttribute('href', 'https://www.deq.nc.gov/');
  await page.goto('/home');
  const actions = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Your action plan', exact: true }) });
  await expect(actions.locator('summary')).toHaveText(['1. Arrange a radon test', '2. Request plumbing details']);
  await actions.locator('summary').last().click();
  await expect(actions).toContainText('Estimated cost: $15 to $40');
  await expect(actions).toContainText('Certification to verify: NSF/ANSI 53');
  await expect(actions).not.toContainText('\u2014');
  home = emptyHome;
  await page.getByRole('button', { name: 'Refresh readings', exact: true }).click();
  await expect(actions).toContainText('There is not enough evidence for a scored action plan. Missing data is not an all-clear.');
  await expect(actions.locator('summary')).toHaveCount(0);
  await expect(page.locator('.halo-environment-score strong')).toHaveText('N/A');
  expect(network.blocked).toEqual([]);
});

const alertId = '00000000-0000-4000-8000-000000000101';
const alert = { id: alertId, revision:1,kind: 'new_water_results',category:'Home', title: 'Updated water records', body: 'Review the latest utility results.',date:'2026-10-01', read: false, dismissed: false,target:{tab:'home',destination:'tests'} };

test('alerts retry failed reads and failed mutations, keep pending rows, and dismiss only confirmed changes', async ({ page }) => {
  let failReads = true; let failedMutation = false; let mutations = 0; let release!: () => void;let operationId='';
  const current = { ...alert };
  const network = await mockStage(page, { overrides: { '/api/alerts': async route => {
    await jsonRoute(route, failReads ? { error: 'private diagnostic' } : { count:1,unread:current.read?0:1,alerts:[],items:[current],unresolvedOperations:[]}, failReads ? 503 : 200);
  },'/api/alerts/state':async route=>{
    mutations++;
    const change = route.request().postDataJSON();operationId=change.operationId;
    expect(change.selection).toEqual([{id:alertId,revision:current.revision}]);
    if (!failedMutation) { await new Promise<void>(resolve => { release = resolve; }); failedMutation = true; await jsonRoute(route, { error: 'private mutation diagnostic' }, 503); return; }
    if (change.patch.dismissed) { await new Promise<void>(resolve => { release = resolve; }); current.dismissed = true; }
    else current.read = true;
    current.revision++;
    await jsonRoute(route, { operationId,status:'succeeded',items:[current],unresolvedOperations:[] });
  },'/api/operations':async(route,url)=>{expect(url.searchParams.get('operationId')).toBe(operationId);await jsonRoute(route,{operationId,status:'failed'});} } });
  await page.goto('/today');
  await page.getByRole('button', { name: /^Alerts/ }).click();
  const panel = page.getByRole('dialog', { name: 'Alerts', exact: true });
  await expect(panel.getByRole('button', { name: 'Retry or check status', exact: true })).toBeVisible();
  await expect(panel).not.toContainText('private diagnostic');
  failReads = false;
  await panel.getByRole('button', { name: 'Retry or check status', exact: true }).click();
  const row = panel.getByRole('article').filter({ hasText: 'Updated water records' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: `Mark as read: ${alert.title}`, exact: true }).click();
  await expect.poll(() => mutations).toBe(1);
  await expect(row.getByRole('button', { name: `Dismiss alert: ${alert.title}`, exact: true })).toBeDisabled();
  await expect(panel).not.toContainText('Alerts updated.');
  release();
  await expect(panel.getByRole('button', { name: 'Retry or check status', exact:true})).toBeEnabled();
  await expect(panel).not.toContainText(/Alerts updated\.|private mutation diagnostic/);
  await panel.getByRole('button',{name:'Retry or check status',exact:true}).click();
  await expect(panel).toContainText('The update was not applied.');
  await row.getByRole('button', { name: `Mark as read: ${alert.title}`, exact: true }).click();
  await expect(row.getByRole('button', { name: `Mark as read: ${alert.title}`, exact: true })).toHaveCount(0);
  await expect(row).toHaveAttribute('data-unread','false');
  await row.getByRole('button', { name: `Dismiss alert: ${alert.title}`, exact: true }).click();
  await expect.poll(() => mutations).toBe(3);
  await expect(row).toBeVisible();
  await expect(row.getByRole('button', { name: `Dismiss alert: ${alert.title}`, exact: true })).toBeDisabled();
  await expect(panel).not.toContainText('Alerts updated.');
  release();
  await expect(row).toHaveCount(0);
  await expect(panel).toContainText('Alert dismissed.');expect(mutations).toBe(3);
  expect(network.blocked).toEqual([]);
});

test('mark all reports zero changes honestly and browser Back closes the alert panel', async ({ page }) => {
  let writes = 0;
  const network = await mockStage(page, { overrides: { '/api/alerts': route=>jsonRoute(route,{count:1,unread:1,alerts:[],items:[alert],unresolvedOperations:[]}),'/api/alerts/state':async route=>{writes++;const body=route.request().postDataJSON();expect(body.selection).toEqual([{id:alertId,revision:1}]);await jsonRoute(route,{operationId:body.operationId,status:'succeeded',items:[alert],unresolvedOperations:[]});} } });
  await page.goto('/today');
  const opener = page.getByRole('button', { name: 'Alerts, 1 unread', exact: true });
  await opener.click();
  const panel = page.getByRole('dialog', { name: 'Alerts', exact: true });
  await expect(page).toHaveURL(/\/today\?sheet=alerts$/);
  await panel.getByRole('button', { name: 'Mark all as read', exact: true }).click();
  await expect(panel).not.toContainText('Alerts updated.');
  await expect(panel.getByRole('button', { name: `Mark as read: ${alert.title}`, exact: true })).toBeVisible();
  expect(writes).toBe(1);
  await page.goBack();
  await expect(panel).toHaveCount(0);
  await expect(page).toHaveURL(/\/today$/);
  await expect(opener).toBeFocused();
  expect(network.blocked).toEqual([]);
});
