/** Editable review fixtures, not observations or production API defaults. */
export type DistrictPreviewVariant =
  | "full"
  | "population-missing"
  | "population-partial"
  | "zero"
  | "error"
  | "geography-error"
  | "comparison-missing";

export type DistrictWaterSeverity = "good" | "moderate" | "elevated" | "high" | "severe" | "no_data";
export type DistrictCompound = "PFOA" | "PFOS" | "PFHxS" | "PFNA" | "HFPO-DA";

export type DistrictCounty = {
  county: string;
  in_district: "whole" | "partial";
  systems: number;
  systems_over_limit: number;
  worst_water_severity: DistrictWaterSeverity;
  radon_zone: number | null;
};

export type DistrictPreviewData = {
  scope: "NC-08";
  total_systems: number;
  systems_tested_any: number;
  systems_over_limit: number;
  affected_population: number | null;
  affected_population_complete: boolean;
  over_limit_population_unknown: number;
  by_contaminant: Record<DistrictCompound, {
    tested: number;
    over: number;
    limit: number;
    // Display context from the existing water response, not a new /api/district field.
    proposed_for_rescission: boolean;
    population_over: number | null;
    over_population_unknown: number;
  }>;
  counties: DistrictCounty[];
  // Both shares count only systems with a numeric regulated result. The statewide counts are optional so an
  // older response without them still renders; the district counts are the top-level fields above.
  state_comparison: { district_share_over: number | null; state_share_over: number | null; state_systems_over_limit?: number | null; state_systems_with_numeric_result?: number | null; state_total_systems?: number | null };
  unlocated_systems: number;
  assembled_at: string;
};

export const districtFixture: DistrictPreviewData = {
  scope: "NC-08",
  // Matches latest map-preview.ts sample coordinates within the existing NC-08 polygon:
  // SAMPLE-01 through SAMPLE-07, plus SAMPLE-13. County names alone are insufficient.
  total_systems: 8,
  systems_tested_any: 6,
  systems_over_limit: 2,
  affected_population: 66600,
  affected_population_complete: true,
  over_limit_population_unknown: 0,
  by_contaminant: {
    PFOA: { tested: 5, over: 2, limit: 4, proposed_for_rescission: false, population_over: 66600, over_population_unknown: 0 },
    PFOS: { tested: 6, over: 2, limit: 4, proposed_for_rescission: false, population_over: 66600, over_population_unknown: 0 },
    PFHxS: { tested: 2, over: 1, limit: 10, proposed_for_rescission: true, population_over: 24000, over_population_unknown: 0 },
    PFNA: { tested: 0, over: 0, limit: 10, proposed_for_rescission: true, population_over: null, over_population_unknown: 0 },
    "HFPO-DA": { tested: 0, over: 0, limit: 10, proposed_for_rescission: true, population_over: null, over_population_unknown: 0 },
  },
  counties: [
    { county: "Anson County", in_district: "whole", systems: 1, systems_over_limit: 0, worst_water_severity: "good", radon_zone: 3 },
    { county: "Montgomery County", in_district: "whole", systems: 1, systems_over_limit: 0, worst_water_severity: "good", radon_zone: 3 },
    { county: "Richmond County", in_district: "whole", systems: 1, systems_over_limit: 0, worst_water_severity: "no_data", radon_zone: 3 },
    { county: "Scotland County", in_district: "whole", systems: 1, systems_over_limit: 0, worst_water_severity: "moderate", radon_zone: 3 },
    { county: "Stanly County", in_district: "whole", systems: 2, systems_over_limit: 1, worst_water_severity: "severe", radon_zone: 3 },
    { county: "Union County", in_district: "whole", systems: 2, systems_over_limit: 1, worst_water_severity: "high", radon_zone: 3 },
    { county: "Cabarrus County", in_district: "partial", systems: 0, systems_over_limit: 0, worst_water_severity: "no_data", radon_zone: 3 },
    { county: "Mecklenburg County", in_district: "partial", systems: 0, systems_over_limit: 0, worst_water_severity: "no_data", radon_zone: 3 },
    { county: "Robeson County", in_district: "partial", systems: 0, systems_over_limit: 0, worst_water_severity: "no_data", radon_zone: 3 },
  ],
  state_comparison: { district_share_over: 0.333, state_share_over: 0.5, state_systems_over_limit: 6, state_systems_with_numeric_result: 12, state_total_systems: 15 },
  unlocated_systems: 2,
  assembled_at: "2026-10-01T11:00:00.000Z",
};

/** These names belong to fictional statewide water fixtures, not district members. */
export const unlocatedDistrictPreviewSystems = [
  "Unmapped Community Water (SAMPLE-14)",
  "Unmapped Springs (SAMPLE-15)",
];

/** Corresponds to the existing water layer's statewide count and located fields. */
export const districtWaterCoverageFixture = { count: 15, located: 13 };

export function districtPreviewData(variant: DistrictPreviewVariant): DistrictPreviewData {
  const data = structuredClone(districtFixture);
  if (variant === "population-missing") {
    data.affected_population = null;
    data.affected_population_complete = false;
    data.over_limit_population_unknown = data.systems_over_limit;
    for (const compound of Object.values(data.by_contaminant)) {
      compound.population_over = compound.over === 0 && compound.tested > 0 ? 0 : null;
      compound.over_population_unknown = compound.over;
    }
  }
  if (variant === "population-partial") {
    // The Meadow Water population is missing in this review scenario.
    data.affected_population = 24000;
    data.affected_population_complete = false;
    data.over_limit_population_unknown = 1;
    data.by_contaminant.PFOA.population_over = 24000;
    data.by_contaminant.PFOA.over_population_unknown = 1;
    data.by_contaminant.PFOS.population_over = 24000;
    data.by_contaminant.PFOS.over_population_unknown = 1;
  }
  if (variant === "zero") {
    data.affected_population = 0;
    data.systems_over_limit = 0;
    data.state_comparison.district_share_over = 0;
    for (const compound of Object.values(data.by_contaminant)) {
      compound.over = 0;
      compound.population_over = compound.tested > 0 ? 0 : null;
    }
    for (const county of data.counties) {
      county.systems_over_limit = 0;
      county.worst_water_severity = county.worst_water_severity === "no_data" ? "no_data" : "good";
    }
  }
  if (variant === "comparison-missing") data.state_comparison.state_share_over = null;
  if (variant === "geography-error") {
    data.total_systems = 0;
    data.unlocated_systems = 14;
  }
  return data;
}

export function districtGeographyUnavailable(
  districtSystems: number,
  waterCoverage: { count: number; located: number },
) {
  // unlocated_systems is statewide, so never divide it by district total_systems.
  return districtSystems === 0 || (
    waterCoverage.count > 0 &&
    (waterCoverage.count - waterCoverage.located) / waterCoverage.count >= 0.9
  );
}
