import { isProfileComplete } from "./onboarding";
import type { DailyResponse, HomeResponse, ProfileResponse } from "./types";

const PREFIX = "halo.frontend.v1.";
const FLAG = "halo.onboarded";
let identity: string | null = null;
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
function browserStorage(): StorageLike | null {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
}
export function getCacheIdentity(): string | null { return identity; }
export function setCacheIdentity(next: string | null): void {
  if (identity !== null && identity !== next) clearOnboardingStorage();
  identity = next;
}
export function hasCompletedOnboarding(storage: StorageLike | null = browserStorage()): boolean {
  if (!identity || !storage) return false;
  try {
    const value = JSON.parse(storage.getItem(FLAG) ?? "null");
    return value?.version === 1 && value?.identity === identity && value?.complete === true;
  } catch { return false; }
}
export function markCompleted(profile: ProfileResponse, storage: StorageLike | null = browserStorage()): boolean {
  if (!isProfileComplete(profile) || !identity || !storage) return false;
  try { storage.setItem(FLAG, JSON.stringify({ version: 1, identity, complete: true })); return true; } catch { return false; }
}
/** Clear only HALO-owned cached data, never Supabase session storage. */
export function clearReadings(storage: StorageLike | null = browserStorage()): void {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch { /* Restricted or full storage must not prevent onboarding. */ }
}
export function clearOnboardingStorage(storage: StorageLike | null = browserStorage()): void {
  clearReadings(storage);
  try { storage?.removeItem(FLAG); } catch { /* In-memory flow remains usable. */ }
}
export type ReadingKind = "daily" | "home";
export interface CachedReading<T> { data: T; receivedAt: string; retrievedAt: string | null }

/** Full response fields needed by the next feature, never profile/address/household. */
function cachePayload(kind: ReadingKind, response: DailyResponse | HomeResponse): Record<string, unknown> {
  const fields = kind === "daily"
    ? ["air", "uv", "pollen", "mold", "score", "retrieved_at", "cached"]
    : ["success", "water", "radon", "score", "lead", "action_plan", "breakdown", "retrieved_at", "assembled_at"];
  const raw = response as Record<string, unknown>;
  const result = Object.fromEntries(fields.filter((key) => Object.hasOwn(raw, key)).map((key) => [key, raw[key]]));
  // Defense in depth for future additive backend fields. Coordinates are not
  // required in a reading cache, and credentials never belong in this layer.
  return JSON.parse(JSON.stringify(result, (key, value) =>
    /^(address|street_address|household|profile|profile_id|lat|lng|latitude|longitude|access_token|refresh_token|authorization)$/i.test(key) ? undefined : value));
}
export function storeReading(kind: "daily", data: DailyResponse, storage?: StorageLike | null): void;
export function storeReading(kind: "home", data: HomeResponse, storage?: StorageLike | null): void;
export function storeReading(kind: ReadingKind, data: DailyResponse | HomeResponse, storage: StorageLike | null = browserStorage()): void {
  if (!identity || !storage || !data || typeof data !== "object") return;
  try {
    const response = data as HomeResponse;
    const retrievedAt = response.retrieved_at ?? response.assembled_at ?? null;
    storage.setItem(`${PREFIX}${identity}.${kind}`, JSON.stringify({ version: 1, data: cachePayload(kind, data), receivedAt: new Date().toISOString(), retrievedAt }));
  } catch { /* Quota or private browsing restrictions never block real results. */ }
}
export function readReading<T extends DailyResponse | HomeResponse>(kind: ReadingKind, storage: StorageLike | null = browserStorage()): CachedReading<T> | null {
  if (!identity || !storage) return null;
  try {
    const value = JSON.parse(storage.getItem(`${PREFIX}${identity}.${kind}`) ?? "null");
    if (value?.version !== 1 || !value.data || typeof value.data !== "object" || typeof value.receivedAt !== "string") return null;
    return { data: value.data, receivedAt: value.receivedAt, retrievedAt: typeof value.retrievedAt === "string" ? value.retrievedAt : null };
  } catch { return null; }
}
