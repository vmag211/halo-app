import { expect, test, type Route } from '@playwright/test';
import { mockProduction } from './production-fixtures';
import { jsonRoute } from './stage-fixtures';

/** Production runs with projects, outreach, participation and workspace switched off. Each read answers
 * 503 feature_unavailable (lib/features.js). That is a settled answer: Explore says "not available yet",
 * offers no retry and sends no request the server would refuse. */
const off = (message: string) => (route: Route) => jsonRoute(route, { error: message, code: 'feature_unavailable', message, field_errors: [], retryable: false }, 503);
const listings = off('Local listings are not available yet. Use the organizers’ official sites.');
const projects = off('Project ideas are not available yet. Your current ideas are kept.');
const outreach = off('Preparing outreach messages is not available yet. Nothing was saved or sent.');
const flagsOff = {
  '/api/opportunities': listings, '/api/explore/organizations': listings,
  '/api/projects/generations/current': projects, '/api/projects/generations': projects, '/api/projects/guides/detail': projects,
  '/api/outreach/context': outreach, '/api/outreach/connection': outreach, '/api/outreach/messages': outreach, '/api/outreach/contacts': outreach,
  '/api/frontend/workspace': off('Saving Homeguard records is not available yet. Nothing was saved.'),
};
const generic = 'This service is unavailable. Try again later.';

test('Get involved says local listings are not available yet and keeps the official routes', async ({ page }) => {
  const network = await mockProduction(page, flagsOff);
  await page.goto('/app/explore/activities');
  await expect(page.getByText('Local listings are not available yet. Use the organizers’ official sites below.')).toBeVisible();
  await expect(page.getByText(generic)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh listings' })).toBeDisabled();
  await page.getByText('Organizations and other ways to help').click();
  await expect(page.getByText('Organization profiles are not available yet. Use the official resources below.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Open official opportunities/ }).first()).toBeVisible();
  expect(network.blocked).toEqual([]);
});

test('Projects says ideas are not available yet and never sends a generation', async ({ page }) => {
  const network = await mockProduction(page, flagsOff);
  await page.goto('/app/explore/projects');
  await expect(page.getByText('Project ideas are not available yet. The rest of Explore still works.')).toBeVisible();
  await expect(page.getByText(generic)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Retry generation|Check existing generation/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Generate project ideas' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Preferences' })).toBeDisabled();
  await page.getByLabel('What interests you right now?').fill('native plants');
  await page.getByLabel('What interests you right now?').press('Enter');
  await expect(page.getByText(/result is not confirmed|needs checking/)).toHaveCount(0);
  expect(network.requests.filter(request => request.method === 'POST')).toEqual([]);
  expect(network.blocked).toEqual([]);
});

test('My notes says the notebook is not available yet instead of offering a retry', async ({ page }) => {
  const network = await mockProduction(page, flagsOff);
  await page.goto('/app/explore/notes');
  await expect(page.getByRole('heading', { name: 'My notes are not available yet' })).toBeVisible();
  await expect(page.getByText('Your notes could not load')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add a note' })).toBeDisabled();
  expect(network.blocked).toEqual([]);
});

test('Ask a question keeps copy-only drafting and says sending and lookup are not available yet', async ({ page }) => {
  const network = await mockProduction(page, flagsOff);
  await page.goto('/app/explore/contact');
  await expect(page.getByLabel(/Draft for/)).toBeVisible();
  await expect(page.getByText('Send history could not be checked.')).toHaveCount(0);
  await page.getByText('Find a contact for my area').click();
  await expect(page.getByRole('button', { name: 'Find a contact' })).toBeDisabled();
  await expect(page.getByText('Contact lookup is not available yet.', { exact: false })).toBeVisible();
  await page.getByText('Include public source context').click();
  await expect(page.getByText('Public source context is not available yet. You can write your question without it.')).toBeVisible();
  await expect(page.getByText('Source context could not load.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Review what you will share' }).click();
  await page.getByText('Send with Gmail').click();
  await expect(page.getByText('Sending from HALO is not available yet. Nothing was sent.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry connection check' })).toHaveCount(0);
  expect(network.requests.filter(request => request.method === 'POST')).toEqual([]);
  expect(network.blocked).toEqual([]);
});

test('My volunteering and a kept question say saving is not available yet, and send nothing', async ({ page }) => {
  const network = await mockProduction(page, flagsOff);
  await page.goto('/app/explore/activities');
  await page.locator('summary').filter({ hasText: 'My volunteering' }).click();
  await expect(page.getByText('Saving volunteering commitments is not available yet.', { exact: false })).toBeVisible();
  await expect(page.getByText('Your commitments will appear here', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add my own opportunity' })).toBeDisabled();
  await page.goto('/app/explore/community');
  await page.getByRole('button', { name: /Keep this question in My notes/ }).click();
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByText('Saving these records is not available yet. Nothing was saved, and your draft is kept.')).toBeVisible();
  await expect(page.getByText('Load the current records before saving.', { exact: false })).toHaveCount(0);
  expect(network.requests.filter(request => request.method === 'POST')).toEqual([]);
  expect(network.blocked).toEqual([]);
});
