import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BAND_KEYS,
  normalizeBands,
  hasAnyBand,
  priorityGroup,
  hasSensitiveGroup,
  groupPhrase,
} from "../lib/household.js";

test("BAND_KEYS has the 7 expected keys", () => {
  assert.equal(BAND_KEYS.length, 7);
  assert.deepEqual(
    [...BAND_KEYS].sort(),
    [
      "has_adult",
      "has_child",
      "has_pregnant",
      "has_respiratory",
      "has_senior",
      "has_teen",
      "has_toddler",
    ].sort()
  );
});

test("normalizeBands(null) -> all 7 keys false", () => {
  const b = normalizeBands(null);
  assert.equal(Object.keys(b).length, 7);
  for (const k of BAND_KEYS) assert.equal(b[k], false, `${k} should be false`);
});

test("normalizeBands({has_toddler:true}) -> toddler true, rest false", () => {
  const b = normalizeBands({ has_toddler: true });
  assert.equal(b.has_toddler, true);
  for (const k of BAND_KEYS) {
    if (k !== "has_toddler") assert.equal(b[k], false, `${k} should be false`);
  }
});

test("normalizeBands coerces non-true values to false", () => {
  const b = normalizeBands({
    has_toddler: 1,
    has_child: "yes",
    has_teen: undefined,
    has_adult: "true",
    has_senior: 0,
    has_pregnant: null,
    has_respiratory: false,
  });
  for (const k of BAND_KEYS) assert.equal(b[k], false, `${k} should be strictly false`);
});

test("normalizeBands ignores unknown keys", () => {
  const b = normalizeBands({ has_toddler: true, has_unicorn: true });
  assert.ok(!("has_unicorn" in b));
  assert.equal(Object.keys(b).length, 7);
});

test("hasAnyBand", () => {
  assert.equal(hasAnyBand(normalizeBands(null)), false);
  assert.equal(hasAnyBand(normalizeBands({ has_teen: true })), true);
  assert.equal(hasAnyBand(normalizeBands({ has_respiratory: true })), true);
  assert.equal(hasAnyBand({ has_adult: true }), true);
});

test("priorityGroup order: respiratory > toddler > pregnant > senior > child", () => {
  assert.equal(
    priorityGroup(normalizeBands({ has_respiratory: true, has_toddler: true })),
    "has_respiratory"
  );
  assert.equal(
    priorityGroup(normalizeBands({ has_toddler: true, has_pregnant: true })),
    "has_toddler"
  );
  assert.equal(
    priorityGroup(normalizeBands({ has_pregnant: true, has_senior: true })),
    "has_pregnant"
  );
  assert.equal(
    priorityGroup(normalizeBands({ has_senior: true, has_child: true })),
    "has_senior"
  );
  assert.equal(priorityGroup(normalizeBands({ has_child: true })), "has_child");
});

test("priorityGroup null for teen-only, adult-only, all-false", () => {
  assert.equal(priorityGroup(normalizeBands({ has_teen: true })), null);
  assert.equal(priorityGroup(normalizeBands({ has_adult: true })), null);
  assert.equal(priorityGroup(normalizeBands({ has_teen: true, has_adult: true })), null);
  assert.equal(priorityGroup(normalizeBands(null)), null);
});

test("hasSensitiveGroup: respiratory OR toddler OR senior", () => {
  assert.equal(hasSensitiveGroup(normalizeBands({ has_respiratory: true })), true);
  assert.equal(hasSensitiveGroup(normalizeBands({ has_toddler: true })), true);
  assert.equal(hasSensitiveGroup(normalizeBands({ has_senior: true })), true);
});

test("hasSensitiveGroup false for child-only/teen-only/adult-only/pregnant-only", () => {
  assert.equal(hasSensitiveGroup(normalizeBands({ has_child: true })), false);
  assert.equal(hasSensitiveGroup(normalizeBands({ has_teen: true })), false);
  assert.equal(hasSensitiveGroup(normalizeBands({ has_adult: true })), false);
  assert.equal(hasSensitiveGroup(normalizeBands(null)), false);
});

test("groupPhrase returns non-empty string for the 5 priority keys", () => {
  for (const k of ["has_respiratory", "has_toddler", "has_pregnant", "has_senior", "has_child"]) {
    const p = groupPhrase(k);
    assert.equal(typeof p, "string");
    assert.ok(p.length > 0, `${k} phrase should be non-empty`);
  }
});

test("groupPhrase returns null for non-priority / unknown keys", () => {
  assert.equal(groupPhrase("has_teen"), null);
  assert.equal(groupPhrase("has_adult"), null);
  assert.equal(groupPhrase("has_unicorn"), null);
  assert.equal(groupPhrase(undefined), null);
});
