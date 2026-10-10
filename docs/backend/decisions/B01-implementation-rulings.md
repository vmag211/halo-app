# B01 implementation rulings and carried decisions

Saved 2026-10-10 so the handoff does not depend on git-ignored Claude session files. These are historical implementation choices, **not Vibhav's approval of recovery, retention, source rights, production migrations or release**. User/repository instructions take precedence. Tests demonstrate only the criteria recorded in the tracker.

## Claude's controller log

The entries below preserve every line labelled Ruling in `.superpowers/sdd/b01-baseline-private-identity/progress.md`, in original order. Execution counts, temporary TODO tests and scheduling comments are historical, not current status. In particular the 0007 replay issue was fixed during Task 7; GET/HEAD recovery remains while Task 10 now protects rejected writes. Current status is in the checkpoint.

1. Ruling: home_contexts shape defined from HO-066/HO-099 only (BE field tables not received) — cost if wrong: migration reshape later.

2. Ruling: deployed schema not auditable from here; reconstructed baseline + read-only audit SQL for Vibhav — cost if wrong: baseline drift until the audit result is diffed.

3. Ruling: B01 export isolation limited to existing routes; export job is B12 — cost if wrong: re-test in B12.

4. Ruling: revoke owner direct writes on profiles/symptom_logs/household_bands/notification_prefs (no client code writes tables directly; grep verified in session) — cost if wrong: a hidden direct-write client path would fail; T7 re-greps and stops if found.

5. Ruling: no em-dash scan of legacy API copy in B01 (existing strings with U+2014 remain; progress doc open finding 2) — cost if wrong: frontend must keep displayText stripping.

6. Ruling: tracker built in T11 from received spec only; unreceived sections tracked as blocked.

7. Task 3: parked (product decision) — push re-registration: a new identity on a device whose endpoint is held by an older identity gets {ok:true} but stores nothing (and old household's pushes keep going to that device). Ruling: keep no-takeover (spec HO-131) for B01; revisit with proof-of-possession (p256dh+auth match) when the push client lands (B03 delivery). Cost if wrong: silent push loss after identity replacement; no push client exists in the repo yet.

8. Task 4a: Ruling: accept implementer's unrequested home-guard `state` (2 letters) and `pwsid` (^[A-Z]{2}[0-9]{5,9}$ plus '', 'null', 'undefined') override validation — matches profiles.state and waterGeo PWSID_RE; no caller sends other shapes. Cost if wrong: a lowercase pwsid override is now 400 instead of 200 no-match.

9. Task 4b: Ruling: accept beyond-brief `unavailable` marker on profile GET and household GET (failed read otherwise looks like an empty household; additive). Accept volunteer 200->500 on failed profile read (without it every county's orgs are listed). Accept learn locale strictly en/es (es-MX now 400; no in-repo caller) — cost if wrong: a client sending navigator.language gets 400; leniency = primary subtag.

10. Task 5a: Ruling: household PUT with {} / empty / only renter_mode|locale still replaces composition with all false (brief-mandated omitted=false replace semantics); a separate partial-update contract is future work.

11. Task 6: Ruling: second dev dependency @electric-sql/pglite-pgvector@0.0.9 accepted (pglite 0.5.8 has no /vector subpath; nothing stubbed). Cost if wrong: an extra pinned dev dep.

12. Task 6: Ruling: re-apply of 0007 after 0013 fails (HNSW max 2000 dims vs vector(2048)); keep as `todo` test until Task 7, and Task 7 must guard 0007's index creation so a re-run after 0013 succeeds (idempotence is a global constraint), then drop the todo. Editing 0007 is safe because migrations are applied by hand once; only the guard changes. Cost if wrong: a touched historical migration file.

13. Task 6: Ruling (supersedes earlier todo ruling): pin the 0007-after-0013 replay failure with assert.rejects(/2000 dimensions/) instead of a todo (todo prints a failing block every run; output must be pristine); the pin fails the moment 0007 is guarded, forcing Task 7 to flip it to a success assertion. Cost if wrong: none material.

14. Task 8: Ruling: a move carries nothing over (a value the body leaves out is null at the new home and on the profile) — attributes like water_source/home_year belong to the old home and presenting them for the new one would be a false claim (spec: unknown is not a value). Cost if wrong: after a move the user must re-enter water source/home year (today's onboard route keeps the old answers). Task 9 must make the onboard route and frontend copy honest about it.

15. Task 8: Ruling: comparability(): a CLOSED legacy context reports `earlier_home` (not `legacy_assumed`); `legacy_assumed` only for the current legacy context. Keeps old-home readings out of the new home's history after a move. Cost if wrong: history UI labels differ for pre-move legacy rows.

16. Task 8: Ruling: a late retry carrying an older (closed) context's request id is a new request and can move the household back (controller dispatch rule). Cost if wrong: duplicate move on a stale retry; mitigated because request ids are per submission.

17. Task 8: Ruling: moved decision lives in SQL (compares stored point under the profile lock; SQL refuses unrounded points; JS roundCoord stays the only rounding), no p_moved flag; lock is FOR NO KEY UPDATE like 0015; FK daily_scores->home_contexts is ON DELETE NO ACTION (account delete cascades cleanly both orders).

18. Task 8: Ruling: Important 1 fixed in the RPC (option a): when there is no current context and the locked profile row has lat and lng, the RPC first inserts the legacy context from it (same columns as the migration backfill), then runs the normal move/in-place logic. Reason: removes deploy-order fragility between applying 0016 and Task 9. Cost if wrong: a little duplicated SQL.

19. Task 8: Ruling: accept implementer choices outside prior rulings: a move links all unlinked readings to the closing context before deleting today's rows; update_home_context_attributes accepts only water_source and home_year (widening is additive); legacy contexts copy onboard_request_id; a reading with no context reports legacy_assumed; extra codes HALO_CONTEXT_CLOSED and HALO_INVALID_INPUT; sync sets zip = null like the live route. Cost if wrong: widening/renaming later.

20. Task 8: fix round 1 implemented (commit da4e318; controller gate re-run: 1550 pass, 0 todo, typecheck clean, lint 0 errors/5 warnings; 28 mutants killed per implementer). Ruling: accept lazy path using the backfill's `lat is not null` condition (lat-only profile is a state no route writes; the two paths cannot disagree) and lazy insert only when the household has no context at all (closed-only households get a new 'onboard' context). Scoped re-review dispatched (sonnet), diff 4b6a29d..da4e318

21. Task 9a: Ruling: PATCH /api/home-contexts/[id] rejects unknown keys (400 unknown_field, including profile_id) although neighbouring routes ignore unknown keys: new endpoint, stricter is safer. Cost if wrong: a client sending extra keys gets 400.

22. Task 9a: Ruling: accept the profile PATCH race (located household with no context; concurrent move between the profile read and transition_home_context makes the PATCH move it back, logged, 200). Reasoning: window of milliseconds, only for households located by the old onboard route after 0016 and before 9b ships, a 409 would falsely say nothing was saved, the 200 body honestly shows the resulting profile. Cost if wrong: one household's concurrent move undone. Closing it needs either the literal legacy path (reverses the controller addendum) or a SQL ensure_home_context guard (new migration work); not worth it before merge.

23. Task 9a: Ruling: the single PGlite-backed route test (brief item 7) moves to 9b, using the harnessOnDatabase pattern from test/householdTransaction.test.mjs:229-244, covering the onboard transition and PATCH /api/home-contexts/[id] stale revision against the real functions.

24. Task 9b: Ruling (pending review): backfill with a context id counts only that home's readings (or unlinked ones) as existing days, otherwise a move's backfill adds nothing because the old home already has every day yet reports `complete`. Cost if wrong: one-line revert.

25. Task 9b: Ruling: the 9b review Minors 1, 2, 3, 6, 7 are carried into 9c's FIRST commit (cheaper than a resume cycle): (1) failed-bulk-read test never simulates a DB error (dailyWritesContext.test.mjs:192-205 stubs `is`, so lib/homeContextRpc.js:272 error branch is untested; surviving mutant makes a real DB error look like "0016 not applied" silently); (2) Mapbox non-numeric centre -> 404 noCoordinates(); (3) lib/backfill.js header: "never overwritten" holds per home only; (6) JSDoc: a stale `running` backfill_state is recognisable by backfill_updated_at; (7) on idempotent replay take top-level lat/lng/county/state from home_context. Deferred: (4) home-guard null pwsid after failed lookup may read as "no utility" (app/api/home-guard/route.js:451-462; consult current context service_area_status later, B-package for water); (5) isUndefinedColumnError exists in 4 copies (homeContextRpc.js:59, onboard/route.js:71, daily-score/route.js:38, backfill.js:126) -> export and reuse when next touched.

26. Task 9b: Ruling (design, for 9c): pooled readers that collapse to the newest row per date (rowsToHistory in lib/journalHistory.js via fetchHistory: journal summary, retrospective, assistant, cron alert inputs) would show the NEW home's modeled backfill row for pre-move days in place of the old home's real reading. Rule: the shared history helper becomes context-bound by default (current context + unlinked/legacy rows, same set as the findings rule in brief item 6), with an explicit all-contexts option used only by GET /api/history?context=all; 9c binds the pooled readers through it where that is a small change and lists any it leaves unbound in its report. Cost if wrong: pre-move days in journal/assistant show the new home's data (what the findings rule already mandates).

## Task 9c implementer choices

1. **`?context=all` collapses per date and home.** Per date alone would let the new home's modeled backfill rows replace the earlier home's real readings for the 28 pre-move days, so the break would appear 28 days before the move. The default and `<uuid>` scopes are still exactly one record per date. Within one date, points come in the order their readings were written. One line to revert (`latestPerDay`'s key; mutant M8 shows the tests that pin it).
2. **`excluded_earlier_home` counts daily records (per date and earlier home), not raw rows.** "History rows" in the brief are history records, and refreshes would otherwise inflate it. Pinned by mutant M14.
3. **`?context=<uuid>` returns only rows linked to that home.** Unlinked rows are "assumed current", not provably that home's. They appear in the default view and in `all`.
4. **`?context=<uuid>` before 0016 is a 503 `feature_unavailable`,** the same as 9a's detail route before 0016. A new parameter cannot be "as today", and there are no homes to choose. `context=all` before 0016 is the default history.
5. **The read is unscoped and the scope is applied in code.** I did not use a query `or()`. The limit and `truncated` are therefore literally unchanged (the household's rows in the range). The excluded count comes from the same read, and the rule is `comparability` itself. Cost: earlier-home rows count toward the 5000 limit, and `truncated` stays the conservative "rows were left out" signal.
6. **One commit for Part B.** Binding the shared helper by default binds findings in the same change, so a second commit "findings exclude ..." would have been only the additive count. The commit body says findings exclude earlier homes and report `excluded_earlier_home`.
7. **Replay location rule.** It applies whenever the saved home carries this request's id. For the request that saved it the values are identical to before, with one corner: the geocoder gives no state at the same home. The stored state is then answered (as `home_context` and the profile already say) instead of null.
8. **`context=ALL`** is accepted in any case, and an uppercase uuid is lowercased. Anything else, including `current`, is a 400.

## This continuation

- Task 10 follows the existing plan: only GET/HEAD may automatically replace/retry after 401; every other method returns the exact rejected response. The explicit recovery hook does not replay writes or restore an old household. The frontend confirmation UX remains Yogi's work.
- No retention duration or recovery option is selected. The privacy inventory reflects repository behaviour and the provider/configuration audit remains open.
- Contracts list actual handler responses: household PUT and onboarding currently do not emit 409. Stale/closed home PATCH uses the conflict envelope. Missing detail uses 404; empty is reserved for collections/full household replacement, rather than inventing an empty saved context.
- Review was performed in this session, not by an independent subagent. Current delegation instructions require explicit user or applicable agent/skill authorization, which was absent; the older plan's agent workflow is therefore not claimed as executed.
- Commits remain local pending a push instruction. No deployment, migration application or main merge occurred.
