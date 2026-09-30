# HALO backend — status

Branch `vmag211/backend`; `main` contains all of it (through `9f1ef88`, 2026-09-29).
**354 tests pass** (`node --test test/*.test.mjs`) across 38 test files; `npm run typecheck`, `npm run lint`
(0 errors) and `npm run build` are green on Next.js 16.3.6; 22 API routes.

## Activate everything

1. **Migrations: 0002–0014 are all applied** (2026-09-29: a catalog query over the objects from
   0009–0014, including `profiles.onboard_request_id`, returned true for every row). The assistant also
   retrieves cited passages in production, so the corpus is non-empty and its embeddings match the query
   dimension. Every route degrades cleanly until its migration is applied, so re-check after any restore. **Caution with `scripts/smoke-test.mjs`:** it seeds rows with the service-role key and, when
   `CRON_SECRET` is in `.env.local`, runs `/api/cron/daily` for every household in whichever database
   `.env.local` points at. Run it against a disposable database, not production.
2. **Environment variables: `.env.local` and Vercel** (they don't sync, §38.2). Names are in `.env.example`.
   | Variable | Status (2026-09-29) | Vercel type |
   | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Working on Vercel (sign-in and every route pass) | URL/anon config, service key secret |
   | `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Working on Vercel (`/api/health` upstash-redis ok); database `generous-bass-202929` | URL config / token secret |
   | `AIRNOW_API_KEY`, `GOOGLE_POLLEN_API_KEY`, `MAPBOX_TOKEN` | Working on Vercel (`/api/health`, onboarding) | Secret |
   | `ASSISTANT_MODEL_KEY` and the `ASSISTANT_*` settings | Working on Vercel (assistant answers with citations) | Key secret, rest config |
   | `CRON_SECRET` | Not checkable from outside; confirm in Vercel | Secret |
   | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` | Not checkable from outside; local only until added to Vercel | Private key secret, rest config |
   | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Not in `.env.local`; confirm Vercel. Sign-in works with no CAPTCHA token, so Supabase is not enforcing CAPTCHA (see the verification section) | Config |
   | `NEXT_PUBLIC_MAPBOX_TOKEN`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Set locally; no code reads them yet (the map and push screens are not built) | Config |
   | `OPENUV_API_KEY` | Set locally; no code reads it | n/a |
   Redeploy after changing any Vercel variable.
3. **Assistant** runs on OpenRouter's free tier: embeddings `nvidia/nemotron-3-embed-1b:free` (2,048
   dimensions, no HNSW index), chat `nvidia/nemotron-3-super-120b-a12b:free` with fallbacks,
   `ASSISTANT_MIN_SIMILARITY=0.25`, app-wide cap 450 questions a day (`ASSISTANT_GLOBAL_DAILY_LIMIT`),
   about two free-tier requests per question. Corpus: `node scripts/ingest-corpus.mjs` (19 passages
   expected). `ASSISTANT_SEND_HOUSEHOLD_CONTEXT` is `false`: answers use public sources only and report
   `uses_household_data: false`. Sending readings and symptom names/dates (never free-text notes) is
   approved by Yogi, but free models may log prompts, so turn it on only when he confirms.
4. The daily job (`vercel.json`, 11:00 UTC) only runs on the production deployment. It records every
   onboarded household's reading, evaluates alerts and refreshes the pre-built map layers.

## Punch list v3 — every item

| # | Item | Status |
| --- | --- | --- |
| 1 | Upstash gone | Fixed: local and Vercel both reach the live database (`/api/health` upstash-redis ok, 2026-09-29) |
| 2 | Auth blip wiped households | Fixed: retryable auth errors → 503, only a definitive refusal → 401 |
| 3 | HomeGuard severities disagreed | Fixed: `breakdown[].severity`, `radon.severity`, `score.severity` on both scores |
| 4 | Total outage looked near-perfect | Fixed: mold null/no_data on NWS failure; nothing available → no score + reason |
| 5 | Out-of-state radon | Fixed: `profiles.state` from Mapbox; radon only for NC (`out_of_state` otherwise) |
| 6 | Map painted unscoreable green | Fixed: `no_data` |
| 7 | Profile/onboarding routing, privacy | Fixed: 500 on read errors, `onboarding_complete`, `lookup_failed` keeps pwsid, ~100 m coordinates, no ZIP |
| 8 | `PATCH /api/profile` | Built; `home_year` validated here and in onboarding |
| 9 | daily-score contract | Built: stored location, `?fresh=1` + 5-min limiter, `retrieved_at`, `dominant_pollutant`, `uv.peak_window`, `pollen.categories`, `mold.basis` |
| 10 | Daily history | Built: daily job records every household; onboarding backfills 28 days; America/New_York dates everywhere |
| 11 | home-guard contract | Built: profile defaults, `exceeds_limit`, ISO dates, `detected_unregulated_latest`, `population_served`, benchmark wording, §6.2 confidence, utility lead inventory |
| 12 | Household wording | Fixed: walks the priority list |
| 13 | Journal | Built: DELETE (one/all), band validation, `/retrospective`, `/summary` |
| 14 | Learn | Fixed: titles, household-specific `why_yours` (null without context), all sources link-checked 2026-09-27 (4 replaced) |
| 15 | Assistant | Built: household context (`[H]`), `uses_household_data`, `reason`, page weighting, narrower structural diagnosis filter |
| 16 | Alerts | Built: dismiss, no stale repeats, weather advisories, new water results, season summary, `/api/notifications`, `/api/push/subscribe` + delivery |
| 17 | Volunteer organizations | 13 sourced, link-checked, county-tagged, radon covered — awaiting human verification |
| 18 | Map | Built: pre-built daily, rescission/ISO/hazard index, counts, quarters + `?quarter=`, facilities, air |
| 19 | District | Built: NC-08 scope by boundary, tested denominator, `counties[]`, `state_comparison`, `household_county` |
| 20 | Sources, health | Built: `/api/sources`; `all_ok` requires `ok` |
| 21 | Cross-cutting | Identity from the token only (audited); assistant and push rate-limited per household; additive responses; tests per item |

## Decisions recorded (treat as permanent, not pending)

- **Lead service lines:** NC DEQ publishes per-utility counts only (July 2025 results, 2,320 systems),
  no address-level data. The Severe `utility_lead_service_line` level is **knowingly unreachable**;
  the utility's counts appear as `lead.utility_inventory` context and never change the level.
- **Boil-water advisories:** issued by utilities and health departments, not NWS, and no national
  feed exists. The alert kind is supported but has **no source**; flood and heat come from NWS.
- **District map:** the 119th-Congress NC-08 (the 2023 map: all of Anson, Montgomery, Richmond,
  Scotland, Stanly, Union; parts of Cabarrus, Mecklenburg, Robeson). A 120th-Congress map exists for
  the 2026 elections; switch `lib/data/nc08District.json` when the app should follow it.
- **County ranking rule:** share of a county's served population on systems whose most recent sample
  exceeds a federal limit; rank 1 = lowest share; counties with no mapped system and population
  figure are unranked (91 of 100 are ranked today).
- **Hazard index:** EPA's formula (HFPO-DA/10 + PFBS/2000 + PFNA/10 + PFHxS/10), only when two or
  more are present, reported from the latest sample — not EPA's running-annual-average compliance test.
- **Map time slider:** built — 144 of 290 systems have multiple dated readings (2023Q1–2025Q4).
- **Facilities layer:** active major facilities plus repeat violators (>4 of 12 quarters in
  noncompliance), not every regulated site (Union County alone has ~1,300).
- **Composite severity:** worst of the inputs the score included; HomeGuard: water and radon, never lead.
- **Dependency added:** `web-push` (message encryption and VAPID signing for device notifications).
- **Next.js:** 16.3.6 (upgraded for the security advisories on 16.2.10; tests, typecheck, lint and build re-run).
- **Water contract for the frontend:** keep `exceeds_limit` and `is_enforceable` on every scored water
  compound. The frontend states "above the federal limit" only when both are true.

## Needs a person (Part 3 of the punch list)

- [x] Anonymous sign-in stays enabled (confirmed working 2026-09-29)
- [ ] Filter certifications (NSF/ANSI 53, P473, 58, 42) against NSF
- [ ] Contaminant limits and the hazard-index formula against current federal publications
- [ ] Well test cost ranges in `lib/wellTestData.js`
- [ ] How the assistant is described, against current federal decision-support guidance
- [x] Ten adversarial assistant questions: run on production 2026-09-29, all declined or cited correctly (a person should still skim the answers before submission)
- [ ] Each of the 13 volunteer organizations is operating and serves its tagged counties; set `last_verified` (empty on all 13; do not fill it in without a person checking)
- [ ] Learn claims against their sources (links resolved 2026-09-27)
- [ ] Spanish Learn content, if in scope
- [ ] Full flow on a real phone. Done at the API level on 2026-09-29 for public NC-08, no-utility, out-of-state and radon-zone addresses (see below); the phone pass is still open
- [ ] Map on a mid-range phone with every layer
- [ ] Vercel: `CRON_SECRET`, VAPID variables and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` present; the daily job ran today (Vercel, Cron Jobs, logs; check weekly)
- [ ] Decide whether Supabase should enforce Turnstile CAPTCHA on anonymous sign-in (it does not today)
- [ ] Decide when `ASSISTANT_SEND_HOUSEHOLD_CONTEXT` goes to `true` (Yogi)

## Live verification, 2026-09-29 (production, anonymous test households, all deleted afterwards)

- `/api/health`: `all_ok: true`, all 9 sources ok including `upstash-redis`.
- Onboarding on public government-building addresses, each followed by `/api/daily-score` and
  `/api/home-guard`: Concord (Cabarrus), Monroe (Union), Albemarle (Stanly), Ansonville (Anson),
  Asheville (Buncombe), Statesville (Iredell), Rock Hill SC, and two no-utility addresses (Uwharrie
  National Forest, Tillery Dam Road in Montgomery County). All returned 200.
  - Radon: Buncombe Zone 1 (High), Iredell Zone 2 (Moderate), Cabarrus/Union/Stanly/Anson/Montgomery
    Zone 3 (Low). Rock Hill returned `out_of_state: true`, no radon, no water data, no score.
  - No utility: `service_area_status: outside_known_area`; home-guard returns `no_pwsid_available`
    with the well-testing hint.
- Change address (Concord to Statesville on one profile): the profile and the daily reading follow the
  new home, not the old one.
- Route sweep on production and on a local build: 22 of 23 calls returned 200. `journal/retrospective`
  is POST only (the 405 was the sweep using GET).
- Assistant, ten hard questions: diagnosis and treatment declined; prompt injection, jailbreak,
  off-topic, privacy and a question with no source in the corpus got the calm "no reliable source"
  reply with no leak; "is my water safe" gave a cited answer without saying it was safe; the PFOS limit
  and radon testing questions were cited from the corpus.
- **Findings still open:**
  1. Anonymous sign-in succeeds with no CAPTCHA token, so Supabase is not enforcing CAPTCHA. Anyone with
     the public anon key can mint accounts, limited only by Supabase's built-in per-IP sign-in rate limit.
  2. API copy contains em dashes (U+2014), for example the assistant's decline message and the
     air-quality sentence. The frontend strips them with `displayText` in `lib/frontend/onboarding.ts`
     for onboarding only. The Today and Assistant screens must pass every backend string through it, or
     the copy should be fixed at the source.
  3. Not verifiable from outside: that the daily job ran today, and Vercel-only variables (see above).

## Verify anytime

`node --test test/*.test.mjs` · `npm run typecheck` · `npm run lint` · `npm run build` · `GET /api/health`
with a session. `node scripts/smoke-test.mjs` only against a disposable database (see step 1).
