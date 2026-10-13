import type { DistrictPreviewData } from './map-district-preview';
import { mapComparisonCopy as c } from './copy/map-comparison';

/** Explicit public allowlist, independent of profiles, viewports, drafts and private records. */
export function publicDistrictExport(data: DistrictPreviewData) {
  return {
    review_only: true,
    description: c.briefReview,
    district: data.scope,
    assembled_at: data.assembled_at,
    boundary: { source: 'U.S. Census TIGERweb', vintage: '119th Congress, 2023 district map', retrieved: '2026-09-27',
      basis: c.boundaryBasis },
    totals: { mapped_systems: data.total_systems, systems_with_numeric_regulated_results: data.systems_tested_any,
      systems_over_supplied_limit: data.systems_over_limit, population_served_by_over_limit_systems: data.affected_population,
      population_complete: data.affected_population_complete, population_unknown_systems: data.over_limit_population_unknown,
      statewide_unlocated_systems: data.unlocated_systems },
    compounds: Object.fromEntries(Object.entries(data.by_contaminant).map(([name, value]) => [name, {
      systems_with_numeric_result: value.tested, systems_over_supplied_limit: value.over, supplied_limit_ppt: value.limit,
      population_served_by_over_limit_systems: value.population_over, population_unknown_systems: value.over_population_unknown,
    }])),
    counties: data.counties.map(value => ({ county: value.county, membership: value.in_district,
      mapped_systems: value.systems, systems_over_supplied_limit: value.systems_over_limit })),
    limitations: c.briefLimits,
  };
}
export function publicDistrictBrief(data: DistrictPreviewData) {
  const source = publicDistrictExport(data);
  return [
    source.description,
    c.briefTitle(source.district),
    c.briefCounts(data.systems_over_limit,data.systems_tested_any),
    c.briefLocations(data.total_systems,data.unlocated_systems),
    data.affected_population === null ? c.briefPopulationMissing : c.briefPopulation(data.affected_population.toLocaleString('en-US'),data.affected_population_complete),
    c.briefAssembled(data.assembled_at),
    c.briefBoundary(source.boundary.source,source.boundary.vintage,source.boundary.retrieved),
    ...source.limitations,
    c.briefSources,
  ].join('\n\n');
}
