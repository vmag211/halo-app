/**
 * Two households with distinct, searchable values in every owned table, for the
 * cross-identity route tests. Every string below that identifies a household
 * (county, note, title, endpoint, ...) is unique to it, so "does this response
 * contain the other household's marker" is a plain substring search of the
 * serialized body.
 *
 * Dates are relative to today (the household time zone, like the routes), so the
 * rolling windows the routes use (90 days, "today") always contain the seeds.
 */
import './routeLoader.mjs'; // registers the module hooks first, so lib files load as ESM without the typeless-package warning
const { localDate, addDays } = await import('../../lib/localDate.js');

export { localDate, addDays };

const PREFIX = { alice: 'a11ce000', bob: 'b0b00000' };
const hex12 = (n) => n.toString(16).padStart(12, '0');

/** Valid UUIDs (the journal and alert routes reject anything else) that identify one household's row. */
export const entryId = (who, n) => `${PREFIX[who]}-0000-4000-8000-${hex12(n)}`;
export const alertId = (who, n) => `${PREFIX[who]}-1111-4000-8000-${hex12(n)}`;
export const MISSING_ID = '99999999-9999-4999-8999-999999999999';

export const ENDPOINT = {
  alice: 'https://push.example.test/send/alice-device',
  bob: 'https://push.example.test/send/bob-device',
};

const PROFILE = {
  alice: {
    lat: 35.40881, lng: -80.57952, county: 'Cabarrus County', state: 'NC', zip: '28025', pwsid: 'NC9990001',
    water_source: 'utility', home_year: 1988, renter_mode: false, locale: 'en',
    onboard_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  },
  bob: {
    lat: 35.22712, lng: -80.84313, county: 'Mecklenburg County', state: 'NC', zip: '28202', pwsid: 'NC9990002',
    water_source: 'utility', home_year: 1962, renter_mode: true, locale: 'es',
    onboard_request_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  },
};

const BANDS = {
  alice: { has_pregnant: true, has_senior: true },
  bob: { has_toddler: true, has_respiratory: true },
};

const PREFS = {
  alice: { weather_advisory: false },
  bob: { air_quality_change: false, new_water_results: false, radon_season: false },
};

const UTILITY = {
  alice: { pwsid: 'NC9990001', pws_name: 'ALICE WATER SYSTEM MARKER', ppt: 2.1, date: '3/15/2024' },
  bob: { pwsid: 'NC9990002', pws_name: 'BOB WATER SYSTEM MARKER', ppt: 7.7, date: '6/1/2024' },
};

/** Free-text values that only one household has, plus the numbers and ids that locate it. */
export function markersOf(who, identity) {
  const upper = who.toUpperCase();
  const p = PROFILE[who];
  return [
    identity.id, p.county, p.zip, p.pwsid, p.onboard_request_id, String(p.lat), String(p.lng),
    `${upper}-NOTE-MARKER`, `${upper}-COUGH-MARKER`, `${upper}-WHEEZE-MARKER`,
    `${upper}-ALERT-TITLE`, `${upper}-ALERT-MESSAGE`, `${upper}-DISMISSED-MARKER`,
    UTILITY[who].pws_name, ENDPOINT[who], `${upper}-P256DH-MARKER`, `${upper}-AUTH-MARKER`,
    `${upper}-HOME-RISK-MARKER`, `${upper}-POLLUTANT-MARKER`, entryId(who, 1), alertId(who, 1),
  ];
}

/**
 * @param {object} identities from the harness ({ alice, bob })
 * @param {object} [options]
 * @param {boolean} [options.readingToday] give each household today's cached reading (default true)
 * @param {Date} [options.now]
 * @param {(rows: object, identities: object) => void} [options.adjust] edits the rows (table name -> array) before they are seeded
 */
export function seedHouseholds(identities, { readingToday = true, now = new Date(), adjust } = {}) {
  const today = localDate(now);
  const day = (n) => addDays(today, -n);
  const rows = { profiles: [], household_bands: [], notification_prefs: [], symptom_logs: [], alerts: [], push_subscriptions: [], daily_scores: [], home_risks: [], ucmr5_utilities: [], volunteer_orgs: [], map_layers: [] };

  for (const who of ['alice', 'bob']) {
    const id = identities[who].id;
    const upper = who.toUpperCase();
    const isAlice = who === 'alice';

    rows.profiles.push({ id, ...PROFILE[who] });
    rows.household_bands.push({ profile_id: id, ...BANDS[who] });
    rows.notification_prefs.push({ profile_id: id, ...PREFS[who] });
    rows.home_risks.push({ profile_id: id, summary: `${upper}-HOME-RISK-MARKER` });
    rows.push_subscriptions.push({ profile_id: id, endpoint: ENDPOINT[who], p256dh: `${upper}-P256DH-MARKER`, auth: `${upper}-AUTH-MARKER` });
    rows.ucmr5_utilities.push({
      pwsid: UTILITY[who].pwsid,
      pws_name: UTILITY[who].pws_name,
      status: 'Final',
      contaminants: { PFOA: [{ date: UTILITY[who].date, value_ppt: UTILITY[who].ppt }] },
      created_at: '2026-01-15T00:00:00Z',
    });
    rows.volunteer_orgs.push({
      name: `${PROFILE[who].county} Water Watch`,
      counties: [PROFILE[who].county],
      causes: ['water'],
      url: `https://orgs.example.test/${who}`,
    });

    // Journal: alice logs a little, bob logs a lot (enough for findings to be "ready").
    const recent = isAlice ? 2 : 8;
    for (let n = 1; n <= recent; n += 1) {
      rows.symptom_logs.push({
        id: entryId(who, n), profile_id: id, entry_date: day(n), band: 'household',
        symptoms: [`${upper}-COUGH-MARKER`, `${upper}-WHEEZE-MARKER`], severity: 'mild',
        note: `${upper}-NOTE-MARKER ${n}`,
      });
    }
    const springLogged = isAlice ? 2 : 6;
    for (let n = 1; n <= springLogged; n += 1) {
      rows.symptom_logs.push({
        id: entryId(who, 100 + n), profile_id: id, entry_date: `2025-04-${String(n * 3).padStart(2, '0')}`, band: 'household',
        symptoms: [`${upper}-COUGH-MARKER`], severity: 'moderate', note: `${upper}-NOTE-MARKER spring ${n}`,
      });
    }

    // Daily readings: alice has 4 days, bob 20 (plus the spring days the summary reads).
    const days = isAlice ? 4 : 20;
    for (let n = 1; n <= days; n += 1) {
      rows.daily_scores.push({
        profile_id: id, date: day(n), score: isAlice ? 80 - n : 20 + n, aqi: isAlice ? 40 + n : 160 + n,
        uv_index: isAlice ? 2 : 9, pollen_level: JSON.stringify(isAlice ? { tree: 1, grass: 1, weed: 0 } : { tree: 4, grass: 4, weed: 3 }),
        mold_risk: isAlice ? 'low' : 'high', aqi_source: isAlice ? 'airnow' : 'open-meteo', created_at: `${day(n)}T12:00:00Z`,
      });
    }
    for (let n = 1; n <= springLogged; n += 1) {
      rows.daily_scores.push({
        profile_id: id, date: `2025-04-${String(n * 3).padStart(2, '0')}`, score: 50, aqi: isAlice ? 30 : 190,
        uv_index: 5, pollen_level: JSON.stringify(isAlice ? { tree: 1 } : { tree: 5, grass: 4 }),
        mold_risk: isAlice ? 'low' : 'high', aqi_source: 'airnow', created_at: `2025-04-${String(n * 3).padStart(2, '0')}T12:00:00Z`,
      });
    }
    if (readingToday) {
      // Within the route's one-hour cache window; bob's is five minutes newer than alice's.
      const stamp = new Date(now.getTime() - (isAlice ? 10 : 5) * 60 * 1000).toISOString();
      rows.daily_scores.push({
        profile_id: id, date: today, score: isAlice ? 77 : 23, aqi: isAlice ? 47 : 163,
        uv_index: isAlice ? 4 : 9, pollen_level: JSON.stringify(isAlice ? { tree: 1, grass: 2, weed: 0 } : { tree: 4, grass: 5, weed: 3 }),
        mold_risk: isAlice ? 'low' : 'high', aqi_source: isAlice ? 'airnow' : 'open-meteo', created_at: stamp,
        details: { dominant_pollutant: `${upper}-POLLUTANT-MARKER`, uv_peak_window: null, mold_basis: null },
      });
    }

    // Alerts: one unread, one read, one dismissed (dismissed ones must not be listed).
    rows.alerts.push(
      { id: alertId(who, 1), profile_id: id, type: 'air_quality_change', severity: 'elevated', title: `${upper}-ALERT-TITLE one`, message: `${upper}-ALERT-MESSAGE one`, dedupe_key: `${who}-one`, fired_at: `${day(1)}T10:00:00Z` },
      { id: alertId(who, 2), profile_id: id, type: 'weather_advisory', title: `${upper}-ALERT-TITLE two`, message: `${upper}-ALERT-MESSAGE two`, dedupe_key: `${who}-two`, read: true, fired_at: `${day(2)}T10:00:00Z` },
      { id: alertId(who, 3), profile_id: id, type: 'radon_season', title: `${upper}-DISMISSED-MARKER`, message: `${upper}-DISMISSED-MARKER`, dedupe_key: `${who}-three`, dismissed: true, fired_at: `${day(3)}T10:00:00Z` },
    );
  }

  // The pre-built NC-08 view the district route serves; the statewide ranking stays server side.
  rows.map_layers.push({
    layer: 'district',
    assembled_at: now.toISOString(),
    payload: {
      layer: 'district',
      ranked_counties: 100,
      county_rankings: [
        { county: PROFILE.alice.county, water_rank: 12, share_over: 0.2 },
        { county: PROFILE.bob.county, water_rank: 41, share_over: 0.5 },
      ],
      assembled_at: now.toISOString(),
    },
  });
  rows.map_layers.push({ layer: 'water', assembled_at: now.toISOString(), payload: { layer: 'water', count: 0, features: [], assembled_at: now.toISOString() } });

  adjust?.(rows, identities);
  return rows;
}

export { PROFILE, BANDS, PREFS, UTILITY };
