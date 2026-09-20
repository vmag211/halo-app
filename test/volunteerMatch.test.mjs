import { test } from "node:test";
import assert from "node:assert/strict";
import { matchOrgs } from "../lib/volunteerMatch.js";

const ORGS = [
  { name: "Statewide PFAS", counties: ["statewide"], causes: ["water", "pfas"] },
  { name: "Cabarrus Local", counties: ["Cabarrus"], causes: ["water"] },
  { name: "Mecklenburg Air", counties: ["Mecklenburg"], causes: ["air"] },
  { name: "Cabarrus Both", counties: ["cabarrus", "other"], causes: ["water", "pfas", "air"] },
];

test("statewide org serves any county; exact county match is case-insensitive", () => {
  const r = matchOrgs(ORGS, { county: "cAbArRuS", causes: ["water"] });
  const names = r.map((o) => o.name);
  assert.ok(names.includes("Statewide PFAS"), "statewide serves everyone");
  assert.ok(names.includes("Cabarrus Local"), "case-insensitive exact match");
  assert.ok(names.includes("Cabarrus Both"));
  assert.ok(!names.includes("Mecklenburg Air"), "wrong county excluded");
});

test("null county serves all orgs (subject to cause filter)", () => {
  const r = matchOrgs(ORGS, { county: null, causes: ["air"] });
  const names = r.map((o) => o.name);
  assert.deepEqual(new Set(names), new Set(["Mecklenburg Air", "Cabarrus Both"]));
});

test("non-empty causes require at least one overlap (case-insensitive)", () => {
  const r = matchOrgs(ORGS, { county: null, causes: ["WATER"] });
  const names = r.map((o) => o.name);
  // Every returned org shares 'water'.
  assert.ok(names.includes("Statewide PFAS"));
  assert.ok(names.includes("Cabarrus Local"));
  assert.ok(names.includes("Cabarrus Both"));
  assert.ok(!names.includes("Mecklenburg Air"), "air-only org has no water overlap");
});

test("empty causes returns all county-serving orgs", () => {
  const r = matchOrgs(ORGS, { county: "Cabarrus", causes: [] });
  const names = r.map((o) => o.name);
  assert.deepEqual(new Set(names), new Set(["Cabarrus Local", "Cabarrus Both", "Statewide PFAS"]));
  assert.ok(!names.includes("Mecklenburg Air"));
});

test("match_count equals the number of overlapping causes", () => {
  const r = matchOrgs(ORGS, { county: null, causes: ["water", "pfas"] });
  const byName = Object.fromEntries(r.map((o) => [o.name, o.match_count]));
  assert.equal(byName["Statewide PFAS"], 2);
  assert.equal(byName["Cabarrus Both"], 2);
  assert.equal(byName["Cabarrus Local"], 1);
  assert.equal(byName["Mecklenburg Air"], undefined, "no overlap -> excluded");
});

test("sorted by match_count descending", () => {
  const r = matchOrgs(ORGS, { county: null, causes: ["water", "pfas", "air"] });
  const counts = r.map((o) => o.match_count);
  const sorted = [...counts].sort((a, b) => b - a);
  assert.deepEqual(counts, sorted);
});

test("on a match_count tie, a local (non-statewide) org ranks before statewide-only", () => {
  const r = matchOrgs(ORGS, { county: "Cabarrus", causes: ["water", "pfas"] });
  // Statewide PFAS and Cabarrus Both both have match_count 2.
  const idxLocal = r.findIndex((o) => o.name === "Cabarrus Both");
  const idxStatewide = r.findIndex((o) => o.name === "Statewide PFAS");
  assert.ok(idxLocal < idxStatewide, "local org outranks statewide on a tie");
});

test("empty-causes tie also sinks statewide below local", () => {
  const r = matchOrgs(ORGS, { county: "Cabarrus", causes: [] });
  const idxStatewide = r.findIndex((o) => o.name === "Statewide PFAS");
  // Both locals should precede the statewide-only org.
  const idxLocal1 = r.findIndex((o) => o.name === "Cabarrus Local");
  const idxLocal2 = r.findIndex((o) => o.name === "Cabarrus Both");
  assert.ok(idxLocal1 < idxStatewide);
  assert.ok(idxLocal2 < idxStatewide);
});

test("org with no matching county is excluded", () => {
  const r = matchOrgs(ORGS, { county: "Wake", causes: ["water", "pfas", "air"] });
  const names = r.map((o) => o.name);
  // Only the statewide org serves Wake.
  assert.deepEqual(names, ["Statewide PFAS"]);
});

test("empty orgs list returns an empty array", () => {
  assert.deepEqual(matchOrgs([], { county: "Cabarrus", causes: ["water"] }), []);
});

test("returned orgs are copies carrying match_count without mutating input", () => {
  const orgs = [{ name: "X", counties: ["statewide"], causes: ["water"] }];
  const r = matchOrgs(orgs, { county: "Anything", causes: ["water"] });
  assert.equal(r[0].match_count, 1);
  assert.equal("match_count" in orgs[0], false, "original org must not be mutated");
});

test("missing opts defaults to no county filter and no causes", () => {
  const r = matchOrgs(ORGS);
  // No causes -> all county-serving; null county -> all orgs.
  assert.equal(r.length, ORGS.length);
});
