# HALO backend build — progress log

Branch: `vmag211/backend` (never merged to main). Pushed after each piece.

## Constraints discovered
- **DDL is manual.** New tables/columns ship as `supabase/migrations/*.sql`; apply them in the
  Supabase SQL editor (PostgREST can't run DDL, and no DB password/CLI-link is available here).
- **No Docker / local DB.** New-table features can't be live integration-tested from here, so all
  logic is written as **pure functions** in `lib/` and unit-tested with node's built-in runner
  (`node --test`, no new deps). Routes are thin wrappers; ones that run against existing tables /
  live APIs are integration-tested with a minted anonymous token.
- API-key / model-key dependent bits are built but not live-tested, and flagged below.

## Schema migrations (apply in SQL editor, in order)
- [x] `0001_anon_auth.sql` — existing (auth trigger, RLS, cascades)
- [x] `0002_household_and_profile.sql` — profiles.renter_mode, profiles.locale; `household_bands`
- [x] `0003_symptom_logs.sql`
- [x] `0004_volunteer_orgs.sql` (+ starter seed; verify orgs before launch)
- [x] `0005_learn_content.sql` (content lives in `lib/learnContent.js`; table for future DB editing)
- [x] `0006_alerts.sql`
- [x] `0007_assistant_corpus.sql` (needs embedding-model key to ingest; pgvector)

## Pure logic (`lib/`, unit-tested — 67/67 passing)
- [x] `severity.js` — canonical 0–4 + no_data scale, threshold→word per metric (§6.1)
- [x] `leadRisk.js` — build-year → lead level/basis/text, shown-not-scored (§12.3)
- [x] `household.js` — composition model, priority order (§8.5), sensitive-group test
- [x] `explain.js` — per-reading explanatory sentence by composition (§8.6, §11)
- [x] `actionPlan.js` — ranked plan w/ cost + certification + renter suitability (§12.6–12.7)
- [x] `learnContent.js` — the 7 Learn topics (§17); served by /api/learn
- [x] `journalAnalysis.js` — co-occurrence findings, thresholds, illness exclusion (§14.6)
- [x] `alertRules.js` — alert evaluation, sensitive-group shift (§19)
- [x] `volunteerMatch.js` — filter orgs by county + cause tags (§15.3)
- [x] `district.js` — district aggregate from utility dataset (§20)
- [x] `mapData.js` — map feature assembly from ucmr5 + radon (§13)

## Routes
- [x] `GET /api/profile` — profile retrieval + onboarded flag (live-tested)
- [x] `GET/PUT /api/household` — composition (GET tested; PUT needs migration 0002)
- [x] extend `GET /api/home-guard` — lead card + action plan (live-tested vs Concord/well/year cases)
- [x] extend `GET /api/daily-score` — severity + explanatory sentences (live-tested)
- [x] `GET /api/history` — daily readings, one-per-date, severity words (live-tested)
- [x] `GET/POST /api/journal` + `GET /api/journal/findings` (needs migration 0003)
- [x] `GET /api/map` — water (per-contaminant severity) + radon layers (live-tested; needs coords join)
- [x] `GET /api/district` — exceedance counts (live-tested: 106/290 over PFOS; pop needs source)
- [x] `GET /api/volunteer` — match by county+cause (tested graceful; needs 0004)
- [x] `GET /api/learn` — base content + composed why-yours + household branch (live-tested)
- [x] `GET/POST /api/alerts` — inbox + mark-read (needs migration 0006)
- [x] `POST /api/assistant` — structural diagnostic guard + honest not-configured (live-tested)
- [x] `GET /api/health` — external source reachability (live-tested: all 8 ok)
- [x] `POST /api/cron/daily` — secret-guarded; air+radon alert evaluation (needs 0006)

## Notes / flags
- `profiles` already has both `home_year` and `build_year` columns; onboard writes `home_year`, so
  lead logic reads `home_year` (falls back to `build_year`).
- `home_risks` table exists but is empty/unused; home-guard computes on the fly. Persistence optional.
