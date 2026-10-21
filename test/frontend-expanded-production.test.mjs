import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadFrontend} from './frontend-test-loader.mjs';
const actions=await loadFrontend('production/action-service');
const explore=await loadFrontend('production/explore-service');
const luna=await loadFrontend('production/luna-service');
const outreach=await loadFrontend('production/outreach-service');
const activity=await loadFrontend('week-activity');
const {emptyWeekMeta}=await loadFrontend('week-preview');
const {projectGuides}=await loadFrontend('explore-project-guides');
const {defaultProjectConstraints}=await loadFrontend('explore-personalization');
const {communityOpportunities}=await loadFrontend('explore-opportunities');
const action={id:'task1',key:'owned:1',title:'Keep my water report',date:'2026-10-13',state:'saved',origin:'Homeguard',reason:'Review my own record',revision:2};
const meta=()=>structuredClone(emptyWeekMeta);
const snapshot=()=>({actions:[structuredClone(action)],metas:{[action.key]:meta()},unresolvedOperations:[]});
const guide={...structuredClone(projectGuides[0]),id:'generated-1',steps:projectGuides[0].steps.map((step,index)=>({...step,id:`stable-${index}`}))};
const suggestion={id:guide.id,title:guide.title,reason:'Matches chosen yard space',tags:['Garden'],evidenceIds:[],sourceIds:[guide.sources[0].id],needsCheck:[],fit:'general'};
const generation=()=>({id:'generation1',status:'completed',contextKey:'person:home:1',batch:{request:'Native plants',constraints:defaultProjectConstraints,items:[suggestion],contextKey:'person:home:1',generation:1},guides:[structuredClone(guide)],evidence:[]});

test('action snapshots reject duplicate identities, bad revisions and unattached metadata',()=>{
 assert.equal(actions.validActionSnapshot(snapshot()),true);
 for(const value of [{...snapshot(),actions:[action,action]},{...snapshot(),actions:[{...action,revision:0}]},{...snapshot(),metas:{other:meta()}},{...snapshot(),unresolvedOperations:['op','op']}])assert.equal(actions.validActionSnapshot(value),false);
});
test('action metadata validates clock gaps, durations, recurrence and real dates',()=>{
 for(const value of [{...meta(),duration:NaN},{...meta(),duration:0},{...meta(),zone:'bad/zone'},{...meta(),recurrence:'daily'},{...meta(),completedOn:'2026-02-30'}])assert.ok(actions.actionMetadataError(value,action));
 assert.ok(actions.actionMetadataError({...meta(),time:'02:30'},{...action,date:'2026-03-08'}));
 assert.equal(actions.actionMetadataError(meta(),action),null);
});

test('canonical preferences reject malformed values and unrelated private draft namespaces',()=>{
 const preferences={'week:focus':'owned:1','week:availability':{'2026-10-12':120},'food-interests':['gardens','water'],'week:review-preferences':{enabled:true,weekday:1,time:'17:00',zone:'America/New_York'},'week:season-dismissals':['autumn:2026']};
 assert.equal(actions.validActionPreferences(preferences),true);
 assert.equal(actions.validActionSnapshot({...snapshot(),preferences}),true);
 for(const invalid of [{'food-interests':'all'},{'food-interests':['water','water']},{'week:availability':{'2026-02-30':60}},{'week:review-preferences':{enabled:'yes',weekday:7,time:'25:00',zone:'unknown'}},{'luna:production-request':{id:'injected'}}])assert.equal(actions.validActionSnapshot({...snapshot(),preferences:invalid}),false);
 assert.ok(actions.actionMetadataError({...meta(),paused:'false'},action));
});
test('task and metadata revision reviews apply atomically or leave original unchanged',()=>{
 const before=snapshot(),change={kind:'revise',changes:[{id:action.id,revision:2,patch:{title:'Reviewed report',date:action.date,state:'completed'}}],metadata:{[action.key]:{...meta(),completedOn:'2026-10-13'}},expectedMetadata:{[action.key]:JSON.stringify(meta())}};
 const after=actions.applyReviewActionCommand(before,change,()=> 'new');
 assert.equal(after.actions[0].revision,3);assert.equal(after.metas[action.key].completedOn,'2026-10-13');assert.equal(before.actions[0].state,'saved');
 assert.equal(actions.applyReviewActionCommand(before,{...change,expectedMetadata:{[action.key]:'changed'}},()=> 'new'),null);
 assert.equal(actions.applyReviewActionCommand(before,{...change,metadata:{[action.key]:{...meta(),duration:-1}}},()=> 'new'),null);
});
test('duplicate bundle saves retain owned schedule and metadata, deletes remove metadata',()=>{
 const before=snapshot();const after=actions.applyReviewActionCommand(before,{kind:'add',seeds:[action],date:'2027-01-01',metadata:{[action.key]:{...meta(),note:'replacement'}}},()=> 'new');
 assert.deepEqual(after.actions,before.actions);assert.deepEqual(after.metas,before.metas);
 const removed=actions.applyReviewActionCommand(before,{kind:'delete',id:action.id,revision:2},()=> 'new');assert.deepEqual(removed.actions,[]);assert.deepEqual(removed.metas,{});
 assert.equal(actions.applyReviewActionCommand(before,{kind:'delete',id:action.id,revision:1},()=> 'new'),null);
});

test('sequential action commands retain earlier schedules and supplied estimates',()=>{
 let value={actions:[],metas:{}};let identity=0;
 for(const [key,date,time,duration] of [['design','2026-10-13','09:00',45],['assembly','','',30],['community','2026-10-17','10:00',60]])value=actions.applyReviewActionCommand(value,{kind:'add',seeds:[{key,title:key,origin:'Explore',reason:'Explicit review example'}],date,metadata:{[key]:{...meta(),time,duration,estimateSet:true}}},()=>String(++identity));
 assert.equal(value.actions.length,3);assert.equal(value.metas.design.time,'09:00');assert.equal(value.metas.design.duration,45);assert.equal(value.metas.assembly.estimateSet,true);assert.equal(value.metas.assembly.duration,30);assert.equal(value.metas.community.time,'10:00');
});
test('success requires the actual action result, not just a valid unrelated snapshot',()=>{
 const before=snapshot(),command={kind:'revise',changes:[{id:action.id,revision:2,patch:{title:'Updated',date:action.date,state:'saved'}}]};
 assert.equal(actions.actionReceiptCoversCommand(command,before,{operationId:'op',status:'succeeded',snapshot:before}),false);
 const after=actions.applyReviewActionCommand(before,command,()=> 'new');assert.equal(actions.actionReceiptCoversCommand(command,before,{operationId:'op',status:'succeeded',snapshot:after}),true);
 assert.equal(actions.actionReceiptCoversCommand(command,before,{operationId:'op',status:'unknown',snapshot:after}),false);
});
test('generated guides require stable steps and real source-backed instructions',()=>{
 assert.equal(explore.validProjectGuide(guide),true);
 for(const value of [{...guide,steps:guide.steps.map(step=>({...step,id:''}))},{...guide,steps:[guide.steps[0],guide.steps[0]]},{...guide,steps:[{...guide.steps[0],instructions:[]}]},{...guide,steps:[{...guide.steps[0],sourceIds:['not-a-source']}]},{...guide,sources:[{...guide.sources[0],url:'javascript:alert(1)'}]}])assert.equal(explore.validProjectGuide(value),false);
});
test('generation batches bind context, source/evidence IDs and bounded real preferences',()=>{
 assert.equal(explore.validProjectGeneration(generation()),true);
 const bad=structuredClone(generation());bad.batch.contextKey='another-home';assert.equal(explore.validProjectGeneration(bad),false);
 for(const replacement of [{...suggestion,evidenceIds:['missing']},{...suggestion,sourceIds:['missing']}]){const value=generation();value.batch.items=[replacement];assert.equal(explore.validProjectGeneration(value),false);}
 assert.equal(explore.validProjectConstraints({...defaultProjectConstraints,count:'12'}),false);
 assert.equal(explore.validProjectConstraints({...defaultProjectConstraints,count:100}),false);
});
test('production projects follow immutable guide snapshots and stable step IDs, not array-index fixtures',()=>{
 const record={id:'instance1',revision:3,title:guide.title,status:'Active',goal:guide.purpose,stepNotes:{},outcome:'',reviewDate:'',history:[],guideId:guide.id,guideVersion:guide.version,guide};
 const key=`explore:project:${record.id}:step:${guide.steps[0].id}`;const stepAction={...action,key,state:'completed'};
 const progress=activity.projectStepProgress(guide,[stepAction],record);assert.equal(progress.completed,1);assert.equal(progress.nextStep,1);
 const detail=activity.resolveWeekActivity(stepAction,{exploreProjects:[record]},[stepAction]);assert.equal(detail.project.id,record.id);assert.equal(detail.recordHref.id,record.id);assert.equal(detail.stepIndex,0);
 assert.equal(activity.ownedProjectGuide({...record,guideVersion:'different'}),undefined);
 assert.equal(activity.resolveWeekActivity({...stepAction,key:'explore:project:instance1:step:0'},{exploreProjects:[record]},[]).missingRecord,true);
});
test('opportunities need source links, valid dated intervals and explicit pagination coverage',()=>{
 const row=structuredClone(communityOpportunities[0]);assert.equal(explore.validOpportunity(row),true);
 for(const invalid of [{...row,endsAt:row.startsAt},{...row,endsAt:undefined},{...row,url:'http://example.org'},{...row,checkedAt:'not a date'}])assert.equal(explore.validOpportunity(invalid),false);
 const value={items:[row],areaLabel:'Charlotte',checkedAt:'2026-10-13',availability:'ready',complete:true,nextCursor:null};assert.equal(explore.validOpportunityResults(value),true);assert.equal(explore.validOpportunityResults({...value,items:[row,row]}),false);
});
test('Luna accepts typed app navigation only and refuses source URL injection',()=>{
 assert.equal(luna.validLunaNavigation({label:'Open project',tab:'act',destination:'projects',record:'instance-1',view:'detail'}),true);
 for(const value of [{label:'Open',tab:'https://evil.test'},{label:'Open',tab:'act',destination:'../settings'},{label:'Open',tab:'act',record:'x&homeId=another'}])assert.equal(luna.validLunaNavigation(value),false);
 const conversation={id:'conv',revision:1,messages:[{id:'m1',role:'assistant',text:'Here is a source',sources:[{title:'Source',url:'https://epa.gov'}]}]};assert.equal(luna.validLunaConversation(conversation),true);
 assert.equal(luna.validLunaConversation({...conversation,messages:[{...conversation.messages[0],sources:[{title:'Source',url:'javascript:run()'}]}]}),false);
});
test('Luna reviews require revisions, expiry, exact changes and canonical completed run',()=>{
 const proposal={id:'proposal',revision:3,title:'Remove task',summary:'The selected task only',destructive:true,expiresAt:'2026-10-14T12:00:00Z',status:'review',changes:[{label:'Task',before:'Saved',after:'Removed'}]};
 assert.equal(luna.validLunaProposal(proposal),true);assert.equal(luna.validLunaProposal({...proposal,revision:0}),false);assert.equal(luna.validLunaProposal({...proposal,expiresAt:'tomorrow'}),false);
 assert.equal(luna.validLunaRun({id:'run',status:'completed'}),false);
 assert.equal(luna.validLunaConversation({id:'conv',revision:1,messages:[],pendingRequest:{id:'request',runId:'run',text:'Help'},unresolvedOperations:{proposal:'operation'}}),true);
});
test('outreach rejects header injection and connection without a real sender',()=>{
 assert.equal(outreach.validEmail('office@example.org'),true);assert.equal(outreach.validEmail('office@example.org\r\nBcc: x@example.org'),false);
 assert.equal(outreach.validOutreachConnection({connected:true,sender:null,revision:1}),false);
 assert.equal(outreach.validOutreachConnection({connected:false,sender:null,revision:1}),true);
 const review={id:'review',revision:2,expiresAt:'2026-10-14T12:00:00Z',from:'me@example.org',to:'office@example.org',subject:'Water information',body:'Please share the source.',signature:'exact'};
 assert.equal(outreach.validOutreachReview(review),true);assert.equal(outreach.validOutreachReview({...review,subject:'Question\r\nBcc: other'}),false);
});
test('Gmail authorization is deliberate provider navigation, never an arbitrary backend URL',()=>{
 assert.equal(outreach.validGoogleAuthorization({authorizationUrl:'https://accounts.google.com/o/oauth2/v2/auth?state=nonce'}),true);
 for(const url of ['https://evil.example/oauth?state=nonce','javascript:alert(1)','https://accounts.google.com.evil.example/o/oauth2/auth?state=nonce','https://user:password@accounts.google.com/o/oauth2/auth?state=nonce','https://accounts.google.com/o/oauth2/auth'])assert.equal(outreach.validGoogleAuthorization({authorizationUrl:url}),false);
});
test('outreach history keeps unknown and queued attempts separate from provider submission',()=>{
 const attempt={id:'send1',status:'unknown',from:'me@example.org',to:'office@example.org',subject:'Question',body:'Hello',createdAt:'2026-10-13T12:00:00Z'};
 assert.equal(outreach.validOutreachHistory({attempts:[attempt],complete:true}),true);
 assert.equal(outreach.validOutreachHistory({attempts:[attempt,attempt],complete:true}),false);
 assert.equal(outreach.validOutreachAttempt({...attempt,status:'delivered'}),false);
});
test('production interactive branches do not import example response catalogs or browser credentials',()=>{
 for(const file of ['ProductionLunaConversation.tsx','ProductionProjectGeneration.tsx','ProductionOutreach.tsx']){const source=readFileSync(new URL(`../components/expanded/${file}`,import.meta.url),'utf8');assert.doesNotMatch(source,/createProjectGeneration\(|communityOpportunities|initialFieldNotes|localStorage|sessionStorage|NEXT_PUBLIC_.*(?:KEY|SECRET)/);}
});
