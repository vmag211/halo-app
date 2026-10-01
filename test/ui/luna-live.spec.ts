import { test, expect, type Page } from '@playwright/test';
import { jsonRoute, mockStage } from './stage-fixtures';

const disclaimer = 'General information, not medical advice.';
const answer = (text = 'A source-backed explanation [1].') => ({ answer: text, message: null, grounded: true, configured: true, reason: null, declined: false, uses_household_data: false, citations: [{ n: 1, label: 'EPA air information', url: 'https://www.epa.gov/air-research', retrieved: '2026-09-30' }], disclaimer });
const suggestion = { suggestions: ['Explain my readings.'], disclaimer };
async function openLuna(page: Page, path = '/today') {
  await page.goto(path);
  await page.getByRole('button', { name: /^(Ask|Open) Luna$/ }).click();
  const panel = page.getByRole('dialog', { name: 'Luna', exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

test('live Luna uses returned suggestions, safe sources, truthful privacy, and question-only requests', async ({ page }) => {
  const network = await mockStage(page, { assistant: async route => {
    if (route.request().method() === 'GET') { await jsonRoute(route, suggestion); return; }
    await jsonRoute(route, { ...answer('Outdoor air is context\u2014not an individual exposure test. <script>unsafe</script> [1] [H] [999] [unknown]'), uses_household_data: true, citations: [
      { n: 1, label: 'EPA\u2014air information', url: 'https://www.epa.gov/air-research', retrieved: '2026-09-30' },
      { n: 2, label: 'Unsafe source', url: 'javascript:alert(1)', retrieved: null },
    ] });
  } });
  const panel = await openLuna(page);
  await expect(panel.getByText('Preview', { exact: true })).toHaveCount(0);
  await expect(panel).toContainText('the service has not confirmed its sharing setting');
  await panel.getByRole('button', { name: 'Explain my readings.', exact: true }).click();
  await expect(panel.getByRole('log')).toContainText('Outdoor air is context, not an individual exposure test.');
  await expect(panel.getByRole('log')).toContainText('<script>unsafe</script>');
  await expect(panel.locator('script')).toHaveCount(0);
  await expect(panel.getByRole('link', { name: '[1] EPA, air information' })).toHaveAttribute('href', 'https://www.epa.gov/air-research');
  await expect(panel.getByRole('link', { name: /Unsafe source/ })).toHaveCount(0);
  await expect(panel.getByRole('link', { name: 'Source 1: EPA, air information', exact: true })).toBeVisible();
  await expect(panel.getByRole('log')).not.toContainText('[H]');
  await expect(panel.getByRole('log')).not.toContainText('[999]');
  await expect(panel.getByRole('log')).not.toContainText('[unknown]');
  await expect(panel).toContainText('This answer refers to your household information.');
  await expect(panel).not.toContainText('\u2014');
  await panel.getByRole('textbox', { name: 'Message Luna' }).fill('Second question.');
  await panel.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(panel.locator('.halo-luna-message--assistant')).toHaveCount(2);
  expect(network.requests.filter(request => request.method === 'POST')).toEqual([
    { path: '/api/assistant', method: 'POST', body: { question: 'Explain my readings.', page: 'today' } },
    { path: '/api/assistant', method: 'POST', body: { question: 'Second question.', page: 'today' } },
  ]);
  expect(await page.evaluate(() => Object.values(localStorage).some(value => value.includes('Second question.')))).toBe(false);
  await panel.getByRole('button', { name: 'Close Luna' }).click();
  await page.getByRole('button', { name: /^(Ask|Open) Luna$/ }).click();
  await expect(page.locator('.halo-luna-message')).toHaveCount(0);
  expect(network.blocked).toEqual([]);
});

test('unavailable responses retry once in place; refusal, no source and limits remain distinct', async ({ page }) => {
  let unavailableAttempts = 0;
  const network = await mockStage(page, { assistant: async route => {
    if (route.request().method() === 'GET') { await jsonRoute(route, { ...suggestion, sends_household_context: false }); return; }
    const { question } = route.request().postDataJSON();
    if (question === 'Retry this question.' && ++unavailableAttempts === 1) { await jsonRoute(route, { ...answer(), answer: null, reason: 'unavailable', message: 'Sources are unavailable.' }); return; }
    if (question === 'Refuse this question.') { await jsonRoute(route, { ...answer(), answer: null, declined: true, message: 'I cannot diagnose or recommend treatment.' }); return; }
    if (question === 'Find an unsupported answer.') { await jsonRoute(route, { ...answer(), answer: null, grounded: false, reason: 'no_source', message: 'No reliable source is available.' }); return; }
    if (question === 'Trigger a limit.') { await jsonRoute(route, { error: 'private database details' }, 429); return; }
    if (question === 'Unconfigured service.') { await jsonRoute(route, { ...answer(), answer: null, grounded: false, configured: false, reason: 'no_source', message: 'No reliable source is available.' }); return; }
    await jsonRoute(route, answer('The sources are available now.'));
  } });
  const panel = await openLuna(page, '/home');
  await expect(panel).toContainText('household context is not included');
  const send = async (question: string) => { await panel.getByRole('textbox', { name: 'Message Luna' }).fill(question); await panel.getByRole('button', { name: 'Send message', exact: true }).click(); };
  await send('Retry this question.');
  await panel.getByRole('button', { name: 'Retry question', exact: true }).click();
  await expect(panel.getByRole('log')).toContainText('The sources are available now.');
  await expect(panel.locator('.halo-luna-message--user')).toHaveCount(1);
  await send('Refuse this question.');
  await expect(panel.getByRole('log')).toContainText('I cannot diagnose or recommend treatment.');
  await expect(panel.locator('[data-state="refused"]')).toContainText('Outside my scope');
  await expect(panel.getByRole('button', { name: 'Retry question', exact: true })).toHaveCount(0);
  await send('Unconfigured service.');
  await expect(panel.locator('[data-state="unconfigured"]')).toContainText('Luna is not available yet.');
  await send('Find an unsupported answer.');
  await expect(panel.getByRole('log')).toContainText('No reliable source is available.');
  await expect(panel.getByRole('button', { name: 'Retry question', exact: true })).toHaveCount(0);
  await send('Trigger a limit.');
  await expect(panel.getByRole('log')).toContainText('reached the question limit');
  await expect(panel).not.toContainText('private database details');
  await expect(panel.getByRole('button', { name: 'Retry question', exact: true })).toHaveCount(0);
  expect(network.requests.filter(request => request.method === 'POST').every(request => (request.body as { page: string }).page === 'homeguard')).toBe(true);
  expect(network.blocked).toEqual([]);
});

test('pending questions cancel, new conversations discard late answers, and close aborts requests', async ({ page }) => {
  const held: { release: () => void; done: Promise<void> }[] = [];
  await mockStage(page, { assistant: async route => {
    if (route.request().method() === 'GET') { await jsonRoute(route, suggestion); return; }
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const done = wait.then(() => jsonRoute(route, answer('Late response that must not appear.'))).catch(() => {});
    held.push({ release, done }); await done;
  } });
  const panel = await openLuna(page);
  const input = panel.getByRole('textbox', { name: 'Message Luna' });
  await input.fill('Keep my cancelled draft.');
  await input.press('Enter');
  await expect.poll(() => held.length).toBe(1);
  await expect(panel.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Cancel request', exact: true }).click();
  await expect(input).toHaveValue('Keep my cancelled draft.');
  held[0].release(); await held[0].done;
  await expect(panel).not.toContainText('Late response that must not appear.');
  await input.press('Enter');
  await expect.poll(() => held.length).toBe(2);
  await panel.getByRole('button', { name: 'Luna options' }).click();
  await panel.getByRole('button', { name: 'Start a new conversation' }).click();
  held[1].release(); await held[1].done;
  await expect(panel.locator('.halo-luna-message')).toHaveCount(0);
  await expect(input).toHaveValue('');
  await input.fill('Discard when closed.'); await input.press('Enter');
  await expect.poll(() => held.length).toBe(3);
  await panel.getByRole('button', { name: 'Close Luna' }).click();
  held[2].release(); await held[2].done;
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: /^(Ask|Open) Luna$/ }).click();
  await expect(page.locator('.halo-luna-message')).toHaveCount(0);
});

test('session changes clear drafts and pending messages, and suggestion failure never blocks typing', async ({ page }) => {
  let release!: () => void;
  let posted = false;
  const network = await mockStage(page, { assistant: async route => {
    if (route.request().method() === 'GET') { await jsonRoute(route, { error: 'private suggestion error' }, 503); return; }
    posted = true;
    await new Promise<void>(resolve => { release = resolve; });
    await jsonRoute(route, answer('Previous household response.')).catch(() => {});
  } });
  const panel = await openLuna(page);
  await expect(panel.getByRole('button', { name: 'Retry suggestions' })).toBeVisible();
  await expect(panel).not.toContainText('private suggestion error');
  await panel.getByRole('textbox', { name: 'Message Luna' }).fill('A private draft.');
  await panel.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => posted).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('halo:identity-changed')));
  release();
  await expect(page.locator('.halo-luna-message')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Previous household response.');
  await expect(page.locator('body')).not.toContainText('A private draft.');
  expect(network.blocked).toEqual([]);
});
