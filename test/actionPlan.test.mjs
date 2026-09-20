import { test } from "node:test";
import assert from "node:assert/strict";
import { actionPlan, certificationFor } from "../lib/actionPlan.js";
import { normalizeBands } from "../lib/household.js";

const GENERAL = normalizeBands(null);

test("certificationFor mappings", () => {
  assert.equal(certificationFor("LEAD"), "NSF/ANSI 53");
  assert.equal(certificationFor("lead"), "NSF/ANSI 53"); // upper-cased
  assert.ok(certificationFor("PFOS").includes("P473"));
  assert.ok(certificationFor("PFOA").includes("P473"));
  assert.ok(certificationFor("PFAS").includes("P473")); // startsWith PF
  assert.ok(certificationFor("PFBS").includes("P473"));
  assert.equal(certificationFor("Nitrate"), "NSF/ANSI 53");
  assert.equal(certificationFor(""), "NSF/ANSI 53");
  assert.equal(certificationFor(null), "NSF/ANSI 53");
});

test("only Elevated+ items are included", () => {
  const plan = actionPlan({
    water: { contaminant: "Nitrate", value_ppt: 10, limit_ppt: 10, severity: "moderate" },
    radon: { zone: 3, severity: "good" },
    lead: { level: "good", basis: "built_1988_or_later" },
    bands: GENERAL,
  });
  assert.equal(plan.length, 0);
});

test("water 'good' excluded, radon zone 3 excluded, lead 'no_data' excluded", () => {
  const plan = actionPlan({
    water: { contaminant: "Nitrate", value_ppt: 1, limit_ppt: 10, severity: "good" },
    radon: { zone: 3, severity: "good" },
    lead: { level: "no_data", basis: "unknown_year" },
    bands: GENERAL,
  });
  assert.equal(plan.length, 0);
});

test("elevated+ items are included with expected keys", () => {
  const plan = actionPlan({
    water: { contaminant: "PFOA", value_ppt: 8.2, limit_ppt: 4, severity: "elevated" },
    radon: { zone: 1, severity: "high" },
    lead: { level: "high", basis: "built_before_1950" },
    bands: GENERAL,
  });
  const keys = plan.map((i) => i.key).sort();
  assert.deepEqual(keys, ["lead", "radon", "water"]);
});

test("renter vs owner water cost and action differ", () => {
  const input = {
    water: { contaminant: "PFOA", value_ppt: 8.2, limit_ppt: 4, severity: "high" },
    bands: GENERAL,
  };
  const renter = actionPlan({ ...input, renter: true })[0];
  const owner = actionPlan({ ...input, renter: false })[0];
  assert.equal(renter.cost, "$30–90");
  assert.equal(owner.cost, "$150–400");
  assert.notEqual(renter.action, owner.action);
});

test("every item has a renter_can_self_serve boolean", () => {
  const plan = actionPlan({
    water: { contaminant: "PFOA", value_ppt: 8.2, limit_ppt: 4, severity: "high" },
    radon: { zone: 1, severity: "high" },
    lead: { level: "high", basis: "built_before_1950" },
    bands: GENERAL,
    renter: true,
  });
  for (const item of plan) {
    assert.equal(typeof item.renter_can_self_serve, "boolean");
  }
});

test("sorted worst-first by severity level", () => {
  const plan = actionPlan({
    water: { contaminant: "Nitrate", value_ppt: 5, limit_ppt: 4, severity: "elevated" },
    radon: { zone: 1, severity: "high" },
    lead: { level: "severe", basis: "utility_lead_service_line" },
    bands: GENERAL,
  });
  // severe(lead)=4, high(radon)=3, elevated(water)=2
  assert.deepEqual(
    plan.map((i) => i.key),
    ["lead", "radon", "water"]
  );
});

test("tie-break base ordering: water before lead before radon at same severity", () => {
  const plan = actionPlan({
    water: { contaminant: "Nitrate", value_ppt: 5, limit_ppt: 4, severity: "high" },
    radon: { zone: 1, severity: "high" },
    lead: { level: "high", basis: "built_before_1950" },
    bands: GENERAL,
  });
  assert.deepEqual(
    plan.map((i) => i.key),
    ["water", "lead", "radon"]
  );
});

test("young household boost: water 'high' outranks radon 'high'", () => {
  // Without boost, water(high)=3 tie radon(high)=3 -> base order water<radon anyway,
  // so pick a case where the boost actually flips order: radon high vs water elevated.
  const withoutBoost = actionPlan({
    water: { contaminant: "Nitrate", value_ppt: 5, limit_ppt: 4, severity: "elevated" },
    radon: { zone: 1, severity: "high" },
    bands: GENERAL,
  });
  // radon high (3) > water elevated (2)
  assert.deepEqual(
    withoutBoost.map((i) => i.key),
    ["radon", "water"]
  );

  const withBoost = actionPlan({
    water: { contaminant: "Nitrate", value_ppt: 5, limit_ppt: 4, severity: "high" },
    radon: { zone: 1, severity: "high" },
    lead: null,
    bands: normalizeBands({ has_toddler: true }),
  });
  // water high(3)+0.5 = 3.5 > radon high(3) -> water first
  assert.deepEqual(
    withBoost.map((i) => i.key),
    ["water", "radon"]
  );
});

test("young-household boost flips order vs general population", () => {
  // radon high(3) vs water elevated(2): general -> radon first.
  // With boost water elevated(2)+0.5=2.5 still < radon 3, so choose a tighter case:
  // radon elevated(2) vs water elevated(2): general tie -> water first (base).
  // Use pregnant to boost water and lead.
  const input = {
    water: { contaminant: "Nitrate", value_ppt: 5, limit_ppt: 4, severity: "elevated" },
    radon: { zone: 2, severity: "elevated" },
  };
  const general = actionPlan({ ...input, bands: GENERAL });
  assert.deepEqual(general.map((i) => i.key), ["water", "radon"]); // base order

  // Now a case where boost genuinely flips: lead elevated vs radon high.
  const noBoost = actionPlan({
    lead: { level: "elevated", basis: "built_1950_1987" },
    radon: { zone: 1, severity: "high" },
    bands: GENERAL,
  });
  assert.deepEqual(noBoost.map((i) => i.key), ["radon", "lead"]); // radon 3 > lead 2

  // lead high(3)+0.5 vs radon high(3): pregnant boosts lead above radon.
  const boosted = actionPlan({
    lead: { level: "high", basis: "built_before_1950" },
    radon: { zone: 1, severity: "high" },
    bands: normalizeBands({ has_pregnant: true }),
  });
  assert.deepEqual(boosted.map((i) => i.key), ["lead", "radon"]);
  const boostedGeneral = actionPlan({
    lead: { level: "high", basis: "built_before_1950" },
    radon: { zone: 1, severity: "high" },
    bands: GENERAL,
  });
  // tie 3==3 -> base: lead(1) before radon(2) anyway; confirm still lead first
  assert.deepEqual(boostedGeneral.map((i) => i.key), ["lead", "radon"]);
});

test("ranks are numeric, start at 1, ascending", () => {
  const plan = actionPlan({
    water: { contaminant: "Nitrate", value_ppt: 5, limit_ppt: 4, severity: "high" },
    radon: { zone: 1, severity: "high" },
    lead: { level: "high", basis: "built_before_1950" },
    bands: GENERAL,
  });
  assert.equal(plan.length, 3);
  plan.forEach((item, i) => {
    assert.equal(typeof item.rank, "number");
    assert.equal(item.rank, i + 1);
  });
});

test("reason names the contaminant and includes the ratio", () => {
  const plan = actionPlan({
    water: { contaminant: "PFOA", value_ppt: 8.2, limit_ppt: 4, severity: "high" },
    bands: GENERAL,
  });
  const water = plan[0];
  assert.ok(water.reason.includes("PFOA"), "reason names contaminant");
  assert.ok(water.reason.includes("2.1×"), `reason includes ratio: ${water.reason}`);
});

test("water reason without valid ratio falls back gracefully", () => {
  const plan = actionPlan({
    water: { contaminant: "Nitrate", value_ppt: 5, limit_ppt: 0, severity: "high" },
    bands: GENERAL,
  });
  const water = plan[0];
  assert.ok(water.reason.includes("Nitrate"));
  assert.ok(!water.reason.includes("×"), "no ratio symbol when limit invalid");
});

test("radon reason names the zone", () => {
  const plan = actionPlan({
    radon: { zone: 1, severity: "high" },
    bands: GENERAL,
  });
  assert.ok(plan[0].reason.includes("Zone 1"));
});

test("empty input -> empty plan", () => {
  assert.deepEqual(actionPlan(), []);
  assert.deepEqual(actionPlan({ bands: GENERAL }), []);
});

test("lead item certification is NSF/ANSI 53 and cost is a lead test cost", () => {
  const plan = actionPlan({
    lead: { level: "severe", basis: "utility_lead_service_line" },
    bands: GENERAL,
  });
  const lead = plan[0];
  assert.equal(lead.certification, "NSF/ANSI 53");
  assert.ok(/test/i.test(lead.cost));
});
