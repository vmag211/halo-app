/**
 * The Homeguard workspace's row rules on the server (B11 plan, Ruling W12).
 *
 * THE CLIENT'S OWN RULES, TRANSCRIBED. Every function below is a JavaScript
 * transcription, types stripped and nothing else changed, of the frontend in
 * this tree (F:). The server runs them because the provider discards a whole
 * collection for one row it does not accept (HomeWorkspaceState.tsx:107), so
 * anything stored must pass exactly the check the client will run on it. Do
 * not "fix" them: a stricter or looser rule here is a disagreement with the
 * screen. test/workspaceRecords.test.mjs runs this copy and the client's own
 * compiled module over one corpus and fails on any difference (the drift
 * test).
 *
 * Two edits only, neither changing a result: the type-only imports are gone,
 * and the helpers of explore-service.ts that home-records.ts imports are
 * renamed with a `guide` prefix where they would clash with home-records.ts's
 * own helpers of the same name (`object`, `text`, `strings`, `member`).
 */

// ---------------------------------------------------------------------------
// F: lib/frontend/production/explore-service.ts:8-12, 17-28
// ---------------------------------------------------------------------------
const guideObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const guideText = (value, max = 10000) => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const guideStrings = (value, max = 100) => Array.isArray(value) && value.length <= max && value.every(item => guideText(item));
export function safeSourceUrl(value) { if (!guideText(value, 3000)) return false; try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } }
const guideMember = (value, values) => typeof value === 'string' && values.includes(value);
export function validProjectGuide(value) {
  if (!guideObject(value) || !['id','version','title','description','purpose','effort','cost','scope','suitability','completion','followup'].every(key => guideText(value[key]) && value[key] !== '') || !guideMember(value.cause,['Water','Habitats','Community','Energy','Air']) || !guideMember(value.scene,['river','trail','garden','bee','tree','soil','water','compost','food','moisture','solar','cleanup']) || !guideMember(value.icon,['plant','bee','cleanup','sun','water','air']) || !guideStrings(value.materials) || !guideStrings(value.constraints) || !value.constraints.length) return false;
  if (!Array.isArray(value.sources) || !value.sources.length || value.sources.length > 40 || !value.sources.every(source => guideObject(source) && ['id','title','publisher','checked'].every(key => guideText(source[key]) && source[key] !== '') && safeSourceUrl(source.url))) return false;
  const sources = new Set(value.sources.map(source => source.id));
  if (!Array.isArray(value.steps) || !value.steps.length || value.steps.length > 100 || !value.steps.every(step => guideObject(step) && guideText(step.id,200) && step.id && guideText(step.title,500) && guideStrings(step.instructions,40) && step.instructions.length && guideText(step.checkpoint) && guideStrings(step.sourceIds,40) && step.sourceIds.length && step.sourceIds.every(id => sources.has(id))) || new Set(value.steps.map(step => step.id)).size !== value.steps.length) return false;
  if (value.buildPlan !== undefined) {
    const plan=value.buildPlan;
    if (!guideObject(plan) || !guideText(plan.title) || !guideText(plan.note) || !guideText(plan.sourceId) || !sources.has(plan.sourceId) || !guideStrings(plan.assembly) || !Array.isArray(plan.parts) || plan.parts.length>100 || !plan.parts.every(part => guideObject(part) && guideText(part.name) && guideText(part.size) && typeof part.quantity === 'number' && Number.isFinite(part.quantity) && part.quantity>0)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// F: lib/frontend/production/home-service.ts:57-64, 66-68
// ---------------------------------------------------------------------------
export function validHomeRecords(value) {
  if (!Array.isArray(value)) return false;
  const ids = new Set();
  return value.every(item => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || typeof item.title !== 'string' || !Number.isSafeInteger(item.revision) || item.revision < 1 || ids.has(item.id)) return false;
    ids.add(item.id); return true;
  });
}

export function validHomeChanges(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(([key, rows]) => /^[a-zA-Z][a-zA-Z0-9]{0,79}$/.test(key) && validHomeRecords(rows)));
}

// ---------------------------------------------------------------------------
// F: lib/frontend/production/home-records.ts:3-47
// ---------------------------------------------------------------------------
const object=(v)=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v)=>typeof v==='string'&&v.length<=30000;
const fields=(v,keys)=>keys.every(key=>text(v[key]));
const member=(v,values)=>typeof v==='string'&&values.includes(v);
const revision=(v)=>Number.isSafeInteger(v)&&Number(v)>0;
const array=(v,validate,max=2000)=>Array.isArray(v)&&v.length<=max&&v.every(validate);
const strings=(v)=>array(v,text);
const optional=(v,validate)=>v===undefined||validate(v);
const day=(v)=>typeof v==='string'&&(v===''||/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v);
const instant=(v)=>typeof v==='string'&&(v===''||Number.isFinite(Date.parse(v)));
const bool=(v)=>typeof v==='boolean';
const base=(v)=>object(v)&&fields(v,['id','title'])&&Boolean(v.id)&&revision(v.revision);
const context=(v)=>typeof v.homeContextId==='string'&&!!v.homeContextId;
const review=(v)=>member(v,['not_received','unreviewed','needs_clarification','user_confirmed']);
const result=(v)=>object(v)&&fields(v,['id','analyte','originalValue','originalUnit','limit','limitUnit','basis','reportReference'])&&day(v.reportDate)&&member(v.qualifier,['measured','less_than','non_detect','zero','absent','unknown']);
const attachment=(v)=>object(v)&&fields(v,['id','name','mime'])&&revision(v.revision)&&Number.isSafeInteger(v.bytes)&&Number(v.bytes)>0&&member(v.status,['quarantined','ready','rejected'])&&bool(v.metadataRemoved);
const evidence=(v)=>object(v)&&fields(v,['recordId','title','layer','scope'])&&(v.observedAt===null||instant(v.observedAt));
const handoff=(v)=>object(v)&&fields(v,['id','preparedAt','body'])&&revision(v.sourceRevision)&&object(v.scope)&&bool(v.scope.place)&&bool(v.scope.evidence)&&v.scope.photo===false&&optional(v.exports,x=>array(x,row=>object(row)&&member(row.kind,['copied','download-requested','share-completed','print-opened'])&&instant(row.at)));
const photoReference=(v)=>object(v)&&fields(v,['id','name'])&&revision(v.revision)&&v.metadataRemoved===true;
function history(v,keys,extra=()=>true){return array(v,row=>object(row)&&fields(row,keys)&&extra(row));}

/** Structural response checks preserve unknown future fields without inventing missing required fields. */
export function validProductionRecord(collection,value) {
 if(!base(value))return false;const v=value;
 if(v.homeContextId!==undefined&&!context(v))return false;
 switch(collection){
  case 'tests': return fields(v,['purpose','contextId','medium','provider','sampleLabel','method','reviewReason'])&&!!v.contextId&&member(v.kind,['water','radon','lead','soil'])&&member(v.status,['draft','arranged','sampled','awaiting','recorded','followup'])&&['plannedDate','collectionStart','collectionEnd','expectedDate'].every(key=>day(v[key]))&&array(v.rows,result,500)&&review(v.review)&&bool(v.archived)&&history(v.history,['date','reason'],row=>revision(row.revision)&&array(row.rows,result,500)&&review(row.review))&&optional(v.contextSnapshot,x=>object(x)&&text(x.label)&&optional(x.revision,revision)&&optional(x.irrigation,text))&&optional(v.attachments,x=>array(x,attachment,100))&&optional(v.arrangedByUser,bool)&&optional(v.awaitingRecorded,bool);
  case 'assets': return context(v)&&fields(v,['model','instructions','testId'])&&member(v.factor,['air','uv','pollen','mold','pfas','radon','lead'])&&member(v.basis,['user','manufacturer','reviewed'])&&member(v.policy,['calendar','completion'])&&member(v.unit,['days','months'])&&Number.isSafeInteger(v.interval)&&Number(v.interval)>0&&Number(v.interval)<=365&&member(v.status,['active','paused','replaced'])&&['installed','serviced','nextDue','calendarAnchor','endDate','lastCompleted','snoozedUntil'].every(key=>day(v[key]))&&history(v.history,['id','kind','date','due','note'],row=>day(row.date)&&day(row.due));
  case 'observations': return context(v)&&fields(v,['timezone','room','reading','unit','source','note','photoName','assetId','testId'])&&member(v.kind,['dampness','leak','condensation','humidity','other'])&&instant(v.observedAt)&&v.photoData===''&&optional(v.photoAttachmentId,text)&&optional(v.photoAttachmentRevision,revision)&&(!v.photoAttachmentId||revision(v.photoAttachmentRevision)&&v.photoMetadataRemoved===true);
  case 'gardens': return context(v)&&fields(v,['setup','county','irrigation','soil','concern','questions'])&&bool(v.householdSourceConfirmed)&&strings(v.testIds)&&history(v.history,['date','irrigation','soil'],row=>revision(row.revision)&&day(row.date));
  case 'usage': return context(v)&&fields(v,['site','meter','quantity','unit','source','note'])&&member(v.kind,['interval','meter'])&&member(v.basis,['measured','estimated','user-reported'])&&day(v.start)&&day(v.end)&&bool(v.reset)&&history(v.history,['date','quantity','unit','start','end','reason'],row=>day(row.start)&&day(row.end)&&optional(row.original,original=>object(original)&&fields(original,['site','meter','quantity','unit','start','end','source','note'])&&member(original.kind,['interval','meter'])&&bool(original.reset)));
  case 'pantryItems': return context(v)&&fields(v,['guideId','question','createdAt','updatedAt','guideRevision'])&&member(v.origin,['store','homegrown','caught','unknown'])&&instant(v.createdAt)&&instant(v.updatedAt)&&optional(v.foodId,text)&&optional(v.storage,x=>member(x,['fridge','pantry','freezer']));
  case 'foodQuestions': return fields(v,['evidenceId','question','reportId','note']);
  case 'fishNotes': return fields(v,['timezone','waterbody','species','quantity','unit','note','advisoryId'])&&day(v.date)&&member(v.kind,['catch','consumption'])&&Number.isSafeInteger(v.advisoryRevision)&&Number(v.advisoryRevision)>=0&&optional(v.history,x=>history(x,['date'],row=>revision(row.revision)&&object(row.original)&&fields(row.original,['waterbody','species','quantity','unit','note','timezone','advisoryId'])&&day(row.original.date)));
  case 'foodFollows': return fields(v,['targetId'])&&member(v.kind,['fish','food','water','resource'])&&revision(v.sourceRevision)&&bool(v.following)&&bool(v.saved);
  case 'growerInquiries': return fields(v,['resourceId','siteId','testId','questions','state','reference','response'])&&strings(v.checklist)&&day(v.contactDate)&&day(v.followUpDate);
  case 'homeTransitions': return fields(v,['previousId','area','confirmedAt','readings'])&&strings(v.portableIds)&&instant(v.confirmedAt)&&optional(v.previousProfile,x=>object(x)&&fields(x,['year','water','tenure']));
  case 'exploreNotes': return fields(v,['kind','timezone','place','description','reference'])&&instant(v.observedAt)&&member(v.status,['draft','prepared','form-opened','reported'])&&optional(v.noteType,x=>member(x,['Observation','Question','Idea','Conversation']))&&optional(v.pinned,bool)&&optional(v.archived,bool)&&optional(v.evidence,x=>array(x,evidence,100))&&v.photo===undefined&&optional(v.photoAttachment,photoReference)&&optional(v.handoff,handoff)&&optional(v.handoffHistory,x=>array(x,handoff,100));
  case 'exploreOutcomes': return fields(v,['goal','result','reference','nextStep'])&&day(v.date)&&day(v.followupDate)&&member(v.status,['Open','Working on it','Waiting for a response','Result recorded','Closed without a result'])&&history(v.history,['status','date','result'],row=>day(row.date));
  case 'exploreProjects': return fields(v,['goal','outcome','guideId','guideVersion'])&&day(v.reviewDate)&&member(v.status,['Active','Paused','Completed'])&&object(v.stepNotes)&&Object.values(v.stepNotes).every(text)&&history(v.history,['status','note'])&&validProjectGuide(v.guide)&&v.guide.id===v.guideId&&v.guide.version===v.guideVersion&&Object.keys(v.stepNotes).every(id=>v.guide && v.guide.steps.some(step=>step.id===id));
  case 'exploreEngagements': return fields(v,['organizer','cause','url','place','hours','preparation','outcome','reference'])&&(v.url===''||safeSourceUrl(v.url))&&['date','statusDate','followupDate'].every(key=>day(v[key]))&&optional(v.participatedOn,day)&&member(v.status,['Considering','Contacted','Confirmed by me','Participated','Follow-up','Closed'])&&history(v.history,['status','date','note'],row=>day(row.date));
  case 'weekJournal': return fields(v,['band','severity','note'])&&day(v.date)&&bool(v.fine)&&strings(v.symptoms)&&bool(v.illness)&&bool(v.recalled)&&(!v.fine||Array.isArray(v.symptoms)&&v.symptoms.length===0);
  default:return false;
 }
}
export function validProductionCollection(key,records){return Array.isArray(records)&&records.length<=10000&&records.every(row=>validProductionRecord(key,row))&&new Set(records.map(row=>row.id)).size===records.length;}
