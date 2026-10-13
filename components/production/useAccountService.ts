'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useProductionRuntime} from './ProductionContext';
import {FrontendServiceError,serviceMessage} from '@/lib/frontend/production/runtime';
import {validAccountReceipt,validAccountSnapshot,type AccountFeature,type AccountReceipt,type AccountSnapshot} from '@/lib/frontend/production/account-service';
export function useAccountService(feature:AccountFeature) {
 const runtime=useProductionRuntime()!,[snapshot,setSnapshot]=useState<AccountSnapshot|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[message,setMessage]=useState(''),[unknown,setUnknown]=useState<string[]>([]),[attempt,setAttempt]=useState(0);
 const alive=useRef(true),lock=useRef(false),readVersion=useRef(0),requests=useRef(new Set<AbortController>()),current=useRef(snapshot);
 useLayoutEffect(()=>{current.current=snapshot;},[snapshot]);
 useEffect(()=>{alive.current=true;const active=requests.current;return()=>{alive.current=false;for(const request of active)request.abort();};},[]);
 useEffect(()=>{const controller=new AbortController(),version=++readVersion.current;requests.current.add(controller);queueMicrotask(()=>{if(!controller.signal.aborted)setLoading(true);});
  void runtime.request<unknown>('account.read',{feature},{signal:controller.signal}).then(value=>{if(controller.signal.aborted||version!==readVersion.current)return;if(!validAccountSnapshot(value,feature))throw new Error('invalid');setSnapshot(value);setUnknown(value.unresolvedOperations);setMessage('');},error=>{if(!controller.signal.aborted&&version===readVersion.current)setMessage(serviceMessage(error));}).catch(()=>{if(!controller.signal.aborted&&version===readVersion.current)setMessage('Account information could not be verified. Please refresh.');}).finally(()=>{requests.current.delete(controller);if(!controller.signal.aborted&&version===readVersion.current)setLoading(false);});
  return()=>controller.abort();
 },[runtime,feature,attempt]);
 function accept(value:unknown,id:string):AccountSnapshot|null {
  if(!validAccountReceipt(value,id,feature)){setUnknown(previous=>[...new Set([...previous,id])]);setMessage('The account change could not be confirmed. Check its status.');return null;}
  const receipt=value as AccountReceipt;
  if(receipt.status==='unknown'||receipt.status==='pending'){setUnknown(previous=>[...new Set([...previous,id])]);setMessage('The account change is still being checked.');return null;}
  setUnknown(previous=>previous.filter(item=>item!==id));
  if(receipt.status==='failed'){setMessage(receipt.message?.replaceAll('\u2014',',')||'The change was not applied. Your input is kept.');return null;}
  readVersion.current++;setSnapshot(receipt.snapshot!);current.current=receipt.snapshot!;setUnknown(receipt.snapshot!.unresolvedOperations);setMessage(receipt.message?.replaceAll('\u2014',',')||'Updated.');return receipt.snapshot!;
 }
 async function run(action:string,payload:unknown={},expectedRevision=current.current?.revision):Promise<AccountSnapshot|null>{
  if(lock.current||loading||unknown.length||!current.current?.enabled)return null;
  if(expectedRevision!==current.current.revision){setMessage('This information changed. Review it again.');return null;}
  const id=crypto.randomUUID(),controller=new AbortController();requests.current.add(controller);lock.current=true;setBusy(true);setMessage('');
  try{const value=await runtime.request<unknown>('account.command',{feature,action,payload,expectedRevision,operationId:id},{signal:controller.signal,idempotencyKey:id,expectedRevision});return alive.current?accept(value,id):null;}
  catch(error){if(alive.current){if(!(error instanceof FrontendServiceError)||['unknown_outcome','invalid_response'].includes(error.code))setUnknown(previous=>[...new Set([...previous,id])]);setMessage(serviceMessage(error));if(error instanceof FrontendServiceError&&error.code==='conflict')setAttempt(value=>value+1);}return null;}
  finally{requests.current.delete(controller);lock.current=false;if(alive.current)setBusy(false);}
 }
 async function reconcile(id:string){if(lock.current)return;const controller=new AbortController();requests.current.add(controller);lock.current=true;setBusy(true);try{const value=await runtime.request('operations.read',{operationId:id,domain:'account',feature},{signal:controller.signal});if(alive.current)accept(value,id);}catch(error){if(alive.current)setMessage(serviceMessage(error));}finally{requests.current.delete(controller);lock.current=false;if(alive.current)setBusy(false);}}
 return {snapshot,busy,loading,message,unknown,run,reconcile,setMessage,retry:()=>setAttempt(value=>value+1),disabled:busy||loading||!!unknown.length||!snapshot?.enabled};
}
