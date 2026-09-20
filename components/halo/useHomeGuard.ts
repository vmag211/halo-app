"use client";

import { useCallback, useEffect, useState } from "react";
import { getHomeGuard } from "@/lib/api";
import type { HomeGuardResponse } from "./homeguard";

export type HGParams = {
  county: string | null;
  pwsid?: string;
  waterSource?: string;
  homeYear?: number;
  lat?: number;
  lng?: number;
  raw: string;
};

export type HGState =
  | { kind: "loading" }
  | { kind: "no_address" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: HomeGuardResponse; params: HGParams };

function readParams(): HGParams {
  const q = new URLSearchParams(window.location.search);
  const num = (v: string | null) => (v && !Number.isNaN(Number(v)) ? Number(v) : undefined);
  return {
    county: q.get("county"),
    pwsid: q.get("pwsid") ?? undefined,
    waterSource: q.get("water_source") ?? undefined,
    homeYear: num(q.get("home_year")),
    lat: num(q.get("lat")),
    lng: num(q.get("lng")),
    raw: window.location.search,
  };
}

/**
 * Fetches the HomeGuard payload for the main page and both subpages. Inputs
 * come from the URL because onboarding doesn't yet persist/route the profile
 * (its response is only logged — the handoff TODO). Swap this for a profile
 * read once that lands; the three screens won't change.
 */
export function useHomeGuard() {
  const [state, setState] = useState<HGState>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const params = readParams();
    if (!params.county) {
      setState({ kind: "no_address" });
      return;
    }
    try {
      const data = (await getHomeGuard({
        county: params.county,
        pwsid: params.pwsid,
        waterSource: params.waterSource,
        homeYear: params.homeYear,
      })) as HomeGuardResponse;
      setState({ kind: "ready", data, params });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : "Something went wrong." });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}
