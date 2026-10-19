import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadFrontend} from './frontend-test-loader.mjs';
const {previewOverviewScore}=await loadFrontend('overview-preview');
test('shared overview fixtures keep Today and Homeguard distinct',()=>{assert.equal(previewOverviewScore(false,'shell').score,74);assert.equal(previewOverviewScore(true,'shell').score,58);});
test('missing overview data is null, never an all-clear',()=>{for(const home of [true,false]){assert.equal(previewOverviewScore(home,'no-data').score,null);assert.equal(previewOverviewScore(home,'no-data').severity,'no_data');}});
test('zero and full-score fixtures retain their real numeric endpoints',()=>{for(const home of [true,false]){assert.equal(previewOverviewScore(home,'score-zero').score,0);for(const scenario of ['score-full','contribution-zero'])assert.equal(previewOverviewScore(home,scenario).score,100);}});
test('partial and dated fixtures do not invent score trends',()=>{const value=previewOverviewScore(true,'partial');assert.equal(value.partial,true);assert.equal(value.score,58);assert.equal(value.asOf,'Updated September 30, 2026');assert.equal(value.trend,undefined);});
