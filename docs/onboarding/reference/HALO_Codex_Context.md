# HALO — Complete Context for the Frontend Build

**For:** GPT Codex, building the entire HALO frontend (wireframes, visual design, and code) with Yogi.
**As of:** Sunday, September 27, 2026. Checked against `vmag211/halo-app` `main` @ `45380c7` and the backend branch `vmag211/backend` @ `956f413`.
**Read this whole file before writing anything.** It tells you what HALO is, what already exists, what the backend does and doesn't do yet, every decision made so far, and how the team works.

---

## 0. How to use this file

### 0.1 The document set

| Document | What it is | Authority |
|---|---|---|
| **This file** (`HALO_Codex_Context.md`) | The whole app: the project, the repo as it stands, the backend's internals and status, every decision, the workflow, the traps | Context and current state |
| **`HALO_Frontend_Specification.pdf`** (50 pages) | Every page, element, state, string, and API binding for the frontend, targeting the finished backend. Part D is the API contract. Part F is the decision log | **The frontend source of truth.** Where this file summarizes a page, the PDF has the full detail |
| **The repo** (`github.com/vmag211/halo-app`) | The real code. Backend is broad and tested; the frontend is one legacy screen | What actually runs |
| **The blueprint** (`HALO_Blueprint.pdf`, 70 sections, not in the repo) | The original product spec. Its function and content are carried into the frontend PDF with `§` references; its visual values are void | Referenced as `§n.n` everywhere |

`§` numbers throughout (e.g. `§12.3`) point to the blueprint. Codes like `A2`, `B3`, `C1`, `D3` point to sections of the frontend PDF.

### 0.2 When sources disagree

1. **The frontend PDF wins** on anything about the frontend (pages, elements, states, copy, bindings, design foundation).
2. **Part D of the PDF** is the API contract. Backend work is being brought to it; bind to Part D's names.
3. **The running code wins over the blueprint** on facts about what exists (§70.3: "Where the running application and this document disagree, the application is correct").
4. **The blueprint's visual values are void** — colors, fonts, sizes, spacing, radius, shadows, gradients, pixel geometry. Its function, content, rules, and copy are not.
5. **Ignore entirely:** the `vmag211/homeguard-frontend` branch and its `docs/HALO-design-language.md` (discarded, with Vibhav's permission), the stale branches listed in §4.4, and `docs/backend-progress.md` where it conflicts with this file (it's stale).
6. If something is still ambiguous, ask Yogi. Don't invent copy, data, or behavior.

### 0.3 The twenty rules that matter most

1. **The server decides every severity, every score, and every household sentence.** The frontend never compares a number to a threshold and never writes a personalized sentence (§6.1).
2. **Bind to `severity`, never to the legacy `status` fields.** They use different thresholds and will disagree.
3. **Missing data is never zero and never green.** A `null` is an em dash or an explicit No data state (§62.4, §65.1).
4. **Severity is always color + icon + word together**, never color alone (§6.1, §25.1).
5. **Every data screen has four states** — loading (skeleton, never a bare spinner), error, empty, populated — and error copy is never the same as empty copy (§24).
6. **401 means reset the session silently; 503 means retry and never reset.** Resetting on a 503 orphans the household's data.
7. **Route on `onboarding_complete`, not `onboarded`,** backed by a local `halo.onboarded` flag.
8. **`PUT /api/household` replaces all seven groups.** Always send all seven booleans.
9. **Every estimate is labeled** (mold, radon, lead, modeled air) and every data point shows its source and date.
10. **Never display a server `error` string directly** — map status codes to the copy in A2.
11. **Never write "safe" or "unsafe" as a verdict,** never exclamation marks, never fear words (§30).
12. **Every color is a token from day one** (light and dark). Dark mode follows the system.
13. **Every string goes through a translation layer from day one.** Spanish ships only after a person reviews it.
14. **The back-button contract:** every sheet pushes a history entry; Back closes the sheet (A1).
15. **No charting library** — charts are inline SVG. The map library loads only when the Map tab opens.
16. **No analytics, no tracking, no secrets in the browser.**
17. **Lead is shown but never scored.** Lithium is measured but excluded from the score, with the reason stated.
18. **Water sample dates: bind the `*_iso` fields.** Never parse the `M/D/YYYY` strings.
19. **The app is the real page at the real phone width** (375–430px, centered column above that) — no fake phone frame.
20. **Build order and cut order are fixed** (E2, A12). Two finished pages beat five half-finished ones.

---

## 1. The project

- **Competition:** 2026 Congressional App Challenge, North Carolina's 8th congressional district (**NC-08**).
- **Deadline:** **October 26, 2026, 12:00 PM EST.** Internal target: **October 23.**
- **Judged by:** the NC-08 congressional office. Offices may substitute their own criteria this year — ask them directly (§66 item 12, still open).
- **Team** (names from the repo's LICENSE; roles as Yogi described them):
  - **Vibhav Magery** (GitHub `vmag211`) — backend: every server route, the database, the scoring logic, the daily job, reference data.
  - **Muralidhar "Yogi" Paturi** — frontend. Working with you (Codex) on all frontend design and code.
  - **Nagadhar "Naggi" Paturi** — frontend.
  - **Aadit Krishna** — design and docs (the blueprint gives this role Learn topics, volunteer verification, severity wording, and submission materials — §26.3).
- **Hosting:** Vercel. Every merge to `main` deploys automatically, so **`main` is always the live app** (§3, §38.3). The Capacitor config points at `https://halo-app-topaz.vercel.app` — probably the production URL; confirm with Yogi.
- **Why it matters (§2.1, §70.3):** more than 120,000 water customers in Concord receive water with PFAS above twice the federal limit, from a named treatment plant (Concord — Hillgrove WTP), with compliance not required until 2031. Union County's system has reported PFOS above the federal maximum. "Nothing currently tells them so in language they can act on." That is the reason HALO exists.
- **Positioning (§2.4):** an app called PollutionProfile covers similar ground. **HALO must never claim to be first or the only app.** The permitted claim: "no existing application combines air, water, radon, mold, and pollen into a single free, no-hardware, check-it-daily interface with household-specific interpretation and a civic action layer, focused on a specific region's real contamination."
- **The visual bar (blueprint preamble, §6.0, §65.5):** "It needs to look clean, deliberate, and finished — nothing more." Yogi's version: high-end, never slop, without going overboard. Those agree: precision and consistency, not decoration (see §9.4).
- **What judges notice (§65.5):** whether it works on a real device without errors; the map, especially the moment a contaminant selection recolors the state; whether numbers are explained in plain language; whether it admits what it doesn't know; whether the presenter can explain why it was built this way.

---

## 2. What HALO is

### 2.1 The product in one paragraph

HALO takes one address and produces a continuously updated picture of a household's environmental exposure, in two halves that are never merged: **daily conditions** that change hour to hour (air quality, UV index, pollen, mold risk) on the **Today** page, and **home conditions** that change over years (drinking-water contaminants, radon risk, lead risk) on the **HomeGuard** page. It then explains what each reading means for the specific people in that home, tells them what they can do (differently for renters and owners), and connects them to the civic response — local organizations, a letter to their utility, landlord, or representative, and a district-wide view of NC-08. No account, no email, no password: every visitor silently gets an anonymous session. The street address is used once and thrown away.

### 2.2 Who it's for (§2.3)

| Audience | What they get |
|---|---|
| Families with young children | Readings interpreted for small children's higher vulnerability to lead and air pollution |
| People with asthma or respiratory conditions | Air and pollen framed at sensitive-group thresholds, plus the symptom-pattern tool (Journal) |
| Older adults | Heat, air quality, and radon framed for elevated risk |
| Private well owners | "The only population no agency tests" — a prioritized testing plan instead of a false reading |
| Renters | Actions they can actually take, not homeowner advice |
| Spanish-speaking households | Full interface and content in Spanish (once reviewed) |
| Community organizations and officials | A district-level view of contamination across NC-08 |

### 2.3 The seven pages and three overlays (§7)

| Page | Route | Tab | Role |
|---|---|---|---|
| Onboarding | `/onboarding` | — | Collect the minimum to produce results (4 steps + results reveal) |
| Today | `/today` | Today (tab 1, default) | What is happening right now |
| HomeGuard | `/home` | **Home** (tab 2) | What is true about this specific building |
| Map | `/map` | Map (tab 3) | How this household compares to the region; holds the District panel |
| Journal | `/journal` | Journal (tab 4) | How conditions relate to how people actually feel |
| Act | `/act` | Act (tab 5) | What can be done, personally and collectively |
| Settings | `/settings` | — (gear icon) | Change anything entered; inspect everything stored |

Overlays are bottom sheets, never pages or tabs: **Learn** (only from a reading's "What does this mean?" link), **Assistant** (floating button on all five tabbed pages), **Alerts** (bell on Today's header only). The **District panel** lives inside Map.

### 2.4 The twenty capabilities (§63) — the test of the finished app

1. Turn a typed address into a household's environmental picture in under 10 seconds, without an account, without keeping the address
2. Show today's air, UV, pollen, and mold with a combined score, honestly marked when any input is missing or estimated
3. Show drinking-water contaminants against federal limits, county radon risk, and lead risk from building age — lead shown but never scored
4. Distinguish five water situations, including two kinds of absent data, without ever presenting absence as safety
5. Give private-well households a prioritized testing plan instead of a fabricated reading
6. Reword every reading for who lives in the home, without collecting any age, name, or medical record
7. Produce a ranked action plan with costs and certifications, different for renters and owners
8. Show severity across the state, per contaminant or overall water health, with time scrubbing where data supports it
9. Let a household record symptoms and surface real patterns against their exposure history — refusing to report a pattern before the data supports one
10. Answer questions from cited sources and the household's own data, and refuse to diagnose
11. Explain every contaminant in plain language, tied to the household's own number, with cited sources and protective steps
12. Connect the household to verified local organizations matched to its findings
13. Generate a ready-to-send letter filled with the household's own measured values
14. Produce a shareable, printable summary for a doctor or landlord (the health card)
15. Present the district's situation at aggregate scale, with no personal data
16. Alert the household when something meaningfully changes, earlier when a sensitive group is present
17. Work offline with the last known readings and recover when connectivity returns
18. Function entirely in English or Spanish
19. Be fully operable by keyboard and screen reader, never conveying severity by color alone
20. Let the household delete everything permanently

### 2.5 The honesty principles — the project's strongest material (§4.2, §65.5)

The scoring engine already enforces these; every interface decision exists to make them visible:

1. **Absence is never zero.** A missing measurement produces no value. "Zero means 'we measured and found nothing'; absence means 'we do not know.'" A composite from incomplete inputs is marked incomplete.
2. **Risks are combined by their nature, not averaged.** Daily conditions combine as independent risks; home conditions combine multiplicatively, so one severe problem can't be hidden by several mild ones.
3. **Coverage and confidence are separate from severity.** A reading can be reassuring and unreliable at once; the interface shows both.
4. **Regulatory instability is disclosed.** Three of the five federal PFAS limits (PFHxS, PFNA, GenX/HFPO-DA) are under proposed rescission; any score resting on them carries a notice.
5. **Unregulated substances are shown, not hidden,** with cited health-based reference values marked non-enforceable.
6. **Some measurements are deliberately excluded and say so.** Lithium is measured and displayed but not scored (largely geological; the only federal reference is non-regulatory).
7. **Scores have floors and ceilings.** A score never reads excellent on an incomplete assessment and never collapses to zero.

"If a trade-off ever arises between looking finished and being honest, choose honest."

### 2.6 What HALO deliberately cannot do — each is said in the interface (§69)

It can't tell you what's in your tap water (only what the utility measured at its sampling points) · can't measure radon in your home (county zones predict averages) · can't detect mold (it estimates favorable conditions) · can't test private wells (no agency does) · can't tell you whether your plumbing has lead (age indicates an era, not a material) · can't diagnose · can't prove an exposure caused a symptom (co-occurrence, not causation) · can't promise data is current (every reading carries its date) · can't cover the whole country equally (water and radon detail is strongest in North Carolina; daily conditions work anywhere). The PDF's A12 maps each to where it appears.

---

## 3. Platform and stack

- **A web app with a mobile-shaped layout**, running in a phone browser. Not native iOS or Android (§3). Primary viewport 375–430px; every screen verified at 375px; the content column caps at 430px and centers on wider screens (the Map widens to 600px). No horizontal scroll ever. Portrait is the target.
- **Next.js 16.2.10** (App Router), **React 19.2.4**, **TypeScript 5.9** (strict, `allowJs`, alias `@/*` → repo root), **Tailwind CSS v4.3** (CSS-first: there is **no `tailwind.config`**; tokens go in `app/globals.css` with `@theme`), **lucide-react 1.28** (the single icon family), `@supabase/supabase-js` 2.110.7, `@upstash/ratelimit` 2.0.8 + `@upstash/redis` 1.38.0. ESLint 9 flat config (`eslint-config-next`). No component library, animation library, chart library, map library, or state library is installed on `main`.
- **Read `AGENTS.md` first.** Verbatim:
  > # This is NOT the Next.js you know
  > This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

  The breaking changes most likely to bite (from `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`): `params`, `searchParams`, `cookies()`, `headers()` are async and must be awaited; `middleware` is renamed `proxy`; Turbopack is the default for dev and build; `next/image` defaults changed; `next lint` is gone (the repo's `lint` script calls `eslint` directly); parallel routes need `default.js`. `CLAUDE.md` is one line: `@AGENTS.md`.
- **Node 22 or newer** — `@supabase/supabase-js` 2.110.7 declares `node >=22.0.0` (Next 16 alone needs ≥ 20.9; TypeScript ≥ 5.1). `package.json` has no `"type"` field and no `test` script.
- **Scripts:** `npm run dev` · `npm run build` · `npm run start` · `npm run lint`. Tests: `node --test test/*.test.mjs` (183/183 pass on `main`, ~2.3s, no network; 233/233 in 25 files on the backend branch).
- **Fonts** load through `next/font/google` with a system fallback (Fraunces, Instrument Sans, IBM Plex Mono — see §9). Today's `app/layout.tsx` loads Geist and `globals.css` forces Arial; both get replaced.
- **Capacitor:** `capacitor.config.json` exists (appId `com.halo.familyhealth`, points at the Vercel URL). Native packaging is not part of this build (§3). Leave it alone.

### 3.1 Environment variables

Configuration lives in **two places that don't sync** — `.env.local` (gitignored) and the Vercel project settings. Editing one doesn't change the other; both need a restart or redeploy (§38.2). This has already cost the team debugging time.

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | Supabase project and public client key |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Server client (bypasses row security). Never in the browser |
| `AIRNOW_API_KEY` | server | Measured air quality (primary) |
| `OPENUV_API_KEY` | server | UV fallback — 45 requests/day shared across all users |
| `GOOGLE_POLLEN_API_KEY` | server | Pollen (paid key, spending alert set) |
| `MAPBOX_TOKEN` | server only | Geocoding — no spending cap on the account; usage checked manually |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | server | Rate limiters and the shared map-geography cache (not in `.env.example`) |
| `CRON_SECRET` | server | Protects the daily job (not in `.env.example`) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | browser | Optional invisible Cloudflare check before anonymous sign-in; unset = no check |
| `ASSISTANT_MODEL_KEY` or `OPENAI_API_KEY`; `ASSISTANT_EMBED_URL/_MODEL`, `ASSISTANT_CHAT_URL/_MODEL` | server | Assistant embeddings and answers; unset = the Assistant answers "not configured" |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | browser | Device notifications — **planned** (punch list item 16), not built yet |
| a public `pk.` Mapbox token | browser | **Only if** the map uses Mapbox GL JS (an open decision, B7). Must be URL-restricted |

The frontend only ever needs the `NEXT_PUBLIC_*` values. Never import a server key into client code.

---

## 4. The repository as it stands

### 4.1 Layout (`main` @ `45380c7`, 97 tracked files)

```
AGENTS.md / CLAUDE.md     agent instructions (read AGENTS.md)
LICENSE                   all rights reserved — Vibhav Magery, Nagadhar Paturi, Muralidhar Paturi, Aadit Krishna
README.md                 UTF-16 file containing only "# HALO App"
capacitor.config.json     native shell config — not used in this build
checkUtility.js, uploadData.js   legacy CommonJS scripts that loaded EPA UCMR5 data (fail lint; leave them)
next.config.ts            empty
vercel.json               one cron: /api/cron/daily at "0 11 * * *" (11:00 UTC = 7:00 EDT)
app/
  layout.tsx              root layout: Geist fonts, metadata, mounts <AuthInitializer/>   → fonts get replaced
  page.tsx                "/" renders <OnboardingScreen/>                                  → becomes the routing gate
  OnboardingScreen.tsx    the only UI (699 lines, legacy)                                   → replaced (keep the logic listed in 4.3)
  globals.css             Tailwind import + create-next-app defaults                        → replaced by HALO tokens
  favicon.ico             default Next favicon                                              → replace with a HALO icon
  api/**/route.js         17 route files — the backend (see §5, §6)
components/
  AuthInitializer.jsx     opens the anonymous session app-wide; renders nothing            → keep
docs/backend-progress.md  Vibhav's backend log — STALE (says "never merged", "151 tests", "16 routes")
lib/                      24 modules on main (31 on the backend branch) — backend logic + two client modules (auth.js, supabase.js); see §5
public/
  finallogo.png           THE HALO logo (906×818 transparent PNG)                            → keep
  file.svg globe.svg next.svg vercel.svg window.svg   create-next-app leftovers, unused       → delete
scripts/                  smoke-test.mjs, seed-learn.mjs, ingest-corpus.mjs (backend tooling)
supabase/migrations/      0001–0008 SQL (0009 on the backend branch), applied by hand in the Supabase SQL editor
test/                     16 node:test files, 183 tests (backend logic only — no frontend tests)
```

**The logo** (`public/finallogo.png`): a circular badge — a house/shield outline holding a family of four, ringed by four small icons (a cloud for air, a water drop for water, a leaf/spore for pollen and mold, a sun for UV), in teal, cyan, and amber, on a transparent background.

### 4.2 What the frontend is today

Almost nothing. `/` renders the legacy onboarding screen and nothing else exists: no Today, HomeGuard, Map, Journal, Act, Settings, Learn, Assistant, or Alerts; no shell, no tab bar, no `not-found`, `loading`, or `error` routes. After a successful submit the screen logs to the console and goes nowhere (`TODO(handoff)` at `app/OnboardingScreen.tsx:291`). The whole frontend is yours to build.

### 4.3 The legacy onboarding screen — keep the logic, replace everything else

`app/OnboardingScreen.tsx` (client component): a fixed 390×844 "phone shell" centered on a dark background, an animated aurora canvas plus a plexus (connected dots) canvas, a frosted-glass card titled "Tell us about your home" with address + GPS button, build year (1800–current year), and a water-source dropdown (`City utility`, `Well`, `Spring`, `Other`), a gradient "Set up my HALO" button, fonts `'Proxima Soft', 'DM Sans'` that are never loaded, and a non-link "Terms of Service" footer.

- **Keep:** the `ensureAnonSession()` call and its error-code handling (`captcha_failed`, `signin_failed`); the device-location flow that sends coordinates as the string `"lng,lat"` in `address`; the build-year validation logic (extend the range to **1700**–current year). **The old hardcoded Austin fallback address was removed on purpose — never bring it back.**
- **Replace:** every visual, the single-screen structure (it becomes four steps + the results reveal, B1), the generic error handling (four distinct messages), the dead-end submit (it must route), and the water-source labels (the locked labels are `City or town water · Private well · Spring · Other · Not sure`).

### 4.4 Branches

| Branch | State | What to do |
|---|---|---|
| `main` @ `45380c7` | Live, auto-deploys | Base for your work (see §7.2 on the backend branch) |
| `vmag211/backend` @ `956f413` | **6 commits ahead of `main`, strict fast-forward, all from Sept 27, 233/233 tests** — punch-list fixes that bring the API to the contract (§7). Not merged yet | Needed by the frontend. Ask Vibhav to merge it (and apply migration 0009). Until then, see §7.2 |
| `vmag211/homeguard-frontend` @ `612a384` | Vibhav's glassmorphic HomeGuard pages, 17 `components/halo/*` components, Poppins/Playfair fonts, GSAP/motion deps, and `docs/HALO-design-language.md` | **Discarded, with Vibhav's permission.** Don't merge, copy, or follow its design doc. Its routes (`/home-guard`, query-param data loading) are also wrong for this build |
| `yogendra-np/onboarding-screen` | The un-wired original of the legacy onboarding (with the fake location and Austin fallback) and an unused shadcn scaffold | Stale, superseded. Ignore |
| `YogiBearstc/api-helpers` | Rewrites `lib/api.js` with plain `fetch` (no bearer token — it would 401) | Stale, conflicting. Ignore |
| `vmag211/daily-score-restructure`, `vmag211/well-water-test-plan`, `vmag/scoring-system`, `vmag211/anon-auth`, `vmag211/arcgis-water-lookup`, `vmag211/radon-lookup`, `vmag211/redis-rate-limiting` | Already merged (or patch-equivalent) | Ignore |

### 4.5 A suggested frontend structure (a suggestion, not a requirement)

Two people build the frontend (Yogi and Naggi, both with Codex), so organize by page so no two people edit the same files (§26.3), with one shared layer built first:

```
app/
  page.tsx                      routing gate: ensureAnonSession → GET /api/profile → /today or /onboarding (A1)
  onboarding/page.tsx           B1 (steps as client state + history entries) and the results reveal
  (tabs)/layout.tsx             shell: header, tab bar, assistant button, offline banner, sheet host
  (tabs)/today/page.tsx         B2
  (tabs)/home/page.tsx          B3
  (tabs)/map/page.tsx           B7 (map library dynamically imported)
  (tabs)/journal/page.tsx       B4
  (tabs)/act/page.tsx           B5
  settings/page.tsx             B6
  not-found.tsx                 "unrecognized address" message + button back to Today (§27.5)
components/ui/                  the shared set (A9): Button, Card, ExpandableCard, Sheet, ScoreRing, RiskBar,
                                SeverityPill, ConfidencePill, ProvenancePill, Callout, Skeleton, EmptyState, Toast,
                                TabBar, Header, SegmentedControl, ToggleChip, Switch, AccordionRow, inputs, OfflineBanner
components/charts/              inline-SVG charts: ThresholdBars, TrendLine, HeatGrid, ContributionBar, QuarterlyTrend, ComparisonBars
components/sheets/              Learn, Assistant, Alerts, map detail sheets, Act feature sheets
lib/data/                       useHaloData hook + <DataState> wrapper, stored-readings cache, offline queue (A2)
lib/format.ts                   the one formatting module (A5)
lib/severity-ui.ts              severity word → label, icon, color token (imports the word list from lib/severity.js)
lib/i18n/                       translation layer; en strings (es only once reviewed)
```

Keep `lib/auth.js`, `lib/supabase.js`, and `components/AuthInitializer.jsx`. `lib/api.js` is unused legacy (its `submitOnboard` drops water source and build year) — replace it with helpers built on `authedFetch`.

---

## 5. How the backend works

You won't change the backend (that's Vibhav's), but the frontend has to reflect exactly what it does. Everything here was read from the code.

### 5.1 Identity and sessions

- Every visitor gets an **anonymous Supabase account** on first load — no signup screen. `components/AuthInitializer.jsx` calls `ensureAnonSession()` (`lib/auth.js`) in the root layout. A single-flight guard stops two simultaneous callers from creating two accounts. If `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set, an invisible Cloudflare Turnstile check runs first (12s timeout). Errors carry `.code` `captcha_failed` or `signin_failed`.
- **Anonymous sign-in is enabled** in the Supabase project (confirmed by Yogi). It's off by default on new projects; if the project is ever recreated, re-check it (§66 item 1).
- A database trigger (`on_auth_user_created` → `handle_new_user()`) creates the `profiles` row automatically.
- **`authedFetch(url, init)`** attaches `Authorization: Bearer <access token>`. Pass `init.headers` as a plain object (a `Headers` instance is dropped by the spread). **On any 401 it discards the local session, mints a new anonymous user, and retries once.** Correct for a real 401 — disastrous for a false one, which is why the 401/503 rule matters.
- **Server side,** every route except the daily job calls `requireUser(request)` (`lib/serverAuth.js`), which verifies the token with Supabase. Identity always comes from the token; a legacy `profile_id` in a body or query is ignored for identity (and rejected with 403 if it doesn't match, in onboard and daily-score). Server database access uses the service-role client.
- **The 401 vs 503 bug:** `@supabase/auth-js` *returns* (doesn't throw) `AuthRetryableFetchError` on network or 5xx failures, so on `main` a brief Supabase outage comes back as **401 "Your session has expired"** — and `authedFetch` then wipes the session and orphans the household's profile, history, and journal under an abandoned account. **Fixed on `vmag211/backend`** (commit `8c5f49d`, `lib/authResult.js`): retryable failures now return **503**. The frontend rule stands either way: **401 → reset silently; 503 → show the generic error with Retry, never reset.**
- Row-level security restricts every table to its owner. Derived data (cached readings, alerts) is written only by the server.

### 5.2 Rate limits (Upstash Redis, sliding windows)

| Limiter | Limit | Applies to | If Redis is unreachable |
|---|---|---|---|
| `onboardLimiter` | 10 per 24h per user | `POST /api/onboard` | fails open |
| `mapboxLimiter` | 500 per 24h, global | `POST /api/onboard` | fails open |
| `openuvLimiter` | 45 per 24h, global | UV fallback only | fails closed (skips OpenUV) |
| `assistantLimiter` | 20 per hour per user | `POST /api/assistant` | fails open |
| `assistantGlobalLimiter` | 300 per hour, global | `POST /api/assistant` | fails closed (pauses the Assistant) |
| daily-score provider fetch (backend branch) | 1 per household per 5 min | every live provider fetch — `?fresh=1` and any cache miss | fails open; when exceeded → 429 `{ retry_after_seconds: 300 }` |

**Known outage:** commit `45380c7`'s own note says the project's Upstash host no longer resolves (NXDOMAIN). If it's still down, the Assistant's global limiter fails closed (every question → 429 once the Assistant is configured) and map/district fall back to a 15–25s live lookup on a cold server. Punch list item 1 — status unverified; `/api/health` has an `upstash-redis` check.

### 5.3 Database (Supabase Postgres; migrations applied by hand in the SQL editor)

| Table | Holds | Access |
|---|---|---|
| `profiles` | One per visitor: `lat`, `lng`, `county` (e.g. `"Cabarrus County"`), `pwsid`, `water_source` (`utility`/`well`/`spring`/`other`), `home_year`, `renter_mode`, `locale` (`en`/`es`); `state` (two-letter, backend branch); legacy `zip` (no longer stored on the backend branch), `build_year` (unused), and an address column that is deliberately never written | owner read/update |
| `daily_scores` | One reading set per household per day: `date`, `aqi`, `uv_index`, `pollen_level` (a JSON **string**), `mold_risk`, `score`, `aqi_source`, `created_at`; `details jsonb` (backend branch, so cached responses keep the new fields) | owner read; server writes |
| `household_bands` | The seven `has_*` booleans per household | owner read/write |
| `symptom_logs` | Journal entries: `entry_date`, `band`, `symptoms[]`, `severity` (`mild`/`moderate`/`bad`), `note` (≤500), `retrospective`, `possibly_illness`; unique per (household, date, band) | owner read/write |
| `alerts` | `type`, `severity`, `title`, `message`, `fired_at`, `read`, `dedupe_key` | owner read; server writes |
| `volunteer_orgs` | Name, description, `counties[]`, `causes[]`, `url`, `last_verified` | public read |
| `learn_content` | Per topic and locale: `what_it_is`, `protect`, `household`, `sources` (no `title` column — a known bug) | public read |
| `assistant_corpus` | Curated source passages with 1536-dimension embeddings (pgvector) | public read; match function is service-role only |
| `ucmr5_utilities` | EPA UCMR 5 results for ~290 NC water systems: `pwsid`, `pws_name`, `contaminants` (`{ name: [{ date: "M/D/YYYY", value_ppt }] }`) | public read |
| `home_risks` | Unused | — |

Migrations `0001`–`0008` are on `main` (anonymous auth trigger and RLS; household and profile fields; symptom logs; volunteer orgs with 5 unverified statewide seeds; learn content; alerts; the assistant corpus and its match function). **`0009_daily_details_and_state.sql`** is on the backend branch: adds `daily_scores.details` and `profiles.state`, rounds stored coordinates to 3 decimals (~100 m), and clears stored ZIPs. **Until 0009 is applied in the live project,** the daily-score route degrades, and `profiles.state` isn't stored (onboard drops it on its missing-column retry) — so the out-of-state radon protection is off, because a profile with no state is treated as NC.

### 5.4 Severity — one scale, decided on the server (`lib/severity.js`)

Six words: `good` (0) · `moderate` (1) · `elevated` (2) · `high` (3) · `severe` (4) · `no_data`. Anything unrecognized → `no_data`. Thresholds (server-side only — shown so you understand the data, **never reimplement them**):

| Metric | good | moderate | elevated | high | severe |
|---|---|---|---|---|---|
| AQI | ≤50 | ≤100 | ≤150 | ≤200 | >200 |
| UV index | <3 | <6 | <8 | <11 | ≥11 |
| Pollen (Google UPI 0–5) | ≤0 | ≤2 | ≤3 | ≤4 | 5 |
| Mold estimate | low | moderate | high → elevated (capped) | — | — |
| Radon zone | 3 | — | 2 | 1 | — |
| Water risk (0–100) | ≤20 | ≤45 | ≤70 | <90 | ≥90 |
| Lead (build year) | 1988 or later | — | 1950–1987 | before 1950 | (unreachable — see 5.7) |

- **Legacy `status` fields** (`unhealthy`, `low`, `very_high`, `action_needed`, `detected_not_scored`, `unknown`, …) use different cut points and disagree with `severity` (AQI 120 is `status: "unhealthy"` but `severity: "elevated"`; radon zone 1 was `action_needed` in HomeGuard's breakdown but `high` in the action plan). They're kept only for compatibility. **Never bind them.**
- `lib/severity.js` also carries old hex colors from the voided blueprint palette — **don't use them**; the frontend has its own tokens (§9).
- **Composite severity** (backend branch, `compositeSeverity`): `score.severity` is the worst severity among the score's `included_inputs`, and `null` whenever `display_score` is null. On HomeGuard that's water and radon only — never lead.

### 5.5 Scoring (`lib/scoring.js`) — display scores are 0–100, **higher is better**

Risk is 0–100 (higher = worse); every displayed score is `100 − risk`. `null` is never coerced to 0.

- **Per-factor risk:** air piecewise across the AQI bands (0–50 → 0–20, 50–100 → 20–40, 100–150 → 40–60, 150–200 → 60–80, 200–300 → 80–95, 300+ → 95–100); UV = `uv / 11 × 100`; pollen = max over tree/grass/weed of `index / 5 × 100`; mold = low 5, moderate 17, high 30 (max 30); radon zone 1 → 80, 2 → 50, 3 → 20.
- **Today's score** (`getDashboardScore`): `composite_risk = min(100, √(Σ risk²) / 175.8 × 100)`, where 175.8 = √(100² + 100² + 100² + 30²). `display_score = round(100 − composite_risk)`. Missing inputs are excluded and set `is_partial` with `missing_inputs[]`; nothing available → everything null with a `reason`. **An ordinary day scores around 60** (AQI 45, UV 5, pollen 2, mold moderate → 63, severity moderate) — so the ring must not imply a 60 is bad. Its color comes from `score.severity` — the worst severity among the included inputs — never from the number: the same day with pollen 3 scores 55 but its severity is elevated, because pollen 3 is elevated.
- **Water risk:** for each contaminant, the most recent reading; per-contaminant risk = `100 × (1 − e^(−1.5 × value / limit))`; combined = root-sum-square, capped at 100. Limits (ppt): PFOA 4, PFOS 4 (enforceable MCLs); PFHxS 10, PFNA 10, HFPO-DA (GenX) 10 (MCLs under proposed rescission); non-enforceable benchmarks PFBS 2000, PFHxA 1900, PFBA 3800. Lithium is excluded by policy (shown with its EPA reference level of 10,000 ppt). Anything else detected is `detected_unregulated` and unscored. `coverage`: `complete` · `partial` · `unscoreable` · `no_detections` · `excluded_only` · `no_data`.
- **HomeGuard score** (`getHomeGuardScore`): `100 × Π(1 − risk/100)` over the water and radon risks present — **multiplicative**, so one severe problem can't be averaged away. Confidence ceilings: `unscoreable` coverage caps at 70, `partial` at 85. **Floor 6** — the score never reads below 6 (the floor wins over the ceiling). Returns `floored`, `capped`, `ceiling`. Example: PFOS at 7.3 ppt (1.8× the limit) plus radon zone 3 → **6 (floored)**. Radon zone 2 with no water data → 50, partial. Private wells and springs get no score (`display_score: null`) and a testing plan instead.
- **Lead never contributes to any score.** Today and HomeGuard scores are never merged.

### 5.6 Confidence — a separate signal from severity

`breakdown[].confidence`: `full` (show nothing) · `limited` (pill "partial" — some detections couldn't be evaluated) · `stale` (pill "3+ yrs old" — the sample is 3+ years old) · `none` (pill "not evaluated"). A reading can be Good and stale at once; never merge the two into one element (§6.2).

### 5.7 Household model, wording, lead, actions, wells

- **Household:** seven yes/no facts — `has_toddler` (under ~5), `has_child`, `has_teen`, `has_adult`, `has_senior` (65+), `has_pregnant`, `has_respiratory` (asthma or similar). No ages, names, birthdays, or medical records — ever (§8). Composition **never changes a measurement, a severity, or a score** — only the sentence under a reading and the order of actions (§8.2).
- **Wording:** the server writes every household sentence (`air.sentence`, `uv.sentence`, `pollen.sentence`, `mold.sentence`, `lead.sentence`, Learn's `household_note`), naming the most specific group that has wording for that reading, in priority order **respiratory → toddler → pregnant → senior → child → general** (§8.5). Teen and adult aren't in the priority list. (On `main` only the single top group was checked; the backend branch walks the whole list — commit `956f413`.) The frontend displays these sentences verbatim.
- **"Sensitive" households** (respiratory, toddler, or senior) get air-quality alerts one level earlier (level 2 instead of 3) (§19.3).
- **Lead** (`lib/leadRisk.js`): built before 1950 → `high`; 1950–1987 → `elevated`; 1988 or later → `good`; year unknown → `no_data`. Always an estimate from the home's age, shown but never scored. **The Severe level (`basis: "utility_lead_service_line"`) is knowingly unreachable** — no public address-level service-line inventory exists for NC-08 utilities (decision recorded by Vibhav, Sept 27). Instead, `lead.utility_inventory` gives the utility's published counts from NC DEQ's July 2025 inventory (e.g. Concord: 0 lead, 1,449 galvanized requiring replacement) as context that never changes the level. Lead is `null` for wells and springs.
- **Action plan** (`lib/actionPlan.js`): only items at Elevated or worse, ranked worst-first; water and lead get a boost when a toddler or pregnancy is present; ties go water → lead → radon. Each item has cost, the certification to look for (NSF/ANSI 53, P473, 58, 42 — to be re-verified before launch), and renter or owner wording (`renter_mode` changes every recommendation). Costs: water filter $150–400 (renter $30–90), lead test $20–50, radon kit $15–40. A non-enforceable benchmark is called a "health benchmark," never a "federal limit."
- **Private wells and springs** (`lib/wellTestData.js`): no score; a ranked test plan (bacteria, nitrate, pH/corrosivity, lead and copper, radon in water, radon in air, metals panel, PFAS) with priority (`critical`/`recommended`/`optional`), cadence, why, where, and estimated cost ranges — marked estimates; the cost figures are still unverified (`TODO(vibhav)`).

### 5.8 Journal analysis (`lib/journalAnalysis.js`)

Findings compare how often symptoms were logged on elevated days versus other days, per factor (air, pollen, UV, mold), over 90 days. **It refuses to report until the data supports it:** at least 5 flagged days and 14 total days, at least 3 days on each side of a factor's threshold, and a gap of at least 25 points. Days flagged as possible illness are excluded. Not ready → `{ ready: false, flaggedDays, totalDays, needed }` (note the camelCase). Every finding carries a disclaimer that co-occurrence isn't causation.

### 5.9 Alerts (`lib/alertRules.js`) and the daily job

- One scheduled job, `GET|POST /api/cron/daily`, runs daily at 11:00 UTC (7:00 EDT), protected by `CRON_SECRET`. It refreshes the water-geography cache and evaluates alerts for every household with a location, de-duplicated by `dedupe_key`.
- Alert types: `air_quality_change` (air worse than yesterday at level 3, or level 2 for sensitive households) · `radon_season` (zone 1 or 2, October–February, no test recorded; intended once per winter) — **generated today.** `weather_advisory` (NWS flood, boil-water, heat advisories), `new_water_results`, `season_summary` — **rules exist but aren't wired yet** (punch list item 16).

### 5.10 The Assistant (`lib/assistant.js`, `lib/assistantRag.js`)

- Retrieval-augmented: the question is embedded (`text-embedding-3-small`, 1536 dims), the closest curated passages are retrieved (≥0.4 similarity, up to 6), and a chat model (`gpt-4o-mini`, temperature 0) answers **only from them, with numbered citations** — it declines rather than improvise. No streaming.
- **A structural diagnostic guard runs before any answer:** questions asking for a diagnosis, whether a symptom means an illness, or which treatment to take are refused in code with a fixed message. (It currently over-refuses some environmental questions — "Is it serious that my AQI is 160?", "Is my AQI serious?", and "What treatment options exist for radon?" are refused, while "Is an AQI of 160 serious?" happens to pass. To be narrowed, item 15.)
- Disclaimer on every answer: **"Not medical advice. Talk to a clinician about health decisions."**
- Suggested questions per page (`today`, `homeguard`, `journal`, `map`, default).
- **Not yet built (item 15):** the household context block (today's readings, the home assessment, and recent journal symptom names and dates — never notes), `uses_household_data`, `reason: "no_source" | "unavailable"`, and reading `page`. Deploying it also needs the model key, migrations 0007/0008 live, and the corpus ingested.

### 5.11 Learn, volunteer, map, district, health

- **Learn** (`lib/learnContent.js`): seven topics — `pfas`, `radon`, `lead`, `air`, `pollen`, `uv`, `mold` — English only so far. Each: what it is, protective steps, household-specific notes, sources with retrieval dates (currently the placeholder "2026-09"; real dates and link checks pending, item 14).
- **Volunteer** (`lib/volunteerMatch.js`): organizations matched by county (or statewide) and cause overlap. Only 5 unverified statewide seeds exist today; the goal is 20–30 hand-verified orgs, some county-specific, at least one covering radon (item 17). "Twenty verified beats forty unverified."
- **Water data is North Carolina only.** `ucmr5_utilities` was loaded from an NC-only UCMR 5 extract, and **only detections were kept** (rows with `=`; non-detects `<` were dropped). Consequences: an out-of-state utility comes back `no_data_yet` (whose "not published yet" copy would be false there — B3 handles it); a compound with no reading may have been tested and found nothing (the map says "No detection reported", not "not tested"); the district's `tested` counts undercount. Every detected reading was stored with its collection date, so multiple dated readings per compound probably exist (the time-slider question, §66 item 5).
- **Map** (`lib/mapData.js`, `lib/waterGeo.js`): the water layer covers ~290 NC systems with per-compound severity for PFOA, PFOS, PFHxS, PFNA, HFPO-DA, service-area centroids, and population served (282 of 290 located, from EPA's boundary service); the radon layer is 100 NC counties. Facilities and air layers, the hazard index, `counts`, `quarters`, and daily pre-building are not built yet (item 18).
- **District** (`lib/district.js`): exceedance counts and affected population. Today it aggregates the whole state; NC-08 scoping, per-county rows, the state comparison, and `household_county` are item 19.
- **Radon in NC-08:** every county in and around the district (Cabarrus, Union, Stanly, Anson, Montgomery, Richmond, Moore, Rowan, Mecklenburg, Scotland, Robeson, Hoke) is **Zone 3** in the stored data (statewide: 8 Zone 1, 31 Zone 2, 61 Zone 3). So every NC-08 demo address shows radon Good · Zone 3, and radon never produces an action item, alert, or Journal prompt there. Test those paths with a Buncombe County (Zone 1) or Iredell County (Zone 2) address.
- **Health** (`GET /api/health`): reachability of AirNow, Open-Meteo (air and UV), Google Pollen, NWS, Mapbox geocoding, the ArcGIS water boundaries, Upstash, and Supabase. Not linked from the interface; run it before any demo. It requires a session token — call it with `authedFetch` from the running app's console.

### 5.12 Data sources, timeouts, caching (§22, §62)

| Source | Provides | Target timeout (§62.2) — **not enforced in code yet** | On failure |
|---|---|---|---|
| AirNow (federal network) | Measured AQI (25-mile radius) | 5s | Falls back to the modeled source, labeled modeled |
| Open-Meteo | Modeled AQI fallback; UV (primary) | 5s | Air omitted / UV falls to OpenUV, then omitted |
| OpenUV | UV fallback (45/day shared) | 5s | Omitted |
| Google Pollen | Tree, grass, weed (UPI 0–5) | 5s | Omitted; score marked incomplete |
| National Weather Service | Humidity and rain for the mold estimate; county advisories | 5s | Mold becomes `no_data` (backend branch; `main` wrongly defaults to "low") |
| Mapbox | Address → coordinates, county, state | 8s | Onboarding shows a retryable error; nothing stored |
| ArcGIS Water_System_Boundaries (EPA) | Which utility's service area contains the point; population | 8s | `outside_known_area` or `lookup_failed` |
| EPA radon zones | County zone (static, 100 NC counties) | — | — |
| EPA UCMR 5 | PFAS results per water system (loaded into the database) | — | — |
| EPA ECHO | Facility compliance (map facilities layer — planned) | — | — |
| The Assistant model | Answers | 20s | Message with Retry |

**Roughly half of NC-08 has no air monitor within 25 miles**, so many households get modeled air — the interface labels it (§41.2). **No provider call has a server-side timeout today** (only `/api/health` and the Turnstile check do), so a cold daily-score, onboard, or home-guard request can take well over 8 seconds — the frontend's client timeouts account for this (A2). Caching: daily readings 1 hour per household (server); the home assessment is computed on every request (the blueprint's 24h cache isn't built; `home_risks` is unused); map and district pre-built daily (planned); Learn cached in the browser; history, journal, and Assistant answers not cached. **Every cached response states its age** (`retrieved_at`, `assembled_at`) and the interface shows it.

---

## 6. The API — what exists, and what the frontend binds to

**Bind to the PDF's Part D, verbatim.** It's the contract for the finished backend, and Vibhav's punch list uses the same names. This table tells you where each endpoint stands today so you know what you can call live and what needs fixture data for now.

Conventions (D0): every route except the daily job needs the bearer token; errors are `{ error: string }` and are never shown verbatim; **any field may be null or missing and the interface handles it** (em dash, No data, hidden element — never a crash, never a zero); severity is a closed set; daily readings and journal entries use the household's **local** `YYYY-MM-DD`; water sample dates bind the `*_iso` fields; responses change **additively only** (fields are added, never renamed or removed).

| Endpoint | On `main` | On `vmag211/backend` | Still to build (punch list) |
|---|---|---|---|
| `GET /api/profile` | ✓ — but returns 200 with `profile: null` on a DB error, and has no `onboarding_complete` | + `onboarding_complete`, `state`; 500 on DB error | — |
| `PATCH /api/profile { water_source?, home_year? }` | ✗ | ✓ (home_year 1700–current year or null) | — |
| `POST /api/onboard { address }` | ✓ — stores full-precision coordinates and ZIP; `home_year` unvalidated | + `state`, `service_area_status: "lookup_failed"`, coordinates rounded ~100 m, ZIP not stored (still echoed) | — |
| `GET/PUT /api/household` | ✓ (PUT is a full replace of the 7 booleans) | ✓ | — |
| `DELETE /api/account { confirm: "DELETE" }` | ✓ | ✓ | — |
| `GET /api/daily-score` | ✓ — **requires `lat` & `lng`**; no severity on the score; mold defaults to "low" when NWS fails | No params needed (uses the stored location); `?fresh=1` (429 if within 5 min); `retrieved_at`, `air.dominant_pollutant`, `uv.peak_window`, `pollen.categories`, `mold.basis`, `score.severity`; honest mold outage; local dates | — |
| `GET /api/history` | ✓ | ✓ | Readings recorded **every day for every household** (today only on days Today is opened) + backfill at onboarding; local dates everywhere (item 10) |
| `GET /api/home-guard` | ✓ — **requires `county`** (and pwsid etc.) as params; breakdown has only legacy `status` | No params needed (400 "No county on file…" if none stored); computed per request, no cache; `breakdown[].severity`, `radon.severity`, `score.severity`, `radon.out_of_state`, `exceeds_limit`, all `*_iso` dates, `detected_unregulated_latest`, `population_served`, `lead.utility_inventory`, revised confidence | — |
| `GET/POST /api/journal` | ✓ (GET ignores `?days`) | ✓ | `DELETE ?id=` / `?all=true`; `band` validation (item 13) |
| `POST /api/journal/retrospective` | ✗ | ✗ | Item 13 |
| `GET /api/journal/findings` | ✓ | ✓ | — |
| `GET /api/journal/summary` | ✗ | ✗ | Item 13 |
| `GET /api/learn` | ✓ — `title` degrades to the slug once seeded; UV/pollen/mold get a generic "why yours" line | ✓ | Real `title`; `value`/`severity` context for air, uv, pollen, mold; real source dates (item 14) |
| `GET/POST /api/assistant` | ✓ (grounded answers, guard, disclaimer) | ✓ | Household context, `uses_household_data`, `reason`, `page`, narrower guard, deployment (item 15) |
| `GET/POST /api/alerts` | ✓ (read / read-all) | ✓ | `dismissed` + undo; 3 missing alert types; stale-repeat fix (item 16) |
| `GET/PUT /api/notifications` | ✗ | ✗ | Item 16 |
| `POST/DELETE /api/push/subscribe` | ✗ | ✗ | Item 16 (VAPID) |
| `GET /api/volunteer` | ✓ (5 unverified seeds) | ✓ | 20–30 verified orgs (item 17) |
| `GET /api/map?layer=water` | ✓ — unscoreable systems wrongly `good` | unscoreable → `no_data` | Pre-built daily; `counts`, `hazard_index`, `quarters`, per-compound `date_iso` and `proposed_for_rescission`, `latest_sample_iso` (item 18) |
| `GET /api/map?layer=radon` | ✓ | ✓ | Pre-built daily (item 18) |
| `GET /api/map?layer=facilities` / `air` | ✗ (400) | ✗ | Item 18 |
| `GET /api/district` | ✓ — whole state, not NC-08 | ✓ | NC-08 scope, `counties[]`, `state_comparison`, `household_county`, `tested` denominators (item 19) |
| `GET /api/sources` | ✗ | ✗ | Item 20 |
| `GET /api/health` | ✓ | ✓ | `all_ok` should require `ok`, not just reachable (item 20) |

### 6.1 How to build against endpoints that aren't finished

- **Build every page to Part D.** Where an endpoint or field isn't live yet, use fixture data shaped exactly like Part D (put fixtures in one place, e.g. `lib/fixtures/`, never inline in components) and let the absent-field rule cover gaps in live responses. Never invent a different shape to match today's `main`.
- **Never work around a missing backend feature by computing it in the browser** (e.g. comparing readings for the Journal retrospective, deriving a severity from a raw value, or ranking counties). Those are server decisions; show the page's empty or no-data state until the endpoint exists.
- A route that doesn't exist yet returns 404/405 — treat it as that section's error state, not a crash.

---

## 7. Backend status and what's left

### 7.1 Punch list v3 (the list Vibhav is working from — "once it's done, the backend is done")

| # | Item | Status (Sept 27) |
|---|---|---|
| 1 | Upstash database gone (NXDOMAIN) — create a new one, set env vars in both places | **Unverified** — check `/api/health` |
| 2 | Auth outage returns 401 instead of 503 (data loss) | Done on `vmag211/backend` (`8c5f49d`) |
| 3 | One severity scale everywhere (`breakdown[].severity`, `score.severity`) | Done on backend branch (`1fa2a1f`) |
| 4 | A total outage shows a near-perfect day (mold defaulted to "low") | Done on backend branch (`1fa2a1f`) |
| 5 | Out-of-state addresses got NC radon zones | Done on backend branch (`0586cf7`) |
| 6 | Map painted unscoreable systems green | Done on backend branch (`02aaa59`) |
| 7 | Profile/onboarding misrouting; privacy rounding; `lookup_failed` | Done on backend branch (`0586cf7`) |
| 8 | `PATCH /api/profile` | Done on backend branch (`0586cf7`) |
| 9 | `/api/daily-score` to the contract | Done on backend branch (`1fa2a1f`) |
| 10 | Daily history for every household, backfill, local dates everywhere | Partly — readings now stored with the local date; the daily job doesn't yet record every household, and there's no backfill |
| 11 | HomeGuard water/lead contract (ISO dates, `exceeds_limit`, population, lead inventory) | Done on backend branch (`0586cf7`, `9fb758f`) — Severe lead level recorded as unreachable |
| 12 | Household wording walks the full priority list | Done on backend branch (`956f413`) |
| 13 | Journal delete, retrospective, season summary | Not started |
| 14 | Learn: real title, context for every topic, real source dates | Not started |
| 15 | Assistant: household context, `reason`, `page`, narrower guard, deploy | Not started |
| 16 | Alerts dismiss, missing types, preferences, device notifications | Not started |
| 17 | 20–30 hand-verified volunteer orgs | Not started |
| 18 | Map pre-built daily; hazard index; counts; quarters; facilities and air layers | Not started (item 6 part done) |
| 19 | District scoped to NC-08 with counties, comparison, `household_county` | Not started |
| 20 | `/api/sources`; health `all_ok` | Not started |
| 21 | Cross-cutting hygiene (identity from token, per-household limits on new routes, additive responses, tests, docs) | Ongoing |

Pre-launch checks (punch list Part 3 / §66): anonymous sign-in on (confirmed) · filter certifications verified · contaminant limits and the hazard-index formula verified · well-test costs verified · Assistant description checked against the January 2026 federal wellness/decision-support guidance · whether stored water data has multiple dated readings per compound (decides the time slider) · the Assistant against ten adversarial questions · every volunteer link resolves · every Learn source resolves with a real date · the full flow on three real NC-08 addresses + a no-utility address + an out-of-state address · the map on a real mid-range phone · env vars identical in `.env.local` and Vercel, and the daily job ran.

### 7.2 What this means for you right now

1. **The backend branch should be merged before frontend work depends on it.** It's a clean fast-forward of `main` with 233/233 tests. Without it, `main`'s `/api/daily-score` still requires `lat`/`lng`, `/api/home-guard` still requires `county`, there's no `onboarding_complete` or `PATCH /api/profile`, and HomeGuard has no canonical severities. **Migration `0009` must also be applied in the live Supabase project** or daily-score degrades. Both are Vibhav's to do — raise them through Yogi if they haven't happened.
2. **Until it's merged:** check with `git log --oneline main..origin/vmag211/backend`. If commits are listed, create your frontend branch from `origin/vmag211/backend` (not `main`), so the API you run locally matches Part D; once it merges, your PR diff shrinks to just your work.
3. **Don't edit backend files** (`app/api/**`, `lib/*` server modules, `supabase/**`, `test/**`, `scripts/**`). If the frontend needs a backend change, write it down for Vibhav with the exact Part D name.

---

## 8. The frontend — what you're building

The PDF has every element, binding, state, and string. This section is the map, so you know how the pieces fit before you open it.

### 8.1 The shared layer (build first — PDF Part A)

- **Shell (A1):** fixed header (page title left; on Today the alerts bell with an unread badge capped at "9+" plus the gear; everywhere else the gear only; never hides on scroll); fixed bottom tab bar (Today · Home · Map · Journal · Act — icon above label; icons: sun over horizon, house, folded map, notebook, outstretched hand; instant tab changes; each tab remembers its scroll position for the session); floating Assistant button lower right on the five tabbed pages (fixed — hiding it on scroll is Tier 3); offline banner under the header. Layer order, back to front: page → header → tab bar → assistant button → sheet backdrop → sheet → toast → offline banner.
- **First-visit routing (A1):** `ensureAnonSession()` → `GET /api/profile` → `onboarding_complete === true` → `/today` (or the deep link); request failed but local `halo.onboarded` set → `/today` and retry in the background; anything else → `/onboarding`. If the check fails for a household without the flag, show onboarding — never an error screen (§7.5).
- **URL state (A1):** `/map?layer=radon`, `/map?layer=water&contaminant=pfos`, `/map?system=NC0112010`, `/journal?mode=trends`, `/home?risk=water` (or `radon`, `lead`), `/today?learn=pfas`. Not in the URL: scroll position, the Assistant conversation, unsaved journal input, which Settings section is open. Unknown address → a short message and a button back to Today.
- **The back-button contract (A1):** opening any sheet pushes a history entry; Back closes it; closing a sheet any other way removes its entry; one sheet at a time; expanding a card is never a history entry; each onboarding step is a history entry; sheets lock scroll beneath and restore it exactly.
- **Data layer (A2):** one hook `useHaloData(endpoint, params)` → `{ data, status, error, retrievedAt, fromCache, refresh }` and one `<DataState>` wrapper that renders the four states. Stored readings for Today and HomeGuard render immediately on open (under 200ms), then refresh. Fresh request fails with stored data → keep it with "Showing your last readings from [time]. We couldn't reach the data source." Offline → banner "You're offline — showing your last readings." Pull to refresh on Today (`?fresh=1`) and HomeGuard (a plain re-request — no server cache); auto-refresh on return after 15+ minutes. Freshness lines use the server's `retrieved_at`/`assembled_at`. Offline journal queueing is Tier 3 — by default a failed save keeps the form filled and says "Couldn't save that entry. It's still here — try again." (PROPOSED). One toast duration for everything.
- **Error copy (A2):** 401 → silent reset · 503 → generic error + Retry, never reset · 429 → "You've made a lot of requests. Please try again later." (pull-to-refresh 429 → keep readings + a short toast) · 500/network → "Something went wrong on our end, not yours. Try again in a moment." · client timeout 8s by default, **15s** for onboard, daily-score, and home-guard (their providers have no server timeouts yet), **25s** for the Assistant → "That took too long. The data source may be slow right now." (on an onboard timeout, re-check the profile first — the write may have succeeded) · home-guard 400 "No county on file" → HomeGuard error state with Change address
- **Severity, confidence, provenance (A3):** color + icon + word always; one mapping from the six words; where to read severity on each screen; the hero ring reads `score.severity`; confidence pills (`partial`, `3+ yrs old`, `not evaluated`); provenance pills (`measured`, `modeled`, `estimate` — air by `is_measured`, mold and radon always estimate, lead when `is_estimate`).
- **Formatting (A5):** AQI whole number · UV one decimal · pollen "Grass 3" · concentrations one decimal + unit ("8.3 ppt") · ratio "2.1× the limit" · score whole number, no % · "Zone 2" · populations with commas ("120,000+" above 100,000; "at least" when incomplete) · costs "$40–90" · missing → "—". Relative dates under a week, then "March 14", "October 2024"; lab samples always month + year. Sentence case everywhere; PFOA/PFOS/PFHxS/PFNA keep their capitals; `HFPO-DA` displays as "GenX (HFPO-DA)".
- **Forms (A7):** validate on blur; never disable submit for validation; visible labels; inputs 16px+; build year 1700–current year or blank.
- **Accessibility and motion (A8):** 44×44px targets; full keyboard operation with visible focus; sheets trap and return focus; Escape closes sheets; text alternatives; every chart has a text equivalent; body text never below 15px and respects the user's text size; reduced motion respected; press feedback within 100ms; toggle chips flip instantly and revert visibly on failure; numbers never truncate; Spanish runs 15–30% longer.
- **Shared components (A9)** and **signature visuals (A10):** score ring, contribution bar, threshold bar chart (fixed 0–2× limit scale on every row, worst-first, unscored below a divider), house diagram, calendar heat grid, seven-day trend, quarterly trend, comparison bar pair. All inline SVG.

### 8.2 The pages (PDF Part B)

**B1 Onboarding** (`/onboarding`, full screen, no chrome) — four steps plus a results reveal, deliberately minimal (§10.1).
1. *Welcome:* logo, "HALO shows you what's in the air, water, and ground around your home — and what to do about it. No account needed.", **Get started** (disabled until the session exists), "Takes about a minute."
2. *Address:* "Where do you live?", address field ("Street address or ZIP code"), **Use my location**, the privacy line, **Continue** → `POST /api/onboard { address }` (404 / 429 / 500 each have their own copy).
3. *Household:* "Who lives here?", seven toggle chips (Toddler · Child · Teen · Adult · Senior (65+) · Someone pregnant · Someone with asthma or a breathing condition), **Continue** (`PUT /api/household` with all seven) or **Skip this** at equal weight (no call).
4. *Your home:* "A little about your home.", optional "Year built" with the lead-solder note, required "Where does your water come from?" (City or town water · Private well · Spring · Other · Not sure), **See my results** → `PATCH /api/profile { water_source, home_year }` → set `halo.onboarded`.
- *Results reveal:* the logo, then four lines resolving in sequence — "Finding your water utility..." · "Checking federal testing results..." · "Looking up radon for [County]..." · "Getting today's air quality..." — from `GET /api/daily-score` and `GET /api/home-guard` in parallel; a note for non-NC addresses; **See my results** → `/today`. Never "Your water is safe."

**B2 Today** (`/today`) — hero: score ring (`score.display_score`, colored by `score.severity`), headline, incomplete and estimate notices, location line, contribution bar, and a **time-of-day gradient** behind the hero driven by the device clock (§6.7). Four expandable reading cards — Air quality, UV index, Pollen, Mold risk — each with value, severity pill, provenance pill, the server's household sentence, a seven-day trend (`/api/history?days=8`), extra detail (dominant pollutant, UV peak window, pollen by category, mold basis), and "What does this mean?" → Learn. Bell → Alerts; pull to refresh; every page-level state.

**B3 HomeGuard** (`/home`, tab "Home", title "Your Home") — hero ring (water + radon only; floor and cap notices; null for wells), headline, basis line, contribution bar; the **house diagram** (tap = water, foundation = radon, pipe = lead). Card 1 Drinking water branches on `water.status` — measured (threshold bar chart, detail rows, limit type, rescission marker, quarterly trend when 2+ dated readings, unregulated group, guidance-scored group, excluded-from-score group with lithium's reason, regulatory notice, sample age) · `detected_unregulated` · `private_well` (the testing plan: framing, why these tests, tests in priority order, totals) · `no_data_yet` · `lookup_failed` · `no_pwsid_available` (the "are you on a well?" prompt → `PATCH /api/profile`). Card 2 Radon (county and zone, what a zone is and isn't, the 4 pCi/L action level, testing, seasonal note, out-of-state state). Card 3 Lead (age-based estimate, household sentence, unknown-year prompt, the utility's service-line counts as context). **Your Action Plan** (ranked, Elevated and above, cost, certification, renter/owner wording).

**B4 Journal** (`/journal`) — two modes (segmented control). *Log:* the first visit asks "Think back over the last few weeks. Which days were rough — headaches, congestion, trouble sleeping? Tap them." on a month calendar; **See what was in the air** (active at three or more days) → `POST /api/journal/retrospective` → an immediate first insight in a callout, then "Start logging daily"; ongoing form — date, who (a household group or "household"), symptoms, severity (mild/moderate/bad), "probably a cold or flu", note (≤500), Save/Update, and **"Felt fine today"** (Tier 1 — records good days); recent entries (swipe to delete with undo); seasonal prompts. *Trends:* the calendar heat grid (each day's worst severity, logged days marked, No data distinct from Good), day-detail sheet, findings or the not-ready state with its counts, disclaimer, line chart. **No streaks, no badges, no points, no celebrations** (§14.2).

**B5 Act** (`/act`) — editorial cards, each opening a sheet: **Volunteer near you** (`/api/volunteer?causes=…` matched to the household's findings, with verification dates); **How you can help** (items shown by the household's radon, water, and nearby-facility findings, plus always-on items); **Write a letter** (to the water utility, a landlord, or the elected representative, filled with the household's real values — utility name and ID, contaminant, value, limit, date, population served; §15.5 calls it "the single strongest fit for a congressional competition"); **Your home's health card** (both scores, a category table, household notes, top actions, sources; **Save as image** and **Print** — print output is always light).

**B6 Settings** (`/settings`, back arrow) — eight accordion sections (seven until reviewed Spanish exists — Language is hidden until then), one open at a time, each showing its current value when closed: Household · Your home (build year, water source, Change address) · Renting or owning · Language · Accessibility (device-local: text size, higher contrast, reduce motion) · Notifications (five alert types + device notifications) · Data and privacy (the privacy statement, **Delete everything** with a typed DELETE confirmation, and — PROPOSED — "What HALO knows about you" and Clear journal) · About (every data source with its last-retrieved date, how scores work, who built it). Saves immediately; one save function for `/api/household` that always sends all seven groups. "Not set" means no group is true (not `household_set` alone). Change address: clear stored readings, then `GET /api/daily-score?fresh=1` (the server cache doesn't know the location changed) and `GET /api/home-guard`; proposed flow: address → Your home (prefilled) → results reveal → Today.

**B7 Map** (`/map`) — full-bleed map (header over it; the map library loads only on first open; column widens to 600px). Layer chips: Water · Radon · Facilities · Air. Water's **contaminant selector** — Overall water health (default) · PFOA · PFOS · PFHxS · PFNA · GenX · Combined hazard index — recolors the state (the moment judges remember). Tapping a system, county, facility, air monitor, or the home pin opens a detail sheet. Time slider only if `quarters` is non-empty. Comparison banner, freshness line, and the **District panel** ("See the full NC-08 picture", above the tab bar): the population affected across the district, a county-by-county table, the state comparison, and the named local situation (Concord — Hillgrove WTP, Union County, compliance timelines to 2031) — every figure with its assembled date, no personal data. Water and air layers never cluster; facilities cluster. Locate animates to the home pin; zoom buttons stay visible everywhere; no auto-panning above sheets (Tier 3). Dark mode uses a dark base map. The legend for a compound with no reading says "No detection reported" (non-detects weren't loaded). If the map library fails, the district content shows as a full page.

### 8.3 The overlays (PDF Part C)

- **C1 Learn** — opens only from "What does this mean?" on a specific reading (no index, no browsing). Title, "your reading", then five parts: What it is · Why yours reads this way (the household's own value) · What it means for your household · How to protect yourself (concrete steps for this week) · Sources (visible footnotes with retrieval dates and working links). Its signature is typographic — strong headings, pulled-out key facts (§6.7).
- **C2 Assistant** — tall sheet from the floating button, carrying the current page. Suggested questions, conversation, a thinking state (answers can take ~20s), numbered citations, a "uses your readings" marker, a declined-answer callout for diagnosis questions, the disclaimer, and a question input (≤1000 characters). Branch on the response exactly as C2 says. Last to build, first to cut.
- **C3 Alerts** — from Today's bell. Title row "Alerts" with a tertiary **Mark all read**; newest first; tap expands the full message and marks it read, with a link to the related page; swipe to dismiss with undo; empty state. Browser notification permission is asked only when the person turns device notifications on in Settings, and only after they've used the app at least once (§19.5).

### 8.4 Build order, done, and cutting

- **Order (E2):** 0 design foundation (locked) → 1 shared layer (data hook, auth handling, formatting, severity mapping, translation layer, color tokens light + dark) → 2 Onboarding + results reveal (sets the base component styles) → 3 shell → 4 **Today on a real phone with live data** (the blueprint's own measurement, §26.4: if this takes hours the plan holds; if days, cut scope now) → 5 HomeGuard + Learn → 6 Journal → 7 Act + Alerts → 8 Settings → 9 Map + District, then Assistant.
- **Done (E1, §42):** all four states with distinct error/empty copy · formatting per A5 and no invented copy · color + icon + word · every estimate labeled and every data point's source and date available · bound to Part D exactly, no legacy `status` · every field tested null · Back correct and scroll kept · keyboard, focus, 44px, reduced motion · checked at 375px on a real phone in light and dark · no console errors and the performance targets met · every string through the translation layer.
- **Tiers and cut order (A12, §65):** Tier 1 never cut; Tier 2 in order (contaminant selector, household wording, threshold bars, heat grid, house diagram, results reveal, contribution bar, trends, pull to refresh, Spanish); Tier 3 cut first. Page cut order: Assistant → Settings → Act → District panel.
- **Performance (§35):** first content under 1.5s (max 3s), interactive under 2s, tab change under 100ms, sheet open under 250ms, cached readings under 200ms, map first render under 2s, layer switch under 300ms, first-load weight under 500KB (max 1MB) — on a mid-range phone over mobile data.
- **Testing (§40):** real addresses — Concord (PFAS above the limit, the demo case), Union County, a third NC-08 utility with no results, a rural no-utility address, an address entered as a well, an out-of-state address; household and build-year permutations; renting vs owning; Journal at 0, 4, and 20 entries; every map layer and contaminant; ten adversarial Assistant questions; every empty and error state; both mobile engines; keyboard-only; a screen reader on Today and HomeGuard; a blocked data source; offline and back; Back with every sheet; deep links in a fresh browser.

---

## 9. Design

### 9.1 The locked foundation (PDF A11 — don't change these)

**Severity colors**

| Word | Label | Light | Dark | Style | Icon |
|---|---|---|---|---|---|
| `good` | Good | `#1e7a3c` green | `#4cc27a` | solid fill | circle with check |
| `moderate` | Moderate | `#b85c00` orange | `#f0913a` | solid fill | circle with i |
| `elevated` | Elevated | `#c0262d` red | `#f0605f` | solid fill | triangle with exclamation |
| `high` | High | `#8e2a6b` red-purple | `#d668ad` | solid fill | octagon with exclamation |
| `severe` | Severe | `#4f1440` deep purple | `#a870f0` | solid fill | filled octagon |
| `no_data` | No data | `#111111` black | `#e6e6e6` near-white | **outline only — never filled** | circle with question mark |

No data is an outline because black and deep purple are nearly the same brightness — it must never be mistaken for Severe. Pill text on a filled level is white in light mode and `#081725` in dark mode. Every color passes 4.5:1 in its mode. Icons from lucide-react with clearly different shapes.

**Brand and surfaces**

| Token | Light | Dark | Use |
|---|---|---|---|
| Navy 900 | `#0b1f33` | `#081725` (page) | Main text in light mode; the base of dark mode |
| Navy 700 | `#133b5c` | `#1d3a50` (border) | Headers, deep accents |
| Primary (deep teal) | `#0e5e6f` | `#2cc4bd` | Primary buttons, active tab, links, focus ring |
| Teal 500 | `#138a8a` | — | Secondary accents — **never text** |
| Turquoise | `#1fb5b0` | — | Highlights and fills only — **never text** |
| Light aqua | `#a8e6e2` | `#a8e6e2` on `#1d4f5c` | Selected chips, soft tints — sparingly |
| Page background | `#eef8f7` (aqua mist) | `#081725` | Behind cards |
| Card surface | `#ffffff` | `#0f2436` | Cards and sheets |
| Border | `#d3e4e6` | `#1d3a50` | Dividers, card outlines |
| Body text | `#0b1f33` | `#e8f3f5` | All primary text |
| Secondary text | `#4a6275` | `#9bb4c2` | Timestamps, sources, captions |

No saturated green anywhere in the brand, so green always means Good. **Light mode is the default; dark mode follows the system setting; there's no in-app toggle.** Every color is a CSS token from day one (Tailwind v4 `@theme` in `globals.css`), defined for both modes. The health card's print output is always light.

**Typefaces** (all free Google Fonts via `next/font/google`, with a system fallback; all cover Spanish accents)

| Role | Face | Notes |
|---|---|---|
| Headings, page titles, hero score numbers | **Fraunces** (variable) | The app's personality — a soft serif. It has **no tabular digits**, so an animated score needs a fixed-width container so it doesn't wobble |
| Everything else — body, labels, buttons, cards, data rows | **Instrument Sans** | Readings use its tabular digits (`font-variant-numeric: tabular-nums`) so columns align — verified the font has them |
| Codes only | **IBM Plex Mono** | Water system IDs (`NC0190010`), certifications (`NSF/ANSI 53`). Never for readings |

How these were chosen: Yogi asked for an environmental palette of greens, blues, and teals in darker shades, with severity in green → orange → red → a reddish warning purple → a darker purple, and black for no data; the brand in dark blues, navy, dark teals, and turquoise with a sprinkle of light aqua. Generic font candidates were rejected as looking alike; the "field journal" set (Fraunces / Instrument Sans / IBM Plex Mono) was chosen for personality without losing clarity. The palette wasn't tuned for red-green color blindness — Yogi's call — which is safe only because severity is always color + icon + word. The palette swatch sheet and type specimen from planning were previews of colors and fonts only, not page designs.

### 9.2 What's replaced — never use it

- The blueprint's visual values: its palette (`#0d5c63` teal, `#16653a`… severity hexes, which also still sit in `lib/severity.js` — don't use them), its type (a sans plus a monospaced face for values), its sizes, spacing, radius, shadows, and pixel geometry (§6.3–6.5, §56–60). Its non-visual rules (severity semantics, icons, never color alone, chart honesty, accessibility minimums) still apply.
- **Vibhav's glassmorphic HomeGuard frontend and `docs/HALO-design-language.md`** on `vmag211/homeguard-frontend` — Playfair Display + Poppins, dark per-subject gradients, glass hero and nav, its own severity colors, its shield-score motif. Discarded with his permission.
- **The legacy onboarding look** — aurora and plexus canvases, the frosted glass card, the 390×844 phone shell, the gradient button, "Proxima Soft"/"DM Sans".
- `app/layout.tsx`'s Geist fonts and `globals.css`'s Arial body and default colors.

### 9.3 How design works now — you design, Yogi approves (PDF A13)

Codex does the wireframes, the visual design, and the code for every page. Yogi supplies reference inspiration — screenshots of real apps whose feel he wants — and approves each page's look. The "wireframe" is the real page, coded at 375px against fixture data, then wired to the API. Per page:

1. **Read the function first:** the page's Part B section and every shared part it uses. The element table is the checklist — every element, binding, state, and copy string.
2. **Study Yogi's references.** Borrow what they do well (hierarchy, spacing rhythm, density, how cards and charts are treated). Don't borrow their colors or fonts (A11 governs) or their emptiness if this page holds more data.
3. **Build against fixture data covering every state** — populated, loading, empty, error, partial/no-data, offline — in light and dark, at 375px.
4. **Check against the element table line by line, independent of the look.** A visual change never drops an element, a state, or a string to look cleaner. If a layout can't hold a required element, the layout changes.
5. **Show Yogi screenshots of every state.** Iterate on visuals only. List every PROPOSED item you built so he can keep or cut it.
6. **Wire to the live API (Part D)** and run the definition of done (E1).

### 9.4 The quality bar — high-end, not overboard

Yogi's standard: it must not look like slop, and it must look high-end without going overboard. The blueprint's standard (§6.0, §65.5): clean, deliberate, finished — "Build to clean and stop." Those are the same thing: **what reads as high-end is discipline** — one type scale, one spacing scale, one color system applied predictably; aligned edges and even margins; text that never overflows; nothing shifting as content loads; correct contrast in both modes; precise details (consistent icon stroke weight, icons optically aligned with text, tabular digits in data, real hierarchy between a reading and its caption).

Personality comes from one signature element per page, each carrying meaning (§6.7): **Today** — a time-of-day gradient behind the hero, driven by the device clock (cool blue before dawn, bright at midday, amber at dusk, deep navy at night — expressed in the A11 palette); **HomeGuard** — the house cross-section diagram; **Map** — full-bleed with floating controls; **Journal** — the calendar heat grid; **Act** — editorial: taller cards, larger type, generous whitespace, one strong icon each; **Learn** — typographic, with sources as visible footnotes. Buttons, cards, and type stay identical everywhere. "If a visual decision takes more than an hour and doesn't change what a person understands, it isn't worth making."

**What makes an interface look generated — avoid all of it:** gradient washes, glassmorphism and blur, decorative blobs or particle canvases (the only gradients are Today's time-of-day hero and Onboarding's Welcome band) · drop shadows on every card, colored left-border cards, everything a rounded pill · emoji as icons, mixed icon families, decorative icons · colors outside the tokens · center-aligned body text, title case, all caps, exclamation marks · lorem ipsum or invented numbers · a fake phone frame or status bar · uneven spacing, near-miss alignment, animation on everything.

**The blueprint's simplifications are the defaults (§65.4):** three button variants (primary, secondary, tertiary — destructive is secondary in the Elevated red; icon-only is tertiary with no visible label); two sheet heights (standard ~70%, tall ~90%); the severity pill rather than a colored card edge as well; two skeleton shapes (card block, text block); three motion durations (150ms fades, 250ms movement, 400ms score ring). Nothing longer than 400ms; everything instant under reduced motion except very short fades.

### 9.5 Identity and icons (§32 — locked)

- The logo is the Welcome mark (~120px wide), the browser tab icon (32, 96, 192px), the home-screen icon (192, 512px, via a web app manifest), and the 1200×630 link-preview image (mark and name over the primary color). Replace the default Next.js favicon.
- `theme-color` = the Primary token: `#0e5e6f` light, `#2cc4bd` dark (two `<meta name="theme-color">` tags with `media` queries). Page titles "HALO — [page name]"; link-preview description "See what's in the air, water, and ground around your home — and what to do about it."
- One icon family (lucide-react), one line weight. Concept icons: Today sun over horizon · Home house · Map folded map · Journal notebook · Act outstretched hand · Air wind lines · UV sun · Pollen flower · Mold droplet · Water tap · Radon radiation trefoil (closest lucide match at the same weight) · Lead pipe · Alerts bell · Settings gear · Assistant chat bubble.
- Settings' higher-contrast switch has no defined palette in the blueprint; proposed: secondary text uses the body-text token, borders use Navy 700, pills and focus rings get a 2px outline — a token override on the root (A8).

### 9.6 The proposed base visual system (PDF A13 — a starting point, finalized in Onboarding's design pass)

| Type role | Face | Size / line height | Use |
|---|---|---|---|
| Hero score | Fraunces 600 | 56 / 60 | Today and HomeGuard composite — fixed-width container |
| Display | Fraunces 600 | 30–32 / 38 | Onboarding Welcome sentence |
| Step / page heading | Fraunces 600 | 26 / 32 | Onboarding questions |
| Header title | Fraunces 600 | 22 / 28 | Page titles in the header |
| Section heading | Fraunces 600 | 18 / 24 | Sections within a page |
| Card title | Instrument Sans 600 | 16 / 22 | Card headers |
| Body large | Instrument Sans 400 | 17 / 24 | Supporting sentences |
| Body | Instrument Sans 400 | 15 / 22 | All explanatory text — the floor |
| Small | Instrument Sans 500 | 13 / 18 | Timestamps, sources, captions, labels, errors — never explanations |
| Pill | Instrument Sans 600 | 12 / 16 | Severity, confidence, provenance pills only |
| Button | Instrument Sans 600 | 16 | Button labels |

Spacing on a 4px grid (4, 8, 12, 16, 24, 32, 48), 20px page gutter. Radius: cards and inputs 14px, buttons 12px, chips and pills fully rounded, sheets 20px top corners. Cards: surface + 1px border, no shadow; the primary button is the one element with a soft shadow (`0 2px 8px rgba(11,31,51,.12)`). Primary button: teal fill, white text, 52px, full width in forms, loading holds its width with an in-place spinner. Secondary: 1.5px teal border. Tertiary: teal text only. Disabled: 40% opacity, only for genuinely unavailable actions. Inputs: 52px, 1px border, 14px radius, card fill, a visible label above, 2px teal border plus focus ring on focus, Elevated-red border and red error text with an icon beneath on error. Toggle chips: unselected card fill + border; selected light-aqua tint + 1.5px teal border + a small check icon (state not by color alone), `aria-pressed`. Onboarding progress: four 3px segments, filled teal / unfilled border color, screen-reader text "Step 2 of 4". Severity pill: icon + word, filled (No data outlined).

### 9.7 Onboarding's design decisions (PDF B1)

- **Tone — decided: "something in between"** quiet and immersive. The aqua-mist page background everywhere, with a brand moment on Welcome only; steps 2–4 and the results reveal stay light and calm so fields, errors, and results read clearly.
- **Welcome's band — decided:** a navy-to-teal band behind the logo, on Welcome only. Proposed values: about 220px tall across the top, a gradient from Navy 900 `#0b1f33` to Primary teal `#0e5e6f` at ~165°, the logo centered in it; below, the sentence, **Get started**, and "Takes about a minute." on the page background.
- **The logo on navy is open:** it's a full-color badge on a transparent background — it needs a treatment that holds up on the band (a white or light-aqua disc behind it, or a one-color white version). The results reveal uses the standard logo, small.
- **Step transition (proposed):** a 250ms slide (Back reverses it) or a cross-fade; instant under reduced motion. Tier 3 — a cross-fade or nothing is fine.
- **Results reveal (proposed):** the four lines fade up in sequence over about two seconds; each line's small working indicator becomes a check when its result arrives, or a neutral dash for "not available"; reduced motion shows all four at once.

---

## 10. Voice, copy, and privacy

### 10.1 Voice (PDF A6, §30)

Plain, specific, steady. Never minimize a real problem; never frighten someone who can't act tonight. About a sixth-grade reading level — it's a health app read under stress.

- Never "safe" or "unsafe" as a bare verdict ("Nothing found above federal limits" is a statement about a measurement; "Your water is safe" is forbidden).
- Never exclamation marks. Never fear words: toxic, poison, dangerous, alarming, shocking.
- Never apologize for data that doesn't exist; never congratulate a good reading; never "simply," "just," or "easy" for something that costs money or effort; never imply a medical outcome.
- Second person ("your water"). HALO calls itself HALO, never "we" making promises.
- Sentence case everywhere, buttons and headings included. HALO always in capitals. Tagline where needed: "Know what's around your home." Browser titles: "HALO — [page name]."
- **No invented copy.** Every string comes from the spec (the blueprint's content inventory, §31) or is marked PROPOSED for Yogi to approve. Some server `message` strings name services a household wouldn't recognize — where the spec gives blueprint copy for a state, use it instead (A6).
- Universal controls: Close, Back, Retry, Save, Cancel, Skip, Continue, Done, See more, Show less. Confirmations: change address — "This will replace your current results. Continue?"; delete everything — "This permanently deletes everything HALO knows about your household. This cannot be undone." + typing DELETE; clear journal — "This deletes all [n] of your entries permanently."; one journal entry — immediate, with undo.

### 10.2 The privacy statement — verbatim (Settings → Data and privacy)

> What HALO stores: your approximate coordinates, your county, which water utility serves you, your home's build year, and which household groups you told us about.
>
> What HALO never stores: your street address, anyone's name, anyone's age or birthday, and any medical record. Your journal notes stay on your account and are never shared with anyone.
>
> When you ask HALO's assistant a question, the readings and logged symptoms that help answer it are sent to its AI service to write the answer. Your notes are never sent.

Also stated: HALO collects no behavioral analytics (§37.4). **The Assistant decision (Sept 27):** Yogi approved letting the Assistant send relevant readings and journal symptom names and dates (never free-text notes) to its AI provider, because HALO isn't shipping as a published product; the statement above reflects it.

Privacy commitments (§37.3): the street address is never stored (geocoded server-side, then discarded; coordinates rounded to ~100 m; ZIP not stored) · no names, ages, or birthdates anywhere · no account required · everything deletable (`DELETE /api/account` cascades through every record).

---

## 11. Decision log

The complete, numbered log is **Part F of the PDF** (28 decisions + the open list). The decisions most likely to be undone by accident:

| Decision | Status |
|---|---|
| Web app with a mobile-shaped layout, not native | Locked |
| Blueprint function and content are ground truth; its visual spec is void and redesigned | Locked |
| Vibhav's glassmorphic frontend and design-language doc are discarded (with his permission) | Locked |
| Every page holds all the content it can; Onboarding stays minimal | Locked |
| The frontend spec targets the finished backend; Part D is the shared contract | Locked |
| Codex does all frontend design and code; Yogi supplies references and approves | Locked (Sept 27) |
| Six severity words including `elevated`, exactly as the code emits them (an idea to drop "elevated" was superseded) | Locked |
| The A11 palette, the Fraunces / Instrument Sans / IBM Plex Mono type, light default + system dark | Locked |
| Onboarding tone "something in between" — navy-to-teal band on Welcome only (exact values are design) | Locked |
| Tier 3 items take their simple defaults (fixed Assistant button, no auto-pan, visible zoom, one toast duration, no offline queue unless time allows) | Locked (§65.3) |
| The base visual system (A13) | Proposed — finalize in Onboarding |
| Server decides severity, scores, and sentences; bind `severity`, never `status` | Locked |
| 401 → reset silently; 503 → retry, never reset | Locked |
| Route on `onboarding_complete` + local `halo.onboarded` | Locked |
| Assistant may send readings and symptom names/dates (never notes); privacy statement updated | Locked (Sept 27) |
| Coordinates rounded ~100 m; ZIP not stored | Locked |
| Radon only for NC addresses (`out_of_state` otherwise) | Locked |
| Severe lead level is knowingly unreachable; utility inventory shown as context | Locked (Vibhav, Sept 27) |
| Journal's first-visit comparison is computed server-side | Locked |
| Map and district data pre-built daily | Locked |
| Spanish ships only after human review; translation layer from day one | Locked |
| Settings toasts only on failure | Proposed |

---

## 12. Traps — things that will silently show wrong information

1. **`status` vs `severity`.** Every legacy `status` field disagrees with `severity` somewhere. Bind `severity` (or `lead.level`).
2. **Scores:** display `score.display_score`, never `score.score` (unrounded). Color the ring from `score.severity`, never from the number — an ordinary day scores in the 50s.
3. **Null is not zero.** `aqi: null`, `display_score: null`, `mold.risk: null` → em dash / No data. Never `?? 0`.
4. **`PUT /api/household` is a full replace.** Omitted groups become `false`. One save function that always sends all seven, as real booleans. Its response echoes `renter_mode`/`locale` only if you sent them — keep local state from the profile.
5. **`onboarded` turns true at the address step,** before water source is known. Route on `onboarding_complete`.
6. **A 401 wipes the session.** Only let a genuine 401 do that; a 503 is retry-only. Make sure your data layer doesn't treat other failures as 401.
7. **Water dates:** `latest_sample_date` and `date` are `M/D/YYYY` strings — `new Date("7/1/2025")` is locale-dependent. Bind `latest_sample_iso`, `date_iso`.
8. **Local dates:** history and journal use the household's local `YYYY-MM-DD`; compute "today" in local time, never from a UTC timestamp; join readings and entries by the date string.
9. **Freshness:** show the server's `retrieved_at`/`assembled_at`, not when the browser received the response (a cached reading can be an hour old).
10. **"Above the limit"** comes only from `scored_contaminants[].exceeds_limit` — never compare `value_ppt` to `limit_ppt` yourself. The ratio label ("2.1× the limit") is arithmetic on server numbers, which is fine.
11. **`HFPO-DA` displays as "GenX (HFPO-DA)".**
12. **No data is outlined, never filled** — black filled reads as Severe.
13. **Private well or spring:** `display_score` and `score.severity` are null, `lead` is null, `action_plan` is empty, and `water.test_plan` carries the plan. Don't show an empty score as a bad one.
14. **`service_area_status: "outside_known_area"`** is common and normal in NC-08 (no boundary contains the point) — not an error. `lookup_failed` means the lookup itself failed.
15. **Radon `out_of_state`:** never show an NC zone for an out-of-state county with the same name.
16. **Journal findings use camelCase** (`flaggedDays`, `totalDays`) unlike everything else.
17. **Headers:** pass `authedFetch` headers as a plain object, not a `Headers` instance.
18. **Never display a server `error` string** — they include raw database messages.
19. **Pull-to-refresh 429** is not an error — keep the readings, show a short toast.
20. **Assistant answers can take ~20s** — its client timeout is 25s, not 8s.
21. **Fraunces has no tabular digits** — the animated hero score needs a fixed-width box.
22. **Teal 500 and Turquoise fail contrast as text** — fills and accents only.
23. **The time slider exists only if `quarters` is non-empty.** Don't build a slider that has nothing to scrub.
24. **Lead never colors the HomeGuard ring** — `score.severity` there is water and radon only.
25. **The old onboarding labels** (`City utility`, `Well`) aren't the locked ones; the server normalizes both, but the UI shows the locked set.
26. **Don't bring back the hardcoded Austin fallback** or any fake "location detected" state.
27. **Don't write derived data from the client** (scores, alerts) — the server owns it and row security blocks it anyway.
28. **Don't send identity in a body or query** — the token is the identity.
29. **The Assistant sheet must be removable** without a dead button — it's first to cut.
30. **Map library:** import it dynamically inside the Map page only, or the first-load budget (500KB) is gone.
31. **Out-of-state water:** HALO's water data is NC-only, so an out-of-state utility returns `no_data_yet` — don't show "results haven't been published yet" when `state` isn't `NC` (B1, B3).
32. **Every NC-08 county is radon Zone 3.** Use Zone 3 in NC-08 fixtures; test radon paths with Buncombe (Zone 1) or Iredell (Zone 2).
33. **"No detection reported", not "Not tested"** — non-detects were never loaded.
34. **No utility name** exists for `no_data_yet` or `lookup_failed` — show the PWSID so the household can check it.
35. **Lead text repeats:** for an unknown build year, `lead.sentence` and `lead.text` are the same sentence — show it once; show `lead.text` only when it differs.
36. **Changing the address:** the daily-score cache doesn't know the location changed — request `?fresh=1` afterward.
37. **Utility names arrive in capitals** ("CONCORD, CITY OF") — proposed: title-case for display, keeping acronyms.
38. **"Not sure" is stored as `other`** — Settings preselects "Other" afterward.
39. **`household_set` becomes true** when renting or language is saved — derive "Not set" from "no group is true".
40. **Server calls have no timeouts yet** — use the longer client timeouts in A2, and re-check the profile after an onboard timeout.
41. **Tier 3 defaults win over the blueprint's fancier versions:** fixed Assistant button, no map auto-pan, zoom buttons always visible, no offline journal queue unless time allows, one toast duration.

---

## 13. Team workflow and environment

- **Git:** branch per feature, pull requests required, **no direct pushes to `main`** — and every merge to `main` deploys the live site. Pull the latest `main` before each session (§26.3).
- **Two frontend builders** (Yogi and Naggi): split by page so no two people edit the same files; shared components have one owner, and the other requests changes rather than editing them (§26.3).
- **Run everything from inside the `halo-app` folder,** not its parent — a recurring early error.
- `npm run dev` → when it prints "Ready in …ms" the server is live; leave it running.
- On Windows, a PowerShell execution-policy error is fixed with `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`.
- Two moderate npm audit warnings were reviewed and deliberately left alone.
- **Environment variables must match in `.env.local` and Vercel** (§38.2). Local development uses the same Supabase database as production, so local testing writes real records — make test households identifiable so they can be deleted before launch (§38.3).
- Backend verification: `node --test test/*.test.mjs` (logic) · `node scripts/smoke-test.mjs` against a running dev server on port 3100 (routes). Migrations are applied by hand in the Supabase SQL editor.
- There's no frontend test tooling yet. Add what you need (e.g. Playwright for the 375px, keyboard, and deep-link checks) as dev dependencies only.

---

## 14. Open items and risks (as of Sept 27)

| Item | Owner | Why it matters |
|---|---|---|
| Merge `vmag211/backend` into `main`; apply migration 0009 live | Vibhav | Today, HomeGuard, routing, and severities depend on it |
| Upstash replacement (item 1) | Vibhav | Assistant pauses and map/district slow down while it's down |
| Punch list items 10, 13–20 | Vibhav | Journal extras, Learn context, Assistant context, alert extras, notifications, map layers, district, sources |
| Map library choice + NC county shapes asset | Codex/Yogi | B7; first-load budget |
| The logo treatment on Welcome's navy band | Codex/Yogi | B1 |
| Whether stored water data has multiple dated readings per compound | Vibhav | Decides the map time slider and quarterly trends |
| Spanish review | Team | Spanish ships only if a person reviews it |
| 20–30 verified volunteer orgs | Aadit / team | Act's first card |
| Real Learn source dates and link checks | Team | Learn's credibility |
| The NC-08 office's evaluation criteria | Yogi | One email (§66 item 12) |
| Assistant deployment (key, corpus, adversarial test) | Vibhav | Or cut it (§68) |
| Every PROPOSED item in the PDF | Yogi | Keep or cut as each page is built |
| Where Change address ends; the alerts-badge behavior; the privacy statement's incomplete "stores" line | Yogi | PDF F4 |
| Server timeouts per source; reload water data with non-detects; a distinct water status for out-of-state utilities; invalidate the daily cache on address change; reword server strings that break the voice rules | Vibhav (and Aadit for wording) | Found in the final review |
| Deadline: Oct 26, 12:00 PM EST (internal Oct 23) | Everyone | Build in order, cut from the end |

---

## 15. Glossary

| Term | Meaning |
|---|---|
| **MCL** | Maximum Contaminant Level — the legally enforceable federal limit for a substance in drinking water |
| **ppt / ppb** | Parts per trillion (PFAS) / parts per billion (lead, metals; 1,000× a ppt) |
| **pCi/L** | Picocuries per liter — the radon unit; the federal action level is 4.0 |
| **Hazard index** | A federal combined measure for several PFAS together; 1.0 or above is a violation even if no single compound exceeds its own limit |
| **Non-detect** | Tested, nothing found above the lab's detection threshold — distinct from untested and from zero |
| **Health advisory level / health benchmark** | A non-enforceable reference value where no enforceable limit exists; always labeled non-enforceable |
| **PFAS** | "Forever chemicals" — thousands of manufactured compounds that don't break down |
| **PFOA, PFOS** | The two most studied PFAS; federal limit 4.0 ppt each |
| **PFHxS, PFNA, GenX (HFPO-DA)** | Regulated PFAS with limits of 10.0 ppt, all under a proposed federal rescission |
| **Radon / radon zone** | A radioactive soil gas, the second leading cause of lung cancer in the US / an EPA county-level prediction of average indoor radon (Zone 1 highest) — never a measurement of a home |
| **Lead service line** | The pipe from the water main to a home, where made of lead; utilities must inventory these |
| **PWSID** | Public Water System ID — links a household to its utility's testing results (e.g. `NC0113010`) |
| **UCMR 5** | EPA's fifth Unregulated Contaminant Monitoring Rule — the source of HALO's PFAS data |
| **SDWIS** | The federal database of public water systems (used before the boundary method) |
| **Service area boundary** | The polygon a utility serves; which polygon contains the address identifies the utility |
| **AQI** | Air Quality Index, 0–500; reports the worst single pollutant |
| **UPI** | Google's Universal Pollen Index, 0–5 |
| **NC-08** | North Carolina's 8th congressional district — the competition district |
| **Severity level** | The 0–4 scale plus no-data that every reading maps to |
| **Confidence** | How much a reading can be trusted — separate from severity (`full`, `limited`, `stale`, `none`) |
| **Coverage** | Whether everything detected could be evaluated (`complete`, `partial`, `unscoreable`, …) |
| **Provenance** | measured, modeled, or estimate |
| **Proxy** | A value derived from something else — mold risk is the main one |
| **Household group** | One of the seven presence facts collected instead of ages |
| **Shown, not scored** | Displayed with its value but excluded from any score, with the reason — lithium and lead |
| **Results reveal** | The transitional screen after onboarding that resolves four lookups before Today |
| **Health card** | Act's printable one-page summary for a doctor or landlord |
| **Part D** | The API contract in the frontend PDF |
| **Punch list v3** | Vibhav's backend completion list (items 1–21) |

---

## Appendices — the blueprint's non-page sections

Codex doesn't have the blueprint PDF, and the frontend PDF carries only its page-level content. These two appendices digest every other section, with `§` numbers and the blueprint's exact wording for rules, strings, numbers, and checklists. Tags: **[KEEP]** still applies · **[VOIDED-STYLE]** a replaced visual value, recorded for reference only — never implement it · **[SNAPSHOT]** a build-state fact from when the blueprint was written (may be stale) · **[FLAG]** an inconsistency in the blueprint worth knowing. **Where the body of this file or the PDF says something newer, that wins.**

## Appendix A — Foundations and systems (§1–§9, §20–§26)

### Front matter

- Title: "HALO — Complete Product Blueprint".
- Subtitle: "Environmental health application for North Carolina households · Congressional App Challenge 2026, NC‑08"
- **Deadline:** "October 26, 2026, 12:00 PM EST · Internal target October 23"
- [SNAPSHOT] "Verified against the vmag211/halo-app repository, main branch, 49 commits."
- Purpose of the document: it describes the entire application on paper, including every page, element, piece of content, data point and its source, interaction, and state, plus the purpose of each. It contains no source code. "A team that has never seen this project should be able to read this document and build the intended application accurately."
- Where something is already built, the document describes what exists rather than proposing a replacement. Where it is not built, the document specifies what to create.
- "Completeness is not priority. Section 65 sorts every specified detail into what is load-bearing, what is worth building, and what to cut first. Read it before starting, not after falling behind."
- **The visual bar:** "This does not need to look like a funded consumer product. It needs to look clean, deliberate, and finished — nothing more. Consistent spacing, one type scale, one color system, aligned edges, and no visual bugs will read as well-made. Custom illustration, elaborate motion, and decorative flourish will not add to that impression and will consume time that the working application needs. Where this document specifies visual detail, it does so to keep several people building consistently, not to raise the level of finish."

### §1 Contents (section map, for cross-references)

- Part I, Foundations: §2 What HALO Is · §3 Platform and Delivery · §4 Current Build State · §5 Already Solved · §6 Visual Design System · §7 Navigation Model · §8 The Household Model · §9 Data Model
- Part II, Pages: §10 Onboarding · §11 Today · §12 HomeGuard · §13 Map · §14 Journal · §15 Act · §16 Settings
- Part III, Overlays: §17 Learn · §18 Assistant · §19 Alerts · §20 District View
- Part IV, Systems: §21 Backend Responsibilities · §22 Data Sources · §23 Scheduled Work · §24 Universal States · §25 Accessibility and Language · §26 Build Sequence
- Part V, Implementation: §27 Routing and URLs · §28 Interaction Behavior · §29 Formatting Rules · §30 Voice and Tone · §31 Content Inventory · §32 Brand and Identity · §33 The Results Reveal · §34 Forms and Validation · §35 Performance · §36 Offline Behavior · §37 Security and Privacy · §38 Configuration · §39 Error Handling · §40 Testing · §41 Operations · §42 Definition of Done
- Part VI, Frontend Detail: §44 Component States · §45 Control Inventory · §46 Map, in full · §47 Journal, in full · §48 Act, in full · §49 Settings, in full · §50 Overlay Anatomy · §51 Onboarding, in full · §52 Loading Skeletons · §53 Layering and Responsive · §54 Interaction Map
- Part VII, Exact Specification: §56 Signature Elements · §57 Map Visual Design · §58 Application Chrome · §59 Dark Mode · §60 Motion · §61 Text Handling · §62 Backend Operations · §63 Capability Checklist
- Part VIII, Triage: §65 Build Triage · §66 Verification Before Launch
- Part IX, Reference: §67 Glossary · §68 Open Decisions · §69 Known Limitations · §70 Using This Document
- [FLAG] The contents list skips §43, §55 and §64.
- [FLAG] Part III lists four overlays (Learn, Assistant, Alerts, District View), but §7.1 and §7.2 say "three overlays". §20 itself defines District View as "An expandable panel within the Map page, not a separate destination." Treat District View as a panel inside Map, not as a fourth global overlay.

---

### §2 What HALO Is

#### §2.1 The problem
- Environmental health information exists but ordinary households cannot use it. Air quality, drinking-water contaminant results and radon risk each live on a different government site. "none of them answer the only question a family actually asks: is my home safe, and if not, what do I do about it?"
- **District specifics (NC-08):**
  - "More than 120,000 water customers in Concord receive water containing PFAS at more than twice the federal limit, from a named treatment plant, with compliance not required until 2031."
  - "The Union County water system has reported PFOS above the federal maximum."
  - "Statewide, drinking water serving millions of North Carolinians exceeds the new federal PFAS standards."
  - "Families in these communities have roughly five years in which the contamination is known, documented, legal to continue, and invisible to them."
- (Elsewhere, from §33 *(from another section)*, the demo text names the Concord plant: "Concord — Hillgrove WTP".)

#### §2.2 What the application does
- "HALO takes one address and produces a continuously updated picture of that household's environmental exposure, in two halves":
  - **Daily conditions** that change hour to hour: "air quality, ultraviolet index, pollen, and mold risk."
  - **Home conditions** that change over years: "drinking water contaminants, radon risk, and lead risk."
- HALO then does three things that make it more than a data display:
  1. It explains what each reading means for the specific people living in that home.
  2. It tells the household what actions are available to them.
  3. It connects them to the community and civic response to the same problem.

#### §2.3 Who it is for (audience table, verbatim)

| Audience | What they get |
|---|---|
| Families with young children | "Readings interpreted against the heightened vulnerability of small children to lead and air pollution" |
| People with asthma or respiratory conditions | "Air and pollen readings framed at sensitive-group thresholds, plus the symptom-pattern tool" |
| Older adults | "Heat, air quality, and radon framed for elevated risk" |
| Private well owners | "The only population no agency tests — given a prioritized testing plan instead of a false reading" |
| Renters | "Actions they can actually take, rather than homeowner advice they cannot act on" |
| Spanish-speaking households | "Full interface and content in Spanish" |
| Community organizations and local officials | "A district-level view of contamination across NC-08" |

#### §2.4 Competitive position (a messaging constraint)
- An app called **PollutionProfile** already exists and covers similar territory: environmental exposure history built on public data. "HALO must not claim to be first."
- The permitted claim, verbatim: "no existing application combines air, water, radon, mold, and pollen into a single free, no-hardware, check-it-daily interface with household-specific interpretation and a civic action layer, focused on a specific region's real contamination."
- Frontend implication: no "first-ever" or "only app" copy anywhere, including the About screen and any submission text.

---

### §3 Platform and Delivery

- "HALO is a web application with a mobile-shaped layout. It runs in a mobile browser. It is not a native iOS application and not a native Android application." Everything already built targets this: the onboarding screen, the routing and the styling. "All layout in this document assumes a narrow mobile viewport rendered in a browser."
- **Primary viewport:** "375–430 pixels wide. Every screen must be verified at 375px."
- **Layout shape:** "single column, vertically scrolling, with a fixed bottom navigation bar and a fixed top header."
- **Wider screens:** "the content column stays centered at a maximum width rather than stretching, so a desktop browser shows the mobile-shaped application centered on the page. Nothing breaks, nothing reflows into a desktop layout." (The maximum-width value is not given in §3.)
- **Hosting:** "deployed continuously; every merge to the main branch publishes automatically."
- A native-packaging configuration file exists in the repository, but the packaging tool is not installed. "Native wrapping is not part of this specification." If it is pursued later, "it wraps this same web application without changing any of it."

---

### §4 Current Build State — [SNAPSHOT: from when the blueprint was written; may be stale]

#### §4.1 What is running

| Component | State (at time of writing) |
|---|---|
| Anonymous authentication | "Complete. Every visitor silently receives an account on first load with no signup screen, protected by an invisible anti-abuse check, with recovery when a stored session becomes invalid." |
| Address processing | "Complete. Converts an address to coordinates, then determines the serving water utility by testing which utility's real service-area boundary contains that point. The raw address text is discarded and never stored." |
| Daily conditions data | "Complete. Air quality, ultraviolet index, pollen, and mold risk retrieved, combined into a score, cached for one hour, with fallback providers and honest labeling of which readings are measured versus modeled." |
| Home conditions data | "Complete for water and radon. Water contaminant results evaluated against federal limits; radon risk from county zone data; private wells routed to a testing plan." |
| Scoring engine | "Complete and unusually rigorous — see 4.2." |
| Onboarding screen | "Built. Collects address, build year, and water source." |
| Every other screen | "Does not exist. The application currently renders onboarding and nothing else." |
| Lead risk for households on public water | "Missing. The build year is collected and stored but never used for this population, which is most users." |
| Household composition | "Does not exist anywhere." |
| Shared visual components | "None. Onboarding is styled individually rather than from a shared set." |

#### §4.2 The scoring engine's existing principles — "preserve these" (settled; the frontend must reflect them)
"treated as settled and protected. They are the strongest technical material the project has."
1. **Absence is never treated as zero.** "A missing measurement produces no value rather than a value of zero. Zero means 'we measured and found nothing'; absence means 'we do not know.' A composite built from incomplete inputs is marked as incomplete rather than silently presented as whole."
2. **Risks are combined by their nature, not averaged.** "Daily conditions combine as independent risks. Home conditions combine multiplicatively, each treated as a surviving fraction of a clean home. Neither uses a plain average, because a plain average lets one severe problem be hidden by several benign ones."
   - Stated formula shapes: daily = combination of independent risks; home = product of per-risk "surviving fractions" of a clean home. The exact equations are not given in these sections. The server computes all of this; the frontend never recomputes it.
3. **Coverage and confidence are separate facts.** "How severe a reading is and how much it can be trusted are tracked independently. A reading can be reassuring and unreliable at the same time, and the interface must show both."
4. **Regulatory instability is disclosed.** "Three of the five federal PFAS limits are the subject of a proposed rescission. Any score resting on one of those limits carries a notice saying so."
5. **Unregulated substances are shown, not hidden.** "Compounds with no enforceable federal limit are displayed with cited health-based reference values, explicitly marked as not enforceable."
6. **Some measurements are deliberately excluded and say so.** "Lithium is measured and displayed but not scored, because its presence in North Carolina groundwater is largely geological and the only federal reference value is non-regulatory. The interface states this rather than silently omitting it."
7. **Scores have floors and ceilings.** "A score never reads as excellent on the strength of an incomplete assessment, and never collapses to a flat zero."

---

### §5 Already Solved — Do Not Rebuild

"Re-implementing any of the following would be wasted effort or a regression."

| Concern | How it is already handled |
|---|---|
| Opening an account before any screen needs one | "A component in the application shell opens the anonymous session before anything renders, on every route" |
| Creating a user's data record | "A database trigger creates it automatically whenever an account is created, and failure there cannot block signup" |
| Two simultaneous requests creating two accounts | "A guard ensures concurrent callers share one in-flight sign-in rather than each starting their own" |
| Expired or invalid sessions | "A rejected request triggers local sign-out and a fresh session, rather than leaving the device permanently broken" |
| Identity on server requests | "Every server route derives identity from the verified session token. A client cannot request another household's data by supplying a different identifier." |
| Data access rules | "Database-level rules restrict every record to its owner. Cached results are writable only by the server, so a client cannot fabricate one." |
| Deleting a user | "Deletion cascades correctly through every related record" |
| Calling the server from the interface | "A shared helper attaches the session token and handles rejection recovery. Helpers for the three live data routes already exist." |

- **"Rule for anything new."** "Data the user authors — household composition, symptom entries — is readable and writable by its owner only. Data the system derives — cached scores, generated alerts — is readable by its owner but writable only by the server. Every new relationship between records deletes cleanly when the user is deleted."
- Frontend implications:
  - Reuse the existing session bootstrap component and the shared fetch helper.
  - Never send a household/user ID for the server to trust.
  - Never write derived data (scores, alerts) from the client.

---

### §6 Visual Design System

> **The team has VOIDED the blueprint's visual/style values (colors, fonts, sizes, spacing, radius, shadows, gradients) and replaced them with the locked foundation in §9 of this file / A11 of the PDF (a light aqua-mist and navy/teal system — not glass).** Every hex value, font family and size, spacing step, radius, shadow and gradient treatment below is recorded for reference only and marked **[VOIDED-STYLE]**. Non-stylistic rules are marked **[KEEP]**: severity semantics, iconography meaning, color-never-alone, server-decides-level, confidence semantics, chart honesty rules, component behavior, and accessibility.

- Intro [KEEP, process]: "This must be built before any page." The existing onboarding screen is individually styled. If several people build pages without a shared set, the result is several inconsistent screens. Establishing the shared set is "roughly an hour of work". (§26.3 later estimates "Roughly one day" for components plus colour tokens.)

#### §6.0 How finished this needs to look [KEEP as scope philosophy]
- "The target is clean and deliberate, not elaborate. An application judged in a short demonstration is assessed on whether it looks considered and works correctly, not on whether it looks expensive."

| What actually reads as well-made | What does not add to that impression |
|---|---|
| Consistent spacing on every screen | Custom illustration or imagery |
| One type scale, used everywhere | Multiple typefaces or decorative type |
| One color system, applied predictably | Gradients beyond the single hero background |
| Aligned edges and even margins | Elaborate or layered motion |
| Text that never overflows or overlaps | Drop shadows and depth effects |
| Nothing shifting position as content loads | Bespoke icons drawn for this project |
| Legible contrast in both light and dark | Micro-interactions on every element |

- "Everything in the left column is discipline rather than artistry … Everything in the right column is time that the working application needs more."
- **"The practical rule. If a visual decision takes more than an hour and does not change what a person understands, it is not worth making."** Only these signature visuals earn their place, because they carry meaning: "the score ring, the threshold bar, the house diagram, the heat grid". "Nothing else in the interface needs to be more than clean."
- The replacement foundation agrees with this column: no glass, no depth effects, and only two gradients in the app (Today's time-of-day hero and Onboarding's Welcome band). The time-discipline intent applies in full.

#### §6.1 The severity scale
- [KEEP] "Every environmental reading in the application, regardless of what it measures, is expressed on one six-level visual scale. The underlying thresholds differ per contaminant and come from the relevant authority for that contaminant; the visual expression never differs."

| Level | Label [KEEP] | Color [VOIDED-STYLE] | Icon [KEEP: iconography semantics] | What it communicates [KEEP] |
|---|---|---|---|---|
| 0 | Good | #16653a deep green | Circle with a check | "No action needed" |
| 1 | Moderate | #a37200 amber | Circle with an i | "Fine for most people; sensitive groups should take note" |
| 2 | Elevated | #c2620f orange | Triangle with exclamation | "Action worth considering" |
| 3 | High | #a12d2d red | Octagon with exclamation | "Action recommended" |
| 4 | Severe | #6b1f6b deep purple | Filled octagon | "Action strongly recommended" |
| — | No data | #6b7280 neutral grey | Circle with a question mark | "We do not know — distinctly not 'good'" |

- [KEEP] Ordered hue progression (green → amber → orange → red → purple, with grey for no data). The exact hex values are VOIDED. The replacement palette must still give six distinguishable levels, and "No data" must never look like "Good".
- [KEEP] **"The absolute rule: severity is never communicated by color alone. Every place a level appears, it appears as color, an icon, and a written word together. A person who cannot distinguish red from green must receive identical information."**
- [KEEP] **"Who decides the level: the server. The interface receives a severity word from the server and maps it to a level. The interface never compares a raw measurement against a threshold itself, because two different screens computing the same threshold independently will eventually disagree about the same household."**
- Frontend implication: build a single `severityWord → {level, label, icon, colorToken}` map. Contain no threshold logic anywhere on the client.

#### §6.2 The confidence indicator — a separate signal [KEEP semantics and strings]
- "Severity and confidence are different facts and appear as different visual elements. A water reading can be reassuring and three years old at the same time."

| Confidence | Appearance (strings KEEP; grey/amber color VOIDED-STYLE) | Meaning |
|---|---|---|
| Full | "Nothing shown" | "Everything detected was evaluated and the data is current" |
| Limited | Small grey pill reading **"partial"** | "Some detected substances could not be evaluated" |
| Stale | Small amber pill reading **"3+ yrs old"** | "Fully evaluated, but the underlying sample is old" |
| None | Small grey pill reading **"not evaluated"** | "Nothing could be evaluated" |

- Implied threshold: data counts as "stale" when the sample is 3+ years old. The server decides this.

#### §6.3 Brand and surface colors — [VOIDED-STYLE, entire subsection]

| Role | Color | Used for |
|---|---|---|
| Primary | #0d5c63 deep teal | Headers, primary buttons, active navigation, the application's identity |
| Primary dark | #14484d | Pressed states, secondary headings |
| Page background | #f7f9f9 near-white | The canvas behind cards |
| Card surface | #ffffff | Every card and sheet |
| Border | #dde5e5 | Dividers, card outlines |
| Body text | #1a1a1a | All primary text |
| Secondary text | #5c6767 | Timestamps, source labels, supporting detail |

- Only the role structure may still be useful (primary, primary-dark, background, surface, border, text, secondary text). The values are voided.

#### §6.4 Typography
- [VOIDED-STYLE] "Two families, already loaded: a clean sans-serif for all interface text, and a monospaced family reserved for measured values where digit alignment matters."
- [VOIDED-STYLE] Type scale:

| Role | Size | Weight | Used for |
|---|---|---|---|
| Hero score | 48px | Bold | "The single composite number on Today and HomeGuard" |
| Page title | 24px | Bold | Header bar |
| Section heading | 18px | Semibold | Section dividers within a page |
| Card title | 16px | Semibold | Card headers |
| Body | 15px | Regular | "All explanatory text. This is the floor — nothing readable is smaller." |
| Supporting | 13px | Regular | Timestamps, sources, captions |
| Pill label | 12px | Semibold | Severity and confidence pills only |

- [KEEP, because §25.1 repeats it as non-negotiable] Body text floor: "never smaller than fifteen pixels and respects the user's own text size preference." Also keep the rule of one type scale used everywhere, whatever the new scale is.
- [KEEP, a content rule] "Reading level for all explanatory content targets roughly sixth grade. This is a health application read under stress by people of every education level."

#### §6.5 Spacing, shape, and motion
- [VOIDED-STYLE] "Spacing uses only these steps: 4, 8, 12, 16, 24, 32 pixels."
- [VOIDED-STYLE] "Cards use a 12-pixel corner radius, a one-pixel border, and no drop shadow. Sheets use a 16-pixel radius on their top corners only."
- [KEEP, accessibility, repeated in §25.1] "Every tappable element is at least 44 by 44 pixels regardless of how small its icon appears."
- [VOIDED-STYLE, probably] "Page content sits within a 16-pixel horizontal margin."
- [KEEP scope; timing may be superseded] "Motion is limited to sheet entry, card expansion, and content fade-in, all under 300 milliseconds, and all suppressed entirely when the operating system requests reduced motion." The reduced-motion suppression is non-negotiable per §25.1.
- [FLAG] §6.8 lets the score ring animate for "under 400 milliseconds", which exceeds the 300ms general cap.

#### §6.6 The shared component set [KEEP: inventory and behavior; visual specifics VOIDED-STYLE]
"Every page is assembled from these. Building them once is what makes the application feel like one product."

| Component | What it is (behavior) | Used by |
|---|---|---|
| Card | Surface with border, rounded corners and standard internal padding (look voided) | Everywhere |
| Expandable card | "A card that collapses to a summary row and expands in place to show detail. **Never navigates away.**" | Today's four readings, HomeGuard's three risks |
| Bottom sheet | "A panel that slides up from the bottom over the current screen, dismissed by dragging down, tapping outside, or pressing escape. The current screen stays visible behind it." | "Learn, Assistant, Alerts, map details, and all four Act features — eight uses" |
| Score ring | "A circular progress ring with a number centered inside, colored by severity level" | Today hero, HomeGuard hero |
| Risk bar | "A horizontal bar filled proportionally and colored by severity level" | HomeGuard risk rows, map legends |
| Severity pill | "Small rounded label containing an icon and a word" | "Every reading, everywhere" |
| Confidence pill | "Smaller, quieter secondary label" | "Readings with less than full confidence" |
| Callout | "Tinted inline block for a note, warning, or caution, with an icon" | Stale data notices, regulatory notices, exclusions |
| Skeleton | "Grey animated placeholder shaped like the content that will replace it" | Every loading state |
| Empty state | "Icon, one-line explanation, and where useful an action" | "Every screen that can have nothing to show" |
| Tab bar | "Fixed bottom navigation with five destinations" | Application shell |
| Segmented control | "Two-option switch that changes what a page displays without navigating" | Journal |
| Toggle chip | "Rounded selectable label that toggles on and off" | Household composition, map layers |

- Sheet count check: Learn, Assistant and Alerts (3) + map details (1) + four Act features (4) = 8.

#### §6.7 Visual differentiation — each page must feel like itself
- [KEEP intent] A five-tab app of identical white cards is "competent and forgettable". "The shared component set guarantees consistency; this section guarantees that consistency does not become monotony." Each item is low-cost and needs no charting library or design tool.

| Page | Signature element (concept = KEEP; look = subject to the new style) | Cost |
|---|---|---|
| Today | "A time-of-day gradient behind the hero — cool blue before dawn, warm and bright at midday, amber at dusk, deep navy at night, driven by the device clock." It makes a habitual check "feel alive rather than static." [Specific colors VOIDED-STYLE; the device-clock-driven time-of-day concept may still apply] | "One CSS gradient selected by hour. Near zero." |
| HomeGuard | "A simple house cross-section drawn as inline vector art, with three zones highlighted in their severity colors: the tap for water, the foundation for radon, the pipes for lead. It reads as a building inspection rather than a weather report." [KEEP mapping: tap = water, foundation = radon, pipes = lead] | "One hand-drawn vector shape, recolored by severity. A few hours, once." |
| Map | "Full-bleed map with floating controls." | "Inherent." |
| Journal | "A calendar heat grid — one small square per day, colored by that day's dominant environmental level, with a dot marking days that were logged." | "A grid of colored squares. Very low." |
| Act | "Editorial rather than data-driven: taller cards, larger type, generous whitespace, each with a single strong icon. It should feel like a different kind of content, because it is." | "Layout only." |
| Learn | "Typographic. A sheet with strong headings, pull-quoted key facts, and cited sources treated as visible footnotes rather than hidden links." [KEEP: sources visible, not hidden] | "Typography only." |

- [KEEP] **"The constraint that keeps this disciplined. Differentiation comes from layout, color context, and one signature element per page — never from different button styles, different card shapes, or different type scales. Those stay identical everywhere. A user should never wonder whether they are still in the same application; they should simply feel that this page is about something different."**

#### §6.8 Data visualization — the full set [KEEP: chart semantics and rules; colors follow the new tokens]
- "Seven visual types cover every chart in the application. All are simple enough to draw as inline vector graphics without a charting library". This keeps page weight low. [KEEP: no charting library; inline SVG]
1. **Threshold bar** ("the most important chart in the application"):
   - One horizontal bar per contaminant, "with a clearly marked vertical line at the federal limit. The bar extends past the line when the reading exceeds it."
   - "Above the bar: the substance name. Below: the measured value, the limit, and the ratio."
   - Example given: "8.3 ppt against a limit of 4".
   - Appears in "the HomeGuard water card, in map detail sheets, and in the health card."
   - **"Bars sort worst-first. Substances measured but not scored appear beneath a divider, in grey, with no threshold line, labeled as not scored."**
2. **Seven-day trend line:**
   - "A small line chart, roughly 60 pixels tall, inside each expanded reading card on Today."
   - "The current day is emphasized with a filled dot."
   - "Severity thresholds are drawn as faint horizontal bands behind the line, so a rising line visibly enters a worse band rather than merely going up." The band boundaries must come from the server, per §6.1.
3. **Calendar heat grid** (Journal's signature):
   - "One square per day across recent weeks, each colored by that day's dominant environmental severity, with a small dot on days the household logged symptoms."
   - Purpose: see "whether their logged days cluster in the darker squares … answered visually before any statistics are computed."
4. **Contribution bar:**
   - "A single horizontal stacked bar beneath each hero score, showing what is driving it. Segments are sized by contribution and colored by severity, each labeled."
5. **Quarterly trend:**
   - "A line chart in the water card showing a contaminant's readings across successive sampling quarters, with the federal limit drawn as a horizontal reference line."
   - Answers "is this getting better or worse".
   - **"Conditional on the stored data containing multiple dated readings — see §13.7."** Also see §26.3c and §68.
6. **Comparison bar pair:**
   - "Two short horizontal bars, one labeled with the household's county and one with the state average, in the district panel and the map comparison banner."
7. **Score ring:**
   - "Animates from zero to its value on first render, under 400 milliseconds, suppressed under reduced-motion preferences."
- **"Rules governing every chart"** [KEEP, all]:
  - "Every chart carries a plain-language caption stating its takeaway. A chart that requires interpretation has failed for a reader in a hurry."
  - "Axes are labeled with units. No bare numbers."
  - "Missing data appears as a visible gap, never as a zero and never as an interpolated line through it."
  - "Every chart has a text equivalent available to screen readers describing the same finding."
  - "Color follows the severity scale exactly. No chart introduces its own palette." The severity mapping is KEEP; the actual colors are the replacement palette's severity tokens.

---

### §7 Navigation Model

#### §7.1 Overall shape
- "The application has seven pages and three overlays."
  - Five pages are reachable from a permanent bottom navigation bar.
  - Onboarding appears once.
  - Settings is reached from a gear icon.
  - "The three overlays are not pages and never replace the screen — they slide over it."

| Page | Nav label | Reached by | Role |
|---|---|---|---|
| Onboarding | — | "Automatically on first visit" | "Collect the minimum needed to produce results" |
| Today | "Today" | "Tab 1, and the default landing page" | "What is happening right now" |
| HomeGuard | "Home" | Tab 2 | "What is true about this specific building" |
| Map | "Map" | Tab 3 | "How this household compares to the region" |
| Journal | "Journal" | Tab 4 | "How conditions relate to how people actually feel" |
| Act | "Act" | Tab 5 | "What can be done, personally and collectively" |
| Settings | — | "Gear icon in the header" | "Change anything previously entered" |

- Note: the tab label for HomeGuard is **"Home"**, not "HomeGuard".

#### §7.2 The three overlays

| Overlay | Opened by | Why it is not a page |
|---|---|---|
| Learn | "Tapping any reading's 'What does this mean?' link" | "It always explains a specific number the user is currently looking at. Detached from that number it would become a generic encyclopedia, which is exactly what it must not be." |
| Assistant | "A floating circular button, lower right, present on all five tabbed pages" | "It must carry the context of whatever the user is looking at. In its own tab it would lose that." |
| Alerts | "A bell icon in the Today header, badged with an unread count" | "It is a notification history, consulted occasionally. A permanent tab would overstate its importance and crowd the navigation." |

- Exact link string: **"What does this mean?"**
- Learn and Assistant must receive the context of the reading or page that opened them.

#### §7.3 The header bar
- "Fixed at the top of every tabbed page. Contains the page title on the left."
- "On Today only, the right side holds the alerts bell (with an unread count badge when applicable) and the settings gear. On every other page the right side holds only the settings gear."

#### §7.4 The bottom navigation bar
- "Fixed at the bottom of every tabbed page. Five equal-width destinations, each an icon above a short label."
- "The active destination is filled in the primary teal; the rest are grey outlines." The teal is [VOIDED-STYLE]. [KEEP] the active state is filled and the inactive states are outlined.
- "It is always visible and never scrolls away, because a household checking a worrying reading must never feel lost."

#### §7.5 First-visit routing [KEEP, a logic rule]
- "On every load the application checks whether this visitor already has a stored location. If they do, it goes straight to Today. If they do not, it shows onboarding. **If that check fails for any reason, it shows onboarding rather than an error, because onboarding is recoverable and an error screen is not.**"
- This depends on the new "Household profile retrieval" server capability (§21, first on the §26.2 list).

---

### §8 The Household Model
"Not built anywhere. Fully specified here because six other features depend on it."

#### §8.1 What is collected
- "Seven yes-or-no facts. No ages, no birthdates, no names, no medical records. One record per household, not one per person — the application never needs to distinguish two toddlers from one."

| Fact (field, §9.1) | Meaning | Why it changes anything |
|---|---|---|
| Toddler present (`has_toddler`) | "A young child, roughly under five" | "Highest vulnerability to lead; breathes more air relative to body weight" |
| Child present (`has_child`) | "School age" | "A recognized sensitive group for air quality; lungs still developing" |
| Teen present (`has_teen`) | "Teenager" | "More sustained outdoor exertion, relevant to air quality and ultraviolet exposure" |
| Adult present (`has_adult`) | "Adult" | "Baseline population" |
| Senior present (`has_senior`) | "Sixty-five or older" | "A recognized sensitive group for air quality and heat" |
| Someone pregnant (`has_pregnant`) | "Any pregnancy in the household" | "Lead and PFAS guidance differs meaningfully" |
| Respiratory condition present (`has_respiratory`) | "Asthma or similar" | "The single strongest modifier for air quality and pollen interpretation" |

- UI: these are set via toggle chips (§6.6: "Toggle chip … Household composition").

#### §8.2 What it changes — and what it never changes [KEEP, a hard rule]
- **"It never changes a measurement, a severity level, or a score. The air quality index is the same number for every household. What changes is the sentence underneath it and which action is recommended. An index of 68 is level 1 for everyone; whether the card says 'fine for most people' or 'worth keeping your youngest inside this afternoon' is what household composition decides."**

#### §8.3 Why groups instead of ages
- Federal air quality guidance defines sensitive groups categorically: "children, older adults, and people with asthma or heart or lung disease." "The thresholds are per category, not per year of age."
- Collecting an exact age would be "gathering information about a child in someone's home that the application cannot act on".
- "Groups deliver identical function with strictly less exposure, matching the existing decision to discard the street address after use."
- Frontend implication: never ask for ages, birthdates, names or medical detail anywhere.

#### §8.4 Every place it is used

| Feature | How it changes behavior |
|---|---|
| Today's four readings | "Selects which explanatory sentence appears under each reading" |
| HomeGuard's risk cards | "Lead and PFAS explanations emphasize risk to young children and pregnancy" |
| Action plan ordering | "Lead and water actions move up the list when a toddler or pregnancy is present" |
| Journal | "Symptoms are recorded per group, so a toddler's and a teenager's patterns do not merge into one indistinguishable signal" |
| Learn | "The 'what this means for your household' section of every topic branches" |
| Alerts | "Households containing a sensitive group receive air quality alerts one level earlier" |

- [FLAG] §19.3 *(from another section)* narrows the alert shift: "Households containing a person with a respiratory condition, a toddler, or a senior receive air quality alerts one level earlier than other households, matching how federal guidance treats sensitive groups." That list excludes child and pregnancy, which §8.4's generic "sensitive group" does not. This is server logic, but copy must not over-promise.
- Learn section heading string: **"what this means for your household"**.

#### §8.5 How the wording is chosen [KEEP, a priority rule]
- "When several groups apply, the explanatory sentence names the most specific one, in this order of priority: **someone with a respiratory condition, then a toddler, then pregnancy, then a senior, then a child, and if none apply, a general phrasing.**"
  - Priority: respiratory > toddler > pregnant > senior > child > general.
  - Teen and adult are not in the priority list.
- Rationale: "Naming a specific person consistently outperforms hedging — 'keep anyone with asthma inside this afternoon' prompts action in a way that 'sensitive groups should take care' does not."
- Per §21, the server pre-composes these sentences. The frontend displays them and does not choose the wording itself.

#### §8.6 Examples of the same reading worded differently (verbatim user-facing strings)

| Reading | No sensitive group | With a sensitive group |
|---|---|---|
| Air, level 1 | "Moderate. Fine for most people." | "Moderate — fine for most people, but your youngest may want to skip long stretches outside today." |
| Air, level 2 | "Unhealthy for sensitive groups. Limit long or intense outdoor activity." | "Unhealthy for sensitive groups — keep anyone with asthma in your home inside where you can today." |
| Ultraviolet, level 2 | "High. Sunscreen and shade between 10am and 4pm." | "High — young skin burns faster. Sunscreen, hats, and shade for your kids between 10am and 4pm." |
| Pollen, level 2 | "High. Keep windows closed if pollen affects you." | "High — this is the kind of day that tends to set off asthma. Windows closed, and consider staying in." |
| Lead, level 2 | "Your home's age means lead plumbing is possible. Testing is the only way to know." | "Your home's age means lead plumbing is possible. Young children absorb lead far more readily than adults, so this is worth testing sooner rather than later." |

- [FLAG] Air level 2 is labeled "Unhealthy for sensitive groups" in these strings, but the §6.1 generic level-2 label is "Elevated". UV and pollen level 2 read "High", while §6.1 level 3 is "High". The per-metric wording apparently differs from the generic scale label. Pills should show the server-provided severity word. Per §26.3b, "the table in §8.6 is the starting point, not the finished set."

---

### §9 Data Model
"Described as information rather than as database syntax. Each table lists what it stores, why, and who may read or write it."

#### §9.1 Existing stores — "already built, do not alter"

**Household profile** (canonical store `profiles`): "One record per visitor, created automatically when their anonymous account is created."

| Field | Holds | Note |
|---|---|---|
| Identifier | Links to the anonymous account | "Everything else in the system references this" |
| Address | "Deliberately always empty" | "The column exists; nothing ever writes to it. This is the privacy decision made visible in the schema itself." |
| Latitude, longitude | "Approximate coordinates" | "All environmental lookups use these" |
| Postal code, county | "Region identifiers" | "Radon and district comparisons" |
| Water system identifier | "Which utility serves this address" | **"May legitimately be empty — see 12.4"** |
| Build year | "Year the home was constructed" | "Drives lead risk; may be empty" |
| Water source | **"Utility, well, spring, other, or unknown"** | "Decides whether HomeGuard shows measurements or a testing plan" |

**Daily readings history** (`daily_scores`):
- "One record per household per day, written whenever fresh data is retrieved. Holds the composite score and each individual reading."
- Serves "the one-hour cache, the seven-day trend lines, and the Journal's pattern analysis."
- "Readable by its owner; writable only by the server."

**Home risk results** (`home_risks`): "The most recent home assessment per household — water risk and its full detail, radon zone, lead risk, and the generated action plan."

**Water utility reference data** (`ucmr5_utilities`):
- "Public federal testing results, one record per water system, holding the system's name and its measured contaminant readings with dates."
- "Not household data — readable by everyone."
- [INFERRED] "ucmr5" most likely refers to EPA's Fifth Unregulated Contaminant Monitoring Rule dataset. The blueprint itself only says "Federal water contaminant testing programme" (§22).

**Canonical names** (verbatim rule): "The stores below are described in prose, but their names must be identical across everyone's work or the contracts break. Use exactly these:"
- `profiles · daily_scores · home_risks · ucmr5_utilities · household_bands · symptom_logs · volunteer_orgs · learn_content · alerts · assistant_corpus`
- "Household group fields: `has_toddler`, `has_child`, `has_teen`, `has_adult`, `has_senior`, `has_pregnant`, `has_respiratory`. Added profile fields: `renter_mode`, `locale`."
- [INFERRED] Prose-to-canonical mapping. The order of the list matches §9.1 and §9.2 exactly:
  - Household profile → `profiles`
  - Daily readings history → `daily_scores`
  - Home risk results → `home_risks`
  - Water utility reference data → `ucmr5_utilities`
  - Household composition → `household_bands`
  - Symptom entries → `symptom_logs`
  - Volunteer organizations → `volunteer_orgs`
  - Educational content → `learn_content`
  - Alerts → `alerts`
  - Assistant knowledge base → `assistant_corpus`

#### §9.2 New stores required

**Household composition** (`household_bands`): "One record per household holding the seven group facts from section 8. Owned and editable by the household."

**Symptom entries** (`symptom_logs`):

| Field | Holds |
|---|---|
| Date | "The day being described" |
| Group | "Which household group this entry describes" |
| Symptoms | "Which symptoms were selected" |
| Severity | **"Mild, moderate, or bad"** |
| Note | "Optional free text" |
| Entered retrospectively | "Whether this was recalled later rather than logged that day" |
| Possibly illness | "Whether the user flagged this as probably a cold or flu" |

- **Uniqueness rule:** "One entry per household per group per day; logging the same day again updates rather than duplicates. Owned entirely by the household."
- Per §21, Journal findings must exclude days flagged as possible illness.

**Volunteer organizations** (`volunteer_orgs`):
- Reference data: "organization name, which counties it serves, which causes it works on, its web address, a short description, and the date its listing was last verified by a human."
- "That last field exists to force periodic re-checking; a directory of dead links would undermine the claim that these were hand-verified."

**Educational content** (`learn_content`):
- "One record per topic per language, holding the explanation, the protective guidance, and the list of sources with their retrieval dates."
- **"Seven topics, two languages."**

**Alerts** (`alerts`):
- "Generated notifications: type, severity, title, message, when it fired, and whether it has been read."
- "Readable by its owner; written only by the scheduled process, so a client cannot fabricate an alert." (§21 adds that the client may mark alerts read through the server.)

**Assistant knowledge base** (`assistant_corpus`):
- "The curated source documents broken into passages, each stored with its source label, source address, retrieval date, and a mathematical representation used to find relevant passages." That last item is an embedding vector.
- "Public reference data."

**Additional household fields:** "Two additions to the existing profile: whether the household rents or owns, and their language preference." These are `renter_mode` and `locale`.

---

### §20 District View
"Entirely new. An expandable panel within the Map page, not a separate destination."

#### §20.1 Purpose
- "Present the whole district's situation at once, with no personal data involved. This is the view a community organization or a legislative office could open, and **it is the clearest answer to why this application belongs in a competition judged by a congressional office rather than being a generic health tool.**"

#### §20.2 Contents
- "How many water systems in the district exceed federal contaminant limits, and the combined population those systems serve."
- "Radon burden by county across the district."
- "How the district compares to state averages."
- "The specific local situation named concretely: the Concord treatment plant serving more than 120,000 customers above the federal limit, the Union County system's reading against the federal maximum, and the compliance timelines that extend to 2031."

#### §20.3 Presentation
- "The panel slides up from the bottom of the Map page."
- Content order:
  1. "a single headline figure — the population affected across the district"
  2. "a county-by-county table"
  3. "the state comparison" (the comparison bar pair, §6.8)
- **"Every figure shows the date its underlying data was assembled."**
- "It is built entirely from public data, contains no information about any household, and requires no account."
- (A later section gives the district bar label: "See the full NC-08 picture", "Flush above the tab bar".)

---

### §21 Backend Responsibilities
"What the server must provide, organized by what it serves. Existing capabilities are marked; the rest is new work."

| Capability | State | Must provide (verbatim) |
|---|---|---|
| Address processing | built, needs extension | "Coordinates, county, postal code, and serving water utility from an address; discard the raw text. Extension: accept and store household composition." |
| Daily conditions | built, needs extension | "Air, ultraviolet, pollen, and mold readings with severity levels, provenance, and freshness; the composite score with completeness flags. Extension: a pre-composed explanatory sentence per reading reflecting household composition." |
| Home conditions | built, needs extension | "Per-risk breakdown with severity, confidence, contribution, data age, detail rows, and explanatory notes. Extensions: lead risk for public-water households, and the ranked action plan." |
| Household profile retrieval | new | "This household's stored location, home details, and composition. Determines whether to show onboarding or the application." |
| Reading history | new | "Daily readings across a requested date range, exactly one record per date. Serves trend lines and Journal analysis." |
| Journal entries | new | "Save and retrieve symptom entries; re-logging a date updates rather than duplicates." |
| Journal findings | new | "Either a not-ready response with counts and requirements, or findings with comparison rates and plain-language statements. Must exclude illness-flagged days and enforce the minimum thresholds." |
| Map data | new | "Pre-assembled geographic datasets per layer, each feature carrying everything its detail sheet needs." |
| District aggregate | new | "Counts, affected population, per-county figures, and state comparison." |
| Volunteer matching | new | "Organizations filtered by county and cause tags." |
| Educational content | new | "Topic content by language, with a personalized line built from the household's own value." |
| Assistant | new | "Cited answers grounded in curated sources plus the household's own data, with a diagnostic check that runs before composition." |
| Alerts | new | "Retrieve the inbox and mark entries read." |
| Health check | new | "Report whether each external data source is reachable. Useful during development and before a demonstration." |

Frontend-relevant field vocabulary implied by §21 (the server supplies these; the UI renders them):
- Per reading: severity level, provenance (measured vs modeled), freshness.
- Composite: score plus completeness flags.
- Per home risk: severity, confidence, contribution (feeds the contribution bar), data age, detail rows, explanatory notes.
- The pre-composed sentence is per reading.
- The action plan is ranked.
- Journal findings come in two shapes, "not-ready" (with counts and requirements) or "findings" (with comparison rates and plain-language statements). The minimum thresholds live in §14, not in this range.

- **Verbatim rule:** "**Freeze every response shape before interface work begins in parallel.** If a shape changes after screens are built against it, every screen using it breaks simultaneously. With several people building at once, that is several people blocked at the same moment rather than one."

---

### §22 Data Sources

| Source | Provides | Notes (verbatim) |
|---|---|---|
| Federal water contaminant testing programme | "Measured contaminant results per public water system" | "Quarterly; coverage is incomplete nationally, which is why a distinct 'no results yet' state exists" |
| Federal air quality network | "Measured air quality index" | "Roughly half of the district has no station within twenty-five miles" |
| Modelled weather and air service | "Air quality and ultraviolet fallback" | "No key required, no practical limit; leads for ultraviolet" |
| Ultraviolet service | "Ultraviolet index" | "Free tier is 45 requests per day across all users combined, not per user — which is why it is a fallback rather than primary" |
| Pollen service | "Tree, grass, and weed levels" | "Free allocation with a spending alert configured" |
| National weather service | "Humidity and rainfall for the mold estimate; county advisories for alerts" | "No key required; already integrated for mold" |
| Geocoding service | "Address to coordinates" | "No hard spending cap available on the account — usage must be checked manually" |
| Water utility boundary service | "Which utility's service area contains a point" | "Replaced postal-code matching, which produced wrong utilities and missing matches on real district addresses" |
| County radon zone data | "Radon risk by county" | "Static; already stored locally" |
| Facility compliance data | "Regulated facilities, violations, penalties" | "For the map's facilities layer" |

- Provider precedence:
  - UV: the modelled service is primary ("leads for ultraviolet") and the UV service is the fallback.
  - Air quality: the federal measured network is primary, with the modelled service as fallback.
  - Hence the "measured versus modeled" labeling (§4.1).
- The blueprint does not name the vendors in this section. Do not hard-code vendor names in UI copy unless another section specifies them.
- Frontend implications:
  - A distinct "no results yet" water state is required.
  - Air readings may be modeled rather than measured, and the UI must label which.
  - The geocoder has no spending cap, so avoid firing geocoding on every keystroke. [INFERRED]

---

### §23 Scheduled Work
"One scheduled process, running once daily in the early morning, performing every recurring task in sequence":
1. "Rebuild each map layer's geographic dataset and store it."
2. "Recompute the district aggregate figures."
3. "Evaluate alert conditions for every household and create any that fire."
4. "Check weather advisories for each county where households exist."
5. "Run seasonal checks — the winter radon prompt and end-of-season journal summaries."
- "Consolidating into a single daily run rather than several separate schedules respects hosting limits and keeps the whole recurring system in one auditable place."
- **"The process must be protected so that it cannot be triggered by an outside request."**
- Frontend implications:
  - Map layers and district figures are at most a day old and are pre-assembled, so they cannot be fetched live from government services.
  - Show the "assembled" date (§20.3).
- Related alert types seen just before §20 (*(from another section)*, §19.2 tail):
  - Weather advisory: "Flood advisory for Union County. Flooding can affect well water — retest after it recedes."
  - New water results: "New water testing results were published for your utility."
  - Radon season (Oct–Feb, elevated zone, no test recorded): "Winter is the most accurate time to test for radon."
  - Season summary: "Your spring summary is ready."
  - §19.4: "History is retained rather than cleared". §19.5: browser notification permission is requested "only after the household has used the application at least once, never on first load."

---

### §24 Universal States [KEEP, a hard requirement for every data screen]
"Every screen that displays data implements four states. This is a requirement rather than a refinement, because the most common failure in a data-driven application is a screen that silently shows nothing and leaves the user unable to tell whether that means good news, no news, or a malfunction."

| State | When | What appears |
|---|---|---|
| Loading | "A request is in flight" | "Grey placeholder shapes matching the layout of the content that will replace them. **Never a bare spinner**, because a skeleton communicates what is coming." |
| Error | "The request failed" | "What failed, an explicit statement that this is not a finding about their environment, and a retry control." |
| Empty | "The request succeeded but there is nothing to show" | "Why there is nothing and what would cause content to appear." |
| Populated | "Data is present" | "The content." |

- **"Error wording and empty wording must never be shared."**
  - The two contrasting example strings: **"We couldn't load your water data"** (error: "warrants retrying") versus **"testing results for your utility haven't been published yet"** (empty: "warrants patience").
  - "Merging them destroys the distinction at exactly the moment it matters."
- **"every screen must tolerate a missing water utility identifier without breaking, because that is a legitimate and expected outcome for some real addresses."**
- **Last-known-good cache:** "The application should also retain the last successfully loaded readings and display them immediately on open while fresher data is retrieved. An environmental application that shows an empty screen on a weak connection fails at exactly the moment somebody wants it."
- Frontend implications:
  - Every data view needs 4 distinct state components.
  - Error copy must explicitly say it is not an environmental finding.
  - Cache last-good readings client-side and render them immediately (stale-while-revalidate).
  - A null water-system ID is a normal case.

---

### §25 Accessibility and Language

#### §25.1 "Non-negotiable requirements" (verbatim list)
- "Severity is never conveyed by color alone. Every level appears as color, icon, and word together."
- "All text meets standard contrast ratios against its background." The replacement palette was checked at 4.5:1 in both modes.
- "Every interactive element is at least forty-four pixels square."
- "Every interactive element is reachable and operable by keyboard, with a visible focus indicator."
- "Sheets trap focus while open and return focus to whatever opened them on close."
- "Images and icons carry text alternatives; decorative elements are explicitly marked as such."
- "All motion is suppressed when the operating system requests reduced motion."
- "Body text is never smaller than fifteen pixels and respects the user's own text size preference."

#### §25.2 Spanish
- "The district has a substantial Spanish-speaking population, and state environmental agencies publish Spanish-language air quality resources precisely because this audience exists. Spanish is therefore a first-class language rather than an afterthought:"
  - "Interface text and educational content are both translated."
  - "Educational content is stored per language rather than machine-translated at display time, so a translation can be reviewed by a person."
  - "Language is selectable in Settings and persists with the household." It is stored in `locale` on the profile.
- Frontend implications:
  - All UI strings must be externalized for i18n, in English and Spanish.
  - No runtime machine translation.
  - Locale persists server-side, not only in local storage.

---

### §26 Build Sequence

#### §26.1 Before parallel work begins
1. "Build the shared component set. Roughly an hour. Without it, simultaneous page work produces visually inconsistent screens."
2. "Freeze every server response shape."
3. "Confirm anonymous sign-in is enabled in the authentication provider. It is disabled by default on new projects, and if it is off the authentication will fail despite being entirely correctly written. **This has not yet been confirmed.**" [SNAPSHOT]

#### §26.2 Server work, ordered by what it unblocks

| # | Work | Unblocks |
|---|---|---|
| 1 | Household profile retrieval | "First-visit routing — and therefore every screen" |
| 2 | Household composition storage and the onboarding extension | "All personalized wording" |
| 3 | Explanatory sentence generation | "Today, HomeGuard" |
| 4 | Reading history | "Trend lines, Journal analysis" |
| 5 | Lead risk for public-water households | "HomeGuard's third card" |
| 6 | Action plan generation | "HomeGuard's action section" |
| 7 | Map dataset assembly and the daily schedule | "Map" |
| 8 | District aggregate | "District panel, letter generator" |
| 9 | Journal storage and analysis | "Journal" |
| 10 | Volunteer data and matching | "Act" |
| 11 | Educational content and retrieval | "Learn" |
| 12 | Alert rules and inbox | "Alerts" |
| 13 | Assistant sources and answering | "Assistant — last, because it needs the most testing time" |

- Frontend implication: the frontend should mock or stub each capability behind the frozen shapes until the server delivers, in this order. [INFERRED]

#### §26.3 Interface ownership
- "Assign by page so that no two people edit the same files. Everyone draws from the shared component set; nobody modifies another person's page."
- The actual team:
  - **"Backend — Vibhav"** owns "Every server capability, the database, the scoring logic, the scheduled process, and reference data loading".
  - **"Frontend — two builders"** own "Every page, the shared components, and the three overlay sheets".
  - **"Design and content"** owns "Learn topics, volunteer verification, severity wording, submission materials".
- **"Two interface builders, seven pages.** The pages cannot be split four ways because there are not four people building them. The consequence is not that each person works faster — it is that the list below is built in order and cut from the end. **Two finished pages beat five half-finished ones under every evaluation criterion, and an unfinished page is worse than an absent one because it reads as broken rather than scoped.**"
- **Split by dependency, not by page count:** one builder owns the shell and data-display pages; the other owns the shared components and the map.

| Order | Builder 1 — shell and pages | Builder 2 — components and map |
|---|---|---|
| First | "Waits. Nothing can be built consistently until components exist." | "Shared components and colour tokens. Roughly one day. Determines whether dark mode is cheap or impossible." |
| Second | "Application shell, navigation, and Today. The backbone — nothing else renders without it. This is also the three-day measurement in §26.4." | "The bottom sheet component, which eight surfaces depend on, then the threshold bar chart" |
| Third | "HomeGuard including the action plan. All its data already exists on the server." | "Map — the largest single interface build in the project" |
| Fourth | "Journal, including the calendar heat grid" | "Learn and Alerts sheets — both reuse the sheet they already built" |
| Fifth | "Act" | "District panel inside the map" |
| Last, most cuttable | "Settings" | "Assistant sheet" |

- **Cut order:** "Where to cut, in order, if time runs short: the Assistant sheet, then Settings, then Act, then the district panel. Cutting Settings means household composition and renting mode can only be set during onboarding — acceptable for a first release, and far better than shipping seven pages where three are broken."
  - Implication: onboarding must collect household composition and renter mode, because it is the fallback path if Settings is cut.
- **"Coordination rules for two people in one codebase"** (verbatim):
  - "Builder 2 ships the components before Builder 1 starts. This is a genuine blocking dependency, not a preference — a shell built against components that do not exist yet gets rewritten."
  - "Neither person edits the other's page directory. Shared components are edited by Builder 2 only; Builder 1 requests changes rather than making them."
  - "Both pull the latest main branch before starting each session."
  - "Server response shapes are frozen before either begins. With only two builders, one shape change blocks half the interface team."
- Note for a single coding agent building everything: the ordering logic still applies, meaning components and tokens first, then shell and Today, then sheet and threshold bar, and so on. The cut order still defines priority.
- [FLAG] §26.1 says the component set takes "roughly an hour", while the §26.3 table says "Roughly one day".

#### §26.3b Content work — "needs an owner, and it is not small"

| Work | Realistic effort | Blocks |
|---|---|---|
| Seven Learn topics, written and cited | "Substantial — each needs sourcing, plain-language rewriting, and a protective-action checklist" | "The Learn overlay entirely" |
| Verifying 20–30 volunteer organizations | "A few hours, plus a check that every link resolves" | "The Act page's first card" |
| Curating and ingesting the assistant's source documents | "Moderate — selection matters more than volume" | "The Assistant entirely" |
| Spanish translation of all interface text and content | "Roughly doubles the content work; needs a competent reviewer" | "Bilingual release only" |
| Severity wording for every metric and household combination | "Moderate; the table in §8.6 is the starting point, not the finished set" | "Personalized copy everywhere" |

- "Assign these at the same time as the engineering work, not after it."
- Numbers: 7 Learn topics; 20–30 volunteer orgs; each Learn topic has a protective-action checklist.

#### §26.3c Reference data loading
- "The water utility reference data is not live — it is loaded into the database from published federal results. A loading script already exists in the repository."
- Before interface work begins, the server owner should confirm:
  - "which results are currently loaded"
  - "when they were published"
  - "whether the stored records contain multiple dated readings per contaminant or only the most recent"
- "That last answer decides whether the map time slider is built at all (§68)." It also gates the §6.8 quarterly trend.

#### §26.4 The measurement that validates the whole plan
- **"Build one complete Today page showing live data, on a real phone, within three days of starting interface work."**
- **"Success looks like: real values rendering, no errors, loading in under three seconds on a mobile connection."**
- "This converts the schedule from an assumption into a measurement. If that page takes a few hours, the full plan is achievable. If it takes several days, the remaining scope should be reduced immediately — while there is still time to reduce it deliberately rather than discovering the problem in the final week."

---

### Competition, judging and product principles (collected)

In range:
- **Competition:** Congressional App Challenge 2026, district NC‑08 (front matter).
  - Deadline "October 26, 2026, 12:00 PM EST"; internal target "October 23".
- **Judging context:**
  - §6.0: "An application judged in a short demonstration is assessed on whether it looks considered and works correctly, not on whether it looks expensive."
  - §20.1: the District View "is the clearest answer to why this application belongs in a competition judged by a congressional office rather than being a generic health tool."
  - §26.3: "Two finished pages beat five half-finished ones under every evaluation criterion … an unfinished page is worse than an absent one because it reads as broken rather than scoped."
  - §21: Health check is useful "before a demonstration."
- **Positioning:** §2.4. Must not claim to be first, because PollutionProfile exists. Use the narrow claim quoted above.
- **Privacy principles:**
  - The address is discarded (§4.1, §9.1).
  - Groups, not ages (§8.1, §8.3).
  - District view needs no account and holds no household data (§20.3).
- **Honesty principles:** §4.2, all seven, plus §6.1 "No data … distinctly not 'good'", §6.8 "Missing data appears as a visible gap, never as a zero", and §24's separation of error from empty.

*(from another section)*, gathered because the brief asked for them:
- **§14.2 Journal principles:** "Three binding consequences follow:"
  1. "The application must be completely useful to someone who never logs anything. Journal is an optional depth layer and never a prerequisite for any other feature."
  2. **"No streaks, no badges, no point scores, no celebration animations."**
  3. **"The first insight must arrive immediately, not after two weeks. A feature that produces nothing for fourteen days cannot survive the retention curve and cannot be demonstrated."**
  - Evidence cited: about 18% of users remain after thirty days; pooled dropout approaches 43%; compliance measured only while active reaches 71%. "Retention is the barrier, not diligence. Reminders help; gamified elements such as streaks and badges did not help and may actively reduce retention."
  - A single end-of-season summary is allowed because it is "a milestone rather than a nag". Example: "This spring you logged 22 days. On the 9 highest-pollen days, you flagged symptoms 7 times."
- **§15.5 Write a letter:** described as "the single strongest fit for a congressional competition in the entire application: a tool that helps a constituent engage an institution, built automatically from their own measured data."
  - Recipients are the water utility, a landlord, or the household's elected representative.
  - Description line: "A ready-to-send message about your water, filled in with your numbers."
- **§33 "the four things HALO tracks":** the Results Reveal shows four lines in sequence over about two seconds, then the button "See my results."
  - "Finding your water utility... Concord — Hillgrove WTP"
  - "Checking federal testing results... PFOS found above the limit"
  - "Looking up radon for Cabarrus County... Zone 2"
  - "Getting today's air quality... Good"
  - Purpose: "it makes the work visible, it introduces the four things HALO tracks before the person has to navigate to find them, and it converts an anticlimactic redirect into the moment the application proves it did something real."
  - Empty-lookup line: "No published water results yet for your utility."
  - [FLAG] In §33 the "four things" are the four reveal lookups: water utility, water testing results, radon, and today's air quality. This is distinct from §2.2's "four" daily readings (air, UV, pollen, mold) and "Today's four readings" (§6.6).
- **§65.5 "What the judges actually see":**
  - "Whether the application works at all, on a real device, without errors"
  - "The map, especially the moment a contaminant selection re-colors the state"
  - "Whether the numbers are explained in language a person understands"
  - "Whether it admits what it does not know"
  - "Whether the person presenting can explain why it was built this way"
  - "They will not notice easing curves, staggered animations, or a two-pixel shadow." "the bar for this competition is a clean, consistent, working application — not a designed product … Build to clean and stop."
- **Final principle (§65.5):** "This application's strongest asset is not any feature — it is that it is honest about uncertainty in a category where most products are not. A missing measurement is never zero. An estimate is always labeled. A pattern is not reported until the data supports it. A substance is shown even when it cannot be scored, with the reason stated."

---

### Consolidated flags for the coding agent
1. **Overlay count.** §7 says 3 overlays (Learn, Assistant, Alerts). District View is a Map panel (§20), even though Part III lists it among the overlays.
2. **Sensitive-group alert shift.** §8.4 applies it generically; §19.3 limits it to respiratory, toddler and senior. This is the server's concern.
3. **Motion caps.** Motion is under 300ms (§6.5), but the score ring runs under 400ms (§6.8). Both are suppressed under reduced motion.
4. **Component effort.** §26.1 says about an hour; the §26.3 table says about a day.
5. **Label mismatch.** The §8.6 per-metric severity words ("Unhealthy for sensitive groups", "High" at level 2) differ from the §6.1 generic labels. Always render the server's word.
6. **Snapshot staleness.** §4.1 build state, §26.1 item 3 (anonymous sign-in "not yet confirmed"), and "49 commits" are all snapshots.
7. **Quarterly trend and map time slider** exist only if `ucmr5_utilities` holds multiple dated readings per contaminant (§6.8, §26.3c, §68).
8. **§6 style values are VOIDED** (hex, fonts, sizes, spacing, radius, shadow, gradient colors). Accessibility floors (44px targets, 15px body, contrast, reduced motion, never color alone) and all semantic rules still bind.

## Appendix B — Operations and closing sections (§35–§42, §62–§70)
### Section-numbering note
- **§43, §55 and §64 do not exist.** The blueprint skips those numbers (42→44, 54→56, 63→65); nothing is missing.
- The body headings use slightly different titles from the contents list: §36 is "Offline and Poor Connections", §38 "Configuration and Environment", §39 "Error Handling and Logging", §62 "Backend Operational Detail", §63 "What the Application Must Be Able to Do", §65 "Build Triage — What Matters, What Doesn't", §69 "What This Application Deliberately Cannot Do".
- Cross-references covered elsewhere (the PDF and Appendix A): §29 Formatting Rules (the DoD requires it), §31 Content Inventory (the DoD requires it), §4.2 scoring/honesty principles, §6.0, §17 Learn topics, §26.2 build order.

### Preamble: framing that governs triage
- Title: "HALO — Complete Product Blueprint". "Environmental health application for North Carolina households · Congressional App Challenge 2026, NC‑08".
- "Deadline October 26, 2026, 12:00 PM EST · Internal target October 23".
- "Verified against the vmag211/halo-app repository, main branch, 49 commits."
- Purpose: "It contains no source code. A team that has never seen this project should be able to read this document and build the intended application accurately." "Where something is already built, this document says so and describes what exists rather than proposing a replacement."
- "Completeness is not priority. Section 65 sorts every specified detail into what is load-bearing, what is worth building, and what to cut first. Read it before starting, not after falling behind."
- The visual bar: "This does not need to look like a funded consumer product. It needs to look clean, deliberate, and finished — nothing more. Consistent spacing, one type scale, one color system, aligned edges, and no visual bugs will read as well-made. Custom illustration, elaborate motion, and decorative flourish will not add to that impression and will consume time that the working application needs. Where this document specifies visual detail, it does so to keep several people building consistently, not to raise the level of finish."

---

### §35 Performance

#### §35.1 Targets (exact table)
| Measure | Target | Maximum |
|---|---|---|
| First meaningful content | Under 1.5 seconds | 3 seconds |
| Interactive and responding to taps | Under 2 seconds | 4 seconds |
| Tab change | Under 100 milliseconds | 300 milliseconds |
| Sheet open | Under 250 milliseconds | — |
| Cached reading display | Under 200 milliseconds | 500 milliseconds |
| Fresh reading retrieval | Under 2 seconds | "5 seconds, then show cached with a notice" |
| Map first render | Under 2 seconds | 4 seconds |
| Map layer switch | Under 300 milliseconds | 1 second |
| Total page weight, first load | Under 500 kilobytes | 1 megabyte |

- "All targets measured on a mid-range phone over a typical mobile connection, not on a development machine over office broadband."

#### §35.2 How the targets are met
- "Charts are drawn as inline vector graphics rather than importing a charting library, which avoids a large dependency for a handful of simple shapes." (→ inline SVG; no chart library.)
- "The map library loads only when the Map tab is first opened, not on initial load." (→ lazy/dynamic import of map library.)
- "Map data loads as a single pre-assembled file rather than many requests."
- "The last successful readings are stored locally and displayed immediately on open while fresh data is retrieved in the background." (stale-while-revalidate)
- "Images are sized for their display dimensions and served in a modern format."
- "Fonts load with a fallback displayed immediately rather than blocking text rendering." (font-display swap / fallback)

#### §35.3 Layout stability
- "Skeleton placeholders must occupy the same dimensions as the content that replaces them. Content that arrives and pushes the page around is worse than content that arrives slightly later, particularly on a page where somebody may be mid-tap."

---

### §36 Offline and Poor Connections
- "The last successful readings for both Today and HomeGuard are stored locally and shown immediately on open, with their original timestamp, while fresher data is requested."
- Request fails + cached data exists → cached data stays on screen with notice (exact string): **"Showing your last readings from [time]. We couldn't reach the data source."**
- "When a request fails and no cached data exists, the empty state explains rather than showing a blank screen."
- "Journal entries written while offline are queued locally and sent when connectivity returns. The entry appears immediately in the interface with a small pending indicator." (NOTE: §65.3 lists "Offline journal queueing" as Tier 3 cut-first: "Meaningful complexity. Showing a clear 'couldn't save, try again' is acceptable.")
- "The map's stored dataset is cached after first load, so returning to Map works offline with its last known data."
- "Learn content is cached after first read, since it changes rarely."
- "A thin banner appears at the top of the screen when the device reports being offline, and disappears when connectivity returns." (Offline banner visual spec is §58.4 — in page-level spec.)

---

### §37 Security and Privacy

#### §37.1 Already implemented (do not re-build; do not break)
- "Identity is derived from a verified session token on every server request. A client cannot request another household's data by supplying a different identifier."
- "Database-level rules restrict every record to its owner."
- "Derived records — cached readings, generated alerts — are writable only by the server, so a client cannot fabricate one."
- "Anonymous account creation is protected by an invisible anti-abuse check."
- "Request limits are enforced per household and globally, with deliberate choices about which limits fail open and which fail closed."
  (No numeric rate-limit values are given anywhere in §35–§42 or §62–§70.)

#### §37.2 Requirements for new work
- "Every new server route verifies identity the same way. No route accepts an identifier from the request body as proof of who is asking."
- "Secrets exist only in server environment configuration. No key is ever included in code sent to the browser."
- "All user-supplied text is escaped on display. The journal note and assistant question are the two free-text inputs."
- "Every request to the assistant is rate limited per household."
- "Nothing sensitive is written to browser storage beyond the session token the authentication library manages and the cached readings, which contain nothing a person would not already see on screen."

#### §37.3 The privacy posture, stated as commitments (exact table)
| Commitment | How it is enforced |
|---|---|
| The street address is never stored | "Geocoding happens server-side and the text is discarded before any write. The database column exists and is deliberately never populated." |
| No names are collected | "No field exists for one anywhere" |
| No ages or birthdates are collected | "Household composition stores only category presence" |
| No account is required | "Anonymous sessions, no email, no password" |
| Symptom entries are never shared | "Owner-scoped access rules; the data never leaves the household's own records" — **Superseded in part (Sept 27):** the Assistant may send relevant readings and symptom names/dates (never notes) to its AI provider; see §10.2 |
| Everything can be deleted | "A deletion control in Settings removes the account and cascades through every related record" |

#### §37.4 Measurement and tracking
- "The application collects no behavioral analytics. This is a deliberate choice consistent with the rest of its privacy posture, and it should be stated in the privacy section rather than left unmentioned." (→ Settings/privacy copy must state it; do NOT add analytics SDKs.)
- "Server-side error logging records what failed and when, without recording who."

---

### §38 Configuration and Environment

#### §38.1 Required configuration
- "Every value below exists only on the server. A template file listing the names with empty values belongs in the repository; the file containing real values never does." (→ commit `.env.example` with empty values; never commit `.env.local`.)

| Purpose | Notes |
|---|---|
| Database and authentication connection | "Public address, public client key, and a secret server key. The secret key is never sent to the browser." |
| Air quality service key | "Primary measured source" |
| Ultraviolet service key | "Fallback only, because the free allowance is shared across all users" |
| Pollen service key | "Spending alert configured" |
| Geocoding service token | "No hard spending cap available; usage checked manually" |
| Rate limiting store credentials | "Address and token" |
| Anti-abuse check keys | "Public site key and secret verification key" |
| Scheduled job secret | "Prevents the daily process from being triggered externally" |
| Assistant model key | "For the question-answering feature" |

(Nine configuration purposes. Note the table's lead line says every value exists only on the server, yet the DB public address/public client key and the anti-abuse public site key are by nature client-visible "public" values; only the secret server key, secret verification key, service keys/tokens, rate-limit token, job secret and assistant key must never reach the browser.)

#### §38.2 Two places, both required
- "Configuration exists in two places that do not synchronize: the local development file and the hosting platform's settings. Editing one does not affect the other. Both require a restart or redeployment to take effect. This has already cost debugging time once and will again if not stated."

#### §38.3 Environments
- "Development runs locally against the same database as production, which is acceptable at this scale but means local testing writes real records."
- "Test households should be identifiable so they can be removed before launch."
- "Every merge to the main branch deploys automatically, so the main branch is always the live application."

---

### §39 Error Handling and Logging

#### §39.1 Principles
- "A failure in one data source never prevents the others from displaying. If pollen fails, the other three readings still render and the composite is marked incomplete."
- "Every external request has a timeout. A hanging government service must not hang the page." (Per-source timeouts in §62.2.)
- "Failures are logged server-side with enough context to diagnose them and nothing identifying the household."
- "Error messages shown to people never contain technical detail, service names the person does not recognize, or stack traces."
- "A failure the person can do nothing about is stated plainly and never framed as their mistake."

#### §39.2 Degradation order (exact)
"When things fail, the application degrades in this order rather than collapsing:
1. Fresh data fails, cached data displays with its timestamp
2. Cached data is absent, the reading shows as unavailable while others display
3. All readings fail, the page shows an explanatory empty state with a retry control
4. The server is unreachable entirely, locally stored readings display with an offline banner"

#### §39.3 A health check
- "A server route reporting whether each external data source is currently reachable. Not linked from the interface, but invaluable before a demonstration and during development, because it answers 'is it us or them' in one request."

---

### §40 Testing

#### §40.1 Test addresses
- "Every flow must be verified against real addresses producing genuinely different outcomes, not synthetic ones."

| Case | Must produce |
|---|---|
| A Concord address | "A utility match with PFAS above the federal limit — the primary demonstration case" |
| A Union County address | "A different utility with different readings" |
| A third district address | "A third utility, ideally with no published results, exercising the no-data state" |
| A rural address | "No utility match, exercising the well prompt" |
| An address entered as a well | "The testing plan path rather than any score" |
| An address outside North Carolina | "Daily readings work, home readings degrade gracefully" |

(No actual street addresses are given in the blueprint.)

#### §40.2 Cases that must be exercised (exact list)
- "A household with no composition entered, receiving general wording everywhere"
- "A household with every composition group selected"
- "A household with only a respiratory condition, confirming that wording wins the priority order"
- "A build year before 1950, between 1950 and 1987, after 1988, and absent" (note: the text says "after 1988", leaving 1988 itself ambiguous between the bands — check §12/HomeGuard lead-era rules in the page spec for the exact boundary)
- "Renting mode and owning mode, confirming every action recommendation changes"
- "Journal with zero entries, with four entries (below threshold), and with twenty entries including illness-flagged days"
- "Every map layer, every contaminant selection, including one with no readings anywhere"
- "The assistant asked ten deliberately adversarial questions, including direct requests for diagnosis"
- "Every empty state and every error state, triggered deliberately"
- "Both languages, on every screen"

#### §40.3 Technical verification (exact list)
- "Every screen at 375 pixels wide on a real phone, not a desktop browser window resized"
- "Both mobile browser engines, since rendering differs" (i.e., WebKit/Safari and Chromium)
- "Keyboard-only navigation through every screen"
- "A screen reader on Today and HomeGuard at minimum"
- "The application with one data source deliberately blocked"
- "The application fully offline, then returning online"
- "Back button behavior with every sheet type open"
- "Deep links pasted directly into a fresh browser"

#### §40.4 Before any demonstration (exact list)
- "Run the health check and confirm every source is reachable"
- "Load the demonstration address and confirm results appear within the performance target"
- "Confirm the map's stored dataset was rebuilt recently"
- "Have a fallback plan if a government service is down — which is precisely why map data is pre-assembled rather than fetched live"

---

### §41 Operations

#### §41.1 Recurring maintenance (exact table)
| Task | Frequency | Why |
|---|---|---|
| Verify volunteer organization links resolve | Before launch, then monthly | "Dead links undermine the hand-verified claim" |
| Check geocoding usage | Weekly | "No hard spending cap is available on the account" |
| Confirm the daily scheduled job ran | Weekly | "A silently failed job means stale map data with a stale timestamp" |
| Re-check contaminant limits against current federal publications | Quarterly | "Several are under active proposed revision" |
| Verify educational source links resolve | Quarterly | "Citations that fail are worse than no citations" |
| Refresh water testing data | When new federal results publish | "Quarterly at most" |

#### §41.2 Known operational limits
- "The ultraviolet service's free allowance is shared across all users of the application, not per user, which is why it is a fallback rather than the primary source."
- "The geocoding service offers no configurable spending cap on this account, so usage must be checked manually."
- "The hosting platform limits how frequently scheduled jobs may run, which is why all recurring work is consolidated into one daily process."
- "Roughly half the district has no air quality monitoring station within twenty-five miles, so a substantial share of households receive modeled rather than measured air data. This is disclosed in the interface rather than hidden." (→ UI must label modeled air data.)

---

### §42 Definition of Done
"A page is not finished when it renders. It is finished when all of the following are true." (14 items, exact)
1. "All four states implemented: loading, error, empty, populated — with distinct copy for error and empty"
2. "Every value formatted according to section 29"
3. "Every string matching section 31, with no invented copy"
4. "Verified at 375 pixels on a real device"
5. "Keyboard navigable with visible focus indicators"
6. "Every severity shown as color, icon, and word together"
7. "Back button behavior correct for any sheets it opens"
8. "Scroll position retained on return"
9. "Both languages present"
10. "Missing data shown as an em dash or an explicit state, never as zero"
11. "Every estimate labeled as an estimate"
12. "Every data point's source and date available to the person"
13. "No console errors"
14. "Meets the performance targets in section 35"

### §43 — does not exist (see numbering note).
### §55 — does not exist (see numbering note).

---

### §62 Backend Operational Detail
(Frontend relevance: tells the UI what ages/labels/nulls/flags to expect and render.)

#### §62.1 Caching, per capability (exact table)
| Capability | Cache | Reasoning |
|---|---|---|
| Daily readings | One hour per household, server-side | "Protects rate-limited sources; conditions do not change meaningfully faster" |
| Home assessment | Twenty-four hours per household | "Underlying data changes quarterly at most" |
| Map datasets | "Rebuilt daily, served as static files with a long cache lifetime" | "Immune to source outages; refreshed on a predictable schedule" |
| District aggregate | "Daily, alongside the map rebuild" | "Derived from the same data" |
| Educational content | "Cached indefinitely in the browser, invalidated by version" | "Changes only when content is edited" |
| Volunteer listings | Twenty-four hours | "Changes rarely" |
| Reading history | Not cached | "Must reflect entries written moments ago" |
| Journal entries and findings | Not cached | "Same reason" |
| Assistant answers | Not cached | "Each answer is specific to its question and the household's current data" |

- "Every cached response states its age to the interface, so the person always sees when the data was retrieved rather than assuming it is live."
- (Related, from §54 interaction map: "Pull down on Today or HomeGuard — Refreshes, bypassing cache".)

#### §62.2 Timeouts and failure behavior, per source (exact table)
| Source | Timeout | On failure |
|---|---|---|
| Air quality, primary | 5 seconds | "Fall through to the modeled source, labeled as modeled" |
| Air quality, modeled | 5 seconds | "Air reading omitted; composite marked incomplete" |
| Ultraviolet | 5 seconds | "Fall through to the secondary source, then omit" |
| Pollen | 5 seconds | "Omit; composite marked incomplete" |
| Weather, for mold | 5 seconds | "Mold defaults to its lowest risk rather than failing the whole request — already implemented" **Superseded:** mold is now `no_data` and listed as missing when the forecast fails (punch list item 4, backend branch). |
| Geocoding | 8 seconds | "Onboarding shows a retryable error; nothing is stored" |
| Utility boundary lookup | 8 seconds | "Utility identifier stays empty; the household is prompted about wells" |
| Assistant model | 20 seconds | "Message explaining the request could not be completed, with retry" |

- "The governing principle, already established in the existing code: one source failing must never prevent the others from returning. A partial answer with honest labeling beats no answer."
- Frontend implication: client-side fetch timeouts must exceed these (e.g., assistant UI must tolerate ~20 s; §35.1 says fresh reading retrieval max "5 seconds, then show cached with a notice").

#### §62.3 Data refresh cadence (exact table)
| Data | Refreshed | Triggered by |
|---|---|---|
| Water contaminant results | "When new federal results publish, quarterly at most" | "Manual reload of the reference table" |
| Radon zones | "Effectively never; static federal data" | "Manual, if federal zones are revised" |
| Map datasets | Daily | "The scheduled process" |
| Volunteer listings | "Monthly verification" | "Manual, with the verification date updated" |
| Educational content | "Quarterly source-link check" | "Manual, with retrieval dates updated" |
| Assistant sources | Quarterly | "Manual re-ingestion with new retrieval dates" |

#### §62.4 Response contracts and change discipline (exact)
- "Response shapes are additive-only once interface work begins. Fields may be added; existing fields are never renamed, removed, or re-typed."
- "Any field that can legitimately be absent is documented as such, and the interface handles its absence explicitly rather than assuming presence."
- "Numeric fields that can be unknown return an explicit null, never zero and never an empty string."
- "Every response carries the data's retrieval timestamp and, where relevant, its source name."
- "Severity words are a closed set. Adding a new one requires updating the shared mapping, or the interface will render it as no-data." (→ frontend must map unknown severity strings to the no-data state, never to a "good"/green state.)

#### §62.5 What the server must never do (exact, 7 items)
1. "Return a computed severity that disagrees with what the shared scoring logic would produce for the same input."
2. "Substitute zero for a missing measurement anywhere."
3. "Return a score built from incomplete inputs without marking it incomplete."
4. "Accept an identifier from a request body as proof of identity."
5. "Include a secret key in any response."
6. "Store the raw address text at any point in any table."
7. "Return an estimate without a flag marking it as one."

---

### §63 What the Application Must Be Able to Do (Capability Checklist)
"A closing statement of capability, against which any build can be checked." All 20, exact:
1. "Turn a typed address into a household's environmental picture in under ten seconds, without an account, and without retaining the address"
2. "Show today's air, ultraviolet, pollen, and mold conditions with a combined score, honestly marked when any input is missing or estimated"
3. "Show the household's drinking water contaminants against federal limits, its county radon risk, and its lead risk from building age — with lead shown but never scored"
4. "Distinguish five different water situations, including two kinds of absent data, without ever presenting absence as safety"
5. "Give private well households a prioritized testing plan instead of a fabricated reading"
6. "Reword every reading according to who lives in the home, without collecting any age, name, or medical record"
7. "Produce a ranked action plan with costs and certifications, differing for renters and owners"
8. "Show severity across the whole state, for any single contaminant or for overall water health, with time scrubbing where the data supports it"
9. "Let a household record symptoms and surface real patterns against their own exposure history — while refusing to report a pattern before the data supports one"
10. "Answer questions from cited sources and the household's own data, and refuse to diagnose"
11. "Explain every contaminant in plain language, tied to the household's own number, with cited sources and concrete protective steps"
12. "Connect the household to verified local organizations matched to their own findings"
13. "Generate a ready-to-send letter filled with the household's own measured values"
14. "Produce a shareable, printable summary suitable for a doctor or landlord"
15. "Present the district's situation at aggregate scale, with no personal data"
16. "Alert the household when something meaningfully changes, at a lower threshold when a sensitive group is present"
17. "Work offline with the last known readings, and recover when connectivity returns"
18. "Function entirely in English or Spanish"
19. "Be fully operable by keyboard and by screen reader, with severity never conveyed by color alone"
20. "Let the household delete everything permanently"

- "The test of this document. If a team can build every capability in the table above, matching the element specifications in Parts V through VII, then this blueprint has done its job. If any capability cannot be traced to a specification, that is a gap in this document rather than a decision left to the builder."

### §64 — does not exist (see numbering note).

---

### §65 Build Triage — What Matters, What Doesn't
- "This document specifies the application completely. Completeness is not the same as priority. This section sorts every specified detail into three tiers so that work is spent where it shows and cut where it does not."
- "Read this before building, not after falling behind. A team that treats every line of a specification as equally required will spend a week on motion curves and ship without dark mode. The tiers below are the intended reading order of effort."

#### §65.1 Tier 1 — load-bearing. "Cutting these breaks the application or its credibility." (16 items, exact)
| Item | Why it is non-negotiable |
|---|---|
| The four universal states on every screen | "A screen that silently shows nothing is indistinguishable from a broken one" |
| Error copy distinct from empty copy | "'We failed' and 'the data doesn't exist yet' warrant completely different reactions from the household" |
| Severity as color plus icon plus word | "Accessibility, and a risk application must not fail for a colorblind reader" |
| Missing data never rendered as zero or green | "The single most dangerous possible failure — presenting absence as safety" |
| Every estimate labeled as an estimate | "The application's entire credibility rests on not overstating what it knows" |
| The back button contract | "Without it, overlays make the application feel broken on every device" |
| Number and date formatting rules | "The same value formatted differently on two screens reads as unfinished" |
| The shared component set, built first | "Parallel work without it produces several visually different applications" |
| Response shapes frozen before interface work | "A shape change after screens exist blocks everyone simultaneously" |
| Dark mode | "A browser application ignoring the system preference reads as unfinished to a large share of users" |
| Health card print styling | "The card's stated purpose is to be handed to a doctor or landlord" |
| Assistant's structural refusal to diagnose | "A prompt instruction can be argued around live; a code path cannot" |
| The threshold bar's fixed zero-to-twice-the-limit scale | "What allows contaminants with different limits to be compared at a glance" |
| The "Felt fine today" option in Journal | "Without recorded good days, the pattern analysis only ever sees bad ones and every finding is biased" |
| Journal's minimum-data threshold before reporting | "Reporting a pattern from four data points is the difference between a credible tool and a misleading one" |
| Cached readings shown when a source fails | "An environmental application that goes blank on a weak signal fails when it is wanted" |

(Tension to note: Dark mode is Tier 1 here, but §68 says if colours are hardcoded in week one, "cut it rather than retrofit" — resolve by building colour tokens from day one.)

#### §65.2 Tier 2 — "worth building, in this order, once Tier 1 is done" (exact order)
1. "The contaminant dropdown on the map — the most interactive element in the application and the one most likely to hold attention"
2. "Household-aware wording — cheap, and it is what makes the application feel built for this family"
3. "The threshold bar chart — highest communicative output of any visual"
4. "The calendar heat grid — gives Journal its identity in one afternoon"
5. "The house diagram — gives HomeGuard its identity in one afternoon"
6. "The results reveal after onboarding — one screen, reuses fetched data, converts a redirect into a moment"
7. "The contribution bar — answers 'what's driving this' without opening a card"
8. "Seven-day trend lines — requires the history endpoint, which Journal needs anyway"
9. "Pull to refresh — an expected gesture whose absence is noticed"
10. "Spanish — real reach in this district, but genuinely doubles content work"

#### §65.3 Tier 3 — "specified, but cut first without hesitation"
"Each of these was specified for completeness. Each costs real time and produces output that almost nobody will consciously notice. If the schedule tightens, these go first, in roughly this order." (Cut order = listed order, 15 items, exact)
1. Assistant button hiding and reappearing on scroll — "Fiddly scroll-direction detection, frequently buggy, benefit invisible. Just leave the button fixed."
2. Map auto-panning to keep a selected feature above the sheet — "Genuinely awkward to get right across zoom levels. Let the sheet cover part of the map; people drag."
3. The home pin's one-time pulse — "Pure decoration. The pin is already the only teal object on screen."
4. Score ring number counting up — "Animating a number is more work than it sounds and delays the one value people came for."
5. Chart bars staggered 50ms apart — "Invisible in practice. Draw them all at once or skip the animation."
6. Skeleton shimmer animation — "A static grey block communicates 'loading' identically."
7. Header shadow appearing on scroll — "Scroll listener for a two-pixel visual change."
8. Onboarding slide transitions — "A cross-fade, or nothing at all, is fine. Nobody has ever abandoned an onboarding flow over transition style."
9. Air monitor outer glow — "Distinguish monitors from water circles by shape or size instead — simpler and clearer."
10. Zoom buttons hidden on touch devices — "Leave them visible everywhere. The conditional logic costs more than the clutter."
11. Toast duration varying by content — "One duration for everything."
12. Map time slider — "The largest Tier 3 item. Conditional on the data supporting it, meaningful build cost, and the map already works without it. Verify the data first; cut without regret if it is thin."
13. Season recap notifications — "Pleasant, entirely optional, and only reaches households still logging months later."
14. Landscape-specific handling — "The centered column already handles it acceptably."
15. Offline journal queueing — "Meaningful complexity. Showing a clear 'couldn't save, try again' is acceptable."

#### §65.4 Simplifications worth taking even without time pressure (exact)
| Instead of | Do this |
|---|---|
| Thirteen distinct animation durations | "Three: 150ms for fades, 250ms for movement, 400ms for the score ring. Nobody perceives the difference between 200 and 250." |
| Five button variants | "Three — primary, secondary, tertiary. Destructive is secondary in red; icon-only is tertiary with no label." |
| Three sheet heights | "Two — standard and tall. Compact and standard are close enough that the distinction is not felt." |
| Severity-colored left borders and severity pills on the same card | "Pick one. Both is redundant emphasis. The pill carries the word, so keep the pill." |
| Per-screen skeleton compositions | "Two shapes — a card block and a text block — composed as needed." |

(These override the more elaborate specs in §44/§52/§60 etc. — a builder should apply these simplifications by default.)

#### §65.5 What the judges actually see
- "A demonstration is short and a reviewer's attention is finite. In practice they will notice:
  - Whether the application works at all, on a real device, without errors
  - The map, especially the moment a contaminant selection re-colors the state
  - Whether the numbers are explained in language a person understands
  - Whether it admits what it does not know
  - Whether the person presenting can explain why it was built this way"
- "They will not notice easing curves, staggered animations, or a two-pixel shadow. Every hour spent on the first list is worth several spent on the second."
- "On visual ambition specifically: the bar for this competition is a clean, consistent, working application — not a designed product. An interface with even spacing, one type scale, correct contrast, and no layout bugs will read as well-made. Time spent past that point buys very little, and it is time the working application needs. Build to clean and stop."
- The final principle: "This application's strongest asset is not any feature — it is that it is honest about uncertainty in a category where most products are not. A missing measurement is never zero. An estimate is always labeled. A pattern is not reported until the data supports it. A substance is shown even when it cannot be scored, with the reason stated." "That restraint is already built into the scoring engine and it is the most defensible thing the project has. Every interface decision above exists to make that restraint visible rather than to hide it behind polish. If a trade-off ever arises between looking finished and being honest, choose honest — it is both the right call and, in this competition, the stronger one."

---

### §66 Verification Before Launch (12 items, exact)
| # | Verify | Why it matters |
|---|---|---|
| 1 | Anonymous sign-in is enabled in the authentication provider | "Disabled by default; authentication fails despite correct code" |
| 2 | Every filter certification number against the certifying body's own documentation | "A wrong filtration claim is materially harmful to a household acting on it" |
| 3 | Every contaminant threshold against current federal publications | "Several limits are actively contested and under proposed rescission" |
| 4 | Current federal guidance on wellness and decision-support software | "How the assistant is described determines how it is regulated" |
| 5 | Whether stored water data contains multiple dated readings per contaminant | "The map time slider and any trend chart depend entirely on this" |
| 6 | Map performance on a real mid-range phone with every layer active | "Success: layers render, panning is smooth, loads under three seconds. Failure: reduce to two layers." |
| 7 | The assistant against ten deliberately adversarial questions | "Before any demonstration, not during one" |
| 8 | Every volunteer organization is still operating and its link resolves | "Dead links undermine the claim that these were verified by hand" |
| 9 | Every educational source link resolves and shows its retrieval date | "Citations that fail are worse than no citations" |
| 10 | The full flow on three real district addresses across different utilities | "Include at least one address known to produce no utility match" |
| 11 | Every screen at 375 pixels wide on a real device | "The primary target viewport" |
| 12 | Which evaluation criteria the district office is using this year | "Offices may substitute their own. Asking directly costs one email." |

- Closing note on emphasis: "A substantial share of the competition's evaluation rests on how well the work is explained rather than on how much of it exists. The scoring engine already contains several decisions that are genuinely unusual and each take about fifteen seconds to explain: why a missing measurement is never treated as zero, why home risks are combined multiplicatively rather than averaged so that one severe problem cannot be hidden by several mild ones, why a measured substance is deliberately excluded from the score with the reason stated, why three federal limits carry a rescission notice, and why the pattern analysis refuses to report a correlation until it has enough data to support one." "Those decisions are the strongest material this project has, and they are already built. Explaining them well is worth more than adding another feature."

---

### §67 Glossary (every term, exact definitions)

#### §67.1 Measurement and regulation
- **MCL** — "Maximum Contaminant Level. The legally enforceable federal limit for a substance in drinking water. Exceeding it is a violation."
- **ppt** — "Parts per trillion. The unit used for PFAS. One part per trillion is roughly one drop in twenty Olympic swimming pools."
- **ppb** — "Parts per billion. Used for lead and several metals. One thousand times larger than a part per trillion."
- **pCi/L** — "Picocuries per litre. The unit for radon. The federal action level is 4.0."
- **Hazard Index** — "A federal combined measure for several PFAS compounds together. A value of 1.0 or above is a violation even when no single compound exceeds its own limit."
- **Non-detect** — "Tested, nothing found above the laboratory's detection threshold. Distinct from untested, and distinct from zero."
- **Health advisory level** — "A non-enforceable reference value published where no enforceable limit exists. Used in this application for unregulated compounds, always labeled as non-enforceable."

#### §67.2 Substances
- **PFAS** — "Per- and polyfluoroalkyl substances. A family of thousands of manufactured chemicals that do not break down naturally. 'Forever chemicals.'"
- **PFOA, PFOS** — "The two most studied PFAS compounds. Federal limit 4.0 ppt each."
- **PFHxS, PFNA** — "Additional regulated PFAS compounds. Federal limit 10.0 ppt each. Currently subject to a proposed federal rescission."
- **GenX** — "A PFAS compound with particular North Carolina history. Federal limit 10.0 ppt. Also subject to the proposed rescission."
- **Radon** — "A radioactive gas from uranium decaying in soil. Colorless and odorless. Second leading cause of lung cancer in the United States."
- **Lead service line** — "The pipe connecting a home to the water main, where made of lead. Utilities are required to inventory these."
  (The "three federal limits carry a rescission notice" in §66 = PFHxS, PFNA, GenX.)

#### §67.3 Systems and data sources
- **PWSID** — "Public Water System Identification number. The federal identifier for a water utility. The key that links a household to its testing results."
- **UCMR** — "Unregulated Contaminant Monitoring Rule. The federal programme requiring utilities to test for specified substances. The fifth round is the source of this application's PFAS data."
- **SDWIS** — "The federal database of public water systems. Used originally for utility matching, before the more accurate boundary-based method replaced it."
- **Service area boundary** — "The geographic polygon a utility serves. Testing which polygon contains an address is how this application identifies the correct utility."
- **AQI** — "Air Quality Index. A 0–500 federal scale. Reports the worst single pollutant, not an average."
- **Radon zone** — "A federal county-level classification predicting average indoor radon. Zone 1 is highest risk. A prediction for a county, never a measurement of a home."

#### §67.4 Terms specific to this application
- **Severity level** — "The 0–4 scale plus no-data that every reading maps to, regardless of what it measures"
- **Confidence** — "How much a reading can be trusted, tracked separately from how severe it is"
- **Coverage** — "Whether everything detected could be evaluated, or only some of it"
- **Proxy** — "A value derived from something else rather than measured directly. Mold risk is the primary example."
- **Household group** — "One of the seven presence facts collected instead of ages"
- **Shown, not scored** — "A substance displayed with its value but deliberately excluded from any score, with the reason stated. Applies to lithium and to lead."

---

### §68 Open Decisions
"Matters this document deliberately does not settle, because they require a human judgement or a fact not yet confirmed. Each needs an owner and a date." (7 rows, exact)
| Decision | What it depends on | Consequence |
|---|---|---|
| Whether the map time slider is built | "Whether stored water data contains multiple dated readings per contaminant, or only the latest" | "If only the latest exists, the slider is cut and the water layer is simply static" |
| Whether Spanish ships in the first release | "Whether a competent Spanish speaker can review the translated content" | "Machine translation of health guidance is not acceptable. Ship English-only rather than ship unreviewed Spanish." |
| Which evaluation criteria apply | "A direct question to the district office" | "Offices may substitute their own criteria. Cheap to ask, potentially significant." |
| How many volunteer organizations to verify | "Available hours for manual verification" | "Twenty verified beats forty unverified. Cut the count, not the verification." |
| Whether the assistant ships at all | "Whether the working application is complete with time remaining" | "It is the largest single build in the project and the last in the order. Shipping without it is a legitimate outcome." |
| Whether dark mode is built | "Whether the colour system is built as tokens from the first day" | "Cheap if done from the start, expensive to retrofit. If colours are hardcoded in week one, cut it rather than retrofit." |
| Whether lead ever enters any score | "Already decided: no. Recorded here so it is not reopened." | — |

Frontend implications: build i18n plumbing so the app can ship English-only if Spanish isn't reviewed (never machine-translate health copy); build the Assistant entry point so it can be feature-flagged off; use colour tokens (CSS variables) from day one; map water layer must work as static if the slider is cut; never let lead contribute to any score.

---

### §69 What This Application Deliberately Cannot Do (Known Limitations)
"Stating limits plainly is an asset rather than a weakness. It is also the set of answers needed when somebody asks a hard question during a demonstration." (9 rows, exact)
| Limitation | Why |
|---|---|
| It cannot tell you what is in your tap water | "It reports what the utility measured at its own sampling points. What arrives at a specific tap depends on that building's plumbing, which nobody has measured." |
| It cannot measure radon in your home | "County zones predict averages. Only a physical test measures a building." |
| It cannot detect mold | "It estimates conditions favourable to mold from humidity and rainfall. No sensor is involved." |
| It cannot test private wells | "No agency tests them. The application gives a testing plan instead, which is the honest response." |
| It cannot tell you whether your plumbing contains lead | "Building age indicates an era, not a material. Only testing establishes the fact." |
| It cannot diagnose anything | "Not a medical device, by deliberate design and by structural refusal." |
| It cannot prove that an exposure caused a symptom | "Journal reports co-occurrence in a household's own logs. Correlation in a small personal sample is not causation and the application says so every time." |
| It cannot promise its data is current | "Federal testing publishes on its own schedule. Every reading carries its date so the person can judge for themselves." |
| It cannot cover the whole country equally | "Water and radon detail is strongest in North Carolina. Daily conditions work anywhere." |

- "Why this list is worth having. Most consumer environmental applications imply more certainty than they possess. Every limitation above is already surfaced somewhere in the interface rather than buried. When a reviewer asks 'how do you know that,' the strongest available answer is a precise account of what the application knows, what it estimates, and what it refuses to claim." (→ each limitation must be visible somewhere in the UI copy.)

---

### §70 Using This Document

#### §70.1 Reading order by role (exact)
| Role | Read, in this order |
|---|---|
| Anyone new to the project | "§2 what it is, §4 current state, §7 navigation, §63 capability checklist" |
| Building the interface | "§6 design system including §6.0, §44–54 frontend detail, §65 triage, then the page section they own" |
| Building the server | "§5 already solved, §9 data model, §21 responsibilities, §62 operations, §26.2 order" |
| Writing content | "§30 voice, §31 content inventory, §17 all seven Learn topics" |
| Preparing the demonstration | "§63 capabilities, §69 limitations, §4.2 the scoring principles worth explaining" |
| Under time pressure | "§65 triage, and nothing else until it is decided" |

#### §70.2 The order that actually matters (exact)
1. "Confirm anonymous sign-in is enabled. Everything fails without it and the code is already correct."
2. "Build the shared components and colour tokens. One hour, and it determines whether dark mode is cheap or impossible."
3. "Freeze the response shapes."
4. "Ship one complete Today page on a real phone. Measure how long it took."
5. "Re-plan the remaining scope against that measurement rather than against optimism."

#### §70.3 When this document is wrong
- "It will be, in places. It was written against a codebase at a moment in time, and several of its facts carry verification requirements precisely because they may have changed. Where the running application and this document disagree, the application is correct and this document is out of date."
- "The parts most likely to go stale: the current build state in §4, the stack details in §4.1, the contaminant limits in §67.2, and any statement about what is or is not yet built."
- "The parts least likely to change: the purpose, the navigation model, the household model, the honesty principles in §4.2, and the capability checklist in §63."
- Closing: "The reason this application is worth finishing is not that it displays environmental data. Several products do that. It is that 120,000 people in this district are drinking water above a federal limit, with a legal remedy that does not arrive until 2031, and nothing currently tells them so in language they can act on." "Every specification in this document exists to serve that, and any of it can be cut if cutting it gets a working, honest application in front of those households sooner."

---

### Frontend-builder quick extraction (derived from the above; every item traceable to a §)
- Every screen: loading / error / empty / populated, error copy ≠ empty copy (§42, §65.1).
- Unknown/null numerics → em dash or explicit state, never 0, never green (§42, §62.4, §65.1). Unknown severity word → no-data (§62.4).
- Severity = colour + icon + word always (§42, §63 #19, §65.1).
- Show source + retrieval date/age on every data point; label estimates, modeled air, proxies (§42, §62.1, §62.4, §41.2).
- Composite shows "incomplete" when any input missing (§39.1, §62.2, §62.5).
- Cache last readings (Today + HomeGuard) locally; show with timestamp + "Showing your last readings from [time]. We couldn't reach the data source." (§36); degradation order §39.2; offline banner (§36, §39.2).
- No chart library — inline SVG (§35.2); lazy-load map library on first Map tab open (§35.2); single pre-assembled map data file (§35.2); skeletons same size as content (§35.3); page weight <500 KB target / 1 MB max (§35.1).
- No analytics; state that in privacy section (§37.4). No secrets in client bundle (§37.2, §38.1, §62.5). Escape journal note + assistant question (§37.2). Nothing sensitive in browser storage beyond auth session + cached readings (§37.2).
- Never send an identifier in a request body as identity (§37.2, §62.5); never persist raw address (§37.3, §62.5).
- Colour tokens from day one → dark mode (§65.1, §68, §70.2). Print styling for health card (§65.1).
- Apply §65.4 simplifications: 3 durations (150/250/400 ms), 3 button variants, 2 sheet heights, pill-not-border, 2 skeleton shapes. Skip all Tier 3 items unless time is abundant.
- i18n so Spanish can be withheld if unreviewed (§68); assistant can be omitted (§68); map time slider conditional on data (§66 #5, §68).

---

*End of file. Next: open `HALO_Frontend_Specification.pdf`, read Part A in full, then build in the order in PDF E2 — starting with the shared layer and Onboarding.*
