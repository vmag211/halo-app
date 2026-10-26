import {existsSync} from 'node:fs';
import {expect,test,webkit} from '@playwright/test';
import {mockProduction} from './production-fixtures';

/* WebKit (the iOS Safari engine) dropped focus on the body when a sheet closed; found in the 2026-10-25
 * device release pass. Skipped where the WebKit browser is not installed. */
test.use({browserName:'webkit',channel:''});
test.skip(()=>!existsSync(webkit.executablePath()),'WebKit is not installed (npx playwright install webkit).');

test('closing a sheet with Escape returns focus to the button that opened it',async({page})=>{
 const network=await mockProduction(page);await page.setViewportSize({width:1280,height:800});
 await page.goto('/app');await page.waitForLoadState('networkidle');const add=page.getByRole('button',{name:'Add task'}).first();await expect(add).toBeVisible();
 await add.focus();await page.keyboard.press('Enter');
 const dialog=page.getByRole('dialog',{name:'Add a task'});await expect(dialog).toBeVisible();
 await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
 await expect(add).toBeFocused();
 expect(network.blocked).toEqual([]);
});

test('closing a sheet with its close button returns focus to the opener',async({page})=>{
 const network=await mockProduction(page);await page.setViewportSize({width:1280,height:800});
 await page.goto('/app');await page.waitForLoadState('networkidle');const add=page.getByRole('button',{name:'Add task'}).first();await expect(add).toBeVisible();
 await add.focus();await page.keyboard.press('Enter');
 const dialog=page.getByRole('dialog',{name:'Add a task'});await expect(dialog).toBeVisible();
 await dialog.getByRole('button',{name:'Close sheet'}).focus();await page.keyboard.press('Enter');await expect(dialog).toBeHidden();
 await expect(add).toBeFocused();
 expect(network.blocked).toEqual([]);
});
