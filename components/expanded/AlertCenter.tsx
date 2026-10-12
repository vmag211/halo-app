'use client';

import {useRef,useState} from 'react';
import {ArrowRight,Bell,BellOff,BookOpen,Check,CheckCheck,ChevronDown,ExternalLink,X} from 'lucide-react';
import {useHomeDraft,useHomeWorkspace} from '@/components/homeguard/HomeWorkspaceState';
import {alertSeed,changeAlert,type AlertItem} from '@/lib/frontend/settings-preview';
import {dayLabel} from '@/lib/frontend/week-preview';
import {polishCopy as c} from '@/lib/frontend/copy/app-polish';
import {useExpandedPreview} from './ExpandedPreviewState';
import './app-polish.css';

export function useAlertInbox(scenario:string){
 const workspace=useHomeWorkspace(),state=useExpandedPreview();
 const key=`alerts:inbox:${scenario==='shell-no-alerts'?'empty':scenario==='shell-badge-cap'?'cap':'normal'}`;
 const [items,setItems]=useHomeDraft<AlertItem[]>(key,workspace.scenario==='empty'?[]:alertSeed(scenario==='shell-no-alerts'?0:scenario==='shell-badge-cap'?12:3));
 const ref=useRef(items);ref.current=items;
 const [message,setMessage]=useState('');const [undo,setUndo]=useState<AlertItem|null>(null);
 const blocked=()=>workspace.pending||state?.fail||['offline','error','loading','save-error','conflict'].includes(workspace.scenario)||!navigator.onLine;
 function change(item:AlertItem,patch:Partial<Pick<AlertItem,'read'|'dismissed'>>){
  if(blocked()){setMessage(c.alertsError);return false;}
  const next=changeAlert(ref.current,item.id,item.revision,patch);
  if(!next){setMessage(c.noticeChanged);return false;}
  ref.current=next;setItems(next);setMessage('');return true;
 }
 return {items,unread:items.filter(item=>!item.read&&!item.dismissed).length,message,undo,
  read:(item:AlertItem)=>change(item,{read:true}),
  dismiss:(item:AlertItem)=>{if(change(item,{dismissed:true})){setUndo({...item,revision:item.revision+1});setMessage(c.dismissed);}},
  restore:()=>{if(undo&&change(undo,{dismissed:false})){setUndo(null);setMessage(c.restored);}},
  all:()=>{if(blocked()){setMessage(c.alertsError);return;}const next=ref.current.map(item=>item.dismissed||item.read?item:{...item,read:true,revision:item.revision+1});ref.current=next;setItems(next);setMessage('');},
 };
}
export default function AlertCenter({inbox,onOpen,onSettings,offline=false}:{inbox:ReturnType<typeof useAlertInbox>;onOpen:(item:AlertItem)=>void;onSettings:()=>void;offline?:boolean}){
 const [unreadOnly,setUnreadOnly]=useState(false),[filter,setFilter]=useState('Everything'),[expanded,setExpanded]=useState<string|null>(null);
 const visible=inbox.items.filter(item=>!item.dismissed&&(!unreadOnly||!item.read)&&(filter==='Everything'||item.category===filter)).toSorted((a,b)=>b.date.localeCompare(a.date));
 return <section className="halo-alerts" aria-label={c.alerts}>
  <header className="hp-alerts-intro"><span className="hp-alerts-signature" aria-hidden="true"><Bell size={29}/><i/><i/></span><h3>{c.alertsHeading}</h3><p>{c.alertsIntro}</p></header>
  <div className="hp-alert-toolbar"><div className="hp-alert-view"><button aria-pressed={!unreadOnly} onClick={()=>setUnreadOnly(false)}>{c.all}</button><button aria-pressed={unreadOnly} onClick={()=>setUnreadOnly(true)}>{c.unread}<span>{inbox.unread}</span></button></div><button className="hp-icon" aria-label={c.markAll} disabled={!inbox.unread||offline} onClick={inbox.all}><CheckCheck size={20}/></button></div>
  <label className="hp-alert-filter"><span>{c.alertFilter}</span><select value={filter} onChange={e=>setFilter(e.target.value)}>{c.filterOptions.map(s=><option key={s}>{s}</option>)}</select></label>
  <div className="hp-alert-list">{visible.map(item=><article key={item.id} data-unread={!item.read} className="hp-alert-item"><span className="hp-alert-type" aria-hidden="true">{item.category==='Home'?<BookOpen size={19}/>:<Bell size={19}/>}</span><div className="hp-alert-content"><small>{item.category} · <time dateTime={item.date}>{dayLabel(item.date,{month:'short',day:'numeric'})}</time>{item.read&&` · ${c.read}`}</small><button className="hp-alert-title" aria-expanded={expanded===item.id} onClick={()=>setExpanded(expanded===item.id?null:item.id)}>{item.title}<ChevronDown size={15}/></button>{expanded===item.id&&<div className="hp-alert-detail"><p>{item.body}</p>{item.source&&<a href={item.source.url} target="_blank" rel="noreferrer">{item.source.title}<ExternalLink size={14}/></a>}<p className="hp-note">{c.readHint}</p></div>}<div className="hp-alert-actions"><button className="hp-text" onClick={()=>onOpen(item)}>{c.openRelated}<ArrowRight size={15}/></button>{!item.read&&<button className="hp-icon" disabled={offline} aria-label={`${c.markRead}: ${item.title}`} onClick={()=>inbox.read(item)}><Check size={16}/></button>}</div></div><button className="hp-icon hp-alert-dismiss" disabled={offline} aria-label={`${c.dismiss}: ${item.title}`} onClick={()=>inbox.dismiss(item)}><X size={16}/></button></article>)}</div>
  {!visible.length&&<div className="hp-empty"><BellOff size={36}/><h3>{unreadOnly?c.noUnread:filter!=='Everything'?c.noFiltered:c.alertsEmpty}</h3><p>{c.alertsEmptyHint}</p></div>}
  {inbox.message&&<div className="hp-feedback" role="status"><span>{inbox.message}</span>{inbox.undo&&<button className="hp-text" onClick={inbox.restore}>{c.undo}</button>}</div>}
  <button className="hp-link-row" onClick={onSettings}><span>{c.alertSettings}</span><ArrowRight size={17}/></button><p className="hp-note hp-alert-footer">{c.supplemental}</p>
 </section>;
}
