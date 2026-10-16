/** Read-only source audit. Generated reports go to a task-specific directory. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';

const root=process.cwd();
const outputIndex=process.argv.indexOf('--output');
if(outputIndex>=0&&!process.argv[outputIndex+1])throw new Error('Supply the output directory after --output.');
const out=path.resolve(root,outputIndex>=0?process.argv[outputIndex+1]:'tmp/backend-handoff-audit');
const verify=process.argv.includes('--verify');
if(!verify)fs.mkdirSync(out,{recursive:true});
const tracked=execFileSync('git',['ls-files','-z'],{encoding:'utf8',maxBuffer:20*1024*1024}).split('\0').filter(Boolean);
const normalize=s=>s.replace(/\s+/g,' ').trim();
const cell=s=>normalize(String(s)).replace(/\|/g,'\\|').replace(/`/g,"'").replace(/</g,'&lt;').replace(/>/g,'&gt;');
function domain(file){
 if(file.includes('/onboarding/')||/Onboarding|PublicBrowse|RecoveryFlowBoundary|AccountWorkflows|account-review/.test(file))return 'G01 / X04-X05';
 if(file.includes('/homeguard/')||/HomeOverview|home-|food-|household-pdf/.test(file))return 'H01-H08 / F01-F06';
 if(file.includes('/map-preview/')||/map-/.test(file))return 'M01-M05';
 if(/Luna|luna-/.test(file))return 'X02';
 if(/SourceOperations|source-operations/.test(file))return 'X07';
 if(/Settings|settings-|Account/.test(file))return 'X04-X05';
 if(/AlertCenter|Notifications|alerts-/.test(file))return 'X03';
 if(/Learn|learn-/.test(file))return 'X01';
 if(/Explore|explore-|NotePhoto|NoteHandoff|note-/.test(file))return 'A01-A06';
 if(/Week|Homepage|week-|homepage-|expanded-preview|ExpandedPreviewState/.test(file))return 'P01-P06';
 if(file.includes('/foundation/')||/factor|overview|stage/.test(file))return 'T01-T06 / H01-H05 / shared';
 return 'G01 / X01-X06 / shared';
}
function owner(node){for(let n=node;n;n=n.parent){if((ts.isFunctionDeclaration(n)||ts.isMethodDeclaration(n))&&n.name)return n.name.getText();if(ts.isVariableDeclaration(n)&&n.name)return n.name.getText();}return '(module)';}
const files=tracked.filter(f=>/^(components|app)\/.+\.(tsx|jsx)$/.test(f));
const controls=[]; const manifest=[];
for(const file of files){
 const source=fs.readFileSync(path.join(root,file),'utf8');
 const sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 manifest.push({file,sha256:crypto.createHash('sha256').update(source).digest('hex'),domain:domain(file)});
 function visit(n){
  if(ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n)){
   const tag=n.tagName.getText(sf);
   const attrs=n.attributes.properties.filter(ts.isJsxAttribute);
   const interactions=attrs.filter(a=>/^on[A-Z]/.test(a.name.getText(sf))||['href','action','download'].includes(a.name.getText(sf)));
   if(interactions.length||['button','input','select','textarea','form','summary'].includes(tag)){
    const parent=ts.isJsxElement(n.parent)?n.parent:null;
    const labelAttr=attrs.find(a=>['aria-label','title','label','name','id','placeholder'].includes(a.name.getText(sf)));
    const label=labelAttr?.initializer?.getText(sf)??(parent?normalize(parent.children.map(c=>ts.isJsxText(c)?c.getText(sf):ts.isJsxExpression(c)?c.getText(sf):'').join(' ')).slice(0,170):'');
    controls.push({id:`UI${String(controls.length+1).padStart(4,'0')}`,file,line:sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1,owner:owner(n),tag,label:normalize(label),bindings:interactions.map(a=>normalize(a.getText(sf))),domain:domain(file),reviewOnly:/ReviewControls|ReviewExamples|ConnectedExamples|ReviewToolbar/.test(owner(n)+' '+file)});
   }
  }
  ts.forEachChild(n,visit);
 }
 visit(sf);
}
const typeFiles=tracked.filter(f=>/^lib\/frontend\/.+\.ts$/.test(f)&&!f.includes('/copy/'));
const declarations=[];
const typeManifest=[];
for(const file of typeFiles){const source=fs.readFileSync(path.join(root,file),'utf8');typeManifest.push({file,sha256:crypto.createHash('sha256').update(source).digest('hex'),domain:domain(file)});const sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);for(const n of sf.statements){if((ts.isTypeAliasDeclaration(n)||ts.isInterfaceDeclaration(n))&&n.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)){declarations.push({file,line:sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1,name:n.name.getText(sf),text:n.getText(sf)});}}}
const ledger=['## Appendix A. Executable interface control ledger','',
 'Generated from tracked current components and route JSX using the TypeScript parser. Every statically declared native control and every JSX element with an event callback, navigation target, form action or download is listed. Repeated data-driven rows are represented by their source control; runtime records are covered by the corresponding domain contract. This is a traceability index, not proof that callbacks already call production services. Labels and handlers are source expressions, not replacement product copy. Review-only controls and local presentation actions are intentionally visible here so they cannot accidentally become production service requirements. Consult the named owner function for complex inline closures.','',
 `Scanned ${files.length} JSX source files; found ${controls.length} control declarations. Native browser interactions and global effects are covered by shared contracts and the source-file register.`, ''];
for(const file of files){const rows=controls.filter(c=>c.file===file);if(!rows.length)continue;ledger.push(`### ${file}`, '',`Contract family: ${domain(file)}.`, '', '| ID / line | Control / owner | Label or role expression | Callback or navigation binding |','| --- | --- | --- | --- |');for(const c of rows)ledger.push(`| ${c.id} :${c.line}${c.reviewOnly?' (review control)':''} | ${cell(c.tag)} / ${cell(c.owner)} | ${cell(c.label)||'(child/component label)'} | ${cell(c.bindings.join('; ')).slice(0,500)||'(native form/control behavior)'} |`);ledger.push('');}
const types=['## Appendix B. Existing frontend transport and domain type register','',
 'These are extracted existing frontend types, including review models. They are evidence of required fields and adapter work, not automatic approval of a production database schema or fixture defaults. Server contracts in the main document govern authority, privacy, state semantics and proposed additions. Imports/references use their original repository names. Cosmetic component types do not require network storage.',''];
for(const file of typeFiles){const rows=declarations.filter(t=>t.file===file);if(!rows.length)continue;types.push(`### ${file}`,'','```ts',rows.map(r=>`// Source line ${r.line}\n${r.text}`).join('\n\n'),'```','');}
const hashes=['## Appendix C. Audited frontend source fingerprints','','SHA-256 of the checked-out bytes at audit time. The pinned Git commits locate backend, requirements, tests and other source. Line-ending changes can alter a byte hash without a semantic change; review that difference explicitly. These hashes do not certify deployed code or include secrets.','','| Source | SHA-256 |','| --- | --- |',...[...manifest,...typeManifest].map(row=>`| ${row.file} | ${row.sha256} |`),''];
const result={version:2,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files:manifest,typeFiles:typeManifest,controls,declarations:declarations.map(({text,...row})=>row),totals:{jsxFiles:files.length,controls:controls.length,exportedTypes:declarations.length,fingerprintedFiles:manifest.length+typeManifest.length}};
if(verify){
 const doc=fs.readFileSync(path.join(root,'docs/product/HALO_COMPLETE_BACKEND_HANDOFF.md'),'utf8').replace(/\r\n/g,'\n');
 const failures=[];
 const requireCheck=(condition,message)=>{if(!condition)failures.push(message);};
 for(const [label,content] of [['control ledger',ledger],['type register',types],['source fingerprints',hashes]])requireCheck(doc.includes(content.join('\n').replace(/\r\n/g,'\n').trim()),`Embedded ${label} differs from current source inventory`);
 const featureIds=['G01',...['T','H','F','A','M','P','X'].flatMap((prefix,i)=>Array.from({length:[6,8,6,6,5,6,7][i]},(_,n)=>prefix+String(n+1).padStart(2,'0')))];
 for(const id of featureIds)requireCheck(new RegExp('^\\| '+id+' \\|','m').test(doc),`Missing feature coverage row ${id}`);
 for(let n=1;n<=25;n++)requireCheck(new RegExp('^\\| INT'+String(n).padStart(2,'0')+' \\|','m').test(doc),`Missing integration journey INT${n}`);
 requireCheck(!/<!-- AUDIT:/.test(doc),'Unassembled audit marker');
 requireCheck((doc.match(/^# /gm)||[]).length===1,'Document must have one top-level title');
 requireCheck((doc.match(/^```/gm)||[]).length%2===0,'Unbalanced code fences');
 const headingSlugs=new Set([...doc.matchAll(/^#{1,6} (.+)$/gm)].map(m=>m[1].toLowerCase().replace(/[^a-z0-9_ -]/g,'').replace(/ /g,'-')));
 for(const match of doc.matchAll(/\]\(#([^)]*)\)/g))requireCheck(headingSlugs.has(match[1]),`Missing internal heading target ${match[1]}`);
 const rows=[...doc.matchAll(/^\| (UI\d{4}) :\d+/gm)].map(m=>m[1]);
 requireCheck(rows.length===controls.length&&new Set(rows).size===controls.length,'Missing/duplicate interface IDs');
 requireCheck(doc.includes('fb4cadf7606577c928f010490c2857cac1d93419'),'Backend snapshot missing');
 requireCheck(doc.includes('f445588a34c6b8e886e17ccf649d472cf3dd24ec'),'Frontend snapshot missing');
 requireCheck(doc.includes('1,826')&&doc.includes('3 failed'),'Backend test failures must remain explicit');
 const secretPatterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\bsk-[A-Za-z0-9_-]{30,}\b/,/\bAIza[0-9A-Za-z_-]{30,}\b/,/\bgh[pousr]_[0-9A-Za-z]{30,}\b/];
 requireCheck(!secretPatterns.some(re=>re.test(doc)),'Credential-like value found; inspect before sharing');
 process.stdout.write(JSON.stringify({mode:'verify',...result.totals,featureGroups:featureIds.length,integrationJourneys:25,documentBytes:Buffer.byteLength(doc),passed:failures.length===0,failures},null,2)+'\n');
 if(failures.length)process.exitCode=1;
}else{
 fs.writeFileSync(path.join(out,'interface-ledger.md'),ledger.join('\n'));
 fs.writeFileSync(path.join(out,'type-register.md'),types.join('\n'));
 fs.writeFileSync(path.join(out,'source-register.md'),hashes.join('\n'));
 fs.writeFileSync(path.join(out,'inventory.json'),JSON.stringify(result,null,2)+'\n');
 process.stdout.write(JSON.stringify(result.totals)+'\n');
}
