import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadFrontend} from './frontend-test-loader.mjs';
const {validProductionRecord,validProductionCollection}=await loadFrontend('production/home-records');
const {validAccountSnapshot,validAccountReceipt,safeAuthorizationUrl,pushApplicationKey}=await loadFrontend('production/account-service');
const {validRecoveryStatus}=await loadFrontend('production/recovery-service');
const {validSummarySnapshot,validSummaryReceipt,validSummaryList}=await loadFrontend('production/summary-service');
const {emptyTest,emptyResult}=await loadFrontend('home-test-preview');
const owned={...emptyTest('owned-report'),title:'Owned report',contextId:'home-a',revision:3};
const recovery={feature:'recovery',revision:2,enabled:true,unresolvedOperations:[],recovery:{method:null,challenge:null,devices:[]}};
const email={feature:'email',revision:2,enabled:true,unresolvedOperations:[],connection:{status:'disconnected',maskedAccount:null,scopes:[],authorization:null}};
test('all sixteen private collections reject base-only or malformed nested records',()=>{
 const names=['tests','assets','observations','gardens','usage','pantryItems','foodQuestions','fishNotes','foodFollows','growerInquiries','homeTransitions','exploreNotes','exploreOutcomes','exploreProjects','exploreEngagements','weekJournal'];
 for(const key of names){assert.equal(validProductionCollection(key,[]),true,key);assert.equal(validProductionRecord(key,{id:'x',title:'x',revision:1}),false,key);assert.equal(validProductionCollection(key,[null]),false,key);}
 assert.equal(validProductionRecord('unknown',owned),false);
 assert.equal(validProductionCollection('tests',[owned]),true);
 assert.equal(validProductionCollection('tests',[owned,owned]),false);
 for(const patch of [{rows:undefined},{rows:[{}]},{history:[{}]},{contextId:''},{revision:0},{plannedDate:'2026-02-30'},{attachments:[{id:'unverified-file'}]}])assert.equal(validProductionRecord('tests',{...owned,...patch}),false,JSON.stringify(patch));
 assert.equal(validProductionRecord('tests',{...owned,rows:[{...emptyResult(),qualifier:'zero',originalValue:'0'}]}),true,'zero remains original reported evidence, not missing data');
});
test('private photos require sanitized references and cannot accept inline originals',()=>{
 const note={id:'n',title:'My observation',revision:1,kind:'Air',timezone:'America/New_York',place:'Public path',description:'Observed haze',reference:'',observedAt:'2026-10-13T12:00:00Z',status:'draft'};
 assert.equal(validProductionRecord('exploreNotes',note),true);
 assert.equal(validProductionRecord('exploreNotes',{...note,photo:{data:'data:image/jpeg;base64,secret'}}),false);
 assert.equal(validProductionRecord('exploreNotes',{...note,photoAttachment:{id:'photo',revision:1,name:'Private photo.png',metadataRemoved:true}}),true);
 assert.equal(validProductionRecord('exploreNotes',{...note,photoAttachment:{id:'photo',revision:1,name:'Camera original.jpg',metadataRemoved:false}}),false);
 const observation={id:'o',title:'Window observation',revision:1,homeContextId:'home-a',timezone:'America/New_York',room:'Kitchen',reading:'',unit:'',source:'Observed',note:'',photoName:'',assetId:'',testId:'',kind:'condensation',observedAt:'2026-10-13T12:00:00Z',photoData:''};
 assert.equal(validProductionRecord('observations',observation),true);
 assert.equal(validProductionRecord('observations',{...observation,homeContextId:undefined}),false);
 assert.equal(validProductionRecord('observations',{...observation,photoAttachmentId:'p'}),false);
});
test('production projects cannot substitute a static guide for a generated guide snapshot',()=>{
 const project={id:'project',title:'Pollinator garden',revision:1,goal:'Grow native plants',outcome:'',reviewDate:'',status:'Active',stepNotes:{},history:[]};
 assert.equal(validProductionRecord('exploreProjects',project),false);
 assert.equal(validProductionRecord('exploreProjects',{...project,guideId:'native',guideVersion:'1',guide:{steps:[]}}),false);
});
test('account snapshots keep server verification, pending operations and feature identity explicit',()=>{
 assert.equal(validAccountSnapshot(recovery,'recovery'),true);
 assert.equal(validAccountSnapshot(recovery,'email'),false);
 assert.equal(validAccountSnapshot({...recovery,unresolvedOperations:undefined}),false);
 assert.equal(validAccountSnapshot({...recovery,recovery:{...recovery.recovery,method:{id:'r',maskedAddress:'m***@example.com'}}}),false);
 assert.equal(validAccountReceipt({operationId:'op',status:'succeeded',snapshot:recovery},'op','recovery'),true);
 assert.equal(validAccountReceipt({operationId:'another',status:'succeeded',snapshot:recovery},'op','recovery'),false);
 assert.equal(validAccountReceipt({operationId:'op',status:'succeeded'},'op','recovery'),false);
 assert.equal(validAccountSnapshot({...recovery,feature:'device',device:{registration:null,vapidPublicKey:null}},'device'),true);
});
test('provider authorization requires an explicit Google OAuth URL and valid browser push key',()=>{
 const url='https://accounts.google.com/o/oauth2/v2/auth?client_id=public-client&state=opaque';
 assert.equal(safeAuthorizationUrl(url),true);
 for(const candidate of ['javascript:alert(1)','http://accounts.google.com/o/oauth2/auth?state=x&client_id=y','https://accounts.google.com.evil.test/o/oauth2/auth?state=x&client_id=y','https://accounts.google.com/o/oauth2/auth?client_id=y','https://token@accounts.google.com/o/oauth2/auth?state=x&client_id=y'])assert.equal(safeAuthorizationUrl(candidate),false);
 assert.equal(validAccountSnapshot({...email,connection:{...email.connection,authorization:{url,expiresAt:'2026-10-13T13:00:00Z',requestId:'op'}}},'email'),true);
 assert.equal(pushApplicationKey(Buffer.alloc(65,1).toString('base64url')).length,65);
 assert.throws(()=>pushApplicationKey('AAAA'));
});
test('recovery accepts only the original operation and requires verifiable proof before restored state',()=>{
 const pending={operationId:'op',status:'pending',challengeId:'challenge',expiresAt:'2026-10-13T13:00:00Z'};
 assert.equal(validRecoveryStatus(pending,'op'),true);
 assert.equal(validRecoveryStatus(pending,'another'),false);
 assert.equal(validRecoveryStatus({...pending,status:'verified'},'op'),false);
 assert.equal(validRecoveryStatus({...pending,status:'verified',restoreToken:'one-time-proof'},'op'),true);
 assert.equal(validRecoveryStatus({...pending,status:'verified',session:{identityId:'account',accessToken:'signed',refreshToken:'opaque'}},'op'),true);
 assert.equal(validRecoveryStatus({...pending,status:'verified',session:{identityId:'account',accessToken:'',refreshToken:'opaque'}},'op'),false);
 const source=readFileSync(new URL('../components/production/ProductionRestoreAccessFlow.tsx',import.meta.url),'utf8');
 assert.match(source,/getUser\(credentials.accessToken\)/);
 assert.match(source,/confirmAccountSwitch:true/);
 assert.match(source,/clientNonce:nonce.current/);
 assert.doesNotMatch(source,/localStorage|sessionStorage|console\./);
});
test('summary requires a complete immutable report and source manifest, not a client success flag',()=>{
 const report={id:'archive-1',revision:1,title:'Home summary',createdAt:'2026-10-13T12:00:00Z',homeContextId:'home-a',report:{title:'Home summary',generated:'2026-10-13',introduction:[],sections:[{title:'Tests',lines:['No result supplied.']}]},selection:{purpose:'Keep records',start:'2026-10-01',end:'2026-10-13',sections:{scores:false,factors:false,tests:true,actions:false,maintenance:false,observations:false,gardens:false},categories:false,location:false,notes:false,attachments:false,appendix:false,excluded:[]},manifest:[{kind:'tests',id:owned.id,revision:owned.revision,asOf:null}],omissions:[]};
 assert.equal(validSummarySnapshot(report),true);
 assert.equal(validSummaryList({items:[report],complete:true,unresolvedOperations:[]}),true);
 assert.equal(validSummarySnapshot({...report,report:{...report.report,sections:[{}]}}),false);
 assert.equal(validSummarySnapshot({...report,manifest:[{}]}),false);
 assert.equal(validSummaryReceipt({operationId:'op',status:'succeeded',snapshot:report},'op'),true);
 assert.equal(validSummaryReceipt({operationId:'op',status:'succeeded'},'op'),false);
 assert.equal(validSummaryList({items:[],complete:true}),false);
});
test('confirmation and uploads retain uncertain outcomes and captured revisions',()=>{
 const ui=readFileSync(new URL('../components/homeguard/HomeWorkspaceUI.tsx',import.meta.url),'utf8'),state=readFileSync(new URL('../components/homeguard/HomeWorkspaceState.tsx',import.meta.url),'utf8'),attachments=readFileSync(new URL('../components/homeguard/PrivateAttachments.tsx',import.meta.url),'utf8');
 assert.match(ui,/capturedRevision !== revisionKey/);assert.match(ui,/Check save status/);assert.match(ui,/confirming.deletion.remove/);
 assert.match(state,/current.revision !== expectedRevision/);assert.match(state,/resolvedOperations.current.has/);
 assert.match(attachments,/trackPendingOperation\(id, 'attachments'\)/);assert.match(attachments,/reconcile\(id, controller.signal, 'attachments'\)/);
});
