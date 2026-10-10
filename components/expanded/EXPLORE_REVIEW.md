# Explore interactive visual review, October 9, 2026

Yogi chose Explore to replace the visible Act label and My Week to replace Plan, then requested this rough interactive stage. Internal `act` and `plan` keys and canonical planned routes remain unchanged. Existing approved archives stay immutable. No Explore visual approval or live integration is implied.

Open `/foundation/preview/expanded/?tab=act`. The overview connects the existing Map with organizations, opportunities, projects, outreach, private field notes and Homeguard Summary. The Map's back link and active tab use Explore. My Week remains the existing bounded action review; renaming it does not implement its full target.

## Coverage

| Requirement | Review surfaces and behavior |
| --- | --- |
| A01 Overview | River-photo map entrance, warm woodland opportunity, community sketch, garden-photo project entrance, distinct letter/notebook pathways, saved-action continuation, Summary link. No address is requested. |
| A02 Organizations | Search/cause/area filters, retained filters, list/detail, mission/service area/activities/access/verification fields, saved contact follow-up, related opportunities and sample listing-review feedback. All organizations are fictional and unverified. |
| A03 Opportunities | Date/status/cause/area filters, organizer/date/time/timezone/cost/requirements/access/preparation, open/date-changed/cancelled examples, canonical My Week save, registration-handoff explanation and self-reported participation form. Opening the handoff does not mark registration or attendance. |
| A04 Projects | Two fictional planning templates, suitability/materials/constraints, step buttons and full list, whole-project or selected-step save. Only an explicitly saved action can be completed/reopened/marked waiting. These use the same My Week action IDs. |
| A05 Outreach | Utility/Landlord/Representative drafts, private-water omission of Utility, purpose selector, deliberate per-recipient reset, optional public fixture context, sharing preview, Copy/Share/text download/clean print, nonsensitive follow-up task. Drafts are independent and remain in memory. |
| A06 Field notes | List/create/detail/edit/delete with scope confirmation, observation time/timezone/coarse place/factual description, text-only sharing preview, self-reported external reference/status and canonical follow-up. No note is added to the public map. |

Public catalogue values and metadata are fictional. No source lookup, provider request, household onboarding, account write, registration, email send or agency submission is performed. Source/verification labels never claim live review. Photography is contextual, not evidence of an event, organizer, current condition or household location. The real sample map remains a separate preserved component.

## Visual refinement and references

Yogi requested a stronger, creative and professional design with less jargon, repetitive geometry and monotone card styling. The revised overview uses an open editorial layout, real nature photography, asymmetric image crops, original hand-drawn SVG sketches, the existing Fraunces/Instrument fonts and restrained sage, amber and lavender accents within HALO's blue/teal shell. It is not a grid of rounded scorecard buttons. Every pathway has a different composition.

Supporting filters, listing-review metadata and participation forms use native keyboard-accessible disclosures. Event date/time/timezone, area, cost, requirements and unknown accessibility remain visible before saving. Project suitability and constraints remain visible. Private drafts use a paper treatment and field notes a notebook treatment. Visible project/outreach labels are now Start small and Ask a question; IDs and routing are unchanged. Today, Homeguard, onboarding and the approved archives were not redesigned.

Research informed the design direction, not a copy of another app's UI:

- [AllTrails](https://www.alltrails.com/) and its [photo-gallery documentation](https://support.alltrails.com/hc/en-us/articles/26225644800020-Photo-galleries): photo-led discovery and an approachable sense of place. Interpretation: use contextual imagery to invite exploration, not a dashboard of scores or borrowed trail ratings.
- Congressional App Challenge winners [Mazah](https://www.congressionalappchallenge.us/25-nc08/) and [ServeSync](https://www.congressionalappchallenge.us/25-ky03/): practical community participation and clearer pathways to volunteering. Interpretation: lead with an understandable next step. Their videos and complete interaction designs were not independently evaluated; do not describe this as reproducing award-winning visual design or proving a competition outcome.

Photography is locally bundled and public domain, with original URLs, credits, acquisition hashes and transformation details in `public/explore/photo-sources.json`. `scripts/prepare-explore-photos.mjs` reproducibly downloads, strips metadata and resizes the actual photographs. No imagery was generated. Sources: [Ken Thomas's Neuse River](https://commons.wikimedia.org/wiki/File:Neuse_River-27527.jpg), [Cynthia L. Cunningham's woodland trail, USGS](https://www.usgs.gov/media/images/trail-abrams-falls), and [Courtney Celley's pollinator garden, USFWS](https://www.fws.gov/media/pollinator-garden-0). About the photos on each screen explains the contextual use and links credits. No third-party image requests occur during browsing.

Photos have empty alt text because they add atmosphere, not record facts; destination labels carry the meaning. Missing images fall back without removing navigation. High contrast and forced colors hide the decorative visuals and preserve the same paths. No new animation or delay was introduced. No motion preference is overridden.

## State and navigation

The existing isolated `HomeWorkspaceProvider` supplies draft/record memory, revisions and simulated pending/error/conflict/offline behavior. `ExpandedPreviewProvider` owns shared actions. Explore records do not become Plan tasks without explicit Save. Explore workspace review controls are outside the product and share the existing record scenario, so selecting Empty also clears Homeguard sample record collections. Independent actions remain unchanged.

`destination`, `exploreView` and opaque `exploreRecord` carry navigation only. Titles, descriptions, participation notes, letters and place labels never enter URLs. Internal navigation retains drafts and filters. Edited field notes and outreach drafts have best-effort browser-exit protection. Reload resets the sample session. Deleted or invalid IDs have an unavailable state instead of another record.

## Deliberate rough-stage limits

Before refining and approving this stage, resolve the following with the complete product/frontend/backend/acceptance packets, particularly A01-A06, HO-038 through HO-043, UI-090 through UI-095, AC-114 through AC-119 and S20/S21:

- Real organizer coverage, human verification, public contact/official links, applicability ranking and source operations are not connected. Listing feedback is a sample acknowledgment with no transmitted review request.
- Event capacities, ongoing/full/postponed/expired examples, source revisions, subscription delivery, timed scheduling and attendance reconciliation need fuller review and contracts. Participation currently retains only a visit-local form and simulated save status.
- Project parent/child actions, series scheduling, dedicated pause/cancel semantics, recorded outcomes and reviewed real instructions need the complete shared-action contract. Waiting is an existing sample action state, not a newly implemented pause service.
- Outreach uses a generic information request and a clearly fictional public evidence note. Real multi-record evidence selection, source revision warnings, recipients, signatures, external-send/reply records and saved-draft lifecycle remain work. Nothing is automatically sent.
- Field notes are text-only, with coarse place labels. Photos, EXIF and precise-location selection, revision history/export policy, reviewed official destination matching, genuine receipt evidence and secure attachments remain work. The handoff explains this boundary rather than offering a fake official portal.
- Authentication, RLS, idempotency, unknown-write reconciliation, private persistence/recovery, source rights, translations, real-device Safari, permission/share/print behavior and production integration remain unverified. No production route mounts these fixture providers.

## Verification

Use `test/ui/explore-preview.spec.ts` for navigation, source-state distinctions, filter retention, shared action identity, independent drafts, record failures/deletion, local image/credit checks, missing-photo fallback, keyboard disclosures, high contrast and light/dark 320px enlarged-text layouts. Existing expanded/Homeguard/hosted/map suites cover the renamed shared shell. Builds must use the isolated static checkout and reject API/provider requests. Preserve both approval archives with `npm run preservation:verify`.
