'use client';
import {createContext,useContext,useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {useProductionResource,useProductionRuntime} from './ProductionContext';
import {useHomeWorkspace} from '@/components/homeguard/HomeWorkspaceState';
import {FrontendServiceError,saveNotRecorded,serviceMessage} from '@/lib/frontend/production/runtime';
import {colorPalette} from '@/lib/frontend/settings-preview';
import {validSettingsSnapshot as valid,type SettingsSnapshot,type SettingsReceipt} from '@/lib/frontend/production/preferences-service';
export type {SettingsSnapshot} from '@/lib/frontend/production/preferences-service';
type PreferencesPort={snapshot:SettingsSnapshot|null;loading:boolean;error:string|null;pending:boolean;unknown:string|null;conflict:boolean;retry:()=>void;reconcile:()=>Promise<void>;save:(input:unknown)=>Promise<SettingsSnapshot|null>};
const Context=createContext<PreferencesPort|null>(null);
export const useProductionPreferences=()=>useContext(Context);
export default function ProductionPreferences({children}:{children:ReactNode}){
 const runtime=useProductionRuntime()!,workspace=useHomeWorkspace(),read=useProductionResource<unknown>('settings.read',{});
 const [snapshot,setSnapshot]=useState<SettingsSnapshot|null>(null),[error,setError]=useState<string|null>(null),[pending,setPending]=useState(false),[unknown,setUnknown]=useState<string|null>(null);const lock=useRef(false);const [conflict,setConflict]=useState(false);
 const hydrate=(value:SettingsSnapshot)=>{setSnapshot(value);setUnknown(value.unresolvedOperations[0]??null);workspace.setDraft('settings:values',()=>value.values);workspace.setDraft('halo-appearance',()=>value.display.appearance);workspace.setDraft('halo-ambient',()=>value.display.ambient);workspace.setDraft('halo-display',()=>value.display);workspace.setDraft('halo-palette',()=>colorPalette(value.display.palette));workspace.setDraft('week:zone',()=>value.calendar.zone);workspace.setDraft('week:streak',()=>value.calendar.streak);workspace.setDraft('week:include-record-dates',()=>value.calendar.linked);};
 const latestHydrate=useRef(hydrate);useLayoutEffect(()=>{latestHydrate.current=hydrate;});
 useEffect(()=>{if(!read.data)return;queueMicrotask(()=>{if(valid(read.data))latestHydrate.current(read.data);else setError('Settings could not be verified. Please retry.');});},[read.data]);
 // The last save sent, so a status check that finds no record of it can send it again under the same id.
 const sent=useRef<{id:string;input:unknown;revision:number}|null>(null);
 const send=(id:string,input:unknown,revision:number)=>runtime.request<SettingsReceipt>('settings.save',{...(input as Record<string,unknown>),operationId:id},{idempotencyKey:id,expectedRevision:revision});
 const save=async(input:unknown)=>{if(lock.current||unknown||!snapshot)return null;lock.current=true;setPending(true);setError(null);setConflict(false);const id=crypto.randomUUID();sent.current={id,input,revision:snapshot.revision};try{const receipt=await send(id,input,snapshot.revision);if(receipt.operationId===id&&['failed','cancelled'].includes(receipt.status)){setError('The save was not applied. Your draft is still here.');return null;}const value=receipt.snapshot;if(receipt.operationId!==id||receipt.status!=='succeeded'||!valid(value)){setUnknown(id);throw new FrontendServiceError('unknown_outcome','The save is not confirmed. Check its status before trying again.',id);}hydrate(value);return value;}catch(e){setConflict(e instanceof FrontendServiceError&&e.code==='conflict');if(e instanceof FrontendServiceError&&e.code==='conflict')read.retry();if(e instanceof FrontendServiceError&&e.code==='unknown_outcome')setUnknown(id);setError(serviceMessage(e));return null;}finally{lock.current=false;setPending(false);}};
 const reconcile=async()=>{if(!unknown||lock.current)return;lock.current=true;setPending(true);const last=sent.current?.id===unknown?sent.current:null;let resent=false;try{let value:SettingsReceipt;
  try{value=await runtime.request<SettingsReceipt>('operations.read',{operationId:unknown,domain:'settings'});}
  catch(e){if(!last||!saveNotRecorded(e))throw e;resent=true;value=await send(last.id,last.input,last.revision);}
  if(value.operationId===unknown&&value.status==='succeeded'&&valid(value.snapshot)){hydrate(value.snapshot);setError(null);}else if(value.operationId===unknown&&(value.status==='failed'||value.status==='cancelled')){setUnknown(null);read.retry();setError('The save was not applied. Your draft is still here.');}else setError('The save is still being checked.');}
  // A resend the server refused outright (a changed revision, invalid input) settles the save as not applied.
  catch(e){if(resent&&e instanceof FrontendServiceError&&['conflict','validation','permission','rate_limited'].includes(e.code)){setUnknown(null);setConflict(e.code==='conflict');read.retry();}setError(serviceMessage(e));}finally{lock.current=false;setPending(false);}};
 return <Context.Provider value={{snapshot,loading:read.loading,error:error??read.error??(unknown?'A settings save needs a status check.':null),pending,unknown,conflict,retry:()=>{setError(null);read.retry();},save,reconcile}}>{children}</Context.Provider>;
}
