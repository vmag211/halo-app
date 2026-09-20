import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAlerts } from "../lib/alertRules.js";

const types = (alerts) => alerts.map((a) => a.type);
const byType = (alerts, t) => alerts.find((a) => a.type === t);

// ── Air quality ──────────────────────────────────────────────

test("general household: air 'high' today vs 'moderate' yesterday fires", () => {
  const r = evaluateAlerts({ airToday: "high", airYesterday: "moderate", date: "2026-01-05" });
  assert.ok(types(r).includes("air_quality_change"));
});

test("general household: air 'elevated' today vs 'good' yesterday does NOT fire (below threshold 3)", () => {
  const r = evaluateAlerts({ airToday: "elevated", airYesterday: "good", date: "2026-01-05" });
  assert.ok(!types(r).includes("air_quality_change"));
});

test("sensitive household: air 'elevated' today vs 'good' yesterday fires (threshold 2)", () => {
  const r = evaluateAlerts({ airToday: "elevated", airYesterday: "good", sensitive: true, date: "2026-01-05" });
  assert.ok(types(r).includes("air_quality_change"));
});

test("no fire when air did not worsen (same level today and yesterday)", () => {
  const r = evaluateAlerts({ airToday: "high", airYesterday: "high", date: "2026-01-05" });
  assert.ok(!types(r).includes("air_quality_change"));
});

test("no fire when air improved", () => {
  const r = evaluateAlerts({ airToday: "moderate", airYesterday: "severe", date: "2026-01-05" });
  assert.ok(!types(r).includes("air_quality_change"));
});

test("air alert carries severity and a dedupe key with the date", () => {
  const r = evaluateAlerts({ airToday: "severe", airYesterday: "high", date: "2026-02-10" });
  const a = byType(r, "air_quality_change");
  assert.ok(a);
  assert.equal(a.severity, "severe");
  assert.equal(a.dedupe_key, "air_quality_change:2026-02-10");
});

// ── Weather advisories ───────────────────────────────────────

test("a known advisory produces one weather_advisory mentioning the county", () => {
  const r = evaluateAlerts({ advisories: [{ kind: "flood" }], county: "Cabarrus", date: "2026-01-05" });
  const a = byType(r, "weather_advisory");
  assert.ok(a);
  assert.ok(a.message.includes("Cabarrus"), "message mentions the county");
  assert.equal(a.dedupe_key, "weather_advisory:flood:2026-01-05");
});

test("an unknown advisory kind is skipped", () => {
  const r = evaluateAlerts({ advisories: [{ kind: "tornado" }], county: "Cabarrus", date: "2026-01-05" });
  assert.ok(!types(r).includes("weather_advisory"));
});

test("multiple advisories produce one alert each with kind in the dedupe key", () => {
  const r = evaluateAlerts({
    advisories: [{ kind: "flood" }, { kind: "boil_water" }, { kind: "bogus" }],
    county: "Wake",
    date: "2026-03-01",
  });
  const advisories = r.filter((a) => a.type === "weather_advisory");
  assert.equal(advisories.length, 2);
  const keys = advisories.map((a) => a.dedupe_key);
  assert.ok(keys.includes("weather_advisory:flood:2026-03-01"));
  assert.ok(keys.includes("weather_advisory:boil_water:2026-03-01"));
});

// ── Water results ────────────────────────────────────────────

test("waterResultsChanged fires a new_water_results alert", () => {
  const r = evaluateAlerts({ waterResultsChanged: true, date: "2026-01-05" });
  assert.ok(types(r).includes("new_water_results"));
});

test("waterResultsChanged false does not fire", () => {
  const r = evaluateAlerts({ waterResultsChanged: false });
  assert.ok(!types(r).includes("new_water_results"));
});

// ── Radon season ─────────────────────────────────────────────

test("radon fires in winter for zone 1 with no test", () => {
  const r = evaluateAlerts({ radonZone: 1, month: 1, year: 2026, hasRadonTest: false });
  assert.ok(types(r).includes("radon_season"));
});

test("radon fires for zone 2 as well", () => {
  const r = evaluateAlerts({ radonZone: 2, month: 11, year: 2026, hasRadonTest: false });
  assert.ok(types(r).includes("radon_season"));
});

test("radon does NOT fire in summer (month 7)", () => {
  const r = evaluateAlerts({ radonZone: 1, month: 7, year: 2026, hasRadonTest: false });
  assert.ok(!types(r).includes("radon_season"));
});

test("radon does NOT fire for zone 3", () => {
  const r = evaluateAlerts({ radonZone: 3, month: 1, year: 2026, hasRadonTest: false });
  assert.ok(!types(r).includes("radon_season"));
});

test("radon does NOT fire when a test already exists", () => {
  const r = evaluateAlerts({ radonZone: 1, month: 1, year: 2026, hasRadonTest: true });
  assert.ok(!types(r).includes("radon_season"));
});

test("radon dedupe key uses the winter year: Jan of Y belongs to winter Y-1", () => {
  const r = evaluateAlerts({ radonZone: 1, month: 1, year: 2026, hasRadonTest: false });
  const a = byType(r, "radon_season");
  assert.equal(a.dedupe_key, "radon_season:2025");
});

test("radon dedupe key: Nov of Y belongs to winter Y", () => {
  const r = evaluateAlerts({ radonZone: 2, month: 11, year: 2026, hasRadonTest: false });
  const a = byType(r, "radon_season");
  assert.equal(a.dedupe_key, "radon_season:2026");
});

test("radon: Dec and Jan of the crossover share a winter year", () => {
  const dec = byType(evaluateAlerts({ radonZone: 1, month: 12, year: 2025, hasRadonTest: false }), "radon_season");
  const jan = byType(evaluateAlerts({ radonZone: 1, month: 1, year: 2026, hasRadonTest: false }), "radon_season");
  assert.equal(dec.dedupe_key, jan.dedupe_key, "Dec 2025 and Jan 2026 are one winter");
});

// ── Season summary ───────────────────────────────────────────

test("season_summary fires only with a season and journal entries", () => {
  const r = evaluateAlerts({ seasonEnded: { season: "spring" }, hasJournalEntries: true, year: 2026 });
  assert.ok(types(r).includes("season_summary"));
});

test("season_summary does not fire without journal entries", () => {
  const r = evaluateAlerts({ seasonEnded: { season: "spring" }, hasJournalEntries: false });
  assert.ok(!types(r).includes("season_summary"));
});

test("season_summary does not fire when no season ended", () => {
  const r = evaluateAlerts({ seasonEnded: null, hasJournalEntries: true });
  assert.ok(!types(r).includes("season_summary"));
});

// ── Invariants ───────────────────────────────────────────────

test("every returned alert has a non-empty dedupe_key", () => {
  const r = evaluateAlerts({
    airToday: "high",
    airYesterday: "moderate",
    advisories: [{ kind: "flood" }],
    county: "Cabarrus",
    waterResultsChanged: true,
    radonZone: 1,
    month: 1,
    year: 2026,
    hasRadonTest: false,
    seasonEnded: { season: "spring" },
    hasJournalEntries: true,
    date: "2026-01-05",
  });
  assert.ok(r.length >= 5, "the everything-on case fires several alerts");
  for (const a of r) {
    assert.equal(typeof a.dedupe_key, "string");
    assert.ok(a.dedupe_key.length > 0, `empty dedupe_key on ${a.type}`);
  }
});

test("empty input produces no alerts", () => {
  assert.deepEqual(evaluateAlerts(), []);
  assert.deepEqual(evaluateAlerts({}), []);
});
