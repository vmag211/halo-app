'use client';

import HaloLoading from '@/components/ui/HaloLoading';
import {useSearchParams} from 'next/navigation';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Bell,BookOpen,ChevronRight,House,Search,ShieldCheck,SlidersHorizontal,X} from 'lucide-react';
import {useHomeDraft,useHomeWorkspace} from '@/components/homeguard/HomeWorkspaceState';
import {usePreviewHousehold} from '@/components/foundation/PreviewHousehold';
import LunaMark from '@/components/foundation/LunaMark';
import {homeMemberKeys,memberCatalog} from '@/lib/frontend/home-household';
import type {FactorKey} from '@/lib/frontend/factor-preview';
import {initialSettings,mergeUnedited,appearancePreference,appearancePreferenceKey,colorPalette,type ColorPalette,type AppearancePreference,type SettingsValues} from '@/lib/frontend/settings-preview';
import {polishCopy as c} from '@/lib/frontend/copy/app-polish';
import {useExpandedPreview} from './ExpandedPreviewState';
import {SettingsHome,SettingsNotifications,SettingsDisplay,SettingsLuna,SettingsAbout} from './SettingsPanels';
import SettingsPrivacy from './SettingsPrivacy';
import {useProductionPreferences} from '@/components/production/ProductionPreferences';
import './app-polish.css';
import './settings-refinement.css';

export type SettingPanel=keyof typeof c.sections;
export type SettingsProps={offline:boolean;href:(tab:string,destination?:string)=>string;factorHref:(factor:FactorKey)=>string;onAlerts:()=>void;display:{scale:string;motion:'system'|'full'|'reduce';contrast:boolean;appearance?:string;ambient?:boolean;palette?:ColorPalette};onDisplay:(next:{scale:string;motion:'system'|'full'|'reduce';contrast:boolean;appearance?:string;ambient?:boolean;palette?:ColorPalette})=>void};
export type PanelProps={draft:SettingsValues;change:(next:SettingsValues)=>void;blocked:boolean};
export type CalendarSettings={zone:string;streak:boolean;linked:boolean};
type SettingEdit={values:SettingsValues;baseline:string;display?:SettingsProps['display'];calendar?:CalendarSettings;appearance?:AppearancePreference;ambient?:boolean};
const icons={home:House,notifications:Bell,display:SlidersHorizontal,luna:LunaMark,privacy:ShieldCheck,about:BookOpen};
const groups:SettingPanel[][]=[['home','display','notifications','luna'],['privacy','about']];

export default function SettingsWorkspace(props:SettingsProps){
 const production=useProductionPreferences();const openQuery=useSearchParams().get('open'),requestedPanel=openQuery==='household'?'home':openQuery;
 const panel:SettingPanel|null=requestedPanel&&Object.hasOwn(c.sections,requestedPanel)?requestedPanel as SettingPanel:null;
 const workspace=useHomeWorkspace(),preview=useExpandedPreview()!;const {bands,setBand}=usePreviewHousehold();
 const [values,setValues]=useHomeDraft<SettingsValues>('settings:values',initialSettings);
 const [drafts,setDrafts]=useHomeDraft<Partial<Record<SettingPanel,SettingEdit>>>('settings:edits',{});
 const [appearance,setAppearance]=useHomeDraft<AppearancePreference>(appearancePreferenceKey,appearancePreference(props.display.appearance));
 const [ambient,setAmbient]=useHomeDraft('halo-ambient',props.display.ambient??true);
 const currentDisplay={scale:props.display.scale,motion:props.display.motion,contrast:props.display.contrast,palette:colorPalette(props.display.palette)};
 const [query,setQuery]=useState(''),[message,setMessage]=useState('');
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
 const unavailable=production?production.loading||!production.snapshot:['loading','error'].includes(workspace.scenario);
 const blocked=props.offline||workspace.pending||pending||!!production&&(production.loading||production.pending||!!production.unknown||!production.snapshot)||['offline','loading','error','save-error','conflict'].includes(workspace.scenario)||preview.fail;
 const enteredPanel=useRef<SettingPanel|null>(null);
 const root=useRef<HTMLElement|null>(null);
 const opener=useRef<SettingPanel|null>(null);
 const snapshot=()=>JSON.stringify({values,bands,display:currentDisplay,calendar:{zone,streak,linked},appearance:appearancePreference(appearance),ambient});
 const initialBaseline=snapshot();
 useEffect(()=>{
  if(!panel){enteredPanel.current=null;return;}
  if(enteredPanel.current===panel||production&&!production.snapshot)return;
  enteredPanel.current=panel;opener.current=panel;
  queueMicrotask(()=>{setBaseline(drafts[panel]?.baseline??initialBaseline);setMessage('');});
 },[panel,production,initialBaseline,drafts]);
 useEffect(()=>{if(!panel)return;const frame=requestAnimationFrame(()=>root.current?.querySelector<HTMLHeadingElement>('.hp-panel-heading h2')?.focus({preventScroll:true}));return()=>cancelAnimationFrame(frame);},[panel]);
 function enter(next:SettingPanel,replace=false){
  opener.current=next;setMessage('');setBaseline(drafts[next]?.baseline??snapshot());
  const url=new URL(location.href);url.searchParams.set('open',next);
  // Pass only our marker. Reusing Next's internal history flags bypasses its URL subscription.
  const state=replace?(history.state?.haloSettingsPanel?{haloSettingsPanel:true}:null):{haloSettingsPanel:true};
  history[replace?'replaceState':'pushState'](state,'',`${url.pathname}${url.search}${url.hash}`);
 }
 function rebase(){const previous=JSON.parse(baseline),nextBaseline=snapshot();updateEdit({values:mergeUnedited(current,previous.values,values),baseline:nextBaseline,...(panel==='display'?{display:mergeUnedited(displayDraft,previous.display,currentDisplay),calendar:mergeUnedited(calendarDraft,previous.calendar,{zone,streak,linked}),appearance:mergeUnedited(appearanceDraft,previous.appearance,appearancePreference(appearance)),ambient:mergeUnedited(ambientDraft,previous.ambient,ambient)}:{})});if(panel==='home')preview.setHouseholdDraft(mergeUnedited(householdDraft,previous.bands,bands));setBaseline(nextBaseline);setMessage(c.latestKept);}
 useEffect(()=>{if(panel||!opener.current)return;const frame=requestAnimationFrame(()=>root.current?.querySelector<HTMLButtonElement>(`[data-setting-panel="${opener.current}"]`)?.focus({preventScroll:true}));return()=>cancelAnimationFrame(frame);},[panel]);
 function leave(){
  if(pending||workspace.pending)return;
  if(history.state?.haloSettingsPanel){history.back();return;}
  const url=new URL(location.href);url.searchParams.delete('open');
  history.replaceState(null,'',`${url.pathname}${url.search}${url.hash}`);
 }
 async function save(){
  if(lock.current)return;
  if(blocked||!navigator.onLine){setMessage(workspace.scenario==='conflict'?c.conflict:props.offline||workspace.scenario==='offline'||!navigator.onLine?c.offline:c.failed);return;}
  if(panel==='home'&&current.home.year&&!/^\d{4}$/.test(current.home.year)||panel==='home'&&current.home.year&&(Number(current.home.year)<1000||Number(current.home.year)>new Date().getFullYear())){setMessage(c.yearError);return;}
  if(panel==='notifications'&&current.quiet.enabled&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(current.quiet.from)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(current.quiet.to)||current.quiet.from===current.quiet.to)){setMessage(c.quietError);return;}
  if(snapshot()!==baseline){setMessage(c.conflict);return;}
  lock.current=true;setPending(true);
  // Review mode stays local. Production applies only its canonical receipt.
  let submitted=panel==='home'?{...values,home:current.home}:panel==='notifications'?{...values,notifications:current.notifications,quiet:current.quiet}:panel==='luna'?{...values,luna:current.luna}:panel==='display'?{...values,language:current.language}:values;
  let acceptedDisplay=displayDraft,acceptedCalendar=calendarDraft,acceptedAppearance=appearanceDraft,acceptedAmbient=ambientDraft;
  if(production){const saved=await production.save({group:panel,values:submitted,...(panel==='home'?{household:householdDraft}:{}),...(panel==='display'?{display:{...displayDraft,appearance:appearanceDraft,ambient:true},calendar:calendarDraft}:{})});if(!saved){setPending(false);lock.current=false;return;}submitted=saved.values;acceptedDisplay={scale:saved.display.scale,motion:saved.display.motion,contrast:saved.display.contrast,palette:colorPalette(saved.display.palette)};acceptedCalendar=saved.calendar;acceptedAppearance=saved.display.appearance;acceptedAmbient=saved.display.ambient;if(panel==='home'||(panel==='display'&&submitted.language!==values.language))window.dispatchEvent(new Event('halo:settings-changed'));}
  setValues(submitted);clearDraft();
  if(panel==='home'&&!production){homeMemberKeys.forEach(key=>setBand(key,householdDraft[memberCatalog[key].band]));preview.setHouseholdDraft(null);}
  if(panel==='display'){props.onDisplay({...acceptedDisplay,appearance:acceptedAppearance,ambient:acceptedAmbient});setZone(acceptedCalendar.zone);setStreak(acceptedCalendar.streak);setLinked(acceptedCalendar.linked);setAppearance(acceptedAppearance);setAmbient(acceptedAmbient);}
  setBaseline(JSON.stringify({values:submitted,bands:panel==='home'?householdDraft:bands,display:panel==='display'?acceptedDisplay:currentDisplay,calendar:panel==='display'?acceptedCalendar:{zone,streak,linked},appearance:panel==='display'?acceptedAppearance:appearancePreference(appearance),ambient:panel==='display'?acceptedAmbient:ambient}));
  setMessage(panel==='display'&&colorPalette(displayDraft.palette)!==colorPalette(acceptedDisplay.palette)?'Your settings were saved. This connection kept the default color theme.':c.saved);setPending(false);lock.current=false;
 }
 useEffect(()=>{if(production?.conflict)queueMicrotask(()=>setMessage(c.conflict));},[production?.conflict]);
 const countRecords=Object.values(workspace.collections).reduce((n,rows)=>n+rows.length,0)+preview.actions.length;
 const sectionSummary=(key:SettingPanel)=>drafts[key]?c.savedDraft:key==='home'?c.categoriesSelected(selected.length):key==='notifications'?c.notificationSummary(Object.values(values.notifications).filter(Boolean).length):key==='display'?c.displaySummary(c.appearanceOptions[appearancePreference(appearance)],props.display.scale):key==='luna'?c.contextSummary(Object.values(values.luna).filter(Boolean).length):key==='privacy'?c.recordsCount(countRecords):c.sections.about[1];
 const found=(Object.keys(c.sections)as SettingPanel[]).filter(key=>`${c.sections[key].join(' ')} ${c.settingsSearch[key]}`.toLowerCase().includes(query.toLowerCase().trim()));
 return <section ref={root} className="halo-settings" data-panel-open={!!panel} aria-label={c.settings}>
  {panel&&<nav className="hp-settings-nav" aria-label="Settings sections">{(Object.keys(c.sections)as SettingPanel[]).map(key=>{const Icon=icons[key];return <button key={key} disabled={pending} aria-current={panel===key?'page':undefined} onClick={()=>panel!==key&&enter(key,true)}><Icon size={18} aria-hidden="true"/><span>{c.sections[key][0]}</span>{drafts[key]&&<span className="hp-dirty-dot" aria-label="Unsaved changes"/>}</button>;})}</nav>}
  <div className="hp-settings-content">
  {!panel?<><label className="hp-setting-search"><Search size={18} aria-hidden="true"/><span className="halo-sr-only">{c.search}</span><input type="search" value={query} placeholder={c.searchHint} onChange={e=>setQuery(e.target.value)}/></label>{query&&<button className="hp-search-clear" onClick={()=>setQuery('')}><X size={14}/>{c.clearSearch}</button>}<div className="hp-settings-list">{groups.map((group,index)=>{const visible=group.filter(key=>found.includes(key));return visible.length>0&&<section className="hp-settings-group" key={index} aria-label={c.settingGroups[index]}><h2>{c.settingGroups[index]}</h2><div>{visible.map(key=>{const Icon=icons[key];return <button key={key} className="hp-setting-row" data-setting-panel={key} onClick={()=>enter(key)}><span className={`hp-setting-symbol hp-setting-${key}`}><Icon size={21}/></span><span><strong>{c.sections[key][0]}</strong><small>{sectionSummary(key)}</small></span>{drafts[key]?<span className="hp-dirty-dot" aria-hidden="true"/>:<ChevronRight size={17} aria-hidden="true"/>}</button>;})}</div></section>;})}{!found.length&&<p className="hp-search-empty">{c.noMatch}</p>}</div></>:<>
  <button className="hp-back" aria-label={c.back} onClick={leave}><ArrowLeft size={17}/>{c.back}{dirty&&<span className="hp-dirty-dot" aria-hidden="true"/>}</button><header className="hp-panel-heading"><h2 tabIndex={-1}>{c.sections[panel][0]}</h2></header>
  {production?.error&&<div className="hp-feedback" role="status"><p>{production.error}</p><button className="hp-text" disabled={production.pending} onClick={()=>production.unknown?void production.reconcile():production.retry()}>{production.unknown?'Check save status':c.retry}</button></div>}
  {unavailable?<div className="hp-empty">{production?.loading||workspace.scenario==='loading'?<HaloLoading layout="panel" label={c.loading}/>:<><ShieldCheck size={32}/><p role="status">{c.unknown}</p></>}<button className="hp-text" onClick={()=>production?production.retry():workspace.setScenario('ready')}>{c.retry}</button></div>:<>
   {panel==='home'&&<SettingsHome draft={current} change={setDraft} blocked={pending}/>}
   {panel==='notifications'&&<SettingsNotifications draft={current} change={setDraft} blocked={pending} href={props.href} onAlerts={props.onAlerts}/>}
   {panel==='display'&&<SettingsDisplay draft={current} change={setDraft} blocked={pending} display={displayDraft} onDisplay={display=>updateEdit({display})} calendar={calendarDraft} onCalendar={calendar=>updateEdit({calendar})} appearance={appearanceDraft} onAppearance={appearance=>updateEdit({appearance})} onAmbient={ambient=>updateEdit({ambient})}/>}
   {panel==='luna'&&<SettingsLuna draft={current} change={setDraft} blocked={pending} writeBlocked={blocked}/>}
   {panel==='privacy'&&<SettingsPrivacy href={props.href} blocked={blocked}/>}
   {panel==='about'&&<SettingsAbout factorHref={props.factorHref}/>}
   {!['privacy','about'].includes(panel)&&<footer className="hp-save-bar"><div><p role="status">{message||(dirty?c.dirty:'')}</p>{message===c.conflict&&<button className="hp-text" disabled={production?.loading} onClick={rebase}>{c.reload}</button>}</div><button className="hp-primary" aria-busy={pending||undefined} disabled={pending||!dirty} onClick={()=>void save()}>{pending&&<span className="halo-spinner" aria-hidden="true"/>}{c.save}</button><button className="hp-text" disabled={pending||!dirty} onClick={()=>{clearDraft();if(panel==='home')preview.setHouseholdDraft(null);setBaseline(snapshot());setMessage('');}}>{c.cancel}</button></footer>}
  </>}
  </>}
  </div>
 </section>;
}
