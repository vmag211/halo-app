# HALO visual library additions

Prepared October 12, 2026 for the app-wide visual and motion refinement.

## Generation and use

All seven assets were generated as new images with the built-in `image_gen` tool (`image_gen__imagegen`, `transparent_background: false`). No CLI/API fallback, stock source or raster collage was used. The existing `week-lake.webp` and `personal-hero-editorial.webp` were visually inspected for HALO's cinematic natural-light style. They were not supplied as edit inputs, and no existing image was overwritten.

The landscapes are imagined decorative places. The home scenes are contextual artwork, not depictions of a user's household or evidence of health, safety or environmental quality. The facilities scene is not a photographed, geocoded or verified facility, and makes no claim about emissions, compliance or risk. The scenes contain no generated UI or intended text. Household imagery must not replace the actual guidance, labels or evidence.

Originals and runtime assets are all **1536 by 1024 pixels**, a regular **3:2** composition. Mechanical conversion with the installed Sharp library used `resize({width:1536,withoutEnlargement:true}).webp({quality:82,effort:6})`; no artistic edits were performed. Runtime assets total **1,757,860 bytes**. Load only relevant imagery, not this whole library on entry.

All original outputs were visually inspected. Optimized meadow and garden were additionally reopened to confirm their render. Source PNGs remain in the generated-images directory, and every deliverable WebP is stored in the project.

## Inventory

| Runtime file | Intended role | WebP bytes | Original PNG bytes |
| --- | --- | ---: | ---: |
| `public/preview-scenes/week-meadow.webp` | Fourth My Week wallpaper, meadow pond | 244,162 | 2,644,172 |
| `public/preview-scenes/week-cove.webp` | Fifth My Week wallpaper, coastal cove | 263,390 | 2,633,616 |
| `public/preview-scenes/care-playroom.webp` | Toddler and child household guidance | 160,720 | 2,445,119 |
| `public/preview-scenes/care-study.webp` | Teen and adult guidance, focused home work | 188,062 | 2,535,308 |
| `public/preview-scenes/care-rest.webp` | Adult, older-adult and respiratory guidance | 192,546 | 2,586,810 |
| `public/preview-scenes/care-garden.webp` | Family, pregnancy and general home guidance | 329,274 | 3,144,354 |
| `public/preview-scenes/community-facilities.webp` | Understand your community, facilities context | 379,706 | 3,219,724 |

## Wallpaper composition and animation masks

Coordinates below are normalized to the full original image, before any object-fit crop. They are conservative water-only regions, not environmental measurements. Map them using the same crop transform as the image and feather the clip boundary so the moving-water overlay blends with the static image. Do not move the land, cliffs or meadow plants as part of water displacement.

- **Meadow:** visible far shoreline is around `y=0.44`; begin displacement conservatively at `y=0.47`. Foreground grasses intrude from both sides below about `y=0.64`. Recommended polygon: `[[0.18,0.47],[0.84,0.47],[0.82,0.71],[0.70,1],[0.40,1],[0.25,0.75]]`. This leaves the foreground flowers and grass still, with the broad central pond animated.
- **Cove:** the central shoreline lies around `y=0.475`, with the right cliff reaching lower. The final visual review moved the animation start to `y=0.53` to keep every bank still. Implemented polygon: `[[0.02,0.53],[0.98,0.53],[0.98,1],[0.02,1]]`.

The user's new 30-second rotation supersedes the previous two-minute wallpaper timing. This asset manifest supplies imagery and masks only; the component implements rotation, pause, offscreen handling and reduced motion. These are still images with separately authored frontend animation, not generated 4K video or live weather.

## Exact prompt set and provenance

The following are the complete submitted prompts, without references or edit targets. All original paths are local provenance, not runtime dependencies.

### week-meadow

- Saved runtime path: `C:/Users/ympat/OneDrive/Documents/GitHub/halo-app/public/preview-scenes/week-meadow.webp`
- Original generated PNG: `C:/Users/ympat/.codex/generated_images/01a13267-6615-7522-b969-39ae095e0858/exec-106a8a4d-0510-49f5-90a0-7e2e4ce1dc2d.png`
- WebP SHA-256: `9fb80814a01379b6a42d5289e2f78ce5acdf7956c8387f0680841aa9bd0afdfc`

```text
Use case: stylized-concept
Asset type: original environmental illustration for HALO mobile application
Style/medium: premium cinematic environmental realism, photorealistic natural materials with a very subtle painterly finish, softly editorial and beautifully detailed, not an illustration with outlines and not plastic 3D.
Color palette: deep lake blue, atmospheric blue, muted sage and leaf greens, soft cream natural light with small restrained warm accents.
Composition/framing: landscape 3:2 rectangular image, 1536x1024 composition, no borders, balanced crop with primary subject in central 65 percent so it survives mobile cropping.
Constraints: imagined location, no people, no text, no typography, no letters, no diagrams, no logos, no watermark, no medical equipment or medical claims, no neon, no surreal shapes, no UI.
Primary request: a quietly beautiful meadow pond surrounded by soft sage grasses and scattered small warm white and pale yellow wildflowers.
Scene/backdrop: broad meadow and distant blue-green rolling wooded hills, pale blue sky with delicate cloud wisps, late afternoon natural light.
Composition/framing: camera low at the pond edge, far shoreline at 52 percent image height. Open still blue water with fine realistic ripples fills the lower 45 percent across the full center of the frame; only narrow meadow grasses at extreme lower side corners. No land, branches, lily pads or stones crossing central lower water. Reflections fade gently toward the foreground. Upper portion has textured meadow banks and open sky, expansive calm atmosphere.
```

### week-cove

- Saved runtime path: `C:/Users/ympat/OneDrive/Documents/GitHub/halo-app/public/preview-scenes/week-cove.webp`
- Original generated PNG: `C:/Users/ympat/.codex/generated_images/01a13267-6615-7522-b969-39ae095e0858/exec-f6b08fbf-3925-4665-a112-da0a7b516250.png`
- WebP SHA-256: `922877db22b121920c258387ef4aef6a1761afa7f0b55e23b3955cc2af0e590d`

```text
Use case: stylized-concept
Asset type: original environmental illustration for HALO mobile application
Style/medium: premium cinematic environmental realism, photorealistic natural materials with a very subtle painterly finish, softly editorial and beautifully detailed, not an illustration with outlines and not plastic 3D.
Color palette: deep lake blue, atmospheric blue, muted sage and leaf greens, soft cream natural light with small restrained warm accents.
Composition/framing: landscape 3:2 rectangular image, 1536x1024 composition, no borders, balanced crop with primary subject in central 65 percent so it survives mobile cropping.
Constraints: imagined location, no people, no text, no typography, no letters, no diagrams, no logos, no watermark, no medical equipment or medical claims, no neon, no surreal shapes, no UI.
Primary request: a peaceful coastal cove with softly layered cream limestone cliffs, sage coastal vegetation and clear tranquil blue sea.
Scene/backdrop: secluded uninhabited coast in early morning, delicate haze softening distant headlands, pale cloud wisps, gently luminous sky.
Composition/framing: viewpoint just above sea level from offshore. Cliffs occupy upper sides, shoreline around 45 percent image height; open blue sea occupies the entire lower 50 percent, clear center and lower region for animating water. No boats, no beach foreground, no rocks or land in the bottom half. Fine long low ripples with subtle reflected light rather than crashing surf. Natural asymmetry of the coast, clean balanced cinematic composition.
```

### care-playroom

- Saved runtime path: `C:/Users/ympat/OneDrive/Documents/GitHub/halo-app/public/preview-scenes/care-playroom.webp`
- Original generated PNG: `C:/Users/ympat/.codex/generated_images/01a13267-6615-7522-b969-39ae095e0858/exec-c61a5c53-1ae7-4e27-874a-43ad7c0675b3.png`
- WebP SHA-256: `58ced98b042ba8d487296dfdf6e2a2e705bbd1d2a14f30b69725109e6b88f086`

```text
Use case: stylized-concept
Asset type: original environmental illustration for HALO mobile application
Style/medium: premium cinematic environmental realism, photorealistic natural materials with a very subtle painterly finish, softly editorial and beautifully detailed, not an illustration with outlines and not plastic 3D.
Color palette: deep lake blue, atmospheric blue, muted sage and leaf greens, soft cream natural light with small restrained warm accents.
Composition/framing: landscape 3:2 rectangular image, 1536x1024 composition, no borders, balanced crop with primary subject in central 65 percent so it survives mobile cropping.
Constraints: imagined location, no people, no text, no typography, no letters, no diagrams, no logos, no watermark, no medical equipment or medical claims, no neon, no surreal shapes, no UI.
Primary request: an airy, uncluttered family playroom corner, a low natural oak toy shelf with a few large wooden play pieces, a soft pale blue cotton rug and wide window looking onto leafy trees.
Scene/backdrop: lived-in but tidy modern home, healthy-looking ordinary interior without any health claim, muted sage wall and cream linen curtains, no people.
Composition/framing: comfortable eye-level view from the doorway, main shelf and rug centered, window light crossing the floor, generous breathable space, only a handful of carefully arranged ordinary toys.
Lighting/mood: clear soft morning light, natural wood grain and tactile fabric, calm and welcoming.
```

### care-study

- Saved runtime path: `C:/Users/ympat/OneDrive/Documents/GitHub/halo-app/public/preview-scenes/care-study.webp`
- Original generated PNG: `C:/Users/ympat/.codex/generated_images/01a13267-6615-7522-b969-39ae095e0858/exec-c38e8870-8f68-4d8c-8038-3a44c022b35e.png`
- WebP SHA-256: `5745adfa2c6ab475cd773c5fa3d2376663ab6916d157edbd5f8f650fb99af206`

```text
Use case: stylized-concept
Asset type: original environmental illustration for HALO mobile application
Style/medium: premium cinematic environmental realism, photorealistic natural materials with a very subtle painterly finish, softly editorial and beautifully detailed, not an illustration with outlines and not plastic 3D.
Color palette: deep lake blue, atmospheric blue, muted sage and leaf greens, soft cream natural light with small restrained warm accents.
Composition/framing: landscape 3:2 rectangular image, 1536x1024 composition, no borders, balanced crop with primary subject in central 65 percent so it survives mobile cropping.
Constraints: imagined location, no people, no text, no typography, no letters, no diagrams, no logos, no watermark, no medical equipment or medical claims, no neon, no surreal shapes, no UI.
Primary request: a beautifully simple, light-filled home study nook with a pale oak desk, an open blank notebook and pencil, blue upholstered chair, and a broad window framing leafy green trees.
Scene/backdrop: modern everyday home, blue-green painted wall, one small plant beside the window, softly folded cream curtain.
Composition/framing: eye-level three-quarter desk view with the notebook, desk and window in the central composition, no computer screen or visible writing, uncluttered and breathable.
Lighting/mood: elegant natural afternoon light, subtle blue shadows, warm wooden texture, focused calm mood.
```

### care-rest

- Saved runtime path: `C:/Users/ympat/OneDrive/Documents/GitHub/halo-app/public/preview-scenes/care-rest.webp`
- Original generated PNG: `C:/Users/ympat/.codex/generated_images/01a13267-6615-7522-b969-39ae095e0858/exec-2ed49b13-735a-4956-9b57-f3b2929c13c3.png`
- WebP SHA-256: `f37a068394c10ff8440a1e2b84efff0f44cbe8790f36300ea76a8c0f11f30082`

```text
Use case: stylized-concept
Asset type: original environmental illustration for HALO mobile application
Style/medium: premium cinematic environmental realism, photorealistic natural materials with a very subtle painterly finish, softly editorial and beautifully detailed, not an illustration with outlines and not plastic 3D.
Color palette: deep lake blue, atmospheric blue, muted sage and leaf greens, soft cream natural light with small restrained warm accents.
Composition/framing: landscape 3:2 rectangular image, 1536x1024 composition, no borders, balanced crop with primary subject in central 65 percent so it survives mobile cropping.
Constraints: imagined location, no people, no text, no typography, no letters, no diagrams, no logos, no watermark, no medical equipment or medical claims, no neon, no surreal shapes, no UI.
Primary request: a peaceful living-room reading corner with a supportive soft blue armchair, a folded cream blanket, a small natural wood side table with a closed unlabelled book, and leafy trees through a bright window.
Scene/backdrop: inviting modern home, sage accents, one graceful green houseplant off to the side, uncluttered ordinary domestic space.
Composition/framing: eye-level wide three-quarter composition, chair and window view occupy the central portion, clear floor space and believable room proportions.
Lighting/mood: soft natural late afternoon light and gentle blue-green shadows, beautifully rendered cotton, wood and glass, welcoming calm.
```

### care-garden

- Saved runtime path: `C:/Users/ympat/OneDrive/Documents/GitHub/halo-app/public/preview-scenes/care-garden.webp`
- Original generated PNG: `C:/Users/ympat/.codex/generated_images/01a13267-6615-7522-b969-39ae095e0858/exec-70a4cc04-fa77-49ff-b2e1-751f7a611d59.png`
- WebP SHA-256: `95250a9e3189167f1681f6bce8c95d4a0a7c6470319f8fd7c83f011c5ae67acc`

```text
Use case: stylized-concept
Asset type: original environmental illustration for HALO mobile application
Style/medium: premium cinematic environmental realism, photorealistic natural materials with a very subtle painterly finish, softly editorial and beautifully detailed, not an illustration with outlines and not plastic 3D.
Color palette: deep lake blue, atmospheric blue, muted sage and leaf greens, soft cream natural light with small restrained warm accents.
Composition/framing: landscape 3:2 rectangular image, 1536x1024 composition, no borders, balanced crop with primary subject in central 65 percent so it survives mobile cropping.
Constraints: imagined location, no people, no text, no typography, no letters, no diagrams, no logos, no watermark, no medical equipment or medical claims, no neon, no surreal shapes, no UI.
Primary request: a quiet family home porch overlooking a modest thriving garden, with a simple oak potting bench, a few seedlings in terracotta pots, a small raised vegetable bed beyond and leafy trees.
Scene/backdrop: a real-looking modest cared-for garden with sage foliage, pale blue morning sky, natural wood porch and soft cream house wall.
Composition/framing: view from the porch toward the raised bed, seedlings and garden occupy center, visually uncluttered with a few natural tools neatly set aside, no food still life or people.
Lighting/mood: crisp soft morning light with gentle tree shadows, finely detailed leaves, soil and wood, fresh and reassuring rather than oversaturated.
```

### community-facilities

- Saved runtime path: `C:/Users/ympat/OneDrive/Documents/GitHub/halo-app/public/preview-scenes/community-facilities.webp`
- Original generated PNG: `C:/Users/ympat/.codex/generated_images/01a13267-6615-7522-b969-39ae095e0858/exec-ed36321c-1447-4b05-b19e-aca824a5d9df.png`
- WebP SHA-256: `aafc9ccd4cb761547673eccd37a9e4cab5e89f239fcebf0e78d4b23404bb489e`

```text
Use case: stylized-concept
Asset type: original environmental illustration for HALO mobile application
Style/medium: premium cinematic environmental realism, photorealistic natural materials with a very subtle painterly finish, softly editorial and beautifully detailed, not an illustration with outlines and not plastic 3D.
Color palette: deep lake blue, atmospheric blue, muted sage and leaf greens, soft cream natural light with small restrained warm accents.
Composition/framing: landscape 3:2 rectangular image, 1536x1024 composition, no borders, balanced crop with primary subject in central 65 percent so it survives mobile cropping.
Constraints: imagined location, no people, no text, no typography, no letters, no diagrams, no logos, no watermark, no medical equipment or medical claims, no neon, no surreal shapes, no UI.
Primary request: an imagined small riverside industrial and civic infrastructure district, seen from a green public riverbank. A few modest low-rise brick and blue-gray metal service buildings, understated utility structures and one slender distant stack without any emissions, sit beyond the water with trees between them.
Scene/backdrop: contemporary ordinary working town and green river corridor, not a famous real location, blue-green water, sage trees and hazy blue hills.
Composition/framing: landscape three-quarter panoramic view, useful buildings clearly identifiable in central two-thirds, river lower third, soft sky upper third, no people or traffic foreground.
Lighting/mood: clear soft morning light, natural brick, metal, foliage and water textures, thoughtful balanced environmental editorial scene, neither alarmist nor utopian.
Constraints: no smoke, steam, pollution plumes, warning colors, hazard symbols, monitoring overlays, labels, brand marks or text. Does not visually assert pollution, safety, regulatory status or a real mapped facility.
```

