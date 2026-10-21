/** The header appearance menu: the Settings display options, saved through the same settings.save group. */
import {appearancePreference,colorPalette,type AppearancePreference,type ColorPalette} from './settings-preview';
import type {SettingsSnapshot} from './production/preferences-service';

export type TextScale='100'|'115'|'130'|'150';
export type MenuDisplay={appearance:AppearancePreference;palette:ColorPalette;scale:string;motion:'system'|'full'|'reduce';contrast:boolean;ambient:boolean};
export type MenuChoice=Partial<MenuDisplay>;

/** Exactly the choices SettingsDisplay offers (SettingsPanels.tsx), no more. */
export const appearanceMenuOptions={
 appearance:[{value:'system',label:'System'},{value:'light',label:'Light'},{value:'dark',label:'Dark'}],
 palette:[{value:'ocean',label:'Ocean'},{value:'forest',label:'Forest'},{value:'iris',label:'Iris'}],
 scale:[{value:'100',label:'100%'},{value:'115',label:'115%'},{value:'130',label:'130%'},{value:'150',label:'150%'}],
 motion:[{value:'system',label:'Follow device'},{value:'reduce',label:'Reduced motion'}],
} as const;

/** Settings shows a stored 'full' motion as Follow device; the menu does the same. */
export const motionChoice=(motion:MenuDisplay['motion'])=>motion==='reduce'?'reduce':'system';

export function normalizedDisplay(display:{appearance?:unknown;palette?:unknown;scale?:unknown;motion?:unknown;contrast?:unknown;ambient?:unknown}):MenuDisplay{
 const scale=['100','115','130','150'].includes(String(display.scale))?String(display.scale):'100';
 const motion=display.motion==='reduce'||display.motion==='full'?display.motion:'system';
 return {appearance:appearancePreference(display.appearance),palette:colorPalette(display.palette),scale,motion,contrast:display.contrast===true,ambient:display.ambient!==false};
}

/** The same body SettingsWorkspace sends for the display group: canonical values and calendar, display with every key. */
export function displaySaveInput(snapshot:SettingsSnapshot,choice:MenuChoice){
 const display={...normalizedDisplay(snapshot.display),...choice};
 return {group:'display' as const,values:snapshot.values,display:{scale:display.scale,motion:display.motion,contrast:display.contrast,palette:display.palette,appearance:display.appearance,ambient:display.ambient},calendar:snapshot.calendar};
}

/** The fields of a choice the canonical receipt did not keep (a connection without palette keeps Ocean). */
export function unkeptChoices(saved:SettingsSnapshot['display'],choice:MenuChoice):(keyof MenuDisplay)[]{
 const kept=normalizedDisplay(saved);
 return (Object.keys(choice) as (keyof MenuDisplay)[]).filter(key=>kept[key]!==choice[key]);
}

/** True when nothing in the choice differs from what is already shown, so no save is needed. */
export function choiceApplied(display:MenuDisplay,choice:MenuChoice){return (Object.keys(choice) as (keyof MenuDisplay)[]).every(key=>display[key]===choice[key]);}
