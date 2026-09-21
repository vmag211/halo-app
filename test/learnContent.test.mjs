import { test } from "node:test";
import assert from "node:assert/strict";
import { LEARN_TOPICS, LEARN_CONTENT, learnTopic } from "../lib/learnContent.js";

test("seven topics (§17)", () => {
  assert.equal(LEARN_TOPICS.length, 7);
  for (const t of ["pfas", "radon", "lead", "air", "pollen", "uv", "mold"]) {
    assert.ok(LEARN_TOPICS.includes(t), t);
  }
});

test("every topic is well-formed", () => {
  for (const t of LEARN_TOPICS) {
    const c = LEARN_CONTENT[t];
    assert.ok(c, `${t} exists`);
    assert.ok(typeof c.what_it_is === "string" && c.what_it_is.length > 20, `${t} what_it_is`);
    assert.ok(Array.isArray(c.protect) && c.protect.length >= 3, `${t} protect checklist`);
    assert.ok(Array.isArray(c.sources) && c.sources.length >= 1, `${t} sources`);
    for (const s of c.sources) {
      assert.ok(s.label && s.url && s.retrieved, `${t} source fields`);
      assert.ok(/^https:\/\//.test(s.url), `${t} source is https`);
    }
    assert.ok(c.household && typeof c.household === "object", `${t} household branch object`);
  }
});

test("no exclamation marks anywhere in content (§30)", () => {
  for (const t of LEARN_TOPICS) {
    const c = LEARN_CONTENT[t];
    assert.ok(!c.what_it_is.includes("!"), `${t} what_it_is`);
    for (const p of c.protect) assert.ok(!p.includes("!"), `${t} protect item`);
    for (const v of Object.values(c.household)) assert.ok(!String(v).includes("!"), `${t} household branch`);
  }
});

test("learnTopic returns English, null for Spanish/unknown", () => {
  assert.ok(learnTopic("pfas", "en"));
  assert.equal(learnTopic("pfas", "es"), null); // 'es' lives only in the DB
  assert.equal(learnTopic("nope", "en"), null);
});
