# Environmental ambience and interface motion

October 12, 2026. Editable wireframe review only. This is not approval of new screens or production/backend delivery.

The subsequent [visual-coverage refinement](VISUAL_MOTION_REVIEW.md) supersedes the three-scene/two-minute values below with five scenes and30-second eligible visible-time rotation. Other renderer/fallback semantics remain. The original three-asset provenance stays intact.

## Direction

My Week gains an edge-to-edge environmental welcome scene instead of a separate wallpaper card. Three original landscapes keep HALO's blue, teal and sage palette: a dawn lake, coastal estuary and woodland stream. The calendar, task model, tab order, typography and mobile shell remain intact.

The reference principles are slow cinematic landscapes, independent environmental detail, and brief purposeful interface feedback. Apple's [Sonoma landscape screensavers](https://www.apple.com/ca/newsroom/2023/06/macos-sonoma-brings-new-capabilities-for-elevating-productivity-and-creativity/) demonstrate the ambient visual direction. Apple's [motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion) supports short, optional, task-relevant motion without obscuring content. These are design references, not claims that HALO uses Apple's video assets or rendering technology.

## Authored animation

- My Week uses generated raster art plus genuinely animated, source-coordinate-masked water, drifting mist, sunlight and minimal foreground reeds. Mountains, banks and text stay stationary. This is layered frontend animation, not pre-rendered 4K video, live weather or the user's actual location.
- Scenes advance after two minutes of eligible visible time, then dissolve. Pause and Next landscape are keyboard/touch accessible. Automatic changes are decorative and do not announce as user activity.
- Image generation mode, exact prompts, original source paths, asset dimensions/bytes and water masks are recorded in [the asset manifest](WEEK_AMBIENCE_ASSETS.md). Runtime assets are repository-owned optimized WebP files; no generation service runs in the browser.
- The shared interface motion component enhances meaningful surfaces as they enter view, new dialogs/date pickers and opened disclosures. It does not remount features or animate each text node. Interacting with a moving surface immediately ends its entrance.
- Existing Today/Homeguard/factor scenes gain layered atmospheric light and water shimmer, while retaining approved artwork and layout. The original onboarding and archived approvals are untouched.

## Accessibility and resource controls

New motion respects device reduced motion, including when external review controls request full motion. Text and actions are rendered immediately. Shared transitions are short and optional; animation does not convey task completion, urgency or environmental values.

Wallpaper rendering and rotation suspend when offscreen, hidden, explicitly paused, ambient animation is disabled, or reduced motion/high contrast/data-saving settings apply. Still artwork and manual scene selection remain useful without continuous movement. The water renderer is capped at24 paints per second and1.5 device pixel ratio. A static image remains if Canvas is unavailable. Images are loaded on demand, not all at homepage entry or on Today.

Settings' existing ambient switch controls the scene family. Pause and selected landscape are temporary presentation state, not task records. Durable per-user wallpaper preferences would need the existing proposed display-preference contract; no backend integration was added for this visual pass.

## Verification

Final browser, build, preservation and publication evidence is recorded in the latest [hosted review receipt](../continuation/HOSTED_REVIEW.md). Browser testing is desktop Chromium mobile emulation, not physical-device GPU, thermal, Safari or WCAG conformance certification.
