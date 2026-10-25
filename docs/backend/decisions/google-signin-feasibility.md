# Google sign-in, Gmail and Calendar: feasibility

Status: **Research and an off-by-default spike. Nothing is decided or turned on.** Written 2026-10-25
on `vmag211/google-feasibility` (from `origin/main` at `d705023`). Every source below was retrieved on
2026-10-25. No Google or Supabase endpoint was called; the spike is tested with a mocked Supabase only,
so the end-to-end exchange against a real project is still an open human check.

Related: `B01-optional-recovery.md` (Option B), `plans/b02-identity-linking-and-recovery.md` (BE-050,
BE-174, BE-227, BE-334, Ruling 31), `plans/b17-outreach-preparation.md` (O2: no email provider),
`plans/b13-source-operations.md` (anonymous accounts are always denied), `YOUR_TODO.md` Part 1 item 3
and 2.18.

## Verdicts

| Item | Verdict | One line |
| --- | --- | --- |
| 1. Google sign-in by linking a Google identity to the anonymous user | **Feasible now** | Supabase links Google to the same user id, so the household is kept; basic scopes need no Google verification; free on the current plans. A spike is built behind `HALO_FEATURE_GOOGLE_SIGNIN` |
| 1b. Google as the recovery and another-device path | **Feasible now, not built** | `signInWithOAuth` on a second device returns the original user; it needs the separate recover intent (BE-227) with an explicit account switch, never a merge |
| 1c. Unblocks the operator role grant | **Feasible now** | A linked user is no longer anonymous, so `operator_roles` can be granted to it by SQL |
| 2. Gmail send (`gmail.send`) | **Feasible with verification, not recommended** | Sensitive, not restricted, so no CASA; but it needs a domain, a privacy policy, a demo video, about 10 business days of review, server-side refresh-token storage and a new send pipeline |
| 3. Google Calendar (`calendar.app.created` or `calendar.events`) | **Not recommended** | No Calendar scope is restricted, but writing events needs OAuth verification and token storage for little gain over the ICS export HALO already has |
| 4a. `mailto:` handoff | **Feasible now, recommended** | No cost, no verification, nothing sent through HALO; fits O2 |
| 4b. Transactional email from a HALO domain | **Feasible, not recommended for outreach** | Cheap, but HALO becomes the sender to public offices (abuse and deliverability risk); worth it only as Supabase's custom SMTP if the email recovery path ships |

## 1. Google sign-in through Supabase

### Can an anonymous user be upgraded and keep the household?

Yes. Supabase documents converting an anonymous user to a permanent one by linking an OAuth identity
with `supabase.auth.linkIdentity({ provider: 'google' })`, and says this "requires" manual linking to
be enabled ([anonymous sign-ins][sb-anon]). Linking attaches the identity to the **signed-in** user
([identity linking][sb-link]), so `auth.users.id` does not change and `profiles.id`, every owned row,
RLS and the cascades carry over unchanged (BE-050). In Supabase Auth's own source, the link handler
clears `is_anonymous` on the target user and, for a user with no email, takes the identity's email
([`internal/api/identity.go`][gotrue-identity]).

The installed client (`@supabase/auth-js` 2.110.7, read from `node_modules`) has `linkIdentity`,
which calls `/user/identities/authorize` with the caller's JWT and documents: "If the candidate
identity is already linked to the existing user or another user, `linkIdentity()` will fail."

### A Google identity that already belongs to another account

Supabase refuses: `identity_already_exists`, HTTP 422, "Identity is already linked to another user"
([`identity.go`][gotrue-identity]; [error codes][sb-errors]). The error comes back on the redirect,
in both the query and the fragment (`redirectErrors` in [`external.go`][gotrue-external]). It never
merges. The spike reports it plainly and keeps the device on its own household (BE-334). The Supabase
anonymous guide's "conflict resolution" section (overwrite or merge records) is the opposite of what
HALO wants and must not be followed.

A cancel at Google comes back as `error=access_denied` with no Supabase code of its own; Supabase also
uses `access_denied` for a banned user or disabled signups, but then names its own code
([`external.go`][gotrue-external]), so the spike counts only the bare form as a cancellation.

### What it needs

- **Supabase**: the Google provider enabled with a client ID and secret, manual linking on, anonymous
  sign-ins left on, and the callback URL in the Redirect URLs allow list ([Google login][sb-google];
  [redirect URLs][sb-redirect]). Wildcards are allowed; Supabase's Vercel preview example is
  `https://*-<team-or-account-slug>.vercel.app/**`, and it recommends an exact path in production
  ([redirect URLs][sb-redirect]).
- **Google Cloud**: a **Web application** OAuth client whose authorized redirect URI is the Supabase
  callback, `https://<project-ref>.supabase.co/auth/v1/callback` (copied from the Supabase Google
  provider page); `openid` added by hand, `userinfo.email` and `userinfo.profile` by default
  ([Google login][sb-google]). Previews need **no** Google change: Google only ever redirects to
  Supabase, and Supabase's allow list decides which HALO URL it returns to.
- **Env vars**: only `HALO_FEATURE_GOOGLE_SIGNIN=on` (server side). The Google client secret lives in
  Supabase only, never in Vercel or the repository. `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` are already set.

### Google verification for basic scopes

Not required. Google's FAQ: with only non-sensitive scopes "it is not mandatory for your app to complete
the app verification process"; showing the app name and logo needs the lighter "brand verification"
([Google OAuth help][g-help]), typically 2 to 3 business days ([verification FAQ][g-faq]). The 100-user
cap and the unverified-app screen apply only to "unverified apps that are accessing restricted or
sensitive scopes" ([verification FAQ][g-faq]). Testing mode is limited to 100 test users
([audience][g-audience]), and the 7-day token expiry does not apply to apps that "request only basic
profile, email, or OpenID scopes" ([OAuth 2.0 expiration][g-expiry]). Without a custom auth domain the
consent screen names `<project-ref>.supabase.co`, which Supabase says "does not inspire trust"
([Google login][sb-google]); a custom domain is a paid add-on, $10 per domain per month on Pro and not
on Free ([pricing][sb-pricing]).

### Recovery, another device, and the operator role

- **Another device**: on a second device, `signInWithOAuth({ provider: 'google' })` signs in to the
  user that owns the Google identity, which is the original household. This is BE-227's **recover**
  intent and must stay separate from link: the second device's own anonymous household is abandoned,
  never merged, and the person must confirm the switch (the frontend's `confirmAccountSwitch: true`).
  It avoids every blocker of the email path that HALO controls: no HALO-sent mail, no Turnstile-gated
  request route, no `recovery_challenges` row to mark verified, and Ruling 31 does not arise because
  the OAuth state is bound to the browser that started it (use the PKCE flow for this one). **Not
  built in the spike.** Still not solved: device listing and revocation (Ruling 27), backups (BE-307)
  and BE-360 targets.
- **Interaction with B02 recovery**: after a link, the user's email is Google's, confirmed. With
  `HALO_FEATURE_RECOVERY` on, `linkedMethod` in `lib/account.js` would report it as a verified email
  recovery method, and `remove-recovery` would unconfirm it (`email_confirm: false`) while Google sign-in
  keeps working. Reconcile the two before both flags are on.
- **Operator role**: `operatorRole` denies only `isAnonymous` (`lib/sourceOps.js`). After Vibhav links
  his own Google on production he is no longer anonymous, so 2.18 step 4's SQL can grant his profile
  id. This unblocks `YOUR_TODO.md` Part 1 item 3.
- **Side effect of enabling the provider**: once Google is on in Supabase, anyone calling Supabase
  directly can sign in with Google and get a new, non-anonymous account with no household. HALO's UI
  never offers that today; onboarding would treat it as a new household.

## 2. Gmail send

- **Classification**: `gmail.send` is **Sensitive**; `gmail.compose`, `gmail.modify`, `gmail.readonly`,
  `gmail.insert`, `gmail.metadata` and `https://mail.google.com/` are **Restricted**
  ([Gmail scopes][g-gmail]). `gmail.send` is not on Google's restricted list ([restricted
  scopes][g-restricted]), so **no CASA security assessment**.
- **Verification**: brand verification plus sensitive-scope requirements: a demo video, limited data
  use and a minimum-scope justification ([verification requirements][g-help-req]). Estimates: sensitive
  scope about 10 business days, brand 2 to 3 business days, "not guaranteed" ([verification
  FAQ][g-faq]). Google charges no fee. Plan on a domain HALO owns, with its homepage and privacy policy.
- **If it were restricted** (for example `gmail.compose`): about 6 weeks plus an annual CASA
  assessment by an authorized lab ([verification FAQ][g-faq]; [security assessment][g-casa]); Google
  charges nothing, the lab does: TAC Security lists Tier 2 at $540 (Premium $720) and 1 to 3 weeks
  ([TAC Security][tac]; vendor page, not confirmed with Google).
- **While unverified**: the unverified-app screen and a 100 new-user cap that "applies over the entire
  lifetime of the project, and it cannot be reset" ([verification FAQ][g-faq]); in Testing, 100 test
  users and authorizations that expire after 7 days ([audience][g-audience]).
- **Tokens**: Google issues a refresh token only with `access_type: 'offline'` and `prompt: 'consent'`
  ([Google login][sb-google]); Supabase hands the provider token to the browser once and does not keep
  it. HALO would have to store the refresh token server side, encrypted, with a new migration, key,
  privacy export and clear coverage, and handle its loss: revoked, unused for six months, a password
  change for Gmail scopes, or the 100-per-client limit that "silently invalidates the oldest"
  ([OAuth 2.0 expiration][g-expiry]). Then `outreach.connect`, `outreach.send`, attempts and delivery
  status (B17 O2, O7) would all be new work.
- **Verdict for a small project**: feasible with verification, about two to three weeks of calendar
  time once a domain and privacy policy exist, plus a new token store and send pipeline. Not
  recommended now; the `mailto:` handoff gives the person the same outcome from their own mail app.

## 3. Google Calendar

- **Scopes**: `calendar.app.created` ("Make secondary Google calendars, and see, create, change, and
  delete events on them") is the narrowest that can write HALO's events; `calendar.events` ("View and
  edit events on all your calendars") is broader ([Calendar scopes][g-cal]). No Calendar scope is on
  the restricted list ([restricted scopes][g-restricted]), so no CASA. Google's Calendar page shows no
  sensitivity tier, and no public Google page retrieved states the tier of `calendar.app.created`; the
  Cloud console shows it when the scope is added. Plan as sensitive (10 business days, demo video).
- **Against ICS**: HALO already downloads one saved task as an `.ics` file
  (`calendarExport` in `lib/frontend/week-preview.ts`, used at `components/expanded/MyWeekWorkspace.tsx`
  "Export to calendar"), works with every calendar app, needs no account and sends nothing. A Google
  connection would add automatic updates, at the cost of verification, a stored refresh token and a
  sync job. A subscribed ICS feed URL would give updates without OAuth, but the URL is a bearer secret
  and how often Google refreshes a subscribed feed was not verified here.
- **Verdict**: not recommended; keep the ICS export.

## 4. Simpler alternatives for outreach

| | `mailto:` handoff | Transactional provider from a HALO domain |
| --- | --- | --- |
| Effort | Small frontend change: an "Open in email app" link beside the copy button in `ShareTools`, `mailto:<to>?subject=...&body=...` | A domain, SPF, DKIM and DMARC records, a provider key, a send route, rate limits, Turnstile, an abuse review and delivery status |
| Cost | None | Resend Free: 3,000 a month, 100 a day, 3 domains; Pro $20 a month for 50,000 ([Resend][resend]) |
| Verification | None | DNS domain authentication; no Google review |
| Privacy | Best: the message goes from the person's own mail app; HALO never sees whether it was sent | The provider processes every message; HALO becomes the sender of record to public offices and needs the person's reply address |
| Fit with B17 | Keeps O2 ("nothing sends email") true | Reverses O2 |

Very long bodies may not survive a `mailto:` URL in every mail app (not measured here), so keep the
copy button as the fallback. A provider is still worth having for a different reason: Supabase's
built-in mail sends only to pre-authorized addresses at 2 messages an hour and Supabase urges custom
SMTP for anything else ([Supabase SMTP][sb-smtp]), so the **email** recovery path in B02 needs one if
it ever ships. Google sign-in needs none.

## The spike

Flag `googleSignin`, variable **`HALO_FEATURE_GOOGLE_SIGNIN`**, off by default (`lib/features.js`,
scrubbed in `test/helpers/sandbox.mjs`). With it off, Settings shows nothing new and the status route
reads nothing.

- `lib/googleSignin.js`: `startGoogleLink` (records which user started the link in `sessionStorage`,
  calls `linkIdentity` with `openid email profile` and `redirectTo` `/auth/google/callback`), and
  `completeGoogleLink` / `finishGoogleLinkOnCallback`, which adopt a returned session only when the
  flag is on, the link was started in this tab within 15 minutes, the device is still on that user,
  and `auth.getUser` confirms the tokens are for that same user with a Google identity. Every other
  case is refused with a plain sentence; the Google provider token is never kept.
- `lib/supabase.js`: `detectSessionInUrl` keeps supabase-js's default everywhere except the callback
  path, so the client cannot adopt the returned session before those checks run. The repo's client
  uses the implicit flow (the supabase-js default), so the tokens arrive in the fragment.
- `app/auth/google/callback/page.tsx`: strips the URL first, then finishes or refuses; it never
  creates a session.
- `app/api/account/google/route.js`: `GET /api/account/google`, the account-status reflection:
  `{ feature: 'google-signin', enabled, reason?, anonymous, linked, maskedAccount, linkedAt }`, masked
  with `maskEmail`, `private, no-store`.
- `components/production/ProductionAccountFlows.tsx` `ProductionGoogleSigninFlow`, shown before the
  recovery disclosure in production Settings, renders nothing until the route says enabled.
- Tests: `test/googleSignin.test.mjs`, `test/routesAccountGoogle.test.mjs`,
  `test/googleSigninAdversarial.test.mjs`. Covered: an anonymous user links and keeps the same id and
  rows; the identity belongs to another account (refused, no switch, no merge); cancel; flag off (no
  provider read, no adoption, even with valid tokens); a return for a different user, a stale or
  missing marker, and no session.
- Known limits: "already linked" is recognised by `error_code` only (a description-only refusal shows
  the generic failure, and nothing is adopted either way); single use of the pending marker relies on
  `sessionStorage.removeItem` working, with the same-user checks as the backstop.
- Not built: the other-device sign-in (recover intent), Gmail and Calendar.

## What Vibhav must do (in this order)

**Google Cloud console** (console.cloud.google.com, Google Auth Platform):

1. Create or pick a project for HALO.
2. **Branding**: app name HALO, a support email, developer contact email. Add the homepage and privacy
   policy links if you have them. A logo is optional and triggers brand verification (2 to 3 business
   days).
3. **Audience**: External. Leave it in **Testing**, add yourself and Yogi as test users, try it, then
   **Publish app** (In production). No review is needed for basic scopes.
4. **Data Access**: add `openid`; keep `.../auth/userinfo.email` and `.../auth/userinfo.profile`. Add
   nothing else (no Gmail, no Calendar).
5. **Clients**, Create client, type **Web application**, name "HALO Supabase". Authorized redirect URI:
   exactly `https://<project-ref>.supabase.co/auth/v1/callback` (copy it from Supabase's Google
   provider page). Copy the client ID and secret.

**Supabase dashboard**:

6. Authentication, Sign In / Providers, **Google**: enable, paste the client ID and secret.
7. Turn on **manual linking** (Authentication settings; the self-hosted name is
   `GOTRUE_SECURITY_MANUAL_LINKING_ENABLED`). Leave anonymous sign-ins on.
8. Authentication, URL Configuration, **Redirect URLs**, add:
   `https://<production domain>/auth/google/callback`,
   `https://*-<vercel team slug>.vercel.app/auth/google/callback` (previews) and
   `http://localhost:3000/auth/google/callback` (local). If previews share the production Supabase
   project, a link made on a preview is a real link on production accounts.

**Vercel**:

9. Set `HALO_FEATURE_GOOGLE_SIGNIN=on` in **Preview** only, redeploy, and do one browser pass: link a
   fresh anonymous household, check Settings says "Kept with Google", then try the same Google account
   from a second fresh browser and confirm it is refused with nothing merged.
10. Then Production. To grant yourself the operator role: link your own Google there, find your id with
    `select id, is_anonymous from auth.users where email = '<your Google address>';` (expect
    `is_anonymous = false`) and run 2.18 step 4.

**Costs and timelines**

| Item | Money | Calendar time |
| --- | --- | --- |
| Google sign-in, basic scopes | $0 (Google OAuth free; Supabase Free includes social OAuth, 50,000 MAU) | About an hour of console work; no review |
| Brand verification (optional, name and logo on consent) | $0 | 2 to 3 business days |
| Custom auth domain (optional) | $10 a month, Pro plan only | Hours (DNS) |
| Gmail send | $0 to Google; a domain and privacy policy | About 10 business days review, plus build |
| Calendar write | $0 to Google | Treat as about 10 business days review, plus build |
| `mailto:` | $0 | Under a day |
| Transactional email | $0 to $20 a month | Days (DNS, abuse controls) |

## Sources (all retrieved 2026-10-25)

[sb-anon]: https://supabase.com/docs/guides/auth/auth-anonymous
[sb-link]: https://supabase.com/docs/guides/auth/auth-identity-linking
[sb-google]: https://supabase.com/docs/guides/auth/social-login/auth-google
[sb-errors]: https://supabase.com/docs/guides/auth/debugging/error-codes
[sb-redirect]: https://supabase.com/docs/guides/auth/redirect-urls
[sb-pricing]: https://supabase.com/pricing
[sb-smtp]: https://supabase.com/docs/guides/auth/auth-smtp
[gotrue-identity]: https://github.com/supabase/auth/blob/master/internal/api/identity.go
[gotrue-external]: https://github.com/supabase/auth/blob/master/internal/api/external.go
[g-help]: https://support.google.com/cloud/answer/9110914
[g-help-req]: https://support.google.com/cloud/answer/13464321
[g-faq]: https://support.google.com/cloud/answer/13463817
[g-audience]: https://support.google.com/cloud/answer/15549945
[g-restricted]: https://support.google.com/cloud/answer/13464325
[g-casa]: https://support.google.com/cloud/answer/13465431
[g-expiry]: https://developers.google.com/identity/protocols/oauth2#expiration
[g-gmail]: https://developers.google.com/workspace/gmail/api/auth/scopes
[g-cal]: https://developers.google.com/workspace/calendar/api/auth
[tac]: https://casa.tacsecurity.com/site/home
[resend]: https://resend.com/pricing

- Supabase: [anonymous sign-ins][sb-anon], [identity linking][sb-link], [Google login][sb-google],
  [error codes][sb-errors], [redirect URLs][sb-redirect], [pricing][sb-pricing], [SMTP][sb-smtp].
- Supabase Auth source: [identity.go][gotrue-identity], [external.go][gotrue-external].
- Google: [OAuth help][g-help], [verification requirements][g-help-req], [verification FAQ][g-faq],
  [audience and testing][g-audience], [restricted scopes][g-restricted], [security
  assessment][g-casa], [token expiration][g-expiry], [Gmail scopes][g-gmail], [Calendar
  scopes][g-cal].
- Vendors (prices, not confirmed with Google): [TAC Security][tac], [Resend][resend].
