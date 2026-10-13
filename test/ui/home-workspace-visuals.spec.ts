import { test, expect, type Page } from '@playwright/test';

const faults = new WeakMap<Page, string[]>();
const home = (section: string, view = 'list', record = '') => `/foundation/preview/expanded/?tab=home&destination=${section}&homeView=${view}&record=${record}&motion=reduce&time=day`;
const explore = '/foundation/preview/expanded/?tab=act&motion=reduce&time=day';
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; faults.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname.startsWith('/api/')) { errors.push(`Unexpected request: ${url.pathname}`); return route.abort(); }
    return route.continue();
  });
});
test.afterEach(async ({ page }) => expect(faults.get(page)).toEqual([]));

for (const appearance of ['light', 'dark']) test(`four home workspaces have distinct useful compositions in ${appearance}`, async ({ page }, info) => {
  for (const section of ['tests', 'maintenance', 'food', 'summary']) {
    await page.goto(`${home(section)}&appearance=${appearance}`);
    await expect(page.locator('[data-home-heading]')).toBeVisible();
    await expect(page.locator('.hg-intro [data-work-art]')).toHaveAttribute('data-work-art', section);
    await expect(page.getByRole('combobox', { name:'Home workspace', exact: true })).toHaveValue(section);
    await expect(page.getByRole('link', { name: 'Back to Homeguard' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const heading = await page.locator('[data-home-heading]').boundingBox();
    const art = await page.locator('.hg-intro [data-work-art]').boundingBox();
    expect(art!.x).toBeGreaterThanOrEqual(heading!.x + heading!.width - 1);
    if (section === 'food') {
      await expect(page.locator('.hg-food-destinations [data-work-art]')).toHaveCount(5);
      await expect(page.getByRole('button', { name: /^Food at home/ })).toBeVisible();
    }
    await page.screenshot({ path: info.outputPath(`home-${section}-${appearance}.png`) });
  }
});

for (const appearance of ['light', 'dark']) test(`home subfeatures keep tailored art and readable controls at 320px enlarged in ${appearance}`, async ({ page }) => {
  test.setTimeout(120000); await page.setViewportSize({ width: 320, height: 850 });
  for (const [section, view, id, art] of [
    ['tests','report','','report'], ['tests','detail','test-water-september','tests'],
    ['maintenance','create','','maintenance'], ['maintenance','observation','','moisture'],
    ['food','pantry','','pantry'], ['food','fish','','fish'], ['food','gardens','','garden'],
    ['food','evidence','','evidence'], ['food','growers','','grower'], ['food','water','','water'],
    ['summary','selection','','summary'],
  ]) {
    await page.goto(`${home(section,view,id)}&appearance=${appearance}&scale=150`);
    await expect(page.locator('[data-home-heading]')).toBeVisible();
    await expect(page.locator('.hg-intro [data-work-art]')).toHaveAttribute('data-work-art', art);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${view} fits`).toBe(true);
    for (const field of await page.locator('.hg-workspace input:not([type="checkbox"]),.hg-workspace select,.hg-workspace textarea').all()) {
      if (await field.isVisible()) { const box = await field.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(321); }
    }
  }
});

test('report contents responds to explicit record and privacy choices', async ({ page }) => {
  await page.goto(home('summary', 'selection'));
  const contents = page.getByRole('region', { name:'Selected report contents' });
  await expect(contents).toContainText('Today & Homeguard scores');
  await expect(contents).toContainText('Private notes, place labels');
  await expect(contents).not.toContainText('Test reports');
  await page.getByText('Add private records · Optional', {exact:true}).click();
  await page.getByRole('checkbox', {name:'Test reports',exact:true}).check();
  await expect(contents).toContainText('Test reports');
  await expect(contents).toContainText('records');
  await page.getByText('Privacy & extra detail', {exact:true}).click();
  await page.getByRole('checkbox', {name:'Private notes on selected records',exact:true}).check();
  await expect(contents).toContainText('Optional private fields selected');
});

test('project refresh changes relevant photo subjects and image failure does not follow a new idea', async ({ page }) => {
  await page.route('**/explore/soil-sampling.webp', route => route.abort());
  await page.goto(explore);
  const lead = page.locator('.ex-generated-lead .ex-photo');
  await expect(lead).toHaveAttribute('data-photo-scene','soil');
  await expect(lead).toHaveAttribute('data-photo-state','unavailable');
  const scenes = new Set(['soil']);
  for (let i=0;i<4;i++) {
    await page.getByRole('button',{name:'Refresh project ideas',exact:true}).click();
    await expect(page.getByRole('button',{name:'Refresh project ideas',exact:true})).toBeEnabled();
    const scene = (await lead.getAttribute('data-photo-scene'))!; scenes.add(scene);
    if (scene !== 'soil') { await expect(lead).toHaveAttribute('data-photo-state','available'); await expect.poll(() => lead.locator('img').evaluate((img:HTMLImageElement) => img.complete && img.naturalWidth>0)).toBe(true); }
  }
  expect(scenes.size).toBeGreaterThanOrEqual(3);
});

test('project detail photographs are activity-specific and all reusable assets have visible credits', async ({page},info) => {
  test.setTimeout(90000);
  for (const [id,scene] of [['bee-house','bee'],['native-tree','tree'],['home-compost','compost'],['solar-oven','solar'],['food-waste-week','food'],['community-cleanup','cleanup'],['demo-water-project','water'],['moisture-check','moisture'],['soil-test-plan','soil']]) {
    await page.goto(`${explore}&destination=projects&exploreView=detail&exploreRecord=${id}`);
    const photo=page.locator('.ex-guide-cover .ex-photo');
    await expect(photo).toHaveAttribute('data-photo-scene',scene);
    await expect.poll(() => photo.locator('img').evaluate((img:HTMLImageElement)=>img.complete && img.naturalWidth>0)).toBe(true);
    await expect(page.locator('.ex-guide-cover')).toContainText('not build instructions');
    await expect(page.locator('.ex-guide-cover [data-artwork]')).toHaveCount(1);
    if (scene==='solar') await page.screenshot({path:info.outputPath('project-solar-photo.png')});
  }
  await page.getByLabel('Explore resources',{exact:true}).click();
  await page.getByText('About the photos',{exact:true}).click();
  await expect(page.locator('.ex-photo-credits li')).toHaveCount(12);
  await expect(page.locator('.ex-photo-credits')).toContainText('Nadya Peek');
  await expect(page.locator('.ex-photo-credits')).toContainText('normanack');
  await expect(page.locator('.ex-photo-credits')).toContainText('Resized');
  await expect(page.locator('.ex-photo-credits a[href="https://creativecommons.org/licenses/by/2.0/"]')).toHaveCount(2);
});

test('high contrast retains home workflows without decorative art', async ({page})=>{
  await page.goto(`${home('food')}&contrast=true&scale=150`);
  await expect(page.locator('.hg-intro [data-work-art]')).toBeHidden();
  await expect(page.getByRole('button',{name:/^Fish advisories/})).toBeVisible();
  await page.getByRole('button',{name:/^My garden/}).click();
  await expect(page.locator('[data-home-heading]')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
