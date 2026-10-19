export type AccountFeature = 'home' | 'recovery' | 'device' | 'email' | 'calendar';
export type AccountArea = { id: string; label: string; precision: string; timezone: string; utilityStatus: string };
export type HomeReview = { token: string; expiresAt: string; candidateId: string; portableIds: string[]; consequences: string[]; expectedRevision: number };
export type AccountSnapshot = {
  feature: AccountFeature; revision: number; unresolvedOperations: string[]; enabled: boolean; reason?: string;
  home?: { current: AccountArea | null; candidates: AccountArea[]; portableTasks: { id: string; title: string; revision: number }[]; history: { id: string; label: string; changedAt: string; taskIds: string[] }[]; review: HomeReview | null };
  recovery?: { method: { id: string; maskedAddress: string; verifiedAt: string } | null; challenge: { id: string; maskedAddress: string; expiresAt: string; status: 'pending' | 'expired' | 'verified' } | null; devices: { id: string; label: string; current: boolean; lastSeen: string; revision: number }[] };
  device?: { registration: { id: string; revision: number; status: 'active' | 'expired' | 'revoked'; endpointHash: string } | null; vapidPublicKey: string | null };
  connection?: { status: 'disconnected' | 'pending' | 'connected' | 'expired' | 'revoked'; maskedAccount: string | null; scopes: string[]; authorization: { url: string; expiresAt: string; requestId: string } | null };
};
export type AccountReceipt = { operationId: string; status: 'succeeded' | 'pending' | 'unknown' | 'failed'; snapshot?: AccountSnapshot; message?: string };
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const text = (x: unknown): x is string => typeof x === 'string' && x.length <= 4000;
const list = (x: unknown): x is string[] => Array.isArray(x) && x.length < 500 && x.every(text);
const revision = (x: unknown) => Number.isSafeInteger(x) && Number(x) >= 0;
const date = (x: unknown): x is string => text(x) && Number.isFinite(Date.parse(x));
export function validAccountArea(x: unknown): x is AccountArea { return object(x) && ['id', 'label', 'precision', 'timezone', 'utilityStatus'].every(key => text(x[key]) && x[key] !== ''); }
export function safeAuthorizationUrl(value: unknown): value is string {
  if (!text(value)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'accounts.google.com' && !url.port && !url.username && !url.password && /^\/o\/oauth2\/(?:v2\/)?auth$/.test(url.pathname) && !!url.searchParams.get('state') && !!url.searchParams.get('client_id'); } catch { return false; }
}
export function validAccountSnapshot(value: unknown, feature?: AccountFeature): value is AccountSnapshot {
  if (!object(value) || !['home','recovery','device','email','calendar'].includes(String(value.feature)) || feature && value.feature !== feature || !revision(value.revision) || !list(value.unresolvedOperations) || typeof value.enabled !== 'boolean' || value.reason !== undefined && !text(value.reason)) return false;
  if (value.feature === 'home') {
    const x = value.home;
    if (!object(x) || x.current !== null && !validAccountArea(x.current) || !Array.isArray(x.candidates) || x.candidates.length > 20 || !x.candidates.every(validAccountArea) || !Array.isArray(x.portableTasks) || !x.portableTasks.every(t => object(t) && text(t.id) && text(t.title) && revision(t.revision)) || !Array.isArray(x.history) || !x.history.every(t => object(t) && text(t.id) && text(t.label) && date(t.changedAt) && list(t.taskIds))) return false;
    if (x.review !== null) { const r=x.review; if (!object(r) || !text(r.token) || !date(r.expiresAt) || !text(r.candidateId) || !list(r.portableIds) || !list(r.consequences) || !revision(r.expectedRevision)) return false; }
    return true;
  }
  if (value.feature === 'recovery') {
    const x=value.recovery;
    if (!object(x) || !Array.isArray(x.devices) || !x.devices.every(t => object(t) && text(t.id) && text(t.label) && typeof t.current === 'boolean' && date(t.lastSeen) && revision(t.revision))) return false;
    if (x.method !== null && (!object(x.method) || !text(x.method.id) || !text(x.method.maskedAddress) || !date(x.method.verifiedAt))) return false;
    if (x.challenge !== null && (!object(x.challenge) || !text(x.challenge.id) || !text(x.challenge.maskedAddress) || !date(x.challenge.expiresAt) || !['pending','expired','verified'].includes(String(x.challenge.status)))) return false;
    return true;
  }
  if (value.feature === 'device') {
    const x=value.device;
    return object(x) && (x.vapidPublicKey === null || text(x.vapidPublicKey) && /^[A-Za-z0-9_-]{80,100}$/.test(x.vapidPublicKey)) && (x.registration === null || object(x.registration) && text(x.registration.id) && revision(x.registration.revision) && text(x.registration.endpointHash) && ['active','expired','revoked'].includes(String(x.registration.status)));
  }
  const x=value.connection;
  return object(x) && ['disconnected','pending','connected','expired','revoked'].includes(String(x.status)) && (x.maskedAccount === null || text(x.maskedAccount)) && list(x.scopes) && (x.authorization === null || object(x.authorization) && safeAuthorizationUrl(x.authorization.url) && date(x.authorization.expiresAt) && text(x.authorization.requestId));
}
export function validAccountReceipt(value: unknown, id: string, feature: AccountFeature): value is AccountReceipt { return object(value) && value.operationId === id && ['succeeded','pending','unknown','failed'].includes(String(value.status)) && (value.status !== 'succeeded' || validAccountSnapshot(value.snapshot, feature)); }
export function pushApplicationKey(value: string): Uint8Array<ArrayBuffer> {
  const base64=value.replaceAll('-','+').replaceAll('_','/').padEnd(Math.ceil(value.length/4)*4,'='), decoded=atob(base64);
  if (decoded.length !== 65) throw new Error('Invalid notification key.');
  return Uint8Array.from(decoded, character=>character.charCodeAt(0));
}
