# Account, home transition and Learn wireframe completion

October 12, 2026. All new service responses are isolated frontend examples selected outside the product screens. No provider, permission prompt, email, session creation or account mutation is called by these components.

## Consumer paths

- Learn has a searchable seven-topic catalogue, six data-meaning glossary entries, a factor filter, no-match/empty/loading/error/retry, current factor-guide destinations and dated primary-source links. Public mode omits personalized factor links and household context.
- Public browsing opens from the onboarding preview and incomplete-home gate. Learn and the public Map need no address. Setup returns to the existing onboarding preview; completion has an explicit My Week entrance. Recovery entry does not reveal whether an email has an account, list devices or unlock private content before an externally selected verified response.
- Home change validates a city or ZIP, reviews the coarse result and unknown utility match, then reviews the consequences and selected personal-task links. Source-bound tasks are ineligible. All tasks remain in My Week; chosen personal tasks also appear as exact-ID links in that home’s history. Existing unsaved home details must be saved or cancelled first.
- The home-change commit checks the captured collection/action/follow/settings fingerprint again at the actual delayed write. It preserves the prior home profile, clears inherited building/water/tenure facts, retains historical records, and tags later household records with the current home ID. Past untagged records belong to the original home. No original-home reading, map pin/utility/rank/distance, generated-project reason, forecast or environmental history becomes new-home evidence. Public atlas records and previously saved projects/tasks remain accessible.
- Recovery enrollment validates an email, distinguishes request/pending/verified, retains failed inputs, masks verified addresses, and requires confirmation for method removal or another device’s revocation. Removal is not deletion of records. Verification and destructive decisions check current revision. Denied, expired, collision, unavailable, unknown, failure and offline states do not grant access or merge households.
- Device setup distinguishes browser permission, device registration and final confirmation. Cancel leaves the device unregistered. Unsupported/denied/expired/failure states retain in-app alerts. Turning off a device does not delete inbox history or saved reminders.
- Email and calendar connections show their limited scopes, authorization pending, explicit verification and reversible disconnect. Disconnect does not recall emails or erase existing provider events. The frontend does not infer free/busy, read an inbox or send anything.
- Service work is cancelable, ignored after unmount, checked against offline/scenario changes, and never automatically retried after an unknown outcome. External reconciliation examples are not real operation ledgers.
- Home-change authorization remains active through the nested delayed record write, not only the initial lookup timer. Leaving its screen during that interval cancels the write and retains the prior profile and entered area. Readable and exported evidence appendices share the same missing/current-home guard.
- Final regression repairs preserve keyboard focus on scrollable tables during route entry, return focus to a surviving heading after confirmed list deletion, and keep general family guidance under Today while household-specific guides remain under Homeguard. Cancelled deletion still returns to the original control.

## Privacy and shared data corrections

Generic JSON export always excludes exact locations and image contents, including the old moisture `photoData` fields. Selected task export includes only current owned task keys and their calendar/history metadata; private preparation and notes require the existing private-text opt-in. Conversation export remains separate.

An unresolved Luna action blocks both conversation clearing and all-data clearing at preparation, confirmation and commit. A user must return to Luna and check the operation status before erasing its only outcome record. Completed source records are never deleted by deleting a task.

Household summary uses the shared score selector for zero/partial/missing states and reports current-home data unavailable after a move, including factor details and the evidence appendix. Explicitly chosen historical records can still be exported; they retain their dates and context. Moisture-photo selection now uses the same bounded metadata-free PNG preparation as field notes rather than retaining original image bytes.

## Backend contract boundary

Production needs authenticated identity continuity without accidental replacement, verified recovery challenges with expiration/replay and collision handling, per-device sessions and revocation, coarse/exact location contracts and utility-association correction, transactionally versioned home changes and historic context IDs, role/capability checks, idempotent request ledgers and unknown-outcome reconciliation, OAuth state/token security and precise scopes, notification permission/subscription acknowledgment and server delivery state. Current JavaScript state or the `access=public` query flag is never security enforcement.

Live onboarding remains behind the existing API/auth boundary. The new hosted onboarding route injects the existing mock API; the static review adds no production route or authentication initialization. Source/operator, legal/privacy, multilingual content and physical-device acceptance require their own review.

## Evidence

`test/frontend-account-review.test.mjs` covers input validation, masking, eligible personal tasks, owned metadata export and unconditional image/location exclusion. `test/ui/completion-workflows.spec.ts` covers Learn, home review/cancel/history, inherited-data isolation, exact task links, recovery and provider decisions, device subscription distinctions, public Map return, public recovery, onboarding public access, and 320px/150% layouts in both themes. See the final completion receipt for the actual aggregate execution results, not merely this test inventory.
