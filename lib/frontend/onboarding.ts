import { copy } from "./copy";
import { householdKeys } from "./types";
import type { DataResult, DailyResponse, HomeResponse, Household, LocationProfile, OnboardResponse, ProfileResponse, RevealRow, Severity, WaterSource } from "./types";

export function emptyHousehold(): Household {
  return Object.fromEntries(householdKeys.map((key) => [key, false])) as Household;
}
export function normalizeHousehold(value?: Partial<Household> | null): Household {
  return Object.fromEntries(householdKeys.map((key) => [key, value?.[key] === true])) as Household;
}
export function validateAddress(value: string): string {
  return value.trim().length >= 5 ? "" : copy.address.required;
}
export function validateHomeYear(value: string, currentYear = new Date().getFullYear()): string {
  const input = value.trim();
  if (!input) return "";
  if (!/^\d{4}$/.test(input) || Number(input) < 1700) return copy.home.invalidYear;
  return Number(input) > currentYear ? copy.home.futureYear : "";
}
export function parseHomeYear(value: string): number | null {
  return value.trim() === "" ? null : Number(value.trim());
}
export function normalizeWaterAnswer(value: string): WaterSource | null {
  if (["utility", "well", "spring", "other"].includes(value)) return value as WaterSource;
  if (value === "not_sure") return "other";
  return null;
}
export function hasLocation(profile?: LocationProfile | null): boolean {
  return typeof profile?.lat === "number" && Number.isFinite(profile.lat) && Math.abs(profile.lat) <= 90 &&
    typeof profile.lng === "number" && Number.isFinite(profile.lng) && Math.abs(profile.lng) <= 180;
}
export function isProfileComplete(response?: ProfileResponse | null): boolean {
  return response?.onboarding_complete === true && hasLocation(response.profile) &&
    ["utility", "well", "spring", "other"].includes(response.profile?.water_source ?? "");
}
/** All source-provided strings pass here before rendering; never render a raw error. */
export function displayText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s*\u2014\s*/g, ", ").trim() : "";
}
export function contaminantLabel(value: unknown): string {
  const name = displayText(value);
  return name === "HFPO-DA" ? "GenX (HFPO-DA)" : name;
}
export function normalizeSeverity(value: unknown): Severity {
  return typeof value === "string" && Object.hasOwn(copy.severity, value) ? value as Severity : "no_data";
}
export function isOutsideNC(location?: LocationProfile | null): boolean {
  return typeof location?.state === "string" && /^[A-Z]{2}$/i.test(location.state) && location.state.toUpperCase() !== "NC";
}

export interface PlaceReview { label: string; notes: string[] }

/**
 * What the household step shows of the place the address step found, so a wrong match can be
 * changed before anything else is answered. The label is area level (never the street line);
 * a timeout-recovered profile without one falls back to its county and state. The water note
 * keeps a service-area match a suggestion: several systems, none, or a likely one.
 */
export function placeReview(location?: OnboardResponse | null): PlaceReview | null {
  if (!location) return null;
  const label = displayText(location.place_label) || [displayText(location.county), displayText(location.state)].filter(Boolean).join(", ");
  if (!label) return null;
  const notes: string[] = [];
  if (location.place_ambiguous === true) notes.push(copy.household.place.ambiguous);
  if (location.place_precision === "area") notes.push(copy.household.place.area);
  const candidates = Array.isArray(location.utility_candidates) ? location.utility_candidates.filter((id) => typeof id === "string" && id) : [];
  // A home already on a well or spring (changing the address from Settings) gets no supplier note.
  const ownSupply = ["well", "spring"].includes(normalizeWaterAnswer(location.water_source ?? "") ?? "");
  if (ownSupply) return { label, notes };
  if (location.service_area_status === "outside_known_area") notes.push(copy.household.place.noUtility);
  else if (location.service_area_status === "measured") notes.push(candidates.length > 1 ? copy.household.place.severalUtilities : copy.household.place.likelyUtility);
  return { label, notes };
}

/** Bind server facts only. This module never computes environmental severity or limits. */
export function getRevealRows(location: LocationProfile | null, homeResult: DataResult<HomeResponse>, dailyResult: DataResult<DailyResponse>): RevealRow[] {
  const pendingHome = homeResult.status === "loading";
  const pendingDaily = dailyResult.status === "loading";
  const rows: RevealRow[] = [
    { key: "utility", label: copy.reveal.utility, result: copy.reveal.unavailable, pending: pendingHome, missing: true },
    { key: "water", label: copy.reveal.water, result: copy.reveal.unavailable, pending: pendingHome, missing: true },
    { key: "radon", label: copy.reveal.radon(displayText(location?.county)), result: copy.reveal.unavailable, pending: pendingHome, missing: true },
    { key: "air", label: copy.reveal.air, result: copy.reveal.unavailable, pending: pendingDaily, missing: true },
  ];
  const [utility, waterRow, radonRow, airRow] = rows;
  if (homeResult.status === "success") {
    const water = homeResult.data?.water;
    const radon = homeResult.data?.radon;
    if (water) {
      const source = water.source_type ?? location?.water_source;
      if (water.status === "private_well" || source === "well" || source === "spring") {
        utility.result = source === "spring" ? copy.reveal.spring : copy.reveal.privateWell;
        waterRow.result = source === "spring" ? copy.reveal.springTesting : copy.reveal.wellTesting;
      } else if (water.status === "no_pwsid_available") {
        // A boundary lookup failure is not evidence that there is no utility.
        if ((location as LocationProfile & { service_area_status?: string })?.service_area_status !== "lookup_failed") {
          utility.result = copy.reveal.noUtility;
          waterRow.result = copy.reveal.noUtilityToCheck;
        }
      } else {
        const name = displayText(water.pws_name);
        const id = displayText(location?.pwsid);
        // A service-area match is a suggestion for the area, never a confirmed supplier.
        if (name) { utility.result = copy.reveal.likelyUtility(name); utility.missing = false; }
        else if (id) { utility.result = copy.reveal.foundSystem(id); utility.missing = false; }
        if (water.status === "no_data_yet") waterRow.result = isOutsideNC(location) ? copy.reveal.outsideWater : copy.reveal.noResults;
        else if (water.status === "detected_unregulated") waterRow.result = copy.reveal.unregulated;
        else if (water.status !== "lookup_failed" && water.is_measured === true) {
          const entries = Array.isArray(water.scored_contaminants) ? water.scored_contaminants.filter((entry) => entry !== null) : [];
          // Enforceability is an explicit backend flag. Non-binding guidance cannot
          // support an assertion about federal limits, even if exceeds_limit is true.
          const exceeded = entries.filter((entry) => entry.exceeds_limit === true && entry.is_enforceable === true && displayText(entry.contaminant));
          const worst = exceeded.reduce<(typeof exceeded)[number] | undefined>((chosen, entry) => {
            if (!chosen) return entry;
            return typeof entry.risk === "number" && Number.isFinite(entry.risk) &&
              (typeof chosen.risk !== "number" || entry.risk > chosen.risk) ? entry : chosen;
          }, undefined);
          const explicitBelow = entries.length === water.scored_contaminants?.length &&
            entries.some((entry) => entry.is_enforceable === true && entry.exceeds_limit === false) &&
            entries.every((entry) => typeof entry.is_enforceable === "boolean" && (entry.is_enforceable === false || entry.exceeds_limit === false));
          if (worst) { waterRow.result = copy.reveal.aboveLimit(contaminantLabel(worst.contaminant)); waterRow.missing = false; }
          else if (water.coverage === "unscoreable" || water.coverage === "excluded_only") waterRow.result = copy.reveal.unregulated;
          else if (water.coverage === "no_detections" || explicitBelow) {
            waterRow.result = copy.reveal.belowLimits;
            waterRow.missing = false;
          } else waterRow.result = copy.common.noData;
        }
      }
    }
    if (radon?.out_of_state === true) radonRow.result = copy.reveal.outsideRadon;
    else if (radon?.error || ![1, 2, 3].includes(radon?.zone as number)) radonRow.result = copy.reveal.radonUnavailable;
    else { radonRow.result = copy.reveal.zone(radon!.zone!); radonRow.missing = false; }
  }
  if (dailyResult.status === "success") {
    const severity = normalizeSeverity(dailyResult.data?.air?.severity);
    // A populated severity without a reading is not evidence of good air.
    const aqi = dailyResult.data?.air?.aqi;
    airRow.severity = typeof aqi === "number" && Number.isFinite(aqi) ? severity : "no_data";
    airRow.result = copy.severity[airRow.severity];
    airRow.missing = airRow.severity === "no_data";
  }
  return rows;
}
