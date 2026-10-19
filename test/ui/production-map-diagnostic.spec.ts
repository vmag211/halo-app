import { expect, test } from '@playwright/test';
import { mockProduction } from './production-fixtures';

test('isolated production preview map backing store matches its displayed size', async ({ page }, info) => {
  await mockProduction(page);
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto('/app/explore');
  await expect(page.getByTestId('production-product')).toBeVisible();
  const map = page.locator('.ex-mini-map-canvas');
  await expect(map).toHaveAttribute('data-map-preview-state', 'ready');
  await expect(map.locator('.halo-map-atlas')).toHaveAttribute('data-context', 'ready');
  await expect(map.locator('.halo-map-atlas')).toHaveAttribute('data-fonts', 'ready');
  await expect.poll(() => map.locator('canvas').evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio, 2);
    return canvas.width>0&&canvas.height>0&&canvas.width===Math.round(box.width*ratio)&&canvas.height===Math.round(box.height*ratio);
  })).toBe(true);
  const bounds=await map.boundingBox();expect(bounds!.width).toBeGreaterThan(200);expect(bounds!.height).toBeGreaterThanOrEqual(150);expect(bounds!.height).toBeLessThanOrEqual(260);
  await map.screenshot({ path: info.outputPath('production-map-ready.png') });
});
