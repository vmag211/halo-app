'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { StageData } from '@/lib/frontend/stage-data';
import type { LearnResponse } from '@/lib/frontend/stage-api';
import type { FactorKey } from '@/lib/frontend/factor-preview';
import type { Household } from '@/lib/frontend/types';

/** A live value is always complete, including explicit unavailable readings.
 * An absent provider is reserved for the immutable, isolated design preview. */
export type StageRuntime = StageData & {
  household: Household;
  learn: Partial<Record<FactorKey, LearnResponse>>;
  learnPending: boolean;
  learnFailed: boolean;
  retryLearn: () => void;
};
const Runtime = createContext<StageRuntime | null>(null);
export function StageRuntimeProvider({ value, children }: { value: StageRuntime; children: ReactNode }) {
  return <Runtime.Provider value={value}>{children}</Runtime.Provider>;
}
export function useStageRuntime() { return useContext(Runtime); }
