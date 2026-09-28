/** Frontend contracts. Missing fields remain missing; no display defaults imply safety. */
export const householdKeys = ["has_toddler", "has_child", "has_teen", "has_adult", "has_senior", "has_pregnant", "has_respiratory"] as const;
export type HouseholdKey = (typeof householdKeys)[number];
export type Household = Record<HouseholdKey, boolean>;
export type WaterSource = "utility" | "well" | "spring" | "other";
export type Severity = "good" | "moderate" | "elevated" | "high" | "severe" | "no_data";
export type ErrorCode = "generic" | "timeout" | "offline" | "rate_limited" | "address_required" | "address_not_found" | "captcha_failed" | "signin_failed" | "session_changed" | "no_location" | "no_county" | "aborted" | "invalid_response" | "configuration";
export interface LocationProfile {
  county?: string | null; state?: string | null; pwsid?: string | null;
  lat?: number | null; lng?: number | null;
  water_source?: string | null; home_year?: number | null;
  renter_mode?: boolean; locale?: string | null;
}
export interface ProfileResponse {
  onboarded?: boolean; onboarding_complete?: boolean;
  profile?: LocationProfile | null;
  household?: Partial<Household> | null; household_set?: boolean;
}
export interface OnboardResponse extends LocationProfile {
  service_area_status?: "measured" | "outside_known_area" | "lookup_failed" | null;
  /** True only when a previously location-free profile gained coordinates after timeout. */
  recovered_after_timeout?: boolean;
}
export interface ScoredContaminant {
  contaminant?: string | null; exceeds_limit?: boolean; is_enforceable?: boolean;
  risk?: number | null; value_ppt?: number | null; limit_ppt?: number | null;
}
export interface HomeResponse {
  success?: boolean;
  water?: {
    status?: string | null; source_type?: string | null; pws_name?: string | null;
    is_measured?: boolean; coverage?: string | null;
    scored_contaminants?: (ScoredContaminant | null)[] | null;
    detected_unregulated?: string[] | null;
    test_plan?: unknown; [key: string]: unknown;
  } | null;
  radon?: { zone?: number | null; county?: string | null; severity?: string | null; error?: string | null; out_of_state?: boolean; [key: string]: unknown } | null;
  score?: { display_score?: number | null; severity?: string | null; [key: string]: unknown } | null;
  lead?: unknown; action_plan?: unknown[]; breakdown?: unknown[];
  retrieved_at?: string | null; assembled_at?: string | null;
}
export interface DailyResponse {
  air?: { aqi?: number | null; severity?: string | null; sentence?: string | null; source?: string | null; is_measured?: boolean | null; [key: string]: unknown } | null;
  uv?: unknown; pollen?: unknown; mold?: unknown; score?: unknown;
  retrieved_at?: string | null; cached?: boolean;
}
export interface OnboardingApi {
  ensureSession(): Promise<void>;
  getProfile(signal?: AbortSignal): Promise<ProfileResponse>;
  submitAddress(address: string, signal?: AbortSignal): Promise<OnboardResponse>;
  saveHousehold(household: Household, signal?: AbortSignal): Promise<unknown>;
  saveHome(home: { water_source: string; home_year: number | null }, signal?: AbortSignal): Promise<ProfileResponse>;
  /** Initial onboarding is parameterless; a replaced address bypasses the old server cache. */
  getDaily(signal?: AbortSignal, options?: { fresh?: boolean }): Promise<DailyResponse>;
  getHome(signal?: AbortSignal): Promise<HomeResponse>;
  /** Browser-local cache namespace only. It is never sent to a data route. */
  getIdentity?(): Promise<string | null>;
}
export type DataResult<T> =
  | { status: "loading"; data?: T | null; error?: ErrorCode | null }
  | { status: "success"; data: T; error?: null }
  | { status: "error"; data?: T | null; error: ErrorCode }
  | { status: "empty"; data?: null; error?: null };
export interface RevealRow {
  key: "utility" | "water" | "radon" | "air";
  label: string; result: string; pending: boolean; missing: boolean;
  severity?: Severity;
}
