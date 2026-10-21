import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadFrontend} from './frontend-test-loader.mjs';
import './helpers/routeLoader.mjs';
const {parseSettingsSave}=await import('../lib/settings.js');

const menu=await loadFrontend('appearance-menu');
const {validSettingsSnapshot}=await loadFrontend('production/preferences-service');
const {initialSettings}=await loadFrontend('settings-preview');
const EM_DASH=String.fromCharCode(0x2014);
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const snapshot=(display={})=>({revision:4,values:structuredClone(initialSettings),display:{appearance:'system',ambient:true,scale:'100',motion:'system',contrast:false,...display},calendar:{zone:'America/Chicago',streak:true,linked:false},unresolvedOperations:[]});

test('the menu offers exactly the Settings display choices',()=>{
 const panels=read('components/expanded/SettingsPanels.tsx'),polish=read('lib/frontend/copy/app-polish.ts');
 assert.deepEqual(menu.appearanceMenuOptions.appearance.map(o=>o.value),['system','light','dark']);
 assert.match(panels,/\(\['system','light','dark'\]as const\)\.map/);
 assert.match(polish,/appearanceOptions:\{system:'System',light:'Light',dark:'Dark'\}/);
 for(const o of menu.appearanceMenuOptions.palette)assert.ok(panels.includes(`{value:'${o.value}',label:'${o.label}'`),o.value);
 assert.equal(menu.appearanceMenuOptions.palette.length,(panels.match(/\{value:'(ocean|forest|iris)',label:/g)??[]).length);
 assert.deepEqual(menu.appearanceMenuOptions.scale.map(o=>o.value),['100','115','130','150']);
 assert.match(panels,/\['100','115','130','150'\]\.map\(\(s,i\)/);
 assert.match(polish,/sizes:\['100%','115%','130%','150%'\]/);
 assert.deepEqual(menu.appearanceMenuOptions.motion.map(o=>[o.value,o.label]),[['system','Follow device'],['reduce','Reduced motion']]);
 assert.match(polish,/motionChoices:\['Follow device','Reduced motion'\]/);
 assert.match(panels,/<option value="system">\{c\.motionChoices\[0\]\}<\/option><option value="reduce">\{c\.motionChoices\[1\]\}<\/option>/);
 assert.match(panels,/title=\{c\.contrast\}/);
 // Ambient animation is always on: the menu offers no switch for it.
 assert.ok(!Object.keys(menu.appearanceMenuOptions).includes('ambient'));
 assert.ok(!/ambient/i.test(read('components/expanded/HeaderAppearanceMenu.tsx')));
 assert.ok(!JSON.stringify(menu.appearanceMenuOptions).includes(EM_DASH));
});

test('a menu save sends the same display-group body Settings sends',()=>{
 const workspace=read('components/expanded/SettingsWorkspace.tsx');
 // Drift guard: Settings' display save is values plus display (with appearance and ambient) plus calendar.
 // Ambient was a draft before it became always on (vmag211/explore-fixes sends true); either form keeps the body shape.
 assert.match(workspace,/production\.save\(\{group:panel,values:submitted,.*\(panel==='display'\?\{display:\{\.\.\.displayDraft,appearance:appearanceDraft,ambient:(ambientDraft|true)\},calendar:calendarDraft\}:\{\}\)\}\)/);
 // A stored off value is not carried forward: ambient animation is always on.
 const current=snapshot({palette:'forest',motion:'full',ambient:false});
 const body=menu.displaySaveInput(current,{appearance:'dark'});
 assert.deepEqual(Object.keys(body).sort(),['calendar','display','group','values']);
 assert.equal(body.group,'display');
 assert.deepEqual(body.values,current.values);
 assert.deepEqual(body.calendar,current.calendar);
 assert.deepEqual(body.display,{scale:'100',motion:'full',contrast:false,palette:'forest',appearance:'dark',ambient:true});
 const parsed=parseSettingsSave({...body,operationId:'11111111-1111-4111-8111-111111111111'});
 assert.equal(parsed.ok,true,JSON.stringify(parsed.fieldErrors));
 assert.deepEqual(parsed.value.patch.display,{appearance:'dark',ambient:true,scale:'100',motion:'full',contrast:false,palette:'forest'});
});

test('every menu option produces a body the server accepts and a snapshot the client keeps',()=>{
 const choices=[...menu.appearanceMenuOptions.appearance.map(o=>({appearance:o.value})),...menu.appearanceMenuOptions.palette.map(o=>({palette:o.value})),...menu.appearanceMenuOptions.scale.map(o=>({scale:o.value})),...menu.appearanceMenuOptions.motion.map(o=>({motion:o.value})),{contrast:true},{contrast:false}];
 for(const choice of choices){
  const body=menu.displaySaveInput(snapshot(),choice);
  const parsed=parseSettingsSave({...body,operationId:'22222222-2222-4222-8222-222222222222'});
  assert.equal(parsed.ok,true,JSON.stringify(choice));
  const saved={...snapshot(),revision:5,display:body.display};
  assert.equal(validSettingsSnapshot(saved),true,JSON.stringify(choice));
  assert.deepEqual(menu.unkeptChoices(saved.display,choice),[]);
  assert.equal(menu.choiceApplied(menu.normalizedDisplay(saved.display),choice),true);
 }
});

test('a legacy snapshot without palette shows Ocean and reports a dropped palette choice',()=>{
 const legacy=snapshot();
 assert.equal(validSettingsSnapshot(legacy),true);
 assert.equal(menu.normalizedDisplay(legacy.display).palette,'ocean');
 assert.deepEqual(menu.unkeptChoices(legacy.display,{palette:'iris'}),['palette']);
 assert.deepEqual(menu.unkeptChoices(legacy.display,{palette:'iris',scale:'130'}),['palette','scale']);
 assert.equal(menu.choiceApplied(menu.normalizedDisplay(legacy.display),{palette:'ocean'}),true);
 assert.equal(menu.choiceApplied(menu.normalizedDisplay(legacy.display),{palette:'forest'}),false);
});

test('stored full motion reads as Follow device, as Settings shows it, and is kept on unrelated saves',()=>{
 assert.equal(menu.motionChoice('full'),'system');
 assert.equal(menu.motionChoice('reduce'),'reduce');
 assert.equal(menu.motionChoice('system'),'system');
 assert.equal(menu.displaySaveInput(snapshot({motion:'full'}),{scale:'115'}).display.motion,'full');
});

test('normalizedDisplay never invents values outside the reviewed sets',()=>{
 assert.deepEqual(menu.normalizedDisplay({appearance:'neon',palette:'neon',scale:'400',motion:'fast',contrast:'yes',ambient:false}),{appearance:'system',palette:'ocean',scale:'100',motion:'system',contrast:false});
});

test('the header renders the menu beside Settings in the expanded shell only, never on Settings itself',()=>{
 const preview=read('components/foundation/FoundationPreview.tsx'),component=read('components/expanded/HeaderAppearanceMenu.tsx');
 assert.match(preview,/\{showExpanded && route !== 'settings' && <HeaderAppearanceMenu [^}]*\}\} onDisplay=\{onDisplay\} offline=\{offline\} onOpenSettings=\{\(\)=>navigate\('settings'\)\}\/>\}\{route !== 'settings' && <button className="halo-f-icon" aria-label=\{c\.labels\.settings\}/);
 assert.match(component,/className="halo-f-icon" aria-label=\{copy\.button\} aria-haspopup="dialog" aria-expanded=\{open\}/);
 assert.match(component,/production\.save\(displaySaveInput\(snapshot,want\)\)/);
 assert.ok(!component.includes(EM_DASH));
 assert.ok(!read('lib/frontend/appearance-menu.ts').includes(EM_DASH));
 assert.ok(!read('components/expanded/header-appearance.css').includes(EM_DASH));
});
