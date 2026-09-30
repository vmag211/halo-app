# HALO: Wireframe → Working Page

**For Codex.** This is how every HALO page and sheet gets made, on every account and in every session. Onboarding was built first and is the reference implementation. Copy its patterns; don't invent new ones.

The goal: **the working page looks exactly like the approved wireframe.** The only difference is that it works (live data, real states, real taps and navigation).

**Repo setup (Yogi does this once):** save this file as `docs/WIREFRAME_WORKFLOW.md`, save the new `HALO_Frontend_Specification.pdf` (83 pages; it adds **Part P: Foundation, Owners, and Parallel Building** and replaces the older copy in `docs/onboarding/reference/`), and add one line to `AGENTS.md`: "Read `docs/WIREFRAME_WORKFLOW.md` before doing any frontend work." Merge it through a PR.

---

## 0. Decisions that override the spec

Where this section and the frontend spec or context file disagree, **this section wins** on process. The spec's **Part P** wins on who builds what and on what the shared foundation contains. (The spec and context copies in `docs/onboarding/reference/` are the original documents, kept as historical reference.)

| # | Decision | Replaces |
|---|---|---|
| 1 | **The backend is merged into `main`.** Bind every page to the live API using the field names in spec Part D. Don't use fixtures as a substitute for the API (mock adapters are for previews and tests only). Vibhav still has to apply migrations 0009–0014 in Supabase and finish the Vercel environment variables, so some responses will be degraded until he does | Context §6–7 (says "unmerged, branch from `vmag211/backend`, use fixtures") |
| 2 | **No em dashes (U+2014) anywhere in app-facing text**: screens, buttons, errors, alerts, accessibility labels, page titles, and text that comes from the backend (strip it before rendering). A missing value shows the words **No data** (or another approved plain phrase), never a dash character. Page titles read `HALO \| Page` | Spec/context: "a null is an em dash", `HALO — [page]` titles |
| 3 | **Appearance follows the phone's setting** (`color-scheme: light dark`, tokens via `light-dark()`), as Onboarding was built and approved in both. Every page must look right in both. *Open:* Yogi may switch the app to dark-only. If he does, it's one change on the root, so keep every color on tokens | (matches spec A11) |
| 4 | **The logo** is the transparent mark `public/halo-logo-mark.png`, white on the navy Welcome band, and in the contrasting/primary token color on other surfaces. Never bring back the blue tile or earlier logo concepts | Earlier logos |
| 5 | **Fonts are self-hosted** (`next/font/local`): Fraunces for headings and scores, Instrument Sans for everything else. IBM Plex Mono (codes only) is added in Phase 0 | Spec A11 (same fonts, different loading) |
| 6 | **Three people build pages at once, after one Phase 0 foundation.** Phase 0 (spec Part P2 and P3) has one owner named by Yogi and is merged to `main` before any page branch starts. Then three lanes in parallel: **Yogi** Today, Journal, Settings; **Naggi** HomeGuard + Learn, then Act + Alerts; **Vibhav** Map + District, then Assistant. Read Part P first | Earlier "one account builds everything" and the old §9 |
| 7 | **Every server-written string passes through `displayText()`** before it is shown (the backend still emits em dashes in places). A lint test fails the build if U+2014 appears in app-facing text. **Never display a server `error` string:** many routes still return raw database text | Spec: "display as sent" |
| 8 | **Settings owns `saveHousehold()`** (it always sends all seven household booleans), and the Alerts owner exports `useAlerts()` and `<BellBadge/>`. Other pages import them; nobody re-implements them | New (Part P3) |

---

## 0.5 Your authority

**You own HALO's frontend.** You make the wireframes, the visual design, and the code. Make ordinary frontend decisions yourself and tell Yogi what you decided. The frontend spec is the plan; the visual style gets designed and refined page by page with Yogi.

| Area | Who decides | How |
|---|---|---|
| **Function:** what each page does, every element, state, copy string, API binding, data rule | **The spec** | Build it as written. If you think it's wrong or missing something, propose it to Yogi. Don't silently deviate |
| **Implementation:** file structure, components, hooks, state, performance, accessibility, tests | **You** | Decide and do it. Mention anything significant in your report |
| **Visual design while wireframing:** layout, hierarchy, spacing, motion, the details that make it look high-end | **You propose, Yogi approves** | Design inside the A11 tokens using Yogi's references. Iterate until he approves |
| **Visual design after approval** | **Yogi** | Propose changes; make them only when he says yes (§8) |
| **The design system as it grows:** new shared components, tokens, patterns | **You propose, Yogi approves** | If a later page produces a better pattern, suggest applying it to earlier pages; once approved, do it through §8 |
| **Additions beyond the spec** | **You propose, Yogi approves** | Label them PROPOSED until he says yes |
| **Backend:** `app/api/**`, server modules in `lib/`, `supabase/**`, `scripts/**` | **Vibhav** | Never edit. Write down what the frontend needs, with the exact Part D names |
| **Phase 0 files** (`components/ui`, the shell, `lib/frontend/api.ts`, `useHaloData.ts`, `text.ts`, `format.ts`, `sheets.ts`, tokens) | **The Phase 0 owner until merged; after that, shared: ask first** | A page branch never edits them. Ask in a separate small PR that merges first, and tell Yogi |
| **`lib/auth.js`** | **Shared: ask first** | Onboarding already rewrote its session handling. Don't change it again without telling Yogi and Vibhav |

Rule of thumb: if the user can't see it, decide it yourself. If it changes what the user sees or what the spec says, propose it.

---

## 1. The four commands Yogi will give you

| Yogi says | You do |
|---|---|
| **"Wireframe [page]"** | Stage 1 (§4) |
| **"Change …"** | Change only what he asked. Nothing else moves |
| **"Approved" / "Save it"** | Stage 2: freeze (§5) |
| **"Build [page]"** | Stage 3 (§6), then Stage 4 (§7) |

If a command is unclear, ask one question before starting.

---

## 2. Before every session

1. `git checkout main && git pull`. Work on one branch per page: `page/[page]`. Merge `main` into it at the start of each session.
2. Read: `AGENTS.md` (Next.js 16 differs from your training data; read the relevant guide in `node_modules/next/dist/docs/` before writing Next code), this file, `docs/onboarding/README.md`, and in the spec PDF **Part P** (foundation and ownership), the page's section in Part B (or C for a sheet), the shared parts it references in Part A, and Part D for its API. Don't reread everything each time.
3. Only one account works on a given page.

---

## 3. What Onboarding established: reuse all of it

**Look**
- All tokens are CSS variables named `--halo-*` in `app/onboarding.css`, on the `.halo-app` class, defined with `light-dark()`: `page, card, ink, secondary, primary, on-primary, border, tint, error, error-tint, good, good-ink, moderate, elevated, high, severe, no-data, navy, teal, gutter (20px), radius (14px)`. After Phase 0 the shell renders `.halo-app` once, so pages never add it; Onboarding keeps its own because it sits outside the shell. Phase 0 also moves the token block to `:root, .halo-app` so portals and sheets get the tokens.
- Styling is `.halo-*` classes in CSS using those variables. No raw hex or px values in page code. If you need a new token, add it to that block; never start a second token system.
- One icon family (`lucide-react`), stroke width 1.8 (set once on `.halo-app svg`). Severity is always color + icon + word (`SeverityPill`). Touch targets 44px or larger. Every animation has a reduced-motion version.

**Shared components** (`components/ui/`): today `Button` (primary, secondary, tertiary, `busy`), `SeverityPill`, `ErrorCallout`, `FieldError`, `DataState`. Phase 0 adds the rest in one place (spec P2: BottomSheet, Card, ScoreRing, ContributionBar, Callout, Skeleton, EmptyState, SegmentedControl, ToggleChip, Switch, AccordionRow, SwipeRow, provenance and confidence pills) and freezes them, keeping the look Onboarding established and Onboarding's visual test passing.

**Data layer** (`lib/frontend/`)
- `api.ts`: the request wrapper: session handling, an 8 s deadline (15 s for onboard, daily-score, home-guard), identity-change protection, and mapping status codes to `FrontendError` codes. **Never show a server `error` string.** 401 recovery is handled by `authedFetch`; **503 never resets the session.** Right now this wrapper lives inside `createLiveOnboardingApi`; Phase 0 (§9) makes it the reusable `haloRequest`.
- `useHaloData(endpoint, { loader, cache, isEmpty })`: returns `{ data, status, error, retrievedAt, fromCache, refreshing, refresh }`. Old data stays on screen while a refresh retries. `DataState` renders loading / error / empty / success.
- `types.ts` (response shapes, `Severity`, `ErrorCode`), `copy.ts` (every string; the translation layer), `storage.ts` (identity-scoped reading cache and the `halo.onboarded` completion marker; never stores addresses, coordinates, or household answers), `onboarding.ts` (validation).
- Data pages follow the same seam Onboarding uses: the screen takes an `api` prop; a live adapter and a mock adapter both implement it.

**Routing and hand-off**
- `/` redirects to `/onboarding?entry=1`. Onboarding routes to `/today` when the profile has `onboarding_complete` (never `onboarded` alone). If the profile check fails but the local completion marker is valid, it goes to `/today?verify=1`, and `ProfileRecheck` retries in the background. `/onboarding?change=1` is the Change address flow for Settings.
- `/today` is currently a labeled stub. Replace it with the real Today (Yogi's lane); don't build around it.
- Onboarding leaves the last daily and HomeGuard readings in the identity-scoped cache so Today can paint instantly. The `halo:identity-changed` window event means the session changed; drop everything held in memory.

**Verification pattern**
- Preview: `/onboarding/preview` is a development-only route (hidden in production unless `HALO_ENABLE_FRONTEND_PREVIEW=1`) with a scenario selector driven by `lib/frontend/mock.ts`. It touches no auth and no network. Each page gets `/[route]/preview` and named mock scenarios for **every state**: populated, loading, empty, error, no data, partial, offline.
- Tests: logic in `test/frontend-*.test.mjs`; browser tests in `test/ui/[page].spec.ts`, which block external hosts and all `/api/` calls. Approved screenshots are immutable (`updateSnapshots: 'none'`; tolerance 0.5%). Never update a baseline to make a test pass.
- Commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:ui`. `playwright.config.ts` uses installed Google Chrome (`channel: 'chrome'`) and hard-wires its screenshot folder to `docs/onboarding/approved/screenshots`. Change it so each page's baselines live in `docs/[page]/approved/screenshots`, and keep Onboarding's working.
- Look at `docs/onboarding/preservation.md` for what a frozen page archive contains.

**Keep merges easy across three accounts:** put a page's own strings, types, and mock scenarios in their own files (Phase 0 creates them empty: `lib/frontend/copy/[page].ts`, `lib/frontend/[page].ts`, `app/[page]/[page].css`, `/[page]/preview`). The only edits to shared files should be one-line additions or exports. If two branches conflict on a shared file, keep both sides.

---

## 4. Stage 1: Wireframe ("Wireframe [page]")

A wireframe here is the **real, final-looking page** at `/[route]/preview` with mock data, so whatever Yogi approves is what ships. It is not a gray sketch, and it is not a picture. Build it once.

1. **Function from the spec.** Every element, state, and copy string in the page's Part B element table, with the exact wording (apply the §0 overrides). Don't invent copy, numbers, or features. PROPOSED items from the spec get built but are listed for Yogi to keep or cut.
2. **Look from the tokens and Onboarding's patterns,** plus Yogi's reference screenshots for structure, rhythm, and density. Never borrow a reference's colors or fonts.
3. **Reuse the shared components.** If the page needs a new reusable piece, build it in `components/ui/` and say so. Never make a near-copy of an existing one.
4. **375px wide** (and check 320px). Show one screenshot per state in **both light and dark**. Watch for a band or border that disappears against the dark page, contrast below 4.5:1, and shadows (they don't show in dark; use borders and surface color). Fix through tokens, never page-specific overrides.
5. **Long values must survive:** a long street address, a big number, Spanish (about 30% longer), enlarged text.
6. **Every state gets a mock scenario.** Loading is a skeleton, never a bare spinner. Error copy is never the same as empty copy. Missing data is the No data state, never zero and never green.
7. **Accessible as built:** real `<button>`, `<a>`, `<input>` with `<label>`; focus visible; 44px targets.

**Report to Yogi:** screenshots of every state (both modes) · the **element-table check** (each Part B row → where it is on the page, or "missing: why") · PROPOSED items built · new shared components created · any mock field that doesn't match Part D.

**Iterating:** change only what he asks. If his change would drop a required element, state, or string, say so and suggest where it could go. Never silently remove required content to make it look cleaner.

---

## 5. Stage 2: Freeze ("Approved" / "Save it")

Change nothing about the look while freezing.

1. Write `test/ui/[page].spec.ts`. For every state, open `/[route]/preview?scenario=…` and compare to `docs/[page]/approved/screenshots/{light|dark}-{375|320}-[state].png`. Wait for fonts. Anything non-deterministic must be fixed or masked: use a fixed "now" in the mock, and mask map tiles.
2. Generate the baselines **once**, check a few against what Yogi approved, then leave them alone.
3. Write `docs/[page]/README.md`: date approved; every element top to bottom with its exact copy, component, and the API field (Part D name) it binds to; every state; PROPOSED items Yogi kept.
4. `npm run test:ui`, `npm run typecheck`, `npm run lint`, and `npm run build` must all pass. Commit on the page branch: `wireframe: [page] approved`. Push.
5. Tell Yogi it's frozen. **From here the screenshots are the design.** Only Yogi changes them (§8).

---

## 6. Stage 3: Build ("Build [page]")

Create the real route at `app/[route]/page.tsx` rendering the **same screen component** with the live adapter.

**Allowed:** live data through the shared data layer and `useHaloData` (Part D field names, `severity` never `status`) · the loading/error/empty mapping from the spec · the interactions the spec lists (taps, navigation, sheets, forms, Back-closes-sheet) · new props or handlers on the screen for those interactions · the translation layer · `aria-*`.

**Not allowed without asking Yogi first:** changing any class, token, spacing, size, color, font, radius, icon, layout, element order, or copy in the frozen screen or the shared components it uses · restyling a shared component · computing a severity, score, or household sentence in the browser (the server decides them; bind to them) · showing a raw server `error` string.

If something truly can't work as designed (a real field can be longer than the design allows, an interaction needs a control the wireframe lacked), **stop and tell Yogi the problem and your proposed fix.** If he approves, use §8.

The preview route and mock scenarios stay and keep working. That's how Stage 4 proves the look didn't change. Don't edit backend files; note backend needs for Vibhav.

---

## 7. Stage 4: Prove it matches (always after Stage 3)

1. `npm run test:ui` against the frozen baselines: **zero differences.** If it fails, undo the change to the look. If a failure is only a tiny text-rendering difference on a different operating system, tell Yogi and show the diff image; don't update the baseline yourself.
2. **Live check** at 375px, in light and dark, with the real API: long values, nulls (must show as No data, never "0" or "null"), wrong dates, clipping. Live checks create a real anonymous household in the shared Supabase project; don't spam it, and don't run them against production data you don't own.
3. **Flow check:** tap every link, button, and sheet the spec lists for the page. Check navigation in and out, and that Back closes a sheet before leaving the page.
4. **Element check:** go through `docs/[page]/README.md` line by line. Every element is present and bound to its real field.
5. `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` all pass.
6. **Report:** tests result, live screenshots, anything that differs with real data and why, backend gaps (Part D fields missing or null in the live response), anything you asked Yogi under §6.

Then commit `feat: [page] working`, push, and open a PR from `page/[page]` to `main`. Never push to `main` directly.

---

## 8. Changing an approved design later

Only when Yogi asks: change the screen or shared component → if a **shared** piece changed, run every page's visual test and show Yogi the difference images before touching any baseline → regenerate only the affected baselines → update `docs/[page]/README.md` → commit `wireframe: [page] revised: [what changed]`.

---

## 9. Phase 0: the Foundation, before any page branch

**Nothing else starts until this is merged**, wireframes included, because the shared components must be frozen first or three pages will invent three versions. One account does it (the owner Yogi names), on branch `foundation/phase-0`, merged to `main` through a PR. The full list is **spec Part P2 and P3**. In short:

1. **Reusable data client:** `haloRequest<T>(path, { method, body, signal, timeoutMs })` extracted from `createLiveOnboardingApi` (same behavior, same deadlines, same tests), the generic `useHaloData<T>` with `refresh({ fresh })`, the new error codes, and the timeout table.
2. **App shell:** an `app/(app)/layout.tsx` route group that renders `.halo-app` once with the header (gear; bell on Today), the five-tab bar (Home label on `/home`), the offline banner, the Assistant button (hidden when `NEXT_PUBLIC_HALO_ASSISTANT=off`), the sheet host and the toast host; a guard that sends an incomplete profile to onboarding; `app/not-found.tsx`.
3. **Sheets contract:** `lib/frontend/sheets.ts` with `openLearn`, `openAlerts`, `openAssistant`, `closeSheet`, the history rules, and labeled development placeholders until those sheets exist.
4. **Shared UI, frozen:** every component listed in Part P2, extracted from Onboarding or built in its look.
5. **Modules:** `text.ts` (`displayText`, `contaminantLabel`, `normalizeSeverity`, `isOutsideNC`), `format.ts` (dates in America/New_York, numbers, utility names), the U+2014 lint test, `useProfile()`.
6. **Scaffolding for each page:** empty copy files, type files, css files, preview routes, and the icon set. Tokens moved to `:root, .halo-app`; fonts (Plex Mono) added.

---

## 10. Rules that keep every account's pages one app

- Shared components live in one place and every page uses them. Never copy one into a page folder to tweak it.
- A change to a shared component affects every page: make it in its own small commit, tell Yogi, and merge it first.
- Pull `main` at the start of every session.
- Tokens only. One icon family. No new packages without asking Yogi.
- No fake phone frame or status bar, no glassmorphism, no emoji, no exclamation marks, never "safe" or "unsafe" as a verdict, no gradients except Today's time-of-day hero and Onboarding's Welcome band.
- **The spec wins on function and copy. The frozen baselines win on look. This file wins over both where they conflict.**

---

## 11. Kickoff prompts (Yogi pastes these)

**Phase 0 owner's account (first, alone)**
> Read AGENTS.md, docs/WIREFRAME_WORKFLOW.md, docs/onboarding/README.md, and Part P, Part A and Part D of the Frontend Specification PDF. Then do Phase 0 exactly as Part P2 and P3 list it, on branch foundation/phase-0. Keep Onboarding looking and testing exactly as it does now (its screenshots must still pass). Don't build any page. When done, report what you built, the tests, and anything in Part P that was wrong or unclear.

**Yogi's account: Today (then Journal, then Settings)**
> Read AGENTS.md, docs/WIREFRAME_WORKFLOW.md, docs/onboarding/README.md, and Part P of the Frontend Specification PDF. Then wireframe the **Today** page (Part B2) following Stage 1: `/today/preview` with mock scenarios for every state, in the same look as Onboarding, using the shared components from Phase 0. Use my reference screenshots for structure only. Show me every state in light and dark and the element-table check. Don't build the live version until I say "Build Today".

**Naggi's account: HomeGuard + Learn (then Act + Alerts)** (same prompt, with `HomeGuard (B3) and the Learn sheet (C1)`)

**Vibhav's account: Map + District (then Assistant)** (same prompt, with `Map (B7, including the District panel)`). His backend wrap-up items come first.

**Any account, when a page is approved:** *"Approved. Freeze it (Stage 2)."* Then, later: *"Build [page] (Stage 3 and 4)."*

---

## 12. Open items (for awareness)

- **Nine decisions with default rules** are in spec Part P10 (D1 to D9): who owns Phase 0, Change address household step, dark-only, Assistant household data, content owner, season summary target, map library, device notifications timing, volunteer verification. Builders use the stated default until Yogi decides.
- **Onboarding went straight to `main`** in one commit (no PR). From now on every change goes through a PR from a branch.
- **Vibhav should review** the `lib/auth.js` rewrite in the Onboarding commit (tests pass; it changes session behavior).
- **Backend asks for Vibhav** are in spec Part P9 (nine items, each with a frontend fallback). Already fixed since Onboarding: the daily cache is cleared when the address changes, the address save can be confirmed with `request_id`, and HomeGuard has `assembled_at`. Still needed: keep `exceeds_limit` and `is_enforceable` on every scored compound; migrations 0009 to 0014 and the Vercel environment variables (his wrap-up checklist).
- **Next.js 16.2.10 has security advisories** (`npm audit --omit=dev`: 1 critical, 3 high, 1 moderate; the fix is 16.3.6). Yogi and Vibhav decide when to upgrade. Don't do it inside a page branch.
