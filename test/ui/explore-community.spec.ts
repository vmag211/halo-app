import { test, expect, type Page } from '@playwright/test';

const root = '/foundation/preview/expanded/?tab=act&motion=reduce&time=day';
const forbidden = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const calls: string[] = []; forbidden.set(page, calls);
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname.startsWith('/api/')) { calls.push(url.origin + url.pathname); return route.abort(); }
    return route.continue();
  });
});
test.afterEach(async ({ page }) => { expect(forbidden.get(page)).toEqual([]); });

async function openSendPreview(page: Page) {
  await page.goto(`${root}&destination=outreach`);
  await page.getByText('Recipient details', { exact: true }).click();
  await page.getByLabel('Recipient email', { exact: true }).fill('person@example.invalid');
  await page.getByLabel('I checked the recipient and their service area').check();
  await page.getByLabel('Draft for Utility').fill('Please help me find the right dated water records.');
  await page.getByRole('button', { name: 'Review what you will share' }).click();
  await page.getByText('Send from HALO with Gmail (proposed)', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preview send', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Preview Gmail connection' }).click();
  await page.getByRole('button', { name: 'Use preview account' }).click();
}

test('hub is evergreen and every photo uses regular rectangular frames', async ({ page }) => {
  await page.goto(root);
  await expect(page.locator('.halo-explore')).not.toContainText('A morning by the creek');
  await expect(page.locator('.halo-explore')).not.toContainText('Oct 17');
  for (const photo of await page.locator('.halo-explore .ex-photo').all()) {
    const style = await photo.evaluate(node => { const css = getComputedStyle(node); return { clip: css.clipPath, tl: css.borderTopLeftRadius, tr: css.borderTopRightRadius, bl: css.borderBottomLeftRadius, br: css.borderBottomRightRadius }; });
    expect(style.clip).toBe('none');
    expect(style.tl).toBe(style.tr); expect(style.bl).toBe(style.br);
  }
  await expect(page.locator('.ex-volunteer-path')).toBeVisible();
  await expect(page.locator('.ex-community-bridge')).toBeVisible();
});

test('area label remains local and can be cleared', async ({ page }) => {
  await page.goto(root);
  await page.getByRole('button', { name: /Choose an area/ }).click();
  await page.getByLabel('City or county', { exact: true }).fill('Private planning place');
  await page.getByLabel('State', { exact: true }).fill('North Carolina');
  await page.getByRole('button', { name: 'Use this area' }).click();
  expect(page.url()).not.toContain('Private');
  await page.locator('.ex-volunteer-path').click();
  await expect(page.locator('.ex-area-toggle')).toContainText('Private planning place');
  await page.locator('.ex-area-toggle').click();
  await page.getByRole('button', { name: 'Clear area' }).click();
  await expect(page.locator('.ex-area-toggle')).toContainText('Choose an area');
});

test('volunteer guide is filtered by interest, uses official handoff and saves an undated research task once', async ({ page }) => {
  await page.goto(`${root}&destination=opportunities`);
  await page.getByLabel('What interests you?').selectOption('Trees & habitat');
  await expect(page.locator('.ex-local-route')).toHaveCount(1);
  await page.getByRole('button', { name: 'See how to help: Plant and care for trees together' }).click();
  const link = page.getByRole('link', { name: 'Open official participation guide' });
  await expect(link).toHaveAttribute('href', /treescharlotte\.org/);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(page.locator('.ex-local-detail')).toContainText('Mailing address only');
  await page.locator('.ex-local-detail').getByRole('button', { name: 'Save to My Week' }).click();
  await expect(page.getByLabel('All-day date (optional)')).toHaveValue('');
  await page.getByRole('button', { name: 'Save sample action' }).click();
  await expect(page.locator('.ex-local-detail').getByRole('button', { name: 'Open saved action' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'My Week' }).click();
  await expect(page.locator('.halo-expanded-agenda-row')).toContainText('Review participation with TreesCharlotte');
});

test('community topics open the matching map layer and can start an undated question note', async ({ page }) => {
  await page.goto(`${root}&destination=community`);
  await page.getByRole('button', { name: 'Air', exact: true }).click();
  await expect(page.locator('.ex-community-lesson')).toContainText('personal exposure');
  await expect(page.getByRole('link', { name: 'Explore this map layer' })).toHaveAttribute('href', /layer=air/);
  await page.getByRole('button', { name: 'Keep this question in My notes' }).click();
  await expect(page.getByRole('combobox', { name: 'Note type', exact: true })).toHaveValue('Question');
  await expect(page.getByLabel('Your note (required)')).toHaveValue(/Which air monitor/);
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByRole('heading', { name: 'A question about my community', exact: true })).toBeVisible();
});

test('notes support types, pinning, search and no required observation time for ideas', async ({ page }) => {
  await page.goto(`${root}&destination=observations&exploreView=new`);
  await page.getByRole('combobox', { name: 'Note type', exact: true }).selectOption('Idea');
  await page.getByLabel('Title (required)').fill('An idea for a shared garden');
  await page.getByLabel('Your note (required)').fill('Ask who can advise on an accessible container garden.');
  await page.getByLabel('Pin this note').check();
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByRole('button', { name: 'Unpin note' })).toBeVisible();
  await page.getByRole('button', { name: 'All notes', exact: true }).click();
  await page.getByLabel('Only pinned notes').check();
  await page.getByRole('combobox', { name: 'Note type', exact: true }).selectOption('Idea');
  await expect(page.locator('.ex-note-row')).toHaveCount(1);
  await page.getByLabel('Search my notes').fill('does not exist');
  await expect(page.getByRole('heading', { name: 'No notes match these filters' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset note filters' }).click();
  await expect(page.locator('.ex-note-row')).toHaveCount(2);
});

test('Luna request requires deliberate consent and excludes place and time by default', async ({ page }) => {
  await page.goto(`${root}&destination=observations&exploreView=detail&exploreRecord=demo-field-note`);
  await page.getByText('Prepare with Luna', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preview Luna request' })).toBeDisabled();
  await expect(page.getByLabel('Place label', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Date and timezone', { exact: true })).not.toBeChecked();
  await page.getByLabel('I choose only these fields for this request').check();
  await page.getByRole('button', { name: 'Preview Luna request' }).click();
  await expect(page.locator('.ex-luna-request pre')).toContainText('water looked cloudier');
  await expect(page.locator('.ex-luna-request pre')).not.toContainText('Example creek path');
  await expect(page.locator('.ex-luna-request pre')).not.toContainText('2026-10-01');
  await page.getByLabel('Place label', { exact: true }).check();
  await expect(page.getByRole('button', { name: 'Preview Luna request' })).toBeDisabled();
  await expect(page.locator('.ex-luna-request')).toHaveCount(0);
});

test('contact matching is clearly simulated and has verified-source alternatives', async ({ page }) => {
  await page.goto(`${root}&destination=outreach`);
  await page.getByText('Preview automatic contact matching', { exact: true }).click();
  await page.getByRole('button', { name: 'Show an example contact' }).click();
  await expect(page.locator('.ex-contact-match')).toContainText('not matched');
  await expect(page.locator('.ex-contact-match')).toContainText('No official source');
  await page.getByRole('button', { name: 'Use example in this preview' }).click();
  await expect(page.getByLabel('Recipient email', { exact: true })).toHaveValue('contact@example.invalid');
  await expect(page.getByLabel('I checked the recipient and their service area')).not.toBeChecked();
  await page.getByRole('button', { name: 'Representative', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Find your elected officials' })).toHaveAttribute('href', 'https://www.usa.gov/elected-officials');
});

test('selected notes add only chosen text to outreach, and a revised note requires review', async ({ page }) => {
  await page.goto(`${root}&destination=outreach`);
  await page.getByRole('button', { name: 'Review what you will share' }).click();
  await expect(page.locator('.ex-share-preview pre')).not.toContainText('water looked cloudier');
  await page.getByText('Add context you choose', { exact: true }).click();
  await page.getByLabel('A change near the walking path', { exact: true }).check();
  await page.getByRole('button', { name: 'Review what you will share' }).click();
  await expect(page.locator('.ex-share-preview pre')).toContainText('water looked cloudier');
  await expect(page.locator('.ex-share-preview pre')).not.toContainText('Example creek path');
  await expect(page.locator('.ex-share-preview pre')).not.toContainText('2026-10-01');
  await page.getByRole('button', { name: 'Open my notes', exact: true }).first().click();
  await page.getByRole('button', { name: /A change near the walking path/ }).first().click();
  await page.getByRole('button', { name: 'Edit note' }).click();
  await page.getByLabel('Factual description (required)').fill('The observation was corrected.');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByRole('button', { name: 'Edit note', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ask a question', exact: true }).click();
  await page.getByText('Add context you choose', { exact: true }).click();
  await expect(page.getByText('A selected note changed or was deleted. Remove the old selection and choose again before sending.')).toBeVisible();
});

test('Gmail preview requires confirmation and prevents a duplicate submitted attempt', async ({ page }) => {
  await openSendPreview(page);
  await page.getByRole('button', { name: 'Preview send', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review this send (preview)' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByText(/Sample status: submitted/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview send', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm preview send' }).click();
  await expect(page.getByText(/Sample status: submitted to Gmail/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview send', exact: true })).toBeDisabled();
  await expect(page.getByText(/exact message already has a submitted sample attempt/)).toBeVisible();
});

test('unknown send outcome blocks automatic retries even after internal navigation', async ({ page }) => {
  await openSendPreview(page);
  await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  await page.getByLabel('Email preview outcome').selectOption('unknown');
  await page.getByRole('button', { name: 'Preview send', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm preview send' }).click();
  await expect(page.getByText(/Sample status: outcome unknown/)).toBeVisible();
  await page.getByRole('button', { name: 'Open my notes', exact: true }).first().click();
  await page.getByRole('button', { name: 'Ask a question', exact: true }).click();
  await page.getByRole('button', { name: 'Review what you will share' }).click();
  await page.getByText('Send from HALO with Gmail (proposed)', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preview send', exact: true })).toBeDisabled();
  await expect(page.getByText(/Sample status: outcome unknown/)).toBeVisible();
});

test('offline does not lose drafts or connect sending', async ({ page }) => {
  await page.goto(`${root}&destination=outreach`);
  await page.getByLabel('Draft for Utility').fill('Keep this private question.');
  await page.getByText('Expanded app review', { exact: false }).first().click();
  await page.getByLabel('Explore workspace state').selectOption('offline');
  await expect(page.getByLabel('Draft for Utility')).toHaveValue('Keep this private question.');
  await expect(page.locator('.halo-explore')).toContainText('saves are unavailable');
});

test('changing outreach context requires checking the recipient again', async ({ page }) => {
  await openSendPreview(page);
  await expect(page.getByRole('button', { name: 'Preview send', exact: true })).toBeEnabled();
  await page.getByLabel('What is your question about?').selectOption('Parks & public spaces');
  await expect(page.getByLabel('I checked the recipient and their service area')).not.toBeChecked();
  await page.getByRole('button', { name: 'Review what you will share' }).click();
  await page.getByText('Send from HALO with Gmail (proposed)', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preview send', exact: true })).toBeDisabled();
  await page.getByLabel('I checked the recipient and their service area').check();
  await page.getByRole('button', { name: 'Review what you will share' }).click();
  await page.getByText('Send from HALO with Gmail (proposed)', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preview send', exact: true })).toBeEnabled();
});

test('community question offers deliberate append without replacing an unfinished note', async ({ page }) => {
  await page.goto(`${root}&destination=observations&exploreView=new`);
  await page.getByRole('combobox', { name: 'Note type', exact: true }).selectOption('Idea');
  await page.getByLabel('Title (required)').fill('Keep my existing idea');
  await page.getByLabel('Your note (required)').fill('My original writing.');
  await page.getByRole('button', { name: 'Back and keep draft' }).click();
  await page.getByRole('navigation', { name: 'Explore sections' }).getByRole('button', { name: 'Discover', exact: true }).click();
  await page.locator('.ex-community-bridge').click();
  await page.getByRole('button', { name: 'Keep this question in My notes' }).click();
  await expect(page.getByLabel('Title (required)')).toHaveValue('Keep my existing idea');
  await expect(page.getByLabel('Your note (required)')).toHaveValue('My original writing.');
  await page.getByRole('button', { name: 'Add this question to my draft' }).click();
  await expect(page.getByLabel('Your note (required)')).toHaveValue(/My original writing\.[\s\S]*Where does my drinking water/);
});

test('unknown attempt can be reconciled without automatically sending again', async ({ page }) => {
  await openSendPreview(page);
  await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  await page.getByLabel('Email preview outcome').selectOption('unknown');
  await page.getByRole('button', { name: 'Preview send', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm preview send' }).click();
  await page.getByLabel('Email attempt check outcome').selectOption('not-submitted');
  await page.getByRole('button', { name: 'Check sample attempt status' }).click();
  await expect(page.getByText(/Sample check: no submission recorded/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview send', exact: true })).toBeEnabled();
  await expect(page.getByText(/Sample status: submitted to Gmail/)).toHaveCount(0);
});

test('returning from a program guide preserves filters, then another interest shows appropriate routes', async ({ page }) => {
  await page.goto(`${root}&destination=opportunities`);
  await page.getByLabel('What interests you?').selectOption('Trees & habitat');
  await page.getByRole('button', { name: 'See how to help: Plant and care for trees together' }).click();
  await expect(page.locator('.ex-local-detail')).toBeVisible();
  await page.getByRole('button', { name: 'All programs and organizations' }).click();
  await expect(page.getByLabel('What interests you?')).toHaveValue('Trees & habitat');
  await page.getByLabel('What interests you?').selectOption('Gardening');
  await expect(page.locator('.ex-local-detail')).toHaveCount(0);
  await expect(page.locator('.ex-local-list')).toContainText('Help a community garden grow');
});

test('a note save completing after navigation does not pull the user back', async ({ page }) => {
  await page.goto(`${root}&destination=observations&exploreView=new`);
  await page.getByRole('combobox', { name: 'Note type', exact: true }).selectOption('Question');
  await page.getByLabel('Title (required)').fill('A background save');
  await page.getByLabel('Your note (required)').fill('What can I ask my community group?');
  await page.getByRole('button', { name: 'Save note' }).click();
  await page.getByRole('navigation', { name: 'Explore sections' }).getByRole('button', { name: 'Get involved', exact: true }).click();
  await expect(page.locator('.ex-local-route')).toHaveCount(5);
  await expect(page.getByRole('heading', { name: 'Get involved', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save note', exact: true })).toHaveCount(0);
});

for (const appearance of ['light', 'dark']) test(`deep Explore flows remain usable at 320px enlarged in ${appearance}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 850 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const destination of ['community', 'opportunities', 'outreach', 'observations']) {
    await page.goto(`${root}&appearance=${appearance}&scale=150&destination=${destination}`);
    if (destination === 'community') await page.getByRole('button', { name: 'Facilities', exact: true }).click();
    if (destination === 'opportunities') {
      await page.getByRole('button', { name: /^See how to help:/ }).first().click();
      await page.getByText('My preparation and questions', { exact: true }).click();
    }
    if (destination === 'outreach') {
      await page.getByText('Preview automatic contact matching', { exact: true }).click();
      await page.getByRole('button', { name: 'Show an example contact' }).click();
      await page.getByRole('button', { name: 'Use example in this preview' }).click();
      await page.getByLabel('I checked the recipient and their service area').check();
      await page.getByText('Add context you choose', { exact: true }).click();
      await page.getByLabel('A change near the walking path', { exact: true }).check();
      await page.getByRole('button', { name: 'Review what you will share' }).click();
      await page.getByText('Send from HALO with Gmail (proposed)', { exact: true }).click();
      await page.getByRole('button', { name: 'Preview Gmail connection' }).click();
      await page.getByRole('button', { name: 'Use preview account' }).click();
      await page.getByRole('button', { name: 'Preview send', exact: true }).click();
    }
    if (destination === 'observations') {
      await page.getByRole('button', { name: /A change near the walking path/ }).first().click();
      await page.getByText('Prepare with Luna', { exact: true }).click();
      await page.getByLabel('I choose only these fields for this request').check();
      await page.getByRole('button', { name: 'Preview Luna request' }).click();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), destination).toBe(true);
    await page.screenshot({ path: info.outputPath(`${destination}-${appearance}-320-enlarged.png`), fullPage: destination !== 'outreach' });
    if (destination === 'outreach') await page.getByRole('button', { name: 'Keep editing' }).click();
  }
  await page.setViewportSize({ width: 375, height: 850 });
  await page.goto(`${root}&appearance=${appearance}&scale=100`);
  await page.screenshot({ path: info.outputPath(`explore-community-${appearance}-375.png`), fullPage: true });
  expect(errors).toEqual([]);
});
