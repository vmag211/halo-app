"use client";

import { useEffect } from "react";
import {deliveredStagePath} from "@/lib/frontend/navigation";

/**
 * Opens the device's anonymous session as early as possible.
 *
 * Private screens share one session. Public browsing and isolated reviews
 * must never create an account just because a visitor opens them.
 *
 * Renders nothing. ensureAnonSession() is single-flight, so a screen that also
 * needs the session -- OnboardingScreen calls it so it can show the user a real
 * error message, which this component cannot do -- joins the same promise
 * instead of signing a second anonymous user in.
 */
export default function AuthInitializer() {
  useEffect(() => {
    // Preview is deliberately isolated: it must never create a real household.
    if (window.location.pathname.startsWith('/onboarding/preview')) return;
    if (window.location.pathname.startsWith('/foundation/preview')) return;
    if (window.location.pathname === '/learn') return;
    if (window.location.pathname === '/map' && new URLSearchParams(window.location.search).get('access') !== 'owned') return;
    if (!deliveredStagePath(window.location.pathname) && window.location.pathname !== '/onboarding') return;
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return;
    import('../lib/auth').then(({ensureAnonSession}) => ensureAnonSession()).catch(() => {
      // Surfacing this is the job of whichever screen needs the session; here we
      // only make sure a failure is never silent.
      // The foreground flow shows the approved, non-sensitive error message.
    });
  }, []);

  return null;
}
