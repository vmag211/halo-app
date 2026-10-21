/** Read-only Git/source analysis. Does not execute routes or contact providers. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:20*1024*1024}).trim();
const root=process.cwd(),out=path.resolve(root,'tmp/frontend-wiring-closeout');
fs.mkdirSync(out,{recursive:true});
const registry=fs.readFileSync('lib/frontend/production/runtime.ts','utf8');
const operations=[...registry.matchAll(/'([^']+)':\s*\{path:'([^']+)'(?:,method:'([^']+)')?(?:,public:(true))?\}/g)].map(([,name,url,method,publicAccess])=>({name,path:url,method:method??'GET',public:publicAccess==='true'}));
if(operations.length!==72)throw new Error('Operation count changed. Review the registry and this audit.');
const files=git('ls-files','-z').split('\0').filter(f=>/^(app|components|lib\/frontend)\/.+\.(tsx?|jsx?)$/.test(f));
const registered=new Set(operations.map(o=>o.name)),unknown=[],dynamic=[],uses=new Map();
for(const file of files){
 const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
 function visit(n){
  if(ts.isStringLiteralLike(n)&&registered.has(n.text)&&file!=='lib/frontend/production/runtime.ts')uses.set(n.text,[...(uses.get(n.text)??[]),file]);
  if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='request'){
   const arg=n.arguments[0];
   if(arg&&ts.isStringLiteralLike(arg)&&/^[a-zA-Z]+\./.test(arg.text)&&!registered.has(arg.text))unknown.push({file,operation:arg.text});
   else if(arg&&!ts.isStringLiteralLike(arg))dynamic.push({file,line:source.getLineAndCharacterOfPosition(n.pos).line+1,expression:arg.getText(source)});
  }
  ts.forEachChild(n,visit);
 }visit(source);
}
function routes(ref){return git('ls-tree','-r','--name-only',ref,'--','app/api').split('\n').filter(f=>/\/route\.[jt]s$/.test(f)).map(file=>{
 const source=git('show',`${ref}:${file}`);
 const methods=[...source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PATCH|DELETE|PUT|HEAD|OPTIONS)\b/g)].map(m=>m[1]);
 return {file,path:file.replace(/^app/,'').replace(/\/route\.[jt]s$/,''),methods};
});}
const refs={frontendBase:git('rev-parse','HEAD'),main:git('rev-parse','origin/main'),backend:git('rev-parse','origin/vmag211/backend')};
const main=routes('origin/main'),backend=routes('origin/vmag211/backend');
const table=operations.map(o=>({...o,usedIn:[...new Set(uses.get(o.name)??[])],mainRouteExists:main.some(r=>r.path===o.path&&r.methods.includes(o.method)),backendRouteExists:backend.some(r=>r.path===o.path&&r.methods.includes(o.method))}));
const handoff=fs.readFileSync('docs/product/HALO_COMPLETE_BACKEND_HANDOFF.md','utf8');
const coverage=JSON.parse(fs.readFileSync('docs/product/ai/HALO_BACKEND_SOURCE_COVERAGE.json','utf8'));
const working=fs.readFileSync('docs/product/ai/HALO_BACKEND_WORKING_SPEC.md','utf8');
const featureIds=['G01',...['T','H','F','A','M','P','X'].flatMap((p,i)=>Array.from({length:[6,8,6,6,5,6,7][i]},(_,n)=>p+String(n+1).padStart(2,'0')))];
const missingFeatures=featureIds.filter(id=>!new RegExp('^\\| '+id+' \\|','m').test(handoff));
const blocks=coverage.blocks.filter(b=>!['heading','table_schema'].includes(b.kind));
const missingRequirementIds=blocks.filter(b=>!working.includes(`**${b.id}**`)).map(b=>b.id);
const result={refs,operations:table,dynamicRequests:dynamic,unknownOperations:unknown,featureCount:featureIds.length,missingFeatures,requirementCount:blocks.length,missingRequirementIds,mainRoutes:main,backendRoutes:backend,backendChangesSincePriorAudit:git('diff','--name-only','fb4cadf7606577c928f010490c2857cac1d93419',refs.backend),limits:'A matching path/method is not contract compatibility, deployed availability, or authorization. Dynamic calls require manual review.'};
fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify(result,null,2)+'\n');
const md=['# Current frontend operation and backend route audit','',`Main: \`${refs.main}\`. Backend: \`${refs.backend}\`. Frontend base: \`${refs.frontendBase}\`.`, '',result.limits,'','| Operation | Method / route | Public | main path | backend path |','| --- | --- | --- | --- | --- |',...table.map(o=>`| ${o.name} | ${o.method} ${o.path} | ${o.public?'Yes':'No'} | ${o.mainRouteExists?'Exists; validate contract':'Missing'} | ${o.backendRouteExists?'Exists; validate contract':'Missing'} |`),'','## Dynamic dispatch reviewed separately','',...dynamic.map(d=>`- ${d.file}:${d.line}: \`${d.expression}\``),'','## Coverage','',`${featureIds.length} feature IDs; ${blocks.length} named baseline requirements; ${unknown.length} unregistered literal operations; ${missingFeatures.length} missing feature IDs; ${missingRequirementIds.length} missing requirement IDs.`];
fs.writeFileSync(path.join(out,'operations.md'),md.join('\n')+'\n');
console.log(JSON.stringify({operations:table.length,mainRoutes:main.length,backendRoutes:backend.length,matchingBackendOperations:table.filter(x=>x.backendRouteExists).length,featureCount:featureIds.length,requirementCount:blocks.length,unknown,missingFeatures,missingRequirementIds,dynamic},null,2));
if(unknown.length||missingFeatures.length||missingRequirementIds.length)process.exitCode=1;
