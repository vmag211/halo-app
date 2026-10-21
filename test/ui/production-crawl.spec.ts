import {expect,test,type Page} from '@playwright/test';
import {mockProduction,settingsSnapshot} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';

/* Cross-cutting crawl: every product and public route at phone, tablet and desktop widths in light and
 * dark. Each visit records runtime errors, failed same-origin requests, horizontal page overflow,
 * content escaping the viewport, images without alt text and unnamed controls. Every API is intercepted. */
const appRoutes=['/app','/app/today','/app/homeguard','/app/explore','/app/settings','/app/journal',
 '/app/homeguard/tests','/app/homeguard/maintenance','/app/homeguard/food','/app/homeguard/summary',
 '/app/plan/patterns','/app/plan/recap','/app/plan/outdoors','/app/plan/reminders',
 '/app/explore/activities','/app/explore/organizations','/app/explore/projects','/app/explore/community','/app/explore/notes','/app/explore/contact',
 '/plan','/today','/home','/act','/settings','/family','/factors/air','/factors/radon','/household/adult'];
const publicRoutes=['/','/learn','/map','/operations','/onboarding','/no-such-page','/app/no-such-screen','/factors/no-such-factor'];
// Product routes stream behind loading.tsx, so an unknown screen is a soft 404: status 200 with noindex and the not-found page.
const softMissing=['/app/no-such-screen','/factors/no-such-factor'];
// Review previews are served by the same build when HALO_ENABLE_FRONTEND_PREVIEW is set.
const previewRoutes=['/foundation/preview','/foundation/preview/expanded','/foundation/preview/expanded?review=tools','/foundation/preview/map','/foundation/preview/family','/foundation/preview/factor/air','/foundation/preview/household/adult','/onboarding/preview','/dev/preview'];
const widths=[375,820,1440];
const schemes=['light','dark'] as const;

type Finding={kind:string;detail:string};
async function audit(page:Page):Promise<Finding[]>{
 return page.evaluate(()=>{
  const out:{kind:string;detail:string}[]=[];const vw=document.documentElement.clientWidth;
  if(document.documentElement.scrollWidth>vw+1)out.push({kind:'page-overflow',detail:`${document.documentElement.scrollWidth}>${vw}`});
  const label=(el:Element)=>`${el.tagName.toLowerCase()}${el.id?`#${el.id}`:''}${el.className&&typeof el.className==='string'?`.${el.className.trim().split(/\s+/).slice(0,2).join('.')}`:''}`;
  const visible=(el:Element)=>{const r=el.getBoundingClientRect();const s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const scrollsX=(el:Element|null):boolean=>{for(let n=el?.parentElement;n&&n!==document.body;n=n.parentElement){const s=getComputedStyle(n);if(['auto','scroll'].includes(s.overflowX))return true;}return false;};
  for(const el of document.querySelectorAll('body *')){
   if(!visible(el)||el.closest('[aria-hidden="true"],svg,img,picture')||!(el.textContent??'').trim()||el.children.length>0)continue;const r=el.getBoundingClientRect();
   if((r.right>vw+1||r.left<-1)&&!scrollsX(el)&&getComputedStyle(el).position!=='fixed')out.push({kind:'escapes-viewport',detail:`${label(el)} ${Math.round(r.left)}..${Math.round(r.right)}`});
  }
  // Text cut off inside its own box (no ellipsis or line clamp to signal the truncation).
  for(const el of document.querySelectorAll('body *')){
   if(el.children.length||!(el.textContent??'').trim()||!visible(el)||el.closest('[aria-hidden="true"],.sr-only,.visually-hidden'))continue;const s=getComputedStyle(el);
   if(s.position==='absolute'&&parseFloat(s.width)<=1)continue;
   const clipX=['hidden','clip'].includes(s.overflowX)&&el.scrollWidth>el.clientWidth+1&&s.textOverflow!=='ellipsis';
   const clipY=['hidden','clip'].includes(s.overflowY)&&el.scrollHeight>el.clientHeight+2&&s.webkitLineClamp==='none';
   if(clipX||clipY)out.push({kind:'clipped-text',detail:`${label(el)} "${(el.textContent??'').trim().slice(0,40)}"`});
  }
  for(const img of document.querySelectorAll('img'))if(!img.hasAttribute('alt')&&visible(img))out.push({kind:'img-no-alt',detail:img.getAttribute('src')??''});
  for(const el of document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=tab],[role=switch]')){
   if(!visible(el)||el.closest('[aria-hidden="true"],[inert]'))continue;
   const id=el.getAttribute('id');const named=(el.getAttribute('aria-label')??'').trim()||(el.getAttribute('aria-labelledby')??'').trim()||(el.textContent??'').trim()||(el.getAttribute('title')??'').trim()||[...el.querySelectorAll('img[alt]')].some(i=>i.getAttribute('alt')?.trim())||(id&&document.querySelector(`label[for="${CSS.escape(id)}"]`))||el.closest('label')||(el as HTMLInputElement).placeholder;
   if(!named)out.push({kind:'unnamed-control',detail:label(el)});
  }
  const mains=document.querySelectorAll('main').length;if(mains!==1)out.push({kind:'main-landmarks',detail:String(mains)});
  if(!document.querySelector('h1'))out.push({kind:'no-h1',detail:''});
  // Duplicate ids break label/aria references.
  const ids=new Map<string,number>();for(const el of document.querySelectorAll('[id]'))ids.set(el.id,(ids.get(el.id)??0)+1);for(const [id,n] of ids)if(n>1)out.push({kind:'duplicate-id',detail:id});
  return out;
 });
}

for(const scheme of schemes)for(const width of widths)test.describe(`${scheme} ${width}px`,()=>{
 for(const route of [...appRoutes,...publicRoutes,...previewRoutes])test(`crawl ${route}`,async({page})=>{
  const system={...settingsSnapshot,display:{...settingsSnapshot.display,appearance:'system'}};
  const network=await mockProduction(page,{'/api/settings':r=>jsonRoute(r,system)});
  await page.emulateMedia({colorScheme:scheme});await page.setViewportSize({width,height:width<500?812:width<1000?1180:900});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(`pageerror ${e.message}`));
  page.on('console',m=>{if(m.type()==='error'&&!/blockedbyclient|ERR_BLOCKED_BY_CLIENT/i.test(m.text())&&!(/no-such/.test(route)&&/status of 404/.test(m.text())))errors.push(`console ${m.text()}`);});
  page.on('response',r=>{const u=new URL(r.url());if(u.hostname==='127.0.0.1'&&!u.pathname.startsWith('/api/')&&r.status()>=400&&!(r.request().resourceType()==='document'&&/no-such/.test(u.pathname)))errors.push(`http ${r.status()} ${u.pathname}`);});
  page.on('requestfailed',r=>{const u=new URL(r.url());if(u.hostname==='127.0.0.1'&&u.port!=='54321'&&!u.pathname.startsWith('/api/')&&!/ERR_ABORTED/.test(r.failure()?.errorText??''))errors.push(`failed ${u.pathname} ${r.failure()?.errorText}`);});
  const response=await page.goto(route,{waitUntil:'load'});
  expect(response?.status()).toBe(/no-such/.test(route)&&!softMissing.includes(route)?404:200);
  if(/no-such/.test(route)){
   await expect(page.getByRole('heading',{name:'This page isn’t here'})).toBeVisible();
   // The not-found screen sits outside the product shell; its title must still read as a title.
   const sizes=await page.locator('main h1, main p').evaluateAll(nodes=>nodes.map(node=>parseFloat(getComputedStyle(node).fontSize)));
   expect(sizes[0]).toBeGreaterThan(Math.max(...sizes.slice(1)));
  }
  if(appRoutes.includes(route))await expect(page.getByTestId('production-product')).toBeVisible();
  await expect(page.locator('h1').first()).toBeAttached();
  await page.waitForLoadState('networkidle').catch(()=>undefined);
  const findings=await audit(page);
  if(process.env.SWEEP_SHOTS)await page.screenshot({path:`${process.env.SWEEP_SHOTS}/${scheme}-${width}${route.replace(/\//g,'_')}.png`,fullPage:true});
  test.info().annotations.push({type:'blocked',description:JSON.stringify(network.blocked)});
  expect({errors,findings}).toEqual({errors:[],findings:[]});
 });
});

test('every same-origin link on the main screens resolves',async({page,request})=>{
 test.setTimeout(240000);
 await mockProduction(page);await page.setViewportSize({width:1440,height:900});const hrefs=new Set<string>();
 for(const route of [...appRoutes,...publicRoutes.filter(r=>!/no-such/.test(r))]){
  await page.goto(route);await page.waitForLoadState('networkidle').catch(()=>undefined);
  for(const href of await page.locator('a[href]').evaluateAll(links=>links.map(a=>(a as HTMLAnchorElement).href)))hrefs.add(href);
 }
 const broken:string[]=[];
 for(const href of hrefs){const url=new URL(href);if(url.host!==new URL(page.url()).host||url.pathname.startsWith('/api/'))continue;
  const key=url.pathname+url.search;const response=await request.get(key);const body=await response.text();
  if(response.status()>=400||body.includes('NEXT_HTTP_ERROR_FALLBACK;404'))broken.push(`${response.status()} ${key}`);}
 expect(broken).toEqual([]);
});
