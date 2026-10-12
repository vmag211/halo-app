'use client';

import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Bell,BookOpen,ChevronRight,House,Search,ShieldCheck,SlidersHorizontal,X} from 'lucide-react';
import {useHomeDraft,useHomeWorkspace} from '@/components/homeguard/HomeWorkspaceState';
import {usePreviewHousehold} from '@/components/foundation/PreviewHousehold';
import LunaMark from '@/components/foundation/LunaMark';
import {homeMemberKeys,memberCatalog} from '@/lib/frontend/home-household';
import type {FactorKey} from '@/lib/frontend/factor-preview';
import {initialSettings,mergeUnedited,appearancePreference,appearancePreferenceKey,type AppearancePreference,type SettingsValues} from '@/lib/frontend/settings-preview';
import {polishCopy as c} from '@/lib/frontend/copy/app-polish';
import {useExpandedPreview} from './ExpandedPreviewState';
import {SettingsHome,SettingsNotifications,SettingsDisplay,SettingsLuna,SettingsAbout} from './SettingsPanels';
import SettingsPrivacy from './SettingsPrivacy';
import './app-polish.css';
import './settings-refinement.css';

export type SettingPanel=keyof typeof c.sections;
export type SettingsProps={offline:boolean;href:(tab:string,destination?:string)=>string;factorHref:(factor:FactorKey)=>string;onAlerts:()=>void;display:{scale:string;motion:'system'|'full'|'reduce';contrast:boolean;appearance?:string;ambient?:boolean};onDisplay:(next:{scale:string;motion:'system'|'full'|'reduce';contrast:boolean;appearance?:string;ambient?:boolean})=>void};
export type PanelProps={draft:SettingsValues;change:(next:SettingsValues)=>void;blocked:boolean};
export type CalendarSettings={zone:string;streak:boolean;linked:boolean};
type SettingEdit={values:SettingsValues;baseline:string;display?:SettingsProps['display'];calendar?:CalendarSettings;appearance?:AppearancePreference;ambient?:boolean};
const icons={home:House,notifications:Bell,display:SlidersHorizontal,luna:LunaMark,privacy:ShieldCheck,about:BookOpen};
const groups:SettingPanel[][]=[['home','display','notifications','luna'],['privacy','about']];

export default function SettingsWorkspace(props:SettingsProps){
 const workspace=useHomeWorkspace(),preview=useExpandedPreview()!;const {bands,setBand}=usePreviewHousehold();
 const [values,setValues]=useHomeDraft<SettingsValues>('settings:values',initialSettings);
 const [drafts,setDrafts]=useHomeDraft<Partial<Record<SettingPanel,SettingEdit>>>('settings:edits',{});
 const [appearance,setAppearance]=useHomeDraft<AppearancePreference>(appearancePreferenceKey,appearancePreference(props.display.appearance));
 const [ambient,setAmbient]=useHomeDraft('halo-ambient',props.display.ambient??true);
 const currentDisplay={scale:props.display.scale,motion:props.display.motion,contrast:props.display.contrast};
 const [panel,setPanel]=useState<SettingPanel|null>(null),[query,setQuery]=useState(''),[message,setMessage]=useState('');
 const [baseline,setBaseline]=useState('');
 const [zone,setZone]=useHomeDraft('week:zone','America/New_York'),[streak,setStreak]=useHomeDraft('week:streak',false),[linked,setLinked]=useHomeDraft('week:include-record-dates',true);
 const [pending,setPending]=useState(false);const lock=useRef(false);
 const edit=panel?drafts[panel]:undefined,current=edit?.values??values;
 const displayDraft=edit?.display??currentDisplay,calendarDraft=edit?.calendar??{zone,streak,linked},appearanceDraft=edit?.appearance??appearancePreference(appearance),ambientDraft=edit?.ambient??ambient;
 const updateEdit=(patch:Partial<SettingEdit>)=>{if(panel)setDrafts(old=>{const next={values,baseline,...old[panel],...patch};const changed=JSON.stringify(slice(next.values))!==JSON.stringify(slice(values))||panel==='display'&&(JSON.stringify(next.display??currentDisplay)!==JSON.stringify(currentDisplay)||JSON.stringify(next.calendar??{zone,streak,linked})!==JSON.stringify({zone,streak,linked})||(next.appearance??appearancePreference(appearance))!==appearancePreference(appearance)||(next.ambient??ambient)!==ambient);if(changed)return {...old,[panel]:next};const clean={...old};delete clean[panel];return clean;});};
 const setDraft=(next:SettingsValues)=>updateEdit({values:next});
 const clearDraft=()=>{if(panel)setDrafts(old=>{const next={...old};delete next[panel];return next;});};
 const householdDraft=preview.householdDraft??bands;
 const selected=homeMemberKeys.filter(key=>bands[memberCatalog[key].band]);
 const slice=(value:SettingsValues)=>panel==='home'?value.home:panel==='notifications'?{notifications:value.notifications,quiet:value.quiet}:panel==='luna'?value.luna:panel==='display'?value.language:null;
 const dirty=JSON.stringify(slice(current))!==JSON.stringify(slice(values))||panel==='home'&&JSON.stringify(householdDraft)!==JSON.stringify(bands)||panel==='display'&&(JSON.stringify(displayDraft)!==JSON.stringify(currentDisplay)||JSON.stringify(calendarDraft)!==JSON.stringify({zone,streak,linked})||appearanceDraft!==appearancePreference(appearance)||ambientDraft!==ambient);
 const unavailable=['loading','error'].includes(workspace.scenario);
 const blocked=props.offline||workspace.pending||pending||['offline','loading','error','save-error','conflict'].includes(workspace.scenario)||preview.fail;
 const panelRef=useRef(panel);panelRef.current=panel;
 const root=useRef<HTMLElement|null>(null);
 const opener=useRef<SettingPanel|null>(null);
 const snapshot=()=>JSON.stringify({values,bands,display:currentDisplay,calendar:{zone,streak,linked},appearance:appearancePreference(appearance),ambient});
 function enter(next:SettingPanel){opener.current=next;setMessage('');setBaseline(drafts[next]?.baseline??snapshot());setPanel(next);history.pushState({...history.state,haloSettingsPanel:true},'',location.href);}
 function rebase(){const previous=JSON.parse(baseline),nextBaseline=snapshot();updateEdit({values:mergeUnedited(current,previous.values,values),baseline:nextBaseline,...(panel==='display'?{display:mergeUnedited(displayDraft,previous.display,currentDisplay),calendar:mergeUnedited(calendarDraft,previous.calendar,{zone,streak,linked}),appearance:mergeUnedited(appearanceDraft,previous.appearance,appearancePreference(appearance)),ambient:mergeUnedited(ambientDraft,previous.ambient,ambient)}:{})});if(panel==='home')preview.setHouseholdDraft(mergeUnedited(householdDraft,previous.bands,bands));setBaseline(nextBaseline);setMessage(c.latestKept);}
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
  if(panel==='display'){props.onDisplay({...displayDraft,appearance:appearanceDraft,ambient:ambientDraft});setZone(calendarDraft.zone);setStreak(calendarDraft.streak);setLinked(calendarDraft.linked);setAppearance(appearanceDraft);setAmbient(ambientDraft);}
  setBaseline(JSON.stringify({values:submitted,bands:panel==='home'?householdDraft:bands,display:panel==='display'?displayDraft:currentDisplay,calendar:panel==='display'?calendarDraft:{zone,streak,linked},appearance:panel==='display'?appearanceDraft:appearancePreference(appearance),ambient:panel==='display'?ambientDraft:ambient}));
  setMessage(c.saved);setPending(false);lock.current=false;
 }
 const countRecords=Object.values(workspace.collections).reduce((n,rows)=>n+rows.length,0)+preview.actions.length;
 const sectionSummary=(key:SettingPanel)=>drafts[key]?c.savedDraft:key==='home'?c.categoriesSelected(selected.length):key==='notifications'?c.notificationSummary(Object.values(values.notifications).filter(Boolean).length):key==='display'?c.displaySummary(c.appearanceOptions[appearancePreference(appearance)],props.display.scale):key==='luna'?c.contextSummary(Object.values(values.luna).filter(Boolean).length):key==='privacy'?c.recordsCount(countRecords):c.sections.about[1];
 const found=(Object.keys(c.sections)as SettingPanel[]).filter(key=>`${c.sections[key].join(' ')} ${c.settingsSearch[key]}`.toLowerCase().includes(query.toLowerCase().trim()));
 return <section ref={root} className="halo-settings" aria-label={c.settings}>
  {!panel?<><label className="hp-setting-search"><Search size={18} aria-hidden="true"/><span className="halo-sr-only">{c.search}</span><input type="search" value={query} placeholder={c.searchHint} onChange={e=>setQuery(e.target.value)}/></label>{query&&<button className="hp-search-clear" onClick={()=>setQuery('')}><X size={14}/>{c.clearSearch}</button>}<div className="hp-settings-list">{groups.map((group,index)=>{const visible=group.filter(key=>found.includes(key));return visible.length>0&&<section className="hp-settings-group" key={index} aria-label={c.settingGroups[index]}><h3>{c.settingGroups[index]}</h3><div>{visible.map(key=>{const Icon=icons[key];return <button key={key} className="hp-setting-row" data-setting-panel={key} onClick={()=>enter(key)}><span className={`hp-setting-symbol hp-setting-${key}`}><Icon size={21}/></span><span><strong>{c.sections[key][0]}</strong><small>{sectionSummary(key)}</small></span>{drafts[key]?<span className="hp-dirty-dot" aria-hidden="true"/>:<ChevronRight size={17} aria-hidden="true"/>}</button>;})}</div></section>;})}{!found.length&&<p className="hp-search-empty">{c.noMatch}</p>}</div></>:<>
  <button className="hp-back" aria-label={c.back} onClick={leave}><ArrowLeft size={17}/>{c.back}{dirty&&<span className="hp-dirty-dot" aria-hidden="true"/>}</button><header className="hp-panel-heading"><h2>{c.sections[panel][0]}</h2></header>
  {unavailable?<div className="hp-empty" role="status"><ShieldCheck size={32}/><p>{workspace.scenario==='loading'?c.loading:c.unknown}</p><button className="hp-text" onClick={()=>workspace.setScenario('ready')}>{c.retry}</button></div>:<>
   {panel==='home'&&<SettingsHome draft={current} change={setDraft} blocked={pending}/>}
   {panel==='notifications'&&<SettingsNotifications draft={current} change={setDraft} blocked={pending} href={props.href} onAlerts={props.onAlerts}/>}
   {panel==='display'&&<SettingsDisplay draft={current} change={setDraft} blocked={pending} display={displayDraft} onDisplay={display=>updateEdit({display})} calendar={calendarDraft} onCalendar={calendar=>updateEdit({calendar})} appearance={appearanceDraft} onAppearance={appearance=>updateEdit({appearance})} ambient={ambientDraft} onAmbient={ambient=>updateEdit({ambient})}/>}
   {panel==='luna'&&<SettingsLuna draft={current} change={setDraft} blocked={pending}/>}
   {panel==='privacy'&&<SettingsPrivacy href={props.href} blocked={blocked}/>}
   {panel==='about'&&<SettingsAbout factorHref={props.factorHref}/>}
   {!['privacy','about'].includes(panel)&&<footer className="hp-save-bar"><div><p role="status">{message||(dirty?c.dirty:'')}</p>{message===c.conflict&&<button className="hp-text" onClick={rebase}>{c.reload}</button>}</div><button className="hp-primary" disabled={pending||!dirty} onClick={()=>void save()}>{c.save}</button><button className="hp-text" disabled={pending||!dirty} onClick={()=>{clearDraft();if(panel==='home')preview.setHouseholdDraft(null);setBaseline(snapshot());setMessage('');}}>{c.cancel}</button></footer>}
  </>}
  </>}
 </section>;
}
