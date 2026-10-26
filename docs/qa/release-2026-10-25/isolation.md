# Release test: isolation (2026-10-25)

Area: household data ownership and conflicting edits, on the live site
`https://halo-app-topaz.vercel.app` (`origin/main` at `d02141f`). All flags were on
(`/api/frontend/capabilities`: tasks, workspace, attachments, summaries, projects, outreach,
participation, luna; recovery off).

Two anonymous households were created through onboarding, both with public ZIPs only:

- **A**: ZIP 28027 (Cabarrus County), profile `cc88d71b...`
- **B**: ZIP 27601 (Raleigh), profile `2deb87f5...`

B's records were created in B's own session (a task, a water test, a Journal check-in, a private
Explore note, an observation with a photo, an Explore outcome, a saved summary, a Luna conversation
with a My Week review, a project idea set and two privacy review tokens). Every check against B
used B's real ids. Scripts and screenshots are in the session scratch folder, not the repository.

**Result: no isolation failure.** Every attempt by A on B's ids was refused or answered exactly as
for an id that does not exist, no response to A carried any of B's ids or text, and a full
re-read of B as B after all attempts was byte-identical to the read before them.

## Results

| Check | How tested | Result | Evidence |
| --- | --- | --- | --- |
| 1. Tasks: read, revise, delete B's task with A's token | `actions.load`; `actions.commit` revise (valid shape, B's id and revision) and delete | pass | Load returns only A's list. Revise: 200 `failed` `unknown_action`. Delete of a foreign id: 200 `succeeded` with A's own snapshot and nothing written (documented no-op). B's task unchanged. |
| 1. Workspace collections (tests, observations, exploreNotes, exploreOutcomes, weekJournal, and the other 10 collections) | `workspace.load` of all 15; `workspace.execute` write (update at B's revision) and remove of each of B's 5 records; `remove-notes` with B's note | pass | Loads return only A's rows (empty). Every update and remove: 200 `failed` `stale_revision`, nothing changed. Ids are per household: A writing a record with B's id as a new record creates A's own row and leaves B's untouched (primary key includes the owner). |
| 1. Home-owned record pointing at B's home | write an observation with `homeContextId` = B's home and B's `X-Halo-Home-Context` | pass | 200 `failed` `invalid_reference`. |
| 1. Attachments | `attachments.inspect`, `.download`, `.remove` with B's attachment id; upload onto B's observation id and B's test id | pass | Inspect and download: 404, identical to a random id. Remove: `failed` `not_found`. Upload onto B's test: 422 "Save the record before attaching". Upload onto B's observation id stages a file in A's own household (A can inspect it, B gets 404); B's observation unchanged. |
| 1. Summaries | `summary.read` with B's id; `summary.list`; `summary.prepare` selecting B's test, and naming B's home | pass | Read: 404, identical to a random id. Prepare with B's record: `failed` `changed` (same as a random id). With B's home: `failed` `home_changed`. |
| 1. Outreach drafts | `outreach.history`; `outreach.prepare` naming B's note | pass (route reached the area check, see note) | History holds only A's drafts (none). Prepare stopped at A's own area check (409 `area_changed`) before the notes; the note lookup reads `exploreNotes` by the caller's id only (`app/api/outreach/messages/prepare/route.js:115`). B had no draft, so `outreach.status` with B's draft id was not exercised. |
| 1. Luna conversations, runs and reviews | `luna.conversations`; `luna.run` with B's run id and clientMessageId; `luna.cancel` B's run; `luna.message` into B's conversation; `luna.clear` B's conversation; `luna.confirm`, `luna.proposal.edit`, `luna.proposal.cancel` and `luna.operation` with B's review id | pass | Own conversation only. Run status and cancel answer the same "could not finish" body as a random id. Message into B's conversation: 404. Clear: 409 `unknown_conversation`. Confirm and cancel: `failed` "This review is no longer available", identical to a random id; edit: 404. B's review still `review`, B's task unchanged. `noteContext` is validated and never read by the server, so a foreign note id cannot reach the model. |
| 1. Alerts state | `alerts.read`; `alerts.update` with an alert id that is not A's | pass (partly) | Read holds only A's (none). Update: 409 "These alerts changed". B had no alerts (alerts come from the daily job), so a real B alert id was not available. |
| 1. Settings | `settings.read` with B's home header | pass | A's own values. Identity comes from the token only. |
| 1. Privacy export and inspect | `privacy.exports` and `privacy.clear` with review tokens minted in B's session; A's own export searched for B's ids | pass | Both refused with 409 "Your data changed since you reviewed it" (the token's MAC binds the household). B's Journal intact. A's export (tasks, explore, journal, conversation) holds no B id or text. |
| 1. Operation status lookups | `GET /api/operations` with B's actions, workspace and summary operation ids | pass | 404 "That request was not found." each. |
| 1. Projects | `projects.generation` and `projects.cancel` with B's job id; generate with B's context key and with B's job id | pass | Status: "That request was not found", identical to a random id. Cancel records A's own cancellation (key is per household) and B's set is still `completed`. Generate with B's key: 400 "The context key is not this session's." |
| 1. Homes and legacy routes | `home-contexts/[B's home]` GET and PATCH; `history?context=B`; legacy `DELETE /api/journal?id=` with B's entry id; `POST /api/journal` and `PUT /api/household` with B's `profile_id` in the body; `daily-score?profile_id=B` | pass | 404 (identical to a random id), 404, `deleted: 0`, saved to A's own profile, changed A's own bands only, 403. B's journal entry and household bands unchanged. |
| 1. B unchanged afterwards | B's actions, five collections, summaries and summary detail, Luna conversation, attachment, home, journal, settings and profile read as B before and after | pass | No differences. |
| 2. No session | every method of every route file under `app/api` (103) with no Authorization header | pass | 401 on every owned route. Public: `/api/map` and `/api/district` 200, `/api/map/comparison` 400 (validation), recovery 400/503 (public by design). Cron routes 401 without the secret. |
| 2. Garbage, tampered and unsigned tokens | same routes with `not-a-token`; A's JWT with `sub` changed to B; A's JWT with `exp` extended a year; `alg: none` with `sub` = B | pass | Garbage, tampered and extended: 401 everywhere. `alg: none`: 403 from Vercel's edge before the app. |
| 2. Expired token | A's first access token (expired 23:11:56Z), used at 23:12:41Z on 9 owned reads and writes | pass | 401 "Your session has expired. Please reload the app." on every one. |
| 2. Another household's `X-Halo-Home-Context` | A's token with B's home id on 17 reads (evidence, profile, home-guard, history, home-contexts, daily-score, forecast, workspace, summaries, projects, journal findings and summary, assistant, settings, explore area, alerts) and on writes (summary, workspace, projects) | pass | Same body as without the header on every read except home-guard, which differs only in fresh readings and still describes A's county and utility; no B data anywhere. Writes refused as above. |
| 3. Same task on two devices | two browser contexts from A's storage state; both open the task, device 1 saves, device 2 saves from its stale copy | pass | Device 2: "This task's details changed since you opened them. Nothing was saved. Reload My Week to see the latest version." Both show device 1's title after refresh. A second Save on device 2 sends nothing. |
| 3. Same Journal check-in on two devices | both edit the note of one check-in | pass | Device 2: "This record changed. Your draft is kept. Review the latest version before saving." Server keeps device 1's note; both converge after refresh; a retry on device 2 sends nothing. |
| 3. Same Homeguard record on two devices | both edit a water test's details | pass | Device 2 refused with the same sentence; server keeps device 1's purpose; both converge. |
| 3. Delete on one device while editing on the other | task, Journal check-in and water test deleted on device 1, then saved on device 2 (UI); also observation and task at the API | pass | Task: refused ("details changed"); Journal and test: refused "This record changed"; the test screen then says "This test record is unavailable ... No other household record is substituted." Nothing is recreated; both devices show it gone after refresh. |
| 3. Luna review confirmed after the task changed elsewhere | API and UI: Luna prepares a move, device 2 renames the task, device 1 confirms | pass | 200 `failed` "This task changed since Luna prepared the review. Nothing was changed. Ask Luna to prepare it again." shown in the Luna footer; the task keeps device 2's change. |
| 4. Operations role | `/api/operator/sources`, `/history`, `/commands` with A's token; `/operations` in a browser as A and with no session | pass | Read: the contract's denied snapshot (`role: denied`, no sources). History and commands: 403 "Source operations require a verified operator role." Page as A: "Household access does not grant source permissions."; signed out: "A verified operator session is required." |
| 5. Public routes | `/api/map` (air, water, radon, facilities, default), `/api/district` with and without a session, `/map`, `/learn`, `/operations` HTML, searched for both households' ids, A's coordinates and "QA release" | pass | No household data in any public answer. `/api/district` adds `household_county` only for a signed-in caller, and only the caller's own county. The signed-in public-evidence reads (water notices, fish, food, growers) carry no household data either. |

## Found outside the isolation checks

| Issue | Severity | How found | Status |
| --- | --- | --- | --- |
| `POST /api/privacy/export/inspect` answers **500** for an export of the `home` or `preferences` group and for a **clear all** review, on brand-new households (A and B both). Tasks, explore, journal and conversation exports and Clear Journal work. Settings > Privacy & data > Clear all app records therefore shows "The result is not confirmed. Check its status before trying again.", and nobody can clear all or export their home. | P2 (privacy feature broken; no data exposed) | API and UI, request ids `40b6d51c-3f01-4226-8923-74e071778e0b`, `471e9f1d-d358-4b64-bcf2-d268ef67689f`, `4bd73093-d5a0-4746-bbcf-d2425b4f0214` | fail-open. The only table common to the three failing selections is `profiles`, read by `privacy_fingerprint` (0024) with `address`, `zip` and `build_year`, columns the reconstructed baseline assumed but no migration creates; the export also reads `build_year` without treating it as optional. 0024's pre-apply check only lists extra columns, never missing ones. Needs Vibhav to read the Vercel log for those request ids or run `select column_name from information_schema.columns where table_schema='public' and table_name='profiles' and column_name in ('address','zip','build_year');`. A missing column needs a migration or a 0024 change, so it is not built here. |
| The inspect failure is shown as an unknown outcome ("The result is not confirmed") although inspect writes nothing. | low | UI | open; follows from the 500 (a POST's 5xx is `unknown_outcome` in the runtime). |
| A Luna review stays confirmable after a stale refusal: the card keeps "Confirm changes" and pressing it again gets the same refusal. Reviews for a task deleted since are also still offered. | low | UI | open (product wording/state decision). |
| Luna asked "which date you meant" for "Wednesday October 28", although it understood "2026-10-30". | low | API | open, Luna area. |
| On a refused task save the sheet shows the server's sentence plus "The task changed or its save is unconfirmed... Check the save status before retrying.", which reads as an unknown outcome. | low | UI | open (copy). |

## Records kept

All QA release records of A and B were removed (tasks, workspace records, attachments, Journal
via Clear Journal, Luna conversations, household answers reset), except two in **B** that no route
can remove while clear all fails: the saved summary `0aee97c0-d5bb-4a89-8abe-a9ade4a979d4`
("Household review", quoting "QA release B water test") and the project idea set
`1574aff5-1861-4ca9-96d8-2df077cb19f5`. B also reproduces the clear-all 500. Both anonymous
households and their onboarding homes remain.

**Update 2026-10-25, after migration 0036 (PR #39, `profiles.address`):** home and preferences inspect and the clear-all review now answer 200 for A and B. Settings > Privacy & data > Clear all app records ran in the UI for both (`privacy.clear` `succeeded`, scope `all`). A second full export of all six groups for each holds no summary, no project set and no "QA release" text, and the summary and project reads are empty. No test records are kept.
