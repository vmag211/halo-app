import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadFrontend} from './frontend-test-loader.mjs';
const {publicOrigin}=await loadFrontend('public-origin');
test('public canonical metadata requires an explicit HTTPS origin without private URL context',()=>{
 assert.equal(publicOrigin('https://owned.example.org/'),'https://owned.example.org');
 for(const input of [undefined,'','bad','http://owned.example.org','https://localhost','https://127.0.0.1','https://[::1]','https://user:secret@owned.example.org','https://owned.example.org/app','https://owned.example.org/?address=private','https://owned.example.org/#private'])assert.equal(publicOrigin(input),null);
});
