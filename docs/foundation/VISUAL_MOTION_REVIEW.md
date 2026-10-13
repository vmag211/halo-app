# App-wide visual and motion refinement

October12,2026. Editable review, not screen approval or production/backend integration.

## What changed

My Week has five original landscapes: Stillwater, Tidal light, Forest hush, Meadow light and Quiet cove. The new dwell is30 seconds of eligible visible time, followed by the existing3.6-second dissolve. Hidden, offscreen, paused, reduced-motion, higher-contrast and data-saving states do not advance the timer. Existing manual controls, on-demand loading, image-failure skip and Canvas fallback remain. Meadow and cove have their own conservative source-coordinate water masks; land and text remain still. These are1536px original artworks with independently animated frontend layers, not4K videos, live weather or actual user locations.

The earlier interface system could treat a long container as one entrance and miss its below-fold children. Discovery now chooses meaningful sections/rows and keeps existing Today/household Reveal ownership. Finite580ms/22px section entrances,360ms disclosures,380ms sheets and bounded stagger create a visibly connected reading sequence. Already focused editors skip entrance animation; pointer or keyboard interaction immediately ends an active entrance. No content starts hidden waiting for JavaScript, and no form remount is used to create movement.

Primary actions gain a single travelling highlight, a restrained teal edge glow and press feedback. Linked rows have subtle arrow travel. Image-led Explore controls gain a small photo-focus treatment on hover or keyboard focus. There are no hover-only actions or disclosures, no surprise photograph panels and no extra glows on destructive confirmation controls.

## Coverage

| Surface | Visual treatment and retained behavior |
| --- | --- |
| My Week | Five landscapes, visible-time rotation, calendar/agenda/group entrances, task/dialog/disclosure feedback. Existing dates, linked records, actions and task state remain. |
| Today and factors | Existing approved scene/Reveal ownership retained, reduced-motion precedence improved. No new scores or altered evidence. |
| Homeguard overview | Compact workspace and household illustration reveal independently on scroll. Existing workspace-before-house order and all entrances remain. |
| Home workspaces | Section-level coverage reaches nested test/report, maintenance, Food and Garden and summary surfaces. Existing tailored vector artwork remains rather than adding a photo to every form. |
| Household guides | Four compact original scenes map to seven categories: playroom for toddlers/children, study for teens/adults, quiet room for seniors/respiratory, garden for pregnancy. Existing category silhouettes, evidence, source links and qualifications remain. |
| Daily household guidance | Small factor-specific image bands in the four educational topics. Existing filtering, checklists and source links remain. |
| Explore | Independent community involvement, project, map and community entrances; deeper catalogue, guide, preparation, notes and outreach section coverage. |
| Understand your community | Water, air, ground/radon and facility visuals with matching restrained teal/sky/sage/lilac accents and icons. One correctly keyed scene per topic; map links, source qualifications, notes and independent outcomes remain. |
| Journal, Patterns and Season | Compact contextual scene without changing private notes, category/dates, recalled-day semantics, grid, missing-history state or export. Season switches the art without resetting drafts. |
| Outdoor plans | Garden scene and distinct morning/day/evening icons/accents. Forecast unavailability and explicit plan/watch semantics are unchanged. |
| Settings, alerts and shared layers | Group/row/section entrances, action feedback, dialogs, date pickers and disclosures use the shared system. Explicit Save/Cancel, retained drafts and privacy controls remain. |
| Map | Utility/district section entrances leave the map canvas and geographic coordinate system stationary. Existing contour controls remain separate. |

Existing onboarding, immutable archives, live StageRuntime household rendering and live routing are not redesigned by this pass. New household/family artwork is review-only. The task is an app-wide visual treatment, not a claim that every DOM element needs or receives an animation.

## Art direction and references

Original HALO navy/teal, sans fonts and430px mobile shell stay. Small sky, sage and lilac accents distinguish purpose without a rebrand. Regular rectangular image frames, feathered scene edges and local atmospheric light blend artwork into both themes. Decorative artwork never replaces measurements, source dates, safety qualifications or controls.

Apple's [motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion) and [feedback guidance](https://developer.apple.com/design/human-interface-guidelines/feedback), and Material's [motion system](https://m3.material.io/styles/motion), informed consistent, optional feedback and restrained transitions. HALO uses its own timing and ease-out, not copied branded assets or a claim of vendor endorsement. Multiple implementation and read-only visual-review perspectives informed this pass.

Exact built-in image-generation prompts, original source paths, optimized assets, hashes and masks are in [the new library manifest](VISUAL_LIBRARY_ASSETS.md). Seven new1536x1024 WebPs total1,757,860bytes; individual files are160,720 to379,706bytes. Only relevant scenes load, not the full library at app entry. Existing photographic credits remain separate and unchanged.

## Accessibility, performance and limits

Device reduced motion wins over the review's Full setting. Decorative layers pause offscreen, when the document is hidden, when ambient animation is off, and under data-saving/high-contrast conditions. Forced colors omit unnecessary artwork. Static images and all workflows remain available without motion; failed images retain the scene's reserved gradient space and readable guidance. Touch targets, keyboard feedback and focus continuity remain required.

Wallpaper Canvas stays capped at24 paints/second and1.5DPR. Editorial movement uses a few transform/opacity layers. The section observer is bounded and scans added subtrees rather than rereading the whole app on each keystroke. Typed input never restarts the page entrance.

Final test/build/preservation/publication evidence is in [the hosted receipt](../continuation/HOSTED_REVIEW.md). Browser QA is desktop Chromium mobile emulation, not physical-device battery/GPU/Safari certification. No live AI, opportunity/contact lookup, notification delivery, durable preference storage, scoring or backend integration was added. Vibhav's deferred whole-app integration handoff still applies.
