/**
 * My Week's Journal (`weekJournal`) on the journal table that already exists,
 * public.symptom_logs, through the workspace routes (migration 0034).
 *
 * The screen keeps a check-in as a workspace record (WeekJournal.tsx):
 *
 *   { id, title, revision, date, band, fine, symptoms, severity, illness,
 *     note, recalled, homeContextId? }
 *
 * and the table as the legacy journal route writes it (lib/journalInput.js):
 *
 *   { entry_date, band, symptoms, severity, note, retrospective,
 *     possibly_illness } plus 0034's record_id, revision, home_context_id
 *
 * This module is the explicit adapter between the two, in both directions,
 * and the two calls of 0034's functions. One store of check-ins, so Clear
 * Journal, clear all, the privacy export and account deletion already cover
 * every entry (0024, lib/privacyInventory.js).
 *
 * Retention (Vibhav, 2026-10-25): kept until the person deletes the entry,
 * clears the journal or all records, or deletes the account. No purge.
 *
 * Mapping decisions:
 *   - group: the screen says `toddler`, the table `has_toddler`; `household`
 *     is the same in both. A stored group the screen does not know is shown
 *     as stored.
 *   - "Felt fine" is an entry with no symptoms and no rating, which is what
 *     the legacy journal stored for it. A write must say exactly that: fine
 *     with no symptoms and no rating, or symptoms with a rating.
 *   - empty note and empty rating are null in the table and '' on screen.
 *   - the title is not stored: every check-in reads back as "Check-in".
 *   - the app id is kept exactly; an entry with none (legacy) reads back as
 *     `journal:<date>:<group>` (0034's rule).
 */
import { parseJournalEntry } from './journalInput.js';
import { localDate } from './localDate.js';
import { JOURNAL_SEVERITIES } from './limits.js';

/** The workspace collection this adapter serves. */
export const JOURNAL_COLLECTION = 'weekJournal';

/** At most this many entries are read (read_week_journal's limit, the workspace's W7 limit); more is answered partial. */
export const JOURNAL_READ_LIMIT = 1000;

/** The title every check-in reads back with: the table keeps none. */
export const JOURNAL_TITLE = 'Check-in';

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/** The screen's group key as the table stores it. */
export function bandToTable(band) {
  return band === 'household' ? 'household' : `has_${band}`;
}

/** The table's group as the screen names it. */
export function bandFromTable(band) {
  return typeof band === 'string' && band.startsWith('has_') ? band.slice(4) : band;
}

/**
 * A workspace record (already through the client's row check) as the entry
 * 0034 stores. `{ ok: true, entry, homeContextId }`, or `{ ok: false }` for a
 * record the journal cannot hold as it is (an invalid record, refused before
 * any claim). `today` is the household's local date.
 */
export function entryFromRecord(record, { today = localDate() } = {}) {
  if (!isObject(record) || typeof record.fine !== 'boolean' || !Array.isArray(record.symptoms)) return { ok: false };
  const severity = record.severity === '' ? null : record.severity;
  if (record.fine) {
    if (record.symptoms.length !== 0 || severity !== null) return { ok: false };
  } else if (record.symptoms.length === 0 || !JOURNAL_SEVERITIES.includes(severity)) {
    return { ok: false };
  }
  if (typeof record.band !== 'string' || record.band === '') return { ok: false };
  const parsed = parseJournalEntry({
    entry_date: record.date,
    band: bandToTable(record.band),
    symptoms: record.symptoms,
    severity,
    note: record.note === '' ? null : record.note,
    retrospective: record.recalled,
    possibly_illness: record.illness,
  }, { today });
  if (!parsed.ok) return { ok: false };
  const homeContextId = typeof record.homeContextId === 'string' && record.homeContextId !== '' ? record.homeContextId : null;
  return { ok: true, entry: parsed.value, homeContextId };
}

/** One row of read_week_journal as the workspace record the screen keeps. */
export function recordFromRow(row) {
  const symptoms = Array.isArray(row.symptoms) ? row.symptoms : [];
  const severity = typeof row.severity === 'string' ? row.severity : '';
  return {
    id: row.id,
    title: JOURNAL_TITLE,
    revision: row.revision,
    date: row.entry_date,
    band: bandFromTable(row.band),
    fine: symptoms.length === 0 && severity === '',
    symptoms,
    severity,
    illness: row.possibly_illness === true,
    note: typeof row.note === 'string' ? row.note : '',
    recalled: row.retrospective === true,
    ...(typeof row.home_context_id === 'string' && row.home_context_id !== '' ? { homeContextId: row.home_context_id } : {}),
  };
}

const validRow = (row) => isObject(row) && typeof row.id === 'string' && row.id !== ''
  && Number.isSafeInteger(row.revision) && row.revision >= 1 && typeof row.entry_date === 'string' && typeof row.band === 'string';

/** read_week_journal's answer as `{ records, complete }`; throws on a shape it does not recognise. */
export function journalFromAnswer(answer) {
  if (!isObject(answer) || !Array.isArray(answer.rows) || !Number.isSafeInteger(Number(answer.total)) || !answer.rows.every(validRow)) {
    throw new Error('weekJournalStore: read_week_journal returned an unexpected shape');
  }
  return { records: answer.rows.map(recordFromRow), complete: Number(answer.total) <= answer.rows.length };
}

/** The household's check-ins, newest first. Throws the Supabase error as it came (a missing 0034 is PGRST202/42883). */
export async function readWeekJournal(supabase, profileId) {
  if (!profileId) throw new Error('weekJournalStore: reading entries requires an owner');
  const { data, error } = await supabase.rpc('read_week_journal', { p_profile_id: profileId });
  if (error) throw error;
  return journalFromAnswer(data);
}

/**
 * One call of commit_week_journal. `write` is the plan
 * (`{kind: 'write', id, expectedRevision, homeContextId, entry}` or
 * `{kind: 'remove', id, expectedRevision}`). Returns `{receipt, changes}` in
 * the shape commitWorkspace returns for the other collections.
 */
export async function commitWeekJournal(supabase, { profileId, operationId, write }) {
  if (!profileId) throw new Error('weekJournalStore: committing entries requires an owner');
  const { data, error } = await supabase.rpc('commit_week_journal', {
    p_profile_id: profileId,
    p_operation_id: operationId,
    p_write: write,
  });
  if (error) throw error;
  const receipt = data?.receipt;
  if (!isObject(data) || !isObject(receipt) || receipt.status !== 'succeeded' || !Array.isArray(receipt.affected) || !Array.isArray(receipt.removed)) {
    throw new Error('weekJournalStore: commit_week_journal returned an unexpected shape');
  }
  const { records } = journalFromAnswer(data.journal);
  return {
    receipt: { status: 'succeeded', collections: [JOURNAL_COLLECTION], affected: receipt.affected, removed: receipt.removed, unresolvedOperations: [] },
    changes: { [JOURNAL_COLLECTION]: records },
  };
}
