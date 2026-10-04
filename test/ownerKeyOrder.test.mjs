import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The row a write route upserts is `{ ...validatedInput, <owner key>: userId }` (journal,
// profile, notification preferences, push subscription). The owner key must come after the
// spread so that a future parser change which lets a `profile_id` or `id` through cannot
// override ownership. Behaviour is covered by the isolation suite (a body `profile_id` is
// ignored); this pins the property that keeps it true if a parser changes.
const ROUTES = [
  { file: 'app/api/journal/route.js', ownerKey: 'profile_id', spread: '...input.value' },
  { file: 'app/api/profile/route.js', ownerKey: 'id', spread: '...input.value' },
  { file: 'app/api/notifications/route.js', ownerKey: 'profile_id', spread: '...input.value' },
  { file: 'app/api/push/subscribe/route.js', ownerKey: 'profile_id', spread: '...v.value' },
];

for (const { file, ownerKey, spread } of ROUTES) {
  test(`${file}: the row's ${ownerKey} is set from the token after the validated input is spread`, () => {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const escaped = spread.replace(/[.]/g, '\\.');
    const literals = source.match(new RegExp(`\\{[^{}]*${escaped}[^{}]*\\}`, 'g')) ?? [];
    assert.equal(literals.length, 1, 'one object literal spreads the validated input');
    const [literal] = literals;

    const owner = [...literal.matchAll(new RegExp(`\\b${ownerKey}: userId\\b`, 'g'))];
    assert.equal(owner.length, 1, `${ownerKey} is set from userId exactly once`);
    assert.ok(owner[0].index > literal.indexOf(spread), `${ownerKey}: userId comes after the spread`);
  });
}
