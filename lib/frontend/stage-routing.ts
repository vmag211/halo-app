import { deliveredStagePath } from './navigation';
/** Never let an entry parameter become an open redirect or carry private input. */
export function safeStageReturn(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return '/plan';
  try {
    const url = new URL(value, 'https://halo.invalid');
    const path = url.pathname.replace(/\/$/, '');
    if (!deliveredStagePath(path)) return '/plan';
    const hash = /^#(?:reading-(?:overview|detail|sources)|protection|household|tip-(?:air|uv|pollen|mold|pfas|radon|lead)-\d+)$/.test(url.hash) ? url.hash : '';
    // Preserve only the explicit owned-map mode, never a location or record query.
    const ownedMap=path==='/map'&&url.searchParams.get('access')==='owned'?'?access=owned':'';
    return path + ownedMap + hash;
  } catch { return '/plan'; }
}
