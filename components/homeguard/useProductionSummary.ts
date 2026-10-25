'use client';
import {useEffect,useRef,useState} from 'react';
import {useProductionResource,useProductionRuntime} from '@/components/production/ProductionContext';
import {useHomeDraft} from './HomeWorkspaceState';
import {FrontendServiceError,saveNotRecorded,serviceMessage} from '@/lib/frontend/production/runtime';
import {validSummaryList,validSummaryReceipt,validSummarySnapshot,type SummaryList,type SummarySnapshot} from '@/lib/frontend/production/summary-service';
export function useProductionSummary(){
 const runtime=useProductionRuntime(),list=useProductionResource<unknown>('summary.list',{}),[snapshot,setSnapshot]=useHomeDraft<SummarySnapshot|null>('summary:prepared',null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[localUnknown,setUnknown]=useHomeDraft<string[]>('summary:pending',[]),[resolved,setResolved]=useState<string[]>([]);
 const lock=useRef(false),alive=useRef(true),requests=useRef(new Set<AbortController>());
 // Inputs of summaries sent this visit, so a status check that finds no record can send the same request again under its id.
 const inputs=useRef(new Map<string,unknown>());
 useEffect(()=>{alive.current=true;const active=requests.current;return()=>{alive.current=false;for(const request of active)request.abort();};},[]);
 const data:SummaryList|null=validSummaryList(list.data)?list.data:null,unknown=[...new Set([...localUnknown,...(data?.unresolvedOperations??[])])].filter(id=>!resolved.includes(id));
 function accept(value:unknown,id:string):SummarySnapshot|null{
  if(!validSummaryReceipt(value,id)||['pending','unknown'].includes(value.status)){setUnknown(previous=>[...new Set([...previous,id])]);setMessage('The summary is still being checked. Check its status before creating another.');return null;}
  setUnknown(previous=>previous.filter(item=>item!==id));setResolved(previous=>[...previous,id]);
  if(value.status==='failed'){setMessage(value.message?.replaceAll('\u2014',',')||'The summary was not created. Your selections are kept.');list.retry();return null;}
  setSnapshot(value.snapshot!);setMessage('');list.retry();return value.snapshot!;
 }
 async function prepare(input:unknown){if(!runtime||lock.current||!data||unknown.length)return null;const id=crypto.randomUUID(),controller=new AbortController();requests.current.add(controller);lock.current=true;setBusy(true);setMessage('');inputs.current.set(id,input);
  try{const value=await runtime.request('summary.prepare',input,{signal:controller.signal,idempotencyKey:id});return alive.current?accept(value,id):null;}
  catch(error){if(alive.current){if(!(error instanceof FrontendServiceError)||['unknown_outcome','invalid_response'].includes(error.code))setUnknown(previous=>[...previous,id]);setMessage(serviceMessage(error));}return null;}
  finally{requests.current.delete(controller);lock.current=false;if(alive.current)setBusy(false);}
 }
 async function reconcile(id:string){if(!runtime||lock.current)return;const controller=new AbortController();requests.current.add(controller);lock.current=true;setBusy(true);try{let value:unknown;try{value=await runtime.request('operations.read',{domain:'summary',operationId:id},{signal:controller.signal});}catch(error){if(!inputs.current.has(id)||!saveNotRecorded(error))throw error;value=await runtime.request('summary.prepare',inputs.current.get(id),{signal:controller.signal,idempotencyKey:id});}if(alive.current)accept(value,id);}catch(error){if(alive.current){if(error instanceof FrontendServiceError&&['conflict','validation','permission','rate_limited'].includes(error.code)&&inputs.current.has(id)){setUnknown(previous=>previous.filter(item=>item!==id));setResolved(previous=>[...previous,id]);}setMessage(serviceMessage(error));}}finally{requests.current.delete(controller);lock.current=false;if(alive.current)setBusy(false);}}
 async function open(id:string){if(!runtime||lock.current)return false;const controller=new AbortController();requests.current.add(controller);lock.current=true;setBusy(true);setMessage('');try{const value=await runtime.request('summary.read',{id},{signal:controller.signal});if(!validSummarySnapshot(value)||value.id!==id)throw new Error('invalid');if(!alive.current)return false;setSnapshot(value);return true;}catch(error){if(alive.current)setMessage(serviceMessage(error));return false;}finally{requests.current.delete(controller);lock.current=false;if(alive.current)setBusy(false);}}
 return {snapshot,archives:data?.items??[],complete:data?.complete??false,unknown,busy,prepare,reconcile,open,message,loading:list.loading,error:list.off?null:list.error||(!list.loading&&runtime&&!data?'Summary history could not be verified.':null),off:!!list.off,retry:list.retry,ready:!!data};
}
