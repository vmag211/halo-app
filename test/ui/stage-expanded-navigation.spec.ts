import { test, expect } from '@playwright/test';
import {mockProductionStage as mockStage} from './production-fixtures';

test('live navigation has four tabs without exposing review actions or missing routes', async ({ page }) => {
  const { requests, blocked } = await mockStage(page);
  await page.goto('/today');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.locator('span')).toHaveText(['My Week', 'Today', 'Homeguard', 'Explore']);
  await expect(page.getByRole('button', { name: 'Save this step', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'My Week', exact: true })).toHaveAttribute('href','/plan?view=main');
  await expect(nav.getByRole('link', { name: 'Explore', exact: true })).toHaveAttribute('href','/act?view=main');
  await expect(page).toHaveURL(/\/today$/);
  await nav.getByRole('link', { name: 'Homeguard' }).click();
  await expect(nav.getByRole('link', { name: 'Homeguard' })).toHaveAttribute('aria-current', 'page');
  expect(blocked).toEqual([]);
  expect(requests.every(request => request.method === 'GET')).toBe(true);
});
