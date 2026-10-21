'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useHomeDraft} from '@/components/homeguard/HomeWorkspaceState';
import {useProductionResource,useProductionRuntime} from './ProductionContext';
import {FrontendServiceError,serviceMessage} from '@/lib/frontend/production/runtime';
import {validAlertSnapshot as valid,alertReceiptCovers,type AlertSnapshot,type AlertReceipt} from '@/lib/frontend/production/alerts-service';
import type {AlertItem} from '@/lib/frontend/settings-preview';
export function useProductionAlerts(){
 const runtime=useProductionRuntime(),read=useProductionResource<AlertSnapshot>('alerts.read',{});
 const [items,setItems]=useHomeDraft<AlertItem[]>('alerts:production',[]),[message,setMessage]=useState(''),[notice,setNotice]=useState(''),[undo,setUndo]=useState<AlertItem|null>(null),[pending,setPending]=useState(false),[unknown,setUnknown]=useState<string|null>(null);const lock=useRef(false);
 const itemsRef=useRef(items);const setRef=useRef(setItems);useLayoutEffect(()=>{itemsRef.current=items;setRef.current=setItems;},[items,setItems]);
 useEffect(()=>{if(read.data)queueMicrotask(()=>{if(valid(read.data)){setRef.current(read.data.items);setUnknown(read.data.unresolvedOperations[0]??null);}else setMessage('Alerts could not be verified. Please retry.');});},[read.data]);
 async function change(selected:AlertItem[],patch:{read?:boolean;dismissed?:boolean}){
  if(!runtime||lock.current||unknown||read.loading||read.error||selected.length===0)return false;
  if(selected.some(item=>!itemsRef.current.some(current=>current.id===item.id&&current.revision===item.revision))){setMessage('These alerts changed. Reload before trying again.');return false;}
  lock.current=true;setPending(true);setNotice('');const operationId=crypto.randomUUID();
  try{const value=await runtime.request<AlertReceipt>('alerts.update',{operationId,selection:selected.map(({id,revision})=>({id,revision})),patch},{idempotencyKey:operationId});if(value.operationId===operationId&&['failed','cancelled'].includes(value.status)){setMessage('The update was not applied.');return false;}if(value.operationId!==operationId||value.status!=='succeeded'||!valid(value)||!alertReceiptCovers(value,selected,patch)){setUnknown(operationId);setMessage('The update is not confirmed. Check its status.');return false;}setItems(value.items);setUnknown(value.unresolvedOperations[0]??null);setMessage('');return value.items;}catch(e){if(e instanceof FrontendServiceError&&e.code==='unknown_outcome')setUnknown(operationId);setMessage(serviceMessage(e));return false;}finally{lock.current=false;setPending(false);}
 }
 async function retry(){if(!runtime)return;if(!unknown){setMessage('');read.retry();return;}if(lock.current)return;lock.current=true;setPending(true);try{const value=await runtime.request<AlertReceipt>('operations.read',{operationId:unknown,domain:'alerts'});if(value.operationId===unknown&&value.status==='succeeded'&&valid(value)){setItems(value.items);setUnknown(value.unresolvedOperations[0]??null);setMessage('');}else if(value.operationId===unknown&&(value.status==='failed'||value.status==='cancelled')){setUnknown(null);read.retry();setMessage('The update was not applied.');}else setMessage('The update is still being checked.');}catch(e){setMessage(serviceMessage(e));}finally{lock.current=false;setPending(false);}}
 // A notice confirms a completed change; only a failure or an unconfirmed update offers Retry.
 const failure=message||read.error||(unknown?'An alert update needs a status check.':'');
 return {items,unread:items.filter(i=>!i.read&&!i.dismissed).length,message:failure||notice,failed:!!failure,undo,pending,loading:read.loading,retry,
  read:(item:AlertItem)=>change([item],{read:true}),
  dismiss:async(item:AlertItem)=>{const next=await change([item],{dismissed:true});if(next){setUndo(next.find(i=>i.id===item.id)??null);setNotice('Alert dismissed.');}},
  restore:async()=>{if(undo&&await change([undo],{dismissed:false})){setUndo(null);setNotice('Alert restored.');}},
  all:()=>change(itemsRef.current.filter(i=>!i.read&&!i.dismissed),{read:true})
 };
}
