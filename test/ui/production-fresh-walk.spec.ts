import {expect,test} from '@playwright/test';
import {mockProduction} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';

/* First-time-user consistency checks from the fresh product walk: the same thing is named the same way
 * on every screen, controls are named by what they show, and disclosures look like disclosures. */
const zoneDay=(offset=0)=>{const day=new Date(`${new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date())}T12:00:00Z`);day.setUTCDate(day.getUTCDate()+offset);return day.toISOString().slice(0,10);};
const actions=()=>({actions:[
 {id:'a1',key:'personal:a1',revision:1,title:'Plan the neighborhood cleanup',reason:'A task you added.',origin:'Personal',state:'saved',date:zoneDay()},
 {id:'a2',key:'personal:a2',revision:1,title:'Order a radon test kit',reason:'Radon zone 1 county.',origin:'Homeguard',state:'saved',date:zoneDay(3)},
],metas:{},unresolvedOperations:[]});

test('an untimed task reads Any time in the agenda, In focus and Up next alike',async({page})=>{
 const network=await mockProduction(page,{'/api/frontend/actions':route=>jsonRoute(route,actions())});
 await page.goto('/app');
 const next=page.locator('.mw-next-list li').filter({hasText:'Order a radon test kit'});
 await expect(next).toContainText('Any time');await expect(page.locator('.mw-workspace')).not.toContainText('All day');
 expect(network.blocked).toEqual([]);
});

test('Week recap is named by its visible label and Before you begin shows the Status control words',async({page})=>{
 const network=await mockProduction(page,{'/api/frontend/actions':route=>jsonRoute(route,actions())});
 await page.goto('/app');
 await expect(page.getByRole('button',{name:/^Week recap/})).toBeVisible();
 await page.getByRole('button',{name:/^Get ready/}).click();
 const sheet=page.locator('#homepage-hub');await expect(sheet).toContainText('Your status: Saved');await expect(sheet).not.toContainText('Your status: saved');
 expect(network.blocked).toEqual([]);
});

test('plain-text disclosures in the task sheet carry a visible chevron cue',async({page})=>{
 const network=await mockProduction(page,{'/api/frontend/actions':route=>jsonRoute(route,actions())});
 await page.goto('/app');await page.getByRole('button',{name:'Add task'}).first().click();
 const summary=page.locator('.mw-form summary',{hasText:'Time, repeat & preparation'});await expect(summary).toBeVisible();
 const cue=()=>summary.evaluate(node=>{const after=getComputedStyle(node,'::after');return {content:after.content,width:after.width,transform:after.transform};});
 const closed=await cue();expect(closed.content).not.toBe('none');expect(closed.width).toBe('7px');
 await summary.click();expect((await cue()).transform).not.toBe(closed.transform);
 expect(network.blocked).toEqual([]);
});

test('the Homeguard workspace switcher names Home care as the overview does',async({page})=>{
 const network=await mockProduction(page);
 await page.goto('/app/homeguard/maintenance');
 await expect(page.getByRole('combobox',{name:'Home workspace',exact:true}).locator('option')).toHaveText(['Tests','Home care','Food and Garden','Summary']);
 expect(network.blocked).toEqual([]);
});

test('the desktop sidebar marks Settings as the current page',async({page})=>{
 const network=await mockProduction(page);await page.setViewportSize({width:1280,height:800});
 await page.goto('/app/settings');
 const sidebar=page.getByRole('complementary',{name:'HALO sidebar'});
 await expect(sidebar.getByRole('link',{name:'Settings',exact:true})).toHaveAttribute('aria-current','page');
 await expect(sidebar.locator('[aria-current=page]')).toHaveCount(1);
 await page.goto('/app/today');await expect(sidebar.getByRole('link',{name:'Settings',exact:true})).not.toHaveAttribute('aria-current','page');
 expect(network.blocked).toEqual([]);
});
