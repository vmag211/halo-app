# Hosted wireframe preservation reference

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
