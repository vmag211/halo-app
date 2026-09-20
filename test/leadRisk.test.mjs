import { test } from "node:test";
import assert from "node:assert/strict";
import { leadRisk } from "../lib/leadRisk.js";

const AGE_TEXT = "estimate based on your home's age";

function assertInvariants(r) {
  assert.equal(r.shown_not_scored, true);
  assert.equal(r.contributes_to_score, false);
}

test("confirmed lead service line -> severe, not an estimate", () => {
  const r = leadRisk({ homeYear: 1900, leadServiceLine: true });
  assert.equal(r.level, "severe");
  assert.equal(r.is_estimate, false);
  assert.equal(r.basis, "utility_lead_service_line");
  assertInvariants(r);
  // Confirmed line text should NOT claim to be an age estimate.
  assert.ok(!r.text.includes(AGE_TEXT));
});

test("built before 1950 -> high, estimate", () => {
  const r = leadRisk({ homeYear: 1949 });
  assert.equal(r.level, "high");
  assert.equal(r.is_estimate, true);
  assert.equal(r.basis, "built_before_1950");
  assert.ok(r.text.includes(AGE_TEXT));
  assertInvariants(r);
});

test("1950 boundary -> elevated", () => {
  const r = leadRisk({ homeYear: 1950 });
  assert.equal(r.level, "elevated");
  assert.equal(r.is_estimate, true);
  assert.equal(r.basis, "built_1950_1987");
  assert.ok(r.text.includes(AGE_TEXT));
  assertInvariants(r);
});

test("1987 boundary -> elevated", () => {
  const r = leadRisk({ homeYear: 1987 });
  assert.equal(r.level, "elevated");
  assert.equal(r.basis, "built_1950_1987");
  assert.ok(r.text.includes(AGE_TEXT));
});

test("1988 boundary -> good", () => {
  const r = leadRisk({ homeYear: 1988 });
  assert.equal(r.level, "good");
  assert.equal(r.is_estimate, true);
  assert.equal(r.basis, "built_1988_or_later");
  assert.ok(r.text.includes(AGE_TEXT));
  assertInvariants(r);
});

test("year >= 1988 (later) -> good", () => {
  const r = leadRisk({ homeYear: 2015 });
  assert.equal(r.level, "good");
  assert.equal(r.is_estimate, true);
  assert.ok(r.text.includes(AGE_TEXT));
});

test("null year -> no_data, not an estimate", () => {
  const r = leadRisk({ homeYear: null });
  assert.equal(r.level, "no_data");
  assert.equal(r.is_estimate, false);
  assert.equal(r.basis, "unknown_year");
  assertInvariants(r);
  assert.ok(!r.text.includes(AGE_TEXT));
});

test("undefined year (and no args) -> no_data", () => {
  const r1 = leadRisk({ homeYear: undefined });
  assert.equal(r1.level, "no_data");
  assert.equal(r1.basis, "unknown_year");
  assert.equal(r1.is_estimate, false);

  const r2 = leadRisk({});
  assert.equal(r2.level, "no_data");
  assert.equal(r2.basis, "unknown_year");

  const r3 = leadRisk();
  assert.equal(r3.level, "no_data");
  assert.equal(r3.basis, "unknown_year");
});

test("NaN year -> no_data (Number.isFinite guard)", () => {
  const r = leadRisk({ homeYear: NaN });
  assert.equal(r.level, "no_data");
  assert.equal(r.basis, "unknown_year");
});

test("leadServiceLine wins over an old year", () => {
  const r = leadRisk({ homeYear: 1990, leadServiceLine: true });
  assert.equal(r.level, "severe");
  assert.equal(r.basis, "utility_lead_service_line");
});

test("all age-based texts contain the estimate disclaimer", () => {
  for (const y of [1900, 1949, 1950, 1970, 1987, 1988, 2020]) {
    const r = leadRisk({ homeYear: y });
    assert.ok(r.text.includes(AGE_TEXT), `year ${y} text should include age disclaimer`);
  }
});

test("invariants hold across every branch", () => {
  const inputs = [
    { leadServiceLine: true },
    { homeYear: 1900 },
    { homeYear: 1960 },
    { homeYear: 2000 },
    { homeYear: null },
  ];
  for (const inp of inputs) assertInvariants(leadRisk(inp));
});
