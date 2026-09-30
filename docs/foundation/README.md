# Phase 0 foundation wireframe review

Status: **PROPOSED, not approved or frozen**. Created September 29, 2026 on `codex/foundation-wireframes`, based on integrated main `9f1ef88`. Yogi is the sole frontend person. Assignments in the source documents are superseded.

Open `/foundation/preview`. The review panel is outside the product. Choose a named state, appearance, text size, higher contrast or reduced motion. Close the panel for a clean app view. Default appearance follows the device. This is the shared foundation review, not the finished Today dashboard or full Settings/Learn/Alerts/Assistant/Map experience.

## Sources and scope

- Updated specification: `reference/HALO_Frontend_Specification_2026-09-29.pdf`, 83 pages. SHA-256 `A6EE330A7FF4E52D0EC54C2CC3A542D426D8AB643D72A2EF7E9607E8750EC33A`.
- Companion source: `reference/HALO_Wireframe_to_Build.source.md`, retained unchanged. Its setup commands, assignments, older dependency statement and push/PR instructions are not automatically executed. Use `../WIREFRAME_WORKFLOW.md` for the user-adapted workflow.
- Functional checklist: P2 to P6, A1 to A11; backend contracts P3 and D0/D1. Page-specific A10 visuals are tracked below, not silently dropped.
- Existing approved onboarding remains unchanged. It now includes the rounded mobile update on main. Original archive remains historical and immutable. The token colors are P6's approved values. New foundation geometry is a proposal.
- The repo already upgraded Next to 16.3.6 on main, superseding the PDF's version note. This branch did not change dependencies or their lockfile. The installed page, CSS and client-component guides were read before coding.

## What is built for review

| Requirement | Where to review | Behavior / binding for the later live build |
| --- | --- | --- |
| One shared shell | `shell` and all `shell-*` states | One header, main, tab bar, assistant, sheet host and toast host. Later `app/(app)/layout.tsx`; onboarding stays outside. No live route group introduced yet. |
| Five tab labels/icons | Bottom bar | Today/sunrise, Home/house, Map/folded map, Journal/notebook, Act/hand. Equal destinations, active state, press feedback. Production URLs `/today`, `/home`, `/map`, `/journal`, `/act`, no query strings. Preview links remain within the isolated preview. |
| Header variants | `shell-home/map/journal/act/settings` | Today bell + gear; other tabs gear; Settings back. Map uses a 600px content cap. Canvas is a clearly labeled placeholder, not invented map data. Actual map-under-header composition is the Map stage. |
| Tab history and session scroll | Switch tabs, browser Back | Push once per tab, Back returns to previous tab, scroll remembered in module/session memory. Settings Back uses history when entered from this preview, otherwise replaces with Today. |
| Alert count | `shell-no-alerts`, `shell-badge-cap`, bell | `GET /api/alerts.unread`, hidden at 0, capped at 9+. Opening does not mark read. Sample row or mark-all changes mock unread count. Production bell slot is absent until the Alerts module exists. |
| Assistant entry | Floating bubble, `shell-no-assistant` | Fixed above bottom bar on five tabs, hidden during sheets; `NEXT_PUBLIC_HALO_ASSISTANT=off` hides it. No model calls. Full Assistant/privacy/refusal belongs to its sheet stage. |
| Offline and retained data | `offline`, `offline-empty`, `stale`, `refreshing` | Offline banner pushes content below header. Stored readings remain visible on refresh failure. No-cache state never claims stored results exist. Notices and timestamps come from actual retrieval times later. |
| Four universal data states | `loading/error/empty/shell` | Composed skeletons, mapped error + working mock retry, empty with/without action, populated samples. Error is distinct from empty. |
| Profile routing states | `gate-loading/incomplete/error/location` | Profile verification and onboarding routing are simulated only. `gate-error` retains the app/readings while retrying verification, not a destructive session reset. See production contract checklist below. |
| Unknown route | `not-found` | Plain short message + Today action, no raw error or silent redirect. The exact short wording is proposed, because A1 references a message without specifying exact copy. Not a replacement live `app/not-found.tsx` yet. |
| Cards | `cards`, all sample factor cards | Static, tappable, severity-pill marked, expandable. One expanded reading card, no history entry. Long title/full text available on expansion. |
| Expanded reading states | `card-loading`, `card-no-data` | Composed detail skeleton or explicit missing-reading explanation. Learn entry remains a contextual action. |
| ScoreRing | `shell/no-data/partial/score-zero/score-full` | `score.display_score`, `score.severity`, `score.is_partial`. Higher is better, no unit, no percent. Null/no-data has no arc. Partial adds a visibly broken outer circumference. Real 0 is not missing. 400ms entrance, skipped for reduced motion. |
| ContributionBar | `partial`, all `contribution-*` | Adapter supplies risk shares and severities, frontend never classifies. Null with no-data produces hatch, other absent factors omitted. Zero total hides bar; zero-risk known factor gets minimum sliver, under-10% gets legend only; one factor fills width. Segment and legend select/expand a card. |
| RiskBar | `bars` | Server risk + severity; no-data and shown-not-scored have no fill. No browser-derived risk. |
| Fixed federal-limit marker | `bars` | Shared token study and threshold example. Fixed 0 to 2× scale, marker at 50%, true ratio above 2×, continues marker, worst-first, neutral non-exceeding rows, unscored below divider without marker. `value_ppt`, `limit_ppt`, `exceeds_limit`, `is_enforceable`; full chart remains HomeGuard/Map/health-card work. Lithium in µg/L. |
| All six severity pills | `pills` | Icon + word + server-defined color, no-data outline only. Unknown severity handled by existing SeverityPill. Severe icon is filled in the proposed foundation scope only. |
| Confidence / provenance | `pills`, expanded cards | full hidden; limited partial; stale 3+ yrs old; none not evaluated. measured/modeled/estimate, unknown hidden. Today has no confidence field. UV and pollen no provenance, mold estimate; radon estimate and conditional lead estimate in HomeGuard later. |
| Callout tones | `callouts` | Info, caution, notice, error. New backgrounds/ink pair tokens proposed, existing onboarding red callout unchanged. |
| EmptyState / Skeleton | `empty`, `empty-no-action`, `loading`, sheet states | Optional action, icon + heading + explanation. Two skeleton primitives, static default (shimmer Tier 3). Loading reading cards match the 94px summary footprint; hero skeleton uses the same composition. |
| Buttons | `buttons`, retry/save actions | Existing primary/secondary/tertiary reused. Destructive secondary red, icon-only tertiary with accessible label. Spinner holds size and blocks repeat requests; disabled only unavailable actions. One primary action per product screen. Hover/press are interactive states, not separate page designs. |
| SegmentedControl | `controls` | 2-3 choices, keyboard arrows/Home/End, roving focus, no navigation. Journal modes, renter control, severity filter samples. Letter recipient uses the same primitive later. |
| ToggleChip | `controls`, `controls-failure` | Optional seven household facts. Selected/unselected/disabled. Immediate update, failure restores previous choice + inline explanation. Actual shared save serialization in build checklist. |
| Switch / AccordionRow | `controls`, Settings shell example | On/off/disabled switches, only one accordion open, closed current-value summary. Device notification switch is a disabled review example only; hidden in real Settings until service worker ships. |
| Form controls | `form/form-error/form-disabled/long-text` | Text/numeric/select/checkbox/range/textarea, default/focus/blur error/disabled by direct interaction. Inputs at least 16px. Optional four-digit year 1700 to fixed review year 2026, blank accepted, digit keypad. Submit available when invalid; answers retained after failure. |
| Free text constraints | Form journal note, tall Assistant sample | Note optional, 500 max, counter past 400; question required, 1000 max. Plain text only. Prototype intentionally does not send either. |
| SwipeRow | `swipe`, sample alert | Gesture reveals same immediate delete/dismiss as always-visible 44px button. Eight-second Undo, no confirm dialog for one entry. Full gesture momentum is not a separate product feature. |
| Toast | `toast`, `toast-undo`, save/delete samples | One toast, 8 seconds, replacement resets duration, optional Undo. Failures needing action stay inline. Toast within a modal remains in its focus layer. |
| BottomSheet | Every `sheet-*` | Standard ~70%, tall ~90%, map content at most 50%. Internal scroll, backdrop/Escape/close/drag, focus trap/restore, underlying scroll lock/restore. One sheet; second replaces. Back closes first, never reopens through stale entry. |
| Sheet navigation / deep link | Replace with Learn / Go to Today, `sheet-deep-link`, `?learn=pfas` | Owned entry uses Back; pasted link close replaces URL without leaving preview. Second sheet replaces entry. Navigation closes by replace then pushes tab. Invalid Learn topics ignored. Generic topic has no Your reading pill. API context binding is future page work. |
| Accessibility preferences | Review toolbar, larger-text screenshots | 100/115/130/150%, higher contrast, reduced motion. Preview state is local, never written to production settings or root HTML. Build propagates these to HTML/device storage. Theme review controls are not product controls. |
| Logo / font / new token studies | `identity` | Approved transparent mark as monochrome mask. Fraunces, Instrument Sans, self-hosted IBM Plex Mono (codes only), official OFL license. Skeleton/callout/marker/house/time-of-day hero/high-contrast values are PROPOSED. |

## Explicit scope boundaries, not omissions

Full Learn educational sections, Assistant conversation/refusal/citations, Alerts content and preferences, Today hero/headline/time ranges/cards/trends, HomeGuard house diagram/action plan/charts, Journal calendar/log/trends, Act letters/health card/volunteer, Settings account/source/privacy flows, and actual map/layer/district interaction are their subsequent stages. The foundation sheet bodies are visibly labeled development placeholders as P5 requires. The token study is not approval of those later page layouts.

This wireframe stage does not extract the live data client, migrate storage, rewrite auth, move production tokens, install a service worker, add empty live pages or change backend files. Their complete checklist is `integration.md`. No application API calls or real saves are made. `AuthInitializer` gains only a matching foundation-preview skip; its live paths are unchanged.

## Proposals awaiting Yogi

- New component geometry: score diameter/stroke, partial broken outer ring, card spacing, tab selected tint, sheet corners and backdrop, quiet pill shapes.
- New P6 token values, including callout surfaces, skeleton, limit line, house ground/roof, four time-of-day pairs and high-contrast overrides. Actual Today hero contrast must be checked again with its complete content.
- Unknown-route short copy and studio-only placeholder explanations. These are review aids, not silently invented education/medical copy. Fixture values are the specification's illustrative values, not a real household or provider reading.
- Higher contrast itself is explicitly PROPOSED in A8. No other beyond-spec feature is added.

## Review preservation

Source: `components/foundation/FoundationPreview.tsx`, `components/ui/Foundation.tsx`, `app/foundation/preview/preview.css`, `lib/frontend/foundation-preview.ts`, and `lib/frontend/copy/foundation-preview.ts`. Existing Button and SeverityPill are imported, not duplicated. `public/halo-logo-mark.png` and existing fonts are reused.

`review/screenshots/` holds current **review evidence**, not approved baselines. Named states are enumerable from `foundationScenarios` (53); screenshots in both appearances at 375 and 320px, plus enlarged layouts. Capture command: `HALO_CAPTURE_FOUNDATION=1 npm run test:ui -- test/ui/foundation.spec.ts` (PowerShell: `$env:HALO_CAPTURE_FOUNDATION='1'`). Ordinary tests never overwrite screenshots. Source + fixture/copy + CSS + bundled assets allow identical future rendering; after approval create a separate immutable `approved/` archive and visual comparisons. Original onboarding integrity hashes remain untouched.

Review all controls in the live preview, not just screenshots. Physical mobile Safari/Chrome and assistive-technology acceptance remain later checks; automated desktop Chrome emulation is not a real-phone claim. No Spanish product translation is invented: the long Spanish button is an explicit expansion stress sample, not a translated app.

Contribution segments are an SVG-like drawing surface with pointer selection. Every factor also has an always-visible, named 44px legend button for the identical action, including tiny/zero-risk slivers. The drawing is hidden from assistive technology to avoid duplicate narrow controls; the complete legend is its text equivalent.

The screenshot [index](review/INDEX.md) links every state in both appearances and widths. `review/manifest.json` records SHA-256 hashes of this review's source, its reused UI/font/logo dependencies, updated PDF and all captures. Rebuild the contact sheets/index/manifest with `node docs/foundation/review/build-review.mjs` after a deliberately requested revision. This manifest is a review snapshot, not user approval.
