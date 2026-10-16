# HALO homepage integration delta

## October 16 review redesign: canonical reminder status

The calendar-first frontend now accepts an optional, read-only `reminderStates` map in the existing `ActionSnapshot`. No endpoint, mutation command, preference field or scheduler was added. Existing responses without this field remain valid and display a requested reminder without claiming scheduling or delivery.

Each map key is a canonical action ID. Its value is the `ReminderState` type in `lib/frontend/week-reminders.ts`:

```ts
{
  actionRevision: number;
  scheduleSignature: string;
  status: 'pending' | 'registered' | 'scheduled' | 'delivered'
    | 'failed' | 'cancelled' | 'paused' | 'unknown';
  updatedAt: string;
  scheduledFor?: string;
  deliveredAt?: string;
  channel?: 'push' | 'email' | 'in-app';
}
```

The signature is `JSON.stringify([action.date, meta.time, meta.zone, meta.reminder, meta.paused, meta.archived, action.state])`. It excludes private preparation and history. Return the exact action revision and signature against which the scheduler state was established. Older evidence is retained as history but displayed as **Needs sync**, never as a current Scheduled or Delivered state. `updatedAt`, `scheduledFor` and `deliveredAt` must be valid instants with an explicit timezone. Scheduled requires `scheduledFor`; delivered requires `deliveredAt`. Unknown actions or malformed entries invalidate the snapshot rather than allowing unverified success labels.

Task preference edits continue through the existing revision-bound action command. Reminder evidence is not a writable preference or task metadata field. The service must independently enforce ownership, scheduling consent, quiet hours, timezone/DST, cancellation for completed/paused/archived tasks, idempotency and delivery receipts, as required by the original whole-app handoff. The UI's Refresh reminder status performs the existing action snapshot read, not a retry/send job. A delivered receipt does not assert that the message was read. A disabled request without a canonical cancelled/paused receipt does not claim that a job has stopped.

My Week now has a single continuous calendar/search/agenda surface, a compact masthead with the original optional landscape controls, and a distinct supporting rail. All earlier task sheets, captured-review actions, private preparation, manual recurrence, actual-date recap, Journal, Patterns, season, exports and linked record dates remain. Preparation checks and automatic-repeat choices retain their explicit visit-only scope. This redesign does not claim those services have become durable.

The opportunity-to-outdoors bridge uses a visit-local, explicitly accepted handoff from Explore. It does not transmit a place or date in the URL, fetch a forecast before acceptance, silently overwrite an outdoor draft, register participation or move an organizer event. The accepted source-local date and place feed the existing forecast read; absent venue-local date stays blank until the user deliberately supplies one. The optional event timezone fields are documented in `EXPLORE_BACKEND_DELTA.md`.

Timed task summaries and Up next now use the same display-zone day and clock as the calendar. Saved source-zone schedules, immutable dates and ICS export remain unchanged. Forecast horizon acceptance is still a specific integration gate: the current `ForecastSnapshot` declares `horizonStart`/`horizonEnd` only as strings, without specifying whether they are local inclusive calendar dates or absolute interval boundaries. Vibhav must choose and document that representation, including timezone and endpoint inclusivity, and test near-midnight/DST boundaries. Per-period start/end already require explicit timezone instants. Do not treat the existing horizon label or its date-prefix comparison as verified source coverage until that contract is settled.

October12, 2026. Yogi requested My Week as the first tab and default homepage, followed by Today, Homeguard and Explore. This is a wireframe extension, not authorization to change Vibhav's backend or bypass approval. The shared navigation order is updated, but production delivery flags and current live entry gates remain. The expanded static review opens My Week by default; explicit tab, factor, record and specialist-map links retain their owner.

## Verified current boundary

The current repository has `/api/daily-score`, `/api/home-guard`, Journal/history and notification/push foundations, but no owned Plan/action/recurrence/aggregate homepage service. The existing notification preference route edits alert-type preferences, not scheduled task-reminder jobs. StageRuntime can provide authoritative overview scores, including unavailable data; the hosted review instead uses the original shared design-fixture selector. All new private homepage records remain in the visit-local HomeWorkspaceState. No provider call, registration, email, notification delivery or account mutation was added.

## Proposed contracts, not existing endpoints

- Authenticated aggregate reads: owned canonical actions/metadata, selected owned home and community records, actual evidence changes and authoritative empty/loading/stale/error states. Preserve stable IDs, source/context versions and source dates. Historical observations, report timestamps and inventory items do not become unsolicited tasks. A homepage is not permission to read every free-text note into Luna.
- Attention: join earlier chosen plans, waiting actions/cases, independently expected result dates, actually entered unreviewed reports and precisely linked source changes. Deduplicate source revisions and acknowledgement. An expected lab date is not guaranteed delivery or an emergency deadline; viewing/acknowledging is not task completion. A cancellation retains the plan and invites explicit review, never silent deletion or rescheduling.
- Recorded progress: authoritative completion events/timestamps with user/display timezone and audit history. Summaries use when actions were completed, not their original due dates. Project steps are a subset of action totals. Archived completed history stays available. Unknown completion dates remain excluded and identified. No inferred health improvement, hazard remediation, pollution reduction or energy/water savings.
- Participation: add an explicit actual `participatedOn` calendar date distinct from chosen activity date and status-update date. Existing hours remain validated, self-reported and optional. Legacy undated participation is retained but not assigned to a week. Actual date corrections/history need captured revision and reconciliation. Reporting attendance is not organizer verification; meeting places stay distinct from offices and mailing addresses.
- Preparation: owned checklist checks bound to an exact action/origin revision and schedule/evidence signature. Changing relevant instructions, dates or source versions invalidates a prior ready-looking state. Preserve failed/offline drafts, recheck revision at Save and never update registration, attendance, action completion or source instructions as a side effect. The wireframe records what the user checked, not a safety certificate. External Maps searches disclose the saved place label and do not transmit a home address or request GPS automatically.
- Recurrence: durable owned series/preferences, explicit fixed-calendar versus after-completion rules, supported all-day/timed semantics, timezone/DST/end/skip/pause/cancel scopes and idempotent occurrence materialization. Requesting automatic next occurrences is consent intent, not an active scheduler. Wireframe dates are previews only; current manual Prepare next remains. Jobs must not duplicate canonical occurrences, overwrite user edits or erase completed history, including after partial/unknown outcomes and repeated retries. Preference changes require current series/context revision and an exact affected scope.
- Reminders: durable consented intent, authoritative channel/browser capability and delivery state, quiet hours/timezone, pending/scheduled/cancelled/failed receipts and retry/reconciliation. Paused/completed/archived items do not continue producing task reminders. Existing global alert preferences are not equivalent to these new action intents; separate inbox/push/email controls need additive reviewed contracts. Browser permission is not delivery confirmation. No scheduler or push reliability claim is established by the UI.
- Luna: authorized minimal aggregate read tools for explicit attention/recap requests, and existing captured-scope confirmed action tools. The new deterministic replies use saved-task metadata and completion counts, not private Journal or preparation text. Production should expose typed capability/error/provider state, context/revision checks, current owned aggregate facts and exact confirmation for proposed mutations. No account-wide context or arbitrary tool authority follows from placing Luna on a homepage.
- Production entry: once this screen is approved and implemented, authentication/onboarding entry can target the delivered `/plan` homepage. Preserve existing `/today`, `/home`, `/act` and all specialist/deep links. Do not make an undelivered route the live default merely because the wireframe opens there. Optional device recovery, export, deletion and account/context changes must cover all new records/preferences/jobs.

The full existing My Week, Explore, food, privacy and whole-app handoff contracts still apply. Vibhav retains backend ownership. This delta is saved for the deferred handoff, not sent to him and not proof of production readiness.
