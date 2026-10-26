# Release tests 2026-10-25: bad networks and failing servers

Branch `vmag211/release-network`, from `origin/main` at `d02141f`. Live site: https://halo-app-topaz.vercel.app
(production flags on: tasks, workspace, attachments, summaries, journal, luna, Luna actions, projects, outreach,
participation; recovery off).

## How it was tested

- One throwaway anonymous household, onboarded with ZIP 28027 (Cabarrus County, NC). Every record was named
  "QA release ...". A second anonymous identity was created only by the cleared-token test (a reload after the
  token was removed signs in afresh); it never finished onboarding and holds no records.
- Playwright 1.62.1 (Chromium) drove the live app. Faults were simulated on the client only:
  `context.setOffline`, `page.route` (delay 8 s, `route.fetch()` then `abort('connectionreset')` for a dropped
  answer the server did receive, or `fulfill` with 500, 503 or truncated JSON so the server never saw the
  request), CDP slow 3G (2 s latency, 50 KB/s), double click and triple click (`clickCount: 3`), and edits of
  the stored Supabase session (cleared, corrupted signature, expired with a bad refresh token). Server state
  was checked with my own household's GET routes after each run and again after a reload. No load or stress:
  about 120 live runs, each one save.
- Fixes were verified against the isolated local production build (`scripts/stage-test-server.mjs`, all API
  and auth calls intercepted), not the live site, which still runs `main`.

## Bugs found and fixed

| # | Bug (live, before the fix) | Fix |
| --- | --- | --- |
| N1 | A save the server never recorded (an injected 500, 503 or malformed body, or a request lost on the way out) left its surface locked. "Check save status" read `operations.read`, got 404, and said "Could not check this save" / "This service is unavailable"; every later save on that surface was refused until a reload, and the reload dropped the draft. Seen live in My Week (create, complete, move, weekly review), the Homeguard workspace (tests, routines, notes, commitments, Journal), Settings and summaries. This is backend finding F7 (`YOUR_TODO.md` Part 4 item 17). | `FrontendServiceError` now carries the HTTP status, and `saveNotRecorded()` names a 404 status check. When the check finds no record of a save this page sent, it sends the same command again under the same operation id (every write route claims its id before changing anything and replays a claimed id, so this applies at most once). Done in `ExpandedPreviewState` (My Week), `HomeWorkspaceState` (workspace, Journal, notes, commitments), `ProductionPreferences` (Settings) and `useProductionSummary`. |
| N2 | A save made while the device knew it was offline was sent anyway and reported as "The result is not confirmed. Check its status before trying again." (summary prepare, project start, Luna message, Luna confirm, contact lookup). Screens that check `navigator.onLine` themselves were fine. | `runtime.request` refuses a mutation as `offline` ("You are offline. Your changes are still here.") before dispatch when `navigator.onLine === false`. |
| N3 | Journal showed "The result is not confirmed. Check its status before trying again." with no way to check: the Save button stayed disabled until a reload. | Journal renders "Check save status" for each unconfirmed save; once confirmed, the form shows the saved entry ("Check-in saved."). |
| N4 | Weekly review: an unconfirmed "Apply week plan" said "Check its save status", but the only check control was behind the modal sheet and could not be reached. | The planner sheet shows the shared status line and "Check save status". |
| N5 | My Week sheets (add/edit, delete, move) stayed open after a successful check, still showing "The task changed or its save is unconfirmed". On a recovered delete, pressing "Yes, delete" again locked My Week on an operation that was never sent. | The sheet closes once the check confirms the save ("Your change was saved."). The sheet's own fallback line is now neutral: "This task was not confirmed as saved. Your edits remain here." |
| N6 | A failed contact lookup (lost answer, 500) said "The result is not confirmed. Check its status before trying again.", but a lookup saves nothing and has no status. | "Contacts could not be found right now. Nothing was saved. Try again." (`lookupMessage` in `ProductionOutreach.tsx`). |
| N7 | When the profile and the readings both failed, the "Reconnect your profile" banner replaced the "Some readings are unavailable" notice, so stored readings showed only their timestamp, with nothing saying the refresh failed. | The banner keeps the readings sentence while a refresh has failed. |
| N8 | Pending saves in My Week (Save task, Save new schedule, Apply week plan) and the Journal were only greyed out. | They read "Saving..." with `aria-busy`, and Apply week plan is disabled while pending. |
| N9 | Settings: while a save was unconfirmed, "Save changes" stayed enabled and answered "Could not save. Your edits are kept. Try again." without sending anything. | It now says "Check the save status first. Your edits are kept." |

Regression tests: `test/ui/production-network-recovery.spec.ts` (8 tests: N1 for My Week, Homeguard and Settings,
N2 for summaries, N3, N4, N5, N7), `test/frontend-production-runtime.test.mjs` (N2 and the 404 distinction),
`test/routesActionsCommitDb.test.mjs` (N1 end to end over the real handlers and PGlite: a save lost before the
server is resent once under its id; a save that did reach the server is recovered and never resent; a late
duplicate replays), `test/routesOutreachDb.test.mjs` (N6). The B06 and B17 transcriptions
(`test/helpers/frontendB06.mjs`, `frontendB17.mjs`) follow the new code.

## Results

Result values: pass, fail-fixed, fail-open, not testable here.

| Save | Check | How tested | Result | Evidence |
| --- | --- | --- | --- | --- |
| My Week create | 1 offline | setOffline, Save task | pass | "Could not save. Your edits are kept. Check your connection and try again."; sheet and title kept; 0 tasks; saved once after reconnect |
| My Week create | 2 slow | +8 s delay; slow 3G | fail-fixed (N8) | button only greyed; now "Saving..." |
| My Week create | 3 drop | server got it, answer aborted | pass, fail-fixed (N5) | "The save outcome is not confirmed"; check recovered it; 1 task after reload; sheet left open before the fix |
| My Week create | 4 500 / malformed | fulfil 500, truncated JSON | fail-fixed (N1) | check got 404 and locked My Week until reload; 0 tasks |
| My Week create | 5 double, triple | dblclick, clickCount 3 | pass | 1 commit, 1 task after reload |
| My Week edit | 1, 5 | offline; dblclick | pass | edits kept offline; 1 revision (r2) after dblclick |
| My Week complete | 3, 4 | drop; 503 | pass; fail-fixed (N1) | drop recovered, r2 completed; 503 locked after 404 |
| My Week move | 3, 4 | drop; 503 | pass with N5; fail-fixed (N1) | date moved once (r2); sheet stayed open; 503 locked |
| My Week delete | 3, 5 | drop; triple | fail-fixed (N5); pass | deleted once; re-press after recovery locked My Week on an unsent id; triple deleted once |
| Weekly review batch move | 3, 4, 5 | drop; 500; dblclick | fail-fixed (N4, N1); pass | no reachable check in the sheet; one move (r3) on dblclick |
| Journal check-in | 1, 3, 5 | offline; drop; dblclick | pass; fail-fixed (N3); pass | offline refused, draft kept; drop saved but no check control; 1 entry on dblclick |
| Homeguard create test | 1, 2, 3, 4 | offline; delay; drop; 500 | pass; pass; pass; fail-fixed (N1) | "Saving" toast; drop recovered by check; 500 locked ("Save status is still unavailable ... Do not repeat the change") |
| Homeguard routine | 1, 3, 5 | offline; drop; dblclick | pass | refused offline; check recovered; 1 routine |
| Homeguard enter results | all | not driven separately | not testable here | same `workspace.execute` path as test plans and routines (covered by N1 fix and its UI test on a routine edit) |
| Summary prepare | 1 | setOffline | fail-fixed (N2) | sent anyway, "result is not confirmed"; check then failed |
| Summary prepare | 2, 3, 4, 5 | delay; drop; 500; dblclick | pass; pass; fail-fixed (N1); pass | "Preparing summary..."; drop: no duplicate (2 summaries before, 1 added) |
| Explore start project | 1 | setOffline | fail-fixed (N2) | "result is not confirmed" for a request that never left |
| Explore start project | 2, 3, 4, 5 | delay; drop; 500 and malformed; dbl and triple | pass | "Starting project..."; "Check project start" resends the same id; exactly 1 project each |
| Explore save note | 1, 3, 4, 5 | offline; drop; 500; triple | pass; pass; fail-fixed (N1); pass | 1 note on triple |
| Explore save commitment | 1, 3, 4, 5 | offline; drop; 503; dblclick | pass; pass; fail-fixed (N1); pass | 1 commitment on dblclick |
| Explore prepare outreach | all | contact page | not testable here | `outreach.prepare` needs a connected Gmail account and `outreach.connect` is always refused, so drafts stay local copy-and-share; nothing is saved |
| Explore contact lookup | 1, 4 | offline; 500 | fail-fixed (N2, N6) | misleading "Check its status"; retry worked |
| Settings save | 1, 2, 3 | offline; delay; drop | pass | "Offline. Reconnect to save. Your edits are kept."; `aria-busy`; check recovered (revision 3) |
| Settings save | 4 | 500, 503, malformed | fail-fixed (N1, N9) | check got 404 ("This service is unavailable"), Save then refused locally |
| Luna send message | 1 | setOffline | fail-fixed (N2) | sent and left as an unconfirmed request |
| Luna send message | 2, 3, 4, 5 | delay plus Cancel request; drop; 500; dblclick | pass | "Request stopped. Your question is kept."; no message stored; drop: check found it, 1 message; dblclick: 1 message |
| Luna confirm review | 1 | setOffline | fail-fixed (N2) | became "Check action status" |
| Luna confirm review | 3, 4, 5 | drop; 500; dblclick | pass | "Your confirmed changes are saved."; exactly 1 task each |
| All saves | 6 expired session | token corrupted, cleared, expired with a bad refresh token | fail-open (product decision) | "Please reconnect your session to continue."; the draft stays in the open sheet; there is no reconnect action in place; a reload shows "Let's reconnect" (corrupted) or starts a new empty anonymous household (cleared), so unsaved drafts and, for a lost token, the household are unreachable. Misleading second line fixed (N5) |
| Today readings | 7 | offline; 500 and malformed (profile OK); 500 with profile failing; slow 3G | pass; pass; fail-fixed (N7); pass | "Offline. Available readings keep their original dates."; "Some readings are unavailable. Previous readings keep their original dates."; reading time shown (for example "Oct 25, 7:15 PM EDT") |
| Homeguard readings | 7 | 500 and malformed | pass, with N7 | dated score shown with the failure notice |
| Map | 7 | 500; offline after load | pass; pass with a note | "This layer's data couldn't load." and Try again; offline keeps the loaded layer, labelled by sample dates ("Latest available samples"), with no offline notice on the public map |
| Forecast (Plan outdoors) | 7 | 500, malformed, offline | pass | "Forecast unavailable" for each period and Retry forecast; offline keeps "Issued Oct 25, 8:00 AM" under the offline banner |

Counts, by row (a row groups one save's checks, scored by its worst result): 33 rows, 11 pass, 19 fail-fixed,
1 fail-open, 2 not testable here.

## Open items (not fixed here)

1. Session loss on an anonymous account has no recovery: a cleared or unrecoverable token means a new empty
   household on reload. Needs Vibhav's decision on recovery or account linking (recovery is off).
2. "Please reconnect your session to continue." offers no action in place, and drafts live only in memory, so the
   reload it implies loses them. Needs a product decision on persisting drafts across reloads.
3. The public map shows no offline notice; the loaded layer stays visible, labelled only by its sample dates.
4. A summary recovered by "Check summary status" is listed under Saved summaries, but the screen stays on the
   setup form instead of opening the PDF preview.
5. Only Luna offers cancellation of an in-flight request; other saves have none (by design, not a regression).
6. "Enter results" on a test was not driven on its own (same path as the tested workspace writes).

## Test records

All QA records were removed with Settings, Privacy & data, Clear all app records ("Your records were cleared.";
tasks, workspace collections, summaries, project ideas and the Luna conversation then read empty). None were kept.

## Gates

`node --test test/*.test.mjs` 5,786 pass, 0 fail; `npm run typecheck` clean; `npm run lint` clean;
`git diff --check` clean. `test:production` against the local build: 479 pass (including the 8 new). Default UI
suite, My Week, Journal, Settings and summary specs (137): pass.
