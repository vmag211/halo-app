/**
 * Switched-off capabilities, learned once per session from GET /api/frontend/capabilities.
 * A hint only: the server still refuses every switched-off read and write. Knowing a capability
 * is off lets the app settle its reads as "not available yet" without sending requests that can
 * only come back 503 feature_unavailable. Unknown (the read failed) means ask the server as before.
 */
export type FeatureFlags = Readonly<Record<string, boolean>>;

/** The capabilities each read needs, mirroring the server's own checks (attachments and summaries also need workspace). */
export const featureReads: Readonly<Record<string, readonly string[]>> = {
  'workspace.load': ['workspace'],
  'attachments.inspect': ['attachments', 'workspace'], 'attachments.download': ['attachments', 'workspace'],
  'summary.list': ['summaries', 'workspace'], 'summary.read': ['summaries', 'workspace'],
  'projects.current': ['projects'], 'projects.guide': ['projects'], 'projects.generation': ['projects'],
  'outreach.context': ['outreach'], 'outreach.connection': ['outreach'], 'outreach.history': ['outreach'], 'outreach.status': ['outreach'],
  'opportunities.search': ['participation'], 'opportunities.detail': ['participation'], 'organizations.search': ['participation'],
};

/** True only when a capability this read needs is known to be off. Unknown flags never skip a read. */
export function readSwitchedOff(operation: string, flags: FeatureFlags | null | undefined): boolean {
  if (!flags) return false;
  return (featureReads[operation] ?? []).some(name => flags[name] === false);
}

/** `{capabilities:{name:boolean}}` or null. Anything else is treated as unknown. */
export function parseFeatureFlags(value: unknown): FeatureFlags | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const capabilities = (value as { capabilities?: unknown }).capabilities;
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) return null;
  const entries = Object.entries(capabilities);
  if (!entries.every(([, enabled]) => typeof enabled === 'boolean')) return null;
  return Object.freeze(Object.fromEntries(entries)) as FeatureFlags;
}
