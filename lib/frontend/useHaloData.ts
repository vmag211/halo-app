"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorCode } from "./api";
import { readReading } from "./storage";
import type { DailyResponse, ErrorCode, HomeResponse } from "./types";
import type { ReadingKind } from "./storage";

export type HaloDataStatus = "loading" | "error" | "empty" | "success";
export interface HaloDataState<T> {
  data: T | null; status: HaloDataStatus; error: ErrorCode | null;
  retrievedAt: string | null; fromCache: boolean; refreshing: boolean;
}
export interface HaloDataOptions<T> {
  loader: (signal?: AbortSignal) => Promise<T>;
  enabled?: boolean;
  /** Omit for previews. Live adapters persist only environmental readings. */
  cache?: ReadingKind;
  isEmpty?: (data: T) => boolean;
}
const emptyValue = (value: unknown) => value === null || value === undefined;

/** Shared request lifecycle: stale successes remain visible while refresh retries. */
export function useHaloData<T extends DailyResponse | HomeResponse>(endpoint: string | null, { loader, enabled = true, cache, isEmpty = emptyValue }: HaloDataOptions<T>) {
  const [state, setState] = useState<HaloDataState<T>>({ data: null, status: "loading", error: null, retrievedAt: null, fromCache: false, refreshing: false });
  const requestRef = useRef<AbortController | null>(null);
  const requestNumber = useRef(0);
  const refresh = useCallback(async () => {
    if (!enabled || !endpoint) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const sequence = ++requestNumber.current;
    const cached = cache ? readReading<T>(cache) : null;
    setState((previous) => ({
      ...previous, data: previous.data ?? cached?.data ?? null,
      status: previous.data || cached ? "success" : "loading", error: null,
      retrievedAt: previous.retrievedAt ?? cached?.retrievedAt ?? null,
      fromCache: !!(previous.data || cached), refreshing: true,
    }));
    try {
      const data = await loader(controller.signal);
      if (controller.signal.aborted || sequence !== requestNumber.current) return;
      const payload = data as HomeResponse;
      setState({ data, status: isEmpty(data) ? "empty" : "success", error: null, retrievedAt: payload.retrieved_at ?? payload.assembled_at ?? null, fromCache: (data as DailyResponse).cached === true, refreshing: false });
    } catch (error) {
      if (controller.signal.aborted || sequence !== requestNumber.current) return;
      const code = errorCode(error);
      if (code === "aborted") return;
      setState((previous) => code === 'session_changed' || code === 'no_location'
        ? { data: null, status: 'error', error: code, retrievedAt: null, fromCache: false, refreshing: false }
        : { ...previous, status: previous.data ? "success" : "error", error: code, fromCache: !!previous.data, refreshing: false });
    }
  }, [endpoint, enabled, cache, loader, isEmpty]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void refresh(); });
    const invalidate = () => {
      requestRef.current?.abort();
      setState({ data: null, status: 'error', error: 'session_changed', retrievedAt: null, fromCache: false, refreshing: false });
    };
    window.addEventListener('halo:identity-changed', invalidate);
    return () => { active = false; requestRef.current?.abort(); window.removeEventListener('halo:identity-changed', invalidate); };
  }, [refresh]);
  return { ...state, refresh };
}
