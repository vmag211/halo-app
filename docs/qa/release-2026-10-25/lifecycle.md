# Release test: data lifecycle (2026-10-25)

Area `lifecycle`, branch `vmag211/release-lifecycle`. Tested against production
(https://halo-app-topaz.vercel.app, `origin/main` at `d02141f`) with three anonymous households created
through onboarding: A (27601), B (28202), C (98101, outside coverage). Every record was named
"QA release ...". Images were synthetic, made with `sharp` (EXIF GPS, camera make, model, lens, artist,
date and XMP creator); no real photo was used. Scripts and screenshots are in the session scratchpad, not
the repo.

`GET /api/frontend/capabilities` on production: tasks, workspace, attachments, summaries, projects,
outreach, participation and luna on; recovery off. The journal flag is on too (`weekJournal` answers
`ready`).

## Results

| # | Check | How tested | Result | Evidence |
|---|---|---|---|---|
| 1 | Export: Saved tasks, without private text | Settings > Privacy & data > Review export > Download (UI), A | pass | 3 tasks; `meta.note` (the preparation note) and `history` left out; titles kept |
| 2 | Export: Saved tasks, with private text | API inspect + `POST /api/privacy/exports`, A | pass | `meta.note` "QA release PRIVATE-PREP-NOTE-A" present |
| 3 | Export: Explore records, with and without private text | UI, A | pass | with: note title and text, the project guide, idea set; without: ids, revisions, dates and attachment metadata only; never file bytes |
| 4 | Export: Journal check-ins, with and without private text | UI, A | pass | with: both check-ins, symptoms, severity, notes; without: dates and flags only |
| 5 | Export: Luna conversation (with private text) | UI, A | pass | conversation, 4 turns, 2 runs and the pending proposal (kind, payload, expiry); without private text the group is empty, as designed |
| 6 | Export: Home records (with or without private text) | UI and API, A, B and C | **fail-open** | `POST /api/privacy/export/inspect` answers 500 for any selection containing `home` |
| 7 | Export: Preferences | UI and API, A | **fail-open** | same 500 for any selection containing `preferences` |
| 8 | Export: all six groups | UI, A | **fail-open** | 500 (it includes home) |
| 9 | Export holds no other household's data | A's exports scanned for B's strings; B's exports for A's | pass | no "B" record text in A's files, and none of A's in B's |
| 10 | Inspect 500 message | UI | fail-fixed | inspect writes nothing, but the panel said "The result is not confirmed. Check its status before trying again." with nothing to check; now "The review could not be prepared. Nothing was changed. Try again." |
| 11 | Review count grammar | UI | fail-fixed | "1 records in this review." is now "1 record in this review." |
| 12 | Task delete, with safeguard | UI, A and B, then reload and `GET /api/frontend/actions` | pass | "Delete this task?" > "Yes, delete"; gone after reload and from the API and the next export. No Undo is offered for tasks (a confirm dialog is used instead) |
| 13 | Journal remove, with safeguard and Undo | UI, A (remove) and B (remove then Undo) | pass | "Delete this check-in?" with "No, keep it"; "Undo delete" restores the entry with its note (B); A's stays gone after reload and in the API |
| 14 | Clear Journal | Settings, A and B | pass | review lists what is kept; `weekJournal` and `GET /api/journal` empty afterwards; second export shows `symptom_logs: 0` |
| 15 | Clear Luna conversation (removes proposals) | Luna panel > New conversation > Clear conversation, A and B | pass | `GET /api/luna/conversations` has no messages; second export `luna_turns: 0`, `luna_runs: 0`, `luna_proposals: 0` |
| 16 | Settings privacy "clear all" | UI and API, A, B and C | **fail-open (release blocker)** | the clear-all review (`privacy.inspect` scope `all`) answers 500 for every household, so nothing can be cleared; the panel showed the misleading message fixed in row 10 |
| 17 | Login still works after clears | API reads with the same session after Clear Journal and the Luna clear | pass | not testable after clear all (row 16) |
| 18 | Account deletion | searched the UI and frontend code | not offered | there is no account deletion in the app; several retention rulings mention it |
| 19 | Attachments flag | capabilities route | pass | on |
| 20 | JPEG with EXIF GPS and camera tags, then download | `POST /api/attachments` (tests), download, `sharp().metadata()` and a byte scan; also through the UI and "Download private original" | pass | back as JPEG 640x480 with no EXIF, XMP, IPTC or ICC and none of the planted strings |
| 21 | PNG and WebP with metadata | same | pass | both stored and returned clean |
| 22 | PDF and HEIC refused | API | pass | 422 "Choose a JPEG, PNG or WebP image." |
| 23 | Oversize refused | API, 7.1 MB and 14.6 MB JPEGs | pass (by the platform) | Vercel answers 413 `FUNCTION_PAYLOAD_TOO_LARGE` (text/plain) before the route; the route's own 10 MiB limit is never reached in production |
| 24 | Report upload screen offers what the server stores | UI | fail-fixed | it offered PDF ("PNG, JPEG or PDF, up to 10 MiB"), refused WebP locally, and a 4.5 to 10 MiB file reached the platform 413 and was shown as "This service is unavailable. Try again later."; now JPEG, PNG or WebP up to 4 MB, checked before upload, with a plain refusal |
| 25 | Observation photo size | code review | fail-fixed | the processed copy was allowed up to 5 MB, over the 4.5 MB platform body limit; now capped at 4 MiB with the existing "processed copy is too large" message |
| 26 | Storing a report from the results form, then saving results | UI, B | fail-fixed | the upload raises the test's revision (B14 A7), so the form's own save was refused: "This record changed. Your draft is kept."; the draft now follows its own upload or removal step |
| 27 | Remove a stored report | UI, A, then download by id | pass | "Private file removed. Entered results remain."; download answers 404 |
| 28 | Isolation: another household's file or summary | B reads A's attachment (download, inspect) and summary detail | pass | 404 each |
| 29 | Household summary with every section and option | UI, A; PDF text via `pdftotext` | pass | Today 76 and Homeguard 50, AQI 36, UV 0.3, weed pollen 2, mold estimate, PFAS (UCMR 5, sampled Mar 19, 2024), radon Zone 2, lead no data: all match Today and Homeguard; test, actions, empty sections, location, appendix and attachment count present |
| 30 | A section that cannot be included says so before generation | UI, C (98101: no Homeguard score) and empty record sections | fail-fixed | empty record sections said "0 records" / "No records yet. This section will say so." but an unavailable score was only revealed in the PDF; the contents list now says "Homeguard score unavailable" before generation |
| 31 | Print and share | UI | pass | Download PDF, Open PDF (new tab, the browser's print) and Share PDF; with a stubbed share sheet the PDF file is handed over and a cancel says so; the real share sheet needs a device. No dedicated print button is offered |
| 32 | Calendar file (.ics) | task sheet > Export to calendar, timed and all-day tasks | pass | one VEVENT each, CRLF, `DTSTART:20261026T140000Z` (10:00 EDT) with a 60-minute end; all-day `DTSTART;VALUE=DATE:20261027`, `DTEND;VALUE=DATE:20261028`; no preparation note |
| 33 | Test record JSON export | Homeguard test > Export this record | fail-fixed | a real production record was exported as `"format": "HALO synthetic test review"`, `"synthetic": true` and "Synthetic wireframe record."; production now writes "HALO test record", `synthetic: false` |
| 34 | Alerts read, dismiss, Undo, reload | `GET /api/alerts` for A, B and C | not testable here | no alerts exist; they are created only by the daily cron (`/api/cron/daily`), whose first run per household records a baseline; a household needs a later meaningful air change or an active NWS advisory at its point |
| 35 | Notification permission, granted and denied | Playwright with the permission granted and cleared, Settings > Alerts & reminders > Review device setup | not testable here | "Enable device notifications" stays disabled because the device registration read answers 503 ("This is not available yet."), so the browser prompt is never reached in either state |
| 36 | Nothing claims push delivery for task reminders | Settings and the task sheet | pass | "Requested on your tasks. Delivery is not connected."; the task reminder status says scheduling and delivery are not confirmed |

## Fixed on this branch

- `lib/frontend/home-test-preview.ts`, `components/homeguard/TestsWorkspace.tsx`: the production record
  export is no longer labelled synthetic (test in `test/frontend-home-tests.test.mjs`).
- `lib/frontend/note-photo-preview.ts`, `components/homeguard/PrivateAttachments.tsx`: the report picker
  accepts JPEG, PNG and WebP up to 4 MB (the platform limit), checked before upload; the processed
  observation photo is capped at the same size (`test/frontend-note-photo.test.mjs`,
  `test/ui/production-report-attachment.spec.ts`).
- `components/homeguard/PrivateAttachments.tsx`, `TestsWorkspace.tsx`: a report stored or removed from
  the results form moves that form's base revision by the one step it caused, only when the draft was
  based on the revision before it (`test/ui/production-report-attachment.spec.ts`).
- `components/homeguard/SummaryWorkspace.tsx`: the contents list names an unavailable score before
  generation (`test/ui/production-report-attachment.spec.ts`).
- `components/production/ProductionPrivacy.tsx`: singular count; a failed review is not presented as an
  outcome to check (`test/ui/production-privacy.spec.ts`, `test/contractsB07.test.mjs`).
- Transcriptions updated: `test/helpers/frontendB07.mjs` (the inspect line).

## Open

1. **Clear all, and the Home and Preferences exports, answer 500 on production for every household**
   (release blocker; needs Vibhav and probably a migration). Every failing selection reads `profiles`
   through `privacy_fingerprint` (and clear all also through `privacy_counts('all')`); every passing one
   does not. Those 0024 functions name `profiles.address`, `zip`, `pwsid`, `build_year` and
   `onboard_request_id`, which plpgsql only checks at run time, and `verify-0024` checks only that no
   *extra* column exists. Likeliest cause: a column they name, most likely `address`, is missing on the
   deployed table. To confirm, in the SQL editor:
   `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'profiles' order by 1;`
   then `select public.privacy_fingerprint('<a QA household id>'::uuid, array['profiles']);`.
   Not built here: the fix is a migration or a function change in 0024's area.
2. Account deletion is not offered anywhere (product decision; retention rulings refer to it).
3. Luna shows an expired review with an enabled "Confirm changes"; confirming is refused safely ("This
   review expired. Ask Luna to prepare it again."). Luna area.
4. The exported `luna_turns.seq` is a global identity, so a new household's first turn shows how many
   turns all households have made (69 here). Low; an export or contract change.
5. The summary PDF prints the internal home id ("Sample context: d890...") under Location labels, in both
   the client preview and `lib/summaryStore.js`; the screen shows "Current home". Low; the two copies are
   pinned to each other by `test/summaryCompose.test.mjs`.
6. Once: Settings showed "Request cancelled. Settings could not load." (a 20 s client timeout) on the
   first load; a retry worked.

## Test records kept

Clear all cannot run (open item 1), so all three households remain, to reproduce it. They were emptied
of what the app can remove one by one: tasks, test records (with their files), Journal and the Luna
conversation. Left: A (27601) its Explore note with photo, started project, idea set, three saved summaries
and display preferences; B (28202) its home and one unlinked staged note photo (expires after 24 hours);
C (98101) its home and one saved summary. Saved summaries have no delete route (S15-4).
