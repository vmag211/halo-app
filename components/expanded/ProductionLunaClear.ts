'use client';
import {useState} from 'react';
import {useHomeDraft,useHomeWorkspace} from '@/components/homeguard/HomeWorkspaceState';
import {useProductionRuntime} from '@/components/production/ProductionContext';
import {FrontendServiceError,serviceMessage} from '@/lib/frontend/production/runtime';
import {validLunaConversation,type LunaConversationData} from '@/lib/frontend/production/luna-service';

export function useProductionLunaClear(){
 const runtime=useProductionRuntime(),workspace=useHomeWorkspace();
 const [operation,setOperation]=useHomeDraft<{id:string;conversationId:string;revision:number}|null>('luna:production-clear',null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function clear(conversation:LunaConversationData){
  if(!runtime||busy)return false;
  const operations=workspace.drafts['luna:production-operations'];
  if(conversation.pendingRequest||Object.keys(conversation.unresolvedOperations??{}).length||workspace.drafts['luna:production-request']||operations&&typeof operations==='object'&&Object.keys(operations).length){setMessage('Check pending Luna requests and changes before clearing.');return false;}
  const attempt=operation??{id:crypto.randomUUID(),conversationId:conversation.id,revision:conversation.revision};
  if(attempt.conversationId!==conversation.id){setMessage('Check the existing conversation clear before starting another.');return false;}
  setOperation(attempt);setBusy(true);setMessage('');
  try{const result:unknown=await runtime.request('luna.clear',{id:attempt.conversationId,revision:attempt.revision},{idempotencyKey:attempt.id,expectedRevision:attempt.revision});if(!validLunaConversation(result)||result.messages.length||result.id===attempt.conversationId&&result.revision<=attempt.revision)throw new Error('invalid conversation receipt');workspace.setDraft('luna:production-conversation',()=>result);workspace.clearDraft('luna:production-draft');workspace.clearDraft('luna:production-note-context');setOperation(null);setMessage('Conversation cleared. Saved app records were kept.');return true;}
  catch(error){if(error instanceof FrontendServiceError&&error.code!=='unknown_outcome')setOperation(null);setMessage(serviceMessage(error));return false;}finally{setBusy(false);}
 }
 return {clear,busy,message,pending:Boolean(operation)};
}
