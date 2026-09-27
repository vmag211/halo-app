# HALO backend — status

Branch `vmag211/backend` (merged to `main` through `45380c7`; punch list v3 work is on the branch).
**299 tests pass** (`node --test test/*.test.mjs`) across 35 test files; `npm run build` is green;
22 API routes.

## Activate everything

1. **Apply migrations in the Supabase SQL editor, in order.** 0002–0008 are applied. Still to apply:
   - `0009_daily_details_and_state.sql` — `daily_scores.details`, `profiles.state`, privacy clean-up
     (rounds stored coordinates to ~100 m, clears stored ZIPs)
   - `0010_alerts_notifications.sql` — alert dismiss, notification preferences, push subscriptions,
     water-result change tracking
   - `0011_map_layers.sql` — pre-built map layers and district view
   - `0012_volunteer_orgs_nc08.sql` — NC-08 organizations, radon coverage, `link_checked`
   Every route degrades cleanly until its migration is applied. Then run `node scripts/smoke-test.mjs`.
2. **Environment variables — `.env.local` and Vercel** (they don't sync, §38.2):
   | Variable | Status | Vercel type |
   | --- | --- | --- |
   | `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Local fixed to `generous-bass-202929`; **check Vercel** | URL config / token secret |
   | `CRON_SECRET` | Set both places | Secret |
   | `NEXT_PUBLIC_MAPBOX_TOKEN` | Set both places | Config |
   | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` | Local only — **add to Vercel** | Private key secret, rest config |
   | `OPENAI_API_KEY` (or `ASSISTANT_MODEL_KEY`) | Not set | Secret |
3. **Assistant**: set the model key, then `node scripts/ingest-corpus.mjs`, confirm a non-zero corpus
   with 1536-dimension embeddings, and try ten adversarial questions by hand (§66 item 7).
4. The daily job (`vercel.json`, 11:00 UTC) only runs on the production deployment.

## Punch list v3 — every item

| # | Item | Status |
| --- | --- | --- |
| 1 | Upstash gone | Local points at the live database; Vercel values to check (above). `/api/health` checks Redis |
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

## Needs a person (Part 3 of the punch list)

- [ ] Anonymous sign-in stays enabled (confirmed working 2026-09-27)
- [ ] Filter certifications (NSF/ANSI 53, P473, 58, 42) against NSF
- [ ] Contaminant limits and the hazard-index formula against current federal publications
- [ ] Well test cost ranges in `lib/wellTestData.js`
- [ ] How the assistant is described, against current federal decision-support guidance
- [ ] Ten adversarial assistant questions (needs the model key)
- [ ] Each of the 13 volunteer organizations is operating and serves its tagged counties; set `last_verified`
- [ ] Learn claims against their sources (links resolved 2026-09-27)
- [ ] Spanish Learn content, if in scope
- [ ] Full flow on three NC-08 addresses, one with no utility match, one out of state
- [ ] Map on a mid-range phone with every layer
- [ ] Environment variables identical locally and on Vercel; the daily job ran (check weekly)

## Verify anytime

`node --test test/*.test.mjs` · `node scripts/smoke-test.mjs` (dev server up) · `GET /api/health`
