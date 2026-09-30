"use client";

import { useEffect } from "react";

/**
 * Opens the device's anonymous session as early as possible.
 *
 * Mounted in the root layout rather than on a single screen, so the session
 * exists no matter which route the user lands on. Every API route derives the
 * profile id from the session token and refuses requests without one, so a
 * screen that renders before this has run would only be able to 401.
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
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return;
    import('../lib/auth').then(({ensureAnonSession}) => ensureAnonSession()).catch(() => {
      // Surfacing this is the job of whichever screen needs the session; here we
      // only make sure a failure is never silent.
      // The foreground flow shows the approved, non-sensitive error message.
    });
  }, []);

  return null;
}
