# Expanded frontend alignment review

October 3, 2026. This revision aligns the existing HALO frontend with the expanded product plan without replacing its approved scenes, scorecards, factor content, household illustrations, Luna or onboarding. It is an additive design review, not implementation of all 45 planned features.

## Open the revision

October 11 connected Explore/Homeguard refinement supersedes the tab-heavy Explore and repeated Homeguard mini-dashboard presentation below. Explore has two primary action paths with an official-source local participation finder and five specific practical field guides. Notes and outreach are contextual utilities; selected-note Luna proposals, exact confirmed sample deletion and current-step guidance share existing memory providers. Homeguard has one compact overview workbench and a native destination selector, without losing content. Weather-style irregular record contours extend to air monitor locations, with optional illustrative motion and explicit no-forecast boundaries. Read [current Explore coverage](EXPLORE_REVIEW.md), [missing backend contracts](EXPLORE_BACKEND_DELTA.md) and `docs/map/README.md`. All changes are editable review-only and preserve the approved archives.

October 9 Explore stage: the visible labels are Explore and My Week. Internal keys remain `act` and `plan`. Explore's former outlines now open rough interactive organization/opportunity/project/outreach/field-note screens. Read [Explore review coverage and limits](EXPLORE_REVIEW.md). The map retains its sample renderer; private drafts remain in memory and shared actions reuse My Week. The latest hosted metadata is in `docs/continuation/HOSTED_REVIEW.md`.

October 9 Homeguard overview refinement: the former four-link footer is now an open Home workspace with distinct test milestones, maintenance entries, illustrated Food and Garden entrances and a document-style summary. Its counts, test continuation, next scheduled routine, recent observation and garden continuation read the existing in-memory collections. Loading/error states suppress record counts; empty and offline states remain distinct. The score area has a keyboard-focusable workspace jump. The summary shows its last PDF creation date only after local PDF generation succeeds. This remains an editable sample review, with no new production route or backend adapter. Existing approval archives are unchanged.

Use `/foundation/preview/expanded`. Links into existing factor, household and overview routes retain `edition=expanded`. `/foundation/preview` without that parameter remains the historical comparison surface. Never update the sealed October 1 archive to accept new screenshots.

The live shell now uses Today, Homeguard, Act and Plan. Plan is the working fourth-tab label. Only Today and Homeguard are delivered live destinations; Act and Plan retain explicit later-stage controls instead of linking to nonexistent pages or mounting review fixtures.

The shared route registry separates intended ownership from delivery. Map belongs to Act; Journal belongs to Plan. Planned nested routes are not automatically authorized by the existing stage session or onboarding return allowlist.

## Changes to existing surfaces

| Surface | Current revision | Deliberately not represented as working |
| --- | --- | --- |
| Today | Original four factors, household link and all original sections retained. Add a change-explanation disclosure, Plan continuation and optional Journal entry. | No inferred numerical change, causal explanation or live saved-task summary. |
| Air, UV and pollen | Keep readings, charts, source information, all guidance, scan-all tips and contextual outdoor planning. Air links to the monitor layer. General tips have no automatic save controls. | No fabricated forecast intervals or combined safe-time rating. |
| Mold | Keep outdoor estimate, uncertainty and a moisture/maintenance entrance. General tips remain informational. | No indoor mold detection or generated spore measurements. |
| Homeguard | Overall score, then PFAS/radon/lead cards and their scope note, then household context and the original house. Keep Tests, Maintenance, Food and Garden and Summary entrances. | No private record counts, invented testing results or automatic rescoring. |
| PFAS, radon and lead | Keep testing follow-through and guidance; PFAS and radon link to matching map layers. General guidance no longer receives Save this step. | No new sample APIs, treatment certification or household measurement inferred from regional data. Lead stays unscored. |
| Daily household and Homeguard category guides | Retain all guidance and a Plan entrance; remove generic save-tip buttons and the duplicate save-only family section. | Educational advice does not automatically become a dated or saved task. |
| Settings preview | Replace the expanded edition's generic control demo with explicit sample household Save/Cancel. All seven flags are replaced; saved action history remains. | Full privacy, recovery, language, notifications and destructive workflows still need separate screen review. Live essential Settings is unchanged. |
| Map | Keep the existing interactive atlas, layers, filters, lists, evidence sheets and district work. Use the four-tab bar with Act active, Back to Act, and matching expanded factor links. | No production renderer, live feed or new permission request. |
| Luna | Preserve the approved panel and real transport. No new controls imply unsupported AI mutations. The expanded Act/Plan outlines do not display a misleading Today-context launcher. | Conversation, capabilities, rich context, editable action proposals and privacy agreements remain integration work. |

## Shared action interaction review

`ExpandedPreviewProvider` lives only in the preview layout. Its records, drafts and household choices remain in memory. Reload clears them. It imports no live API client, does not create accounts, and makes no provider or mutation requests.

Explicit Save to Plan controls in record/planning workflows open an editable title and reason. A date is optional and explicitly all-day. Reopening a saved follow-up edits the same action. The simple Plan surface shows selected-day, unscheduled and all dated records; state can change between Saved, Waiting and Completed, including reopening. General factor and household tips have no blanket save control, per the October 3 refinement. Guidance, contextual links and already-saved actions remain intact. These are user-reported actions, not changes to hazard scores.

Review controls can simulate a failed save. Edits survive that failure and closing the sheet. Offline mode prevents saving and does not claim to queue a write. Closing or browser Back cancels a pending simulated save. Dialog history uses the current URL without serializing titles, category flags or private notes.

This is a bounded interaction study, not the complete P01/P02 feature. It does not yet implement timed scheduling, timezones/DST resolution, recurrence, reminders, calendar exports, task deletion, authoritative revisions, shared ownership, server conflicts, idempotency or unknown-write reconciliation. Backend integration must use the agreed contracts and extend these tests rather than swapping a timeout for an unvalidated fetch.

## New destination outlines

Act and Plan provide entry composition for reviewing the new connections. Outdoor Planning, Journal, Opportunities, Projects, Outreach and Observations still open explicitly labelled workflow outlines. Those outlines preserve the planned purpose and constraints; they are not finished feature wireframes or production screens.

October 3 follow-up: Tests, Maintenance, Food and Garden (all five branches), and Summary now open connected interactive Homeguard wireframes. See [the Homeguard review inventory](../homeguard/README.md) for routes, controls, record continuity, evidence safeguards, verification and remaining production work. Their records are synthetic, in-memory and not approved for production. Source follows and maintenance cadence do not send notifications or start background jobs.

The remaining destination outlines still require detailed wireframes under `docs/WIREFRAME_WORKFLOW.md`. No feature was removed from the master plan or Vibhav's handoff. The existing Map preview and the new Homeguard workflows remain editable and unapproved.

## Integration sequence

1. Review the new navigation, additive entries and action interaction with Yogi. Do not freeze this revision before approval.
2. Agree with the actual backend implementation on action IDs, home context, evidence references, capabilities, states, errors and ownership. Do not invent endpoint names from component names.
3. Build and approve the complete shared Plan/action journey, including scheduling and failure/recovery states.
4. Add real Today change explanations and contextual forecasts only when compatible source metadata exists. Preserve current factor detail depth.
5. Build Tests/Records and Maintenance with their domain-specific forms and privacy lifecycle. Connect Homeguard and household guidance to the same records.
6. Continue full Act/Map, Food and Garden, Journal/Patterns, Settings and Luna reviews using the existing complete frontend plan. Each has its own acceptance requirements.

The live shell's new navigation is the only intended change to delivered product behavior in this revision. All new feature interaction previews remain gated by the existing frontend-preview configuration. No backend routes, database migrations, score formulas, source acquisition jobs, onboarding assets or sealed approvals were edited.

## Verification commands

Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run preservation:verify`, the expanded/map/factor/household browser suites and the isolated stage suite. Browser fixtures must block all unexpected API calls. Use `scripts/stage-test-server.mjs` for a fake-auth production build, never production credentials for live-route tests.

New screenshots belong in test output for review, not in approved archive directories. Physical-device Safari, a hosted update and live integration are separate checks, not established by Chromium emulation.

## Verification record

October 3 checks: 383 logic tests passed. TypeScript passed. The full lint run had zero errors and five existing warnings in untouched files; a focused run for the new and edited components also passed. The isolated fake-auth production build passed. All 34 stage browser checks passed together after correcting a test that attempted to click an intentionally unavailable tab.

The 82-case preview regression run passed 80 checks and exposed a late route replacement that could clear a just-selected section hash on two home factors. The normalization was made synchronous. The complete affected section-navigation and expanded-preview suites then passed together, 18 checks. The other preview coverage includes all factor and household pages, map layers and data states, and 320px layouts at 150 percent text in both appearances. No tests contacted the live backend.

The original preview comparison captured all 132 approval cases. 131 matched byte-for-byte; one dark, 320px Homeguard partial-data capture did not stabilize. An independent rerun of all four appearance/width variants for that case stabilized and matched byte-for-byte. The original failed candidate and the independent recheck remain separate in test output; no image was substituted and no tolerance or baseline was changed. This comparison used the production candidate before the final preview-only hash-normalization fix. Both archives remain intact: 204 onboarding files and 146 foundation files verified.

No GitHub push, hosted-site update or new visual approval is implied by these local checks. Vibhav's compiled handoff and current source requirements were not rewritten.

The final source also passed a clean isolated production rebuild after the preview navigation fix. A Windows/OneDrive EPERM error required moving the old generated test cache out of the repository's TypeScript scan. It was preserved at `C:/Users/ympat/AppData/Local/Temp/HALO-frontend-build-cache-20261003-1`; no application data or source was deleted. The temporary fake-auth test servers were stopped, and the normal local preview remains on port 3010.

## Hosted review publication

October 3 scorecard/action refinement supersedes generic tip-saving behavior in older verification notes: Homeguard factor cards precede the household, and general educational tips have no automatic Save this step control. Record-based Plan follow-ups retain the existing optional-date dialog and shared state. This revision passed 59 browser checks against the static build, 426 logic tests, TypeScript, scoped ESLint and both archive integrity checks. Updated publication identifiers are in `components/homeguard/README.md`.

October 3, 2026 follow-up: the expanded review was published successfully as version 11 at https://halo-wireframe-review.yogirajapaturi.chatgpt.site. The existing Site audience was preserved. The root link opens the shared expanded layout; static route wrappers retain review settings and in-memory action state across navigation. The source commit in the separate Sites repository is `1dad7cf16ceb92dc7c86dc717b85e3ef0534fbab`. This does not imply a GitHub push or a live HALO application deployment.

The static production export and TypeScript passed. On the final export, all 58 expanded, map and section-navigation browser tests passed together, followed by two hosted-entry and household-route checks. Tests rejected backend and external requests. Both approved archives passed integrity checks. An initial Python static-server run had loading stalls; the separate loopback Node server passed the complete rerun without relaxing assertions. Windows packaging required Git Bash on the process PATH and GNU tar's `--force-local` option; the tested source and archive were unchanged by packaging.

Future review changes follow the hosted-update instruction in `docs/WIREFRAME_WORKFLOW.md`. `scripts/sync-hosted-wireframe.mjs` copies shared presentation dependencies and assets to the existing isolated Site checkout, not production routes or environment files. Retain its static root layout and route wrappers. `scripts/serve-wireframe-export.mjs` serves a built export on loopback for tests; set `HALO_HOSTED_REVIEW_TEST=1` only for the static-specific test suite. Publication does not approve new visuals or turn the labelled workflow outlines into finished features.

## Compact home overview copy, October 11

The latest revision supersedes the always-expanded snapshot below: one primary frame contains four whole-row links with a short status each. Add retains creation routes; Quick access retains current-record continuation, independently recorded milestones, maintenance records, food branches, the exact garden and My Week. Default375px height is below420px, while enlarged text remains readable. All deeper features stay intact, without new account writes or backend integration.

Your home workspace keeps its single primary panel but removes the subtitle and repeated creation rows. Tests, Home care and Summary use short visible headings. The Add disclosure retains Plan a test, Add a report, Add routine and Record moisture. Compact food labels preserve named accessible destinations, and counts, exact records, full dates, recorded stages, garden continuation, Summary and My Week remain. This is an editable presentation review only; no backend or approved core behavior changed.
