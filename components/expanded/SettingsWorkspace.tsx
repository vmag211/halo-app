'use client';

import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Bell,BookOpen,ChevronRight,House,Search,ShieldCheck,SlidersHorizontal} from 'lucide-react';
import {useHomeDraft,useHomeWorkspace} from '@/components/homeguard/HomeWorkspaceState';
import {usePreviewHousehold} from '@/components/foundation/PreviewHousehold';
import LunaMark from '@/components/foundation/LunaMark';
import {homeMemberKeys,memberCatalog} from '@/lib/frontend/home-household';
import type {FactorKey} from '@/lib/frontend/factor-preview';
import {initialSettings,mergeUnedited,type SettingsValues} from '@/lib/frontend/settings-preview';
import {polishCopy as c} from '@/lib/frontend/copy/app-polish';
import {useExpandedPreview} from './ExpandedPreviewState';
import {SettingsHome,SettingsNotifications,SettingsDisplay,SettingsLuna,SettingsAbout} from './SettingsPanels';
import SettingsPrivacy from './SettingsPrivacy';
import './app-polish.css';

export type SettingPanel=keyof typeof c.sections;
export type SettingsProps={offline:boolean;href:(tab:string,destination?:string)=>string;factorHref:(factor:FactorKey)=>string;onAlerts:()=>void;display:{scale:string;motion:'system'|'full'|'reduce';contrast:boolean};onDisplay:(next:{scale:string;motion:'system'|'full'|'reduce';contrast:boolean})=>void};
export type PanelProps={draft:SettingsValues;change:(next:SettingsValues)=>void;blocked:boolean};
export type CalendarSettings={zone:string;streak:boolean;linked:boolean};
const icons={home:House,notifications:Bell,display:SlidersHorizontal,luna:LunaMark,privacy:ShieldCheck,about:BookOpen};

export default function SettingsWorkspace(props:SettingsProps){
 const workspace=useHomeWorkspace(),preview=useExpandedPreview()!;const {bands,setBand}=usePreviewHousehold();
 const [values,setValues]=useHomeDraft<SettingsValues>('settings:values',initialSettings);
 const [drafts,setDrafts]=useHomeDraft<Partial<Record<SettingPanel,SettingsValues>>>('settings:edits',{});
 const [panel,setPanel]=useState<SettingPanel|null>(null),[query,setQuery]=useState(''),[message,setMessage]=useState('');
 const [displayDraft,setDisplayDraft]=useState(props.display),[baseline,setBaseline]=useState('');
 const [zone,setZone]=useHomeDraft('week:zone','America/New_York'),[streak,setStreak]=useHomeDraft('week:streak',false),[linked,setLinked]=useHomeDraft('week:include-record-dates',true);
 const [calendarDraft,setCalendarDraft]=useState<CalendarSettings>({zone,streak,linked});
 const [pending,setPending]=useState(false);const lock=useRef(false);
 const current=panel?drafts[panel]??values:values;
 const setDraft=(next:SettingsValues)=>{if(panel)setDrafts(old=>({...old,[panel]:next}));};
 const clearDraft=()=>{if(panel)setDrafts(old=>{const next={...old};delete next[panel];return next;});};
 const householdDraft=preview.householdDraft??bands;
 const selected=homeMemberKeys.filter(key=>bands[memberCatalog[key].band]);
 const slice=(value:SettingsValues)=>panel==='home'?value.home:panel==='notifications'?{notifications:value.notifications,quiet:value.quiet}:panel==='luna'?value.luna:panel==='display'?value.language:null;
 const dirty=JSON.stringify(slice(current))!==JSON.stringify(slice(values))||panel==='home'&&JSON.stringify(householdDraft)!==JSON.stringify(bands)||panel==='display'&&(JSON.stringify(displayDraft)!==JSON.stringify(props.display)||JSON.stringify(calendarDraft)!==JSON.stringify({zone,streak,linked}));
 const unavailable=['loading','error'].includes(workspace.scenario);
 const blocked=props.offline||workspace.pending||pending||['offline','loading','error','save-error','conflict'].includes(workspace.scenario)||preview.fail;
 const panelRef=useRef(panel);panelRef.current=panel;
 const root=useRef<HTMLElement|null>(null);
 const opener=useRef<SettingPanel|null>(null);
 const snapshot=()=>JSON.stringify({values,bands,display:props.display,calendar:{zone,streak,linked}});
 function enter(next:SettingPanel){opener.current=next;setMessage('');setDisplayDraft(props.display);setCalendarDraft({zone,streak,linked});setBaseline(snapshot());setPanel(next);history.pushState({...history.state,haloSettingsPanel:true},'',location.href);}
 function rebase(){const previous=JSON.parse(baseline);setDraft(mergeUnedited(current,previous.values,values));if(panel==='home')preview.setHouseholdDraft(mergeUnedited(householdDraft,previous.bands,bands));if(panel==='display'){setDisplayDraft(mergeUnedited(displayDraft,previous.display,props.display));setCalendarDraft(mergeUnedited(calendarDraft,previous.calendar,{zone,streak,linked}));}setBaseline(snapshot());setMessage(c.latestKept);}
 useEffect(()=>{const pop=()=>{if(!panelRef.current)return;setPanel(null);setMessage('');};window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[]);
 useEffect(()=>{if(panel||!opener.current)return;const frame=requestAnimationFrame(()=>root.current?.querySelector<HTMLButtonElement>(`[data-setting-panel="${opener.current}"]`)?.focus({preventScroll:true}));return()=>cancelAnimationFrame(frame);},[panel]);
 function leave(){if(pending||workspace.pending)return;if(history.state?.haloSettingsPanel)history.back();else setPanel(null);}
 async function save(){
  if(lock.current)return;
  if(blocked||!navigator.onLine){setMessage(workspace.scenario==='conflict'?c.conflict:props.offline||workspace.scenario==='offline'||!navigator.onLine?c.offline:c.failed);return;}
  if(panel==='home'&&current.home.year&&!/^\d{4}$/.test(current.home.year)||panel==='home'&&current.home.year&&(Number(current.home.year)<1000||Number(current.home.year)>new Date().getFullYear())){setMessage(c.yearError);return;}
  if(panel==='notifications'&&current.quiet.enabled&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(current.quiet.from)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(current.quiet.to)||current.quiet.from===current.quiet.to)){setMessage(c.quietError);return;}
  if(snapshot()!==baseline){setMessage(c.conflict);return;}
  lock.current=true;setPending(true);
  // A synchronous, guarded visit-local commit. No API or implied durable write.
  const submitted=panel==='home'?{...values,home:current.home}:panel==='notifications'?{...values,notifications:current.notifications,quiet:current.quiet}:panel==='luna'?{...values,luna:current.luna}:panel==='display'?{...values,language:current.language}:values;
  setValues(submitted);clearDraft();
  if(panel==='home'){homeMemberKeys.forEach(key=>setBand(key,householdDraft[memberCatalog[key].band]));preview.setHouseholdDraft(null);}
  if(panel==='display'){props.onDisplay(displayDraft);setZone(calendarDraft.zone);setStreak(calendarDraft.streak);setLinked(calendarDraft.linked);}
  setBaseline(JSON.stringify({values:submitted,bands:panel==='home'?householdDraft:bands,display:panel==='display'?displayDraft:props.display,calendar:panel==='display'?calendarDraft:{zone,streak,linked}}));
  setMessage(c.saved);setPending(false);lock.current=false;
 }
 const countRecords=Object.values(workspace.collections).reduce((n,rows)=>n+rows.length,0)+preview.actions.length;
 const sectionSummary=(key:SettingPanel)=>key==='home'?c.categoriesSelected(selected.length):key==='notifications'?c.deviceStates.not_connected:key==='display'?`${props.display.scale}% · ${c.appearance}`:key==='luna'?c.sections.luna[1]:key==='privacy'?c.recordsCount(countRecords):c.sections.about[1];
 const found=(Object.keys(c.sections)as SettingPanel[]).filter(key=>`${c.sections[key].join(' ')} ${key} ${key==='privacy'?'recovery export delete':''} ${key==='display'?'calendar language':''}`.toLowerCase().includes(query.toLowerCase().trim()));
 return <section ref={root} className="halo-settings" aria-label={c.settings}>
  {!panel?<><header className="hp-settings-intro"><div><span className="hp-kicker">HALO</span><h2>{c.heading}</h2><p>{c.intro}</p></div><SettingsSignature/></header><label className="hp-setting-search"><Search size={18} aria-hidden="true"/><span className="halo-sr-only">{c.search}</span><input type="search" value={query} placeholder={c.searchHint} onChange={e=>setQuery(e.target.value)}/></label><div className="hp-settings-list">{found.map(key=>{const Icon=icons[key];return <button key={key} className="hp-setting-row" data-setting-panel={key} onClick={()=>enter(key)}><span className={`hp-setting-symbol hp-setting-${key}`}><Icon size={23}/></span><span><strong>{c.sections[key][0]}</strong><small>{sectionSummary(key)}</small></span><ChevronRight size={17} aria-hidden="true"/></button>;})}{!found.length&&<p>{c.noMatch}</p>}</div><div className="hp-settings-foot"><ShieldCheck size={15}/><span>{c.appearance}</span><Link href={props.href('plan')} aria-label={c.reviewWeek}><ArrowRight size={17}/></Link></div></>:<>
  <button className="hp-back" aria-label={c.back} onClick={leave}><ArrowLeft size={17}/>{c.back}{dirty&&<span className="hp-dirty-dot" aria-hidden="true"/>}</button><header className="hp-panel-heading"><span className="hp-kicker">HALO · {c.settings}</span><h2>{c.sections[panel][0]}</h2></header>
  {unavailable?<div className="hp-empty" role="status"><ShieldCheck size={32}/><p>{workspace.scenario==='loading'?c.loading:c.unknown}</p><button className="hp-text" onClick={()=>workspace.setScenario('ready')}>{c.retry}</button></div>:<>
   {panel==='home'&&<SettingsHome draft={current} change={setDraft} blocked={pending}/>}
   {panel==='notifications'&&<SettingsNotifications draft={current} change={setDraft} blocked={pending} href={props.href} onAlerts={props.onAlerts}/>}
   {panel==='display'&&<SettingsDisplay draft={current} change={setDraft} blocked={pending} display={displayDraft} onDisplay={setDisplayDraft} calendar={calendarDraft} onCalendar={setCalendarDraft}/>}
   {panel==='luna'&&<SettingsLuna draft={current} change={setDraft} blocked={pending}/>}
   {panel==='privacy'&&<SettingsPrivacy href={props.href} blocked={blocked}/>}
   {panel==='about'&&<SettingsAbout factorHref={props.factorHref}/>}
   {!['privacy','about'].includes(panel)&&<footer className="hp-save-bar"><div><p role="status">{message||(dirty?c.dirty:c.unchanged)}</p>{message===c.conflict&&<button className="hp-text" onClick={rebase}>{c.reload}</button>}</div><button className="hp-primary" disabled={pending||!dirty} onClick={()=>void save()}>{c.save}</button><button className="hp-text" disabled={pending} onClick={()=>{clearDraft();preview.setHouseholdDraft(null);setDisplayDraft(props.display);setCalendarDraft({zone,streak,linked});setMessage('');}}>{c.cancel}</button></footer>}
  </>}
  </>}
 </section>;
}
function SettingsSignature(){return <svg className="hp-settings-signature" viewBox="0 0 96 104" fill="none" aria-hidden="true"><path d="M22 24 48 9l26 15v30L48 69 22 54V24Z"/><path d="M32 30 48 21l16 9v18l-16 9-16-9V30Z"/><path d="M10 68c15 0 15 13 30 13s15-13 30-13 15 13 26 13M-6 86c15 0 15-13 30-13s15 13 30 13 15-13 30-13M0 97c15 0 15-13 30-13s15 13 30 13 15-13 30-13"/></svg>;}
