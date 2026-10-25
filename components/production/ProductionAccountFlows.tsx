'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {ChevronRight,MapPin,ShieldCheck,Monitor,Link2,KeyRound} from 'lucide-react';
import {useAccountService} from './useAccountService';
import {useHomeDraft,useHomeWorkspace} from '@/components/homeguard/HomeWorkspaceState';
import {useStageSession} from '@/components/stage/StageSession';
import {useExpandedPreview} from '@/components/expanded/ExpandedPreviewState';
import {validArea,validRecoveryEmail} from '@/lib/frontend/account-review';
import {completionCopy as c} from '@/lib/frontend/copy/completion';
import {pushApplicationKey} from '@/lib/frontend/production/account-service';
import {supabase} from '@/lib/supabase';
import {LINK_MESSAGES,fetchGoogleSigninStatus,startGoogleLink} from '@/lib/googleSignin';

function Feedback({service}:{service:ReturnType<typeof useAccountService>}) {
 return <>{service.loading&&<p className="hc-state" role="status">Loading account information...</p>}{service.busy&&<p className="hc-state" role="status">Checking...</p>}{service.message&&<p className="hc-state" role="status">{service.message}</p>}{!service.loading&&!service.snapshot&&!service.off&&<button type="button" className="hp-text" onClick={service.retry}>Try again</button>}{service.snapshot&&!service.snapshot.enabled&&<p className="hc-state">{service.snapshot.reason||'This feature is not available right now. Your existing records are unchanged.'}</p>}{service.unknown.map(id=><button key={id} type="button" className="hp-text" disabled={service.busy} onClick={()=>void service.reconcile(id)}>Check earlier request</button>)}</>;
}

export function ProductionHomeTransitionFlow() {
 const service=useAccountService('home'),session=useStageSession(),workspace=useHomeWorkspace(),expanded=useExpandedPreview(),data=service.snapshot?.home;
 const [area,setArea]=useHomeDraft('settings:home-search',''),[candidate,setCandidate]=useState(''),[selected,setSelected]=useState<string[]>([]);
 const refreshedHome=useRef('');
 const serverHomeId=data?.current?.id,currentHomeId=workspace.service?.context?.currentHomeId;
 useEffect(()=>{if(serverHomeId&&currentHomeId&&serverHomeId!==currentHomeId&&refreshedHome.current!==serverHomeId){refreshedHome.current=serverHomeId;void session.restart();}},[serverHomeId,currentHomeId,session]);
 const review=data?.review,blocked=service.disabled||workspace.pending||workspace.unknownOperations.length>0;
 async function confirm(){if(!review||Date.parse(review.expiresAt)<=Date.now()){service.setMessage('This review expired. Review the home change again.');return;}const result=await service.run('confirm-home',{reviewToken:review.token},review.expectedRevision);if(result?.home?.current)setArea('');}
 return <details className="hp-disclosure"><summary><MapPin size={18}/>{c.location}<ChevronRight size={16}/></summary><div className="hc-flow">
 {data?.current&&<p><strong>{data.current.label}</strong><br/><small>{data.current.precision} · {data.current.utilityStatus}</small></p>}
 {service.off||service.snapshot?.enabled===false?null:!review?<><label>{c.newArea}<input value={area} maxLength={100} disabled={blocked} onChange={event=>{setArea(event.target.value);setCandidate('');setSelected([]);}}/></label><small>{c.newAreaHint}</small><button type="button" className="hp-primary" disabled={blocked} onClick={()=>{if(!validArea(area)){service.setMessage(c.invalidArea);return;}setCandidate('');setSelected([]);void service.run('resolve-home',{query:area.trim()});}}>{c.findArea}</button>
 {!!data?.candidates.length&&<fieldset><legend>{c.candidate}</legend>{data.candidates.map(item=><label className="hc-choice" key={item.id}><input type="radio" name="home-candidate" checked={candidate===item.id} disabled={blocked} onChange={()=>{setCandidate(item.id);setSelected([]);}}/><span>{item.label}<small>{item.precision} · {item.utilityStatus}</small></span></label>)}</fieldset>}
 {candidate&&<><fieldset><legend>{c.carry}</legend><small>{c.carryHint}</small>{data?.portableTasks.length?data.portableTasks.map(task=><label className="hc-choice" key={task.id}><input type="checkbox" checked={selected.includes(task.id)} disabled={blocked} onChange={event=>setSelected(event.target.checked?[...selected,task.id]:selected.filter(id=>id!==task.id))}/>{task.title}</label>):<p>{c.noPortable}</p>}</fieldset><button type="button" className="hp-primary" disabled={blocked} onClick={()=>void service.run('prepare-home',{candidateId:candidate,portableTasks:selected.map(id=>({id,revision:data?.portableTasks.find(task=>task.id===id)?.revision}))})}>{c.review}</button></>}
 </>:<section className="hc-review" aria-label={c.homeReview}><h3>{c.homeReview}</h3><strong>{data?.candidates.find(item=>item.id===review.candidateId)?.label||'Selected new home'}</strong><ul>{review.consequences.map((line,index)=><li key={index}>{line}</li>)}</ul><small>{review.portableIds.length} selected task links. Historical records keep their original home.</small><div className="hc-actions"><button type="button" className="hp-primary" disabled={blocked} onClick={()=>void confirm()}>{c.confirmHome}</button><button type="button" className="hp-text" disabled={blocked} onClick={()=>void service.run('cancel-home-review',{reviewToken:review.token})}>{c.cancel}</button></div></section>}
 <Feedback service={service}/>{!service.loading&&(service.off||service.snapshot?.enabled===false)&&<div className="hc-flow-fallback"><p>Changing your address replaces the location used for your readings. Past records keep their original home, and you can review your household and home details during setup.</p><Link className="hp-text" href="/onboarding?change=1">Change address</Link></div>}{!!data?.history.length&&<details><summary>{c.pastHomes}</summary><ul className="hc-history">{data.history.map(home=><li key={home.id}><strong>{home.label}</strong><small>{home.changedAt.slice(0,10)}</small>{home.taskIds.map(id=>{const task=expanded?.actions.find(item=>item.id===id);return task?<Link key={id} className="hp-text" href={`/plan?weekTask=${encodeURIComponent(id)}`}>{task.title}</Link>:<small key={id}>Linked task unavailable</small>;})}</li>)}</ul></details>}
 </div></details>;
}

export function ProductionRecoveryFlow() {
 const service=useAccountService('recovery'),data=service.snapshot?.recovery;
 const [email,setEmail]=useHomeDraft('settings:recovery-email',''),[confirmation,setConfirmation]=useState<{kind:'remove'|'revoke';id:string;revision:number;accountRevision:number}|null>(null);
 return <details className="hp-disclosure"><summary><ShieldCheck size={18}/>{c.recovery}<ChevronRight size={16}/></summary><div className="hc-flow"><p>{c.recoveryIntro}</p>
 {data?.method?<><strong>{c.verified}</strong><p>{data.method.maskedAddress}</p><button type="button" className="hp-text hp-danger" disabled={service.disabled} onClick={()=>setConfirmation({kind:'remove',id:data.method!.id,revision:service.snapshot!.revision,accountRevision:service.snapshot!.revision})}>{c.removeRecovery}</button></>:data?.challenge&&data.challenge.status==='pending'?<><p>{data.challenge.maskedAddress}</p><p>{c.verifyPending}</p><button type="button" className="hp-primary" disabled={service.disabled} onClick={()=>void service.run('check-recovery',{challengeId:data.challenge!.id}).then(next=>{if(next?.recovery?.method)setEmail('');})}>{c.verify}</button><button type="button" className="hp-text" disabled={service.disabled} onClick={()=>void service.run('cancel-recovery',{challengeId:data.challenge!.id})}>{c.cancel}</button></>:<><label>{c.email}<input type="email" autoComplete="email" maxLength={254} value={email} disabled={service.disabled} onChange={event=>setEmail(event.target.value)}/></label><small>{c.emailHint}</small>{data?.challenge?.status==='expired'&&<p role="status">{c.expired}</p>}<button type="button" className="hp-primary" disabled={service.disabled} onClick={()=>{if(!validRecoveryEmail(email.trim())){service.setMessage(c.invalidEmail);return;}void service.run('request-recovery',{email:email.trim()});}}>{c.sendLink}</button></>}
 {!!data?.devices.length&&<><h3>{c.devices}</h3>{data.devices.map(device=><div className="hc-device" key={device.id}><Monitor size={18}/><span>{device.current?c.thisDevice:device.label}<small>Last seen {new Date(device.lastSeen).toLocaleDateString()}</small></span>{!device.current&&<button type="button" className="hp-text" disabled={service.disabled} onClick={()=>setConfirmation({kind:'revoke',id:device.id,revision:device.revision,accountRevision:service.snapshot!.revision})}>{c.revoke}</button>}</div>)}</>}
 {confirmation&&<section className="hc-review"><p>{confirmation.kind==='remove'?c.removeRecoveryHint:c.revokeHint}</p><button type="button" className="hp-danger-button" disabled={service.disabled} onClick={()=>void service.run(confirmation.kind==='remove'?'remove-recovery':'revoke-device',{id:confirmation.id,revision:confirmation.revision},confirmation.accountRevision).then(next=>{if(next)setConfirmation(null);})}>{c.remove}</button><button type="button" className="hp-text" disabled={service.busy} onClick={()=>setConfirmation(null)}>{c.keep}</button></section>}<Feedback service={service}/></div></details>;
}

/** Feasibility spike (HALO_FEATURE_GOOGLE_SIGNIN, off): renders nothing until the server says the capability is on. */
export function ProductionGoogleSigninFlow() {
 const [status,setStatus]=useState<Awaited<ReturnType<typeof fetchGoogleSigninStatus>>>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let live=true;void fetchGoogleSigninStatus({auth:supabase.auth,fetcher:fetch}).then(value=>{if(live)setStatus(value);});return()=>{live=false;};},[]);
 if(!status?.enabled)return null;
 async function start(){
  setBusy(true);setMessage('');
  try{const result=await startGoogleLink({auth:supabase.auth,storage:window.sessionStorage,origin:window.location.origin});if(result.ok){window.location.assign(result.url);return;}setMessage(LINK_MESSAGES[result.outcome]);}
  catch{setMessage(LINK_MESSAGES.failed);}
  finally{setBusy(false);}
 }
 return <details className="hp-disclosure"><summary><KeyRound size={18}/>Sign in with Google<ChevronRight size={16}/></summary><div className="hc-flow">
 {status.linked?<><strong>Kept with Google</strong>{status.maskedAccount&&<p>{status.maskedAccount}</p>}<small>Your household is kept with this Google account. Opening it on another device is not available yet.</small></>:<><p>Your household is kept only on this device right now. Sign in with Google to keep it with your Google account. HALO asks Google only for your name and email address, and your household stays the same.</p><button type="button" className="hp-primary" disabled={busy} onClick={()=>void start()}>{busy?'Opening Google...':'Sign in with Google to keep your household'}</button></>}
 {message&&<p className="hc-state" role="status">{message}</p>}</div></details>;
}

export function ProductionDeviceSetupFlow() {
 const service=useAccountService('device'),data=service.snapshot?.device;
 const [permission,setPermission]=useState<NotificationPermission|'unsupported'|'checking'>('checking'),[browserBusy,setBrowserBusy]=useState(false),[confirmation,setConfirmation]=useState<number|null>(null);
 useEffect(()=>{queueMicrotask(()=>setPermission(typeof Notification==='undefined'||!('serviceWorker' in navigator)||!('PushManager' in window)?'unsupported':Notification.permission));},[]);
 async function enable(){
  if(service.disabled||browserBusy||!data?.vapidPublicKey)return;setBrowserBusy(true);service.setMessage('');
  try {
   if(!window.isSecureContext||typeof Notification==='undefined'||!('serviceWorker' in navigator)||!('PushManager' in window)){setPermission('unsupported');return;}
   const result=Notification.permission==='default'?await Notification.requestPermission():Notification.permission;setPermission(result);if(result!=='granted'){service.setMessage(result==='denied'?c.permissionDenied:c.permissionPending);return;}
   const registration=await navigator.serviceWorker.register('/halo-notifications-sw.js',{scope:'/'});
   await new Promise<void>((resolve,reject)=>{if(registration.active){resolve();return;}const worker=registration.installing||registration.waiting;if(!worker){reject(new Error('Notification worker unavailable.'));return;}const timeout=setTimeout(()=>{worker.removeEventListener('statechange',changed);reject(new Error('Notification worker did not start.'));},15000);function changed(){if(worker?.state==='activated'){clearTimeout(timeout);worker.removeEventListener('statechange',changed);resolve();}else if(worker?.state==='redundant'){clearTimeout(timeout);worker.removeEventListener('statechange',changed);reject(new Error('Notification worker unavailable.'));}}worker.addEventListener('statechange',changed);});
   const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:pushApplicationKey(data.vapidPublicKey)});
   await service.run('register-push',{subscription:subscription.toJSON(),permission:result});
  }catch{service.setMessage('Device setup did not finish. Check your browser settings and try again.');}finally{setBrowserBusy(false);}
 }
 async function disable(){if(confirmation===null||!data?.registration)return;const next=await service.run('unregister-push',{id:data.registration.id,revision:data.registration.revision},confirmation);if(next?.device?.registration?.status==='active'||!next)return;setConfirmation(null);try{const registration=await navigator.serviceWorker.getRegistration('/');const subscription=await registration?.pushManager.getSubscription();await subscription?.unsubscribe();}catch{service.setMessage('Server delivery is off. You can also remove browser permission in site settings.');}}
 return <div className="hc-flow"><p>{c.permissionHint}</p><strong>{data?.registration?.status==='active'?c.subscribed:c.notConnected}</strong>{permission==='denied'&&<p>{c.permissionDenied}</p>}{permission==='unsupported'&&<p>{c.unsupported}</p>}{data?.registration?.status==='active'?<button type="button" className="hp-text" disabled={service.disabled} onClick={()=>setConfirmation(service.snapshot!.revision)}>{c.unsubscribe}</button>:<><p>{c.deviceConfirm}</p><button type="button" className="hp-primary" disabled={service.disabled||browserBusy||['unsupported','checking','denied'].includes(permission)||!data?.vapidPublicKey} onClick={()=>void enable()}>{browserBusy?'Setting up this browser...':c.requestPermission}</button></>}
 {confirmation!==null&&<section className="hc-review"><p>Turn off notifications on this device? Your inbox and saved reminders remain.</p><button type="button" className="hp-danger-button" disabled={service.disabled} onClick={()=>void disable()}>{c.unsubscribe}</button><button type="button" className="hp-text" disabled={service.busy} onClick={()=>setConfirmation(null)}>{c.keep}</button></section>}<Feedback service={service}/></div>;
}

function ProductionConnection({kind}:{kind:'email'|'calendar'}) {
 const service=useAccountService(kind),data=service.snapshot?.connection,[review,setReview]=useState<'connect'|'disconnect'|null>(null),[revision,setRevision]=useState(0);
 const [now,setNow]=useState(()=>Date.now());
 const connected=data?.status==='connected',authorization=data?.authorization,validAuthorization=authorization&&Date.parse(authorization.expiresAt)>now;
 useEffect(()=>{const expiry=authorization?.expiresAt;if(!expiry)return;const timer=setTimeout(()=>setNow(Date.now()),Math.max(0,Date.parse(expiry)-Date.now())+1);return()=>clearTimeout(timer);},[authorization?.expiresAt]);
 return <section className="hc-flow" aria-label={kind==='email'?c.gmail:c.calendar}><div className="hc-device"><Link2 size={19}/><span><strong>{kind==='email'?c.gmail:c.calendar}</strong><small>{connected?c.connected:data?.status==='expired'?'Authorization expired':c.notConnected}{data?.maskedAccount? ` · ${data.maskedAccount}`:''}</small></span></div>
 {review?<section className="hc-review"><p>{review==='disconnect'?c.disconnectHint:kind==='email'?c.scopeEmail:c.scopeCalendar}</p><div className="hc-actions"><button type="button" className={review==='disconnect'?'hp-danger-button':'hp-primary'} disabled={service.disabled} onClick={()=>void service.run(review==='disconnect'?'disconnect':'authorize',{},revision).then(next=>{if(next)setReview(null);})}>{review==='disconnect'?c.disconnect:c.authorize}</button><button type="button" className="hp-text" disabled={service.busy} onClick={()=>setReview(null)}>{c.cancel}</button></div></section>:validAuthorization?<><p>{c.authorizationPending}</p><a className="hp-primary" href={authorization.url} target="_blank" rel="noopener noreferrer">Open provider authorization</a><button type="button" className="hp-text" disabled={service.disabled} onClick={()=>void service.run('check-connection',{requestId:authorization.requestId})}>{c.checkConnection}</button><button type="button" className="hp-text" disabled={service.disabled} onClick={()=>void service.run('cancel-authorization',{requestId:authorization.requestId})}>{c.cancel}</button></>:<button type="button" className="hp-text" disabled={service.disabled} onClick={()=>{setRevision(service.snapshot!.revision);setReview(connected?'disconnect':'connect');}}>{connected?c.disconnect:c.connect}</button>}
 {!!data?.scopes.length&&<details><summary>Authorized access</summary><ul>{data.scopes.map(scope=><li key={scope}>{scope}</li>)}</ul></details>}<Feedback service={service}/></section>;
}
export function ProductionConnectionsFlow(){return <details className="hp-disclosure"><summary>{c.connections}<ChevronRight size={16}/></summary><div className="hc-flow"><ProductionConnection kind="email"/><ProductionConnection kind="calendar"/></div></details>;}
