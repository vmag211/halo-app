# Approved mobile onboarding

Reviewed and approved September 29, 2026 on `codex/mobile-onboarding-polish`. The user authorized pushing the rounded mobile design to `main`, including lowercase “to” above all-caps “HALO”. Live onboarding now uses this layout. The immutable original archive remains the historical reference.

Open `/onboarding/preview?design=mobile` and use **Design** to compare the previous design with the approved mobile design without losing entered answers. All existing mock scenarios work with either design. The preview uses sample data and does not save answers or call live APIs. Production preview still requires `HALO_ENABLE_FRONTEND_PREVIEW=1`. The live `/onboarding` route uses the same mobile shell and styles with the existing real API bindings.

| Screen | Proposed change |
| --- | --- |
| Welcome | Rounded frame, curved gradient band, smaller logo presentation, centered description, pill button, viewport-aware height. The subtitle stacks “to” above all-caps “HALO”. Approved handwriting and subtitle timing remain intact. |
| Address | Round back button, thicker progress bars, consistent 24px gutters (18px on small phones), 56px fields and actions with softer corners. |
| Household | Two-column selection grid with a full-width final option for longer copy. Equal-weight actions and all seven groups remain. |
| Your home | Consistent spacing and rounded 56px form controls. Native select, optional year, validation, and field focus remain. |
| Results | Separate rounded cards. Each result sits below its label so neither is squeezed into a narrow column. Missing data, warnings, and risk colors remain distinct. |

Review images: [light overview](light-overview.png), [dark overview](dark-overview.png). Individual 375px phone captures are in `screenshots/`. These document the accepted revision without replacing the original archive. Regenerate only these review images with `node docs/onboarding/mobile-review/build-review.mjs` after the mobile browser tests.

Verified locally (initial proposal):

- Production build succeeds. The proposal's nine browser tests pass against `next start`, including full flows in light and dark at 320x568, 375x812, 430x932, and 1280x900; no horizontal overflow; immediate reduced-motion headings; visible Welcome action on short screens; validation focus; design switching without losing answers; and enlarged household text.
- The 36 existing browser checks pass, including immutable approved screenshots and handwriting timing.
- All 49 frontend unit tests pass. Type checking succeeds. ESLint reports zero errors and five existing warnings in unrelated files. All 204 preserved archive files pass integrity checks.

The review controls are external to the product captures. These checks use Chrome with simulated viewport dimensions; physical iPhone Safari and Android keyboard/safe-area checks remain unverified. Publishing to `main` uses the repository's existing Vercel deployment workflow.

The stacked subtitle revision retains the original subtitle in the previous-design comparison. Compact Welcome spacing preserves access to Get started on short phones. The proposal's nine browser checks, type checking, and lint for the modified frontend files were rerun for this revision. An additional browser check verifies that the real onboarding route renders the accepted shell, rounded band, and “to HALO” heading without making live API calls.

Release verification: all 354 unit tests and 46 browser tests pass. The optimized production build succeeds; 15 focused browser checks against `next start` also pass, covering the live design, responsive flows, preserved screenshots, and handwriting timing. Type checking and archive integrity checks pass. Lint has zero errors and the same five pre-existing warnings.
