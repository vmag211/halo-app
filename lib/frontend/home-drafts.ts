/** Clear only the submitted draft when a save finishes after newer work began. */
export function clearHomeDraft(previous: Record<string, unknown>, key: string, ...expected: unknown[]): Record<string, unknown> {
  if (!Object.hasOwn(previous, key) || (expected.length > 0 && previous[key] !== expected[0])) return previous;
  const next = { ...previous };
  delete next[key];
  return next;
}
