import { expect, test, type Page } from '@playwright/test';

const errors=new WeakMap<Page,string[]>();
test.beforeEach(async ({page})=>{
  const observed:string[]=[];errors.set(page,observed);page.on('pageerror',error=>observed.push(error.message));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    return url.pathname.startsWith('/api/')||!['localhost','127.0.0.1'].includes(url.hostname)?route.abort():route.continue();
  });
});
test.afterEach(async({page})=>{expect(errors.get(page)).toEqual([]);});
async function open(page:Page,extra='') {
  await page.goto(`/foundation/preview/map?appearance=dark&motion=reduce&layer=water&system=SAMPLE-01&${extra}`);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Loading location details.',{exact:true})).toHaveCount(0);
}
async function compare(page:Page,second='SAMPLE-02',extra='') {
  await open(page,`mapSheet=compare&compare=${second}&contaminant=pfoa&${extra}`);
  await expect(page.getByRole('heading',{name:'Compare public records'})).toBeVisible();
}

test('changing home removes old map location and previously generated project evidence',async({page})=>{
  await page.goto('/foundation/preview/expanded/?tab=act&motion=reduce');
  await page.getByRole('button',{name:/See all \d+/}).click();
  await page.getByRole('button',{name:'Refresh ideas',exact:true}).click();
  await expect(page.locator('.ex-generation-message')).toContainText('ideas ready');
  await page.getByRole('button',{name:'Back to Explore',exact:true}).click();
  await page.getByRole('link',{name:'Explore the map: open the full water map'}).click();
  await page.getByRole('button',{name:'Locate your home',exact:true}).click();
  await page.getByRole('link',{name:'Back to Explore',exact:true}).click();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:/^Home & household/}).click();
  await page.locator('summary').filter({hasText:'Home location'}).click();
  await page.getByLabel('City or ZIP code',{exact:true}).fill('28025');
  await page.getByText('Expanded app review · Not approved',{exact:true}).click();
  await page.getByRole('combobox',{name:'Home lookup',exact:true}).selectOption('available');
  await page.getByText('Expanded app review · Not approved',{exact:true}).click();
  await page.getByRole('button',{name:'Find area',exact:true}).click();
  await page.getByRole('button',{name:'Review changes',exact:true}).click();
  await page.getByRole('button',{name:'Confirm home change',exact:true}).click();
  await expect(page.locator('.hc-flow')).toContainText('New home selected');
  await page.getByRole('link',{name:'Explore',exact:true}).click();
  await page.getByRole('link',{name:'Explore the map: open the full water map'}).click();
  await expect(page.getByRole('button',{name:'Locate your home',exact:true})).toHaveCount(0);
  await expect(page.locator('.halo-map-home-context')).toHaveCount(0);
  await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-zoom','7');
  await page.getByRole('button',{name:'List',exact:true}).click();
  await expect(page.getByRole('option',{name:'Nearest my home',exact:true})).toHaveCount(0);
  await expect(page.getByRole('dialog')).not.toContainText('Your water system');
  await page.getByRole('button',{name:'Close sheet',exact:true}).click();
  await page.getByRole('link',{name:'Back to Explore',exact:true}).click();
  await page.getByRole('button',{name:/See all \d+/}).click();
  await page.locator('summary').filter({hasText:'Generation details and sources'}).click();
  await expect(page.locator('.ex-generation-details')).toContainText('Public environmental readings are unavailable');
  await expect(page.locator('.ex-generation-details li')).toHaveCount(0);
  await expect(page.locator('.ex-generated-list')).not.toContainText('You recorded an indoor moisture observation.');
});

test('choose, search, replace, cancel, remove and return preserve source selection',async({page})=>{
  await open(page);
  await page.getByRole('button',{name:'Compare records',exact:true}).click();
  await page.getByRole('searchbox',{name:'Find a comparison record'}).fill('Piedmont');
  await page.getByRole('button',{name:/Piedmont Community Water SAMPLE-02/}).click();
  await expect(page).toHaveURL(/compare=SAMPLE-02/);
  await page.getByLabel('Compare compound').selectOption('pfoa');
  const row=page.getByRole('region',{name:'PFOA',exact:true});
  await expect(row).toContainText('5.8 ppt');
  await expect(row).toContainText('2.1 ppt');
  await expect(row).toHaveAttribute('data-compatible','true');
  await page.getByText('Change records',{exact:true}).click();
  await page.getByRole('button',{name:'Replace second record'}).click();
  await page.getByRole('searchbox').fill('Does not exist');
  await expect(page.getByText('No matching records. Try a name or system ID.')).toBeVisible();
  await page.getByRole('button',{name:'Cancel replacement'}).click();
  await expect(page).toHaveURL(/compare=SAMPLE-02/);
  await expect(page.getByRole('heading',{name:'Comparison basis',exact:true})).toBeFocused();
  await page.getByText('Change records',{exact:true}).click();
  await page.getByRole('button',{name:'Replace first record'}).click();
  await page.getByRole('searchbox').fill('Longleaf');
  await page.getByRole('button',{name:/Longleaf Water SAMPLE-04/}).click();
  await expect(row).toContainText('0 ppt');
  await expect(page).toHaveURL(/system=SAMPLE-04/);
  await expect(page.getByRole('heading',{name:'Comparison basis',exact:true})).toBeFocused();
  await page.getByText('Change records',{exact:true}).click();
  await page.getByRole('button',{name:'Remove second record'}).click();
  await expect(page.getByRole('searchbox')).toBeFocused();
  await expect(page).not.toHaveURL(/compare=/);
  await page.getByRole('button',{name:'Back to record'}).click();
  await expect(page.getByRole('heading',{name:'Longleaf Water'})).toBeVisible();
  await expect(page).not.toHaveURL(/mapSheet=compare/);
});
test('zero, missing, source detail and unlocated records retain their meaning',async({page})=>{
  await compare(page,'SAMPLE-04');
  await expect(page.getByRole('region',{name:'PFOA',exact:true})).toContainText('0 ppt');
  await expect(page.getByRole('dialog')).toContainText('Detection-only release. Complete testing coverage is unknown.');
  await page.getByText('Source details',{exact:true}).click();
  await expect(page.getByText('An exact source record is not available here.')).toHaveCount(2);
  await expect(page.getByRole('link',{name:'Official background'})).toHaveCount(2);
  await compare(page,'SAMPLE-03');
  await expect(page.getByRole('region',{name:'PFOA',exact:true})).toContainText('No result supplied');
  await expect(page.getByRole('region',{name:'PFOA',exact:true})).toHaveAttribute('data-compatible','false');
  await compare(page,'SAMPLE-14','mapScenario=no-location');
  await expect(page.getByRole('dialog')).toContainText('Unmapped Community Water');
  await expect(page.locator('.halo-map-home-context')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Your home',exact:true})).toHaveCount(0);
  const params=new URL(page.url()).searchParams;
  for(const key of ['lat','lng','address','home','note'])expect(params.has(key)).toBe(false);
});
for (const [scenario,reason] of [['units','The original units differ. No conversion is assumed.'],['period','The observation periods do not align.'],['method','The methods are different or not supplied.'],['denominator','The comparison bases differ or are unknown.'],['scope','The geographic scopes differ.'],['version','Source versions differ or are unknown.'],['withdrawn','A record is unavailable or withdrawn.']]) {
  test(`review case ${scenario} does not report a comparable result`,async({page})=>{
    await compare(page,'SAMPLE-02',`comparisonCase=${scenario}`);
    await expect(page.getByRole('region',{name:'PFOA',exact:true})).toHaveAttribute('data-compatible','false');
    await expect(page.getByRole('dialog')).toContainText(reason);
  });
}
test('air keeps differing pollutants and observation hours visible',async({page})=>{
  await page.goto('/foundation/preview/map?layer=air&system=air-1&mapSheet=compare&compare=air-2&motion=reduce');
  const dialog=page.getByRole('dialog');
  await expect(dialog).toContainText('42 AQI');
  await expect(dialog).toContainText('87 AQI');
  await expect(dialog).toContainText('Ozone');
  await expect(dialog).toContainText('The analytes or pollutants differ.');
  await page.goto('/foundation/preview/map?layer=air&system=air-1&mapSheet=compare&compare=air-3&motion=reduce');
  await expect(dialog).toContainText('The observation periods do not align.');
  await expect(dialog).toContainText('Sep 30, 2026');
});
test('loading can be exited and failed requests retry without losing selection',async({page})=>{
  await compare(page,'SAMPLE-02','comparisonCase=loading');
  await expect(page.getByRole('dialog')).toContainText('Loading comparison evidence.');
  await page.getByRole('button',{name:'Back to record'}).click();
  await expect(page.getByRole('heading',{name:'Meadow Water'})).toBeVisible();
  await compare(page,'SAMPLE-02','comparisonCase=error');
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await expect(page.getByRole('region',{name:'PFOA',exact:true})).toHaveAttribute('data-compatible','true');
  await expect(page).toHaveURL(/compare=SAMPLE-02/);
});
test('stale links, blocked data and same-record links have useful exits',async({page})=>{
  await page.goto('/foundation/preview/map?layer=water&system=unknown&mapSheet=compare&compare=SAMPLE-02&motion=reduce');
  await expect(page.getByRole('dialog')).toContainText('This record is not available in the selected layer and period.');
  await page.getByRole('button',{name:'Clear comparison'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await compare(page,'SAMPLE-01');
  await expect(page.getByRole('dialog')).toContainText('Choose two different public records.');
  await compare(page,'SAMPLE-02','mapScenario=layer-error');
  await expect(page.getByRole('dialog')).toContainText('Load this layer before comparing its records.');
  await page.getByRole('dialog').getByRole('button',{name:'Try again',exact:true}).click();
  await expect(page.getByRole('region',{name:'PFOA',exact:true})).toHaveAttribute('data-compatible','true');
});
test('renderer failure still exposes searchable records and comparison without a map',async({page})=>{
  await page.goto('/foundation/preview/map?layer=water&mapScenario=map-unavailable&motion=reduce');
  await page.getByRole('button',{name:'Browse locations',exact:true}).click();
  await page.getByRole('searchbox').fill('Meadow');
  await page.getByRole('button',{name:/Meadow Water/}).first().click();
  await page.getByRole('button',{name:'Compare records',exact:true}).click();
  await page.getByRole('searchbox').fill('Longleaf');
  await page.getByRole('button',{name:/Longleaf Water SAMPLE-04/}).click();
  await expect(page.getByRole('dialog')).toContainText('0 ppt');
});
test('public access has no household, private-note or private assistant entry and retains public comparison',async({page})=>{
  await open(page,'access=public');
  await expect(page.locator('.ex-map-to-note')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Follow this system',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Locate your home'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Open Luna'})).toHaveCount(0);
  await page.getByRole('button',{name:'Compare records',exact:true}).click();
  await page.getByRole('searchbox').fill('Piedmont');
  await page.getByRole('button',{name:/Piedmont Community Water SAMPLE-02/}).click();
  await expect(page.getByRole('dialog')).toContainText('2.1 ppt');
  await page.getByRole('button',{name:'Clear comparison'}).click();
  const back=page.getByRole('link',{name:'Back to HALO'});
  await expect(back).toHaveAttribute('href',/\/foundation\/preview\/expanded\/?\?.*tab=plan.*access=public/);
  await page.getByRole('button',{name:'Open area brief'}).click();
  await expect(page.getByRole('dialog')).not.toContainText('Your water system');
  await expect(page.getByRole('dialog')).not.toContainText('ranks 34th');
  await page.goto('/foundation/preview/map?access=public&mapSheet=assistant&motion=reduce');
  await expect(page.getByRole('heading',{name:'About this map'})).toBeVisible();
  await expect(page.locator('.luna-conversation')).toHaveCount(0);
  await expect(page.getByRole('dialog')).not.toContainText('Your home pin');
  await page.goto('/foundation/preview/map?access=public&system=home&motion=reduce');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).not.toHaveURL(/system=home/);
});
test('system follow is deliberate, reversible and unavailable offline',async({page})=>{
  await open(page);
  await page.getByRole('button',{name:'Follow this system',exact:true}).click();
  await expect(page.getByText('Added to Your follows.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Stop following',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.halo-map-system-follow')).toContainText('Update delivery is not connected.');
  await page.getByRole('button',{name:'Stop following',exact:true}).click();
  await expect(page.getByRole('button',{name:'Follow this system',exact:true})).toHaveAttribute('aria-pressed','false');
  await open(page,'mapScenario=offline');
  await page.getByRole('button',{name:'Follow this system',exact:true}).click();
  await expect(page.getByText('Could not update this follow. Your previous choice is kept.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Follow this system',exact:true})).toHaveAttribute('aria-pressed','false');
});
test('district brief is reviewed before download and preserves copy/share fallback',async({page})=>{
  await page.addInitScript(()=>{Object.defineProperty(navigator,'share',{configurable:true,value:undefined});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('denied'))}});});
  await page.goto('/foundation/preview/map?access=public&panel=district&motion=reduce');
  await page.getByText('Public district brief',{exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Review public brief'})).toHaveValue(/Fictional water records/);
  await page.getByRole('button',{name:'Copy brief',exact:true}).click();
  await expect(page.getByText('Copy was unavailable. Select and copy the text below.')).toBeVisible();
  await page.getByRole('button',{name:'Share brief',exact:true}).click();
  await expect(page.getByText('Sharing is unavailable. Copy or download the brief instead.')).toBeVisible();
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download public data',exact:true}).click();
  expect((await download).suggestedFilename()).toBe('halo-public-district.json');
  await page.goto('/foundation/preview/map?panel=district&mapScenario=district-geography&motion=reduce');
  await expect(page.getByText('Public district brief',{exact:true})).toHaveCount(0);
});
test('comparison history replaces selection and Escape restores the map',async({page})=>{
  await page.goto('/foundation/preview/map?layer=water&motion=reduce');
  await page.getByRole('button',{name:'List',exact:true}).click();
  await page.getByRole('button',{name:/Meadow Water/}).first().click();
  await page.getByRole('button',{name:'Compare records',exact:true}).click();
  await page.getByRole('searchbox').fill('Piedmont');
  await page.getByRole('button',{name:/Piedmont Community Water SAMPLE-02/}).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'List',exact:true})).toBeFocused();
  await expect(page).not.toHaveURL(/compare=/);
});
for(const [width,scale,appearance] of [[320,150,'light'],[375,100,'dark'],[430,130,'light'],[1280,100,'dark']] as const) {
  test(`comparison fits ${width}px at ${scale}% in ${appearance}`,async({page})=>{
    await page.setViewportSize({width,height:850});
    await page.goto(`/foundation/preview/map?layer=water&system=SAMPLE-01&mapSheet=compare&compare=SAMPLE-02&appearance=${appearance}&scale=${scale}&motion=reduce&mapScenario=long-text`);
    const dialog=page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.getByText('Source details',{exact:true}).click();
    await page.evaluate(()=>document.fonts.ready);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
    const small=await dialog.locator('button').evaluateAll(elements=>elements.filter(e=>e.checkVisibility()).some(e=>e.getBoundingClientRect().height<44));
    expect(small).toBe(false);
  });
}
