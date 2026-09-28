"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ErrorCallout from '@/components/ui/ErrorCallout';
import { createLiveOnboardingApi, errorCode } from '@/lib/frontend/api';
import { copy } from '@/lib/frontend/copy';
import { isProfileComplete } from '@/lib/frontend/onboarding';
import type { ErrorCode } from '@/lib/frontend/types';

const api = createLiveOnboardingApi();

/** A cached completion marker permits entry, but never replaces server truth. */
export default function ProfileRecheck() {
  const router = useRouter();
  const request = useRef<AbortController | null>(null);
  const [failure, setFailure] = useState<ErrorCode | null>(null);
  const check = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setFailure(null);
    try {
      const profile = await api.getProfile(controller.signal);
      if (!controller.signal.aborted && !isProfileComplete(profile)) router.replace('/onboarding?entry=1');
    } catch (error) {
      if (!controller.signal.aborted) setFailure(errorCode(error));
    }
  }, [router]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void check(); });
    return () => { active = false; request.current?.abort(); };
  }, [check]);
  return failure ? <ErrorCallout message={copy.errors[failure]} retry={() => void check()} /> : null;
}
