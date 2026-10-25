import type {ProductionRuntime} from './runtime';
import {FrontendServiceError} from './runtime';
import {validActionSnapshot,type ExpandedActionAdapter,type ActionReceipt} from './action-service';
import {validHomeRecords,validHomeChanges,type HomeWorkspaceService,type HomeWorkspaceContext,type HomeWorkspaceReceipt,type HomeCollectionSnapshot,type HomeAttachment} from './home-service';
function invalid(){return new FrontendServiceError('invalid_response','The service returned incomplete information. Please retry.');}
export function createActionAdapter(runtime:ProductionRuntime):ExpandedActionAdapter {
 const receipt=(value:ActionReceipt,id:string)=>{if(!value||value.operationId!==id||!['succeeded','failed','pending','unknown','cancelled'].includes(value.status)||value.status==='succeeded'&&(!validActionSnapshot(value.snapshot)||!Array.isArray(value.snapshot?.unresolvedOperations)))throw invalid();return value;};
 return {
  async load(signal){const value=await runtime.request<unknown>('actions.load',undefined,{signal});if(!validActionSnapshot(value)||!Array.isArray(value.unresolvedOperations))throw invalid();return value;},
  async commit(command,{operationId,signal}){try{return receipt(await runtime.request<ActionReceipt>('actions.commit',{...command,operationId},{signal,idempotencyKey:operationId}),operationId);}catch(error){if(error instanceof FrontendServiceError)return {operationId,status:error.code==='unknown_outcome'||error.code==='invalid_response'?'unknown':'failed',message:error.message};throw error;}},
  async reconcile(operationId,signal){return receipt(await runtime.request<ActionReceipt>('operations.read',{operationId,domain:'actions'},{signal}),operationId);}
 };
}
/** `scopeKey` keys the workspace session (its drafts): the caller may hold it fixed across an in-place home save (home-scope.ts, E25). */
export function createHomeAdapter(runtime:ProductionRuntime,context:HomeWorkspaceContext,scopeKey=runtime.scopeKey):HomeWorkspaceService {
 const attachment=(value:HomeAttachment)=>{if(!value||typeof value.id!=='string'||!Number.isSafeInteger(value.revision)||value.revision<1||typeof value.name!=='string'||typeof value.mime!=='string'||!Number.isFinite(value.bytes)||value.bytes<1||!['quarantined','ready','rejected'].includes(value.status)||typeof value.metadataRemoved!=='boolean')throw invalid();return value;};
 const receipt=(value:HomeWorkspaceReceipt,id:string)=>{if(!value||value.operationId!==id||!['succeeded','failed','pending','unknown'].includes(value.status)||!validHomeChanges(value.changes))throw invalid();return value;};
 const resources:Record<string,string>={'fish-catalogue':'fish.read','food-evidence':'food.search','grower-resources':'growers.search','water-stewardship':'water.read','published-food-evidence':'food.search'};
 return {
  scopeKey,context,
  attachments:{
   async upload(input,signal,progress){if(!input.reviewed||input.collection!=='tests'&&!input.metadataRemoved)throw new FrontendServiceError('validation','Review a metadata-free file before uploading.');const data=new FormData();data.set('file',input.file,input.name);data.set('collection',input.collection);data.set('recordId',input.recordId);data.set('metadataRemoved',String(input.metadataRemoved));data.set('reviewed','true');data.set('operationId',input.operationId);progress?.(0);const value=attachment(await runtime.request<HomeAttachment>('attachments.upload',data,{signal,idempotencyKey:input.operationId}));progress?.(1);return value;},
   async inspect(id,signal){return attachment(await runtime.request<HomeAttachment>('attachments.inspect',{id},{signal}));},
   async reconcileUpload(operationId,signal){const value=await runtime.request<{operationId:string;status:'succeeded'|'pending'|'unknown'|'failed';attachment?:HomeAttachment;message?:string}>('operations.read',{operationId,domain:'attachments'},{signal});if(value.operationId!==operationId||!['succeeded','pending','unknown','failed'].includes(value.status))throw invalid();return {...value,attachment:value.attachment?attachment(value.attachment):undefined};},
   async download(id,revision,signal){return runtime.request<Blob>('attachments.download',{id,revision},{signal,responseType:'blob'});},
   async remove(id,revision,operationId,signal){return receipt(await runtime.request<HomeWorkspaceReceipt>('attachments.remove',{id,revision,operationId},{signal,idempotencyKey:operationId,expectedRevision:revision}),operationId);}
  },
  async load(collection,signal){const result=await runtime.request<HomeCollectionSnapshot>('workspace.load',{collection},{signal});if(!result||!validHomeRecords(result.records)||!Array.isArray(result.pendingOperations))throw invalid();return result;},
  async execute(command,signal){try{return receipt(await runtime.request<HomeWorkspaceReceipt>('workspace.execute',command,{signal,idempotencyKey:command.operationId,expectedRevision:'expectedRevision'in command?command.expectedRevision??undefined:undefined}),command.operationId);}catch(error){if(error instanceof FrontendServiceError)return {operationId:command.operationId,status:error.code==='unknown_outcome'||error.code==='invalid_response'?'unknown':'failed',changes:{},message:error.message,...(error.code==='conflict'?{code:'conflict' as const}:{})};throw error;}},
  async reconcile(operationId,signal,domain='workspace'){return receipt(await runtime.request<HomeWorkspaceReceipt>('operations.read',{operationId,domain},{signal}),operationId);},
  async readResource(resource,query,signal){const operation=resources[resource];if(!operation)throw invalid();return runtime.request(operation,{resource,...query},{signal});},
 };
}
