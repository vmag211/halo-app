# My Week ambience artwork

Created October 12, 2026 for HALO's editable full-app wireframe.

This manifest preserves the original three scenes. The subsequent [visual library](VISUAL_LIBRARY_ASSETS.md) adds meadow and cove wallpapers, completing a five-scene rotation, alongside household/community artwork. The new dwell setting is30 seconds of eligible visible time.

## Provenance and use

These are three original AI-generated environmental illustrations, made with the built-in `image_gen` tool in generation mode. No CLI/API fallback was used. The existing `public/preview-scenes/personal-hero-editorial.webp` was visually inspected as an art-direction reference, but was not submitted as an image input or altered. All three new images were generated independently from the exact prompts below.

The scenes depict imagined places. They are decorative ambience, not the user's location, a weather observation, a forecast, or environmental evidence. No stock image, external photographer attribution, registered event, map tile, or live-data claim is involved.

The runtime files below are optimized WebP copies. Source PNGs remain in the image tool's original local generation folder, so no generated source was overwritten or deleted. The app references only the repository assets.

## Runtime inventory

| File | Dimensions | Bytes | Description |
| --- | --- | ---: | --- |
| `public/preview-scenes/week-lake.webp` | 1536 × 1024 | 162,488 | Blue dawn mountain lake |
| `public/preview-scenes/week-coast.webp` | 1536 × 1024 | 181,782 | Silver-blue coastal estuary |
| `public/preview-scenes/week-forest.webp` | 1536 × 1024 | 383,758 | Woodland stream and reflective pool |

Total runtime image payload: 728,028 bytes before HTTP transfer overhead. Mechanical conversion used installed Sharp, WebP quality 84, effort 6, with no resizing, compositing, recoloring, or generated-art changes. These are 1536-pixel still-image sources for a layered animated scene, not native 4K video.

## Animation region guidance

Coordinates are normalized in the original image, with (0, 0) at top left. A cover-cropped canvas must transform these source coordinates into destination coordinates rather than treating the waterline as a fixed percentage of the crop.

- **Lake:** water begins around y = 0.508. The center x = 0.15 to 0.85 remains clear down to the bottom. Foreground reeds occupy only the far lower corners, mostly below y = 0.78. Low-amplitude horizontal water displacement can extend across the broad lake while masking foreground reeds.
- **Coast:** center water starts around y = 0.45, but side marsh banks extend to y = 0.61. A conservative animated water region begins at x = 0.35 to 0.65 near y = 0.49, widens to x = 0.20 to 0.82 by y = 0.61, and stays between x = 0.25 and 0.80 near the bottom to keep reeds stable.
- **Forest:** center water starts around y = 0.51. Banks encroach on the outer edges until y = 0.57. Use a widening mask from x = 0.43 to 0.62 at y = 0.52 to x = 0.16 to 0.85 below y = 0.60; leave the extreme bank edges and stones stationary.

Keep mountains, tree trunks, and marsh banks stable. Independent water, mist, light, and minimal vegetation movement should be low-amplitude and calm. Animation belongs to the authored frontend, not the raster tool output. Respect the app's ambient setting, explicit pause, reduced motion, document visibility, and offscreen suspension. Never make visual motion imply live weather or pollutant transport.

## Source originals

Tool output folder: `C:/Users/ympat/.codex/generated_images/01a13240-f060-7250-81c2-9a642099f690/`

- Lake: `exec-54fa4377-8f1b-48c1-a408-9540ecf47ed1.png`
- Coast: `exec-e1df64b6-c76e-4241-8b99-0c1788852e7b.png`
- Forest: `exec-f8131889-b04f-4610-9fc1-ba73a8fe3c15.png`

Originals are retained outside the deployed runtime. Reproducible runtime sources and complete prompt provenance are in this repository.

## Exact final prompts

### Blue dawn lake

```text
Use case: stylized-concept
Asset type: original environmental wallpaper for the HALO mobile homepage, a calm background later animated in code.
Primary request: a cinematic mountain lake at blue dawn, with layered blue mountain ridges, a forested distant shore and beautifully detailed calm water.
Style/medium: refined editorial landscape art with photorealistic textures and subtle painterly softness, the polish of a high-end ambient nature screensaver, not a photograph of a screen.
Composition/framing: wide 3:2 rectangular landscape. Gentle open sky across the upper third. Distant shore meeting the lake at about 55% of image height. Broad uninterrupted water from 55% through the bottom edge, especially the central 80% width, with fine small natural ripples and mountain reflections. A few slender reeds only at the far lower corners. Quiet center that crops elegantly into a mobile viewport.
Lighting/mood: first soft dawn light, airy wisps of mist near the distant shore, deep but readable foreground, luminous atmospheric depth.
Color palette: HALO navy and slate blue, muted teal water, sage green trees, pale silvery blue sky, only a trace of warm dawn light.
Constraints: original imagined place, no people, no buildings, no animals, no text, no logos, no watermark, no frames, no interface. No neon, no fantasy glow, no oversized moon or sun. Restrained, natural, detailed and believable.
```

### Coastal estuary

```text
Use case: stylized-concept
Asset type: original environmental wallpaper for the HALO mobile homepage, a calm background later animated in code.
Primary request: a cinematic coastal estuary and salt marsh in luminous early morning, a broad quiet blue-green tidal channel winding past distant sage-green reed banks toward the sea.
Style/medium: refined editorial landscape art with photorealistic textures and subtle painterly softness, the polish of a high-end ambient nature screensaver, not a photograph of a screen.
Composition/framing: wide 3:2 rectangular landscape. Soft open sky in the upper third, horizontal far estuary shoreline around 52% of image height. Broad uninterrupted reflective water occupies the central 80% width from 55% down to the bottom edge. Low marsh banks frame the outer edges without cutting across the center. Sparse fine grasses at far lower corners only. Distant landscape reads clearly through a mobile crop.
Lighting/mood: soft silver-blue morning light filtered by long wispy clouds, delicate haze on the horizon, gentle real water ripples and reflected sky.
Color palette: HALO navy, soft teal water, sage and muted olive marsh grasses, pale cool blue clouds with slight warm ivory highlights.
Constraints: original imagined place, no people, no buildings, no boats, no animals, no text, no logos, no watermark, no frames, no interface. No neon, no exaggerated tropical turquoise or sunset orange. Calm, sophisticated, environmentally grounded.
```

### Woodland stream

```text
Use case: stylized-concept
Asset type: original environmental wallpaper for the HALO mobile homepage, a calm background later animated in code.
Primary request: a cinematic woodland stream widening into a serene reflective pool within a lush temperate forest, with delicate morning mist and soft sun rays through mature trees.
Style/medium: refined editorial landscape art with photorealistic textures and subtle painterly softness, the polish of a high-end ambient nature screensaver, not a photograph of a screen.
Composition/framing: wide 3:2 rectangular landscape. Layered tree canopies above and airy blue-silver opening near upper center. A distant forest bank and stream entering the pool at about 55% image height. Broad calm pool occupies the central 75% width from 60% to the bottom edge, with tiny current ripples and reflected trees. Mossy banks frame far outer edges only, no large rocks or logs across the central water. Compose for an elegant central mobile crop.
Lighting/mood: soft dappled cool morning light, subtle mist, authentic moss and bark detail, luminous but not theatrical, layered atmospheric depth.
Color palette: HALO deep navy shadows, muted teal water, rich natural sage and forest green, silvery pale blue haze with restrained warm light.
Constraints: original imagined place, no people, no buildings, no animals, no text, no logos, no watermark, no frames, no interface. No fantasy or neon glow. No waterfall and no dramatic whitewater. Calm, refined and believable.
```

## Visual inspection

All generated outputs were inspected in full before conversion. All final WebP outputs were inspected after conversion. They retain natural layered scenery, regular rectangular framing, open water for controlled motion, and restrained HALO-compatible colors. No people, interface, visible text, logo, watermark, or unnatural neon light was found. There is a small distant natural stream cascade in the woodland output despite the prompt's no-waterfall direction; it remains secondary, with the foreground being the requested quiet reflective pool. Do not animate the distant cascade as measured flow.
