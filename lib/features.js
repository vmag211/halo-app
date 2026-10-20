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
  luna: 'HALO_FEATURE_LUNA',
  // My Week's tasks (B06 Rulings H1, H17). Off until a retention period for
  // tasks is approved: a task is free text a person typed, and Vibhav
  // confirmed on 2026-10-18 that the capability stays off until then.
  tasks: 'HALO_FEATURE_TASKS',
  // The Homeguard workspace's owned records (B11 Ruling W1). Off until Vibhav
  // confirms their retention: they are free text a person typed.
  workspace: 'HALO_FEATURE_WORKSPACE',
  // Private photo attachments (B14 Ruling A1). Off until Vibhav confirms
  // their retention; they also need `workspace` on.
  attachments: 'HALO_FEATURE_ATTACHMENTS',
  // Saved household summaries (B15 Ruling S15-4). Off until Vibhav confirms
  // their retention; they also need `workspace` on.
  summaries: 'HALO_FEATURE_SUMMARIES',
  // Explore project ideas and starting a project (B16 Ruling J2). Off until
  // Vibhav confirms the library-only selection (his open decision 7) and the
  // retention of saved idea sets; starting a project also needs `workspace`.
  projects: 'HALO_FEATURE_PROJECTS',
  // Outreach preparation (B17 Ruling O1): contacts, public context and
  // copy-only drafts. Off until Vibhav confirms draft retention. It never
  // sends: there is no email provider at all.
  outreach: 'HALO_FEATURE_OUTREACH',
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
  luna: 'Luna is not available yet. You can still use HALO directly.',
  tasks: 'Saving tasks in My Week is not available yet. Nothing was saved.',
  workspace: 'Saving Homeguard records is not available yet. Nothing was saved.',
  attachments: 'Private files are not available yet. Nothing was saved.',
  summaries: 'Saved summaries are not available yet. Nothing was saved.',
  projects: 'Project ideas are not available yet. Your current ideas are kept.',
  outreach: 'Preparing outreach messages is not available yet. Nothing was saved or sent.',
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
