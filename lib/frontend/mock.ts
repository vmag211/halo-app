import { FrontendError } from "./api";
import { emptyHousehold, normalizeHousehold, normalizeWaterAnswer } from "./onboarding";
import type { DailyResponse, ErrorCode, HomeResponse, OnboardingApi, ProfileResponse } from "./types";

/** Deliberately opt-in. This module performs no fetch, authentication or persistence. */
export const mockScenarios = [
  "default", "below", "well", "spring", "no-utility", "no-results", "unregulated", "lookup-failed", "boundary-failed",
  "radon-missing", "outside", "air-missing", "air-error", "home-error", "all-error", "null-fields", "unknown-severity",
  "captcha", "signin", "session-timeout", "profile-error", "address-not-found", "rate-limited", "address-error", "timeout", "household-error", "home-save-error", "loading", "returning", "incomplete",
] as const;
export type MockScenario = (typeof mockScenarios)[number];
export function isMockScenario(value: unknown): value is MockScenario { return typeof value === "string" && (mockScenarios as readonly string[]).includes(value); }
export interface MockApiOptions { delayMs?: number; failOnce?: boolean }

export function createMockOnboardingApi(scenario: MockScenario = "default", options: MockApiOptions = {}): OnboardingApi {
  const delayMs = options.delayMs ?? (scenario === "loading" ? 2500 : 450);
  const failed = new Set<string>();
  let profile: ProfileResponse = {
    onboarded: scenario === "returning" || scenario === "incomplete",
    onboarding_complete: scenario === "returning",
    profile: scenario === "returning" || scenario === "incomplete" ? {
      county: "Cabarrus County", state: "NC", lat: 35.409, lng: -80.579, pwsid: "NC0112010",
      water_source: scenario === "returning" ? "utility" : null, home_year: null,
    } : null,
    household: emptyHousehold(), household_set: false,
  };
  async function pause(signal?: AbortSignal) {
    if (signal?.aborted) throw new FrontendError("aborted");
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new FrontendError("aborted")); };
      const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, delayMs);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
  function fail(key: string, code: ErrorCode) {
    if (options.failOnce !== false && failed.has(key)) return;
    failed.add(key);
    throw new FrontendError(code);
  }
  function homeData(): HomeResponse {
    if (scenario === "null-fields") return { water: null, radon: null, score: null };
    const waterSource = scenario === "well" || scenario === "spring" ? scenario : profile.profile?.water_source;
    const home: HomeResponse = {
      success: true,
      radon: { county: profile.profile?.county, zone: 3, severity: "good" },
      water: {
        pws_name: "Concord, City of", status: "detects", is_measured: true, coverage: "complete",
        scored_contaminants: [{ contaminant: "PFOS", risk: scenario === "below" ? 0 : 80, exceeds_limit: scenario !== "below", is_enforceable: true, value_ppt: scenario === "below" ? 1 : 6, limit_ppt: 4 }],
      },
    };
    if (waterSource === "well" || waterSource === "spring") home.water = { status: "private_well", source_type: waterSource, is_measured: false, test_plan: [] };
    else if (["no-utility", "boundary-failed"].includes(scenario)) home.water = { status: "no_pwsid_available" };
    else if (scenario === "no-results" || scenario === "outside") home.water = { status: "no_data_yet" };
    else if (scenario === "lookup-failed") home.water = { status: "lookup_failed", is_measured: false };
    else if (scenario === "unregulated") home.water = { status: "detected_unregulated", pws_name: "Concord, City of", is_measured: true, coverage: "unscoreable", detected_unregulated: ["PFPeA"] };
    if (scenario === "radon-missing") home.radon = { error: "not_found" };
    if (scenario === "outside") home.radon = { error: "outside_coverage", out_of_state: true };
    return home;
  }
  return {
    async ensureSession() {
      await pause();
      if (scenario === "captcha") fail("session", "captcha_failed");
      if (scenario === "signin") fail("session", "signin_failed");
      if (scenario === "session-timeout") fail("session", "timeout");
    },
    async getIdentity() { return "halo-preview"; },
    async getProfile(signal) {
      await pause(signal);
      if (scenario === "profile-error") fail("profile", "generic");
      return structuredClone(profile);
    },
    async submitAddress(_address, signal) {
      await pause(signal);
      if (scenario === "address-not-found") fail("address", "address_not_found");
      if (scenario === "rate-limited") fail("address", "rate_limited");
      if (scenario === "address-error") fail("address", "generic");
      if (scenario === "timeout") fail("address", "timeout");
      const location = {
        county: scenario === "outside" ? "Union County" : "Cabarrus County", state: scenario === "outside" ? "SC" : "NC",
        pwsid: ["no-utility", "boundary-failed", "outside"].includes(scenario) ? null : "NC0112010", lat: 35.409, lng: -80.579,
        service_area_status: scenario === "boundary-failed" ? "lookup_failed" as const : ["no-utility", "outside"].includes(scenario) ? "outside_known_area" as const : "measured" as const,
      };
      profile = { ...profile, onboarded: true, onboarding_complete: false, profile: { ...profile.profile, ...location } };
      return location;
    },
    async saveHousehold(household, signal) {
      await pause(signal);
      if (scenario === "household-error") fail("household", "generic");
      profile = { ...profile, household: normalizeHousehold(household), household_set: true };
      return { household: structuredClone(profile.household), household_set: true };
    },
    async saveHome(home, signal) {
      await pause(signal);
      if (scenario === "home-save-error") fail("home-save", "generic");
      if (!profile.onboarded) throw new FrontendError("no_location");
      profile = { ...profile, onboarding_complete: true, profile: { ...profile.profile, water_source: normalizeWaterAnswer(home.water_source), home_year: home.home_year } };
      return structuredClone(profile);
    },
    async getDaily(signal): Promise<DailyResponse> {
      await pause(signal);
      if (scenario === "air-error" || scenario === "all-error") fail("daily", "generic");
      if (scenario === "null-fields") return { air: null, score: null, retrieved_at: null };
      return { air: { aqi: scenario === "air-missing" ? null : 32, severity: scenario === "air-missing" ? "no_data" : scenario === "unknown-severity" ? "unexpected" : "good", is_measured: true, source: "airnow" }, retrieved_at: "2026-09-28T12:00:00.000Z", cached: false };
    },
    async getHome(signal) {
      await pause(signal);
      if (scenario === "home-error" || scenario === "all-error") fail("home", "generic");
      return homeData();
    },
  };
}
