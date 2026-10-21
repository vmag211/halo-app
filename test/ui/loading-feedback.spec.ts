import { test, expect } from '@playwright/test';

test.beforeEach(async ({page}) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['localhost','127.0.0.1'].includes(url.hostname) && !url.pathname.startsWith('/api/') ? route.continue() : route.abort();
  });
});

test('arrival lasts half a second without blocking ready content or replaying on disclosure', async ({page}) => {
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto('/app?motion=full');
  const app = page.getByTestId('foundation-product');
  await expect(app).toHaveAttribute('data-animate','true');
  const nav = page.getByRole('navigation',{name:'Main navigation'});
  await nav.getByRole('link',{name:'Today',exact:true}).click();
  await expect(nav.getByRole('link',{name:'Today',exact:true})).toHaveAttribute('aria-current','page');
  const arrival=page.locator('.halo-page-arrival');
  await expect(arrival).toHaveCSS('animation-duration','0.52s');
  await expect(arrival).toHaveCSS('pointer-events','none');
  await expect(page.getByRole('heading',{name:'Know the day ahead.',exact:true})).toBeVisible();
  await expect(arrival).toHaveCSS('opacity','0');
  await page.getByText('How this score works',{exact:true}).click();
  await expect(arrival).toHaveCSS('opacity','0');
});

test('loading panels fit small screens, enlarged text and each palette', async ({page},info) => {
  await page.setViewportSize({width:320,height:780});
  for(const [appearance,palette] of [['dark','ocean'],['light','forest'],['dark','iris']]) {
    await page.goto(`/tools?scenario=loading&appearance=${appearance}&palette=${palette}&scale=150&motion=reduce`);
    const loader=page.locator('.halo-loading');
    await expect(loader).toContainText('Loading readings');
    const bounds=(await loader.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(321);
    expect(await loader.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  }
  await page.screenshot({path:info.outputPath('iris-loading-150.png')});
});

for (const mode of ['full','device-reduce','app-reduce','forced-colors'] as const) {
  test(`pending loading remains truthful and accessible with ${mode}`, async ({page},info) => {
    await page.emulateMedia({reducedMotion:mode==='device-reduce'?'reduce':'no-preference',forcedColors:mode==='forced-colors'?'active':'none'});
    await page.goto(`/tools?scenario=loading&motion=${mode==='app-reduce'?'reduce':'full'}`);
    const loading=page.locator('.halo-loading');
    await expect(loading).toHaveAttribute('role','status');
    await expect(loading).toHaveAttribute('aria-busy','true');
    const orbit=loading.locator('.halo-loading-orbit');
    if(mode==='full') {
      await expect(page.getByTestId('foundation-product')).toHaveAttribute('data-animate','true');
      await expect(orbit).toHaveCSS('animation-iteration-count','infinite');
    } else await expect(orbit).toHaveCSS('animation-name','none');
    await page.waitForTimeout(850); // A held pending scenario must not finish on a display timer.
    await expect(loading).toBeVisible();
    await expect(loading).not.toContainText(/100%|Complete|Saved/);
    if(mode==='full')await page.screenshot({path:info.outputPath('halo-loading.png')});
    const tools=page.locator('.halo-f-review-tools');
    if(!await tools.evaluate(node=>(node as HTMLDetailsElement).open))await tools.locator('summary').first().click();
    await page.getByRole('combobox',{name:'Review a screen or state',exact:true}).selectOption('shell');
    await expect(loading).toHaveCount(0);
  });
}
