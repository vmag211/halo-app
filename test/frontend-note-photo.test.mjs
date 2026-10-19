import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadFrontend} from './frontend-test-loader.mjs';
const {photoInputError,photoHeaderMatches}=await loadFrontend('note-photo-preview');
test('note photo permits bounded raster inputs, never SVG/PDF or empty/oversized files',()=>{for(const type of ['image/jpeg','image/png','image/webp'])assert.equal(photoInputError(type,100),null);for(const type of ['image/svg+xml','application/pdf','text/html',''])assert.ok(photoInputError(type,100));assert.ok(photoInputError('image/png',0));assert.ok(photoInputError('image/png',5*1024*1024+1));assert.equal(photoInputError('image/png',5*1024*1024),null);});
test('note photo validates file signatures instead of trusting MIME or extension',()=>{assert.equal(photoHeaderMatches('image/png',Uint8Array.from([137,80,78,71,13,10,26,10])),true);assert.equal(photoHeaderMatches('image/jpeg',Uint8Array.from([255,216,255])),true);assert.equal(photoHeaderMatches('image/webp',new TextEncoder().encode('RIFF1234WEBP')),true);assert.equal(photoHeaderMatches('image/png',new TextEncoder().encode('<script>')),false);assert.equal(photoHeaderMatches('image/jpeg',new Uint8Array()),false);});
