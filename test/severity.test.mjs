import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEVERITY,
  normalizeSeverity,
  severityLevel,
  severityDescriptor,
  worseSeverity,
  aqiSeverity,
  uvSeverity,
  pollenSeverity,
  moldSeverity,
  radonZoneSeverity,
  waterRiskSeverity,
} from "../lib/severity.js";

test("aqiSeverity bands and boundaries", () => {
  assert.equal(aqiSeverity(0), "good");
  assert.equal(aqiSeverity(50), "good");
  assert.equal(aqiSeverity(51), "moderate");
  assert.equal(aqiSeverity(100), "moderate");
  assert.equal(aqiSeverity(101), "elevated");
  assert.equal(aqiSeverity(150), "elevated");
  assert.equal(aqiSeverity(151), "high");
  assert.equal(aqiSeverity(200), "high");
  assert.equal(aqiSeverity(201), "severe");
  assert.equal(aqiSeverity(500), "severe");
});

test("aqiSeverity non-number / NaN -> no_data", () => {
  assert.equal(aqiSeverity(NaN), "no_data");
  assert.equal(aqiSeverity(Infinity), "no_data");
  assert.equal(aqiSeverity("50"), "no_data");
  assert.equal(aqiSeverity(null), "no_data");
  assert.equal(aqiSeverity(undefined), "no_data");
  assert.equal(aqiSeverity({}), "no_data");
});

test("uvSeverity bands and boundaries", () => {
  assert.equal(uvSeverity(0), "good");
  assert.equal(uvSeverity(2.9), "good");
  assert.equal(uvSeverity(3), "moderate");
  assert.equal(uvSeverity(5.9), "moderate");
  assert.equal(uvSeverity(6), "elevated");
  assert.equal(uvSeverity(7.9), "elevated");
  assert.equal(uvSeverity(8), "high");
  assert.equal(uvSeverity(10.9), "high");
  assert.equal(uvSeverity(11), "severe");
  assert.equal(uvSeverity(20), "severe");
});

test("uvSeverity non-number -> no_data", () => {
  assert.equal(uvSeverity(NaN), "no_data");
  assert.equal(uvSeverity("6"), "no_data");
  assert.equal(uvSeverity(null), "no_data");
});

test("pollenSeverity 0-5 mapping", () => {
  assert.equal(pollenSeverity(0), "good");
  assert.equal(pollenSeverity(1), "moderate");
  assert.equal(pollenSeverity(2), "moderate");
  assert.equal(pollenSeverity(3), "elevated");
  assert.equal(pollenSeverity(4), "high");
  assert.equal(pollenSeverity(5), "severe");
});

test("pollenSeverity non-number -> no_data", () => {
  assert.equal(pollenSeverity(NaN), "no_data");
  assert.equal(pollenSeverity("2"), "no_data");
  assert.equal(pollenSeverity(null), "no_data");
});

test("moldSeverity label mapping (high capped to elevated)", () => {
  assert.equal(moldSeverity("low"), "good");
  assert.equal(moldSeverity("moderate"), "moderate");
  assert.equal(moldSeverity("high"), "elevated");
  assert.equal(moldSeverity("LOW"), "good"); // case-insensitive
  assert.equal(moldSeverity("  high  "), "elevated"); // trimmed
  assert.equal(moldSeverity("severe"), "no_data");
  assert.equal(moldSeverity(""), "no_data");
  assert.equal(moldSeverity(5), "no_data");
  assert.equal(moldSeverity(null), "no_data");
});

test("radonZoneSeverity zone mapping", () => {
  assert.equal(radonZoneSeverity(1), "high");
  assert.equal(radonZoneSeverity(2), "elevated");
  assert.equal(radonZoneSeverity(3), "good");
  assert.equal(radonZoneSeverity("1"), "high"); // coerced
  assert.equal(radonZoneSeverity(0), "no_data");
  assert.equal(radonZoneSeverity(4), "no_data");
  assert.equal(radonZoneSeverity(null), "no_data"); // Number(null)===0 -> else
});

test("waterRiskSeverity bands and boundaries", () => {
  assert.equal(waterRiskSeverity(null), "no_data");
  assert.equal(waterRiskSeverity(NaN), "no_data");
  assert.equal(waterRiskSeverity(0), "good");
  assert.equal(waterRiskSeverity(20), "good");
  assert.equal(waterRiskSeverity(21), "moderate");
  assert.equal(waterRiskSeverity(45), "moderate");
  assert.equal(waterRiskSeverity(46), "elevated");
  assert.equal(waterRiskSeverity(70), "elevated");
  assert.equal(waterRiskSeverity(71), "high");
  assert.equal(waterRiskSeverity(89), "high");
  assert.equal(waterRiskSeverity(89.999), "high");
  assert.equal(waterRiskSeverity(90), "severe");
  assert.equal(waterRiskSeverity(100), "severe");
});

test("normalizeSeverity canonical passthrough", () => {
  for (const w of ["good", "moderate", "elevated", "high", "severe", "no_data"]) {
    assert.equal(normalizeSeverity(w), w);
  }
});

test("normalizeSeverity legacy aliases", () => {
  assert.equal(normalizeSeverity("action_needed"), "severe");
  assert.equal(normalizeSeverity("unknown"), "no_data");
  assert.equal(normalizeSeverity("low"), "good");
  assert.equal(normalizeSeverity("unhealthy"), "high");
  assert.equal(normalizeSeverity("very_high"), "high");
  assert.equal(normalizeSeverity("none"), "no_data");
  assert.equal(normalizeSeverity("detected_not_scored"), "no_data");
});

test("normalizeSeverity case/whitespace and unknowns", () => {
  assert.equal(normalizeSeverity("  HIGH  "), "high");
  assert.equal(normalizeSeverity("Action_Needed"), "severe");
  assert.equal(normalizeSeverity("bogus"), "no_data");
  assert.equal(normalizeSeverity(""), "no_data");
  assert.equal(normalizeSeverity(42), "no_data"); // non-string
  assert.equal(normalizeSeverity(null), "no_data");
  assert.equal(normalizeSeverity(undefined), "no_data");
});

test("severityLevel 0..4 for real words, null for no_data", () => {
  assert.equal(severityLevel("good"), 0);
  assert.equal(severityLevel("moderate"), 1);
  assert.equal(severityLevel("elevated"), 2);
  assert.equal(severityLevel("high"), 3);
  assert.equal(severityLevel("severe"), 4);
  assert.equal(severityLevel("no_data"), null);
  assert.equal(severityLevel("bogus"), null);
  assert.equal(severityLevel("action_needed"), 4); // alias
});

test("worseSeverity picks higher level; no_data loses", () => {
  assert.equal(worseSeverity("good", "high"), "high");
  assert.equal(worseSeverity("high", "good"), "high");
  assert.equal(worseSeverity("severe", "moderate"), "severe");
  assert.equal(worseSeverity("no_data", "moderate"), "moderate");
  assert.equal(worseSeverity("moderate", "no_data"), "moderate");
  assert.equal(worseSeverity("no_data", "no_data"), "no_data");
  assert.equal(worseSeverity("good", "good"), "good"); // equal -> a
  // legacy words normalized through
  assert.equal(worseSeverity("action_needed", "high"), "severe");
});

test("SEVERITY object has color+icon+label+level for each word", () => {
  const words = ["good", "moderate", "elevated", "high", "severe", "no_data"];
  for (const w of words) {
    const d = SEVERITY[w];
    assert.ok(d, `SEVERITY.${w} exists`);
    assert.equal(typeof d.color, "string");
    assert.ok(d.color.length > 0);
    assert.equal(typeof d.icon, "string");
    assert.ok(d.icon.length > 0);
    assert.equal(typeof d.label, "string");
    assert.ok(d.label.length > 0);
    assert.ok("level" in d);
  }
  assert.equal(SEVERITY.good.level, 0);
  assert.equal(SEVERITY.severe.level, 4);
  assert.equal(SEVERITY.no_data.level, null);
});

test("severityDescriptor returns full descriptor", () => {
  assert.deepEqual(severityDescriptor("high"), SEVERITY.high);
  assert.deepEqual(severityDescriptor("action_needed"), SEVERITY.severe);
  assert.deepEqual(severityDescriptor("bogus"), SEVERITY.no_data);
});
