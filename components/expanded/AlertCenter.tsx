'use client';

import {useId,useLayoutEffect,useRef,useState} from 'react';
import {ArrowRight,BellOff,BookOpen,CalendarDays,Check,CheckCheck,ChevronDown,ExternalLink,SlidersHorizontal,Wind,X} from 'lucide-react';
import {useHomeDraft,useHomeWorkspace} from '@/components/homeguard/HomeWorkspaceState';
import {alertSeed,changeAlert,type AlertItem} from '@/lib/frontend/settings-preview';
import {dayLabel} from '@/lib/frontend/week-preview';
import {polishCopy as c} from '@/lib/frontend/copy/app-polish';
import {useExpandedPreview} from './ExpandedPreviewState';
import './app-polish.css';
import {useProductionAlerts} from '@/components/production/ProductionAlerts';
import {useProductionRuntime} from '@/components/production/ProductionContext';
import HaloLoading from '@/components/ui/HaloLoading';

export function useAlertInbox(scenario:string){
 const runtime=useProductionRuntime(),production=useProductionAlerts();
 const workspace=useHomeWorkspace(),state=useExpandedPreview();
 const key=`alerts:inbox:${scenario==='shell-no-alerts'?'empty':scenario==='shell-badge-cap'?'cap':'normal'}`;
 const [items,setItems]=useHomeDraft<AlertItem[]>(key,runtime||workspace.scenario==='empty'?[]:alertSeed(scenario==='shell-no-alerts'?0:scenario==='shell-badge-cap'?12:3));
 const ref=useRef(items);useLayoutEffect(()=>{ref.current=items;},[items]);
 const [message,setMessage]=useState('');const [undo,setUndo]=useState<AlertItem|null>(null);
 const blocked=()=>workspace.pending||state?.fail||['offline','error','loading','save-error','conflict'].includes(workspace.scenario)||!navigator.onLine;
 function change(item:AlertItem,patch:Partial<Pick<AlertItem,'read'|'dismissed'>>){
  if(blocked()){setMessage(c.alertsError);return false;}
  const next=changeAlert(ref.current,item.id,item.revision,patch);
  if(!next){setMessage(c.noticeChanged);return false;}
  ref.current=next;setItems(next);setMessage('');return true;
 }
 if(runtime)return production;
 return {items,unread:items.filter(item=>!item.read&&!item.dismissed).length,message,undo,pending:false,loading:false,retry:()=>{},
  read:(item:AlertItem)=>change(item,{read:true}),
  dismiss:(item:AlertItem)=>{if(change(item,{dismissed:true})){setUndo({...item,revision:item.revision+1});setMessage(c.dismissed);}},
  restore:()=>{if(undo&&change(undo,{dismissed:false})){setUndo(null);setMessage(c.restored);}},
  all:()=>{if(blocked()){setMessage(c.alertsError);return;}const next=ref.current.map(item=>item.dismissed||item.read?item:{...item,read:true,revision:item.revision+1});ref.current=next;setItems(next);setMessage('');},
 };
}
export default function AlertCenter({inbox,onOpen,onSettings,offline=false}:{inbox:ReturnType<typeof useAlertInbox>;onOpen:(item:AlertItem)=>void;onSettings:()=>void;offline?:boolean}){
 const [unreadOnly,setUnreadOnly]=useState(false),[filter,setFilter]=useState('Everything'),[expanded,setExpanded]=useState<string|null>(null);
 const detailPrefix=useId();
 const visible=inbox.items.filter(item=>!item.dismissed&&(!unreadOnly||!item.read)&&(filter==='Everything'||item.category===filter)).toSorted((a,b)=>b.date.localeCompare(a.date));
 return <section className="halo-alerts" aria-label={c.alerts}>
  {inbox.loading&&<HaloLoading label="Loading alerts" />}{inbox.message&&!inbox.undo&&<button className="hp-text" disabled={inbox.pending} onClick={()=>void inbox.retry()}>Retry or check status</button>}
  <div className="hp-alert-toolbar"><div className="hp-alert-view"><button aria-pressed={!unreadOnly} onClick={()=>setUnreadOnly(false)}>{c.all}</button><button aria-pressed={unreadOnly} onClick={()=>setUnreadOnly(true)}>{c.unread}<span>{inbox.unread}</span></button></div><button className="hp-icon" aria-label={c.markAll} disabled={!inbox.unread||offline||inbox.pending||inbox.loading} onClick={inbox.all}><CheckCheck size={20}/></button></div>
  <label className="hp-alert-filter"><span>{c.alertFilter}</span><select value={filter} onChange={e=>setFilter(e.target.value)}>{c.filterOptions.map(s=><option key={s}>{s}</option>)}</select></label>
  <div className="hp-alert-list">{visible.map(item=><article key={item.id} data-unread={!item.read} data-alert-category={item.category} className="hp-alert-item"><span className="hp-alert-type" aria-hidden="true">{item.category==='Home'?<BookOpen size={19}/>:item.category==='Your week'?<CalendarDays size={19}/>:<Wind size={19}/>}</span><div className="hp-alert-content"><small>{item.category} · <time dateTime={item.date} title={dayLabel(item.date,{month:'long',day:'numeric',year:'numeric'})}>{dayLabel(item.date,{month:'short',day:'numeric'})}</time>{item.read&&` · ${c.read}`}</small><button className="hp-alert-title" aria-expanded={expanded===item.id} aria-controls={expanded===item.id?`${detailPrefix}-${item.id}`:undefined} onClick={()=>setExpanded(expanded===item.id?null:item.id)}>{item.title}<ChevronDown size={15} aria-hidden="true"/></button>{expanded===item.id&&<div id={`${detailPrefix}-${item.id}`} className="hp-alert-detail"><p>{item.body}</p>{item.source&&<a href={item.source.url} target="_blank" rel="noreferrer">{item.source.title}<ExternalLink size={14} aria-hidden="true"/></a>}</div>}<div className="hp-alert-actions"><button className="hp-text hp-alert-open" onClick={()=>onOpen(item)}>{c.openRelated}<ArrowRight size={15} aria-hidden="true"/></button>{!item.read&&<button className="hp-text hp-alert-mark-read" disabled={offline||inbox.pending||inbox.loading} aria-label={`${c.markRead}: ${item.title}`} title={c.readHint} onClick={()=>inbox.read(item)}><Check size={16} aria-hidden="true"/>{c.markRead}</button>}</div></div><button className="hp-icon hp-alert-dismiss" disabled={offline||inbox.pending||inbox.loading} aria-label={`${c.dismiss}: ${item.title}`} onClick={()=>inbox.dismiss(item)}><X size={16} aria-hidden="true"/></button></article>)}</div>
  {!visible.length&&!inbox.loading&&!inbox.message&&<div className="hp-empty"><BellOff size={36}/><h3>{unreadOnly?c.noUnread:filter!=='Everything'?c.noFiltered:c.alertsEmpty}</h3><p>{c.alertsEmptyHint}</p></div>}
  {inbox.message&&<div className="hp-feedback" role="status"><span>{inbox.message}</span>{inbox.undo&&<button className="hp-text" onClick={inbox.restore}>{c.undo}</button>}</div>}
  <button className="hp-link-row hp-alert-settings" onClick={onSettings}><SlidersHorizontal size={18} aria-hidden="true"/><span>{c.alertSettings}</span><ArrowRight size={17} aria-hidden="true"/></button><p className="hp-note hp-alert-footer">{c.supplemental}</p>
 </section>;
}
