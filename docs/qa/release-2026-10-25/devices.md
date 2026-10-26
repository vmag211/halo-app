# Release test: devices, browsers and accessibility (2026-10-25)

Area `devices`, branch `vmag211/release-devices`, tested against production
(https://halo-app-topaz.vercel.app, `origin/main` at `d02141f`). Fixes were verified on a local
production build (`scripts/stage-test-server.mjs`) because production still runs the unfixed code.

**What this does not cover.** Every result below comes from Playwright emulation on Windows. Real iOS
Safari on an iPhone, real Chrome on an Android phone and a real screen reader (VoiceOver, TalkBack, NVDA
or JAWS) still need a person. In particular: touch gestures, the iOS on-screen keyboard and safe areas,
Safari's "Press Tab to highlight each item" setting, and how a screen reader actually announces dialogs,
live regions and the score graphics. axe-core and accessibility-tree checks are a proxy, not a substitute.

## Method

- Journeys (scripted, live): onboarding; My Week add task, complete it, date picker by keyboard
  arrows; Today score and the air factor page; Homeguard area score and a new test plan; Explore project
  recommendations; Journal save check-in and open Patterns; Luna question and an add-task review confirmed;
  Map water layer, name search and opening a result; Settings display (Dark, 150% text, saved, restored).
- Five throwaway households, all made through onboarding with public ZIPs (27601, 28027, 28025, 28202,
  98101 outside coverage). Second configurations on the same browser re-ran onboarding through
  `/onboarding?change=1` rather than creating more households. Every record was named "QA release".
- After each journey: horizontal page overflow, controls covered by another element, clipped labels, and
  (on phone configurations) any control smaller than 44 by 44 CSS px.
- Keyboard: Tab, Shift+Tab, Enter, Space, Escape and arrow keys only, in Chromium, Firefox and WebKit at
  1280x800; first Tab must be a visible skip link, 60-stop walks recording any stop without a visible
  focus ring, modal sheets checked for focus entry, containment and return.
- axe-core 4.x (`@axe-core/playwright`, installed with `--no-save`) with WCAG 2.0/2.1/2.2 A and AA plus
  best-practice tags, light and dark, on every main screen and open dialog; plus landmarks, headings,
  unnamed controls, live status after saves and form errors.
- Emulated `forced-colors: active`, `prefers-reduced-motion: reduce`, dark scheme, 200% zoom
  (640x400 at deviceScaleFactor 2, the CSS viewport a 1280x800 window has at 200%), CSS `zoom: 2` at
  1280, and the app's own 150% text size at 320 and 390 wide.

## Results

| Check | How tested | Result | Evidence |
| --- | --- | --- | --- |
| All nine journeys, WebKit iPhone 14 portrait | live, fresh household 28027 | pass (9/9) | onboarding landed on /app; task saved and completed; test plan saved; 12 project cards; check-in saved; Luna answered with an EPA citation and the confirmed task appeared in My Week; Raleigh found; Dark and 150% saved and restored |
| All nine journeys, WebKit iPhone 14 landscape | live, same household re-onboarded (28025) | fail-fixed (8/9) | Journal: see the Journal row below |
| All nine journeys, Chromium Pixel 7 portrait | live, fresh household 28025 | pass (9/9) | as above |
| All nine journeys, Chromium Pixel 7 landscape | live, re-onboarded (28202) | fail-fixed (8/9) | Journal |
| All nine journeys, Firefox 1440x900 | live, fresh household 28202 | pass (9/9) | |
| All nine journeys, Firefox 768x1024 | live, re-onboarded (27601) | fail-fixed (8/9) | Journal |
| All nine journeys, Edge 1440x900 | live, fresh household 98101 (outside coverage) | pass (9/9) | home score reads "Not available"; no errors |
| All nine journeys, Edge 768x1024 | live, re-onboarded (27601) | fail-fixed (8/9) | Journal |
| Journal on a day already logged | second visit the same day, every browser | fail-fixed | The form opened as a blank new check-in ("Save check-in") instead of the saved one; saving failed with "A check-in for this day and group is already saved". Now today's saved household check-in opens as "Update check-in" until the person edits. `test/ui/production-release-devices.spec.ts` |
| No horizontal page overflow | every journey screen, all 8 configurations; 9 screens plus 3 dialogs under each emulated setting | pass | `scrollWidth` equal to the viewport everywhere, including 320 wide at 150% text and 200% zoom |
| No overlap or clipped labels | elementFromPoint and scroll-width checks after each journey | pass | Flags were reviewed by screenshot: all were content inside closed disclosures, controls behind an open modal or the bottom nav under the map's record sheet (by design) |
| Touch targets of at least 44px (phones) | bounding boxes of every visible control | fail-fixed | Starter idea Add (146x36) and Dismiss (36x36), Patterns Grid/List (43x44, 39x44), map Patterns/Locations (40 tall), map quarter slider (20 tall), date picker days (43x42 at 390). All now 44px; the starter cards stay as compact as before |
| Date picker days at 320 wide | 150% text at 320 | fail-open | Days are 44 tall but 39 wide: seven columns cannot reach 44 each inside a 296px popover. They meet WCAG 2.5.8 (24px). Needs a design decision (for example a full-width sheet on small phones) |
| Map attribution links (Census, Natural Earth) | phone target check | fail-open (minor) | 12px tall text links in the map's attribution line. Inline-text exception of WCAG 2.5.8; could be padded |
| Skip link, app screens | first Tab, Enter, next Tab, Chromium and Firefox | pass | My Week, Today, factor, Homeguard, Explore, Journal, Settings |
| Skip link, Map | same | fail-fixed | The map had none (first Tab was Back). Added, targeting the map's main. Regression test included |
| Focus visible | 60 Tab stops per screen, Chromium, Firefox, WebKit | pass | every stop showed an outline or focus shadow |
| No focus trap | 60-stop walks; Shift+Tab | pass | Firefox's walks stop at the last control because headless Firefox leaves focus there when Tab moves to browser chrome; Shift+Tab moves back normally |
| Sheets trap focus while open | Add task, Alerts, Luna, map search; 40 Tabs and 10 Shift+Tabs | pass | |
| Sheets return focus on close | Escape and Close, all three engines | fail-fixed (WebKit) | Chromium and Firefox returned focus to the opener; WebKit left it on the page body. Cause: WebKit blurs the opener when React's autoFocus runs on the still-closed dialog, so the sheet recorded the body as its opener. The opener is now read during render. `test/ui/production-release-devices-webkit.spec.ts` (failed before the fix, passes after) |
| Popovers return focus | Date picker and Appearance, Escape | pass | Escape closes only the picker and keeps the task sheet open |
| Date picker keys | Arrow keys, Enter, Space, Escape | pass | Arrow moves a day or a week, Enter and Space select, focus returns to Choose date |
| Radio groups and map keys | Settings appearance and map layer: arrow keys; map canvas arrows and plus | pass | |
| Keyboard-only journeys | add and complete a task, Luna add task with review and confirm, Patterns, projects, test plan, factor page | pass | Chromium all pass; Firefox and WebKit pass apart from the items above |
| WebKit Tab skips links | Tab walks in WebKit | not testable here | Safari's default: Tab reaches only form controls unless the user enables Option+Tab or "Press Tab to highlight each item". Needs a real Mac and iPhone check |
| axe: Luna sheet landmarks and headings | axe in the open Luna sheet | fail-fixed | Two banner landmarks and a contentinfo inside the dialog, and answer headings at h4 directly under the h2 sheet title. The context bar and footer are now plain containers; answer headings are h3 |
| axe: factor page | /factors/air and /factors/radon | fail-fixed | `aria-label` on a generic span (the animated score number) and on the AQI scale bar, which screen readers may ignore. Both now have `role="img"` |
| axe: date picker contrast | light and dark | fail-fixed | Days outside the month were 2.38:1 (opacity .57). Now the secondary text colour at full opacity (about 5:1) |
| axe: label-content-name mismatch | My Week day buttons ("Mon, Oct 19" shown as "Mon 19"), score legend links, Explore cards, map key | fail-open (minor) | axe flags visible text that is not a contiguous part of the accessible name (WCAG 2.5.3, experimental rule). Voice-control users can still say the first word. Product copy decision |
| axe: everything else | 20 screens and dialogs, light and dark; landing, Welcome and the address step signed out | pass | no other violations |
| Landmarks and headings | accessibility tree per screen | pass | one main per screen with a name, one page h1, labelled navigation landmarks |
| Unnamed controls | every visible button, link and field | pass | none |
| Live status after saves | status regions | pass | "Task saved.", "Task completed. Its source record was not changed.", "Check-in saved.", "Changes saved.", "Confirmed changes saved." |
| Form errors tied to fields | empty submits | pass | Onboarding address: `aria-invalid`, `aria-describedby` to the message, focus moved, alert announced. Add task and Plan a test use native required validation, which names the field and focuses it. Journal's "choose Felt fine or symptoms" is a form-level alert, acceptable for a button group |
| Forced colors | emulated `forced-colors: active`, 390 | pass | no overflow or overlap; controls keep system colours (screenshots) |
| Reduced motion | emulated `reduce`, 12 views | pass | 0 running animations; with motion allowed the ambient scenes run 3 to 12 |
| Dark scheme | emulated dark, 12 views plus axe | pass | no new contrast failures beyond the date picker row above |
| 200% zoom | 640x400 at deviceScaleFactor 2; CSS zoom 2 at 1280 | pass | no overflow; at CSS zoom the desktop sidebar stays and takes about a third of the width, which is how CSS zoom behaves |
| App 150% text at 320 and 390 | text size saved in Settings, 12 views each | pass apart from the 320 date picker width above | |
| Console and API errors | every journey | pass | no page errors and no 4xx or 5xx from the app's API during journeys. Firefox 768 once logged "Image corrupt or truncated" for three Explore photos; the files are intact (valid RIFF/WEBP, sizes match) and it did not recur, so it was most likely loads cut off by navigation |
| Privacy clear all (clean-up) | Settings, Privacy & data, Clear all app records | pass, with one intermittent failure | First attempts on two households got `500 internal_error` from `POST /api/privacy/export/inspect` (request ids `8e13aaeb-5405-4642-80a8-747bc0337001`, `94a12e93-afc1-46a5-aa56-c4e838445cf7`). Minutes later it worked on all five and every clear succeeded. Worth a look at the server logs for those ids |

Totals: 72 live journey runs, 68 pass and 4 fail (one cause, fixed). 7 issues fixed with regression
tests; 4 left open (date picker width at 320, map attribution link size, label-in-name copy, intermittent
privacy inspect 500), plus the human-only checks listed at the top.

## Fixes on this branch

- `components/expanded/WeekJournal.tsx`: today's saved household check-in is the form's starting point.
- `components/ui/Foundation.tsx`: the sheet reads its opener during render so WebKit returns focus.
- `components/map-preview/MapPreview.tsx`: skip link and focusable `#halo-map-main`.
- `components/expanded/LunaAnswer.tsx`, `LunaConversation.tsx`, `ProductionLunaConversation.tsx`,
  `luna-conversation.css`: no nested banner or contentinfo; answer headings at h3.
- `components/foundation/SceneExperience.tsx`, `PersonalHero.tsx`: `role="img"` where `aria-label` sat on
  generic elements.
- `components/ui/date-input.css`, `DateInput.tsx`: outside-month contrast, 44px day cells, popover up to
  340px.
- `components/expanded/week-starters.css`, `week-evidence.css`, `components/map-preview/map-preview.css`:
  44px targets.

Regression tests: `test/ui/production-release-devices.spec.ts` (6 tests) and
`test/ui/production-release-devices-webkit.spec.ts` (2 tests, skipped where WebKit is not installed).
On the local production build: those 8 pass, the whole `production-*` suite passed 478 of 479 (the one
failure was `ERR_NO_BUFFER_SPACE` on a crawl and passed on rerun), and the related preview specs
(date input, map, My Week, week dashboard, mobile review, Luna) passed 154 of 154.

## Test records

All five households were cleared with Settings, Privacy & data, Clear all app records (98, 113, 115 and
102 records reviewed on four; the fifth was confirmed cleared by returning to onboarding). None were kept.
