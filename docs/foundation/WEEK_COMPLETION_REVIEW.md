# P03, P05 and P06 wireframe completion

October 13, 2026. Editable expanded review only. This does not approve a screen, replace an archive, connect a provider, or establish production readiness.

## Review entry points

- My Week > Plan outdoors (`destination=outdoors`).
- My Week > Journal & Patterns > Patterns or Season (`destination=patterns`, `destination=recap`).
- The external Expanded app review controls select historical/forecast scenarios. The product defaults remain unavailable. `Load illustrative check-ins and history` deliberately writes dated example entries into the same visit-local Journal collection, preserves existing entries, and reports saved/kept/failed counts.
- Example environmental readings have explicit illustrative provenance, source versions, measurement basis, issue timestamps and missing-day reasons. They are never fallback production values or actual health/environmental observations.
- Changing home suppresses the original-home history/forecast fixtures and disables their review selectors. Existing Journal entries and historical owned records are retained, not reinterpreted as evidence for the new home. Seasonal current-home report joins follow the new canonical home ID.

## Outdoor planning, P03

The retained activity/place/date/duration form now supports optional household category, comparison selection, morning/afternoon/evening period details, per-factor missing values, UTC valid periods, source/issue/expiry/horizon disclosure and daily pollen categories. Daily categories are not interpolated into hourly measurements. The UI compares tradeoffs without a composite safety rating.

Review scenarios cover unavailable, current, partial, changed, expired, loading and error. An expired forecast cannot be used for a forecast-based save until refreshed. A changed forecast must be reviewed explicitly. This never moves an existing task. Far-future plans retain no-forecast coverage and can deliberately save a separate forecast-check action. Loading can be cancelled; failures and offline saves retain the draft.

Selected preparation and watch intent stay with the existing visit-local planning metadata. Watches remain unactivated; live warnings open official resources, not an invented alert. The same canonical action is reused. Updates show a before/after confirmation and reject action revision or metadata conflicts. Task details open the exact saved action. No registration, GPS, address change, exposure estimate, calendar sync or notification job is created.

## Patterns, P05

- Twelve-week grid and accessible dated list, explicit logged/fine/unlogged states and a separate missing-reading indicator.
- Actual group/factor/4-week or 12-week analysis selection, selected-day reading and canonical Journal editing.
- Numeric factor chart plus an equivalent dated table, source versions, measurement basis, missing reasons and source timestamps. Pollen remains categorical; outdoor mold remains unavailable when no compatible series exists.
- Separate logged, environmental-history and comparable-day counts. Same-date joins require compatible current-home daily maxima, matching source version, explicit same-day logging, and no possible-illness flag. Recalled, illness, missing and changed-basis counts remain visible; exclusions can overlap.
- Descriptive mean/count bars only when at least three explicit symptom and three explicit fine days are compatible. The threshold is a review heuristic, not clinical validation. Insufficient and no-clear-difference states are independently reachable. No causal or diagnostic conclusion is generated.
- Scoped range/group/factor JSON export excludes every private Journal note. Clearing Journal removes loaded example entries through the existing privacy flow. Exported files cannot be revoked.

## Seasonal recap, P06

Season/year/group/factor selectors expose elapsed-season logging and environmental coverage, compatible trends, missing coverage and measurement-basis exclusions. The historical adapter only supplies its actual twelve-week range; it does not pretend to cover earlier seasonal dates.

Follow-through comes from the current owned preview stores, never invented activity totals: completed actions use known `completedOn`; pending actions use chosen dates; current-home test reports use their actual report dates; participation uses explicit user-recorded participation dates and relevant statuses. Unknown completion/participation dates remain exclusions. Historical report dates are not deadlines, and counts do not imply measured benefit. Every shown source record/task links to its actual detail workflow.

The selected season has a separately dismissible prompt and one deduplicated, deliberately saved next-review action. The export includes the selected period, counts, source rows and concise activity references, not private Journal notes, descriptions, report values or preparation text.

## Exact task continuity

My Week accepts `weekTask=<canonical ID>` for owned task links and the consumed visit-local `week:open-task` request used by Luna. Missing/deleted IDs show an unavailable notice rather than creating a task. An active editor is never replaced by a receipt; the request waits until it is closed. Closing a detail does not reopen it repeatedly.

## Private observation photograph, A06

The formerly missing optional photo flow now lives in Explore's private note editor, not Journal. It accepts JPEG/PNG/WebP up to 5 MB, verifies the file signature, rejects decode failures/oversized dimensions, resizes to at most1600px and creates a new PNG from decoded pixels. The original filename and embedded camera/location metadata are not retained in that derivative. Source object URLs are revoked on completion/failure/cancel; unmounted/replaced requests cannot apply their results.

The user previews the processed image and explicitly consents before attaching it. A pending/unreviewed selection cannot be silently included when saving the note. Replacement, discard, removal and undo are supported. Save/edit/pin and Luna text-only edits preserve the note's existing attachment; deleting the note or clearing all data removes its visit-local image with the rest of that owned record.

Default note text and generic privacy JSON exports omit images. A separate photo-export review discloses exactly what leaves, requires consent and downloads only the sanitized PNG under a generated neutral filename. Visible faces, addresses, signs and landmarks are not magically removed; the preview explicitly requires reviewing those details. The download is not agency submission and cannot be revoked. There is no cloud upload, server file retention, automated image interpretation, photo-to-Luna context or shared-map publication.

Backend integration still needs owned private attachment storage, independent server-side file validation/re-encoding, authorization, quotas, retention, deletion and explicit attachment-send scopes. Client-only re-encoding is not a server security boundary.

## Observation handoff and archive, A06

The handoff disclosure now distinguishes private draft, deliberately prepared copy, official-link opening and user-reported external submission. Preparing a copy requires reviewing the selected fields; optional place and public context are off by default. Photos and exact coordinates are never included. The prepared text is frozen with its source note revision, scope and exact ISO timestamp. Later note edits show a changed-copy notice and never silently rewrite an earlier export. Preparing again retains the earlier copy and its history.

Successful clipboard/device-share actions and requested downloads/print previews are separately recorded against the exact prepared copy. Device share-sheet completion is not recipient delivery. The official EPA contact link receives no private note data; the local opened state cannot verify remote loading or submission. Reporting a submission requires an explicit user statement and supports an optional user-provided reference. No agency acknowledgment or verified receipt is synthesized. Existing case updates and canonical My Week follow-up continue to support replies and next steps.

Notes can be archived, filtered as Active/Archived/All, and restored without losing photos, prepared copies or case history. Archiving does not delete saved tasks. Deletion/all-data clearing removes the owned note and all its contained snapshots/photos. Already copied, downloaded or externally submitted content cannot be revoked. The production handoff still needs authorized immutable snapshot storage, consent/retention semantics, real jurisdiction matching and a verified agency response contract if acknowledgment is ever shown.

## Backend contract boundaries

Vibhav still needs a normalized source-backed forecast service with geography, source-specific resolution/horizon/issue/expiry/version, supported uncertainty and alerts; durable outdoor plans, preparation and opt-in watch lifecycle; authorized canonical action plus metadata transactions; and changed-source acknowledgment bound to evidence versions. The illustrative times do not establish any provider's real geography or reliability.

Patterns needs expert-reviewed, versioned descriptive analysis, actual same-home dated histories, logging/basis/backfill semantics, authoritative first-use state, sufficient counts, out-of-range history handling and private export/deletion contracts. The current deterministic review threshold is not a validated medical finding method. Season needs paginated owned-record joins and complete cross-year coverage. Group records must never become individual exposure/health profiles. No backend/API/database/production route or live assistant context was changed here.

## Validation

- Thirteen new domain tests pass: eight history/forecast/season tests, two raster file-type/signature/size tests and three handoff scope/version/state tests. TypeScript passes and the owned components/helpers pass targeted ESLint with no warnings.
- The final stable static snapshot passed all eleven new week-evidence browser cases. These cover populated/default/no-pattern/sparse/missing/changed/loading/error states, explicit confirmation, far-future planning, retained offline inputs, exact task links, real completion-date aggregation, private-note export exclusion, and 320px enlarged-light/430px dark layouts. All ten existing My Week cases passed against the earlier stable snapshot; the subsequent A06 work does not modify its task/editor/calendar implementation.
- All eight new photo/handoff browser cases and four existing Explore note/share regressions passed on the final snapshot: metadata-free derivative export, consent, invalid/oversized inputs, remove/Undo/edit, frozen prepared versions, changed-copy notice, official-link versus explicit user submission, archive/restore, offline retention, note failure/delete, case follow-up after deletion, public map context and share cancellation/blocked printing. Two initial test-locator failures were corrected (accessible textbox locator and row/Delete ambiguity) and rerun successfully without changing application source.
- Final 320px/150-percent photo/handoff and light/dark evidence screenshots were inspected. The outdoor headline width correction is present and verified. API/auth/provider requests are blocked in these tests. Final artifacts are in `test-results-week-photo-final` and `test-results-week-photo-final2`; the earlier My Week results are in `test-results-week-evidence-static`.
- Device Safari, assistive technology on physical devices, provider freshness, live persistence, clinical interpretation review and backend integration remain separate release gates.
