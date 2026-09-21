import { test } from "node:test";
import assert from "node:assert/strict";
import { isDiagnosticRequest, suggestedQuestions, DIAGNOSTIC_REFUSAL, DISCLAIMER, NO_SOURCE } from "../lib/assistant.js";

test("refuses diagnosis / treatment requests (§18.4)", () => {
  const refuse = [
    "do I have asthma?",
    "Diagnose my cough",
    "am I dying?",
    "is this cancer?",
    "what's wrong with me",
    "what medication should I take for this",
    "should I see a doctor",
    "is my rash serious?",
    "how much dosage of ibuprofen for a headache",
    "what's the cure for my sinus infection",
  ];
  for (const q of refuse) assert.equal(isDiagnosticRequest(q), true, `should refuse: ${q}`);
});

test("allows legitimate education / pattern questions", () => {
  const allow = [
    "What is PFOS?",
    "Why does my son cough more on some days?",
    "How is my score calculated?",
    "What does NSF/ANSI 53 mean?",
    "Is it a good day to go running?",
    "How do I filter PFAS out of my water?",
    "What is a radon zone?",
  ];
  for (const q of allow) assert.equal(isDiagnosticRequest(q), false, `should allow: ${q}`);
});

test("non-string input is not diagnostic", () => {
  assert.equal(isDiagnosticRequest(null), false);
  assert.equal(isDiagnosticRequest(undefined), false);
  assert.equal(isDiagnosticRequest(42), false);
});

test("suggestions: 3 per known + unknown page", () => {
  for (const p of ["today", "home", "homeguard", "journal", "map", "unknown"]) {
    assert.equal(suggestedQuestions(p).length, 3, p);
  }
});

test("fixed strings are present and substantial", () => {
  for (const c of [DIAGNOSTIC_REFUSAL, DISCLAIMER, NO_SOURCE]) {
    assert.ok(typeof c === "string" && c.length > 10);
    assert.ok(!c.includes("!"), "no exclamation marks");
  }
});
