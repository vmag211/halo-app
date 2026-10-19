import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadFrontend } from './frontend-test-loader.mjs';

const sources=JSON.parse(await readFile(new URL('../public/explore/photo-sources.json',import.meta.url),'utf8'));
const {projectGuides}=await loadFrontend('explore-project-guides');
test('project photography covers diverse activities without changing guide IDs or instructions',()=>{
  assert.equal(sources.length,12); assert.equal(new Set(sources.map(source=>source.id)).size,12);
  assert.equal(projectGuides.length,19);
  assert.ok(new Set(projectGuides.map(guide=>guide.scene)).size>=10);
  for(const guide of projectGuides) assert.ok(sources.some(source=>source.id===guide.scene));
  for(const [id,scene] of [['bee-house','bee'],['solar-oven','solar'],['native-tree','tree'],['soil-test-plan','soil'],['home-compost','compost'],['community-cleanup','cleanup']]) assert.equal(projectGuides.find(guide=>guide.id===id).scene,scene);
});
test('bundled image bytes match reviewed provenance and attribution requirements',async()=>{
  let addedBytes=0;
  for(const source of sources){
    assert.match(source.file,/^[a-z-]+\.webp$/); assert.ok(source.credit && source.title && source.changes && source.license);
    assert.equal(new URL(source.source).protocol,'https:');
    const bytes=await readFile(new URL(`../public/explore/${source.file}`,import.meta.url));
    assert.equal(bytes.length,source.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'),source.sha256);
    assert.ok(bytes.length<500000);
    if(source.license==='CC BY 2.0') assert.equal(source.licenseUrl,'https://creativecommons.org/licenses/by/2.0/');
    if(!['river','trail','garden'].includes(source.id))addedBytes+=bytes.length;
  }
  assert.ok(addedBytes<1500000);
});
