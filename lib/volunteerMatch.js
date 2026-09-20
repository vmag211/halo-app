/**
 * Volunteer organization matching (§15.3).
 *
 * Filters the directory to organizations that (a) serve this household's county
 * (or are statewide) and (b) work on at least one cause the household actually
 * has a finding for. Matching by findings is what separates this from a generic
 * directory. Orgs are ranked by how many of the household's causes they cover.
 *
 * Pure module.
 */

function servesCounty(org, county) {
  if (!county) return true;
  const counties = Array.isArray(org.counties) ? org.counties : [];
  if (counties.includes("statewide")) return true;
  const c = String(county).toLowerCase();
  return counties.some((x) => String(x).toLowerCase() === c);
}

/**
 * @param {Array<{name:string, counties:string[], causes:string[]}>} orgs
 * @param {object} opts
 * @param {string} [opts.county]
 * @param {string[]} [opts.causes]  the household's flagged cause tags (e.g. ['water','pfas'])
 * @returns {Array} matched orgs, best-matched first, each with a `match_count`
 */
export function matchOrgs(orgs = [], { county = null, causes = [] } = {}) {
  const want = new Set((causes || []).map((c) => String(c).toLowerCase()));

  const scored = [];
  for (const org of orgs) {
    if (!servesCounty(org, county)) continue;
    const orgCauses = (Array.isArray(org.causes) ? org.causes : []).map((c) => String(c).toLowerCase());
    const overlap = orgCauses.filter((c) => want.has(c));
    // If the household has flagged causes, require at least one overlap. If it
    // has none (nothing elevated), fall back to showing all county-serving orgs.
    if (want.size > 0 && overlap.length === 0) continue;
    scored.push({ ...org, match_count: overlap.length });
  }

  // Most cause matches first; statewide-only orgs sink slightly below local ones.
  scored.sort((a, b) => {
    if (b.match_count !== a.match_count) return b.match_count - a.match_count;
    const aLocal = (a.counties || []).some((x) => x !== "statewide");
    const bLocal = (b.counties || []).some((x) => x !== "statewide");
    return (bLocal ? 1 : 0) - (aLocal ? 1 : 0);
  });

  return scored;
}
