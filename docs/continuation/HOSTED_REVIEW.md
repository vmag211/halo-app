# Hosted wireframe preservation reference

## Current review: Explore, October 9, 2026

Version 23 is deployed at the same URL with the existing public audience. Visible tabs are Today, Homeguard, Explore and My Week. Explore now contains the A01-A06 rough sample screens: hub/map entrance, organizations, opportunities and participation, project steps, independent outreach drafts and text-only private field notes. See `components/expanded/EXPLORE_REVIEW.md` for coverage and deliberate limits. No live source, registration, agency receipt or private persistence is implied.

- Version ID: `appgprj_6abd679629688191ae2eea6173fb2b49~appgver_c3a87faaad748191a6d9ee1c4d3ab67c`.
- Source commit: `e36bf5d9fe658f0258a0f3e23b7cd8041e17cb2a`.
- Successful deployment ID: `appgdep_6ac97107fdc88191a64bd54bb282db30`.
- Archive hash: `sha256:5dacd68f5af8b1beefded00fde4fbd95e3103767c77a3d06024213507ed04470`.
- Verification: main TypeScript, isolated static build, scoped lint, ownership/date logic tests, Explore interaction and light/dark narrow-layout checks, existing expanded/Homeguard/hosted regressions, map suite and map-return recheck, and both approval archive integrity checks. Two outdated exact-label test selectors were corrected and their tests passed. No screenshot baseline was updated. Physical Safari, real source verification and authenticated production workflows remain unverified.

## Earlier Homeguard review, October 9, 2026

Version 22 is deployed at https://halo-wireframe-review.yogirajapaturi.chatgpt.site with the existing public audience. Homeguard's four-link footer is now a Home workspace with distinct section layouts, shared sample-record counts and continuation, direct record/create entries, a focus-aware overview jump, and successful PDF creation metadata. These remain sample review workflows awaiting visual approval and production integration.

- Version ID: `appgprj_6abd679629688191ae2eea6173fb2b49~appgver_cf0419fb27e881918fd07aafab3a0baf`.
- Source commit: `5eb726d1e32d28898acbb334d8740ed01a1829f4`.
- Successful deployment ID: `appgdep_6ac96c0c7a10819181db98685531b7af`.
- Archive hash: `sha256:64f74fa3f22b1a26c79829eac976ad8fba1f68243cfba0380db9fb258c4e9fbc`.
- Verification: static build, main TypeScript, 26 distinct browser checks across workspace/navigation/order/hosted isolation/PDF suites, and both immutable archive checks. Mobile checks include light/dark at 375px and 320px with 150% text. Physical Safari and authenticated backend workflows were not tested.

## Transfer reference, October 8, 2026

The existing Site metadata and saved version were checked on October 8, 2026. Latest saved version reported: 21. Live URL: https://halo-wireframe-review.yogirajapaturi.chatgpt.site . Site status: active.

- Site ID: `appgprj_6abd679629688191ae2eea6173fb2b49`.
- Version ID: `appgprj_6abd679629688191ae2eea6173fb2b49~appgver_c4ff19812f0081919473ba0067ed6150`.
- Version 21 source commit: `69715932b6e5f6fad9ec31fa2597c4c24978a745`.
- Recorded deployment ID: `appgdep_6ac28911187881918815d6c9c3efe327`.
- Saved source archive hash returned by Sites: `sha256:dfb82212dd3daf50ff39cc30701dd42812dac671650c3d70b502250307f1eff8`.

The source checkout was also checked: clean working tree, matching version 21 commit.

Local isolated Site checkout:
`C:/Users/ympat/.codex/visualizations/2026/09/27/01a0e4c3-0adc-7fd2-a0d0-80c0591c6bb2/halo-phone-preview`.

Its `.openai/hosting.json` names the same project and `out` static directory. Reuse that identity. Main application source and production API/auth routes must not replace its static-only wrappers. Use `scripts/sync-hosted-wireframe.mjs` only as documented, followed by appropriate static/provider-isolation checks and Sites publication confirmation.

A copy of the previously tested compiled review is preserved at `artifacts/halo-homeguard-corner-delete-20261004.tar.gz`. This compiled archive is different from the saved source archive above and has its own checksum in `artifacts.sha256`. It contains the static `dist` export, CSS, fonts, illustrations and route output. Extract only into a new temporary directory and use `scripts/serve-wireframe-export.mjs` to inspect an export locally. Do not extract over project source or approved archives.

Original compiled archive location:
`C:/Users/ympat/.codex/visualizations/2026/09/27/01a0e4c3-0adc-7fd2-a0d0-80c0591c6bb2/halo-homeguard-corner-delete-20261004.tar.gz`.

The surrounding visualization workspace retains older exports and the original onboarding HTML. The approved onboarding and foundation repo archives are the permanent historical baselines; newer checkpointed code is the current editable review, not another approval archive.

No Site publication or audience change was performed by the continuation transfer. Historical READMEs that call version 19 current were not rewritten; this reference records the newer verified metadata.
