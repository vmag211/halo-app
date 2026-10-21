import { expect, test, type Page } from '@playwright/test';

const community = '/foundation/preview/expanded/?tab=act&destination=community&motion=full';
const household = (member: string, extra = '') => `/foundation/preview/household/${member}/?edition=expanded&motion=full${extra}`;

async function holdHydration(page:Page){
 let release!:()=>void;const ready=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/_next/static/**/*.js',async route=>{await ready;await route.continue().catch(()=>{});});
 return release;
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['127.0.0.1', 'localhost'].includes(url.hostname) && !url.pathname.startsWith('/api/') ? route.continue() : route.abort();
  });
});

for (const appearance of ['light', 'dark']) test(`all seven household guides have relevant art and preserve evidence at 320px/150% in ${appearance}`, async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 320, height: 850 });
  const scenes = { toddler: 'care-playroom', child: 'care-playroom', teen: 'care-study', adult: 'care-study', senior: 'care-rest', pregnant: 'care-garden', respiratory: 'care-rest' };
  for (const [member, scene] of Object.entries(scenes)) {
    await page.goto(household(member, `&appearance=${appearance}&scale=150&scenario=no-data`));
    const art = page.locator('.halo-household-editorial .halo-editorial-scene');
    await expect(art).toHaveAttribute('data-editorial-scene', scene);
    await expect(art).toHaveAttribute('aria-hidden', 'true');
    await expect(art).toHaveAttribute('data-moving', 'false');
    await expect.poll(() => art.locator('img').evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator('.halo-home-member-action')).toHaveCount(3);
    for (const evidence of await page.locator('.halo-home-evidence').all()) await expect(evidence).toContainText('Reading unavailable');
    await expect(page.locator('.halo-home-member-limits')).toContainText('not a diagnosis or treatment plan');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    expect(await page.locator('.halo-home-member').innerText()).not.toContain('\u2014');
  }
});

test('community topics change artwork and map destination while preserving source limitations and note context', async ({ page }) => {
  await page.goto(community);
  const topics = [
    { label: 'Water', scene: 'water', layer: 'water', caveat: 'not a measurement of your tap' },
    { label: 'Air', scene: 'air', layer: 'air', caveat: 'does not measure your personal exposure' },
    { label: 'Radon', scene: 'ground', layer: 'radon', caveat: 'Only an appropriate home test' },
    { label: 'Facilities', scene: 'facilities', layer: 'facilities', caveat: 'does not establish a cause' },
  ];
  const sources: string[] = [];
  for (const topic of topics) {
    const button = page.getByRole('button', { name: topic.label, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    const art = page.locator('.ex-community-topic-frame .halo-editorial-scene');
    await expect(art).toHaveCount(1);
    await expect(art).toHaveAttribute('data-editorial-scene', topic.scene);
    await expect.poll(() => art.locator('img').evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    sources.push(await art.locator('img').getAttribute('src') ?? '');
    await expect(page.locator('.ex-community-lesson')).toContainText(topic.caveat);
    await expect(page.getByRole('link', { name: 'Explore this map layer' })).toHaveAttribute('href', new RegExp(`layer=${topic.layer}`));
  }
  expect(new Set(sources).size).toBe(4);
  await page.getByRole('button', { name: 'Keep this question in My notes' }).click();
  await expect(page.getByLabel('Your note (required)')).toHaveValue('What does this record actually say, and which office can explain it?');
});

test('decorative editorial movement can pause, resume and stop when scrolled offscreen', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 390, height: 680 });
  await page.goto(household('adult'));
  const art = page.locator('.halo-household-editorial .halo-editorial-scene');
  await art.scrollIntoViewIfNeeded();
  await expect(art).toHaveAttribute('data-moving', 'true');
  await page.getByRole('button', { name: 'Pause ambient animation', exact: true }).click();
  await expect(art).toHaveAttribute('data-moving', 'false');
  await page.getByRole('button', { name: 'Play ambient animation', exact: true }).click();
  await expect(art).toHaveAttribute('data-moving', 'true');
  await page.locator('.halo-home-member-limits').scrollIntoViewIfNeeded();
  await expect(art).toHaveAttribute('data-moving', 'false');
  await art.scrollIntoViewIfNeeded();
  await expect(art).toHaveAttribute('data-moving', 'true');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(art).toHaveAttribute('data-moving', 'false');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(art).toHaveAttribute('data-moving', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(art).toHaveAttribute('data-moving', 'false');
  await expect(art.locator('.halo-editorial-scene-light')).toHaveCSS('animation-name', 'none');
});

test('community controls retain their space and contrast when artwork is hidden', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto(`${community}&appearance=light&scale=150&contrast=true`);
  await expect(page.locator('.ex-community-topic-frame .halo-editorial-scene')).toBeHidden();
  for (const label of ['Water', 'Air', 'Radon', 'Facilities']) {
    const button = page.getByRole('button', { name: label, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(await button.evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
  await expect(page.getByRole('link', { name: 'Explore this map layer' })).toBeVisible();
});

test('artwork failure leaves household guidance, sources and actions usable', async ({ page }) => {
  await page.route('**/preview-scenes/care-*.webp', route => route.abort());
  await page.goto(household('toddler'));
  await expect(page.locator('.halo-household-editorial .halo-editorial-scene')).toHaveAttribute('data-failed', 'true');
  await expect(page.locator('.halo-household-editorial .halo-editorial-scene')).toHaveAttribute('data-moving', 'false');
  await expect(page.locator('.halo-home-member-action')).toHaveCount(3);
  await page.locator('.halo-home-member-action summary').first().click();
  await expect(page.locator('.halo-home-member-action details[open] a')).toBeVisible();
  await expect(page.locator('.halo-home-member-action').first()).toContainText('Boiling does not remove lead');
});

test('daily household guidance keeps all topics and source meaning with lazy topic art', async ({ page }) => {
  await page.goto('/foundation/preview/family/?edition=expanded&motion=reduce');
  await expect(page.locator('.halo-family-topic-art')).toHaveCount(4);
  await expect(page.locator('.halo-family-topic-art img').first()).toHaveAttribute('loading', 'lazy');
  await page.getByRole('button', { name: 'At home', exact: true }).click();
  await expect(page.locator('.halo-family-guidance-item')).toHaveCount(1);
  await expect(page.locator('.halo-family-topic-art')).toHaveAttribute('data-editorial-scene', 'mold');
  await page.getByRole('button', { name: 'All guidance', exact: true }).click();
  await expect(page.locator('.halo-family-guidance-item')).toHaveCount(4);
  await expect(page.locator('.halo-family-limits')).toContainText('associations, not proof of a cause');
});

for(const broken of [false,true])test(`editorial images settled before hydration restore ${broken?'failure fallback':'ambient readiness'}`,async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});
 const release=await holdHydration(page);
 if(broken)await page.route('**/preview-scenes/care-study.webp',route=>route.abort());
 try{
  await page.goto(household('adult'),{waitUntil:'commit'});
  const art=page.locator('.halo-household-editorial .halo-editorial-scene');
  await expect.poll(()=>art.locator('img').evaluate(node=>(node as HTMLImageElement).complete)).toBe(true);
  await expect.poll(()=>art.locator('img').evaluate(node=>(node as HTMLImageElement).naturalWidth)).toBe(broken?0:1536);
  release();await art.scrollIntoViewIfNeeded();
  await expect(art).toHaveAttribute('data-failed',String(broken));await expect(art).toHaveAttribute('data-moving',String(!broken));
  await page.emulateMedia({reducedMotion:'reduce'});await expect(art).toHaveAttribute('data-moving','false');
 }finally{release();}
});

for(const broken of [false,true])test(`week wallpaper settled before hydration restores ${broken?'failure fallback':'water renderer'}`,async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});const release=await holdHydration(page);
 if(broken)await page.route('**/preview-scenes/week-lake.webp',route=>route.abort());
 try{
  await page.goto('/foundation/preview/expanded/?tab=plan&motion=full',{waitUntil:'commit'});
  const layer=page.locator('.mw-ambience-layer[data-landscape="lake"]');
  await expect.poll(()=>layer.locator('img').evaluate(node=>(node as HTMLImageElement).complete)).toBe(true);
  release();await layer.scrollIntoViewIfNeeded();await expect(layer).toHaveAttribute('data-failed',String(broken));
  if(!broken)await expect(layer.locator('canvas')).toHaveAttribute('data-running','true');
  await expect(page.getByRole('button',{name:'Next landscape',exact:true})).toBeEnabled();
 }finally{release();}
});
