import {expect,test} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

for(const width of [375,1280])test(`main preview tabs make no backend or provider requests at ${width}px`,async({page},info)=>{
  const requests:{method:string;host:string;path:string;type:string}[]=[];
  const errors:string[]=[];
  page.on('request',request=>{
    const url=new URL(request.url());
    requests.push({method:request.method(),host:url.hostname,path:url.pathname,type:request.resourceType()});
  });
  page.on('pageerror',error=>errors.push(error.message));
  // Abort unexpected service traffic as a safety boundary, while recording each attempt.
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    const local=['127.0.0.1','localhost'].includes(url.hostname);
    return local&&!url.pathname.startsWith('/api/')?route.continue():route.abort();
  });
  await page.setViewportSize({width,height:900});
  await page.goto('/foundation/preview/expanded/?tab=plan&motion=reduce');
  await expect(page.locator('.halo-f-header h1')).toHaveText('My Week');
  const nav=page.getByRole('navigation',{name:width>=1024?'Desktop main navigation':'Main navigation',exact:true});
  for(const [label,key] of [['Today','today'],['Homeguard','home'],['Explore','act'],['My Week','plan']]){
    await nav.getByRole('link',{name:label,exact:true}).click();
    await expect(page).toHaveURL(new RegExp(`tab=${key}(?:&|$)`));
    await expect(page.locator('.halo-f-header h1')).toHaveText(label);
    await page.waitForLoadState('networkidle');
  }
  const evidence=info.outputPath(`preview-network-${width}.json`);
  await writeFile(evidence,JSON.stringify(requests,null,2));
  await info.attach(`preview-network-${width}`,{path:evidence,contentType:'application/json'});
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.filter(request=>request.path.startsWith('/api/')||/^\/auth(?:\/|$)/.test(request.path))).toEqual([]);
  expect(requests.filter(request=>!['127.0.0.1','localhost'].includes(request.host))).toEqual([]);
  expect(errors).toEqual([]);
});
