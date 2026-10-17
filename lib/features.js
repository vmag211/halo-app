/**
 * Server-enforced capability flags (BE-351).
 *
 * The rule the spec sets is "feature flags per complete capability, not many
 * permanent per-component flags", enforced on the server wherever they change
 * writes, provider spending or data processing, and with an honest explanation
 * when a capability is off. Not a per-route toggle, and not something a
 * deployed UI can talk its way past: the browser is told `enabled: false` and
 * the handler also refuses to do the work.
 *
 * Default off. A capability is on only when its variable is explicitly set to
 * `on` or `true`, so a missing or misspelled variable fails closed, and so a
 * capability cannot be switched on by accident in an environment nobody meant
 * to enable it in. Anything else, including `1`, `yes` and an empty string, is
 * off: a flag that guards someone's account is not the place to be generous
 * about spelling.
 *
 * Adding a flag here means adding its variable to `SCRUBBED_ENV` in
 * test/helpers/sandbox.mjs, or the sandbox drift test fails. That is
 * deliberate: a route test must not inherit a capability from the developer's
 * shell.
 */

/** Capability name -> the environment variable that enables it. */
export const FEATURE_FLAGS = Object.freeze({
  recovery: 'HALO_FEATURE_RECOVERY',
});

/**
 * Why a capability is off, in words for the person looking at the screen.
 * Kept here rather than in the route so the same explanation is given
 * everywhere, and deliberately vague about the reason: the open blockers are
 * operational (no human verification key, no backup coverage, no approved
 * retention period) and none of them are the person's business.
 */
const DISABLED_REASON = Object.freeze({
  recovery: 'Account recovery is not available yet. Nothing about your account has changed.',
});

const ENABLED_VALUES = new Set(['on', 'true']);

/** True only when this capability's variable is explicitly on. Missing fails closed. */
export function featureEnabled(name) {
  const variable = FEATURE_FLAGS[name];
  if (!variable) throw new Error(`features: unknown capability "${name}"`);
  const value = process.env[variable];
  return typeof value === 'string' && ENABLED_VALUES.has(value.trim().toLowerCase());
}

/** The explanation to put in a snapshot's `reason` when the capability is off. */
export function featureDisabledReason(name) {
  if (!FEATURE_FLAGS[name]) throw new Error(`features: unknown capability "${name}"`);
  return DISABLED_REASON[name];
}
