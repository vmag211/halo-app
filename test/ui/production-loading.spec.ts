import {test,expect} from '@playwright/test';
import {mockProduction,homeId} from './production-fixtures';
import {jsonRoute,stageProfile} from './stage-fixtures';

test('startup stays pending for the real profile request and clears only after it resolves',async({page})=>{
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;});
  const network=await mockProduction(page,{'/api/profile':async route=>{await held;await jsonRoute(route,{...stageProfile,home_context:{id:homeId,revision:1}});}});
  await page.goto('/app/today');
  const opening=page.getByRole('status',{name:'Opening HALO',exact:true});
  await expect(opening).toBeVisible();
  await page.waitForTimeout(800);
  await expect(opening).toBeVisible();
  await expect(page.getByTestId('production-product')).toHaveCount(0);
  release();
  await expect(page.getByTestId('production-product')).toBeVisible();
  await expect(opening).toHaveCount(0);
  expect(network.blocked).toEqual([]);
});

test('home collection loading persists, becomes an error on failure and recovers on retry',async({page})=>{
  let release!:()=>void,reads=0,holding=true,fail=true;
  const held=new Promise<void>(resolve=>{release=resolve;});
  const network=await mockProduction(page,{'/api/frontend/workspace':async(route,url)=>{
    if(url.searchParams.get('collection')==='tests'){
      reads++;if(holding)await held;
      if(fail){await jsonRoute(route,{error:'unavailable'},503);return;}
    }
    await jsonRoute(route,{records:[],revision:1,availability:'ready',complete:true,pendingOperations:[]});
  }});
  await page.goto('/app/homeguard/tests');
  const loading=page.getByRole('status',{name:'Opening your home workspace',exact:true});
  await expect(loading).toBeVisible();await page.waitForTimeout(800);await expect(loading).toBeVisible();
  holding=false;release();await expect(loading).toHaveCount(0);
  const failure=page.getByRole('alert').filter({has:page.getByRole('button',{name:'Try again',exact:true})});
  await expect(failure).toBeVisible();fail=false;await failure.getByRole('button',{name:'Try again',exact:true}).click();
  await expect(failure).toHaveCount(0);await expect(page.getByRole('heading',{name:'Home tests & reports',exact:true})).toBeVisible();
  expect(reads).toBeGreaterThanOrEqual(2);expect(network.blocked).toEqual([]);
});

test('ready test records remain usable while an auxiliary collection is still loading',async({page})=>{
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;});
  const network=await mockProduction(page,{'/api/frontend/workspace':async(route,url)=>{
    if(url.searchParams.get('collection')==='gardens')await held;
    await jsonRoute(route,{records:[],revision:1,availability:'ready',complete:true,pendingOperations:[]});
  }});
  await page.goto('/app/homeguard/tests');
  await expect(page.getByRole('heading',{name:'Home tests & reports',exact:true})).toBeVisible();
  const loading=page.getByRole('status',{name:'Loading remaining home records',exact:true});
  await expect(loading).toBeVisible();await page.waitForTimeout(800);await expect(loading).toBeVisible();
  await expect(page.getByRole('button',{name:'Plan a test',exact:false})).toBeEnabled();
  release();await expect(loading).toHaveCount(0);expect(network.blocked).toEqual([]);
});
