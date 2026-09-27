/**
 * The NC-08 district view (§20, §13.8; punch list v3 item 19). Pure.
 *
 * Every water system with a mapped service area is placed by its centroid:
 * which North Carolina county it's in, and whether it's inside NC-08 (the
 * district splits Cabarrus, Mecklenburg and Robeson, so county names can't
 * decide membership). The district figures use only systems inside NC-08; the
 * county rankings use every NC system, so a household's county can be compared
 * with all 100.
 *
 * Built entirely from public data. No household data enters it; the
 * household's own county rank is looked up per request.
 */
import { computeDistrict, exceedanceLine, REGULATED } from './district.js';
import { countyForPoint, inNc08, BOUNDARY_SOURCES, NC_COUNTY_COUNT } from './geoContainment.js';
import { waterDetailSeverity, worseSeverity, radonZoneSeverity } from './severity.js';
import { getWaterRisk } from './scoring.js';

// Counties wholly / partly inside NC-08 (119th Congress, 2023 map).
export const NC08_WHOLE = ['Anson County', 'Montgomery County', 'Richmond County', 'Scotland County', 'Stanly County', 'Union County'];
export const NC08_PARTIAL = ['Cabarrus County', 'Mecklenburg County', 'Robeson County'];

/** Share (0–1) of systems tested for anything regulated that exceed some limit. */
function shareOver(d) {
  const tested = d.systems_tested_any;
  return tested ? Math.round((d.systems_over_limit / tested) * 1000) / 1000 : null;
}

function testedAny(utilities) {
  return utilities.filter((u) =>
    REGULATED.some((name) => {
      const r = u.contaminants?.[name] ?? (name === 'HFPO-DA' ? u.contaminants?.['HFPO-DA (GenX)'] : null);
      return Array.isArray(r) && r.some((x) => typeof x?.value_ppt === 'number');
    }),
  ).length;
}

/**
 * @param {{utilities:Array<{pwsid,contaminants}>, geo:Map<string,{lat,lng,population}>, radonZones:Object<string,number>}} p
 */
export function buildDistrictView({ utilities = [], geo = new Map(), radonZones = {} }) {
  // Place every system.
  const placed = utilities.map((u) => {
    const g = geo.get(u.pwsid);
    const located = g && typeof g.lat === 'number' && typeof g.lng === 'number';
    return {
      u,
      county: located ? countyForPoint(g.lat, g.lng) : null,
      inDistrict: located ? inNc08(g.lat, g.lng) : false,
      population: g?.population ?? null,
      located,
    };
  });

  const districtUtils = placed.filter((p) => p.inDistrict).map((p) => p.u);
  const district = computeDistrict(districtUtils, geo);
  district.systems_tested_any = testedAny(districtUtils);
  const state = computeDistrict(utilities, geo);
  state.systems_tested_any = testedAny(utilities);

  const exceedance_lines = {};
  for (const c of REGULATED) exceedance_lines[c] = exceedanceLine(district, c);

  // Per-county rows for the district panel (district systems only).
  const byCounty = new Map();
  for (const p of placed.filter((x) => x.inDistrict && x.county)) {
    const row = byCounty.get(p.county) || { county: p.county, systems: 0, systems_over_limit: 0, worst_water_severity: 'no_data' };
    const detail = getWaterRisk(p.u.contaminants);
    row.systems += 1;
    if (detail.scored.some((s) => s.is_enforceable && s.value_ppt > s.limit_ppt)) row.systems_over_limit += 1;
    row.worst_water_severity = worseSeverity(row.worst_water_severity, waterDetailSeverity(detail));
    byCounty.set(p.county, row);
  }
  const counties = [...NC08_WHOLE, ...NC08_PARTIAL].map((name) => {
    const row = byCounty.get(name) || { county: name, systems: 0, systems_over_limit: 0, worst_water_severity: 'no_data' };
    const zone = radonZones[name] ?? null;
    return {
      ...row,
      in_district: NC08_WHOLE.includes(name) ? 'whole' : 'partial',
      radon_zone: zone,
      radon_severity: zone ? radonZoneSeverity(zone) : 'no_data',
    };
  });

  // Statewide county ranking: share of population served (by located systems
  // with a population figure) that is on an over-limit system. Rank 1 = the
  // lowest share. Counties with no such systems are unranked, not "best".
  const stats = new Map();
  for (const p of placed.filter((x) => x.county && typeof x.population === 'number' && x.population > 0)) {
    const s = stats.get(p.county) || { served: 0, over: 0 };
    const detail = getWaterRisk(p.u.contaminants);
    s.served += p.population;
    if (detail.scored.some((x) => x.is_enforceable && x.value_ppt > x.limit_ppt)) s.over += p.population;
    stats.set(p.county, s);
  }
  const ranked = [...stats.entries()]
    .map(([county, s]) => ({ county, share_over: Math.round((s.over / s.served) * 1000) / 1000, population_served: s.served }))
    .sort((a, b) => a.share_over - b.share_over || a.county.localeCompare(b.county));
  let rank = 0;
  let prevShare = null;
  ranked.forEach((r, i) => {
    if (r.share_over !== prevShare) rank = i + 1; // ties share a rank
    r.water_rank = rank;
    prevShare = r.share_over;
  });

  return {
    scope: 'NC-08',
    ...district,
    exceedance_lines,
    counties,
    state_comparison: {
      district_share_over: shareOver(district),
      state_share_over: shareOver(state),
    },
    county_rankings: ranked,
    ranked_counties: ranked.length,
    nc_counties: NC_COUNTY_COUNT,
    ranking_rule:
      "Counties are ranked by the share of their population served by water systems whose most recent sample exceeds a federal limit; 1 is the lowest share. Counties with no mapped system and population figure are not ranked.",
    unlocated_systems: placed.filter((p) => !p.located).length,
    boundaries: BOUNDARY_SOURCES,
  };
}

/** The household's county in the statewide ranking, or null when it isn't ranked. */
export function householdCounty(view, county) {
  if (!county || !view?.county_rankings) return null;
  const r = view.county_rankings.find((x) => x.county === county);
  if (!r) return { county, water_rank: null, of: view.ranked_counties ?? null, share_over: null };
  return { county, water_rank: r.water_rank, of: view.ranked_counties, share_over: r.share_over };
}
