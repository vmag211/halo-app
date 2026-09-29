import { hasLocation, isProfileComplete, normalizeHousehold, normalizeWaterAnswer, validateAddress, validateHomeYear } from "./onboarding";
import { clearOnboardingStorage, getCacheIdentity, setCacheIdentity, storeReading } from "./storage";
import type { DailyResponse, ErrorCode, HomeResponse, OnboardResponse, OnboardingApi, ProfileResponse } from "./types";

export class FrontendError extends Error {
  readonly code: ErrorCode;
  readonly status?: number;
  constructor(code: ErrorCode, status?: number) { super(code); this.name = "FrontendError"; this.code = code; this.status = status; }
}
export function errorCode(error: unknown): ErrorCode {
  if (error instanceof FrontendError) return error.code;
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "captcha_failed" || code === "signin_failed") return code;
  if (error instanceof DOMException && error.name === "AbortError") return "aborted";
  return "generic";
}
type AuthModule = {
  ensureAnonSession(): Promise<unknown>;
  getUserId(): Promise<string | null>;
  authedFetch(url: string, init?: RequestInit): Promise<Response>;
};
export interface LiveApiOptions {
  /** Injection seam for offline unit tests, not an alternative production auth path. */
  loadAuth?: () => Promise<AuthModule>;
  normalTimeoutMs?: number;
  slowTimeoutMs?: number;
  onIdentityChange?: () => void;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
// One browser-wide observer, not one observer per page mount. Individual
// adapters still detect changes around requests and reject stale responses.
let authObserver: Promise<void> | null = null;
async function observeIdentity(): Promise<void> {
  if (!authObserver) {
    authObserver = import("../supabase").then(({ supabase }) => {
      supabase.auth.onAuthStateChange((_event, session) => {
        const next = session?.user?.id ?? null;
        if (getCacheIdentity() !== next) {
          setCacheIdentity(next);
          if (typeof window !== "undefined") window.dispatchEvent(new Event("halo:identity-changed"));
        }
      });
    }).catch((error) => { authObserver = null; throw error; });
  }
  return authObserver;
}

/**
 * Every timeout covers auth, transport and JSON parsing. The race is necessary:
 * aborting fetch alone cannot settle a hung identity-provider promise.
 */
export async function withDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, external?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => { controller.abort(); reject(new FrontendError("aborted")); };
    if (external?.aborted) { onAbort(); return; }
    external?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => { controller.abort(); reject(new FrontendError("timeout")); }, timeoutMs);
  });
  try {
    if (external?.aborted) return await cancelled;
    return await Promise.race([operation(controller.signal), cancelled]);
  } finally {
    clearTimeout(timer);
    if (onAbort) external?.removeEventListener("abort", onAbort);
  }
}

export function createLiveOnboardingApi(options: LiveApiOptions = {}): OnboardingApi {
  // Never import the configured Supabase client while rendering or in a mock preview.
  const loadAuth = options.loadAuth ?? (async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) throw new FrontendError("configuration");
    return await import("../auth") as AuthModule;
  });
  const normal = options.normalTimeoutMs ?? 8000;
  const slow = options.slowTimeoutMs ?? 15000;
  let profileBeforeAddress: ProfileResponse | null = null;

  async function syncIdentity(auth: AuthModule, expected?: string | null): Promise<string | null> {
    const next = await auth.getUserId();
    setCacheIdentity(next);
    if (expected && next !== expected) {
      profileBeforeAddress = null;
      options.onIdentityChange?.();
      throw new FrontendError("session_changed");
    }
    return next;
  }
  async function request<T>(endpoint: string, init: RequestInit = {}, signal?: AbortSignal, cache?: "daily" | "home"): Promise<T> {
    const pathname = endpoint.split("?")[0];
    const limit = ["/api/onboard", "/api/daily-score", "/api/home-guard"].includes(pathname) ? slow : normal;
    try {
      return await withDeadline(async (deadline) => {
        const auth = await loadAuth();
        const expected = await auth.getUserId();
        const response = await auth.authedFetch(endpoint, { ...init, signal: deadline, headers: { "Content-Type": "application/json", ...init.headers } });
        if (deadline.aborted) throw new FrontendError("aborted");
        await syncIdentity(auth, expected);
        if (deadline.aborted) throw new FrontendError("aborted");
        if (!response.ok) {
          const status = response.status;
          const code: ErrorCode = status === 429 ? "rate_limited" :
            status === 404 && pathname === "/api/onboard" ? "address_not_found" :
            status === 400 && pathname === "/api/onboard" ? "address_required" :
            status === 400 && pathname === "/api/daily-score" ? "no_location" :
            status === 400 && pathname === "/api/home-guard" ? "no_county" :
            status === 401 ? "signin_failed" : "generic";
          // Never inspect or display response.error, including database messages.
          throw new FrontendError(code, status);
        }
        const payload: unknown = await response.json();
        // Body decoding is asynchronous too. A sign-out, recovery or cancellation
        // during it must not publish the previous identity's response. Cache in
        // this same synchronous continuation so a later identity cannot become
        // the namespace for a payload that was verified for an earlier one.
        if (deadline.aborted) throw new FrontendError("aborted");
        await syncIdentity(auth, expected);
        if (deadline.aborted) throw new FrontendError("aborted");
        if (!object(payload)) throw new FrontendError("invalid_response");
        if (cache === "daily") storeReading("daily", payload as DailyResponse);
        else if (cache === "home") storeReading("home", payload as HomeResponse);
        return payload as T;
      }, limit, signal);
    } catch (error) {
      if (error instanceof FrontendError) throw error;
      const code = errorCode(error);
      if (code !== "generic") throw new FrontendError(code);
      throw new FrontendError(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "generic");
    }
  }
  const api: OnboardingApi = {
    async ensureSession() {
      try {
        await withDeadline(async () => {
          const auth = await loadAuth();
          await auth.ensureAnonSession();
          await syncIdentity(auth);
          // Supabase owns one browser-wide subscription, not one per render.
          // No new user is created here in response to a transient 503.
          if (!options.loadAuth) await observeIdentity();
        }, slow);
      } catch (error) { throw error instanceof FrontendError ? error : new FrontendError(errorCode(error) === "captcha_failed" ? "captcha_failed" : "signin_failed"); }
    },
    async getIdentity() { const auth = await loadAuth(); return syncIdentity(auth); },
    async getProfile(signal) {
      const profile = await request<ProfileResponse>("/api/profile", {}, signal);
      profileBeforeAddress = profile;
      if (!isProfileComplete(profile)) clearOnboardingStorage();
      return profile;
    },
    async submitAddress(address, signal) {
      if (validateAddress(address)) throw new FrontendError("address_required");
      const baseline = profileBeforeAddress;
      const requestId = crypto.randomUUID();
      try {
        const response = await request<OnboardResponse>("/api/onboard", { method: "POST", body: JSON.stringify({ address: address.trim(), request_id: requestId }) }, signal);
        if (!hasLocation(response)) throw new FrontendError("invalid_response");
        // Old-location readings cannot belong to this newly selected home.
        clearOnboardingStorage();
        profileBeforeAddress = { onboarded: true, profile: response };
        return response;
      } catch (error) {
        if (errorCode(error) !== "timeout" || signal?.aborted) throw error;
        // A timed-out write may still have completed. The stored request ID
        // proves this particular submission won, including an address change.
        // Older deployments without migration 0014 can only confirm a first
        // location from a known location-free baseline.
        try {
          const after = await request<ProfileResponse>("/api/profile", {}, signal);
          profileBeforeAddress = after;
          const matchedRequest = after.profile?.onboard_request_id === requestId;
          const firstLocation = baseline !== null && !hasLocation(baseline.profile) && !after.profile?.onboard_request_id;
          if (hasLocation(after.profile) && (matchedRequest || firstLocation)) {
            clearOnboardingStorage();
            return { ...after.profile, service_area_status: null, recovered_after_timeout: true };
          }
        } catch (recheckError) {
          if (["aborted", "session_changed"].includes(errorCode(recheckError))) throw recheckError;
        }
        throw error;
      }
    },
    async saveHousehold(household, signal) {
      return request("/api/household", { method: "PUT", body: JSON.stringify(normalizeHousehold(household)) }, signal);
    },
    async saveHome(home, signal) {
      const source = normalizeWaterAnswer(home.water_source);
      if (!source || validateHomeYear(home.home_year === null ? "" : String(home.home_year))) throw new FrontendError("invalid_response");
      const profile = await request<ProfileResponse>("/api/profile", { method: "PATCH", body: JSON.stringify({ water_source: source, home_year: home.home_year }) }, signal);
      if (!isProfileComplete(profile)) { clearOnboardingStorage(); throw new FrontendError("no_location"); }
      profileBeforeAddress = profile;
      return profile;
    },
    async getDaily(signal, requestOptions) {
      const endpoint = requestOptions?.fresh === true ? "/api/daily-score?fresh=1" : "/api/daily-score";
      return request<DailyResponse>(endpoint, {}, signal, "daily");
    },
    async getHome(signal) { return request<HomeResponse>("/api/home-guard", {}, signal, "home"); },
  };
  return api;
}
