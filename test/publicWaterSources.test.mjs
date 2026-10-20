/**
 * The shared water parsers (B19, lib/publicWaterSources.js) on the recorded
 * B12 downloads in test/fixtures/public-evidence/, with no network.
 *
 * The fixtures are byte-for-byte the files the bundled copy was built from
 * (their sha256 is the one lib/data/ncWaterStewardship.json records), so the
 * parsers must reproduce the committed releases and notices exactly. Then
 * every strict check refuses its own broken copy with its fixed code.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const {
  COUNTY_COUNT, WaterSourceError, createReviser, parseConservationStatus, parseDroughtStatistics, usdmUrl, isCalendarDate,
} = await import('../lib/publicWaterSources.js');

const fixture = (name) => readFileSync(new URL(`./fixtures/public-evidence/${name}`, import.meta.url));
const USDM_BYTES = fixture('usdm-nc.json');
const WUDC_BYTES = fixture('wudc.html');
const usdm = () => JSON.parse(USDM_BYTES.toString('utf8'));
const wudc = () => WUDC_BYTES.toString('utf8');
const water = JSON.parse(readFileSync(new URL('../lib/data/ncWaterStewardship.json', import.meta.url), 'utf8'));
const withoutRevision = (rows) => rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'revision')));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

function refused(fn, code) {
  assert.throws(fn, (error) => error instanceof WaterSourceError && error.code === code, `expected ${code}`);
}

test('the fixtures are the downloads the bundled copy records', () => {
  assert.equal(sha(USDM_BYTES), water.source.drought.input.sha256);
  assert.equal(sha(WUDC_BYTES), water.source.utility.input.sha256);
  assert.equal(USDM_BYTES.length, water.source.drought.input.bytes);
  assert.equal(WUDC_BYTES.length, water.source.utility.input.bytes);
});

test('drought: the recorded download parses into exactly the committed releases', () => {
  const { releases, mapDates, newestMapDate } = parseDroughtStatistics(usdm());
  assert.deepEqual(releases, withoutRevision(water.releases));
  assert.deepEqual(mapDates, ['2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13']);
  assert.equal(newestMapDate, '2026-10-13');
});

test('utility: the recorded page parses into exactly the committed notices, summary and total', () => {
  const { notices, summary, total, newestUpdate } = parseConservationStatus(wudc());
  assert.deepEqual(notices, withoutRevision(water.notices));
  assert.deepEqual(summary, water.source.utility.summary);
  assert.equal(total, water.source.utility.total);
  assert.ok(isCalendarDate(newestUpdate));
  assert.ok(water.notices.some((notice) => notice.date === `Status last updated ${newestUpdate}`));
});

test('drought refuses a partial download: a county missing from one map, one map short, too few rows', () => {
  const rows = usdm();
  refused(() => parseDroughtStatistics(rows.filter((row, at) => at !== 5)), 'incomplete');
  refused(() => parseDroughtStatistics(rows.filter((row) => !(row.fips === '37183' && row.mapDate.startsWith('2026-10-13')))), 'incomplete');
  refused(() => parseDroughtStatistics(rows.slice(0, COUNTY_COUNT - 1)), 'incomplete');
  refused(() => parseDroughtStatistics([]), 'incomplete');
  // eleven whole weekly maps is over the bound
  const many = [];
  for (let week = 0; week < 11; week += 1) {
    const date = new Date(Date.UTC(2026, 6, 7 + week * 7)).toISOString().slice(0, 10);
    for (const row of rows.filter((r) => r.mapDate.startsWith('2026-10-13'))) many.push({ ...row, mapDate: `${date}T00:00:00`, validStart: `${date}T00:00:00`, validEnd: `${date}T23:59:59` });
  }
  refused(() => parseDroughtStatistics(many), 'incomplete');
});

test('drought refuses malformed rows and dates with fixed codes', () => {
  const rows = usdm();
  const broken = (patch) => rows.map((row, at) => (at === 7 ? { ...row, ...patch } : row));
  refused(() => parseDroughtStatistics({ rows }), 'shape');
  refused(() => parseDroughtStatistics('not a list'), 'shape');
  refused(() => parseDroughtStatistics(broken({ state: 'VA' })), 'shape');
  refused(() => parseDroughtStatistics(broken({ fips: '51001' })), 'shape');
  refused(() => parseDroughtStatistics(broken({ statisticFormatID: 1 })), 'shape');
  refused(() => parseDroughtStatistics(broken({ county: 'Somewhere County' })), 'shape');
  refused(() => parseDroughtStatistics(broken({ d1: 140 })), 'shape');
  refused(() => parseDroughtStatistics(broken({ d1: '12.5' })), 'shape');
  refused(() => parseDroughtStatistics(broken({ d1: rows[7].d1 + 5 })), 'shape');
  refused(() => parseDroughtStatistics(broken({ mapDate: '2026-02-30T00:00:00' })), 'bad_date');
  refused(() => parseDroughtStatistics(broken({ validEnd: 'soon' })), 'bad_date');
  refused(() => parseDroughtStatistics(broken({ validStart: '2026-10-30T00:00:00' })), 'bad_date');
  refused(() => parseDroughtStatistics([...rows.slice(0, -1), rows[0]]), 'shape');
  refused(() => parseDroughtStatistics(rows.map((row, at) => (at === 3 ? null : row))), 'shape');
});

test('utility refuses a partial or changed page with fixed codes', () => {
  const html = wudc();
  const firstRow = /<tr>(?:(?!<\/tr>)[\s\S])*?<td[\s\S]*?<\/tr>/.exec(html)[0];
  refused(() => parseConservationStatus(html.replace(firstRow, '')), 'incomplete');
  refused(() => parseConservationStatus(html.slice(0, Math.floor(html.length / 2))), 'incomplete');
  refused(() => parseConservationStatus(html.replace(/<div style="font-size:24px;">\d+<\/div>/, '<div style="font-size:24px;">999</div>')), 'incomplete');
  refused(() => parseConservationStatus(html.replace(/Total Systems/, 'Systems')), 'shape');
  refused(() => parseConservationStatus(html.replace(/class="status-([A-Z])">/g, 'class="badge-$1">')), 'shape');
  refused(() => parseConservationStatus(html.replace(firstRow, firstRow.replace(/<td[^>]*>[^<]*<\/td>\s*<\/tr>$/, '</tr>'))), 'shape');
  refused(() => parseConservationStatus(html.replace(firstRow, firstRow.replace(/\d{4}-\d{2}-\d{2}/, '2026-13-45'))), 'bad_date');
  refused(() => parseConservationStatus(html.replace(firstRow, firstRow.replace(/>(Voluntary|Mandatory|Not Restricted)</, '>Advisory<'))), 'shape');
  refused(() => parseConservationStatus(''), 'shape');
  refused(() => parseConservationStatus(null), 'shape');
  refused(() => parseConservationStatus(html.replace(firstRow, `${firstRow}\n${firstRow}`)), 'shape');
});

test('revisions: unchanged keeps its revision, changed is +1, new is 1, and a bad old revision restarts', () => {
  const old = [{ id: 'a', x: 1, revision: 3 }, { id: 'b', x: 1, revision: 2 }, { id: 'c', x: 1, revision: 'two' }];
  const revise = createReviser(old, '2026-10-27');
  assert.deepEqual(revise({ id: 'a', x: 1 }), { id: 'a', x: 1, revision: 3 });
  assert.deepEqual(revise({ id: 'b', x: 2 }), { id: 'b', x: 2, revision: 3 });
  assert.deepEqual(revise({ id: 'n', x: 2 }), { id: 'n', x: 2, revision: 1 });
  assert.deepEqual(revise({ id: 'c', x: 1 }), { id: 'c', x: 1, revision: 1 });
  assert.deepEqual(createReviser(undefined, '2026-10-27')({ id: 'a' }), { id: 'a', revision: 1 });
  // a copy read back from jsonb has its keys in another order: that is not a change
  assert.deepEqual(createReviser([{ x: 1, revision: 4, id: 'k', y: 'z' }], '2026-10-27')({ id: 'k', y: 'z', x: 1 }).revision, 4);
  // the committed revisions survive a re-parse of the same download
  const again = createReviser(water.releases, '2026-10-27');
  assert.deepEqual(parseDroughtStatistics(usdm()).releases.map((row) => again(row)), water.releases);
});

test('the USDM request is the documented one (DS-108): NC, M/D/YYYY dates, categorical statistics', () => {
  assert.equal(usdmUrl('2026-09-22', '2026-10-20'), water.source.drought.input.url);
});

test('drift: the hand build calls the shared parsers and keeps no copy of its own', () => {
  const script = readFileSync(new URL('../scripts/build-public-evidence.mjs', import.meta.url), 'utf8');
  assert.match(script, /parseDroughtStatistics\(json\('usdm'\)\)/);
  assert.match(script, /parseConservationStatus\(text\('wudc'\)\)/);
  assert.doesNotMatch(script, /DWR_STATUSES|statisticFormatID|Total Systems/, 'no second parser in the script');
});
