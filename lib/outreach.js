/**
 * B17 outreach preparation, never sending (docs/backend/plans/b17-outreach-preparation.md,
 * Rulings O1 to O8): the official contact match, the dated public context, the
 * prepare check and the draft rows, and the answers the eight routes give.
 *
 * NOTHING HERE SENDS ANYTHING. There is no email provider, no OAuth client, no
 * network call and no mail library: the contact directory and the public
 * context are static, source-recorded files in lib/data, and a prepared draft
 * is stored for the person to copy into their own email.
 * test/outreachNoSend.test.mjs fails if any B17 file reaches for one.
 *
 * Identity is the verified session's user id only (requireUser), passed in as
 * `profileId`; every draft statement is scoped to it in SQL (migration 0031).
 */
import { apiError, ERROR_CODES } from './apiErrors.js';
import { hasControlCharacters } from './validate.js';
import { placeById, placePoint } from './places.js';
import { countyForPoint } from './geoContainment.js';
import directory from './data/ncOutreachContacts.json' with { type: 'json' };
import waterFile from './data/ncWaterStewardship.json' with { type: 'json' };

/** The ledger domain of a prepare (lib/operations.js OPERATION_DOMAINS). */
export const OUTREACH_DOMAIN = 'outreach';

/** The screen's own choices (ProductionOutreach.tsx:72, :76; explore-preview.ts recipients). */
export const TOPICS = Object.freeze(['Drinking water', 'Air & outdoor conditions', 'A home concern', 'Parks & public spaces', 'Volunteering', 'Another community question']);
export const RECIPIENTS = Object.freeze(['Utility', 'Landlord', 'Representative', 'Local office']);
export const WATERS = Object.freeze(['Utility', 'Private well', 'Private spring']);

/** Ruling O6. */
export const LIMITS = Object.freeze({ drafts: 100, notes: 30, body: 20000, subject: 200, name: 160, to: 254, signature: 200000, bodyBytes: 400000 });

/** Ruling O2: always this, because no provider is connected or connectable. */
export const CONNECTION = Object.freeze({ connected: false, sender: null, revision: 1 });

/** Server-authored sentences. Plain, no U+2014 (AGENTS.md). */
export const MESSAGES = Object.freeze({
  unavailable: 'Preparing outreach messages is not available yet. Nothing was saved or sent.',
  unsupported: 'HALO does not send email. Copy your message into your own email app. Nothing was sent.',
  landlord: 'HALO does not look up landlords. Use your lease or your property manager\'s published contact details.',
  noArea: 'Choose a North Carolina county, city or ZIP code to find an official contact.',
  noOffice: 'No official public contact is known for this question and area. You can use an official website or add a public address you checked.',
  utilityWater: 'Utility contacts are for homes on a public water system.',
  notesUnavailable: 'Saved notes are not available yet, so they cannot be included. Nothing was saved.',
  staleNote: 'A selected note changed or was removed. Choose it again before preparing.',
  staleContext: 'The public context changed. Review the current source before preparing.',
  areaChanged: 'Your saved area changed. Review the recipient and area again.',
  senderChanged: 'The email setup changed. Review the message again.',
  sectionsDiffer: 'The included notes or public context do not match what is saved. Review the message again.',
  limit: 'You have reached the limit of saved drafts. Nothing was saved.',
  changedElsewhere: 'This draft changed since. Review the current draft.',
  incomplete: 'That earlier prepare did not finish. Review your draft and try again.',
  inFlight: 'That prepare is still being processed. Check your drafts before trying again.',
  mismatch: 'That request was already made with different details. Please try again.',
  notFound: 'There is no message with this id. HALO has never sent a message.',
});

/** Flag off or 0031 (or 0017) missing, for a read: the non-retryable 503 (Ruling O1). */
export const readUnavailable = (requestId) =>
  apiError({ status: 503, code: ERROR_CODES.FEATURE_UNAVAILABLE, message: MESSAGES.unavailable, retryable: false, requestId });

/** Flag off or a migration missing, for a POST: a definite 403, so the screen never locks (Ruling O1). */
export const writeUnavailable = (requestId, message = MESSAGES.unavailable) =>
  apiError({ status: 403, code: ERROR_CODES.FEATURE_UNAVAILABLE, message, retryable: false, requestId });

/** Connect and send (Ruling O2): refused before any body is read or any claim is made. */
export const sendingUnsupported = (requestId) =>
  apiError({ status: 403, code: ERROR_CODES.FEATURE_UNAVAILABLE, message: MESSAGES.unsupported, retryable: false, requestId, extra: { reason: 'email_sending_unsupported' } });

/** "Not there yet": a 0031 function (PostgREST, Postgres), then a table. */
const UNAVAILABLE_CODES = new Set(['PGRST202', '42883', 'PGRST205', '42P01']);
export const isOutreachUnavailable = (error) => !!error && UNAVAILABLE_CODES.has(error.code);

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const EM_DASH = '\u2014';
/** The screen's own `clean` (ProductionOutreach.tsx:17). */
export const clean = (value) => value.replace(/\u2014/g, ',');
/** The client's validEmail (outreach-service.ts:4). */
export const validEmail = (value) => typeof value === 'string' && value.length <= 254 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) && /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(value);

// ---------------------------------------------------------------- the files

/** The directory and water files' shape; a broken file is answered unavailable, never as "no contact". */
function directoryUsable() {
  return isObject(directory) && typeof directory.retrieved === 'string' && Array.isArray(directory.statewide)
    && Array.isArray(directory.counties) && directory.counties.length === 100
    && directory.counties.every((c) => isObject(c) && /^37\d{3}$/.test(c.id) && isObject(c.health) && isObject(c.extension));
}
function waterUsable() {
  return isObject(waterFile) && typeof waterFile.version === 'string' && Array.isArray(waterFile.releases) && Array.isArray(waterFile.notices);
}
export const sourcesUsable = () => directoryUsable() && waterUsable();

const STATE = new Map((directory.statewide ?? []).map((entry) => [entry.id, entry]));
const COUNTIES = new Map((directory.counties ?? []).map((entry) => [entry.id, entry]));
const COUNTY_BY_TITLE = new Map((directory.counties ?? []).map((entry) => [entry.title, entry]));

// --------------------------------------------------------------- the area

/**
 * The client's `area` (a DiscoveryPlace, or the blank `{place: '', state: ''}`)
 * as the gazetteer's own copy, or null. Only `id` is read: the rest is never
 * trusted (the B05 D8 pattern). `{ ok: false }` for a value that is not an area.
 */
export function parseArea(value) {
  if (!isObject(value)) return { ok: false };
  if (value.id === undefined) return { ok: true, place: null };
  if (typeof value.id !== 'string' || value.id.length > 80) return { ok: false };
  return { ok: true, place: placeById(value.id), unknown: !placeById(value.id) };
}

/** The county a place is in: a county directly, a city or ZIP by its Census internal point (Ruling O3). */
export function countyFor(place) {
  if (!place) return null;
  const county = /^us-county:(37\d{3})$/.exec(place.id);
  if (county) return COUNTIES.get(county[1]) ? { entry: COUNTIES.get(county[1]), byPoint: false } : null;
  const point = placePoint(place.id);
  const name = point ? countyForPoint(point.lat, point.lng) : null;
  const entry = name ? COUNTY_BY_TITLE.get(name) : null;
  return entry ? { entry, byPoint: true } : null;
}

// ------------------------------------------------------------- the contacts

/** One statewide office as the client's PublicContact. */
function stateContact(id) {
  const entry = STATE.get(id);
  return {
    id: entry.id, revision: entry.revision, name: entry.name, role: entry.role, organization: entry.organization,
    email: entry.email, url: entry.url, checkedAt: directory.retrieved, jurisdiction: entry.jurisdiction, reason: entry.reason,
  };
}

const placedNote = (place, county) => (county.byPoint
  ? ` ${place.label} is matched to ${county.entry.title} by its Census center point; check that this office serves your address.`
  : '');

function healthContact(place, county) {
  const { entry } = county;
  const contact = {
    id: `nc-lhd-${entry.id}`, revision: entry.revision, name: `Local health department for ${entry.title}`,
    role: 'County public health office', organization: 'Local health department, listed by NC DHHS', email: null,
    url: entry.health.url, checkedAt: directory.retrieved, jurisdiction: `Listed for ${entry.title}.`,
    reason: `NC DHHS lists this local health department for ${entry.title}, phone ${entry.health.phone}. Ask which of its offices handles your question.${placedNote(place, county)}`,
    phone: entry.health.phone,
  };
  if (entry.health.listedWebsite !== entry.health.url) contact.listedWebsite = entry.health.listedWebsite;
  return contact;
}

function extensionContact(place, county) {
  const { entry } = county;
  return {
    id: `nc-extension-${entry.id}`, revision: entry.revision, name: `${entry.title} Extension center`,
    role: 'County Cooperative Extension center', organization: 'NC State Extension', email: null,
    url: entry.extension.url, checkedAt: directory.retrieved, jurisdiction: `Listed for ${entry.title}.`,
    reason: `NC State Extension lists this center for ${entry.title}. Confirm with the center which programs and staff can help.${placedNote(place, county)}`,
  };
}

/** Which offices answer a local question, by topic and water context (Ruling O3). */
function localOffices(topic, water) {
  if (topic === 'Drinking water') return { county: ['health'], state: [water === 'Utility' ? 'nc-deq-public-water-supply' : 'nc-dhhs-private-wells'] };
  if (topic === 'Air & outdoor conditions') return { county: ['health'], state: ['nc-deq-air-quality'] };
  if (topic === 'A home concern') return { county: ['health'], state: ['nc-dhhs-oee'] };
  if (topic === 'Parks & public spaces') return { county: [], state: ['nc-state-parks'] };
  if (topic === 'Volunteering') return { county: ['extension'], state: [] };
  return { county: ['extension', 'health'], state: [] };
}

const answer = (contacts, message = null) => ({ contacts, coverage: contacts.length ? 'matched' : 'none', ...(message ? { message } : {}) });

/**
 * `contacts.resolve`: official public offices for a question and an area, or
 * none with the reason. Never a person's address, never a constructed one.
 */
export function resolveContacts({ topic, recipient, water, place }) {
  if (recipient === 'Landlord') return answer([], MESSAGES.landlord);
  if (recipient === 'Representative') return answer([stateContact('ncga-find-your-legislators'), stateContact('us-house-find-your-representative')]);
  if (recipient === 'Utility') {
    if (water !== 'Utility') return answer([], MESSAGES.utilityWater);
    return answer([stateContact('nc-deq-public-water-supply')]);
  }
  const offices = localOffices(topic, water);
  const statewide = offices.state.map(stateContact);
  const county = countyFor(place);
  if (!county) return answer(statewide, statewide.length ? (place ? null : MESSAGES.noArea) : (place ? MESSAGES.noOffice : MESSAGES.noArea));
  const local = offices.county.map((kind) => (kind === 'health' ? healthContact(place, county) : extensionContact(place, county)));
  return answer([...local, ...statewide]);
}

// -------------------------------------------------------- the public context

/** `nc-water-2026-10-20` as 20261020: the evidence revision changes when the file is rebuilt (Ruling O4). */
export const EVIDENCE_REVISION = Number(String(waterFile.version ?? '').replace(/^nc-water-/, '').replace(/-/g, '')) || 1;

const pct = (value) => `${Number(value).toFixed(2).replace(/\.?0+$/, '')}%`;

/**
 * `outreach.context`: dated public records for a drinking water question in
 * the area's county (Ruling O4). `{revision, availability, entries}`, the
 * client's OutreachEvidence, plus `complete`.
 */
export function publicContext({ topic, water, place }) {
  const empty = { revision: EVIDENCE_REVISION, availability: 'empty', entries: [], complete: true };
  if (topic !== 'Drinking water') return empty;
  const county = countyFor(place);
  if (!county) return empty;
  const entries = [];
  const latest = waterFile.releases.filter((r) => r.countyId === county.entry.id).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (latest) {
    entries.push({
      id: latest.id,
      title: `U.S. Drought Monitor for ${county.entry.title}`,
      text: `Share of ${county.entry.title} in each category on the map dated ${latest.date}: none ${pct(latest.none)}, D0 ${pct(latest.d0)}, D1 ${pct(latest.d1)}, D2 ${pct(latest.d2)}, D3 ${pct(latest.d3)}, D4 ${pct(latest.d4)}.`,
      scope: latest.scope,
      asOf: latest.date,
      url: latest.sourceUrl,
    });
  }
  if (water === 'Utility') {
    const suffix = `(${county.entry.title})`;
    for (const notice of waterFile.notices.filter((n) => n.title.endsWith(suffix)).sort((a, b) => a.title.localeCompare(b.title))) {
      const asOf = /\d{4}-\d{2}-\d{2}/.exec(notice.date)?.[0] ?? directory.retrieved;
      entries.push({
        id: notice.id,
        title: `${notice.title}: water conservation status`,
        text: `Status: ${notice.status}. ${notice.date}.`,
        scope: notice.scope,
        asOf,
        url: notice.sourceUrl,
      });
    }
  }
  const complete = entries.length <= 30;
  return { revision: EVIDENCE_REVISION, availability: entries.length ? 'ready' : 'empty', entries: entries.slice(0, 30), complete };
}

// ----------------------------------------------------------- request shapes

const fieldError = (field, code, message) => ({ field, code, message });
const exactKeys = (value, keys) => isObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

/** `{topic, recipient, water, area}`: the lookup's body (ProductionOutreach.tsx:57) and the context's query. */
export function parseNeed(value, { recipient: needsRecipient = true } = {}) {
  const keys = needsRecipient ? ['area', 'recipient', 'topic', 'water'] : ['area', 'topic', 'water'];
  const errors = [];
  if (!isObject(value)) return { ok: false, fieldErrors: [fieldError('body', 'invalid', 'Send a topic, a recipient, a water context and an area.')] };
  for (const key of Object.keys(value)) if (!keys.includes(key)) errors.push(fieldError(key, 'unknown_field', `Only ${keys.join(', ')} can be sent.`));
  if (!TOPICS.includes(value.topic)) errors.push(fieldError('topic', 'invalid_choice', 'Choose one of the listed topics.'));
  if (needsRecipient && !RECIPIENTS.includes(value.recipient)) errors.push(fieldError('recipient', 'invalid_choice', 'Choose one of the listed recipients.'));
  if (!WATERS.includes(value.water)) errors.push(fieldError('water', 'invalid_choice', 'Choose one of the listed water contexts.'));
  const area = parseArea(value.area);
  if (!area.ok) errors.push(fieldError('area', 'invalid_area', 'Choose an area from the list.'));
  if (errors.length) return { ok: false, fieldErrors: errors };
  return { ok: true, value: { topic: value.topic, recipient: value.recipient, water: value.water, place: area.place } };
}

/** The context GET: `?topic=&water=&area=<json>` (runtime.ts:111-115). */
export function parseContextQuery(searchParams) {
  let area;
  const raw = searchParams.get('area');
  if (raw === null) area = { place: '', state: '' };
  else if (raw.length > 2000) return { ok: false, fieldErrors: [fieldError('area', 'invalid_area', 'Choose an area from the list.')] };
  else {
    try { area = JSON.parse(raw); } catch { return { ok: false, fieldErrors: [fieldError('area', 'invalid_area', 'Choose an area from the list.')] }; }
  }
  return parseNeed({ topic: searchParams.get('topic'), water: searchParams.get('water'), area }, { recipient: false });
}

const PREPARE_KEYS = Object.freeze(['body', 'context', 'name', 'notes', 'publicContext', 'senderRevision', 'signature', 'subject', 'to']);
const positiveInt = (value) => Number.isSafeInteger(value) && value >= 1 && value < 2147483647;
const singleLine = (text) => !hasControlCharacters(text);

/**
 * The prepare body, exactly the screen's keys (ProductionOutreach.tsx:63).
 * `{ ok, value }` or `{ ok: false, fieldErrors }`. The included sections are
 * checked later, against the saved notes and the current context.
 */
export function parsePrepare(value) {
  const errors = [];
  const add = (field, code, message) => errors.push(fieldError(field, code, message));
  if (!isObject(value)) return { ok: false, fieldErrors: [fieldError('body', 'invalid', 'Send the message to prepare.')] };
  for (const key of Object.keys(value)) if (!PREPARE_KEYS.includes(key)) add(key, 'unknown_field', 'This field cannot be sent.');
  for (const key of PREPARE_KEYS) if (!Object.hasOwn(value, key)) add(key, 'required', 'This field is required.');
  if (errors.length) return { ok: false, fieldErrors: errors };

  const { to, name, subject, body, notes, publicContext: chosen, context, signature, senderRevision } = value;
  if (typeof to !== 'string' || (to !== '' && !validEmail(to)) || to !== to.trim()) add('to', 'invalid_email', 'Use a single public email address, or leave it empty.');
  if (typeof name !== 'string' || Array.from(name).length > LIMITS.name || !singleLine(name)) add('name', 'invalid_text', `Use ${LIMITS.name} characters or fewer on one line.`);
  if (typeof subject !== 'string' || !subject.trim() || subject !== subject.trim() || Array.from(subject).length > LIMITS.subject || !singleLine(subject) || subject.includes(EM_DASH)) {
    add('subject', 'invalid_subject', `Use a subject of ${LIMITS.subject} characters or fewer on one line.`);
  }
  if (typeof body !== 'string' || !body.trim() || Array.from(body).length > LIMITS.body || hasControlCharacters(body, { allowNewlines: true }) || body.includes(EM_DASH)) {
    add('body', 'invalid_body', `Write a message of ${LIMITS.body} characters or fewer.`);
  }
  if (!Array.isArray(notes) || notes.length > LIMITS.notes
    || !notes.every((note) => exactKeys(note, ['id', 'revision']) && typeof note.id === 'string' && note.id.length >= 1 && note.id.length <= 200 && positiveInt(note.revision))
    || new Set(notes.map((note) => note.id)).size !== notes.length) {
    add('notes', 'invalid_notes', `Choose at most ${LIMITS.notes} saved notes, each once.`);
  }
  if (chosen !== null && !(exactKeys(chosen, ['id', 'revision']) && typeof chosen.id === 'string' && chosen.id.length >= 1 && chosen.id.length <= 200 && positiveInt(chosen.revision))) {
    add('publicContext', 'invalid_context', 'Choose a listed source entry, or none.');
  }
  const need = exactKeys(context, ['area', 'recipient', 'topic', 'water']) ? parseNeed(context) : { ok: false, fieldErrors: [fieldError('context', 'invalid', 'Send the topic, recipient, area and water context.')] };
  if (!need.ok) errors.push(...need.fieldErrors.map((item) => ({ ...item, field: `context.${item.field}` })));
  else if (need.value.recipient === 'Utility' && need.value.water !== 'Utility') add('context.recipient', 'invalid_choice', MESSAGES.utilityWater);
  if (typeof signature !== 'string' || !signature || signature.length > LIMITS.signature) add('signature', 'invalid_signature', 'Review the message again.');
  if (!Number.isSafeInteger(senderRevision)) add('senderRevision', 'invalid_revision', 'Review the message again.');
  if (errors.length) return { ok: false, fieldErrors: errors };
  return {
    ok: true,
    value: { to, name, subject, body, notes, publicContext: chosen, signature, senderRevision, ...need.value, rawArea: context.area },
  };
}

/**
 * The included sections exactly as the screen composes them
 * (ProductionOutreach.tsx:43-44), from the server's own copies: the source
 * entry as `outreach.context` answers it and each note's saved title and
 * description, in the order the person chose them.
 */
export function includedSections(entry, notes) {
  const evidenceText = entry ? `\n\nPublic context I chose to include:\n${entry.title}\n${entry.text}\n${entry.scope}\nAs of ${entry.asOf}\n${entry.url}` : '';
  const notesText = notes.length ? `\n\nNotes I chose to include:\n${notes.map((note) => `${note.title}\n${note.description}`).join('\n\n')}` : '';
  return clean(`${evidenceText}${notesText}`);
}

/** One draft per household, recipient class and lowercased address (Ruling O6). */
export const draftKey = (recipient, to) => `${recipient}|${to.toLowerCase()}`;

/** What the receipt of a replayed prepare names, or null. */
export const receiptDraft = (result) => (result && typeof result.draftId === 'string' && positiveInt(result.revision) ? { id: result.draftId, revision: result.revision } : null);

/** The HALO_* code a 0031 function raised, or null. */
export function outreachErrorCode(error) {
  return error?.code === 'P0001' && typeof error.message === 'string' && /^HALO_[A-Z_]+$/.test(error.message) ? error.message : null;
}

/** Refusals a prepare stores on its ledger row and replays: the reason code only. */
export const STORED_REFUSALS = Object.freeze({
  stale_note: { status: 409, message: MESSAGES.staleNote },
  limit: { status: 422, message: MESSAGES.limit },
});

// --------------------------------------------------------------- the store

/** Every draft of the household, newest first, or the one with `draftId` ([] when it is not theirs). */
export async function readDrafts(supabase, profileId, draftId = null) {
  if (!profileId) throw new Error('outreach: reading drafts requires an owner');
  const { data, error } = await supabase.rpc('read_outreach_drafts', { p_profile_id: profileId, p_draft_id: draftId });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('outreach: read_outreach_drafts returned an unexpected shape');
  return data;
}

/** The draft and its receipt, written with the ledger settle in one transaction (0031). */
export async function saveDraft(supabase, { profileId, operationId, draft }) {
  const { data, error } = await supabase.rpc('save_outreach_draft', { p_profile_id: profileId, p_operation_id: operationId, p_draft: draft });
  if (error) throw error;
  if (!isObject(data) || !isObject(data.receipt) || !isObject(data.draft)) throw new Error('outreach: save_outreach_draft returned an unexpected shape');
  return data;
}

/** A nil id: the probe read that proves 0031 before a claim, and finds nothing. */
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';
