"use client";

import { useEffect } from "react";
import { ensureAnonSession } from "../lib/auth";

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
    ensureAnonSession().catch((err) => {
      // Surfacing this is the job of whichever screen needs the session; here we
      // only make sure a failure is never silent.
      console.error("[HALO] anonymous session could not be started:", err);
    });
  }, []);

  return null;
}
