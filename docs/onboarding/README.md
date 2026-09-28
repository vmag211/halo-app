# Onboarding frontend

Run `npm ci` and `npm run dev`, then open `/onboarding/preview` to review the functioning onboarding with labeled sample data. This development-only route does not create accounts, save answers, or call a live API. Its selector covers loading, errors, missing data, wells, springs, and outside-NC cases. Production builds hide it unless `HALO_ENABLE_FRONTEND_PREVIEW=1` is deliberately enabled.

The real entry is `/`, which routes through `/onboarding?entry=1`. `/onboarding?change=1` starts address replacement. These real routes use existing Supabase authentication and may write to the configured backend, so do not use them for disposable testing against production.

- [Approved design and preservation](preservation.md)
- [Offline interactive wireframe](approved/halo-onboarding-wireframes.offline.html)
- [Vibhav's API integration handoff and release gates](integration.md)
- [Requirements checklist](requirements-checklist.md)
- [Verification record](verification.md)

Checks: `npm test`, `npm run test:frontend`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run preservation:verify`. `npm run test:ui` starts/reuses a loopback development server on port 3010 and uses installed Google Chrome. Browser tests block external and live API requests. Visual comparisons use immutable approved PNGs; never update them to make a regression pass.

Onboarding hands off to an explicitly labeled `/today` integration boundary. The Today dashboard is the next feature, not a finished screen in this change. Live-provider and physical-phone acceptance remain separate from mocked frontend verification. See the dependency release gate before deployment.
