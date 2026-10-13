'use client';
import Link from 'next/link';
import {useProductionResource,useProductionRuntime} from '@/components/production/ProductionContext';
import {FrontendServiceError,serviceMessage} from '@/lib/frontend/production/runtime';
import { useEffect, useState } from 'react';
import { ArrowRight, Check, FileCheck2, RefreshCw, TriangleAlert } from 'lucide-react';
import { useHomeDraft, useHomeWorkspace } from '@/components/homeguard/HomeWorkspaceState';
import { useExpandedPreview } from './ExpandedPreviewState';
import { type PreviewAction } from '@/lib/frontend/expanded-preview';
import { actionCategory, dayAdd, dayLabel, type WeekMeta } from '@/lib/frontend/week-preview';
import { changeEvidenceKey, compareWeekSources, usableWeekChanges, weekSourceSnapshots, type WeekChangeEvidence, type WeekSourceSnapshot } from '@/lib/frontend/week-planning';

type Href=(tab:string,destination?:string)=>string;
export function useWeekChanges({actions,metas,href}:{actions:PreviewAction[];metas:Record<string,WeekMeta>;href:Href}){
  const workspace=useHomeWorkspace();const [baseline,setBaseline]=useHomeDraft<WeekSourceSnapshot[]|null>('week:source-snapshots',null);const [acknowledged,setAcknowledged]=useHomeDraft<string[]>('week:acknowledged-updates',[]);const [samples]=useHomeDraft<WeekChangeEvidence[]>('week:sample-updates',[]);const [feedback,setFeedback]=useState('');
  const runtime=useProductionRuntime(),live=useProductionResource<{changes:WeekChangeEvidence[];unresolvedOperations:string[]}>('week.changes',{});const [pending,setPending]=useState(false);const [unknown,setUnknown]=useHomeDraft<string|null>('week:acknowledge-operation',null);
  useEffect(()=>{const restored=live.data?.unresolvedOperations?.[0];if(typeof restored==='string'&&!unknown)queueMicrotask(()=>setUnknown(restored));},[live.data,unknown,setUnknown]);
  const liveChanges=Array.isArray(live.data?.changes)?live.data.changes.filter(change=>change&&change.sample===false&&typeof change.id==='string'&&typeof change.version==='string'&&typeof change.title==='string'&&typeof change.summary==='string'&&typeof change.sourceLabel==='string'&&typeof change.sourceVersion==='string'&&actions.some(action=>action.id===change.actionId&&action.key===change.actionKey)&&(!change.sourceUrl||/^https:\/\//.test(change.sourceUrl))):[];
  const current=weekSourceSnapshots(actions,workspace.collections);const sourceReady=!['loading','error','empty'].includes(workspace.scenario);
  useEffect(()=>{if(!sourceReady)return;if(baseline===null){setBaseline(current);return;}const added=current.filter(snapshot=>!baseline.some(existing=>existing.actionId===snapshot.actionId&&existing.recordId===snapshot.recordId));if(added.length)setBaseline([...baseline,...added]);},[sourceReady,baseline,current,setBaseline]);
  const changes=usableWeekChanges(runtime?liveChanges:[...(sourceReady&&baseline?compareWeekSources(baseline,current,actions):[]),...samples],actions,acknowledged).filter(change=>!metas[change.actionKey]?.archived);
  function sourceHref(change:WeekChangeEvidence){if(!change.recordCollection||!change.recordId)return '';const exists=(workspace.collections[change.recordCollection]??[]).some(r=>r.id===change.recordId);return exists?`${href('home',change.recordCollection==='tests'?'tests':'maintenance')}&homeView=detail&record=${encodeURIComponent(change.recordId)}`:'';}
  async function acknowledge(change?:WeekChangeEvidence){if(pending||!change&&!unknown)return;if(runtime){setPending(true);const operationId=unknown??crypto.randomUUID();try{const receipt=await runtime.request<{operationId:string;status:string;acknowledged:string[]}>(unknown?'operations.read':'week.acknowledge',unknown?{operationId,domain:'week-updates'}:{operationId,id:change!.id,version:change!.version,actionId:change!.actionId},{idempotencyKey:operationId});if(receipt.operationId===operationId&&['failed','cancelled'].includes(receipt.status)){setUnknown(null);setFeedback('The update was not applied. You can try again.');return;}if(receipt.operationId!==operationId||receipt.status!=='succeeded'||!Array.isArray(receipt.acknowledged)||!receipt.acknowledged.every(key=>typeof key==='string')){setUnknown(operationId);setFeedback('The update is not confirmed. Select Reviewed again to check its status.');return;}setAcknowledged(receipt.acknowledged);setUnknown(null);setFeedback('Update reviewed. Your task is unchanged.');live.retry();}catch(e){if(e instanceof FrontendServiceError&&e.code==='unknown_outcome')setUnknown(operationId);setFeedback(serviceMessage(e));}finally{setPending(false);}return;}if(workspace.pending||['offline','loading','error','save-error','conflict'].includes(workspace.scenario)||!navigator.onLine){setFeedback('This update could not be acknowledged. It remains here.');return;}setAcknowledged(previous=>[...new Set([...previous,changeEvidenceKey(change!)])]);setFeedback('Update reviewed. Your task and its completion are unchanged.');}
  function forecastScope(change:WeekChangeEvidence){const expired=Boolean(change.validUntil)&&Date.parse(change.validUntil!)<Date.now();return `${change.issuedAt?`Issued ${change.issuedAt}. `:'Issue time not supplied. '}${change.validUntil?`Valid until ${change.validUntil}. `:'Validity period not supplied. '}${change.sample?'Forecast unavailable. ':expired?'This forecast is expired. Get current supported conditions before continuing. ':''}Missing factors stay unknown. Review supported conditions before changing your plan.`;}
  return {changes:sourceReady?changes:[],sourceHref,acknowledge,forecastScope,feedback,pending,unknown,checkStatus:()=>acknowledge(),statusMessage:runtime?live.error:null,retry:live.retry};
}
export type WeekChangeManager=ReturnType<typeof useWeekChanges>;
export function WeekUpdateList({manager,actions,onOpen}:{manager:WeekChangeManager;actions:PreviewAction[];onOpen:(action:PreviewAction)=>void}){
  const {changes,sourceHref,acknowledge,forecastScope,feedback}=manager;
  if(!changes.length)return manager.unknown?<section className="mw-activity-updates" role="status"><p>{feedback||'An update needs a status check.'}</p><button disabled={manager.pending} className="mw-text" onClick={()=>void manager.checkStatus()}>Check update status</button></section>:manager.statusMessage?<section className="mw-activity-updates" role="status"><p>Plan updates are unavailable.</p><button className="mw-text" onClick={manager.retry}>Try again</button></section>:null;
  return <section className="mw-activity-updates" aria-label="Changes to your plans">
    <div className="mw-section-head"><h3>A change to review</h3><span>{changes.length}</span></div>
    {changes.slice(0,3).map(change=>{
      const action=actions.find(a=>a.id===change.actionId)!;const source=sourceHref(change);
      return <article key={changeEvidenceKey(change)} className="mw-activity-update" data-kind={change.kind}>
        <span className="mw-update-icon" aria-hidden="true">{change.kind==='report'?<FileCheck2 size={21}/>:change.kind==='cancelled'||change.kind==='conditions'?<TriangleAlert size={20}/>:<RefreshCw size={19}/>}</span>
        <div><small>{change.sourceLabel} · version {change.sourceVersion}</small><strong>{change.title}</strong><p>{change.summary}</p>
          <span className="mw-update-linked">{action.title}{action.date?` · ${dayLabel(action.date)}`:' · Saved for later'}</span>
          {change.kind==='conditions'&&<details><summary>Forecast scope</summary><p>{forecastScope(change)}</p></details>}
          <div className="mw-update-actions"><button type="button" className="mw-text" onClick={()=>onOpen(action)}>Review task <ArrowRight size={15}/></button>
            {source?<Link className="mw-text" href={source}>Open record</Link>:change.sourceUrl?<a className="mw-text" href={change.sourceUrl} target="_blank" rel="noreferrer">Official source</a>:null}
            <button type="button" className="mw-update-ack" onClick={()=>acknowledge(change)} aria-label={`Acknowledge ${change.title}`}><Check size={15}/>Reviewed</button>
          </div>
        </div>
      </article>;
    })}
    {changes.length>3&&<details><summary>{changes.length-3} more changes</summary>{changes.slice(3).map(change=><div className="mw-update-overflow" key={changeEvidenceKey(change)}><strong>{change.title}</strong><p>{change.summary}</p><button className="mw-text" type="button" onClick={()=>onOpen(actions.find(a=>a.id===change.actionId)!)}>Review task</button><button className="mw-text" type="button" onClick={()=>acknowledge(change)}>Reviewed</button></div>)}</details>}
    {feedback&&<p role="status">{feedback}</p>}{manager.unknown&&<button className="mw-text" disabled={manager.pending} onClick={()=>void manager.checkStatus()}>Check update status</button>}
  </section>;
}

export default function WeekUpdates(props:{actions:PreviewAction[];metas:Record<string,WeekMeta>;onOpen:(action:PreviewAction)=>void;href:Href}){
  const manager=useWeekChanges(props);return <WeekUpdateList manager={manager} actions={props.actions} onOpen={props.onOpen}/>;
}

/** Review controls intentionally create illustrative evidence, never mutate a source or registration. */
export function WeekPlanningReviewControls(){const state=useExpandedPreview();const [samples,setSamples]=useHomeDraft<WeekChangeEvidence[]>('week:sample-updates',[]);const [,setAcknowledged]=useHomeDraft<string[]>('week:acknowledged-updates',[]);const [scenario,setScenario]=useState('date-changed');const [notice,setNotice]=useState('');
  function load(){
    if(!state)return;
    const category=scenario==='conditions'?'Outdoors':scenario==='report'?'Home':'Community';
    const action=state.actions.find(a=>a.state!=='completed'&&actionCategory(a)===category&&(scenario!=='report'||/test/i.test(`${a.origin} ${a.key}`)));
    if(!action){setNotice(`Save a ${scenario==='report'?'test':category.toLowerCase()} task first. No unrelated task was changed.`);return;}
    const id=`sample:${scenario}:${action.id}`;const version=String(1+Number(samples.find(s=>s.id===id)?.version??0));const date=action.date?dayAdd(action.date,2):'';
    const sample:WeekChangeEvidence={id,version,actionId:action.id,actionKey:action.key,kind:scenario as WeekChangeEvidence['kind'],title:scenario==='date-changed'?'Organizer date changed':scenario==='cancelled'?'Organizer cancelled this activity':scenario==='report'?'A report is ready to review':'Outdoor conditions need another look',summary:scenario==='date-changed'?`Example organizer date${date?`: ${date}`:' not supplied'}. Your saved date stays unchanged until you choose otherwise.`:scenario==='cancelled'?'Confirm the cancellation with the organizer before changing your plan.':scenario==='report'?'Review the original report before choosing a follow-up.':'Current conditions are unavailable. Check the forecast before making a plan.',sourceLabel:scenario==='report'?'Report source unavailable':scenario==='conditions'?'Forecast source unavailable':'Organizer source unavailable',sourceVersion:version,date,sample:true};
    setSamples(old=>[...old.filter(s=>s.id!==id),sample]);setAcknowledged(old=>old.filter(key=>!key.startsWith(`${id}:`)));setNotice('Sample update added to its saved task. No source record or task was changed.');
  }
  return <div className="halo-f-tool-grid"><label>Activity change scenario<select aria-label="Activity change scenario" value={scenario} onChange={e=>setScenario(e.target.value)}><option value="date-changed">Organizer date changed</option><option value="cancelled">Activity cancelled</option><option value="report">Report received</option><option value="conditions">Outdoor conditions changed</option></select></label><button type="button" onClick={load}>Load a sample activity update</button><button type="button" onClick={()=>{setSamples([]);setNotice('Sample activity updates cleared. Tasks were kept.');}}>Clear sample activity updates</button>{notice&&<p role="status">{notice}</p>}</div>;
}
