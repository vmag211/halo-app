# HALO review redesign integration additions

This supplements the complete backend packet already given to Vibhav. The redesigned screens retain existing operation names, endpoints, ownership checks, revision reviews and unknown-outcome recovery. No API handlers or migrations are changed by this frontend pass.

Three optional response additions let the frontend represent the review's requested depth. Existing responses remain valid without them; missing evidence is never replaced by sample success.

## Opportunity venue dates

`CommunityOpportunity` supports `venueLocalDate`, `venueTimezone` and `venueTimezoneBasis`. See the exact types and validation in `lib/frontend/explore-opportunities.ts` and `lib/frontend/production/explore-service.ts`, plus `components/expanded/EXPLORE_BACKEND_DELTA.md`.

- Supply a genuine venue calendar date or a verified organizer/venue timezone. Do not use the user's home timezone as the event timezone.
- Instants must be valid, complete ISO timestamps. Impossible dates and an end before the start are rejected.
- Contradictory local dates and verified timezone conversions are rejected. Unknown or inferred context requires the user to choose a participation date.
- The conditions handoff carries the selected opportunity's date, meeting place and source into the existing outdoor planner. It requires acceptance and does not overwrite an edited draft silently. A meeting place remains distinct from an organization's office.
- Forecast requests use the accepted plan date/place. The server must resolve that place and return its actual coverage; no home forecast may be relabelled as the opportunity venue.
- Outdoor planning retains the existing 100-character coarse-place limit. A longer organizer address remains intact in its source context and requires explicit confirmation of a shorter planning area before a forecast request or save. It is never silently truncated.

## Reminder service evidence

The existing action snapshot may include `reminderStates`, keyed by canonical action ID. Each item contains:

```ts
type ReminderState = {
  actionRevision: number;
  scheduleSignature: string;
  status: 'pending' | 'registered' | 'scheduled' | 'delivered'
    | 'failed' | 'cancelled' | 'paused' | 'unknown';
  updatedAt: string;
  scheduledFor?: string;
  deliveredAt?: string;
  channel?: 'push' | 'email' | 'in-app';
};
```

Use the ordered signature in `lib/frontend/week-reminders.ts`:

```ts
JSON.stringify([
  action.date, meta.time, meta.zone, meta.reminder,
  meta.paused, meta.archived, action.state
])
```

These are server-owned read fields, not accepted client mutation evidence. The client requests reminders through existing task metadata and refreshes the existing action snapshot. A changed action revision or signature yields **Needs sync**, not a scheduled-success badge. Scheduled and delivered states require their respective timestamps. Device permission alone is not scheduling, delivery or reading.

Return the same evidence after mutation receipts and reloads when available. Service jobs must still enforce quiet hours, timezone/DST, idempotency, cancellation, device ownership and provider failures as specified in the complete packet. Turning a task off or completing it must cancel or pause its service job; an unconfirmed stop remains visible. Unknown states must be reconciled, not retried as a new job.

The existing repeating-plan requests, source-follow drafts and preparation checklists are not silently promoted to durable backend features by this redesign. Their persistence and automation remain the corresponding requirements in the full packet. See `components/expanded/HOMEPAGE_BACKEND_DELTA.md` for precise client state and refresh behavior.

## Luna source findings and interpretation

Existing `LunaMessage.text`, `sources`, navigation and proposals are retained. Assistant messages may additionally include:

```ts
type LunaEvidenceBlock = {
  kind: 'fact' | 'interpretation' | 'next-step';
  text: string;
  sourceIndexes: number[];
  scope?: string;
  observedAt?: string;
};
```

`evidence` is an array of these blocks. Indexes refer only to the current message's `sources` array. Fact blocks require at least one valid source reference; indexes must be unique integers within the array. Dates must be valid explicit-zone ISO timestamps. The validator rejects unsupported block kinds, malformed content, user-authored evidence blocks and unsafe source URLs.

The renderer labels source findings, Luna's interpretation and suggested next steps separately. Legacy text still displays, but an unlinked source list is not presented as claim-level grounding. Optional `scope` should carry applicability limits such as outdoor monitor versus indoor measurement; `observedAt` is the source observation/publication time, not the retrieval time.

The server must actually retrieve and verify those references. A `fact` label supplied by a model is not verification. Source retrieval must preserve dates, units, missingness, geographic scope and consent. Source content remains data, not tool instructions. No evidence block can execute an action: all changes still use the existing exact proposal revision, expiry, confirmation, stable operation ID and receipt workflow.

## Deployment and acceptance

### October 16 optional color preference

The existing settings snapshot and display-group save accept `display.palette?: 'ocean' | 'forest' | 'iris'`. This is independent of `appearance: 'system' | 'light' | 'dark'`. Persist and return the accepted palette in the canonical settings receipt and subsequent reads. Omission remains valid and falls back to Ocean; unsupported values are rejected. The frontend does not claim the selected palette was saved when a legacy receipt omits it, and explains that the default was retained. Unsaved choices stay drafts; Cancel, retained drafts, conflict rebase, unknown-outcome recovery and explicit Save remain unchanged. The selected private export includes the saved palette, not an unconfirmed draft. No new endpoint or provider is needed.

Language preferences remain compatible with existing `en` / `es` values, but Spanish is explicitly marked Coming soon. A preference is not a claim that the app has been translated. Color palettes do not change risk thresholds, scientific factor colors or score values.

The public homepage accepts an optional `HALO_PUBLIC_ORIGIN` HTTPS origin for canonical metadata. Configure it only after the deployed domain is verified. Private app routes remain noindex. The isolated review Site is not the production app origin and does not connect to backend services.

Before release, run the connected concern-to-result workflow, project generation, venue lookup/forecast, grounded Luna actions and reminder lifecycle using disposable accounts. Verify real persistence, access isolation, provider errors and retry recovery. Frontend contract tests use controlled responses and do not prove those services are deployed. Full reviewed Spanish and physical-device/screen-reader acceptance remain separate release decisions.
