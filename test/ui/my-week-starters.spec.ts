import {test,expect} from '@playwright/test';
const root='/foundation/preview/expanded/?review=tools&tab=plan&motion=reduce';
test.beforeEach(async({page})=>{await page.route('**/*',route=>{const u=new URL(route.request().url());return ['localhost','127.0.0.1'].includes(u.hostname)&&!u.pathname.startsWith('/api/')?route.continue():route.abort();});});

test('a new week shows labelled starter ideas that become a real task only when added',async({page})=>{
  await page.goto(root);
  const ideas=page.getByRole('region',{name:'Ideas to start your week'});
  await expect(ideas.locator('.mw-starter')).toHaveCount(4);
  await expect(ideas).toContainText('These are not saved.');
  await expect(ideas.locator('.mw-starter-tag').first()).toContainText('Starter idea');
  await expect(page.locator('.mw-task')).toHaveCount(0);
  await expect(ideas.getByRole('link',{name:'Plan outdoors'})).toHaveAttribute('href',/outdoors/);
  await ideas.getByRole('button',{name:'Dismiss: Check today’s air before time outside'}).click();
  await expect(ideas.locator('.mw-starter')).toHaveCount(3);
  await ideas.getByRole('button',{name:'Add to My Week: Check your home’s radon zone'}).click();
  await expect(page.locator('.mw-feedback[role="status"]')).toContainText('Added to My Week');
  await expect(page.locator('.mw-feedback[role="status"]')).toBeFocused();
  await expect(page.locator('.mw-agenda .mw-task')).toHaveCount(1);
  await expect(page.locator('.mw-agenda .mw-task')).toContainText('Check your home’s radon zone');
  await expect(page.locator('.mw-starters')).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toContain('—');
});

test('hiding the ideas keeps the week empty and honest',async({page})=>{
  await page.goto(root);
  await page.getByRole('button',{name:'Hide these ideas',exact:true}).click();
  await expect(page.locator('.mw-starters')).toHaveCount(0);
  await expect(page.locator('.mw-day-empty')).toContainText('No plans for this day.');
  // The review shell has sample record dates; leave only tasks in the agenda.
  await page.getByText('Calendar options',{exact:true}).click();await page.getByText('Calendar sources',{exact:false}).click();
  await page.getByLabel('Include dates from my records').uncheck();
  await page.getByRole('button',{name:'Agenda',exact:true}).click();
  await expect(page.locator('.mw-day-empty')).toContainText('No dated tasks yet.');
});

test('completing the only task of the day says it is done and can show it again',async({page})=>{
  await page.goto(root);
  await page.getByRole('button',{name:'Add task',exact:true}).click();
  const panel=page.getByRole('dialog',{name:'Add a task',exact:true});
  await panel.getByLabel('Task title').fill('Only task');
  await panel.getByRole('button',{name:'Save task',exact:true}).click();
  await page.getByRole('button',{name:'Complete Only task',exact:true}).click();
  await expect(page.locator('.mw-day-empty')).toContainText('Everything planned for this day is done.');
  await page.getByRole('button',{name:'Show completed (1)',exact:true}).click();
  await expect(page.getByRole('button',{name:'Reopen Only task',exact:true})).toBeVisible();
});
