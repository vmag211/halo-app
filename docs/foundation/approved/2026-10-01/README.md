# Approved foundation screens, October 1, 2026

Yogi explicitly approved the current Today, Homeguard, factor, household, and Luna wireframes before production implementation. This archive freezes Site version 8 and is independent of the earlier onboarding archives.

- Approved Site source: `d703965f8348757b599fb04ef3b27b2a9d89916a`.
- Repository source freeze: `72a2c5150ecfe354fa6b534781e8b6b090d0bda1` on `codex/approved-stage-frontend`.
- `source.zip` contains the frozen frontend source, assets, exact copy, and preview test sources from that repository commit. `source-manifest.json` records SHA-256 digests for its files.
- `site-source.zip` preserves the exact approved Site source, including its font configuration and static-export entry points. `site-source-manifest.json` records its files' SHA-256 digests. Hosting metadata is excluded.
- `approved-export.tar.gz` contains the exact already-built Site export, including its locally served fonts and artwork. `export-manifest.json` records every exported file's SHA-256 digest. No rebuild is needed to replay it.
- `capture-report.json` records each screen's full product text, semantic elements and controls, heading, dimensions, loaded fonts, capture environment, and network checks. It is also the state, element, and copy inventory.
- `sha256-manifest.json` seals the archive, including the runner scripts and this document. `verify.cjs` is read-only. There is no baseline update mode.
- `replay-verification.json` records the successful byte-for-byte replay of all 132 images before sealing.

The 33 visual cases produce 132 PNGs: each at 320px and 375px in light and dark appearances. Coverage includes Today, Homeguard, all seven factor detail pages, Today family guidance, all seven Homeguard household categories, missing/partial/offline/real-zero/zero-contribution states for both overview pages, Luna initial and conversation states from Today and Homeguard, and Luna offline and missing-reading states. The exact case inventory is `visual-cases.cjs`.

[Open the screenshot gallery](INDEX.md).

The viewport is 850px high, DPR 1, locale `en-US`, timezone `America/New_York`, and browser clock October 1, 2026 at noon. Review query settings are `time=day`, `motion=reduce`, `scale=100`, and `contrast=false`. Only the review-control sibling outside the product is hidden. The product DOM, copy, layout, and styles are unchanged. Screenshots preserve the full scrollable page, with the fixed navigation at its original viewport position; Luna screenshots preserve the modal viewport and its scroll position. This avoids losing content below the first screen while retaining the actual floating controls.

The browser may only make GET/HEAD requests to the selected localhost origin. API paths, external requests, WebSockets, and service workers are blocked. Preview interactions use fixture state and never call the live backend. The runner fails if a forbidden request, browser exception, HTTP error, or horizontal overflow occurs.

## Verify and compare

Run from the repository root:

```powershell
node docs/foundation/approved/2026-10-01/verify.cjs
node docs/foundation/approved/2026-10-01/capture.cjs --output C:/Temp/halo-approved-replay
node docs/foundation/approved/2026-10-01/verify.cjs --candidate C:/Temp/halo-approved-replay
```

The replay extracts the frozen export to a newly created temporary folder and serves it on `127.0.0.1:3012`. The output folder must not already exist, and it must be outside this approval directory. The temporary export is retained for inspection. An occupied port fails rather than attaching to an unknown server.

To compare an existing local app's preview routes, replace the capture command with:

```powershell
node docs/foundation/approved/2026-10-01/capture.cjs --base-url http://127.0.0.1:3010 --output C:/Temp/halo-implementation-candidate
node docs/foundation/approved/2026-10-01/verify.cjs --candidate C:/Temp/halo-implementation-candidate
```

Exact comparison requires the recorded browser version, Playwright version, operating system, and architecture. GPU acceleration is disabled to avoid compositor variation, and each capture requires two consecutive byte-identical renders. A different environment fails with a clear explanation rather than silently weakening the comparison. Screenshots must be byte-identical. New visual approval belongs in a separate dated archive. Never run a snapshot update to accept a regression or edit these baselines after sealing.

`seal.cjs` was the one-time archive creation step. It refuses to run once the SHA-256 manifest exists. The source and export are deliberately preserved separately: the repository implementation can change while the approved Site export remains an independent, executable reference.
