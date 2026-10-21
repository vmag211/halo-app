import {test,expect} from '@playwright/test';
const root='/foundation/preview/expanded/?tab=plan&motion=reduce';
test.beforeEach(async({page})=>{await page.route('**/*',route=>{const u=new URL(route.request().url());return ['localhost','127.0.0.1'].includes(u.hostname)&&!u.pathname.startsWith('/api/')?route.continue():route.abort();});});

test('the device day is used without a hydration mismatch and advances past midnight',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  // 11:58 PM in New York on Sunday, a different day from the server that rendered the page.
  await page.clock.install({time:new Date('2026-10-12T03:58:00Z')});
  await page.goto(root);
  const day=page.locator('.mw-command-copy time');
  await expect(day).toHaveAttribute('datetime','2026-10-11');await expect(day).toHaveText('Sunday, Oct 11');
  await expect(page.locator('.mw-days [data-today="true"] strong')).toHaveText('11');
  await page.clock.fastForward('03:00');
  await expect(day).toHaveAttribute('datetime','2026-10-12');await expect(day).toHaveText('Monday, Oct 12');
  await expect(page.locator('.mw-days [data-today="true"] strong')).toHaveText('12');
  expect(errors.filter(message=>/hydrat/i.test(message))).toEqual([]);
});
