import { test } from "node:test";
import assert from "node:assert/strict";
import { journalFindings, FINDING_DISCLAIMER } from "../lib/journalAnalysis.js";

const D = (n) => "2025-08-" + String(n).padStart(2, "0");

/** Build a 20-day history where pollen is elevated on days 1..8 and good on 9..20. */
function pollenScenario() {
  const history = [];
  for (let i = 1; i <= 8; i++) history.push({ date: D(i), pollen: "elevated", air: "good", uv: "good", mold: "low" });
  for (let i = 9; i <= 20; i++) history.push({ date: D(i), pollen: "good", air: "good", uv: "good", mold: "low" });
  // symptoms on 7 of the 8 elevated days and 1 of the 12 good days
  const entries = [];
  for (const day of [1, 2, 3, 4, 5, 6, 7, 9]) entries.push({ entry_date: D(day), symptoms: ["cough"], possibly_illness: false });
  return { history, entries };
}

test("pollen co-occurrence produces a finding with the exact statement", () => {
  const { history, entries } = pollenScenario();
  const r = journalFindings({ entries, history });

  assert.equal(r.ready, true);
  assert.equal(r.flaggedDays, 8);
  assert.equal(r.totalDays, 20);
  assert.equal(r.disclaimer, FINDING_DISCLAIMER);

  const pollen = r.findings.find((f) => f.factor === "pollen");
  assert.ok(pollen, "expected a pollen finding");
  // 7/8 = 88%, 1/12 = 8%.
  assert.equal(pollen.elevated_rate, 88);
  assert.equal(pollen.other_rate, 8);
  assert.equal(
    pollen.statement,
    "On days with elevated pollen, you logged symptoms 88% of the time, versus 8% on other days.",
  );
});

test("not ready when fewer than 5 flagged days (even with enough total days)", () => {
  const history = [];
  for (let i = 1; i <= 20; i++) history.push({ date: D(i), pollen: i <= 8 ? "elevated" : "good" });
  // only 4 symptom days
  const entries = [1, 2, 3, 4].map((d) => ({ entry_date: D(d), symptoms: ["cough"], possibly_illness: false }));

  const r = journalFindings({ entries, history });
  assert.equal(r.ready, false);
  assert.equal(r.flaggedDays, 4);
  assert.equal(r.totalDays, 20);
  assert.deepEqual(r.needed, { flagged: 5, total: 14 });
  assert.equal(r.findings, undefined);
});

test("not ready when fewer than 14 total days (even with enough flagged days)", () => {
  const history = [];
  for (let i = 1; i <= 10; i++) history.push({ date: D(i), pollen: i <= 5 ? "elevated" : "good" });
  const entries = [1, 2, 3, 4, 5].map((d) => ({ entry_date: D(d), symptoms: ["cough"], possibly_illness: false }));

  const r = journalFindings({ entries, history });
  assert.equal(r.ready, false);
  assert.equal(r.flaggedDays, 5);
  assert.equal(r.totalDays, 10);
  assert.deepEqual(r.needed, { flagged: 5, total: 14 });
});

test("empty input is not ready and reports zero days", () => {
  const r = journalFindings();
  assert.equal(r.ready, false);
  assert.equal(r.flaggedDays, 0);
  assert.equal(r.totalDays, 0);
});

test("illness-flagged dates are removed from history AND never counted as flagged", () => {
  const { history, entries } = pollenScenario();
  // Mark two of the symptom days as possible illness. Those dates must vanish
  // from usableHistory entirely (so totalDays drops) and never count as flagged.
  const illness = new Set([D(1), D(2)]);
  const entries2 = entries.map((e) => (illness.has(e.entry_date) ? { ...e, possibly_illness: true } : e));

  const r = journalFindings({ entries: entries2, history });
  assert.equal(r.totalDays, 18, "two illness days removed from history");
  assert.equal(r.flaggedDays, 6, "the two illness days are not flagged days");
});

test("an entry marked possibly_illness is not a flagged day even without removing its history row", () => {
  // History has no row for the illness date, so it only affects the symptom set.
  const history = [];
  for (let i = 1; i <= 20; i++) history.push({ date: D(i), pollen: i <= 8 ? "elevated" : "good" });
  const entries = [1, 2, 3, 4, 5].map((d) => ({ entry_date: D(d), symptoms: ["x"], possibly_illness: false }));
  // A 6th symptom entry, but illness-flagged -> should NOT lift flaggedDays to 6.
  entries.push({ entry_date: D(6), symptoms: ["x"], possibly_illness: true });

  const r = journalFindings({ entries, history });
  assert.equal(r.flaggedDays, 5);
});

test("an entry with symptoms:[] is not a flagged day", () => {
  const history = [];
  for (let i = 1; i <= 20; i++) history.push({ date: D(i), pollen: i <= 8 ? "elevated" : "good" });
  const entries = [
    ...[1, 2, 3, 4].map((d) => ({ entry_date: D(d), symptoms: ["x"], possibly_illness: false })),
    { entry_date: D(5), symptoms: [], possibly_illness: false }, // no symptoms
  ];
  const r = journalFindings({ entries, history });
  assert.equal(r.flaggedDays, 4);
});

test("factor is skipped when either side has fewer than 3 days", () => {
  // 20 days; pollen elevated on only 2 days -> elevated side too thin -> no pollen finding.
  const history = [];
  for (let i = 1; i <= 20; i++) history.push({ date: D(i), pollen: i <= 2 ? "elevated" : "good", air: "good" });
  const entries = [1, 2, 3, 4, 5, 6].map((d) => ({ entry_date: D(d), symptoms: ["x"], possibly_illness: false }));

  const r = journalFindings({ entries, history });
  assert.equal(r.ready, true);
  assert.equal(r.findings.some((f) => f.factor === "pollen"), false);
});

test("factor is skipped when the two rates differ by less than 25 points", () => {
  // Elevated on days 1..10, good on 11..20. Symptoms 5/10 on elevated (50%),
  // 4/10 on good (40%) -> gap 10 < 25 -> no finding.
  const history = [];
  for (let i = 1; i <= 20; i++) history.push({ date: D(i), pollen: i <= 10 ? "elevated" : "good" });
  const symptomDays = [1, 2, 3, 4, 5, 11, 12, 13, 14];
  const entries = symptomDays.map((d) => ({ entry_date: D(d), symptoms: ["x"], possibly_illness: false }));

  const r = journalFindings({ entries, history });
  assert.equal(r.ready, true);
  assert.equal(r.findings.some((f) => f.factor === "pollen"), false);
});

test("a day with no reading for a factor is not comparable for that factor", () => {
  // pollen present every day, air present on only a couple of days -> air is skipped
  // for thinness but pollen still evaluated. Confirms missing factor keys are ignored.
  const { history, entries } = pollenScenario();
  const stripped = history.map((h) => ({ date: h.date, pollen: h.pollen })); // no air/uv/mold keys
  const r = journalFindings({ entries, history: stripped });
  assert.equal(r.ready, true);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].factor, "pollen");
});

test("findings are sorted by gap descending", () => {
  // Two factors with findings of different gaps. pollen gap 80, uv gap ~40.
  const history = [];
  for (let i = 1; i <= 20; i++) {
    history.push({
      date: D(i),
      pollen: i <= 8 ? "elevated" : "good", // elevated 1..8
      uv: i % 2 === 0 ? "elevated" : "good", // elevated on evens (10 days) / odds (10 days)
    });
  }
  // Symptoms: all 8 pollen-elevated days (1..8) => strong pollen signal.
  // For UV, arrange a moderate gap: symptoms on 6 of 10 even days, 2 of 10 odd days.
  const symptomDays = new Set();
  for (const d of [1, 2, 3, 4, 5, 6, 7, 8]) symptomDays.add(d);
  for (const d of [10, 12, 14, 16]) symptomDays.add(d); // extra even days (uv elevated)
  const entries = [...symptomDays].map((d) => ({ entry_date: D(d), symptoms: ["x"], possibly_illness: false }));

  const r = journalFindings({ entries, history });
  assert.equal(r.ready, true);
  const gaps = r.findings.map((f) => Math.abs(f.elevated_rate - f.other_rate));
  const sorted = [...gaps].sort((a, b) => b - a);
  assert.deepEqual(gaps, sorted, "findings must be ordered by descending gap");
});

test("custom config thresholds are honoured", () => {
  const history = [];
  for (let i = 1; i <= 14; i++) history.push({ date: D(i), pollen: i <= 7 ? "elevated" : "good" });
  const entries = [1, 2, 3].map((d) => ({ entry_date: D(d), symptoms: ["x"], possibly_illness: false }));
  // Default requires 5 flagged; lower it to 3 and total to 14.
  const r = journalFindings({ entries, history, config: { minFlagged: 3, minTotal: 14 } });
  assert.equal(r.ready, true);
});
