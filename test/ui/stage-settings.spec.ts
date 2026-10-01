import { test, expect } from '@playwright/test';
import { jsonRoute, mockStage, stageProfile, stageUserId } from './stage-fixtures';

test('Settings section links honor valid intent without hydration errors or writes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /hydrat|server rendered/i.test(message.text())) errors.push(message.text()); });
  const network = await mockStage(page);
  for (const intent of ['home', 'household', 'unrecognized']) {
    await page.goto(`/settings?open=${intent}`);
    const home = page.getByRole('button', { name: /^Home details/ });
    const household = page.getByRole('button', { name: /^Household/ });
    await expect(home).toHaveAttribute('aria-expanded', String(intent === 'home'));
    await expect(household).toHaveAttribute('aria-expanded', String(intent !== 'home'));
    if (intent === 'home') await expect(page.getByRole('combobox', { name: 'Water source', exact: true })).toBeVisible();
    else await expect(page.getByRole('button', { name: 'Toddlers', exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
  expect(network.requests.filter(request => ['PUT', 'PATCH', 'POST', 'DELETE'].includes(request.method))).toEqual([]);
  expect(network.blocked).toEqual([]);
});

test('household save sends seven flags, preserves newly fetched untouched answers, and prevents overlap', async ({ page }) => {
  const profile = structuredClone(stageProfile);
  let profileReads = 0; let writes = 0; let release!: () => void;
  const bodies: unknown[] = [];
  const network = await mockStage(page, { overrides: {
    '/api/profile': async route => {
      profileReads++;
      if (profileReads >= 2) profile.household.has_senior = true;
      await jsonRoute(route, profile);
    },
    '/api/household': async route => {
      writes++; const body = route.request().postDataJSON(); bodies.push(body);
      await new Promise<void>(resolve => { release = resolve; });
      profile.household = body;
      await jsonRoute(route, { saved: true });
    },
  } });
  await page.goto('/settings');
  const toddler = page.getByRole('button', { name: 'Toddlers', exact: true });
  await expect(toddler).toHaveAttribute('aria-pressed', 'false');
  await toddler.click();
  await page.getByRole('button', { name: 'Save household', exact: true }).click();
  await expect.poll(() => writes).toBe(1);
  await expect(toddler).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save household', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Save household', exact: true }).dispatchEvent('click');
  expect(writes).toBe(1);
  expect(bodies).toEqual([{ has_toddler: true, has_child: true, has_teen: false, has_adult: true, has_senior: true, has_pregnant: false, has_respiratory: false }]);
  release();
  await expect(page.getByText('Household saved.', { exact: true }).last()).toBeVisible();
  await expect(toddler).toBeEnabled();
  await expect(toddler).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Seniors', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(profileReads).toBeGreaterThanOrEqual(2);
  expect(network.blocked).toEqual([]);
});

test('home validation and failed saves retain answers; retry saves canonical fields', async ({ page }) => {
  const profile = structuredClone(stageProfile) as { profile: { home_year: number | null; water_source: string }; [key: string]: unknown };
  let patches = 0; const bodies: unknown[] = [];
  const network = await mockStage(page, { overrides: { '/api/profile': async route => {
    if (route.request().method() !== 'PATCH') { await jsonRoute(route, profile); return; }
    patches++; const body = route.request().postDataJSON(); bodies.push(body);
    if (patches === 1) { await jsonRoute(route, { error: 'private save details' }, 503); return; }
    profile.profile = { ...profile.profile, ...body }; await jsonRoute(route, profile);
  } } });
  await page.goto('/settings');
  await page.getByRole('button', { name: /^Home details/ }).click();
  const year = page.getByLabel(/Year your home was built/);
  await year.fill('1699');
  await page.getByRole('button', { name: 'Save home details', exact: true }).click();
  await expect(year).toHaveAttribute('aria-invalid', 'true');
  expect(patches).toBe(0);
  await year.fill('');
  await page.getByRole('combobox', { name: 'Water source', exact: true }).selectOption('well');
  await page.getByRole('button', { name: 'Save home details', exact: true }).click();
  await expect(page.getByTestId('stage-product').getByRole('alert')).toContainText('Your changes have not been confirmed.');
  await expect(page.getByTestId('stage-product').getByRole('alert')).not.toContainText('private save details');
  await expect(page.getByText('Home details saved.', { exact: true })).toHaveCount(0);
  await expect(year).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Water source', exact: true })).toHaveValue('well');
  await page.getByRole('button', { name: 'Save home details', exact: true }).click();
  await expect(page.getByText('Home details saved.', { exact: true }).last()).toBeVisible();
  expect(bodies).toEqual([{ water_source: 'well', home_year: null }, { water_source: 'well', home_year: null }]);
  expect(network.blocked).toEqual([]);
});

test('change address confirms leaving unsaved settings and never writes on its own', async ({ page }) => {
  const network = await mockStage(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Toddlers', exact: true }).click();
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('Unsaved changes'); await dialog.dismiss(); });
  await page.getByRole('button', { name: 'Change address', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  page.once('dialog', async dialog => { await dialog.accept(); });
  await page.getByRole('button', { name: 'Change address', exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding\?change=1$/);
  expect(network.requests.filter(request => ['PUT', 'PATCH', 'POST', 'DELETE'].includes(request.method))).toEqual([]);
  expect(network.blocked).toEqual([]);
});

test('unknown profiles disable editing and an identity change cancels a pending save', async ({ page }) => {
  await page.addInitScript(({ id }) => localStorage.setItem('halo.onboarded', JSON.stringify({ version: 1, identity: id, complete: true })), { id: stageUserId });
  let available = false; let holdNext = false; let held = false; let release!: () => void; let writes = 0;
  const network = await mockStage(page, { overrides: {
    '/api/profile': async route => {
      if (!available) { await jsonRoute(route, { error: 'Unavailable' }, 503); return; }
      if (holdNext) { holdNext = false; held = true; await new Promise<void>(resolve => { release = resolve; }); }
      await jsonRoute(route, stageProfile).catch(() => {});
    },
    '/api/household': async route => { writes++; await jsonRoute(route, { saved: true }); },
  } });
  await page.goto('/settings');
  await expect(page.getByRole('button', { name: 'Toddlers', exact: true })).toBeDisabled();
  available = true;
  await page.getByRole('button', { name: 'Reload profile', exact: true }).click();
  await page.getByRole('button', { name: 'Toddlers', exact: true }).click();
  holdNext = true;
  await page.getByRole('button', { name: 'Save household', exact: true }).click();
  await expect.poll(() => held).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('halo:identity-changed')));
  release();
  await expect(page.getByRole('button', { name: 'Toddlers', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(writes).toBe(0);
  expect(network.blocked).toEqual([]);
});
