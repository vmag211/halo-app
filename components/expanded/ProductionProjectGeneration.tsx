'use client';
import { useEffect, useRef, useState } from 'react';
import { useHomeDraft } from '@/components/homeguard/HomeWorkspaceState';
import { useProductionResource, useProductionRuntime } from '@/components/production/ProductionContext';
import { defaultProjectConstraints, projectMessageIsResult, projectReadyMessage, type ProjectConstraints, type ProjectEnvironmentContext, type ProjectGenerationState } from '@/lib/frontend/explore-personalization';
import { validProjectGeneration, type ProductionProjectGuide, type ProjectGenerationResult } from '@/lib/frontend/production/explore-service';
import { FrontendServiceError,serviceMessage } from '@/lib/frontend/production/runtime';
import { projectsOff } from '@/lib/frontend/explore-availability';

export function useProductionProjectGeneration() {
  const runtime=useProductionRuntime();
  const contextKey=runtime?.scopeKey??'';
  const empty:ProjectGenerationState={request:'',constraints:defaultProjectConstraints,items:[],contextKey,generation:0};
  const [storedBatch,setBatch]=useHomeDraft<ProjectGenerationState|null>('explore:generated-projects',empty);
  const batch=storedBatch??empty;
  const [pending,setPending]=useHomeDraft<{id:string;jobId?:string;constraints:ProjectConstraints;request:string;interpret:boolean}|null>('explore:production-generation-operation',null);
  const [,setStartAttempt]=useHomeDraft<{id:string;guideId:string;version:string}|null>('explore:project-start-operation',null);
  const [guides,setGuides]=useHomeDraft<Record<string,ProductionProjectGuide>>('explore:production-guides',{});
  const [evidence,setEvidence]=useHomeDraft<ProjectEnvironmentContext['evidence']>('explore:production-evidence',[]);
  const [fitOpen,setFitOpen]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [intent,,clearIntent]=useHomeDraft('explore:project-generation-intent','');
  const saved=useProductionResource<unknown>('projects.current',{},Boolean(runtime));
  const active=useRef<AbortController|null>(null),requestId=useRef(''),jobId=useRef(''),version=useRef(0),lock=useRef(false);
  const last=useRef<{constraints:ProjectConstraints;request:string;interpret:boolean;done?:()=>void}|null>(null);
  const setters=useRef({setBatch,setGuides,setEvidence,setPending,setStartAttempt});useEffect(()=>{setters.current={setBatch,setGuides,setEvidence,setPending,setStartAttempt};},[setBatch,setGuides,setEvidence,setPending,setStartAttempt]);
  const commit=(result:ProjectGenerationResult)=>{
    if(result.contextKey!==contextKey||!result.batch||!result.guides)return false;
    setters.current.setBatch(result.batch);setters.current.setGuides(old=>({...old,...Object.fromEntries(result.guides!.map(guide=>[guide.id,guide]))}));setters.current.setEvidence(result.evidence??[]);return true;
  };
  const commitRef=useRef(commit);useEffect(()=>{commitRef.current=commit;});
  useEffect(()=>{if(!runtime||saved.loading||!validProjectGeneration(saved.data)||saved.data.contextKey!==runtime.scopeKey)return;if(saved.data.pendingStart)setters.current.setStartAttempt(saved.data.pendingStart);if(saved.data.status==='completed')commitRef.current(saved.data);else if(!['failed','cancelled'].includes(saved.data.status))setters.current.setPending({id:saved.data.id,jobId:saved.data.id,constraints:defaultProjectConstraints,request:'',interpret:false});},[saved.data,saved.loading,runtime]);
  useEffect(()=>()=>{version.current++;active.current?.abort();},[contextKey]);
  async function regenerate(constraints=batch.constraints,request=batch.request,interpret=false,done?:()=>void,retry=false){
    if(!runtime||busy||lock.current)return;
    // A switched-off capability is settled: never send a generation it would refuse.
    if(saved.off){setMessage('');return;}
    if(pending&&!retry){setMessage('Check or cancel the existing request before starting another.');return;}
    active.current?.abort();const controller=new AbortController();active.current=controller;const captured=++version.current;
    const attempt=retry&&pending?pending:{id:crypto.randomUUID(),constraints,request,interpret,jobId:undefined};const id=attempt.id;requestId.current=id;jobId.current=attempt.jobId??'';last.current={constraints:attempt.constraints,request:attempt.request,interpret:attempt.interpret,done};setPending(attempt);lock.current=true;setBusy(true);setMessage('');
    try{
      let result:unknown=retry?await runtime.request('projects.generation',{id:attempt.jobId??attempt.id},{signal:controller.signal}):await runtime.request('projects.generate',{contextKey,constraints:attempt.constraints,request:attempt.request,interpret:attempt.interpret,previousIdeaIds:batch.contextKey===contextKey?batch.items.map(item=>item.id):[]},{idempotencyKey:id,signal:controller.signal});
      for(let poll=0;poll<90;poll++){
        if(controller.signal.aborted||captured!==version.current)return;
        if(!validProjectGeneration(result))throw new Error('invalid generation');
        jobId.current=result.id;setPending({...attempt,jobId:result.id});
        if(result.contextKey!==contextKey)throw new Error('context changed');
        if(result.status==='completed'){if(!commitRef.current(result))throw new Error('invalid result');setPending(null);setMessage(projectReadyMessage(result.batch!.items.length,result.message));last.current=null;done?.();return;}
        if(result.status==='failed'||result.status==='cancelled'){setPending(null);setMessage(result.message||'Could not load recommendations. Your current set is kept.');return;}
        await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{controller.signal.removeEventListener('abort',cancel);resolve();},1500);const cancel=()=>{clearTimeout(timer);reject(new Error('cancelled'));};controller.signal.addEventListener('abort',cancel,{once:true});});
        result=await runtime.request('projects.generation',{id:jobId.current},{signal:controller.signal});
      }
      setMessage('Picking recommendations is taking longer than expected. Your current ideas are kept. Check this request again before starting another.');
    }catch(error){if(!controller.signal.aborted&&captured===version.current){if(error instanceof FrontendServiceError&&error.code!=='unknown_outcome'&&!jobId.current)setPending(null);setMessage(serviceMessage(error));}}
    finally{lock.current=false;if(captured===version.current){active.current=null;setBusy(false);}}
  }
  const regenerateRef=useRef(regenerate);useEffect(()=>{regenerateRef.current=regenerate;});
  useEffect(()=>{if(!runtime||!intent||busy)return;clearIntent();void regenerateRef.current({...defaultProjectConstraints,count:3},intent,true);},[runtime,intent,busy,clearIntent]);
  function cancel(){const id=pending?.jobId||pending?.id||jobId.current||requestId.current;version.current++;active.current?.abort();active.current=null;lock.current=false;setBusy(false);setMessage('Stopped waiting. Checking cancellation...');if(runtime&&id)void runtime.request<unknown>('projects.cancel',{id},{idempotencyKey:`cancel:${id}`}).then(result=>{if(!validProjectGeneration(result)||!['completed','cancelled','failed'].includes(result.status))throw new Error('unconfirmed');if(result.status==='completed')commitRef.current(result);setPending(null);setMessage(result.status==='completed'?'Ideas were ready before cancellation.':'Request cancelled. Your current ideas are kept.');}).catch(()=>setMessage('Stopped waiting. Cancellation is unconfirmed. Check the existing request before starting another.'));}
  function retry(){if(pending)void regenerate(pending.constraints,pending.request,pending.interpret,last.current?.done,true);else if(last.current){const input=last.current;void regenerate(input.constraints,input.request,input.interpret,input.done);}else saved.retry();}
  const context:ProjectEnvironmentContext={key:contextKey,isSample:false,state:'',county:'',renter:null,evidence:batch.contextKey===contextKey?evidence:[],hasGarden:false,gardenWaterKnown:false,hasMoistureObservation:false,filterModelKnown:false,sourceStatus:'published'};
  return runtime?{production:true,off:saved.off,pendingGeneration:Boolean(pending),canRetry:!saved.off&&Boolean(pending||saved.error||saved.data&&!validProjectGeneration(saved.data)||message&&!projectMessageIsResult(message)),context,batch:batch.contextKey===contextKey?batch:{...empty,constraints:batch.constraints,request:batch.request},fitOpen,setFitOpen,regenerate,busy:busy||saved.loading,loadingSaved:saved.loading&&!busy,message:message||(saved.off?projectsOff:saved.error)||(pending?'An earlier request needs checking. Try again to check it.':saved.data&&!validProjectGeneration(saved.data)?'Saved project ideas could not be read. Try again.':''),cancel,retry,serviceState:'ready',setServiceState:()=>{},findGuide:(id:string)=>guides[id]}:null;
}
