import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The row a write route upserts is `{ ...validatedInput, <owner key>: userId }`. The owner key
// must come after the spread so that a future parser change which lets a `profile_id` or `id`
// through cannot override ownership. Behaviour is covered by the isolation suite (a body
// `profile_id` is ignored); this pins the property that keeps it true if the parser changes.
const ROUTES = [
  { file: 'app/api/journal/route.js', ownerKey: 'profile_id' },
  { file: 'app/api/profile/route.js', ownerKey: 'id' },
];

for (const { file, ownerKey } of ROUTES) {
  test(`${file}: the row's ${ownerKey} is set from the token after the validated input is spread`, () => {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const literals = source.match(/\{[^{}]*\.\.\.input\.value[^{}]*\}/g) ?? [];
    assert.equal(literals.length, 1, 'one object literal spreads the validated input');
    const [literal] = literals;

    const owner = [...literal.matchAll(new RegExp(`\\b${ownerKey}: userId\\b`, 'g'))];
    assert.equal(owner.length, 1, `${ownerKey} is set from userId exactly once`);
    assert.ok(owner[0].index > literal.indexOf('...input.value'), `${ownerKey}: userId comes after the spread`);
  });
}
