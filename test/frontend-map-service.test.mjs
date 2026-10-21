import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadFrontend} from './frontend-test-loader.mjs';
const {parseMapLayer,mapDistance,parseMapDistrict,mergeMapPages,parseMapComparisons}=await loadFrontend('map-service');

test('map adapter requires actual layer payload and never substitutes fixtures',()=>{
  for(const body of [{},{layer:'air'},{layer:'water',features:[]},null])assert.throws(()=>parseMapLayer(body,'air'),/invalid_map_response/);
  assert.deepEqual(parseMapLayer({layer:'air',features:[]},'air').air,[]);
});
test('map preserves actual IDs, zero and unavailable water comparisons',()=>{
  const data=parseMapLayer({layer:'water',assembled_at:'2026-10-13T11:00:00Z',quarters:['2026Q1','bad'],features:[{pwsid:'REAL-UTILITY',name:'Real Utility',lat:null,lng:-80,population:null,overall_severity:'no_data',contaminants:{PFOS:{value_ppt:0,limit_ppt:null,severity:'no_data'}},detected_unregulated:[]}],truncated:true},'water');
  assert.equal(data.water[0].pwsid,'REAL-UTILITY');assert.equal(data.water[0].contaminants.PFOS.value_ppt,0);
  assert.equal(data.water[0].contaminants.PFOS.limit_ppt,null);assert.equal(data.water[0].contaminants.PFOS.ratio,undefined);
  assert.equal(data.water[0].lng,null);assert.equal(data.water[0].population,null);assert.equal(data.partial,true);
  assert.deepEqual(data.quarters,['2026Q1']);assert.equal(data.assembledAt,'2026-10-13T11:00:00.000Z');
});
test('public map strips private home and malformed geometry stays unlocated',()=>{
  const body={layer:'air',features:[{id:'real-air',name:'Monitor',lat:999,lng:-80,aqi:0}],own_home:{lat:35,lng:-80,pwsid:'private',score:50}};
  assert.equal(parseMapLayer(body,'air',true).ownHome,null);
  const owned=parseMapLayer(body,'air');assert.equal(owned.ownHome.pwsid,'private');assert.equal(owned.air[0].lat,null);assert.equal(owned.air[0].aqi,0);
  assert.equal(mapDistance(null,35,-80),null);assert.equal(mapDistance({lat:35,lng:-80},35,-80),'0.0');
});
test('map duplicate IDs and malformed rows declare partial rather than count fabricated records',()=>{
  const data=parseMapLayer({layer:'facilities',features:[{id:'f1',name:'Site'},{id:'f1',name:'Duplicate'},null]},'facilities');
  assert.equal(data.partial,true);assert.equal(data.facilities.length,1);assert.equal(data.facilities[0].recent_violations,null);assert.equal(data.facilities[0].penalties,null);
});
test('comparison source links, methods and dates remain supplied or unknown',()=>{
  const data=parseMapLayer({layer:'air',features:[{id:'r1'}],comparisons:[{id:'r1',sourceUrl:'javascript:alert(1)',status:'available',values:[{analyte:'AQI',value:0,unit:'AQI',observedAt:'bad'}]}]},'air');
  assert.equal(data.comparisons[0].sourceUrl,null);assert.equal(data.comparisons[0].sourceVersion,null);
  assert.equal(data.comparisons[0].values[0].method,null);assert.equal(data.comparisons[0].values[0].observedAt,null);assert.equal(data.comparisons[0].values[0].value,0);
});
test('district parser rejects unsupported boundary and absent denominators',()=>{
  assert.throws(()=>parseMapDistrict({scope:'NY-01',counties:[]}),/invalid_map_response/);
  assert.throws(()=>parseMapDistrict({scope:'NC-08',counties:[],by_contaminant:{},state_comparison:{}}),/invalid_map_response/);
});

test('transport metadata and map pagination keep canonical records and reject changed snapshots',()=>{
 const first=parseMapLayer({layer:'air',features:[{id:'real-one'}],_meta:{as_of:'2026-10-13T11:00:00Z',next_cursor:'next',availability:'partial'}},'air');
 assert.equal(first.partial,true);assert.equal(first.nextCursor,'next');
 const second=parseMapLayer({layer:'air',features:[{id:'real-two'}],_meta:{as_of:'2026-10-13T11:00:00Z'}},'air');
 const merged=mergeMapPages(first,second);assert.deepEqual(merged.air.map(p=>p.id),['real-one','real-two']);assert.equal(merged.nextCursor,null);
 assert.throws(()=>mergeMapPages(first,{...second,assembledAt:'changed'}),/invalid_map_response/);
 assert.throws(()=>mergeMapPages(first,{...second,nextCursor:'next'}),/invalid_map_response/);
});

test('comparison service rejects invalid envelopes and unknown record identities',()=>{
 assert.throws(()=>parseMapComparisons({},['real-one']),/invalid_map_response/);
 assert.deepEqual(parseMapComparisons([{id:'someone-else'}],['real-one']),[]);
});
