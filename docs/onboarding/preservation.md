# Approved onboarding design preservation

Approval baseline: September 28, 2026. This archive freezes the last user-approved interactive onboarding wireframe, including the final **Welcome / To Halo** treatment. It is the visual reference for implementation, not a new design proposal.

## What is saved

| File or folder | Purpose |
| --- | --- |
| `approved/halo-onboarding-wireframes.fragment.html` | Original editable fragment, copied byte for byte from the approved conversation preview. Do not rewrite or prettify this baseline. |
| `approved/halo-onboarding-wireframes.html` | Standalone interactive export produced with the visualization export helper. Retains its original external resource references. |
| `approved/halo-onboarding-wireframes.offline.html` | Self-contained standalone export with the same fragment, fonts, logo, icon library, and preview helpers embedded. Open this file in a browser to review the complete design without a network connection. |
| `approved/assets/` | Frozen logo files, exact Google Fonts resources, versioned preview libraries, and their font/library licenses. |
| `approved/screenshots/` | All 44 selectable design states at 375 px and 320 px in both light and dark appearances, plus three handwriting-animation reference frames. |
| `approved/capture-report.json` | Browser version, capture dimensions, state names, font-load checks, overflow checks, and animation/interactive-flow verification results. |
| `approved/sha256-manifest.json` | SHA-256 and byte count for every archived file and source reference. |
| `reference/HALO_Frontend_Specification.pdf` | Exact copy of the user-supplied frontend plan. |
| `reference/HALO_Codex_Context.md` | Exact copy of the user-supplied full-app context document. |

Original fragment SHA-256:

```text
b645c9fd080a4d7893dc52b320d0ed799dd5bc628af08ff7366f34ca09132566
```

The archived fragment's checksum was compared with the actual approved source in the conversation's visualization directory. They match. The original source was not modified by preservation or implementation work.

## Approved visual and interaction decisions

- Welcome has a 220 px navy-to-teal gradient band and the white shield, house, and leaf mark. The old blue square is not displayed.
- The centered teal **Welcome** heading is the exact approved pen-centerline drawing, not a substituted cursive font, horizontal reveal, or tracing of letter outlines.
- The smaller, lighter, centered **To Halo** subtitle uses Fraunces and begins fading only after the handwriting finishes.
- Both headings appear immediately with reduced motion. Get started is never gated by the decorative animation.
- The description and No account needed copy follow the headings. The approved footer, controls, spacing, form layouts, and results treatment remain the baseline.
- Fraunces is used for editorial headings and Instrument Sans for body text and controls. Archived WOFF2 files preserve the fonts used by the approved browser preview.
- The default design settings are brand fidelity, system appearance, 220 px band, 14 px radius, 20 px gutter, 56 px Welcome sizing, and handwriting enabled.
- The compact product surface is 375 px maximum width. Reference captures also cover the 320 px layout. The original preview includes a 1 px product border and a 710 px minimum content height.
- Household has seven selectable groups and equal-weight Skip this / Continue actions.
- Missing, unavailable, private-well, spring, and outside-North-Carolina results remain distinct from reassuring results.
- No em dashes are permitted in app-facing text. The original source documents are preserved as historical references, including their original punctuation. Later user decisions supersede conflicting design or punctuation instructions in them.

### Color baseline

| Token | Light | Dark |
| --- | --- | --- |
| Page | `#eef8f7` | `#081725` |
| Card | `#ffffff` | `#0f2436` |
| Main text | `#0b1f33` | `#e8f3f5` |
| Secondary text | `#4a6275` | `#9bb4c2` |
| Primary teal | `#0e5e6f` | `#2cc4bd` |
| On primary | `#ffffff` | `#081725` |
| Border | `#d3e4e6` | `#1d3a50` |
| Selected tint | `#d9f0ef` | `#1d4f5c` |
| Error | `#c0262d` | `#f0605f` |
| Good | `#1e7a3c` | `#4cc27a` |

The full original CSS is preserved in the fragment, including controls, focus states, spacing, animations, and responsive adjustments. This table is an index, not a replacement for it.

### Handwriting baseline

`components/onboarding/lettering.ts` preserves the original seven glyph definitions and curve sampling. `WelcomeTitle.tsx` uses the same geometry, line width, centering, and timing:

- 180 ms lead-in.
- 2,600 ms drawing time, allocated by stroke length.
- 30 ms pen lift between strokes.
- 90 ms gap after handwriting before the subtitle starts.
- 400 ms subtitle fade.
- 51-unit round-cap, round-join pen width in the glyph coordinate space.
- Device-pixel-ratio-aware canvas, capped at 3, with redraw on resize and theme changes.

The glyph data carries the Hershey acknowledgements in both the preserved source and production lettering module. The visible stroke asset spells English Welcome. A future translated title needs a corresponding approved lettering asset as well as translated accessible text.

## Preserved state inventory

| Screen | States |
| --- | --- |
| Welcome (4) | Ready; starting session; verification failed; session failed. |
| Address (12) | Empty; address entered; location selected; location denied; location unavailable; address too short; address not found; finding local data; too many requests; connection/server error; request timed out; offline. |
| Household (5) | Nothing selected; some groups selected; all groups selected; saving; save failed. |
| Your home (8) | Empty; home details entered; year left blank; invalid build year; future build year; water not selected; saving; save failed. |
| Results reveal (15) | Public water above limit; public water below limits; checks in progress; private well; spring; no utility match; no published water results; only unregulated compounds; water lookup unavailable; radon unavailable; outside North Carolina; air no data; air request failed; home request failed; all requests failed. |

These are prototype scenarios, not live environmental readings or backend responses. Saving the wireframe does not certify its sample results as accurate for any real address. Backend-driven states in the implementation must reflect actual API results.

## Review and verification

1. Open `approved/halo-onboarding-wireframes.offline.html` in a browser.
2. Use Screen and State to inspect all variants. The original design adjustment controls remain available in the export.
3. Use a fresh browser profile or clear this file's saved preview state to return to default review settings.
4. Compare production screens with the screenshots at the same viewport width, appearance, and completed-animation state. Compare interaction and animation against the interactive export, not only the PNGs.
5. Use the manifest check before treating an archived file as the unchanged approval baseline:

```sh
node docs/onboarding/approved/check-integrity.cjs
```

The screenshot capture opens the self-contained export with browser networking disabled. It exercises every state in both appearances and widths, checks loaded fonts and horizontal overflow, verifies handwriting precedes subtitle appearance, confirms Get started stays usable during animation, and completes a mocked onboarding flow offline.

The report's Welcome font checks show `false` for two unused faces (Instrument Sans 400 and Fraunces 600). This is not a fallback-font screenshot: separate Chrome font inspection confirmed actual Welcome text uses Instrument Sans Medium and Fraunces 400. Replaying the capture reproduced the archived light/375 Welcome PNG byte for byte. The app's body weight 500 reproduces the preview host's inherited 430, which resolved to its available 500 face. Production WOFF2 files match the archived resources by SHA-256. The immutable report is retained unchanged.

The implementation adapts the product surface to a real device: it may grow to 430 px wide and uses the viewport height plus safe-area insets. It does not force a 710 px phone mockup onto every screen. At matching 320/375 px widths, the development preview retains the reference's 710 px content height for automated comparisons. Comparisons hide only the external development toolbar and Next development indicator, so their fractional positioning or overlays cannot distort the product capture. Production navigation additionally moves keyboard focus to the new heading; that accessibility outline is not a redesign.

Maintenance helpers are kept with the archive. `download-assets.ps1` deliberately refetches external assets, `build-offline-export.cjs` embeds their bytes into the standalone export, and `capture-archive.cjs` regenerates screenshot evidence. Do not run a refresh merely to hide differences from the baseline. Any intentional design revision requires user approval, a new recorded baseline, and review before regenerating the checksum manifest with `--write`.

## Version control and scope

Include this archive, reference documents, assets, frontend source, tests, and integration notes in the same reviewed repository change. A Git commit makes the saved version recoverable locally; a push adds a remote copy. File creation alone is not a claim that a commit or GitHub push has occurred.

The archive preserves the approved design independently of chat memory. It does not freeze all future backend behavior, guarantee identical font antialiasing on every operating system, or authorize unapproved design changes. Production implementation should preserve the approved appearance while adding real validation, accessible behavior, session handling, and honest backend-derived states.
