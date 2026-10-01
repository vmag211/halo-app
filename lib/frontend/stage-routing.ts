/** Never let an entry parameter become an open redirect or carry private input. */
export function safeStageReturn(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return '/today';
  try {
    const url = new URL(value, 'https://halo.invalid');
    const path = url.pathname.replace(/\/$/, '');
    if (!/^\/(today|home|family|settings|factors\/(air|uv|pollen|mold|pfas|radon|lead)|household\/(toddler|child|teen|adult|senior|pregnant|respiratory))$/.test(path)) return '/today';
    const hash = /^#(?:reading-(?:overview|detail|sources)|protection|household|tip-(?:air|uv|pollen|mold|pfas|radon|lead)-\d+)$/.test(url.hash) ? url.hash : '';
    return path + hash;
  } catch { return '/today'; }
}
