# HALO App

Current frontend branch: `codex/october15-review-refinement`. Vibhav's complete current wiring packet is [HALO_BACKEND_WIRING_CURRENT.md](docs/product/HALO_BACKEND_WIRING_CURRENT.md), with [current status and backend gaps](docs/continuation/FRONTEND_WIRING_CLOSEOUT.md) and [verification evidence](docs/continuation/FRONTEND_WIRING_VERIFICATION.md). Download the full packet; its final line is `HALO-WIRING-PACKET-END`. Older branch references below are historical.

HALO's production frontend reuses the reviewed mobile screens for My Week, Today, Homeguard and Explore. Backend integration is documented in [the frontend integration guide](docs/continuation/FRONTEND_INTEGRATION_READY.md).

- [Verification and integration limits](docs/continuation/FRONTEND_INTEGRATION_VERIFICATION.md)
- [Complete product/backend handoff](docs/product/HALO_COMPLETE_BACKEND_HANDOFF.md)
- [Homeguard, account and source-operations contracts](docs/continuation/HOME_ACCOUNT_PRODUCTION_INTEGRATION.md)
- [Explore, My Week and Luna contracts](docs/continuation/EXPANDED_PRODUCTION_INTEGRATION.md)

Run `npm ci`, configure the approved public Supabase credentials and backend services, then run `npm run dev`. Never put provider or service-role secrets in client variables. Missing services show unavailable/retry states, not sample account data.

Checks: `npm run typecheck`, `npm test`, `npm run preservation:verify`, `npm run test:ui`, `npm run test:production`, `npm run test:stage`, and `npm run build`. Production-browser and stage tests use fake credentials and mocked APIs on a local isolated server. That test build must not be deployed.

Design-review routes remain isolated from production and are gated in production builds by `HALO_ENABLE_FRONTEND_PREVIEW`. Keep that flag unset for a normal production deployment. Read `AGENTS.md` and the continuation guide before changing approved visuals or archived references.
