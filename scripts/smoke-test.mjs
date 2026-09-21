/**
 * HALO backend smoke test.
 *
 * Mints an anonymous session, seeds a Concord test profile + a few daily
 * readings, then hits every API route and reports status. Routes that need a
 * migration not yet applied will show as DEGRADED rather than failing the run.
 *
 * Run the dev server first (PORT=3100 npm run dev), then:
 *   node scripts/smoke-test.mjs
 * Override the target with BASE_URL=... ; set CRON_SECRET to exercise the cron.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "fs";

// Load .env.local
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const BASE = process.env.BASE_URL || "http://localhost:3100";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: auth, error: authErr } = await sb.auth.signInAnonymously();
if (authErr) { console.error("Could not mint token:", authErr.message); process.exit(1); }
const token = auth.session.access_token;
const uid = auth.user.id;

// Seed profile + daily readings (existing tables).
await admin.from("profiles").upsert(
  { id: uid, lat: 35.4088, lng: -80.5795, county: "Cabarrus County", pwsid: "NC0113010", home_year: 1975 },
  { onConflict: "id" }
);
const today = new Date();
const rows = [];
for (let i = 0; i < 5; i++) {
  const d = new Date(today); d.setUTCDate(d.getUTCDate() - i);
  rows.push({ profile_id: uid, date: d.toISOString().slice(0, 10), score: 68 - i, aqi: 45 + i * 15,
    uv_index: 5, pollen_level: JSON.stringify({ tree: 1, grass: 3 + i, weed: 2 }), mold_risk: "moderate", aqi_source: "airnow" });
}
await admin.from("daily_scores").insert(rows);

const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
async function hit(name, method, path, body) {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch { /* non-json */ }
    return { name, method, path, status: res.status, ok: res.ok, ms: Date.now() - started, json };
  } catch (e) {
    return { name, method, path, status: 0, ok: false, ms: Date.now() - started, error: e.message };
  }
}

const checks = [
  ["profile", "GET", "/api/profile"],
  ["household GET", "GET", "/api/household"],
  ["household PUT", "PUT", "/api/household", { has_toddler: true, has_respiratory: true, renter_mode: true, locale: "en" }],
  ["home-guard (Concord)", "GET", "/api/home-guard?county=Cabarrus%20County&pwsid=NC0113010&home_year=1975"],
  ["home-guard (well)", "GET", "/api/home-guard?county=Buncombe%20County&water_source=well&home_year=1965"],
  ["history", "GET", "/api/history?days=7"],
  ["district", "GET", "/api/district"],
  ["map water", "GET", "/api/map?layer=water"],
  ["map radon", "GET", "/api/map?layer=radon"],
  ["learn pfas", "GET", "/api/learn?topic=pfas&contaminant=PFOS&value=7.3&limit=4"],
  ["volunteer", "GET", "/api/volunteer?causes=water,pfas"],
  ["journal POST", "POST", "/api/journal", { entry_date: today.toISOString().slice(0, 10), symptoms: ["congestion"], severity: "mild" }],
  ["journal GET", "GET", "/api/journal?days=7"],
  ["journal findings", "GET", "/api/journal/findings"],
  ["alerts GET", "GET", "/api/alerts"],
  ["assistant guard", "POST", "/api/assistant", { question: "do I have asthma?" }],
  ["assistant Q", "POST", "/api/assistant", { question: "What is PFOS?" }],
  ["assistant suggest", "GET", "/api/assistant?page=home"],
  ["health", "GET", "/api/health"],
];
if (process.env.CRON_SECRET) {
  checks.push(["cron daily", "POST", `/api/cron/daily?secret=${encodeURIComponent(process.env.CRON_SECRET)}`]);
}

let pass = 0, degraded = 0, fail = 0;
console.log(`\nHALO smoke test → ${BASE}\n${"=".repeat(60)}`);
for (const [name, method, path, body] of checks) {
  const r = await hit(name, method, path, body);
  const detail = r.json?.error || (r.json ? Object.keys(r.json).slice(0, 4).join(",") : r.error || "");
  let tag;
  if (r.ok) { tag = "PASS "; pass++; }
  else if (r.status >= 500 && /schema|relation|column|does not exist|Could not find/i.test(detail)) { tag = "DEGRD"; degraded++; }
  else { tag = "FAIL "; fail++; }
  console.log(`${tag} ${String(r.status).padStart(3)} ${String(r.ms).padStart(5)}ms  ${name.padEnd(22)} ${detail.slice(0, 60)}`);
}
console.log("=".repeat(60));
console.log(`pass ${pass} · degraded (needs migration) ${degraded} · fail ${fail}\n`);

// Clean up seeded readings (leave the profile; it's this anon user's own).
await admin.from("daily_scores").delete().eq("profile_id", uid);
process.exit(fail > 0 ? 1 : 0);
