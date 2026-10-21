'use client';
import {createContext,useContext,useEffect,useState} from 'react';
import type {ProductionRuntime} from '@/lib/frontend/production/runtime';
import {FrontendServiceError,serviceMessage} from '@/lib/frontend/production/runtime';
export const ProductionContext = createContext<ProductionRuntime|null>(null);
export function useProductionRuntime(){return useContext(ProductionContext);}
/** Aborts superseded reads. Retains no previous identity/home data in a new request.
 * `off` marks a read refused because its capability is switched off (503 feature_unavailable): a settled
 * answer, so a screen can say "not available yet" instead of offering a retry. */
export function useProductionResource<T>(operation:string,input:unknown,enabled=true){
 const runtime=useProductionRuntime(),signature=JSON.stringify(input),[attempt,setAttempt]=useState(0);
 const requestKey=`${runtime?.scopeKey??'preview'}:${operation}:${signature}:${attempt}:${enabled}`;
 const [state,setState]=useState<{scope:string;data:T|null;loading:boolean;error:string|null;off?:boolean}>({scope:'',data:null,loading:!!runtime,error:null});
 useEffect(()=>{if(!runtime||!enabled)return;const controller=new AbortController();let active=true;
  queueMicrotask(()=>{if(active)setState({scope:requestKey,data:null,loading:true,error:null});});
  void runtime.request<T>(operation,signature===undefined?undefined:JSON.parse(signature),{signal:controller.signal}).then(data=>{if(active)setState({scope:requestKey,data,loading:false,error:null});},error=>{if(active)setState({scope:requestKey,data:null,loading:false,error:serviceMessage(error),off:error instanceof FrontendServiceError&&error.reason==='feature_unavailable'});});
  return()=>{active=false;controller.abort();};
 },[runtime,operation,signature,attempt,enabled,requestKey]);
 const safe=!runtime?{scope:'preview',data:null,loading:false,error:null}:!enabled?{scope:requestKey,data:null,loading:false,error:null}:state.scope===requestKey?state:{scope:requestKey,data:null,loading:true,error:null};
 return {...safe,off:!!('off' in safe&&safe.off),production:!!runtime,retry:()=>setAttempt(value=>value+1)};
}
