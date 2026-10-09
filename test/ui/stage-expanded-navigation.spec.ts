import { test, expect } from '@playwright/test';
import { mockStage } from './stage-fixtures';

test('live navigation has four tabs without exposing review actions or missing routes', async ({ page }) => {
  const { requests, blocked } = await mockStage(page);
  await page.goto('/today');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.locator('span')).toHaveText(['Today', 'Homeguard', 'Explore', 'My Week']);
  await expect(page.getByRole('button', { name: 'Save this step', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: 'My Week, coming in a later stage' })).toBeDisabled();
  await expect(nav.getByRole('button', { name: 'Explore, coming in a later stage' })).toBeDisabled();
  await expect(nav.getByRole('link', { name: 'My Week', exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/today$/);
  await nav.getByRole('link', { name: 'Homeguard' }).click();
  await expect(nav.getByRole('link', { name: 'Homeguard' })).toHaveAttribute('aria-current', 'page');
  expect(blocked).toEqual([]);
  expect(requests.every(request => request.method === 'GET')).toBe(true);
});
