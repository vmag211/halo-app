'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {ArrowRight,ArrowUp,RotateCcw} from 'lucide-react';
import {BottomSheet} from '@/components/ui/Foundation';
import DateInput from '@/components/ui/DateInput';
import LunaMark from '@/components/foundation/LunaMark';
import {useHomeCollection,useHomeDraft,useHomeWorkspace} from '@/components/homeguard/HomeWorkspaceState';
import type {FieldNote} from '@/lib/frontend/explore-preview';
import {useProductionResource,useProductionRuntime} from '@/components/production/ProductionContext';
import {FrontendServiceError,serviceMessage} from '@/lib/frontend/production/runtime';
import {validLunaCapabilities,validLunaConversation,validLunaOperation,validLunaProposal,validLunaRun,type LunaConversationData,type LunaProposal} from '@/lib/frontend/production/luna-service';
import {useExpandedPreview} from './ExpandedPreviewState';
import LunaLoading from './LunaLoading';
import {useProductionLunaClear} from './ProductionLunaClear';
import LunaAnswer from './LunaAnswer';

type Props={context:string;onClose:()=>void;go:(tab:string,destination?:string,view?:string,id?:string)=>void;currentGuide?:{id:string;title:string;stepTitle:string;guideId?:string;version?:string;stepId?:string};offline?:boolean};
const clean=(text:string)=>text.replace(/\u2014/g,',');
export default function ProductionLunaConversation({context,onClose,go,currentGuide,offline=false}:Props){
 const runtime=useProductionRuntime()!,workspace=useHomeWorkspace(),actions=useExpandedPreview();
 const conversationClear=useProductionLunaClear();
 const capabilities=useProductionResource<unknown>('luna.capabilities',{}),initial=useProductionResource<unknown>('luna.conversations',{current:true});
 const [conversation,setConversation]=useHomeDraft<LunaConversationData|null>('luna:production-conversation',null);
 const [draft,setDraft]=useHomeDraft('luna:production-draft','');
 const notes=useHomeCollection<FieldNote>('exploreNotes',[]);
 const [noteContext,setNoteContext]=useHomeDraft<{id:string;revision:number;fields:string[]}[]>('luna:production-note-context',[]);
 const staleNotes=noteContext.some(note=>notes.records.find(item=>item.id===note.id)?.revision!==note.revision);
 const [attempt,setAttempt]=useHomeDraft<{id:string;text:string;runId?:string}|null>('luna:production-request',null);
 const [unresolved,setUnresolved]=useHomeDraft<Record<string,string>>('luna:production-operations',{});
 const [edits,setEdits]=useState<Record<string,Record<string,string>>>({});
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[info,setInfo]=useState(false),[clearing,setClearing]=useState(false);
 const id=useId(),controller=useRef<AbortController|null>(null),lock=useRef(false),mounted=useRef(true),generation=useRef(0),log=useRef<HTMLDivElement>(null);
 const latest=useRef(conversation);useEffect(()=>{latest.current=conversation;},[conversation]);
 const caps=validLunaCapabilities(capabilities.data)?capabilities.data:null;
 const pendingOperations=Object.keys(unresolved).length>0;
 const blocked=busy||conversationClear.busy||conversationClear.pending||offline||!caps?.available||capabilities.loading||initial.loading||Boolean(initial.error)||Boolean(initial.data&&!validLunaConversation(initial.data));
 const setters=useRef({setConversation,setAttempt,setUnresolved});useEffect(()=>{setters.current={setConversation,setAttempt,setUnresolved};},[setConversation,setAttempt,setUnresolved]);
 useEffect(()=>{mounted.current=true;const requestGeneration=generation;return()=>{mounted.current=false;requestGeneration.current++;controller.current?.abort();};},[]);
 useEffect(()=>{if(!validLunaConversation(initial.data))return;const current=latest.current;if(!current||current.id===initial.data.id&&current.revision<initial.data.revision){setters.current.setConversation(initial.data);if(initial.data.pendingRequest)setters.current.setAttempt(initial.data.pendingRequest);if(initial.data.unresolvedOperations)setters.current.setUnresolved(initial.data.unresolvedOperations);}},[initial.data]);
 useEffect(()=>{log.current?.scrollTo({top:log.current.scrollHeight,behavior:'instant'});},[conversation?.messages.length,busy]);
 useEffect(()=>{const viewport=window.visualViewport,panel=document.getElementById(`luna-conversation-${id}`);if(!viewport||!panel)return;const resize=()=>{panel.style.setProperty('--lc-viewport',`${viewport.height}px`);panel.style.bottom=`${Math.max(0,window.innerHeight-viewport.height-viewport.offsetTop)}px`;};resize();viewport.addEventListener('resize',resize);viewport.addEventListener('scroll',resize);return()=>{viewport.removeEventListener('resize',resize);viewport.removeEventListener('scroll',resize);};},[id]);
 function accept(value:LunaConversationData){setConversation(value);void workspace.retry();actions?.retryLoad();}
 async function send(value=draft,retry=false){
  const text=clean(value.trim()).slice(0,1000);if(!text||blocked||lock.current)return;
  if(staleNotes&&!retry){setNotice('A selected note changed. Review its current fields or remove the selected notes before sending.');return;}
  const prior=retry?attempt:null;if(attempt&&!retry){setNotice('Check or cancel the previous request before sending another.');return;}
  const request={id:prior?.id??crypto.randomUUID(),text,runId:prior?.runId};setAttempt(request);lock.current=true;setBusy(true);setNotice('');
  const abort=new AbortController();controller.current=abort;const version=++generation.current;
  try{
   let response:unknown=prior?await runtime.request('luna.run',{id:prior.runId??prior.id},{signal:abort.signal}):await runtime.request('luna.message',{clientMessageId:request.id,conversationId:conversation?.id??null,text,page:context,noteContext,guide:currentGuide?{id:currentGuide.id,guideId:currentGuide.guideId,version:currentGuide.version,stepId:currentGuide.stepId}:undefined},{idempotencyKey:request.id,signal:abort.signal});
   for(let i=0;i<120;i++){
    if(!mounted.current||version!==generation.current||abort.signal.aborted)return;
    if(!validLunaRun(response))throw new FrontendServiceError('invalid_response','Luna returned incomplete information. Your request is kept.');
    setAttempt({...request,runId:response.id});
    if(response.conversation)setConversation(response.conversation);
    if(response.status==='completed'){setAttempt(null);setDraft('');setNoteContext([]);return;}
    if(response.status==='failed'||response.status==='cancelled'){setNotice(response.message?clean(response.message):'Luna could not complete that request. Your question is kept.');setAttempt(null);return;}
    const run=response.id;await pause(abort.signal,1000);response=await runtime.request('luna.run',{id:run},{signal:abort.signal});
   }
   setNotice('Luna is still working. Check the existing request to continue.');
  }catch(error){if(mounted.current&&!abort.signal.aborted)setNotice(serviceMessage(error));}
  finally{lock.current=false;if(mounted.current&&version===generation.current)setBusy(false);}
 }
 async function cancelRequest(){if(!attempt)return;generation.current++;controller.current?.abort();setBusy(false);lock.current=false;const request=attempt;try{const response:unknown=await runtime.request('luna.cancel',{id:request.runId??request.id},{idempotencyKey:`cancel:${request.id}`});if(!validLunaRun(response)||!['cancelled','completed','failed'].includes(response.status))throw new Error('unconfirmed');if(response.conversation)setConversation(response.conversation);setAttempt(null);setNotice('Request stopped. Your question is kept.');}catch{setNotice('Stopped waiting. Cancellation is unconfirmed. Check the existing request; no app action was approved.');}}
 async function act(proposal:LunaProposal,kind:'confirm'|'cancel'|'edit'|'status'){
  if(lock.current||offline||!caps?.available)return;
  if(kind==='confirm'&&(pendingOperations||Date.parse(proposal.expiresAt)<=Date.now())){setNotice(pendingOperations?'Check the pending change before confirming another.':'This review expired. Ask Luna to prepare it again.');return;}
  lock.current=true;setBusy(true);setNotice('');const operationId=unresolved[proposal.id]??crypto.randomUUID();
  try{
   if(kind==='edit'){
    const result:unknown=await runtime.request('luna.proposal.edit',{proposalId:proposal.id,revision:proposal.revision,fields:edits[proposal.id]??{}},{idempotencyKey:operationId,expectedRevision:proposal.revision});
    if(!validLunaProposal(result))throw new Error('invalid proposal');setConversation(old=>old?{...old,messages:old.messages.map(message=>message.proposal?.id===proposal.id?{...message,proposal:result}:message)}:old);setEdits(old=>{const next={...old};delete next[proposal.id];return next;});return;
   }
   if(kind==='confirm')setUnresolved(old=>({...old,[proposal.id]:operationId}));
   const result:unknown=await runtime.request(kind==='status'?'luna.operation':kind==='cancel'?'luna.proposal.cancel':'luna.confirm',{id:kind==='status'?operationId:proposal.id,proposalId:proposal.id,revision:proposal.revision},{idempotencyKey:operationId,expectedRevision:proposal.revision});
   if(!validLunaOperation(result)||result.id!==operationId)throw new Error('invalid receipt');
   if(result.status==='unknown'||result.status==='pending'){setUnresolved(old=>({...old,[proposal.id]:operationId}));setNotice('This change is not confirmed. Check its status before trying again.');return;}
   setUnresolved(old=>{const next={...old};delete next[proposal.id];return next;});
   if(result.conversation)accept(result.conversation);else if(result.status==='succeeded'||result.status==='cancelled')throw new Error('missing canonical conversation');
   setNotice(result.status==='failed'?clean(result.message??'No change was applied. Your review is kept.'):result.status==='cancelled'?'Review cancelled.':'Your confirmed changes are saved.');
  }catch(error){if(kind==='confirm'&&error instanceof FrontendServiceError&&error.code!=='unknown_outcome')setUnresolved(old=>{const next={...old};delete next[proposal.id];return next;});else if(kind==='confirm'||kind==='status')setUnresolved(old=>({...old,[proposal.id]:operationId}));setNotice(serviceMessage(error));}
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 }
 async function clear(){if(lock.current||pendingOperations||attempt||!conversation)return;if(await conversationClear.clear(conversation))setClearing(false);}
 return <BottomSheet id={`luna-conversation-${id}`} title="Luna" height="tall" onClose={onClose}><div className="lc-shell">
  <header className="lc-context"><LunaMark size={26}/><span>{currentGuide?.title??context}</span><button aria-expanded={info} onClick={()=>setInfo(!info)}>Context &amp; privacy</button></header>
  {noteContext.length>0&&<aside className="lc-info"><strong>{noteContext.length} selected note{noteContext.length===1?'':'s'}</strong>{noteContext.map(note=><p key={note.id}>{notes.records.find(item=>item.id===note.id)?.title??'Note unavailable'}: {note.fields.join(', ')}</p>)}{staleNotes&&<p>A selected note changed. Review or remove it before sending.</p>}<button className="lc-link" disabled={busy||!!attempt} onClick={()=>setNoteContext([])}>Remove selected notes</button></aside>}
  {info&&<details className="lc-info"><summary>Choose note context</summary><p>Selecting a note includes only its title and description when you send. Choose other fields from the note itself.</p>{notes.records.filter(note=>!note.archived).map(note=><label key={note.id}><input type="checkbox" checked={noteContext.some(item=>item.id===note.id)} disabled={busy||!!attempt||noteContext.length>=20&&!noteContext.some(item=>item.id===note.id)} onChange={event=>setNoteContext(old=>event.target.checked?[...old.filter(item=>item.id!==note.id),{id:note.id,revision:note.revision,fields:['title','description']}]:old.filter(item=>item.id!==note.id))}/>{note.title}</label>)}</details>}
  {info&&<aside className="lc-info"><p>{caps?`Tasks ${caps.context.tasks?'on':'off'}, home records ${caps.context.home?'on':'off'}, projects ${caps.context.projects?'on':'off'}.`:'Checking allowed context.'}</p><p>Notes are included only when you choose them. Journal text and private task preparation stay excluded. Review every proposed change.</p>{caps&&<><p>{clean(caps.providerLabel)}. {clean(caps.retentionSummary)}</p><p>{caps.publicRetrieval?'Public-source lookup is available.':'Live public-source lookup is not available.'}</p></>}<button className="lc-link" onClick={()=>go('settings')}>Manage context in Settings<ArrowRight size={16}/></button></aside>}
  <div className="lc-log" ref={log} role="log" aria-label="Conversation with Luna" aria-live="polite" aria-relevant="additions">
   {!conversation?.messages.length&&<section className="lc-welcome"><LunaMark size={40}/><h3>What would you like to do?</h3><p>Find a project, make a plan, or get help with what is in front of you.</p><div className="lc-starts">{['Find projects that fit my home','Find local ways to volunteer',currentGuide?'Guide me through this step':'Open my tests'].map(prompt=><button key={prompt} disabled={blocked} onClick={()=>void send(prompt)}>{prompt}<ArrowRight size={16}/></button>)}</div></section>}
   {conversation?.messages.map(message=><article className={`lc-message lc-message--${message.role}`} key={message.id}><span className="lc-role">{message.role==='user'?'You':'Luna'}</span><LunaAnswer message={message}/>{message.links?.map(link=><button className="lc-link" key={link.label} onClick={()=>go(link.tab,link.destination,link.view,link.record)}>{clean(link.label)}<ArrowRight size={16}/></button>)}{message.choices?.map(choice=><button className="lc-link" key={choice} disabled={blocked} onClick={()=>void send(choice)}>{clean(choice)}</button>)}{message.proposal&&<section className="lc-proposal" aria-label="Luna action review"><strong>{clean(message.proposal.title)}</strong><p>{clean(message.proposal.summary)}</p>{message.proposal.changes.map((change,index)=><div key={index}><strong>{clean(change.label)}</strong><small>{clean(change.before)} → {clean(change.after)}</small></div>)}{message.proposal.fields?.map(field=><label key={field.name}>{clean(field.label)}{field.kind==='date'?<DateInput value={edits[message.proposal!.id]?.[field.name]??field.value} disabled={busy||message.proposal!.status!=='review'} onChange={event=>setEdits(old=>({...old,[message.proposal!.id]:{...old[message.proposal!.id],[field.name]:event.target.value}}))}/>:<input maxLength={3000} value={edits[message.proposal!.id]?.[field.name]??field.value} disabled={busy||message.proposal!.status!=='review'} onChange={event=>setEdits(old=>({...old,[message.proposal!.id]:{...old[message.proposal!.id],[field.name]:event.target.value}}))}/>}</label>)}{unresolved[message.proposal.id]?<button className="lc-link" disabled={busy} onClick={()=>void act(message.proposal!,'status')}>Check action status</button>:message.proposal.status==='review'?<div className="lc-review-actions">{edits[message.proposal.id]?<button className="lc-primary" disabled={blocked} onClick={()=>void act(message.proposal!,'edit')}>Review edited changes</button>:<button className={message.proposal.destructive?'lc-danger':'lc-primary'} disabled={blocked||pendingOperations} onClick={()=>void act(message.proposal!,'confirm')}>{message.proposal.destructive?'Yes, delete':'Confirm changes'}</button>}<button disabled={busy} onClick={()=>void act(message.proposal!,'cancel')}>{message.proposal.destructive?'No, keep it':'Cancel review'}</button></div>:<small>{message.proposal.status==='applied'?'Confirmed changes saved.':'Review cancelled.'}</small>}</section>}</article>)}
   {busy&&<aside className="lc-pending"><LunaLoading label={attempt?'Thinking it through':'Checking your confirmed changes'}/>{attempt&&<button onClick={()=>void cancelRequest()}>Cancel request</button>}</aside>}
  </div>
  <footer className="lc-footer">{offline&&<p role="status">Offline. Your draft is kept; changes are not queued.</p>}{notice&&<p role="status">{notice}</p>}{conversationClear.message&&<p role="status">{conversationClear.message}</p>}{conversationClear.pending&&!clearing&&<button className="lc-link" onClick={()=>setClearing(true)}>Check conversation clear</button>}{!caps?.available&&!capabilities.loading&&<p role="status">{capabilities.error||'Luna is unavailable. You can still use HALO directly.'}<button className="lc-link" onClick={()=>{capabilities.retry();initial.retry();}}>Try again</button></p>}{initial.error&&<p role="status">Your conversation could not load. <button className="lc-link" onClick={initial.retry}>Try again</button></p>}{attempt&&!busy&&<div className="lc-review-actions"><button onClick={()=>void send(attempt.text,true)}>Check existing request</button><button onClick={()=>void cancelRequest()}>Cancel request</button></div>}
   {clearing?<section className="lc-clear" aria-label="Clear conversation review"><strong>Start a new conversation?</strong><p>This clears this conversation, not your saved app records.</p><div className="lc-review-actions"><button disabled={busy||conversationClear.busy||pendingOperations||!!attempt} className="lc-danger" onClick={()=>void clear()}>Clear conversation</button><button disabled={busy} onClick={()=>setClearing(false)}>Keep conversation</button></div></section>:<><form className="lc-composer" onSubmit={event=>{event.preventDefault();void send();}}><label className="halo-sr-only" htmlFor={`luna-input-${id}`}>Message Luna</label><textarea id={`luna-input-${id}`} rows={2} maxLength={1000} placeholder="Ask Luna to help or do something..." value={draft} disabled={busy} onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send();}}}/><button type="submit" className="lc-send" aria-label="Send message" disabled={blocked||!draft.trim()||!!attempt}><ArrowUp size={20}/></button></form><div className="lc-footer-meta"><button disabled={busy||pendingOperations||!!attempt||!conversation} onClick={()=>setClearing(true)}><RotateCcw size={13}/>New conversation</button>{pendingOperations&&<small>A change needs checking.</small>}</div></>}
  </footer>
 </div></BottomSheet>;
}
function pause(signal:AbortSignal,ms:number){return new Promise<void>((resolve,reject)=>{if(signal.aborted){reject(new Error('cancelled'));return;}const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},ms);const cancel=()=>{clearTimeout(timer);reject(new Error('cancelled'));};signal.addEventListener('abort',cancel,{once:true});});}
