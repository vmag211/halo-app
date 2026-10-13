import {sourceOperationError,type OperatorRole,type OperatorSource,type SourceAudit,type SourceDecision,type SourceRevision} from '../source-operations-preview';
export const sourceDecisions=['approve','quarantine','publish','withdraw','translation','retry','rollback','publish-translation'] as const;
export type SourceOpsDecision=typeof sourceDecisions[number];
export type SourceOpsAudit=Omit<SourceAudit,'decision'>&{decision:SourceOpsDecision};
export type SourceOpsSource=Omit<OperatorSource,'audit'>&{audit:SourceOpsAudit[];allowedDecisions:SourceOpsDecision[];publishedTranslations:{locale:'es';versionId:string}[];versionsCursor:string|null;auditCursor:string|null};
export type SourceOpsSnapshot={role:OperatorRole;revision:number;sources:SourceOpsSource[];unresolvedOperations:string[];nextCursor:string|null};
export type SourceOpsCommand={operationId:string;sourceId:string;sourceRevision:number;target:string;decision:SourceOpsDecision;reason:string;recordedAt:string;locale?:'es';snapshotRevision:number};
export type SourceOpsReceipt={operationId:string;status:'succeeded'|'failed'|'pending'|'unknown';snapshot?:SourceOpsSnapshot;message?:string};
export type SourceOpsHistory={sourceId:string;sourceRevision:number;versions:SourceRevision[];audit:SourceOpsAudit[];nextCursor:string|null;kind:'versions'|'audit'};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.length<=10000&&!v.includes('\u2014');
const fields=(v:Record<string,unknown>,names:string[])=>names.every(key=>text(v[key]));
const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.length<=1000&&v.every(text);
const number=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
const revision=(v:unknown)=>number(v)&&Number(v)>0;
const cursor=(v:unknown)=>v===null||text(v)&&!!v;
const member=(v:unknown,values:readonly string[])=>typeof v==='string'&&values.includes(v);
export function validSourceVersion(v:unknown):v is SourceRevision{return object(v)&&fields(v,['id','geography','units','observed','published','retrieved','parser','content','requiredFields','reviewer'])&&!!v.id&&number(v.count)&&strings(v.failures)&&member(v.evidence,['measured','zero','non-detect','missing','partial','invalid'])&&member(v.status,['incoming','approved','quarantined','published','superseded','withdrawn'])&&member(v.translation,['not-requested','pending','approved']);}
export function validSourceAudit(v:unknown):v is SourceOpsAudit{return object(v)&&fields(v,['requestId','target','reason','recordedAt'])&&!!v.requestId&&member(v.role,['reviewer','publisher'])&&member(v.decision,sourceDecisions)&&revision(v.revision)&&Number.isFinite(Date.parse(String(v.recordedAt)));}
export function validSource(v:unknown):v is SourceOpsSource {
 if(!object(v)||!fields(v,['id','name','owner','organization','url','terms','method','cadence','lastSuccess','nextReview','coverage'])||!v.id||!revision(v.revision)||!member(v.freshness,['current','stale'])||!member(v.link,['available','broken'])||!cursor(v.publishedId)||!cursor(v.candidateId)||!cursor(v.versionsCursor)||!cursor(v.auditCursor))return false;
 try{const url=new URL(String(v.url));if(url.protocol!=='https:'||url.username||url.password)return false;}catch{return false;}
 if(!Array.isArray(v.versions)||v.versions.length>1000||!v.versions.every(validSourceVersion)||new Set(v.versions.map(item=>item.id)).size!==v.versions.length||![v.publishedId,v.candidateId].every(id=>id===null||(v.versions as SourceRevision[]).some(row=>row.id===id)))return false;
 if(!Array.isArray(v.audit)||v.audit.length>1000||!v.audit.every(validSourceAudit)||!Array.isArray(v.allowedDecisions)||!v.allowedDecisions.every(item=>member(item,sourceDecisions)))return false;
 if(!Array.isArray(v.publishedTranslations)||!v.publishedTranslations.every(item=>object(item)&&item.locale==='es'&&text(item.versionId)))return false;
 const run=v.run;return object(run)&&fields(run,['id','parser','diagnostic','requestKey'])&&!!run.id&&member(run.state,['complete','failed'])&&number(run.rejected)&&number(run.attempts);
}
export function validSourceOpsSnapshot(v:unknown):v is SourceOpsSnapshot{return object(v)&&member(v.role,['denied','viewer','reviewer','publisher'])&&revision(v.revision)&&strings(v.unresolvedOperations)&&v.unresolvedOperations.every(Boolean)&&cursor(v.nextCursor)&&Array.isArray(v.sources)&&v.sources.length<=1000&&v.sources.every(validSource)&&new Set(v.sources.map(row=>row.id)).size===v.sources.length&&(v.role!=='denied'||v.sources.length===0&&v.nextCursor===null);}
export function validSourceOpsHistory(v:unknown):v is SourceOpsHistory{return object(v)&&text(v.sourceId)&&revision(v.sourceRevision)&&member(v.kind,['versions','audit'])&&cursor(v.nextCursor)&&Array.isArray(v.versions)&&v.versions.length<=1000&&v.versions.every(validSourceVersion)&&Array.isArray(v.audit)&&v.audit.length<=1000&&v.audit.every(validSourceAudit);}
export function sourceOpsError(source:SourceOpsSource,command:SourceOpsCommand,role:OperatorRole):string|null{
 if(!source.allowedDecisions.includes(command.decision)||!['reviewer','publisher'].includes(role)||['publish','withdraw','rollback','publish-translation'].includes(command.decision)&&role!=='publisher')return 'Your verified role cannot make this decision.';
 if(source.id!==command.sourceId||source.revision!==command.sourceRevision)return 'This source changed. Close the review and refresh before continuing.';
 if(command.reason.trim().length<8||command.reason.length>500||/[\u0000-\u001F\u2014]/.test(command.reason))return 'Add a plain-language decision reason of 8 to 500 characters.';
 if(source.audit.some(row=>row.requestId===command.operationId))return 'This decision is already recorded. Refresh its history.';
 if(command.decision==='rollback'||command.decision==='publish-translation'){
  const version=source.versions.find(row=>row.id===command.target);if(!version||version.failures.length||version.evidence==='invalid')return 'Choose a validated retained version.';
  if(command.decision==='rollback')return ['approved','superseded'].includes(version.status)?null:'Only a reviewed retained version can replace the current publication.';
  return version.id===source.publishedId&&version.status==='published'&&version.translation==='approved'&&command.locale==='es'?null:'A reviewed Spanish translation of the exact current publication is required.';
 }
 return sourceOperationError(source as OperatorSource,{...command,requestId:command.operationId,decision:command.decision as SourceDecision},role);
}
export function validSourceOpsReceipt(v:unknown,id:string):v is SourceOpsReceipt{return object(v)&&v.operationId===id&&member(v.status,['succeeded','failed','pending','unknown'])&&(v.status!=='succeeded'||validSourceOpsSnapshot(v.snapshot));}
export function sourceReceiptCoversCommand(receipt:SourceOpsReceipt,command:SourceOpsCommand):boolean{
 if(!validSourceOpsReceipt(receipt,command.operationId)||receipt.status!=='succeeded')return false;
 const source=receipt.snapshot!.sources.find(row=>row.id===command.sourceId),version=source?.versions.find(row=>row.id===command.target);
 if(!source||source.revision<=command.sourceRevision||!source.audit.some(row=>row.requestId===command.operationId&&row.decision===command.decision&&row.target===command.target&&row.reason===command.reason))return false;
 switch(command.decision){case 'approve':return version?.status==='approved';case 'quarantine':return version?.status==='quarantined';case 'publish':case 'rollback':return source.publishedId===command.target&&version?.status==='published';case 'withdraw':return source.publishedId!==command.target&&version?.status==='withdrawn';case 'translation':return version?.translation==='approved';case 'publish-translation':return source.publishedTranslations.some(row=>row.locale===command.locale&&row.versionId===command.target);case 'retry':return source.run.id===command.target;}
}
