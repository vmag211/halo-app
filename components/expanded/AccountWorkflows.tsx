'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {ChevronRight,MapPin,ShieldCheck,Monitor,Link2} from 'lucide-react';
import {useHomeCollection,useHomeDraft,useHomeWorkspace} from '@/components/homeguard/HomeWorkspaceState';
import {useExpandedPreview} from './ExpandedPreviewState';
import {actionFingerprint,initialSettings,type SettingsValues} from '@/lib/frontend/settings-preview';
import {capabilityStates,currentHomeId,eligiblePortable,maskedEmail,validArea,validRecoveryEmail,type CapabilityState,type HomeTransition} from '@/lib/frontend/account-review';
import {completionCopy as c} from '@/lib/frontend/copy/completion';
import './completion-workflows.css';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {useProductionRuntime} from '@/components/production/ProductionContext';
import {ProductionHomeTransitionFlow,ProductionRecoveryFlow,ProductionDeviceSetupFlow,ProductionConnectionsFlow} from '@/components/production/ProductionAccountFlows';
import ProductionRestoreAccessFlow from '@/components/production/ProductionRestoreAccessFlow';

const labels={home:'Home lookup',recovery:'Recovery service',device:'Device delivery',email:'Email authorization',calendar:'Calendar authorization'} as const;
type Service=keyof typeof labels;
export function CompletionReviewControls(){
 const workspace=useHomeWorkspace();
 if(workspace.mode==='production')return null;
 return <fieldset className="halo-f-tool-grid"><legend>Account and service scenarios (isolated examples)</legend>{Object.entries(labels).map(([key,label])=><label key={key}>{label}<select value={String(workspace.drafts[`review:capability:${key}`]??'unavailable')} onChange={e=>workspace.setDraft(`review:capability:${key}`,()=>e.target.value)}>{capabilityStates.map(s=><option key={s}>{s}</option>)}</select></label>)}<label>Learning catalogue<select value={String(workspace.drafts['review:learn']??'ready')} onChange={e=>workspace.setDraft('review:learn',()=>e.target.value)}>{['ready','loading','error','empty'].map(s=><option key={s}>{s}</option>)}</select></label><p>No emails, browser permission requests, OAuth requests or account writes occur. Choose verified only to inspect a confirmed service response.</p></fieldset>;
}
function useService(key:Service){
 const workspace=useHomeWorkspace(),preview=useExpandedPreview();
 const query=useSearchParams(),routeOffline=['offline','offline-empty'].includes(query.get('scenario')??'');
 const [capability]=useHomeDraft<CapabilityState>(`review:capability:${key}`,'unavailable');
 const [message,setMessage]=useState(''),[pending,setPending]=useState(false);
 const generation=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|null>(null),locked=useRef(false);
 const latest=useRef({capability,workspace,preview,routeOffline});useLayoutEffect(()=>{latest.current={capability,workspace,preview,routeOffline};},[capability,workspace,preview,routeOffline]);
 useEffect(()=>()=>{generation.current++;if(timer.current)clearTimeout(timer.current);},[]);
 const cancel=()=>{generation.current++;if(timer.current)clearTimeout(timer.current);locked.current=false;setPending(false);setMessage('');};
 const run=(commit:(isCurrent:()=>boolean)=>void,verify=false)=>{
  if(locked.current)return;
  const state=latest.current;
  if(!navigator.onLine||state.routeOffline||state.workspace.scenario==='offline'){setMessage(c.offline);return;}
  const errors:Partial<Record<CapabilityState,string>>={unavailable:c.unavailable,denied:key==='device'?c.permissionDenied:c.denied,expired:c.expired,error:c.failed,conflict:c.changed,unsupported:c.unsupported,collision:c.collision,'no-match':c.noArea,unknown:c.unknownOutcome};
  if(errors[state.capability]){setMessage(errors[state.capability]!);return;}
  if(state.preview?.fail||['error','loading','save-error','conflict'].includes(state.workspace.scenario)){setMessage(state.workspace.scenario==='conflict'?c.changed:c.failed);return;}
  if(verify&&state.capability!=='verified'){setMessage(key==='recovery'?c.verifyPending:key==='device'?c.permissionPending:c.authorizationPending);return;}
  const token=++generation.current;locked.current=true;setPending(true);setMessage('');
  const isCurrent=()=>token===generation.current&&navigator.onLine&&latest.current.routeOffline===state.routeOffline&&latest.current.capability===state.capability&&latest.current.workspace.scenario===state.workspace.scenario&&latest.current.preview?.fail===state.preview?.fail;
  timer.current=setTimeout(()=>{locked.current=false;if(token!==generation.current)return;setPending(false);if(!navigator.onLine){setMessage(c.offline);return;}if(!isCurrent()){setMessage(c.changed);return;}commit(isCurrent);},240);
 };
 return {capability,message,setMessage,pending,run,cancel};
}
function Feedback({service}:{service:ReturnType<typeof useService>}){return <>{service.pending&&<div className="hc-state" role="status">{c.pending}<button className="hp-text" onClick={service.cancel}>{c.cancel}</button></div>}{service.message&&<p className="hc-state" role="status">{service.message}</p>}</>;}

export function HomeTransitionFlow(){const runtime=useProductionRuntime();return runtime?<ProductionHomeTransitionFlow/>:<PreviewHomeTransitionFlow/>;}
function PreviewHomeTransitionFlow(){
 const workspace=useHomeWorkspace(),preview=useExpandedPreview()!,service=useService('home');
 const homes=useHomeCollection<HomeTransition>('homeTransitions',[]);
 const [area,setArea]=useHomeDraft('settings:home-search','');
 const [stage,setStage]=useState<'entry'|'candidate'|'review'>('entry');
 const [selected,setSelected]=useState<string[]>([]),[snapshot,setSnapshot]=useState('');
 const current=useRef({homes:homes.records,actions:preview.actions,drafts:workspace.drafts});useLayoutEffect(()=>{current.current={homes:homes.records,actions:preview.actions,drafts:workspace.drafts};},[homes.records,preview.actions,workspace.drafts]);
 const signature=()=>JSON.stringify([current.current.homes,actionFingerprint(current.current.actions),current.current.drafts['settings:follows'],current.current.drafts['settings:values'],current.current.drafts['settings:edits']]);
 const portable=preview.actions.filter(a=>a.state!=='completed'&&eligiblePortable(a.origin));
 const confirm=()=>service.run(isCurrent=>{
  if((current.current.drafts['settings:edits'] as Record<string,unknown>|undefined)?.home){service.setMessage('Save or cancel your home details before changing homes.');return;}
  if(signature()!==snapshot){service.setMessage(c.changed);setStage('candidate');return;}
  const record:HomeTransition={id:crypto.randomUUID(),revision:0,title:c.homeLabel,area:area.trim(),previousId:currentHomeId(homes.records),portableIds:selected.filter(id=>portable.some(a=>a.id===id)),confirmedAt:new Date().toISOString(),readings:'unavailable',previousProfile:((current.current.drafts['settings:values']??initialSettings) as SettingsValues).home};
  void workspace.write('homeTransitions',record,()=>isCurrent()&&signature()===snapshot).then(ok=>{if(!isCurrent())return;if(ok){workspace.setDraft('settings:values',previous=>({...((previous??initialSettings) as SettingsValues),home:{year:'',water:'other',tenure:'other'}}));setStage('entry');setArea('');service.setMessage(c.homeSaved);}else service.setMessage(c.changed);});
 });
 return <details className="hp-disclosure"><summary><MapPin size={18}/>{c.location}<ChevronRight size={16}/></summary><div className="hc-flow">
 {homes.records.length>0&&<p className="hc-state">{c.homeSaved}</p>}
 {stage==='entry'?<><label>{c.newArea}<input disabled={service.pending} value={area} maxLength={100} onChange={e=>{setArea(e.target.value);service.setMessage('');}}/></label><small>{c.newAreaHint}</small><button className="hp-primary" disabled={service.pending||workspace.pending} onClick={()=>{if(!validArea(area)){service.setMessage(c.invalidArea);return;}service.run(()=>setStage('candidate'));}}>{c.findArea}</button></>:stage==='candidate'?<><h3>{c.candidate}</h3><strong>{area.trim()}</strong><p>{c.precision}</p><div className="hc-actions"><button className="hp-primary" onClick={()=>{setSnapshot(signature());setStage('review');setSelected([]);}}>{c.review}</button><button className="hp-text" onClick={()=>setStage('entry')}>{c.back}</button></div></>:<div className="hc-review" role="region" aria-label={c.homeReview}><h3>{c.homeReview}</h3><strong>{area.trim()}</strong><p>{c.homeEffects}</p><fieldset><legend>{c.carry}</legend><p>{c.carryHint}</p>{portable.length?portable.map(a=><label className="hc-choice" key={a.id}><input type="checkbox" checked={selected.includes(a.id)} onChange={e=>setSelected(e.target.checked?[...selected,a.id]:selected.filter(id=>id!==a.id))}/>{a.title}</label>):<p>{c.noPortable}</p>}</fieldset><p>{c.watches}</p><div className="hc-actions"><button className="hp-primary" disabled={service.pending||workspace.pending} onClick={confirm}>{c.confirmHome}</button><button className="hp-text" disabled={workspace.pending} onClick={()=>{service.cancel();setStage('entry');}}>{c.cancel}</button></div></div>}
 <Feedback service={service}/>{homes.records.length>0&&<details><summary>{c.pastHomes}</summary><p>{c.oldRecords}</p><ul className="hc-history"><li><strong>{c.oldHome}</strong><small>{c.oldRecords}</small></li>{homes.records.map((home,i)=><li key={home.id}><strong>{home.area}</strong><small>{i===homes.records.length-1?c.currentHome:c.oldHome} · {home.confirmedAt.slice(0,10)}</small>{home.portableIds.map(id=>{const task=preview.actions.find(action=>action.id===id);return task?<Link className="hp-text" key={id} href={`/foundation/preview/expanded/?tab=plan&weekTask=${encodeURIComponent(id)}`}>{task.title}<ChevronRight size={16}/></Link>:<small key={id}>Linked task no longer available</small>;})}{home.previousProfile&&<details><summary>Previous home details</summary><p>Building year: {home.previousProfile.year||'Not supplied'}. Water: {home.previousProfile.water}. Tenure: {home.previousProfile.tenure}.</p></details>}</li>)}</ul></details>}
 </div></details>;
}

export function RecoveryFlow(){const runtime=useProductionRuntime();return runtime?<ProductionRecoveryFlow/>:<PreviewRecoveryFlow/>;}
function PreviewRecoveryFlow(){
 const service=useService('recovery');
 const [record,setRecord]=useHomeDraft<{email:string;revision:number;verified:boolean;otherDevice:boolean}>('settings:recovery',{email:'',revision:0,verified:false,otherDevice:false});
 const [email,setEmail]=useHomeDraft('settings:recovery-email','');
 const [stage,setStage]=useState<'entry'|'pending'>('entry');
 const [confirmation,setConfirmation]=useState<{kind:'remove'|'revoke';revision:number}|null>(null);
 const currentRecord=useRef(record);useLayoutEffect(()=>{currentRecord.current=record;},[record]);
 const [reviewedEmail,setReviewedEmail]=useState('');const reviewedRevision=useRef(0);
 return <details className="hp-disclosure"><summary><ShieldCheck size={18}/>{c.recovery}<ChevronRight size={16}/></summary><div className="hc-flow"><p>{c.recoveryIntro}</p>
 {record.verified?<><strong>{c.verified}</strong><p>{maskedEmail(record.email)}</p><button className="hp-text hp-danger" onClick={()=>setConfirmation({kind:'remove',revision:record.revision})}>{c.removeRecovery}</button><h3>{c.devices}</h3><div className="hc-device"><Monitor size={18}/><span>{c.thisDevice}</span></div>{record.otherDevice&&<div className="hc-device"><span>{c.otherDevice}</span><button className="hp-text" onClick={()=>setConfirmation({kind:'revoke',revision:record.revision})}>{c.revoke}</button></div>}</>:stage==='entry'?<><label>{c.email}<input disabled={service.pending} type="email" autoComplete="email" value={email} maxLength={254} onChange={e=>setEmail(e.target.value)}/></label><small>{c.emailHint}</small><button className="hp-primary" disabled={service.pending} onClick={()=>{if(!validRecoveryEmail(email.trim())){service.setMessage(c.invalidEmail);return;}service.run(()=>{setReviewedEmail(email.trim());reviewedRevision.current=currentRecord.current.revision;setStage('pending');service.setMessage(c.verifyPending);});}}>{c.sendLink}</button></>:<><p>{maskedEmail(reviewedEmail)}</p><button className="hp-primary" disabled={service.pending} onClick={()=>service.run(()=>{if(currentRecord.current.revision!==reviewedRevision.current){service.setMessage(c.changed);return;}setRecord({email:reviewedEmail,verified:true,revision:record.revision+1,otherDevice:true});setEmail('');setStage('entry');service.setMessage(c.verified);},true)}>{c.verify}</button><button className="hp-text" onClick={()=>{service.cancel();setStage('entry');}}>{c.cancel}</button></>}
 {confirmation&&<div className="hc-review" role="region" aria-label={confirmation.kind==='remove'?c.removeRecovery:c.revoke}><p>{confirmation.kind==='remove'?c.removeRecoveryHint:c.revokeHint}</p><div className="hc-actions"><button className="hp-danger-button" disabled={service.pending} onClick={()=>service.run(()=>{if(currentRecord.current.revision!==confirmation.revision){service.setMessage(c.changed);return;}setRecord(confirmation.kind==='remove'?{email:'',verified:false,otherDevice:false,revision:record.revision+1}:{...record,otherDevice:false,revision:record.revision+1});service.setMessage(confirmation.kind==='remove'?c.recoveryRemoved:c.revoked);setConfirmation(null);})}>{c.remove}</button><button className="hp-text" onClick={()=>{service.cancel();setConfirmation(null);}}>{c.keep}</button></div></div>}
 <Feedback service={service}/></div></details>;
}

export function DeviceSetupFlow(){const runtime=useProductionRuntime();return runtime?<ProductionDeviceSetupFlow/>:<PreviewDeviceSetupFlow/>;}
function PreviewDeviceSetupFlow(){
 const service=useService('device');
 const [status,setStatus]=useHomeDraft('settings:device-connection','off');
 const [stage,setStage]=useState<'entry'|'permission'|'confirm'|'remove'>('entry');
 return <div className="hc-flow"><p>{c.permissionHint}</p><strong>{status==='on'?c.subscribed:c.notConnected}</strong>{status==='on'?<button className="hp-text" onClick={()=>setStage('remove')}>{c.unsubscribe}</button>:stage==='entry'?<button className="hp-primary" disabled={service.pending} onClick={()=>service.run(()=>setStage('permission'))}>{c.requestPermission}</button>:stage==='permission'?<><p>{c.permissionPending}</p><button className="hp-primary" disabled={service.pending} onClick={()=>service.run(()=>setStage('confirm'),true)}>{c.register}</button><button className="hp-text" onClick={()=>{service.cancel();setStage('entry');}}>{c.cancel}</button></>:null}
 {stage==='confirm'&&status!=='on'&&<div className="hc-review"><p>{c.deviceConfirm}</p><button className="hp-primary" disabled={service.pending} onClick={()=>service.run(()=>{setStatus('on');setStage('entry');service.setMessage(c.subscribed);},true)}>{c.confirm}</button><button className="hp-text" onClick={()=>{service.cancel();setStage('entry');}}>{c.cancel}</button></div>}
 {stage==='remove'&&<div className="hc-review"><p>{c.unsubscribed}</p><button className="hp-danger-button" disabled={service.pending} onClick={()=>service.run(()=>{setStatus('off');setStage('entry');service.setMessage(c.unsubscribed);})}>{c.unsubscribe}</button><button className="hp-text" onClick={()=>{service.cancel();setStage('entry');}}>{c.keep}</button></div>}<Feedback service={service}/></div>;
}
function ConnectionFlow({kind}:{kind:'email'|'calendar'}){
 const service=useService(kind),[connected,setConnected]=useHomeDraft(`settings:connection:${kind}`,false);
 const [stage,setStage]=useState<'entry'|'review'|'pending'|'remove'>('entry');
 return <section className="hc-flow" aria-label={kind==='email'?c.gmail:c.calendar}><div className="hc-device"><Link2 size={19}/><span><strong>{kind==='email'?c.gmail:c.calendar}</strong><small>{connected?c.connected:c.notConnected}</small></span></div>
 {stage==='entry'?<button className="hp-text" onClick={()=>{service.setMessage('');setStage(connected?'remove':'review');}}>{connected?c.disconnect:c.connect}</button>:stage==='review'?<div className="hc-review"><p>{kind==='email'?c.scopeEmail:c.scopeCalendar}</p><div className="hc-actions"><button className="hp-primary" disabled={service.pending} onClick={()=>service.run(()=>setStage('pending'))}>{c.authorize}</button><button className="hp-text" onClick={()=>{service.cancel();setStage('entry');}}>{c.cancel}</button></div></div>:stage==='pending'?<><p>{c.authorizationPending}</p><button className="hp-primary" disabled={service.pending} onClick={()=>service.run(()=>{setConnected(true);setStage('entry');service.setMessage(c.connected);},true)}>{c.checkConnection}</button><button className="hp-text" onClick={()=>{service.cancel();setStage('entry');}}>{c.cancel}</button></>:<div className="hc-review"><p>{c.disconnectHint}</p><button className="hp-danger-button" disabled={service.pending} onClick={()=>service.run(()=>{setConnected(false);setStage('entry');service.setMessage(c.disconnected);})}>{c.disconnect}</button><button className="hp-text" onClick={()=>{service.cancel();setStage('entry');}}>{c.keep}</button></div>}
 <Feedback service={service}/></section>;
}
export function ConnectionsFlow(){const runtime=useProductionRuntime();return runtime?<ProductionConnectionsFlow/>:<details className="hp-disclosure"><summary>{c.connections}<ChevronRight size={16}/></summary><div className="hc-flow"><ConnectionFlow kind="email"/><ConnectionFlow kind="calendar"/></div></details>;}

export function RestoreAccessFlow(){const runtime=useProductionRuntime();return runtime?<ProductionRestoreAccessFlow/>:<PreviewRestoreAccessFlow/>;}
function PreviewRestoreAccessFlow(){
 const service=useService('recovery');
 const [email,setEmail]=useState(''),[stage,setStage]=useState<'entry'|'pending'|'verified'>('entry');
 return <details className="hp-disclosure"><summary>Restore access<ChevronRight size={16}/></summary><div className="hc-flow"><p>Use the recovery address you previously verified. An email match alone cannot restore access.</p>{stage==='entry'?<><label>{c.email}<input type="email" value={email} disabled={service.pending} autoComplete="email" maxLength={254} onChange={e=>setEmail(e.target.value)}/></label><button className="hp-primary" disabled={service.pending} onClick={()=>{if(!validRecoveryEmail(email.trim())){service.setMessage(c.invalidEmail);return;}service.run(()=>{setStage('pending');service.setMessage('If this address has recovery set up, check its inbox.');});}}>Request recovery link</button></>:stage==='pending'?<><p>{maskedEmail(email)}</p><button className="hp-primary" disabled={service.pending} onClick={()=>service.run(()=>{setStage('verified');setEmail('');service.setMessage('Access verified. Your existing records are kept.');},true)}>Check recovery status</button><button className="hp-text" onClick={()=>{service.cancel();setStage('entry');}}>Cancel recovery</button></>:<Link className="hp-primary" href="/foundation/preview/expanded/?tab=plan">Continue to My Week</Link>}<Feedback service={service}/></div></details>;
}
