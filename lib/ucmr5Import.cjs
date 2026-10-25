/**
 * Parsing for the UCMR5 occurrence file (tab-separated, header row first), shared
 * by uploadData.js and its tests. Pure: no file system, no network, no clock.
 *
 * Each utility row stores, per contaminant, readings in the shape
 * lib/scoring.js getWaterRisk reads:
 *
 *   detection ('=')    { date, value_ppt }
 *   non-detect ('<')   { date, non_detect: true, reporting_limit_ppt }
 *
 * A non-detect is a result: the sample was analysed and nothing was found at or
 * above the reporting limit (the file's MRL). reporting_limit_ppt is null when
 * the MRL is missing or unreadable, which lib/scoring.js treats as a non-detect
 * that cannot be compared with a limit. Repeated non-detects for one compound on
 * one date with one reporting limit (several sample points) are stored once.
 *
 * Values and MRLs are converted from µg/L to ppt (x1000). A row whose Units
 * column names anything else is skipped and counted, never converted blindly;
 * a file without a Units column is read as µg/L, as before.
 */

const UG_PER_L = new Set(['µg/l', 'μg/l', 'ug/l']);

function toPpt(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const n = Number(text.trim());
  return Number.isFinite(n) && n >= 0 ? Number((n * 1000).toFixed(2)) : null;
}

/**
 * @param {Iterable<string>} lines  the file's lines, header first
 * @returns {{ utilities: Array<{pwsid:string, pws_name:string, status:string, contaminants:object}>,
 *             stats: { detections:number, non_detects:number, duplicate_non_detects:number,
 *                      skipped_units:number, skipped_unreadable:number, skipped_other_sign:number } }}
 */
function parseUcmr5Lines(lines) {
  const utilities = new Map();
  const seenNonDetects = new Set();
  const stats = { detections: 0, non_detects: 0, duplicate_non_detects: 0, skipped_units: 0, skipped_unreadable: 0, skipped_other_sign: 0 };
  let cols = null;

  for (const line of lines) {
    if (typeof line !== 'string' || line.trim() === '') continue;
    const columns = line.split('\t');
    if (!cols) {
      const at = (name) => columns.indexOf(name);
      cols = {
        pwsid: at('PWSID'),
        pwsName: at('PWSName'),
        sign: at('AnalyticalResultsSign'),
        contaminant: at('Contaminant'),
        value: at('AnalyticalResultValue'),
        date: at('CollectionDate'),
        mrl: at('MRL'),
        units: at('Units'),
      };
      for (const key of ['pwsid', 'pwsName', 'sign', 'contaminant', 'value', 'date']) {
        if (cols[key] < 0) throw new Error(`UCMR5 file is missing its ${key} column`);
      }
      continue;
    }

    const pwsid = columns[cols.pwsid];
    if (!pwsid) continue;
    if (!utilities.has(pwsid)) {
      utilities.set(pwsid, { pwsid, pws_name: columns[cols.pwsName], status: 'measured', contaminants: {} });
    }

    const sign = (columns[cols.sign] || '').trim();
    if (sign !== '=' && sign !== '<') {
      stats.skipped_other_sign += 1;
      continue;
    }
    if (cols.units >= 0) {
      const units = (columns[cols.units] || '').trim().toLowerCase();
      if (!UG_PER_L.has(units)) {
        stats.skipped_units += 1;
        continue;
      }
    }

    const name = columns[cols.contaminant];
    const date = columns[cols.date];
    if (!name) {
      stats.skipped_unreadable += 1;
      continue;
    }

    let reading;
    if (sign === '=') {
      const value = toPpt(columns[cols.value]);
      if (value === null) {
        stats.skipped_unreadable += 1;
        continue;
      }
      reading = { date, value_ppt: value };
      stats.detections += 1;
    } else {
      const rl = cols.mrl >= 0 ? toPpt(columns[cols.mrl]) : null;
      const key = `${pwsid}\u0000${name}\u0000${date}\u0000${rl}`;
      if (seenNonDetects.has(key)) {
        stats.duplicate_non_detects += 1;
        continue;
      }
      seenNonDetects.add(key);
      reading = { date, non_detect: true, reporting_limit_ppt: rl };
      stats.non_detects += 1;
    }

    const contaminants = utilities.get(pwsid).contaminants;
    if (!contaminants[name]) contaminants[name] = [];
    contaminants[name].push(reading);
  }

  return { utilities: [...utilities.values()], stats };
}

module.exports = { parseUcmr5Lines };
