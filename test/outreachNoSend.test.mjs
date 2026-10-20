/**
 * B17's two promises that are not about one request (docs/backend/plans/b17-outreach-preparation.md):
 *
 * 1. NOTHING SENDS. No B17 file imports a mail, OAuth, HTTP or socket
 *    module, calls fetch, or reads a provider secret, and the send and
 *    connect routes refuse without reading their body. (The route suite,
 *    test/routesOutreachDb.test.mjs, also runs every route with global fetch
 *    blocked and asserts nothing tried.)
 * 2. THE DIRECTORY IS OFFICIAL. Every contact is an office with an https
 *    source page; no email is a person's or a constructed one; every answer
 *    for every county, topic, recipient and water context passes the
 *    client's own validators.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFrontend } from './frontend-test-loader.mjs';
import directory from '../lib/data/ncOutreachContacts.json' with { type: 'json' };
import counties from '../lib/data/ncCounties.json' with { type: 'json' };
import { RECIPIENTS, TOPICS, WATERS, publicContext, resolveContacts } from '../lib/outreach.js';
import { placeById } from '../lib/places.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { validContacts } = await loadFrontend('production/explore-service');
const { validOutreachEvidence } = await loadFrontend('production/outreach-service');

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}
const B17_FILES = [path.join(ROOT, 'lib/outreach.js'), ...files(path.join(ROOT, 'app/api/outreach'))];

test('no B17 file can send: no mail, OAuth, HTTP or socket module, no fetch, no provider secret', () => {
  assert.equal(B17_FILES.length, 8, 'lib/outreach.js and the seven route files');
  const ALLOWED_IMPORTS = /^(next\/server|node:crypto|@\/lib\/(serverAuth|apiErrors|validate|features|operations|outreach|exploreArea|workspaceStore)|\.\/(apiErrors|validate|places|geoContainment)\.js|\.\/data\/(ncOutreachContacts|ncWaterStewardship)\.json)$/;
  for (const file of B17_FILES) {
    const source = readFileSync(file, 'utf8');
    const name = path.relative(ROOT, file);
    for (const [, specifier] of source.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)) assert.match(specifier, ALLOWED_IMPORTS, `${name} imports ${specifier}`);
    assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|require\(|import\(/, `${name} makes no request and loads nothing at run time`);
    assert.doesNotMatch(source, /nodemailer|smtp|sendgrid|mailgun|resend\.com|googleapis|gmail\.com\/|accounts\.google\.com|oauth2\/|client_secret/i, `${name} names no mail or OAuth provider`);
    assert.doesNotMatch(source, /process\.env/, `${name} reads no secret (the flag is read through lib/features.js)`);
    assert.ok(!source.includes(String.fromCharCode(0x2014)), `${name} has no em dash`);
  }
  // connect and send answer before reading the request: neither route reads the body at all.
  for (const route of ['app/api/outreach/connect/route.js']) assert.doesNotMatch(readFileSync(path.join(ROOT, route), 'utf8'), /readJsonBody|request\.(json|text|formData)\(/);
  const messages = readFileSync(path.join(ROOT, 'app/api/outreach/messages/route.js'), 'utf8');
  const post = messages.slice(messages.indexOf('export async function POST'));
  assert.doesNotMatch(post, /readJsonBody|request\.(json|text|formData)\(|runOperation|supabaseAdmin/);
});

test('the directory: official offices only, https sources, no person\'s or constructed email, provenance for every input', () => {
  const text = JSON.stringify(directory);
  assert.ok(!text.includes(String.fromCharCode(0x2014)));
  for (const input of Object.values(directory.source.inputs)) {
    assert.match(input.url, /^https:\/\//);
    assert.equal(input.retrieved, directory.retrieved);
    assert.match(input.sha256, /^[0-9a-f]{64}$/);
    assert.ok(input.bytes > 1000);
  }
  // The only addresses anywhere in the file: the organizational mailboxes on official pages.
  const emails = [...text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(emails)], ['state.parks@ncparks.gov']);
  for (const office of directory.statewide) {
    assert.match(office.url, /^https:\/\//);
    assert.ok(office.email === null || office.email === 'state.parks@ncparks.gov', office.id);
    assert.ok(directory.source.inputs[office.source], office.id);
    assert.equal(office.url, new URL(directory.source.inputs[office.source].url).href);
  }
  assert.deepEqual(directory.counties.map((c) => c.id).sort(), counties.counties.map((c) => c.geoid).sort());
  for (const county of directory.counties) {
    assert.match(county.health.url, /^https:\/\//, county.title);
    assert.match(county.health.phone, /^\d{3}-\d{3}-\d{4}$/, county.title);
    assert.ok(county.health.url === county.health.listedWebsite || county.health.url === directory.directoryUrl, `${county.title}: its own https site, or the directory page`);
    assert.match(county.extension.url, /^https:\/\/[a-z]+\.ces\.ncsu\.edu\/$/, county.title);
  }
});

test('every county, topic, recipient and water context: the answer passes the client\'s validator, names no guessed address, and says when nothing is known', () => {
  let checked = 0;
  const areas = [null, ...counties.counties.map((c) => placeById(`us-county:${c.geoid}`))];
  for (const place of areas) {
    for (const topic of TOPICS) {
      for (const water of WATERS) {
        for (const recipient of RECIPIENTS) {
          const answer = resolveContacts({ topic, recipient, water, place });
          assert.ok(validContacts(answer), `${topic} ${recipient} ${water} ${place?.label}`);
          assert.ok(answer.contacts.every((c) => c.email === null || c.email === 'state.parks@ncparks.gov'));
          assert.equal(answer.coverage, answer.contacts.length ? 'matched' : 'none');
          if (!answer.contacts.length) assert.ok(answer.message && !answer.message.includes(String.fromCharCode(0x2014)));
          assert.equal(new Set(answer.contacts.map((c) => c.id)).size, answer.contacts.length);
          checked += 1;
        }
        const evidence = publicContext({ topic, water, place });
        assert.ok(validOutreachEvidence(evidence), `${topic} ${water} ${place?.label}`);
        assert.equal(evidence.complete, true);
      }
    }
  }
  assert.equal(checked, 101 * TOPICS.length * WATERS.length * RECIPIENTS.length);
});
