import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDistrict, exceedanceLine, REGULATED } from "../lib/district.js";

test("REGULATED is the expected set of five compounds", () => {
  assert.deepEqual(REGULATED, ["PFOA", "PFOS", "PFHxS", "PFNA", "HFPO-DA"]);
});

test("uses the MOST RECENT reading, not the max: old over-limit + recent under = NOT over", () => {
  const utils = [
    {
      pwsid: "A",
      contaminants: {
        // older reading 9.0 (over 4), most recent 2.0 (under 4) -> NOT over.
        PFOS: [
          { date: "1/1/2023", value_ppt: 9.0 },
          { date: "7/1/2025", value_ppt: 2.0 },
        ],
      },
    },
  ];
  const d = computeDistrict(utils);
  assert.equal(d.by_contaminant.PFOS.tested, 1);
  assert.equal(d.by_contaminant.PFOS.over, 0);
  assert.equal(d.systems_over_limit, 0);
});

test("a system over on any regulated compound counts once toward systems_over_limit", () => {
  const utils = [
    {
      pwsid: "B",
      contaminants: {
        PFOA: [{ date: "7/1/2025", value_ppt: 5.0 }], // over 4
        PFOS: [{ date: "7/1/2025", value_ppt: 6.0 }], // over 4 too
      },
    },
  ];
  const d = computeDistrict(utils);
  assert.equal(d.by_contaminant.PFOA.over, 1);
  assert.equal(d.by_contaminant.PFOS.over, 1);
  assert.equal(d.systems_over_limit, 1, "one system, counted once despite two exceedances");
});

test("by_contaminant carries tested / over / limit; totals and null population", () => {
  const utils = [
    { pwsid: "1", contaminants: { PFOA: [{ date: "7/1/2025", value_ppt: 5.0 }] } }, // over
    { pwsid: "2", contaminants: { PFOA: [{ date: "7/1/2025", value_ppt: 1.0 }] } }, // under
    { pwsid: "3", contaminants: {} }, // untested
  ];
  const d = computeDistrict(utils);
  assert.equal(d.total_systems, 3);
  assert.equal(d.by_contaminant.PFOA.tested, 2);
  assert.equal(d.by_contaminant.PFOA.over, 1);
  assert.equal(d.by_contaminant.PFOA.limit, 4.0);
  assert.equal(d.by_contaminant.PFHxS.limit, 10.0);
  assert.equal(d.systems_over_limit, 1);
  assert.equal(d.affected_population, null);
});

test("GenX handled under both 'HFPO-DA' and 'HFPO-DA (GenX)' keys", () => {
  const utils = [
    { pwsid: "g1", contaminants: { "HFPO-DA": [{ date: "7/1/2025", value_ppt: 12.0 }] } }, // over 10
    { pwsid: "g2", contaminants: { "HFPO-DA (GenX)": [{ date: "7/1/2025", value_ppt: 11.0 }] } }, // over 10
    { pwsid: "g3", contaminants: { "HFPO-DA (GenX)": [{ date: "7/1/2025", value_ppt: 3.0 }] } }, // under
  ];
  const d = computeDistrict(utils);
  assert.equal(d.by_contaminant["HFPO-DA"].tested, 3, "both spellings feed the HFPO-DA row");
  assert.equal(d.by_contaminant["HFPO-DA"].over, 2);
  assert.equal(d.systems_over_limit, 2);
});

test("a boundary reading exactly at the limit is NOT over (strict greater-than)", () => {
  const utils = [{ pwsid: "eq", contaminants: { PFOA: [{ date: "7/1/2025", value_ppt: 4.0 }] } }];
  const d = computeDistrict(utils);
  assert.equal(d.by_contaminant.PFOA.tested, 1);
  assert.equal(d.by_contaminant.PFOA.over, 0);
});

test("readings with no usable value are not counted as tested", () => {
  const utils = [{ pwsid: "x", contaminants: { PFOA: [{ date: "7/1/2025", value_ppt: null }] } }];
  const d = computeDistrict(utils);
  assert.equal(d.by_contaminant.PFOA.tested, 0);
  assert.equal(d.systems_over_limit, 0);
});

test("empty utilities produce zeroed totals", () => {
  const d = computeDistrict([]);
  assert.equal(d.total_systems, 0);
  assert.equal(d.systems_over_limit, 0);
  for (const name of REGULATED) {
    assert.equal(d.by_contaminant[name].tested, 0);
    assert.equal(d.by_contaminant[name].over, 0);
  }
});

test("exceedanceLine renders the count sentence for a known contaminant", () => {
  const utils = [
    { pwsid: "1", contaminants: { PFOS: [{ date: "7/1/2025", value_ppt: 9.0 }] } },
    { pwsid: "2", contaminants: { PFOS: [{ date: "7/1/2025", value_ppt: 1.0 }] } },
  ];
  const d = computeDistrict(utils);
  assert.equal(exceedanceLine(d, "PFOS"), "1 of 2 systems exceed the limit for PFOS.");
});

test("exceedanceLine returns null for an unknown contaminant", () => {
  const d = computeDistrict([{ pwsid: "1", contaminants: {} }]);
  assert.equal(exceedanceLine(d, "LEAD"), null);
  assert.equal(exceedanceLine(d, "PFBS"), null);
});
