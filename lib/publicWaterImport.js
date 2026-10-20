/**
 * The weekly import of water.read's two public sources (B19 plan,
 * docs/backend/plans/b19-public-evidence-refresh.md; migration 0033), run by
 * GET|POST /api/cron/public-evidence.
 *
 *   U.S. Drought Monitor county statistics, NC, the last 28 days (spec DS-108)
 *   NC DEQ DWR "Water System Conservation Status" table (spec DS-111)
 *
 * Each is fetched once, through the bounded GET of lib/forecast/http.js (a
 * timeout over headers and body, a size cap, no retries, never a URL or body
 * in a log or a thrown error), parsed by the SAME parsers as the hand build
 * (lib/publicWaterSources.js) and checked strictly. Only a source that passes
 * is stored, as a new dated copy; one that fails stores nothing, so the last
 * good copy (or the bundled file) keeps being served. Either way the run is
 * recorded per source: stored or failed, a fixed reason code and a row count,
 * nothing else. The two sources stand alone: one failing never holds back
 * the other (proposed, Vibhav to confirm).
 *
 * Revisions continue from the copy being replaced (the newest stored one, or
 * the bundled file's rows), with the rule the build uses: an unchanged row
 * keeps its revision, so a follow saved on the screen stays current.
 *
 * Fish advisories (B12) are deliberately NOT imported: their wording is
 * published advice whose cut-off and contradictory rows a person reviewed, so
 * a new fetch must be reviewed again before it is served.
 */
import { createHash } from 'node:crypto';
import { getText } from './forecast/http.js';
import {
  DROUGHT_ISSUER, DROUGHT_SOURCE_ID, DROUGHT_STATISTIC, UTILITY_ISSUER, UTILITY_SOURCE_ID, WUDC_URL,
  WaterSourceError, createReviser, isCalendarDate, parseConservationStatus, parseDroughtStatistics, usdmUrl,
} from './publicWaterSources.js';
import { RECORD_RUN_RPC, isSnapshotStoreMissing, storedWaterSnapshots } from './publicWaterStore.js';
import { bundledWaterFile } from './publicEvidence.js';

/** Each fetch's whole exchange, headers and body. Both run at once, inside the route's 60 seconds. */
export const IMPORT_TIMEOUT_MS = 20_000;
/** Each body's cap. The drought window is about 100 KB and the table about 85 KB (2026-10-20). */
export const IMPORT_MAX_BYTES = 1024 * 1024;
/** The drought window: four or five weekly maps. */
export const DROUGHT_WINDOW_DAYS = 28;
/** A newest weekly map older than this is refused as stale (USDM publishes weekly; proposed). */
export const MAX_MAP_AGE_DAYS = 21;
/** A date this many days after the run is refused (a clock or source error). */
const FUTURE_SLACK_DAYS = 1;
const USER_AGENT = 'HALO public water import (weekly)';

const DAY = 86_400_000;
const shiftDays = (isoDate, days) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** The fixed reason a fetch failed with, as 0033 stores it. */
function fetchReason(reason) {
  return /^(timeout|network|too_large|no_timeout|bad_headers|http_\d{3})$/.test(reason) ? reason : 'network';
}

const failed = (source, reason) => ({ source, outcome: 'failed', reason, row_count: null });
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

async function fetchText(url, { fetchImpl, timeoutMs }, accept) {
  return getText(url, { fetchImpl, timeoutMs, maxBytes: IMPORT_MAX_BYTES, headers: { accept, 'user-agent': USER_AGENT } });
}

/** Parses with the shared parser; a WaterSourceError becomes its code, anything else 'internal'. */
function parse(parser, value) {
  try {
    return { ok: true, value: parser(value) };
  } catch (error) {
    return { ok: false, reason: error instanceof WaterSourceError ? error.code : 'internal' };
  }
}

async function importDrought({ fetch, today, previous }) {
  const url = usdmUrl(shiftDays(today, -DROUGHT_WINDOW_DAYS), today);
  const got = await fetchText(url, fetch, 'application/json');
  if (!got.ok) return failed(DROUGHT_SOURCE_ID, fetchReason(got.reason));
  let raw;
  try {
    raw = JSON.parse(got.text);
  } catch {
    return failed(DROUGHT_SOURCE_ID, 'invalid');
  }
  const parsed = parse(parseDroughtStatistics, raw);
  if (!parsed.ok) return failed(DROUGHT_SOURCE_ID, parsed.reason);
  const { releases, newestMapDate } = parsed.value;
  if (newestMapDate > shiftDays(today, FUTURE_SLACK_DAYS)) return failed(DROUGHT_SOURCE_ID, 'bad_date');
  if (newestMapDate < shiftDays(today, -MAX_MAP_AGE_DAYS)) return failed(DROUGHT_SOURCE_ID, 'stale');
  const revise = createReviser(previous, today);
  return {
    source: DROUGHT_SOURCE_ID,
    outcome: 'stored',
    reason: null,
    row_count: releases.length,
    snapshot: {
      source_date: newestMapDate,
      content_sha256: sha256(got.text),
      body: {
        source: { issuer: DROUGHT_ISSUER, input: { url, retrieved: today, sha256: sha256(got.text), bytes: Buffer.byteLength(got.text, 'utf8') }, statistic: DROUGHT_STATISTIC },
        releases: releases.map((row) => revise(row)),
      },
    },
  };
}

async function importUtility({ fetch, today, previous }) {
  const got = await fetchText(WUDC_URL, fetch, 'text/html');
  if (!got.ok) return failed(UTILITY_SOURCE_ID, fetchReason(got.reason));
  const parsed = parse(parseConservationStatus, got.text);
  if (!parsed.ok) return failed(UTILITY_SOURCE_ID, parsed.reason);
  const { notices, summary, total, newestUpdate } = parsed.value;
  if (!isCalendarDate(newestUpdate) || newestUpdate > shiftDays(today, FUTURE_SLACK_DAYS)) return failed(UTILITY_SOURCE_ID, 'bad_date');
  const revise = createReviser(previous, today);
  return {
    source: UTILITY_SOURCE_ID,
    outcome: 'stored',
    reason: null,
    row_count: notices.length,
    snapshot: {
      source_date: newestUpdate,
      content_sha256: sha256(got.text),
      body: {
        source: { issuer: UTILITY_ISSUER, input: { url: WUDC_URL, retrieved: today, sha256: sha256(got.text), bytes: Buffer.byteLength(got.text, 'utf8') }, summary, total },
        notices: notices.map((row) => revise(row)),
      },
    },
  };
}

/** Raised for a database failure the route answers 500 to; carries the code only. */
export class PublicImportStoreError extends Error {
  constructor(code) {
    super('public evidence store failed');
    this.name = 'PublicImportStoreError';
    this.code = code;
  }
}

/**
 * One run. Resolves to { unavailable: true } before 0033 is applied (nothing
 * is fetched), or { results: [{ source, outcome, reason, rows }] }. A
 * database failure throws a PublicImportStoreError (code only). `fetchImpl`
 * and `timeoutMs` are test seams; the route passes neither.
 */
export async function runPublicWaterImport({ supabase, fetchImpl = globalThis.fetch, timeoutMs = IMPORT_TIMEOUT_MS, now = new Date() }) {
  let stored;
  try {
    stored = await storedWaterSnapshots(supabase);
  } catch (error) {
    throw new PublicImportStoreError(error?.code ?? 'unknown');
  }
  if (stored.missing) return { unavailable: true };
  const today = now.toISOString().slice(0, 10);
  const bundled = bundledWaterFile();
  const [drought, utility] = await Promise.all([
    importDrought({ fetch: { fetchImpl, timeoutMs }, today, previous: stored.drought?.body?.releases ?? bundled?.releases }),
    importUtility({ fetch: { fetchImpl, timeoutMs }, today, previous: stored.utility?.body?.notices ?? bundled?.notices }),
  ]);
  const results = [drought, utility];
  const { error } = await supabase.rpc(RECORD_RUN_RPC, { p_results: results });
  if (error) {
    if (isSnapshotStoreMissing(error)) return { unavailable: true };
    throw new PublicImportStoreError(error.code ?? 'unknown');
  }
  for (const result of results) {
    if (result.outcome === 'failed') console.warn(`Public water import: ${result.source} not stored (${result.reason}); the previous copy is kept.`);
  }
  return { results: results.map(({ source, outcome, reason, row_count: rows }) => ({ source, outcome, reason, rows })) };
}
