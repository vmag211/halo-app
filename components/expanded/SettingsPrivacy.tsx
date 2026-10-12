'use client';

import Link from 'next/link';
import {useRef,useState} from 'react';
import {ArrowRight,Download,Eye,LockKeyhole,ShieldCheck,Trash2} from 'lucide-react';
import {useHomeWorkspace} from '@/components/homeguard/HomeWorkspaceState';
import {usePreviewHousehold} from '@/components/foundation/PreviewHousehold';
import {homeMemberKeys} from '@/lib/frontend/home-household';
import {actionFingerprint,exportGroups,recordFingerprint,selectedPrivateExport,type ExportGroup} from '@/lib/frontend/settings-preview';
import {polishCopy as c} from '@/lib/frontend/copy/app-polish';
import {downloadWeekFile} from '@/lib/frontend/week-preview';
import {useExpandedPreview} from './ExpandedPreviewState';
import type {SettingsProps} from './SettingsWorkspace';

export default function SettingsPrivacy({href,blocked}:{href:SettingsProps['href'];blocked:boolean}){
 const workspace=useHomeWorkspace(),state=useExpandedPreview()!,{setBand}=usePreviewHousehold();
 const [inspect,setInspect]=useState<ExportGroup>('tasks'),[showPrivate,setShowPrivate]=useState(false);
 const [groups,setGroups]=useState<ExportGroup[]>(['tasks']),[privateText,setPrivateText]=useState(false),[review,setReview]=useState<{data:Record<string,unknown>;signature:string}|null>(null);
 const [deleting,setDeleting]=useState<{scope:'journal'|'all';records:string;actions:string;conversation:string}|null>(null),[word,setWord]=useState(''),[message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);
 const latest=useRef({workspace,state});latest.current={workspace,state};
 const current=()=>selectedPrivateExport({collections:workspace.collections,actions:state.actions,drafts:workspace.drafts,groups,privateText});
 const inspected=selectedPrivateExport({collections:workspace.collections,actions:state.actions,drafts:workspace.drafts,groups:[inspect],privateText:showPrivate});
 const inspectedGroup=inspected[inspect];
 const inspectRows=(Array.isArray(inspectedGroup)?inspectedGroup:inspectedGroup&&typeof inspectedGroup==='object'?Object.values(inspectedGroup).filter(Array.isArray).flat():[])as Record<string,unknown>[];
 const journalCount=workspace.collections.weekJournal?.length??0;
 function prepare(scope:'journal'|'all'){setMessage('');setWord('');setDeleting({scope,records:recordFingerprint(workspace.collections,scope),actions:actionFingerprint(state.actions),conversation:JSON.stringify(workspace.drafts['luna:conversation']??null)});}
 async function erase(){
  if(!deleting||busy)return;
  if(blocked||!navigator.onLine){setMessage(c.failed);return;}
  if(deleting.scope==='all'&&word!=='DELETE')return;
  setBusy(true);
  const ok=await workspace.clearPrivate(deleting.scope,deleting.records,deleting.scope==='all'?()=>JSON.stringify(latest.current.workspace.drafts['luna:conversation']??null)===deleting.conversation&&latest.current.state.eraseActions(deleting.actions):undefined);
  setBusy(false);
  if(!ok){setMessage(c.deleteChanged);return;}
  if(deleting.scope==='all')homeMemberKeys.forEach(key=>setBand(key,false));
  setMessage(deleting.scope==='all'?c.deleteDone:c.clearJournalDone);setDeleting(null);setReview(null);
 }
 return <div className="hp-panel-content hp-privacy"><div className="hp-illustrated-note"><ShieldCheck size={32}/><p>{c.privacyIntro}</p></div><p className="hp-note">{c.privacyHint}</p><details className="hp-disclosure"><summary><Eye size={19}/>{c.inspect}<ArrowRight size={16}/></summary><label>{c.inspect}<select value={inspect} onChange={e=>setInspect(e.target.value as ExportGroup)}>{exportGroups.map(g=><option key={g} value={g}>{c.recordGroups[g]}</option>)}</select></label><label className="hp-checkbox"><input type="checkbox" checked={showPrivate} onChange={e=>setShowPrivate(e.target.checked)}/>{c.privateFields}</label><div className="hp-inspect-list">{inspectRows.map((record,i)=><details key={String(record.id??i)}><summary>{String(record.title??record.date??c.recordGroups[inspect])}</summary><pre className="hp-data-preview" tabIndex={0}>{JSON.stringify(record,null,2)}</pre></details>)}</div>{!inspectRows.length&&inspect!=='conversation'&&inspect!=='preferences'&&<p>{c.inspectEmpty}</p>}<details className="hp-structured"><summary>{c.structuredData}</summary><pre className="hp-data-preview" tabIndex={0}>{JSON.stringify(inspected[inspect]??{},null,2)}</pre></details></details>
 <details className="hp-disclosure"><summary><Download size={19}/>{c.export}<ArrowRight size={16}/></summary><p>{c.exportHint}</p><fieldset className="hp-export-selection"><legend>{c.export}</legend>{exportGroups.map(g=><label className="hp-checkbox" key={g}><input type="checkbox" checked={groups.includes(g)} onChange={e=>{setReview(null);setGroups(e.target.checked?[...groups,g]:groups.filter(item=>item!==g));}}/>{c.recordGroups[g]}</label>)}</fieldset><label className="hp-checkbox"><input type="checkbox" checked={privateText} onChange={e=>{setReview(null);setPrivateText(e.target.checked);}}/>{c.includePrivate}</label>{privateText&&<p className="hp-privacy-warning">{c.privateWarning}</p>}<button className="hp-text" onClick={()=>{if(!groups.length){setMessage(c.exportEmpty);return;}const data=current();setReview({data,signature:JSON.stringify(data)});setMessage('');}}>{c.exportPreview}<ArrowRight size={16}/></button>{review&&<div className="hp-export-review"><pre className="hp-data-preview" tabIndex={0}>{JSON.stringify(review.data,null,2)}</pre><button className="hp-primary" onClick={()=>{if(JSON.stringify(current())!==review.signature){setMessage(c.exportChanged);return;}downloadWeekFile('halo-private-export.json',JSON.stringify(review.data,null,2),'application/json');setMessage(c.exportDownloaded);}}><Download size={17}/>{c.download}</button></div>}</details>
 <details className="hp-disclosure"><summary><LockKeyhole size={19}/>{c.recovery}<ArrowRight size={16}/></summary><p>{c.recoveryHint}</p><p>{c.recoveryMissing}</p><strong>{c.devices}</strong><p>{c.devicesMissing}</p><Link className="hp-text" href={href('home','summary')}>{c.recoveryExport}<ArrowRight size={16}/></Link></details>
 <section className="hp-data-controls"><button className="hp-link-row" disabled={!journalCount||busy} onClick={()=>prepare('journal')}><Trash2 size={19}/><span><strong>{c.clearJournal}</strong><small>{journalCount} · {c.clearJournalHint}</small></span><ArrowRight size={17}/></button><button className="hp-link-row hp-danger" disabled={busy} onClick={()=>prepare('all')}><Trash2 size={19}/><span><strong>{c.deleteAll}</strong><small>{c.deleteHint}</small></span><ArrowRight size={17}/></button></section>
 {deleting&&<div className="hp-confirm" role="region" aria-label={deleting.scope==='all'?c.deleteQuestion:c.clearJournalQuestion}><strong>{deleting.scope==='all'?c.deleteQuestion:c.clearJournalQuestion}</strong><p>{deleting.scope==='all'?c.deleteHint:c.clearJournalCount(journalCount)}</p>{deleting.scope==='all'&&<><p className="hp-note">{c.deleteLimits}</p><label>{c.deleteWord}<input autoComplete="off" value={word} disabled={busy} onChange={e=>setWord(e.target.value)}/></label></>}<button className="hp-danger-button" disabled={busy||deleting.scope==='all'&&word!=='DELETE'} onClick={()=>void erase()}>{deleting.scope==='all'?c.deleteAll:c.confirmClear}</button><button className="hp-text" disabled={busy} onClick={()=>{setDeleting(null);setMessage('');}}>{c.keep}</button></div>}
 {message&&<p role="status" className="hp-feedback">{message}</p>}
 </div>;
}
