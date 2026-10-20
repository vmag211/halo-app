/**
 * The routes' side of migration 0029: saved household summaries, the request
 * parser, the report composer and the RPC wrappers.
 *
 *   read_household_summaries(p_profile_id, p_limit)        -> {items, complete}
 *   read_household_summary(p_profile_id, p_summary_id)      -> snapshot | null
 *   household_summary_usage(p_profile_id)                   -> {summaries}
 *   commit_household_summary(p_profile_id, p_operation_id, p_summary) -> snapshot
 *
 * B15 plan (docs/backend/plans/b15-saved-summaries.md), Rulings S15-1 to
 * S15-11. Used by GET and POST /api/summaries, GET /api/summaries/detail and
 * the `summary` reconcile in GET /api/operations.
 *
 * Identity: `profileId` is always the verified session's user id
 * (requireUser), never an id from the request.
 *
 * THE COMPOSER is the production half of the client's own preview
 * (components/homeguard/SummaryWorkspace.tsx): its record line builders
 * (:25-44 and :83-93) are transcribed here verbatim, without their types, and
 * test/summaryCompose.test.mjs runs the TSX's own source of them over the
 * same records, so a change on the client fails the build until it is copied
 * here. The server composes from what it read itself, never from text the
 * client sent, so a saved report says exactly what the stored records said at
 * the revisions its manifest names (Ruling S15-5).
 *
 * Until 0029 (or 0026, or the 0017 ledger) is applied the functions or tables
 * do not exist (PGRST202, 42883, PGRST205, 42P01): the reads answer the
 * non-retryable 503 and a prepare a 200 failed receipt (Ruling S15-10).
 */
import { apiError, ERROR_CODES } from './apiErrors.js';
import { BAND_KEYS } from './household.js';
import { normalizeWaterSource } from './waterSource.js';

/** The ledger domain the client reconciles a prepare in (useProductionSummary.ts:24). */
export const SUMMARY_DOMAIN = 'summary';
export const SUMMARY_KIND = 'summary.prepare';

/** The four purposes the screen offers (SummaryWorkspace.tsx:58), Ruling S15-9. */
export const PURPOSES = Object.freeze(['Household review', 'Water provider questions', 'Landlord or contractor discussion', 'Care professional questions']);

/** SummarySection (home-maintenance-preview.ts:96), in the validator's order (summary-service.ts:13). */
export const SECTIONS = Object.freeze(['scores', 'factors', 'tests', 'actions', 'maintenance', 'observations', 'gardens']);
/** The record sections, in the screen's order (SummaryWorkspace.tsx:24). */
export const RECORD_SECTIONS = Object.freeze(['tests', 'actions', 'maintenance', 'observations', 'gardens']);
/** The five scope choices (summary-service.ts:13). */
export const SCOPES = Object.freeze(['categories', 'location', 'notes', 'attachments', 'appendix']);
/** The workspace collection each workspace record section reads (SummaryWorkspace.tsx:68). */
export const SECTION_COLLECTIONS = Object.freeze({ tests: 'tests', maintenance: 'assets', observations: 'observations', gardens: 'gardens' });

/** SummaryWorkspace.tsx:22, verbatim. */
export const SECTION_LABELS = Object.freeze({ scores: 'Today & Homeguard scores', factors: 'Factors & sources', tests: 'Test reports', actions: 'Saved actions', maintenance: 'Maintenance records', observations: 'Moisture observations', gardens: 'Garden records' });

/** memberCatalog's band and label, in homeMemberKeys' order (lib/frontend/home-household.ts:6-8, 53-200). */
export const CATEGORY_LABELS = Object.freeze([
  ['has_toddler', 'Toddlers'], ['has_child', 'Children'], ['has_teen', 'Teens'], ['has_adult', 'Adults'],
  ['has_senior', 'Older adults'], ['has_pregnant', 'Pregnancy'], ['has_respiratory', 'Asthma / breathing'],
]);

/** resultQualifiers (lib/frontend/home-test-preview.ts:12), verbatim. */
export const RESULT_QUALIFIERS = Object.freeze(Object.assign(Object.create(null), { measured: 'Reported numeric value', less_than: 'Less than (<)', non_detect: 'Non-detect (ND)', zero: 'Reported numeric zero', absent: 'Result not reported', unknown: 'Qualifier unclear' }));
/** The transcription review labels (SummaryWorkspace.tsx:84). Both maps have no prototype, so a stored value like `constructor` finds nothing (the client's literal would find Object's). */
const REVIEW_LABELS = Object.freeze(Object.assign(Object.create(null), { not_received: 'No results received', unreviewed: 'Not checked against the original report', needs_clarification: 'Needs clarification', user_confirmed: 'Checked by you, not verified by a laboratory' }));

/** Ruling S15-9. */
export const LIMITS = Object.freeze({
  bodyBytes: 1_000_000,
  records: 500,
  excluded: 5000,
  excludedLength: 400,
  idLength: 200,
  snapshotBytes: 2_000_000,
  lineLength: 20_000,
  sectionLines: 5000,
  perHousehold: 200,
  listed: 200,
  unresolved: 100,
});

/**
 * Every server-authored sentence a failed receipt carries, by reason. Fixed
 * constants: none interpolates a value, so a stored reason and a replayed
 * sentence can never carry text a person typed. No U+2014 (AGENTS.md).
 */
export const REFUSALS = Object.freeze({
  changed: 'A selected record changed after you chose it. Nothing was saved. Review your selection and prepare the summary again.',
  home_changed: 'Your current home changed. Nothing was saved. Review your selection and prepare the summary again.',
  limit: 'You have reached the limit of saved summaries. Nothing was saved.',
  too_large: 'This summary is too long to save. Nothing was saved. Choose fewer records and try again.',
  unavailable: 'Saved summaries are not available yet. Nothing was saved.',
  // Never stored: computed when a succeeded or abandoned operation is read back.
  gone: 'That summary is no longer saved. Prepare a new one if you need it.',
  abandoned: 'That summary did not finish, so it was not saved. Your selections are kept.',
  not_applied: 'That summary did not finish, so it was not saved. Your selections are kept.',
});

/** The reasons a prepare records on its ledger row and replays. */
export const STORED_REFUSALS = Object.freeze(['changed', 'home_changed', 'limit', 'too_large', 'unavailable']);

/** A still-running prepare, replayed or reconciled. */
export const IN_FLIGHT_MESSAGE = 'The summary is still being prepared. Check its status again in a moment.';

/** The failed receipt for a reason, as the client receives it (the operation id is added by the caller). */
export function refusalBody(reason) {
  const message = REFUSALS[reason];
  if (!message) throw new Error('summaryStore: unknown refusal reason');
  return { status: 'failed', reason, message };
}

/** "Not there yet": the function (PostgREST, Postgres), then a table (PostgREST, Postgres). */
const UNAVAILABLE_CODES = new Set(['PGRST202', '42883', 'PGRST205', '42P01']);

const UNAVAILABLE_MESSAGE = 'Saved summaries are not available yet. Nothing was changed.';

/** True when the error says migration 0029 (or 0026, or the 0017 ledger) is not applied. */
export function isSummaryUnavailable(error) {
  return !!error && UNAVAILABLE_CODES.has(error.code);
}

/** The 503 the summary reads answer while the flag is off or a migration is missing. Not retryable. */
export function summaryUnavailable(requestId) {
  return apiError({ status: 503, code: ERROR_CODES.FEATURE_UNAVAILABLE, message: UNAVAILABLE_MESSAGE, retryable: false, requestId });
}

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001f\u007f]/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date, YYYY-MM-DD (the client's validActionDate). */
function validDate(value) {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
}

const problem = (field, code, message) => ({ ok: false, fieldErrors: [{ field, code, message }] });

/**
 * The prepare body (SummaryWorkspace.tsx:112) as the server keeps it:
 * `{selection, records, homeContextId}`. The selection is rebuilt from its
 * known keys only, so the echoed copy is exactly what was checked.
 * `collectionRevisions` is accepted and ignored (Ruling S15-5, B11 W6).
 */
export function parseSummaryRequest(body) {
  if (!isObject(body)) return problem('body', 'invalid_type', 'Send the summary request as a JSON object.');
  const raw = body.selection;
  if (!isObject(raw)) return problem('selection', 'required', 'Choose what the summary includes.');
  if (!PURPOSES.includes(raw.purpose)) return problem('selection.purpose', 'invalid_choice', 'Choose one of the listed purposes.');
  if (!validDate(raw.start) || !validDate(raw.end)) return problem('selection.start', 'invalid_date', 'Choose valid start and end dates.');
  if (raw.end < raw.start) return problem('selection.end', 'invalid_range', 'The end date must be on or after the start date.');
  if (!isObject(raw.sections) || !SECTIONS.every((key) => typeof raw.sections[key] === 'boolean')) {
    return problem('selection.sections', 'invalid_type', 'Every section must be chosen or not chosen.');
  }
  if (!SECTIONS.some((key) => raw.sections[key])) return problem('selection.sections', 'required', 'Choose at least one section.');
  for (const key of SCOPES) {
    if (typeof raw[key] !== 'boolean') return problem(`selection.${key}`, 'invalid_type', 'Every privacy choice must be on or off.');
  }
  if (!Array.isArray(raw.excluded) || raw.excluded.length > LIMITS.excluded
      || !raw.excluded.every((entry) => typeof entry === 'string' && entry.length <= LIMITS.excludedLength && !CONTROL.test(entry)
        && SECTIONS.some((section) => entry.startsWith(`${section}:`) && entry.length > section.length + 1))) {
    return problem('selection.excluded', 'invalid_value', 'The excluded records could not be read.');
  }
  const selection = {
    purpose: raw.purpose,
    start: raw.start,
    end: raw.end,
    sections: Object.fromEntries(SECTIONS.map((key) => [key, raw.sections[key]])),
    ...Object.fromEntries(SCOPES.map((key) => [key, raw[key]])),
    excluded: [...raw.excluded],
  };

  const records = body.records ?? [];
  if (!Array.isArray(records) || records.length > LIMITS.records) {
    return problem('records', 'invalid_value', `Choose at most ${LIMITS.records} records for one summary.`);
  }
  const seen = new Set();
  const parsed = [];
  for (const entry of records) {
    if (!isObject(entry) || !RECORD_SECTIONS.includes(entry.kind)) return problem('records', 'invalid_kind', 'A selected record has an unknown kind.');
    if (!selection.sections[entry.kind]) return problem('records', 'section_not_selected', 'A selected record belongs to a section that is not chosen.');
    if (typeof entry.id !== 'string' || !entry.id || entry.id.length > LIMITS.idLength || CONTROL.test(entry.id)) {
      return problem('records', 'invalid_id', 'A selected record could not be read.');
    }
    if (!Number.isSafeInteger(entry.revision) || entry.revision < 1 || entry.revision >= 2147483647) {
      return problem('records', 'invalid_revision', 'A selected record has no saved version. Reload your records and try again.');
    }
    const key = `${entry.kind}:${entry.id}`;
    if (seen.has(key)) return problem('records', 'duplicate', 'A record is selected twice.');
    seen.add(key);
    parsed.push({ kind: entry.kind, id: entry.id, revision: entry.revision });
  }

  if (body.collectionRevisions !== undefined && body.collectionRevisions !== null && !isObject(body.collectionRevisions)) {
    return problem('collectionRevisions', 'invalid_type', 'The record versions could not be read.');
  }
  const home = body.homeContextId ?? null;
  if (home !== null && (typeof home !== 'string' || !home || home.length > LIMITS.idLength)) {
    return problem('homeContextId', 'invalid_value', 'The home could not be read.');
  }
  return { ok: true, value: { selection, records: parsed, homeContextId: home } };
}

// ---------------------------------------------------------------------------
// The composer. Transcribed from SummaryWorkspace.tsx; see the module comment.
// ---------------------------------------------------------------------------

/* SummaryWorkspace.tsx:25-44, verbatim but for the types. */
const dateFields = ['observedAt', 'collectedAt', 'collectionStart', 'collected', 'collectionDate', 'date', 'proposedDate', 'plannedDate', 'lastCompleted', 'installed', 'createdAt'];
const scalar = (value) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
export function recordDate(record) { for (const key of dateFields) if (scalar(record[key])) return scalar(record[key]); return ''; }
export function recordDescription(record) {
  const parts = [scalar(record.status) || scalar(record.state), recordDate(record) || 'Date not supplied'];
  if (record.reading !== undefined && record.reading !== '') parts.push(`${scalar(record.reading)} ${scalar(record.unit)} (user entered)`);
  if (record.nextDue) parts.push(`Next due ${scalar(record.snoozedUntil) || scalar(record.nextDue)}`);
  if (record.lastCompleted) parts.push(`Last completed ${scalar(record.lastCompleted)}`);
  if (record.irrigation) parts.push(`Irrigation source: ${scalar(record.irrigation)}`);
  return parts.filter(Boolean).join(' · ');
}
export function resultLines(record) {
  if (!Array.isArray(record.rows)) return [];
  return record.rows.filter(row => row && typeof row === 'object').map(row => {
    const result = row;
    const qualifier = scalar(result.qualifier);
    return [scalar(result.analyte) || 'Unlabelled analyte', RESULT_QUALIFIERS[qualifier] || qualifier, scalar(result.originalValue) || 'Original value not supplied', scalar(result.originalUnit) || 'Reported unit missing', result.limit ? `Reporting limit: ${scalar(result.limit)} ${scalar(result.limitUnit) || '(limit unit missing)'}` : '', result.basis ? `Basis: ${scalar(result.basis)}` : ['soil', 'tissue'].includes(scalar(record.medium)) ? 'Sample basis missing' : '', scalar(result.reportDate) || 'Report date not supplied', 'User-entered transcription, no scored interpretation'].filter(Boolean).join(' · ');
  });
}

/* SummaryWorkspace.tsx:84-92, the body of `records.flatMap(record => {...})`, verbatim but for the types. */
export function recordDetails(section, record, selection) {
  const testContext = section === 'tests' ? [`Sample medium: ${scalar(record.medium) || 'Unknown'}. Method: ${scalar(record.method) || 'Not supplied'}. Collection: ${scalar(record.collectionStart) || 'Not supplied'}${record.collectionEnd ? ` through ${scalar(record.collectionEnd)}` : ''}.`, `Transcription review: ${REVIEW_LABELS[scalar(record.review)] || 'Not supplied'}.${record.reviewReason ? ` ${scalar(record.reviewReason)}` : ''}`] : [];
  const details = [`${record.title}: ${recordDescription(record)} · User-reported record${record.revision ? `, revision ${record.revision}` : ''}.`, ...testContext, ...resultLines(record)];
  if (selection.location) { const place = scalar(record.room) || scalar(record.sampleLabel) || scalar(record.siteLabel) || scalar(record.county); if (place) details.push(`Included place label: ${place}.`); if (section === 'tests' && record.contextId) details.push(`Sample context: ${scalar(record.contextId)}.`); }
  if (selection.notes) { const note = scalar(record.note) || scalar(record.privateNote); if (note) details.push(`Included private note: ${note}`); }
  if (selection.attachments) { const name = scalar(record.photoName); if (name) details.push(`Selected attachment reference: ${name}. Image contents and metadata are omitted from this summary export.`); if (Array.isArray(record.attachments) && record.attachments.length) details.push(`${record.attachments.length} attachment reference(s). Original files are omitted; this summary is not a full private-data export.`); }
  if (selection.appendix && section === 'maintenance' && Array.isArray(record.history)) for (const entry of record.history) { if (entry && typeof entry === 'object') { const event = entry; details.push(`History: ${scalar(event.kind)} · ${scalar(event.date)}${event.due ? ` · Due ${scalar(event.due)}` : ''}${selection.notes && event.note ? ` · ${scalar(event.note)}` : ''}.`); } }
  return details;
}

/** SummaryWorkspace.tsx:93 and :89, the empty and unavailable section sentences. */
export const EMPTY_SECTION_LINE = 'No selected records in this date range. Undated records are labelled separately. No result is inferred from an empty section.';
export const UNAVAILABLE_SECTION_LINE = 'Omitted: this optional section is unavailable. The remaining selected evidence is retained. Retry this section before exporting if it is needed.';

/** Ruling S15-6: what a selected Scores or Factors section says, fixed sentences. */
export const SCORE_LINES = Object.freeze([
  'Today and Homeguard scores are not included in saved summaries yet. No score is inferred. Open Today and Homeguard for the current scores and their dates.',
  // SummaryWorkspace.tsx:72, the score section's closing sentence.
  'Higher scores are better. Today uses air, UV, pollen and the outdoor mold estimate. Homeguard uses available PFAS and radon inputs. Lead is shown separately, not scored. Completing an action does not change either score.',
]);
export const FACTOR_LINES = Object.freeze([
  'The seven factors and their sources are not included in saved summaries yet. Open each factor in Today or Homeguard for its reading, source and original date.',
]);

const WATER_CONTEXT = { utility: 'Public utility', well: 'Private well, no inferred utility match', spring: 'Private spring, no inferred utility match' };

/** The home's area for the location section: county and state only, never coordinates (Ruling S15-8). */
function areaLabel(home) {
  const parts = [home?.county, home?.state].filter((part) => typeof part === 'string' && part.trim()).map((part) => part.trim());
  return parts.length ? parts.join(', ') : '';
}

/** Ruling S15-9: no saved line may fail the client's 30,000-character check. */
function bounded(line, state) {
  if (line.length <= LIMITS.lineLength) return line;
  state.shortened = true;
  let cut = line.slice(0, LIMITS.lineLength);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut} (shortened)`;
}

/**
 * The household's category labels from a `household_bands` row, in the
 * client's order (SummaryWorkspace.tsx:65), or null when the row is missing.
 */
export function categoryLabels(row) {
  if (!row) return [];
  return CATEGORY_LABELS.filter(([band]) => BAND_KEYS.includes(band) && row[band] === true).map(([, label]) => label);
}

/**
 * The snapshot for a prepare, from what the server read. Returns
 * `{ ok: true, summary }` (the commit function's p_summary) or
 * `{ ok: false, reason }`.
 *
 *   selection   the parsed selection
 *   records     the requested {kind, id, revision}, already checked
 *   sources     {<record section>: [stored rows]} for the selected sections;
 *               a section whose source could not be read is null (unavailable)
 *   home        the current home context row, or null
 *   categories  category labels (read only when `selection.categories`)
 */
export function composeSummary({ id, createdAt, selection, records, sources, home, categories }) {
  const state = { shortened: false };
  const wanted = new Map(records.map((record) => [`${record.kind}:${record.id}`, record]));
  const sections = [];
  const manifest = [];
  const withheld = [];
  const unavailable = [];

  if (selection.sections.scores) { sections.push({ title: 'Two score snapshot', lines: [...SCORE_LINES] }); withheld.push('scores'); }
  if (selection.sections.factors) { sections.push({ title: 'Seven factors, with their original dates', lines: [...FACTOR_LINES] }); withheld.push('factors'); }
  for (const section of RECORD_SECTIONS) {
    if (!selection.sections[section]) continue;
    const rows = sources[section];
    if (!Array.isArray(rows)) {
      sections.push({ title: SECTION_LABELS[section], lines: [UNAVAILABLE_SECTION_LINE] });
      unavailable.push(section);
      continue;
    }
    // Stored order (oldest first, as the screen lists them), the selected ones only.
    const chosen = rows.filter((row) => wanted.has(`${section}:${row.id}`));
    const lines = chosen.flatMap((row) => recordDetails(section, row, selection)).map((line) => bounded(line, state));
    for (const row of chosen) manifest.push({ kind: section, id: row.id, revision: row.revision, asOf: recordDate(row) || null });
    sections.push({ title: SECTION_LABELS[section], lines: lines.length ? lines : [EMPTY_SECTION_LINE] });
  }
  // SummaryWorkspace.tsx:94-95.
  if (selection.categories) sections.push({ title: 'Household categories you chose to include', lines: [categories?.length ? categories.join(', ') : 'No household categories selected.'] });
  if (selection.location) sections.push({ title: 'Included location context', lines: [`Selected area: ${areaLabel(home) || 'Not supplied'}. No street address or device location included.`] });

  // SummaryWorkspace.tsx:96-107: the scope line, the exclusions and the appendix, as report sections so the exported text carries them.
  const scopeLabels = [!selection.categories && 'Household categories', !selection.location && 'Location labels', !selection.notes && 'Private notes', !selection.attachments && 'Attachment references', 'Original attachment contents and metadata', ...RECORD_SECTIONS.filter((key) => !selection.sections[key]).map((key) => SECTION_LABELS[key])].filter(Boolean).join('; ');
  sections.push({
    title: 'Omissions and scope',
    lines: [
      `Omitted by selection or export scope: ${scopeLabels}.`,
      ...(selection.excluded.length ? [`${selection.excluded.length} record selection(s) are excluded.`] : []),
      'Attachment names only. Original files and photo metadata are not included.',
    ],
  });
  if (selection.appendix) {
    sections.push({ title: 'Evidence appendix', lines: [...(selection.sections.factors ? FACTOR_LINES : []), 'Recorded work does not prove improved water, air or health.'] });
  }

  const omissions = [
    ...(!selection.categories ? ['Household categories were not included.'] : []),
    ...(!selection.location ? ['Location labels were not included.'] : []),
    ...(!selection.notes ? ['Private notes were not included.'] : []),
    ...(!selection.attachments ? ['Attachment references were not included.'] : []),
    'Original attachment contents and metadata are never included.',
    ...SECTIONS.filter((key) => !selection.sections[key]).map((key) => `${SECTION_LABELS[key]} were not selected.`),
    ...withheld.map((key) => `${SECTION_LABELS[key]} are not included in saved summaries yet.`),
    ...unavailable.map((key) => `${SECTION_LABELS[key]} were unavailable when this summary was prepared.`),
    ...(selection.excluded.length ? [`${selection.excluded.length} record selection(s) were excluded.`] : []),
    ...(state.shortened ? ['Some long text was shortened to fit this summary.'] : []),
  ];

  if (sections.some((section) => section.lines.length > LIMITS.sectionLines)) return { ok: false, reason: 'too_large' };
  const water = WATER_CONTEXT[normalizeWaterSource(home?.water_source) ?? ''] ?? 'Not supplied';
  const report = {
    title: selection.purpose,
    generated: createdAt,
    // SummaryWorkspace.tsx:97-100.
    introduction: [
      `Purpose: ${selection.purpose}.`,
      `Generated: ${createdAt}. Selected private-record dates: ${selection.start} through ${selection.end}. Existing environmental observations retain their original dates even when older than this range.`,
      `Water context: ${water}.`,
    ],
    sections,
  };
  const summary = { id, title: selection.purpose, createdAt, homeContextId: home?.id ?? null, report, selection, manifest, omissions };
  if (Buffer.byteLength(JSON.stringify(summary), 'utf8') > LIMITS.snapshotBytes) return { ok: false, reason: 'too_large' };
  return { ok: true, summary };
}

/**
 * Whether every requested record is in what the server read, at the exact
 * revision the person reviewed (Ruling S15-5). Sections whose source is null
 * (unavailable) are not checked: nothing of them is saved.
 */
export function requestedRecordsCurrent(records, sources) {
  return records.every((record) => {
    const rows = sources[record.kind];
    if (!Array.isArray(rows)) return true;
    return rows.some((row) => row.id === record.id && row.revision === record.revision);
  });
}

// ---------------------------------------------------------------------------
// The RPC wrappers
// ---------------------------------------------------------------------------

const requireOwner = (profileId) => { if (!profileId) throw new Error('summaryStore: a summary needs an owner'); };

/** `{items, complete}`, newest first. Throws the Supabase error as it came. */
export async function readSummaryList(supabase, profileId, limit = LIMITS.listed) {
  requireOwner(profileId);
  const { data, error } = await supabase.rpc('read_household_summaries', { p_profile_id: profileId, p_limit: limit });
  if (error) throw error;
  if (!isObject(data) || !Array.isArray(data.items) || typeof data.complete !== 'boolean') {
    throw new Error('summaryStore: read_household_summaries returned an unexpected shape');
  }
  return { items: data.items, complete: data.complete };
}

/** One saved snapshot of this household, or null. */
export async function readSummary(supabase, profileId, summaryId) {
  requireOwner(profileId);
  const { data, error } = await supabase.rpc('read_household_summary', { p_profile_id: profileId, p_summary_id: summaryId });
  if (error) throw error;
  if (data !== null && !isObject(data)) throw new Error('summaryStore: read_household_summary returned an unexpected shape');
  return data ?? null;
}

/** How many summaries this household has saved. Also proves 0029 before a claim. */
export async function summaryUsage(supabase, profileId) {
  requireOwner(profileId);
  const { data, error } = await supabase.rpc('household_summary_usage', { p_profile_id: profileId });
  if (error) throw error;
  if (!isObject(data) || !Number.isSafeInteger(Number(data.summaries))) throw new Error('summaryStore: household_summary_usage returned an unexpected shape');
  return Number(data.summaries);
}

/** The commit (0029 section 3): the saved snapshot, or the Supabase error thrown as it came. */
export async function commitSummary(supabase, { profileId, operationId, summary }) {
  requireOwner(profileId);
  const { data, error } = await supabase.rpc('commit_household_summary', { p_profile_id: profileId, p_operation_id: operationId, p_summary: summary });
  if (error) throw error;
  if (!isObject(data)) throw new Error('summaryStore: commit_household_summary returned an unexpected shape');
  return data;
}

/** The household's bands row for the categories section, or null. */
export async function readCategoryRow(supabase, profileId) {
  requireOwner(profileId);
  const { data, error } = await supabase.from('household_bands').select(BAND_KEYS.join(', ')).eq('profile_id', profileId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** The refusal a commit error stands for, or null for an error that is not one of ours. */
export function commitRefusal(error) {
  if (!error || error.code !== 'P0001') return null;
  if (error.message === 'HALO_STALE_REVISION') return 'changed';
  if (error.message === 'HALO_HOME_CHANGED') return 'home_changed';
  if (error.message === 'HALO_LIMIT') return 'limit';
  return null;
}

/**
 * The receipt body (without operationId) for a recorded prepare, from its
 * ledger status and stored result, for a replay and for GET /api/operations
 * (Ruling S15-11). A succeeded one is answered with the snapshot read now, or
 * `failed` `gone` if it has since been cleared; every failure with its
 * sentence; `cancelled`, which no summary writer sets, as failed (Ruling
 * S15-3), because the client never settles a cancelled receipt.
 */
export async function recordedReceipt(supabase, profileId, { status, result }) {
  if (status === 'succeeded') {
    const summaryId = isObject(result) && typeof result.summaryId === 'string' && UUID.test(result.summaryId) ? result.summaryId : null;
    const snapshot = summaryId ? await readSummary(supabase, profileId, summaryId) : null;
    return snapshot ? { status: 'succeeded', snapshot } : refusalBody('gone');
  }
  if (status === 'pending' || status === 'unknown') return { status, message: IN_FLIGHT_MESSAGE };
  const reason = isObject(result) ? result.reason : null;
  if (status === 'failed' && (STORED_REFUSALS.includes(reason) || reason === 'abandoned')) return refusalBody(reason);
  return refusalBody('not_applied');
}
