'use client';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {ChevronRight} from 'lucide-react';
import {useProductionRuntime} from './ProductionContext';
import {FrontendServiceError,serviceMessage} from '@/lib/frontend/production/runtime';
import {validRecoveryEmail,maskedEmail} from '@/lib/frontend/account-review';
import {validRecoveryStatus,type RecoveryStatus} from '@/lib/frontend/production/recovery-service';

/** Challenge proof stays in memory. The user must reverify after losing this browser page. */
export default function ProductionRestoreAccessFlow(){
 const router=useRouter();
 const runtime=useProductionRuntime()!,[email,setEmail]=useState(''),[state,setState]=useState<RecoveryStatus|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[confirmed,setConfirmed]=useState(false),[unknown,setUnknown]=useState<{id:string;kind:'request'|'complete'}|null>(null);
 const nonce=useRef(''),identity=useRef<string|null|undefined>(undefined),requestId=useRef(''),request=useRef<AbortController|null>(null),alive=useRef(true),lock=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current?.abort();};},[]);
 async function identityMatches(){const {supabase}=await import('@/lib/supabase');const {data,error}=await supabase.auth.getSession();if(error)throw new Error('Session unavailable.');const id=data.session?.user.id??null;if(identity.current===undefined)identity.current=id;if(identity.current!==id)throw new FrontendServiceError('session','Your signed-in account changed. Close and reopen recovery before continuing.');return supabase;}
 async function accept(value:unknown,id:string,kind:'request'|'status'|'complete'){
  if(!validRecoveryStatus(value,id)){setUnknown({id,kind:kind==='complete'?'complete':'request'});setMessage('Recovery status could not be confirmed. Check the existing request.');return;}
  if(value.status==='unknown'){setUnknown({id,kind:kind==='complete'?'complete':'request'});setMessage('Recovery is still being checked.');return;}
  setUnknown(null);setState(value);setConfirmed(false);
  if(value.status==='pending'){setMessage('If this address has recovery set up, check its inbox. Open the verification link, then check here.');return;}
  if(value.status==='expired'){setMessage('This request expired. Request a new verification link.');return;}
  if(value.status==='collision'){setMessage('Another account or existing records need review. Nothing has been merged. Keep your current access and contact support for help.');return;}
  if(value.status==='failed'){setMessage('Recovery did not complete. No accounts were merged.');return;}
  if(kind==='complete'&&value.session){
   const supabase=await identityMatches(),credentials=value.session;
   const verified=await supabase.auth.getUser(credentials.accessToken);
   if(verified.error||verified.data.user?.id!==credentials.identityId)throw new FrontendServiceError('session','The recovered identity could not be verified. Your current session is unchanged.');
   if(!alive.current)return;await identityMatches();
   const restored=await supabase.auth.setSession({access_token:credentials.accessToken,refresh_token:credentials.refreshToken});
   if(restored.error||restored.data.user?.id!==credentials.identityId)throw new FrontendServiceError('session','Recovery could not finish. Check your session before continuing.');
   nonce.current='';requestId.current='';setEmail('');setState(null);router.replace('/plan');return;
  }
  setMessage('Ownership verified. Review the account switch before restoring access.');
 }
 async function run(kind:'request'|'status'|'complete'){
  if(lock.current||kind==='complete'&&(!confirmed||!state?.restoreToken))return;
  if(kind==='request'&&!validRecoveryEmail(email.trim())){setMessage('Enter a valid email address.');return;}
  if(kind==='request'&&unknown)return;
  lock.current=true;setBusy(true);setMessage('');const controller=new AbortController();request.current=controller;
  const id=kind==='request'?requestId.current||crypto.randomUUID():kind==='status'&&unknown?unknown.id:crypto.randomUUID();
  if(kind==='request'){requestId.current=id;nonce.current ||= crypto.randomUUID()+crypto.randomUUID();}
  const effectiveKind=kind==='status'&&unknown?.kind==='complete'?'complete':kind;
  try{
   await identityMatches();
   const input=kind==='request'?{email:email.trim(),clientNonce:nonce.current,operationId:id}:kind==='complete'?{challengeId:state?.challengeId,restoreToken:state?.restoreToken,clientNonce:nonce.current,operationId:id,confirmAccountSwitch:true}:{challengeId:state?.challengeId,clientNonce:nonce.current,operationId:id,requestOperationId:unknown?.id??requestId.current,scope:unknown?.kind??'challenge'};
   const value=await runtime.request(`recovery.${kind}`,input,{signal:controller.signal,idempotencyKey:id});
   if(!alive.current)return;await identityMatches();await accept(value,id,effectiveKind);
  }catch(error){if(alive.current){if(kind!=='status'&&(!(error instanceof FrontendServiceError)||['unknown_outcome','invalid_response'].includes(error.code)))setUnknown({id,kind});setMessage(serviceMessage(error));}}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 function restart(){if(unknown||busy)return;setState(null);setConfirmed(false);requestId.current='';nonce.current='';identity.current=undefined;setMessage('');}
 return <details className="hp-disclosure"><summary>Restore access<ChevronRight size={16}/></summary><div className="hc-flow"><p>Use your previously verified recovery address. Accounts and records are never merged automatically.</p>
 {!state||['expired','failed','collision'].includes(state.status)?<><label>Recovery email<input type="email" autoComplete="email" maxLength={254} value={email} disabled={busy||!!unknown} onChange={event=>{setEmail(event.target.value);requestId.current='';}}/></label><button type="button" className="hp-primary" disabled={busy||!!unknown} onClick={()=>{if(state)restart();void run('request');}}>Request recovery link</button></>:state.status==='verified'?<section className="hc-review"><h3>Restore your existing HALO account?</h3><p>This switches this browser to the recovered account. Records belonging to a different account remain separate.</p><label className="hc-choice"><input type="checkbox" checked={confirmed} disabled={busy||!!unknown} onChange={event=>setConfirmed(event.target.checked)}/>I want to switch this browser to my recovered account.</label><button type="button" className="hp-primary" disabled={busy||!!unknown||!confirmed} onClick={()=>void run('complete')}>Restore my account</button></section>:<><p>{maskedEmail(email)}</p><button type="button" className="hp-primary" disabled={busy} onClick={()=>void run('status')}>Check recovery status</button></>}
 {unknown&&<button type="button" className="hp-primary" disabled={busy} onClick={()=>void run('status')}>Check earlier recovery request</button>}{state&&!unknown&&<button type="button" className="hp-text" disabled={busy} onClick={restart}>Cancel recovery</button>}{busy&&<p className="hc-state" role="status">Checking recovery...</p>}{message&&<p className="hc-state" role="status">{message}</p>}
 </div></details>;
}
