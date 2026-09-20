import { test } from "node:test";
import assert from "node:assert/strict";
import { explain } from "../lib/explain.js";
import { normalizeBands } from "../lib/household.js";

const GENERAL = normalizeBands(null);

test("unknown metric -> empty string", () => {
  assert.equal(explain("nonsense", "moderate", GENERAL), "");
  assert.equal(explain("", "good", GENERAL), "");
});

test("general fallback with no group override", () => {
  const s = explain("air", "moderate", GENERAL);
  assert.equal(s, "Moderate. Fine for most people.");
});

test("group override wins and differs from general (air/elevated respiratory)", () => {
  const general = explain("air", "elevated", GENERAL);
  const withResp = explain("air", "elevated", normalizeBands({ has_respiratory: true }));
  assert.notEqual(withResp, general);
  assert.ok(/asthma/i.test(withResp));
});

test("priority: respiratory beats toddler for air/elevated", () => {
  const both = explain(
    "air",
    "elevated",
    normalizeBands({ has_respiratory: true, has_toddler: true })
  );
  const respOnly = explain("air", "elevated", normalizeBands({ has_respiratory: true }));
  assert.equal(both, respOnly);
  assert.ok(/asthma/i.test(both));
});

test("falls back to general when the group has no override for that word", () => {
  // has_respiratory has no override for air/good, so general is used.
  const withResp = explain("air", "good", normalizeBands({ has_respiratory: true }));
  const general = explain("air", "good", GENERAL);
  assert.equal(withResp, general);
});

test("no sentence contains an exclamation mark", () => {
  const metrics = ["air", "uv", "pollen", "mold", "lead"];
  const words = ["good", "moderate", "elevated", "high", "severe", "no_data"];
  const bandSets = [
    GENERAL,
    normalizeBands({ has_respiratory: true }),
    normalizeBands({ has_toddler: true }),
    normalizeBands({ has_senior: true }),
    normalizeBands({ has_child: true }),
    normalizeBands({ has_pregnant: true }),
  ];
  for (const m of metrics) {
    for (const w of words) {
      for (const b of bandSets) {
        const s = explain(m, w, b);
        assert.ok(!s.includes("!"), `explain(${m},${w}) should have no "!": "${s}"`);
      }
    }
  }
});

test("accepts legacy severity words without crashing", () => {
  // action_needed -> severe; air/severe exists.
  const s = explain("air", "action_needed", GENERAL);
  assert.equal(s, explain("air", "severe", GENERAL));
  // unhealthy -> high
  assert.equal(explain("air", "unhealthy", GENERAL), explain("air", "high", GENERAL));
  // unknown legacy -> no_data
  assert.equal(explain("air", "unknown", GENERAL), explain("air", "no_data", GENERAL));
});

test("no_data word yields the general no_data sentence", () => {
  assert.equal(
    explain("uv", "no_data", GENERAL),
    "We couldn't get a UV reading for your area right now."
  );
});

test("bands undefined/null does not crash and uses general", () => {
  assert.equal(explain("air", "moderate", undefined), "Moderate. Fine for most people.");
  assert.equal(explain("air", "moderate", null), "Moderate. Fine for most people.");
});

test("toddler override applies for uv/elevated", () => {
  const s = explain("uv", "elevated", normalizeBands({ has_toddler: true }));
  const general = explain("uv", "elevated", GENERAL);
  assert.notEqual(s, general);
  assert.ok(/youngest/i.test(s));
});

test("returns a non-empty string for every known metric/word/general", () => {
  const metrics = ["air", "uv", "pollen", "mold", "lead"];
  const words = ["good", "moderate", "elevated", "high", "severe", "no_data"];
  for (const m of metrics) {
    for (const w of words) {
      const s = explain(m, w, GENERAL);
      // lead has no general "moderate"; but our words list matches lead's keys
      // (lead lacks "moderate"); ensure we still get a string (falls back to no_data).
      assert.equal(typeof s, "string");
      assert.ok(s.length > 0, `explain(${m},${w}) should be non-empty`);
    }
  }
});
