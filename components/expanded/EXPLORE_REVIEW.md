# Explore evergreen community review, October 10, 2026

Yogi requested a replacement of the October 9 Explore page: retain the real photos, remove the featured current-event feed and irregular photo shapes, blend with HALO, and go deeper on community discovery, volunteering, organizations, notes/Luna and contact/email outreach. This revision supersedes that visual direction, not the immutable approved Today/Homeguard/onboarding archives. Explore is still an editable wireframe, not approved production UI.

Open `/foundation/preview/expanded/?tab=act`. Visible labels are Explore and My Week; internal keys remain stable.

## Later October 10 action-depth refinement

Yogi requested substantive action outcomes across every feature and a compact map preview opening the full map. This refinement keeps the evergreen hub and regular photo shapes while introducing ongoing workspaces rather than more discovery widgets. It remains a sample review, not approval or production persistence.

- Map: the existing Census/Natural Earth canvas now has a noninteractive preview mode inside a single full-map link. Four layer choices open the matching full-map layer; the layer also follows full-map selection on return. There is no private home pin in the preview. Failed geography retains the entry and other feature routes. Public-record details can explicitly become a private question with public date/scope references; the home pin cannot use that handoff.
- Volunteer: keep a personally chosen opportunity without an event feed, organizer/HTTPS link, preparation/access questions, optional activity date, dated self-reported contacted/confirmed/participated/follow-up/closed updates, factual outcome, optional hours/reference, history, deliberate export and separate My Week preparation/follow-up actions. Opening official resources does not register or confirm attendance.
- Community: each topic now has a practical result path into Homeguard testing/Today/outreach, a desired-answer goal, dated own updates, result/reference, check-back date, retained history and a canonical shared follow-up action. Topics retain independent workspaces. Reading a lesson never records a result.
- Organizations: a private contact workspace records what the user wants from the group, their own contact/reply result and next step. Fictional directory verification remains explicitly unknown; contact progress is not a partnership or verified organizer response.
- Projects: start an ongoing workspace, review prerequisites/materials, get tailored step coaching, select a deliberate bundle for My Week, retain existing action IDs/title/date/state, record private step notes, pause/resume, record whole-project completion only after all required steps and a factual result, then set a project-review goal and follow-up. Progress is action completion, not measured environmental benefit. The project rechecks completed action state instead of silently completing a step from browsing.
- Notes: a note can become a private environmental question/case, retaining its original text, selected public map references, explicit Luna context, a recorded result/reference and follow-up. Deleting a note also removes its owned case/history and drafts, while independent tasks and deliberately retained outreach snapshots remain. Export defaults still do not include private place labels or unrelated records.
- Outreach: each recipient has an independent resolution workspace for the answer/action sought, manually recorded reply, result and next decision. Send-only Gmail does not read replies. Submitted/unknown preview outcomes do not automatically mark a reply or successful resolution.
- Hub: ongoing commitments, unfinished projects and open cases now have direct continuation paths. The original shared My Week action continuation stays available. All private state is visit-local and resets on reload until backend integration.

The three nature photos remain, with the river photo now attached to community learning rather than serving as the map itself. Canvas interaction and credit links are omitted inside the preview link to prevent nested controls; visible public attribution remains outside it. The full-map default rendering, controls, geometry, observations and failure states are retained.

Use `test/ui/explore-action-workspaces.spec.ts` and `test/frontend-explore-workspace.test.mjs` for the added loops, dates, quantities, URL validation, shared-step deduplication and privacy. `EXPLORE_BACKEND_DELTA.md` records the durable records/transactions needed before these become live account features.

Verification for this refinement: 128 frontend logic tests, main TypeScript, static export and both preservation checks passed. The earlier broad UI run passed 100/100. The final broad run passed 100/101 with one simulated outreach-save timeout during packaging; the complete 15-check action suite then passed unchanged in a single-worker recheck, including that case and project completion/Homeguard-return. Screenshots load all three photos before capture. These are local static review checks, not authenticated provider/backend tests. Hosted provenance is in `docs/continuation/HOSTED_REVIEW.md`.

## Coverage

| Surface | Implemented review behavior |
| --- | --- |
| Overview | Evergreen map entrance, two regular photo pathways for Volunteer/Ways to help, open rows for community/organizations, notes/outreach workspace, saved continuation and household summary. No featured event, date or current-event feed. |
| Volunteer | Official NPS/FWS/NC Stream Watch resource routes, interest filter, explicit planning-time preference, optional area label, general preparation checklist, organizer handoff, undated canonical My Week research action. No actual event is listed or booked. |
| Your community | Four reviewed-concept lessons about water/air/radon/facilities, matching map deep links, evidence limitations, practical next steps and deliberate question-to-note continuation. Existing unfinished writing is retained with append/keep choices. |
| Organizations | Search/cause/area and retained filters, sample list/detail, mission/service/access/source review, contact research action, volunteering/outreach links, simulated outdated-listing acknowledgment. All example organizations remain fictional and unverified. |
| Ways to help | Two fictional planning templates, suitability/materials/constraints, steps and full-list alternative, whole-project/step shared saves, explicit completion/reopen/waiting. No inferred environmental benefit metric. |
| My notes | Observation/question/idea/conversation types, optional dates for general notes, search/type/pin filters, create/edit/delete scope confirmation, retained failures/conflicts/offline drafts, selected export fields, self-reported external reference, official-contact guide and My Week follow-up. No public map posting. |
| Selected-note Luna | Purpose plus title/description/time/place selection, explicit consent and exact request preview. Place/time excluded by default. No AI call, diagnosis, automatic action or emergency response claim. |
| Ask a question | Topic/optional area, official contact resources and clearly fictional matching example, manually reviewed public email, Utility/Landlord/Representative/Local office modes with independent drafts/subjects/contacts/note snapshots, changed-context reconfirmation, stale-note blocking and exact sharing preview. |
| Gmail proposal | Simulated connect/disconnect, exact sender/recipient/subject/body final confirmation, submitted/failed/unknown branches, duplicate prevention and explicit simulated attempt reconciliation. No OAuth, account connection, inbox access or email delivery. |

Official outbound resource links are real, but HALO does not transmit your area/preferences/notes through them. External sites own their current opportunities and may publish submitted content. Location preferences are coarse visit-local labels, not a real local search. No query string contains typed places, notes, contact addresses or message text.

## Visual language and assets

The page uses the existing Instrument Sans/Fraunces typography, blue/teal identity, shared shell and rounded navigation. Three retained contextual photographs sit in regular rectangular crops with restrained, symmetrical corners. Grouping uses aligned images, open dividers and small icons, not a wall of rounded scorecard buttons, blobs, paper sketches or a news feed. Sage provides a map cue; quiet lavender groups personal notes/outreach. The heavier workflows live inside their sections.

Photos are bundled locally with public-domain credits and provenance in `public/explore/photo-sources.json`; the earlier acquisition script remains available. They do not depict actual organizations/projects, a user's location or current conditions. Credits link the original [Neuse River](https://commons.wikimedia.org/wiki/File:Neuse_River-27527.jpg), [woodland trail](https://www.usgs.gov/media/images/trail-abrams-falls) and [pollinator garden](https://www.fws.gov/media/pollinator-garden-0) sources. Loading failure retains navigation. High contrast hides decorative photos. No new animation or device preference override was added.

The October 9 AllTrails/Congressional App Challenge research was historical design context, not a template copied for this replacement. Current product research, official links and Gmail feasibility are recorded in [the integration delta](EXPLORE_BACKEND_DELTA.md).

## State and implementation boundaries

The existing isolated HomeWorkspaceProvider supplies memory-backed drafts/records/revisions and simulated pending/error/conflict/offline behavior; ExpandedPreviewProvider supplies canonical shared actions. Reload resets the sample session. Internal navigation retains edits and preferences. A pending note save must not navigate back after its editor has been left. Observation dates remain required while general thoughts can be undated.

Luna context selection is independent of email-note inclusion. Outreach snapshots exclude place/time and require review after source revision or deletion. Area/topic changes require recipient reconfirmation and a fresh message preview. Unknown email attempts survive internal navigation and cannot automatically retry; the explicit status-check branches are simulated, not a verified Gmail reconciliation service.

No production route mounts these sample providers. No backend route/migration, real account record, contact resolver, registration, agency submission, AI request or email send was implemented or performed. Backend ownership stays with Vibhav. The new user request permits designing an opt-in email capability; it does not authorize sending messages during this work.

## Remaining integration and review

Read A01-A06/M01-M05/X02 and the full frontend/backend/acceptance requirements with the latest user decision. The evergreen Volunteer design replaces the dated-event preview and does not require its event ingestion service. Genuine catalogue/attendance/calendar features remain a later separately reviewed expansion.

The [backend delta](EXPLORE_BACKEND_DELTA.md) specifies reviewed contacts/jurisdictions, owned notes/outreach, selected-note Luna authorization/processing disclosure, per-user send-only Gmail OAuth/verification, immutable send confirmation, durable attempt IDs, rate limits and unknown-outcome safety. Static learning/project content still needs source/content review and translations; evergreen does not mean maintenance-free. Real map evidence remains dated and source-dependent.

Physical Safari, end-to-end screen-reader/keyboard behavior on devices, translations, authenticated persistence/RLS, contact coverage, actual provider consent/sending and production deployment are unverified. This revision needs Yogi's refinement and explicit approval before preservation and production wiring.

## Verification

Use `test/ui/explore-preview.spec.ts` and `test/ui/explore-community.spec.ts` for the hub, retained photo/credit/failure behavior, source handoffs, notes/types/pins/privacy, draft protection, contact reconfirmation and simulated sending/reconciliation. Existing expanded/Homeguard/hosted/map suites test preservation and navigation. Provider/API requests are blocked in these static tests. Use `npm run preservation:verify` for the immutable archives. Record exact final test/deployment evidence in `docs/continuation/HOSTED_REVIEW.md`.
