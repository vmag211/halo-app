'use client';
import {useEffect,useId,useRef,useState,type KeyboardEvent} from 'react';
import {Check,Monitor,Moon,Palette,Sun} from 'lucide-react';
import {useHomeWorkspace} from '@/components/homeguard/HomeWorkspaceState';
import {useProductionPreferences} from '@/components/production/ProductionPreferences';
import {appearanceMenuOptions as options,choiceApplied,displaySaveInput,motionChoice,normalizedDisplay,unkeptChoices,type MenuChoice,type MenuDisplay} from '@/lib/frontend/appearance-menu';
import {appearancePreferenceKey} from '@/lib/frontend/settings-preview';
import type {SettingsProps} from './SettingsWorkspace';
import './app-polish.css';
import './settings-refinement.css';
import './header-appearance.css';

const modeIcons={system:Monitor,light:Sun,dark:Moon};
const copy={button:'Appearance',title:'Appearance',mode:'Mode',palette:'Color theme',scale:'Text size',motion:'Motion',contrast:'Higher contrast',
 saving:'Saving…',saved:'Saved.',loading:'Your display settings are loading.',offline:'You are offline. Display changes are paused.',kept:'Your settings were saved. This connection kept the default color theme.',status:'Check save status',settings:'All display settings'};

/**
 * One header button opening the Settings display choices. Production saves each choice through the
 * same settings.save group Settings uses and applies only the canonical receipt; review mode stays local.
 */
export default function HeaderAppearanceMenu({display,onDisplay,offline,onOpenSettings}:{display:MenuDisplay;onDisplay:SettingsProps['onDisplay'];offline:boolean;onOpenSettings:()=>void}){
 const production=useProductionPreferences(),workspace=useHomeWorkspace();
 const [open,setOpen]=useState(false),[requested,setRequested]=useState<MenuChoice|null>(null),[message,setMessage]=useState('');
 const root=useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),inFlight=useRef<MenuChoice|null>(null);
 const id=useId();
 const canonical=production?.snapshot?normalizedDisplay(production.snapshot.display):display;
 const shown:MenuDisplay={...canonical,...requested};
 const blocked=offline||!!production&&(production.loading||!production.snapshot||!!production.unknown);
 // Production: one save at a time, coalescing choices made while a save is in flight, always from the latest revision.
 useEffect(()=>{
  if(!production||!requested||inFlight.current||production.pending||!production.snapshot||production.unknown)return;
  const snapshot=production.snapshot,want=requested;
  if(choiceApplied(normalizedDisplay(snapshot.display),want)){queueMicrotask(()=>setRequested(current=>current===want?null:current));return;}
  inFlight.current=want;
  queueMicrotask(()=>setMessage(copy.saving));
  void production.save(displaySaveInput(snapshot,want)).then(saved=>{
   inFlight.current=null;
   setRequested(current=>current===want||!saved?null:current);
   setMessage(saved?unkeptChoices(saved.display,want).includes('palette')?copy.kept:copy.saved:'');
  });
 },[production,requested]);
 useEffect(()=>{
  if(!open)return;
  const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
  document.addEventListener('pointerdown',outside);
  const frame=requestAnimationFrame(()=>panel.current?.querySelector<HTMLInputElement>('input:checked')?.focus({preventScroll:true}));
  return()=>{document.removeEventListener('pointerdown',outside);cancelAnimationFrame(frame);};
 },[open]);
 const close=(restore:boolean)=>{setOpen(false);if(restore)button.current?.focus();};
 const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close(true);}};
 const choose=(choice:MenuChoice)=>{
  if(blocked)return;
  if(!production){
   const next={...display,...choice};setMessage('');
   onDisplay({scale:next.scale,motion:next.motion,contrast:next.contrast,palette:next.palette,appearance:next.appearance});
   if(choice.appearance)workspace.setDraft(appearancePreferenceKey,()=>choice.appearance);
   return;
  }
  setRequested(current=>({...current,...choice}));
 };
 const status=offline?copy.offline:production&&(production.loading||!production.snapshot)&&!production.error?copy.loading:production?.error??message;
 const radios=<K extends 'appearance'|'palette'|'scale'|'motion'>(key:K,value:string)=>({type:'radio' as const,name:`${id}-${key}`,checked:(key==='motion'?motionChoice(shown.motion):shown[key])===value,'aria-disabled':blocked||undefined,onChange:()=>choose({[key]:value} as MenuChoice)});
 return <div className="halo-appearance-menu" ref={root} onKeyDown={onKeyDown} onBlur={event=>{if(open&&event.relatedTarget&&!root.current?.contains(event.relatedTarget as Node))setOpen(false);}}>
  <button ref={button} type="button" className="halo-f-icon" aria-label={copy.button} aria-haspopup="dialog" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>setOpen(!open)}><Palette size={22} aria-hidden="true"/></button>
  {open&&<div ref={panel} id={id} className="halo-appearance-popover" role="dialog" aria-label={copy.title} aria-busy={!!production?.pending||undefined}>
   <fieldset className="halo-appearance-modes"><legend>{copy.mode}</legend><div>{options.appearance.map(option=>{const Icon=modeIcons[option.value];return <label key={option.value}><input {...radios('appearance',option.value)}/><Icon size={17} aria-hidden="true"/><span>{option.label}</span></label>;})}</div></fieldset>
   <fieldset className="halo-appearance-palettes"><legend>{copy.palette}</legend><div>{options.palette.map(option=><label key={option.value} data-palette={option.value}><input {...radios('palette',option.value)}/><span className="hp-palette-swatch" aria-hidden="true"><i/><i/><i/></span><span>{option.label}</span><Check size={15} aria-hidden="true"/></label>)}</div></fieldset>
   <fieldset className="halo-appearance-segments"><legend>{copy.scale}</legend><div>{options.scale.map(option=><label key={option.value}><input {...radios('scale',option.value)}/><span>{option.label}</span></label>)}</div></fieldset>
   <fieldset className="halo-appearance-segments"><legend>{copy.motion}</legend><div>{options.motion.map(option=><label key={option.value}><input {...radios('motion',option.value)}/><span>{option.label}</span></label>)}</div></fieldset>
   <label className="hp-toggle halo-appearance-toggle"><span><strong>{copy.contrast}</strong></span><input type="checkbox" role="switch" aria-label={copy.contrast} checked={shown.contrast} aria-disabled={blocked||undefined} onChange={event=>choose({contrast:event.target.checked})}/><span className="hp-switch" aria-hidden="true"><i/></span></label>
   <div className="halo-appearance-footer"><p role="status">{status}</p>{production?.unknown&&<button type="button" className="hp-text" disabled={production.pending} onClick={()=>void production.reconcile()}>{copy.status}</button>}<button type="button" className="hp-text" onClick={()=>{setOpen(false);onOpenSettings();}}>{copy.settings}</button></div>
  </div>}
 </div>;
}
