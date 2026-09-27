import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleWaterFeatures } from "../lib/mapData.js";
import { REGULATED } from "../lib/district.js";
import { SEVERITY } from "../lib/severity.js";

const SEVERITY_WORDS = new Set(Object.keys(SEVERITY));

const CONCORD = {
  pwsid: "NC0000",
  pws_name: "Concord",
  status: "active",
  contaminants: {
    PFOS: [{ date: "7/1/2025", value_ppt: 7.3 }], // over 4 -> real severity
    PFOA: [{ date: "7/1/2025", value_ppt: 2.1 }],
  },
};

test("one feature per system with the expected top-level shape", () => {
  const features = assembleWaterFeatures([CONCORD, { pwsid: "B", pws_name: "B", status: "active", contaminants: {} }]);
  assert.equal(features.length, 2);
  const f = features[0];
  assert.equal(f.pwsid, "NC0000");
  assert.equal(f.name, "Concord");
  assert.equal(f.status, "active");
  // Geometry is a placeholder to be joined later.
  assert.equal(f.lat, null);
  assert.equal(f.lng, null);
  assert.equal(f.population, null);
});

test("overall_severity is a canonical severity word", () => {
  const [f] = assembleWaterFeatures([CONCORD]);
  assert.ok(SEVERITY_WORDS.has(f.overall_severity), `got ${f.overall_severity}`);
  // A PFOS system at 7.3 (limit 4) is a real, non-clean severity.
  assert.notEqual(f.overall_severity, "no_data");
  assert.notEqual(f.overall_severity, "good");
});

test("every regulated compound appears in contaminants", () => {
  const [f] = assembleWaterFeatures([CONCORD]);
  for (const name of REGULATED) {
    assert.ok(name in f.contaminants, `missing ${name}`);
  }
});

test("a tested compound (PFOS) gets value_ppt, limit_ppt, ratio, real severity, date", () => {
  const [f] = assembleWaterFeatures([CONCORD]);
  const pfos = f.contaminants.PFOS;
  assert.equal(pfos.value_ppt, 7.3);
  assert.equal(pfos.limit_ppt, 4);
  assert.equal(pfos.ratio, 1.8); // 7.3 / 4 = 1.825 -> rounded to 1.8
  assert.ok(SEVERITY_WORDS.has(pfos.severity));
  assert.notEqual(pfos.severity, "no_data");
  assert.equal(pfos.date, "7/1/2025");
});

test("an untested compound (PFNA) is no_data with a limit but no value", () => {
  const [f] = assembleWaterFeatures([CONCORD]);
  const pfna = f.contaminants.PFNA;
  assert.equal(pfna.severity, "no_data");
  assert.equal(pfna.limit_ppt, 10);
  assert.equal(pfna.value_ppt, undefined, "untested carries no measured value");
  assert.equal("ratio" in pfna, false);
});

test("GenX read under the '(GenX)' spelling still fills the HFPO-DA slot", () => {
  const util = {
    pwsid: "gx",
    pws_name: "GenX Town",
    status: "active",
    contaminants: { "HFPO-DA (GenX)": [{ date: "7/1/2025", value_ppt: 12.0 }] },
  };
  const [f] = assembleWaterFeatures([util]);
  const gx = f.contaminants["HFPO-DA"];
  assert.equal(gx.value_ppt, 12.0);
  assert.equal(gx.limit_ppt, 10);
  assert.notEqual(gx.severity, "no_data");
});

test("a system with no contaminants marks every regulated compound no_data", () => {
  const [f] = assembleWaterFeatures([{ pwsid: "empty", pws_name: "Empty", status: "active", contaminants: {} }]);
  for (const name of REGULATED) {
    assert.equal(f.contaminants[name].severity, "no_data", `${name} should be no_data`);
  }
});

test("empty utilities produce an empty feature list", () => {
  assert.deepEqual(assembleWaterFeatures([]), []);
});

test("ratio is rounded to one decimal place", () => {
  const util = {
    pwsid: "r",
    pws_name: "R",
    status: "active",
    contaminants: { PFOA: [{ date: "7/1/2025", value_ppt: 6.0 }] }, // 6/4 = 1.5
  };
  const [f] = assembleWaterFeatures([util]);
  assert.equal(f.contaminants.PFOA.ratio, 1.5);
});

test("unscoreable system (only no-limit detections) is no_data on the map, never good", () => {
  const [f] = assembleWaterFeatures([
    { pwsid: "NC0000001", pws_name: "X", status: "measured", contaminants: { PFPeA: [{ date: "10/23/2024", value_ppt: 5 }] } },
  ]);
  assert.equal(f.coverage, "unscoreable");
  assert.equal(f.overall_severity, "no_data");
});

// --- item 18 additions -------------------------------------------------------
import { hazardIndex, quarterOf, quartersIn, contaminantsInQuarter, waterCounts } from "../lib/mapData.js";

test("hazard index: EPA formula, needs two or more of the four, flagged for rescission", () => {
  const hi = hazardIndex({ PFHxS: [{ date: "1/7/2025", value_ppt: 5 }], PFBS: [{ date: "1/7/2025", value_ppt: 1000 }] });
  assert.equal(hi.value, 1); // 5/10 + 1000/2000
  assert.equal(hi.exceeds, true);
  assert.equal(hi.severity, "high");
  assert.equal(hi.proposed_for_rescission, true);
  assert.equal(hi.basis, "latest_sample");
  assert.equal(hazardIndex({ PFHxS: [{ date: "1/7/2025", value_ppt: 50 }] }), null); // only one present
});

test("hazard index uses each compound's most recent reading and accepts either GenX name", () => {
  const hi = hazardIndex({
    PFNA: [{ date: "4/1/2025", value_ppt: 2 }, { date: "1/7/2025", value_ppt: 9 }],
    "HFPO-DA (GenX)": [{ date: "4/1/2025", value_ppt: 3 }],
  });
  assert.equal(hi.value, 0.5); // 2/10 + 3/10
  assert.equal(hi.exceeds, false);
});

test("quarters: derived from M/D/YYYY dates, filterable", () => {
  assert.equal(quarterOf("2024-10-23"), "2024Q4");
  const u = [{ contaminants: { PFOS: [{ date: "10/23/2024", value_ppt: 8.2 }, { date: "1/7/2025", value_ppt: 9.1 }] } }];
  assert.deepEqual(quartersIn(u), ["2024Q4", "2025Q1"]);
  assert.deepEqual(contaminantsInQuarter(u[0].contaminants, "2025Q1"), { PFOS: [{ date: "1/7/2025", value_ppt: 9.1 }] });
  assert.deepEqual(contaminantsInQuarter(u[0].contaminants, "2023Q1"), {});
});

test("features carry date_iso, rescission flags, latest_sample_iso; counts describe them", () => {
  const f = assembleWaterFeatures([
    { pwsid: "NC1", pws_name: "A", status: "measured", contaminants: { PFOS: [{ date: "7/1/2025", value_ppt: 7.3 }], PFHxS: [{ date: "7/1/2025", value_ppt: 3.4 }] } },
    { pwsid: "NC2", pws_name: "B", status: "measured", contaminants: { PFOA: [{ date: "7/1/2025", value_ppt: 1 }] } },
  ]);
  assert.equal(f[0].contaminants.PFOS.date_iso, "2025-07-01");
  assert.equal(f[0].contaminants.PFOS.proposed_for_rescission, false);
  assert.equal(f[0].contaminants.PFHxS.proposed_for_rescission, true);
  assert.equal(f[0].latest_sample_iso, "2025-07-01");
  const c = waterCounts(f);
  assert.equal(c.total, 2);
  assert.equal(c.over_limit, 1);
  assert.deepEqual(c.by_contaminant.PFOS, { tested: 1, over: 1 });
  assert.deepEqual(c.by_contaminant.PFOA, { tested: 1, over: 0 });
});
