# B19 scheduled refresh of B12's public water data: plan

Base `origin/vmag211/backend` at `d0e5200`. Migration **0033** (0032 belongs to another package). Before B19, `water.read` served a copy of two public sources bundled by hand on 2026-10-20 (B12 proposal 6: "re-run the build weekly by hand").

## The frontend contract (unchanged)

- Registry `'water.read': {path:'/api/water/notices'}` (`lib/frontend/production/runtime.ts:79`); the adapter sends `resource=water-stewardship` (`adapters.ts:17`). Not public: bearer required (W:314).
- Validator `validWaterStewardship` (`lib/frontend/production/home-resources.ts:31`): `counties`, `releases` (shares 0..100, revision, https `sourceUrl`), `notices`. Extra keys are ignored, so the new `copies` field is safe.
- Screen `ProductionWaterStewardship` (`components/homeguard/FoodWater.tsx:45-49`): releases filtered by `countyId`, shows `release.date`, `release.status`, the six shares, `notice.status`, `notice.date`. `FoodSaveFollow` keeps `revision`, so an unchanged row must keep its revision across imports.
- Spec: DS-108 (USDM request and fields), DS-113 ("Verify automated reuse ... before enabling ingestion"), DS-115 ("Failed reads retain dated prior evidence, not Not Restricted").

## What is built

| Piece | File |
|---|---|
| Shared parsers, strict checks, record text, revisions | `lib/publicWaterSources.js` (the build script now calls it; its output is byte-identical) |
| Bounded text GET (`getJson` now wraps it) | `lib/forecast/http.js` `getText` |
| Stored copies: newest per source, body memo, composition over the bundled file | `lib/publicWaterStore.js` |
| The import | `lib/publicWaterImport.js` |
| Cron `GET|POST /api/cron/public-evidence`, `maxDuration = 60`, `lib/cronAuth.js` | `app/api/cron/public-evidence/route.js`; `vercel.json` `0 18 * * 4` |
| Tables and the one write function | `supabase/migrations/0033_public_evidence_snapshots.sql`, bundle `docs/backend/apply/apply-0033.sql`, `verify-0033.sql` |
| `water.read` reads the copies | `lib/publicEvidenceRoute.js`, `lib/publicEvidence.js` |
| Operator visibility | `lib/sourceOps.js`: `usdm-drought`, `ncdwr-conservation` |

**Import.** Both sources are fetched at once (20 s timeout over headers and body, 1 MB cap, no retries, `accept` and a plain user agent, never a URL, body or value in a log). USDM: NC, the last 28 days, `statisticsType=2`. NC DWR: the conservation status page. Each is parsed by the build's parser and checked strictly:

- **Drought:** a list; every row NC, a known county under its own name, format 2; three real dates (2026-02-30 refused) with start <= end; shares numbers in 0..100 summing to 100 within 0.5; no repeated county and map; **every weekly map carries all 100 counties**; at most 10 maps (100 to 1000 rows). The import also refuses a newest map more than a day in the future (`bad_date`) or older than 21 days (`stale`).
- **Utility:** six cells a row, DWR PWSID, plain names, a known status, a real update date, no repeated system; 50 to 2000 rows; equal to the page's own total; each status count equal to the page's summary, which must exist, name only known statuses and add up to the total; newest update not in the future.

A source that passes is stored as a new dated copy (rows revised against the copy it replaces, or the bundled rows); one that fails stores nothing. One RPC (`record_public_evidence_run`) records both results in one transaction: a snapshot plus a run row for a stored source, a run row (`failed`, reason code, no snapshot) for a failed one, then prunes each source to its newest 8 copies and 200 runs. The newest copy is never pruned. Reason codes: `timeout`, `network`, `http_NNN`, `too_large`, `invalid`, `no_timeout`, `bad_headers`, `shape`, `incomplete`, `bad_date`, `stale`, `internal` (a CHECK holds the set).

**Read.** `water.read` reads the newest copy of each source (id, dates and hash; the body only when this server does not already hold that id and hash), composes it over the bundled file per source, and answers `copies: {drought, utility}` with each `{origin: 'scheduled'|'bundled', retrieved, sourceDate}`. Before 0033 (PGRST205/42P01), with no copy, or on any database error, the bundled file is served, and it says so. A stored copy that fails the projection's shape check falls back to the bundled file; a broken bundled file is still 503.

**Answers of the cron:** 401 without the secret (nothing read or fetched); 503 `feature_unavailable`, not retryable, while the flag is off or 0033 is missing (nothing fetched); 500 on a database failure (code only); 200 `{ok, results:[{source, outcome, reason, rows}]}`.

## Dropped or blocked, and why

- **Fish advisories (B12) are excluded on purpose.** Their wording is published advice: 28 of 34 rows are cut off in the service and one names another water, and a person reviewed which to withhold. A new fetch could change that text, so it must be reviewed again before it is served. They stay on the hand build.
- **The ArcGIS conservation service (DS-112)** is not used: the brief keeps the same source and parser as B12 (the HTML table). The crosswalk to federal PWSIDs (DS-114) is not built.
- **Food notices, NRCS, utility rule text:** unchanged from B12 (blocked there).

## Proposed, Vibhav to confirm

1. **The import is behind `HALO_FEATURE_PUBLIC_IMPORT`, off by default**, until you confirm automated weekly reuse of the NC DWR table with its maintainer (DS-113). USDM is a documented public web service and needs only attribution (DS-107), but one flag covers both.
2. Weekly, Thursdays 18:00 UTC, after the USDM Thursday release. If the Vercel plan refuses a third cron, call the import from `/api/cron/daily` on Thursdays (route comment).
3. **Each source stands alone:** a utility failure does not block a good drought copy, and vice versa.
4. Bounds: drought 1 to 10 whole maps, newest map at most 21 days old; utility 50 to 2000 systems.
5. Keep the newest 8 copies and 200 runs per source.
6. A database error on `water.read` serves the bundled copy (dated) rather than a 503.
7. In `/operations` the two sources are listed only once the import has run; "current" for 8 days after the last stored copy (a weekly feed), and a failed last run shows the run as failed with its reason code.

## Acceptance

Parsers on the recorded B12 downloads (`test/fixtures/public-evidence/`, sha256 equal to the data file header) reproduce the committed releases and notices; every strict check refuses its case. The cron with a stub fetch: good, partial (99 counties, a short table), malformed (not JSON, a broken row), timeout, oversize, HTTP error, stale; never a URL or body in a log; a failure stores nothing and keeps the previous copy. PGlite: 0033 applies twice, verification all true, no client access, checks hold, prune keeps the newest, the bundle passes, the back-out in YOUR_TODO.md removes exactly 0033. `water.read` through the frontend's own validator and the screen's county filter: the newest stored copy, then the bundled file before 0033, with no copy, and after a failed run.
