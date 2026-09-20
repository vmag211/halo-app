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
