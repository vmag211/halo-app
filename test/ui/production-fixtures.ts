import type {Page} from '@playwright/test';
import {jsonRoute,mockStage,stageProfile,type StageMockOptions} from './stage-fixtures';

// Test-only fixtures. No production module imports these values.
export const homeId='00000000-0000-4000-8000-000000000002';
export const settingsSnapshot={revision:1,values:{home:{year:'1975',water:'utility',tenure:'renter'},notifications:{air_quality_change:true,weather_advisory:true,new_water_results:true,radon_season:true,season_summary:true},quiet:{enabled:false,from:'21:00',to:'08:00',zone:'America/New_York'},luna:{tasks:true,home:false,projects:true},language:'en'},display:{appearance:'dark',ambient:false,scale:'100',motion:'reduce',contrast:false},calendar:{zone:'America/New_York',streak:false,linked:true},unresolvedOperations:[]};
export async function mockProduction(page:Page,overrides:StageMockOptions['overrides']={}){
 return mockStage(page,{overrides:{
  '/api/profile':route=>jsonRoute(route,{...stageProfile,home_context:{id:homeId,revision:1},profile:{...stageProfile.profile,home_context_id:homeId}}),
  '/api/frontend/workspace':route=>jsonRoute(route,{records:[],revision:1,availability:'ready',complete:true,pendingOperations:[]}),
  '/api/frontend/actions':route=>jsonRoute(route,{actions:[],metas:{},unresolvedOperations:[]}),
  '/api/settings':route=>jsonRoute(route,settingsSnapshot),
  '/api/alerts':route=>jsonRoute(route,{alerts:[],count:0,unread:0,items:[],unresolvedOperations:[]}),
  '/api/week/changes':route=>jsonRoute(route,{changes:[],unresolvedOperations:[]}),
  '/api/privacy/status':route=>jsonRoute(route,{unresolvedOperations:[]}),
  '/api/account':(route,url)=>{const feature=url.searchParams.get('feature')??'home';return jsonRoute(route,{feature,revision:1,unresolvedOperations:[],enabled:false,reason:'Connection not configured.',...(feature==='home'?{home:{current:null,candidates:[],portableTasks:[],history:[],review:null}}:feature==='recovery'?{recovery:{method:null,challenge:null,devices:[]}}:feature==='device'?{device:{registration:null,vapidPublicKey:null}}:{connection:{status:'disconnected',maskedAccount:null,scopes:[],authorization:null}})});},
  '/api/projects/generations/current':route=>jsonRoute(route,{data:null}),
  '/api/explore/area':route=>jsonRoute(route,{revision:1,place:null}),
  '/api/outreach/context':route=>jsonRoute(route,{revision:1,availability:'empty',entries:[]}),
  '/api/capabilities':route=>jsonRoute(route,{capabilities:{}}),
  '/api/luna/capabilities':route=>jsonRoute(route,{available:false,providerLabel:'Not connected',retentionSummary:'No assistant is configured.',publicRetrieval:false,context:{tasks:false,home:false,projects:false},tools:[]}),
  '/api/luna/conversations':route=>jsonRoute(route,{id:'empty-conversation',revision:1,messages:[],pendingRequest:null,unresolvedOperations:{}}),
  '/api/map':(route,url)=>jsonRoute(route,{layer:url.searchParams.get('layer')??'water',features:[],assembled_at:'2026-10-13T14:00:00Z'}),
  ...overrides,
 }});
}

/** Compatibility shape for source-evidence regressions carried from StageApp. */
export function mockProductionStage(page:Page,options:StageMockOptions={}){return mockProduction(page,options.overrides);}
