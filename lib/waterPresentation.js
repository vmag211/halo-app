/**
 * Presentation helpers for the HomeGuard water response (punch list v3 item 11).
 * Additive: every existing field keeps its name and value; these add ISO dates,
 * explicit limit flags, and server-chosen latest readings so the interface never
 * has to parse dates or compare numbers against limits itself.
 *
 * Pure module.
 */

/** 'M/D/YYYY' (the UCMR5 dump's format) or ISO → 'YYYY-MM-DD'; null if unparseable. */
export function toIsoDate(date) {
  if (typeof date !== 'string') return null;
  const s = date.trim();
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (mdy) {
    const [, m, d, y] = mdy.map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

/** Every reading in water.contaminants gains date_iso (for the quarterly chart). */
export function contaminantsWithIso(contaminants) {
  if (!contaminants || typeof contaminants !== 'object') return contaminants ?? null;
  const out = {};
  for (const [name, readings] of Object.entries(contaminants)) {
    out[name] = Array.isArray(readings)
      ? readings.map((r) => (r && typeof r === 'object' ? { ...r, date_iso: toIsoDate(r.date) } : r))
      : readings;
  }
  return out;
}

/**
 * Scored contaminants gain date_iso and exceeds_limit (value_ppt > limit_ppt).
 * The interface states "above the limit" only from exceeds_limit.
 */
export function scoredWithFlags(scored) {
  return (scored || []).map((s) => ({
    ...s,
    date_iso: toIsoDate(s.date),
    exceeds_limit:
      typeof s.value_ppt === 'number' && typeof s.limit_ppt === 'number' && Number.isFinite(s.limit_ppt)
        ? s.value_ppt > s.limit_ppt
        : false,
  }));
}

export function excludedWithIso(excluded) {
  return (excluded || []).map((e) => ({ ...e, date_iso: toIsoDate(e.date) }));
}

/** The latest reading for each unregulated detection, chosen server-side. */
export function latestUnregulated(contaminants, names) {
  const out = [];
  for (const name of names || []) {
    const readings = Array.isArray(contaminants?.[name]) ? contaminants[name] : [];
    let best = null;
    for (const r of readings) {
      const iso = toIsoDate(r?.date);
      if (typeof r?.value_ppt !== 'number') continue;
      if (!best || (iso && (!best.date_iso || iso > best.date_iso))) {
        best = { contaminant: name, value_ppt: r.value_ppt, date_iso: iso };
      }
    }
    if (best) out.push(best);
  }
  return out;
}

const STALE_DAYS = 1095; // 3 years

/**
 * Confidence (§6.2):
 *   full    — everything detected was evaluated (incl. lithium-only coverage,
 *             whose detection is shown and deliberately not scored)
 *   limited — some detections couldn't be evaluated (partial coverage)
 *   stale   — evaluated, but the newest sample is 3+ years old
 *   none    — nothing could be evaluated
 * Age affects only "stale"; 2–3-year-old complete data is full (the age is
 * reported separately as data_age_days).
 */
export function waterConfidence(coverage, ageDays) {
  let base;
  if (coverage === 'complete' || coverage === 'no_detections' || coverage === 'excluded_only') base = 'full';
  else if (coverage === 'partial') base = 'limited';
  else return 'none';
  if (typeof ageDays === 'number' && ageDays > STALE_DAYS) return 'stale';
  return base;
}
