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

test("seriousness of a reading and fixing an environmental problem are NOT medical (item 15)", () => {
  for (const q of [
    "Is it serious that my AQI is 160?",
    "What treatment options exist for radon?",
    "What treatment removes PFAS from water?",
    "Is it serious that the radon zone is 1?",
  ]) {
    assert.equal(isDiagnosticRequest(q), false, q);
  }
});

test("anything about a person's body or care is still refused, even with an environmental word", () => {
  for (const q of [
    "Should I take medication since my radon is high?",
    "Is it serious that my son coughs when the AQI is high?",
    "Do I have lead poisoning from my water?",
    "Diagnose my symptoms from the air quality",
    "Is it serious that my allergies flare when pollen is high?",
    "What treatment is there for my rash?",
  ]) {
    assert.equal(isDiagnosticRequest(q), true, q);
  }
});
