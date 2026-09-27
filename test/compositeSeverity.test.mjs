import { test } from "node:test";
import assert from "node:assert/strict";
import { compositeSeverity, waterDetailSeverity } from "../lib/severity.js";

test("water: unscoreable or no-data coverage is no_data, never good", () => {
  assert.equal(waterDetailSeverity({ coverage: "unscoreable", risk: 0 }), "no_data");
  assert.equal(waterDetailSeverity({ coverage: "no_data", risk: 0 }), "no_data");
  assert.equal(waterDetailSeverity(null), "no_data");
});

test("water: scored coverage maps risk on the canonical scale", () => {
  assert.equal(waterDetailSeverity({ coverage: "complete", risk: 100 }), "severe");
  assert.equal(waterDetailSeverity({ coverage: "no_detections", risk: 0 }), "good");
  assert.equal(waterDetailSeverity({ coverage: "partial", risk: 50 }), "elevated");
});

test("composite: worst of the included inputs only", () => {
  const score = { display_score: 40, included_inputs: ["water", "radon"] };
  assert.equal(compositeSeverity(score, { water: "severe", radon: "good", lead: "high" }), "severe");
  assert.equal(compositeSeverity(score, { water: "moderate", radon: "high" }), "high");
});

test("composite: an input not in included_inputs never counts (e.g. lead)", () => {
  const score = { display_score: 90, included_inputs: ["radon"] };
  assert.equal(compositeSeverity(score, { radon: "good", lead: "severe", water: "severe" }), "good");
});

test("composite: no_data inputs don't worsen it; all no_data stays no_data", () => {
  assert.equal(compositeSeverity({ display_score: 70, included_inputs: ["water", "radon"] }, { water: "no_data", radon: "elevated" }), "elevated");
  assert.equal(compositeSeverity({ display_score: 70, included_inputs: ["water"] }, { water: "no_data" }), "no_data");
});

test("composite: null when there is no display score", () => {
  assert.equal(compositeSeverity({ display_score: null, included_inputs: [] }, {}), null);
  assert.equal(compositeSeverity(null, {}), null);
});
