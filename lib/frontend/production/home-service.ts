/** Authenticated Homeguard and shared owned-record boundary. No fixture or transport fallback. */
export type HomeServiceRecord = { id: string; title: string; revision: number; homeContextId?: string };
export type HomeCollections = Record<string, HomeServiceRecord[]>;
export type HomeCollectionAvailability = 'ready' | 'empty' | 'partial' | 'stale' | 'unavailable';
export type HomeCollectionSnapshot = {
  records: HomeServiceRecord[];
  revision?: string | number;
  availability?: HomeCollectionAvailability;
  /** A partial page is never a complete deletion/export inventory. */
  complete?: boolean;
  nextCursor?: string | null;
  message?: string;
  /** Authoritative owner-scoped unresolved writes, including writes begun on another device. */
  pendingOperations?: { operationId: string; domain: 'workspace' | 'attachments'; command?: HomeWorkspaceCommand }[];
};
export type HomeWorkspaceCommand = { operationId: string } & (
  | { kind: 'write'; collection: string; record: HomeServiceRecord; expectedRevision: number | null; collectionRevision?: string | number }
  | { kind: 'remove'; collection: string; recordId: string; expectedRevision: number; collectionRevision?: string | number }
  | { kind: 'remove-notes'; selection: { id: string; revision: number }[] }
  | { kind: 'clear-private'; scope: 'journal' | 'all'; expectedFingerprint: string }
);
export type HomeWorkspaceReceipt = {
  status: 'succeeded' | 'pending' | 'unknown' | 'failed';
  operationId: string;
  /** Complete canonical replacement of each included collection, never client-computed revisions. */
  changes: HomeCollections;
  message?: string;
  code?: 'conflict' | 'session' | 'permission' | 'unavailable' | 'validation' | 'rate_limited';
  revisions?: Record<string, string | number>;
};
export type HomeAttachment = {
  id: string; revision: number; name: string; mime: string; bytes: number;
  status: 'quarantined' | 'ready' | 'rejected';
  metadataRemoved: boolean;
};
export type HomeAttachmentService = {
  upload(input: { collection: string; recordId: string; file: Blob; name: string; metadataRemoved: boolean; reviewed: boolean; operationId: string }, signal: AbortSignal, progress?: (fraction: number) => void): Promise<HomeAttachment>;
  inspect(attachmentId: string, signal: AbortSignal): Promise<HomeAttachment>;
  reconcileUpload?(operationId: string, signal: AbortSignal): Promise<{ status: 'succeeded' | 'pending' | 'unknown' | 'failed'; operationId: string; attachment?: HomeAttachment; message?: string }>;
  download(attachmentId: string, revision: number, signal: AbortSignal): Promise<Blob>;
  remove(attachmentId: string, revision: number, operationId: string, signal: AbortSignal): Promise<HomeWorkspaceReceipt>;
};
export type HomeWorkspaceContext = {
  currentHomeId: string | null;
  homes: { id: string; label: string; state: string; revision: number }[];
  areaLabel?: string;
  waterSource?: 'utility' | 'well' | 'spring' | 'unknown';
};
export type HomeWorkspaceService = {
  /** Change identity/context by remounting the provider, never by reusing its private cache. */
  readonly scopeKey: string;
  readonly context?: HomeWorkspaceContext;
  readonly attachments?: HomeAttachmentService;
  /** Public evidence is acquired by the server, never by sending private record text to providers. */
  readResource?(resource: string, query: Record<string, string>, signal: AbortSignal): Promise<unknown>;
  load(collection: string, signal: AbortSignal): Promise<HomeCollectionSnapshot>;
  execute(command: HomeWorkspaceCommand, signal: AbortSignal): Promise<HomeWorkspaceReceipt>;
  reconcile(operationId: string, signal: AbortSignal, domain?: 'workspace' | 'attachments'): Promise<HomeWorkspaceReceipt>;
};

export function validHomeRecords(value: unknown): value is HomeServiceRecord[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every(item => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || typeof item.title !== 'string' || !Number.isSafeInteger(item.revision) || item.revision < 1 || ids.has(item.id)) return false;
    ids.add(item.id); return true;
  });
}

export function validHomeChanges(value: unknown): value is HomeCollections {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(([key, rows]) => /^[a-zA-Z][a-zA-Z0-9]{0,79}$/.test(key) && validHomeRecords(rows)));
}

/** A false/unknown receipt must never mutate a currently displayed collection. */
export function acceptedHomeReceipt(value: HomeWorkspaceReceipt, operationId: string): boolean {
  return value.operationId === operationId && value.status === 'succeeded' && validHomeChanges(value.changes);
}

/** An HTTP success without the requested canonical outcome is not a confirmed save. */
export function homeReceiptCoversCommand(command: HomeWorkspaceCommand, receipt: HomeWorkspaceReceipt): boolean {
  if (!acceptedHomeReceipt(receipt, command.operationId)) return false;
  if (command.kind === 'write') return Boolean(receipt.changes[command.collection]?.some(row => row.id === command.record.id && row.revision > (command.expectedRevision ?? 0)));
  if (command.kind === 'remove') return Array.isArray(receipt.changes[command.collection]) && !receipt.changes[command.collection].some(row => row.id === command.recordId);
  if (command.kind === 'remove-notes') return Array.isArray(receipt.changes.exploreNotes) && !receipt.changes.exploreNotes.some(row => command.selection.some(note => note.id === row.id));
  return command.scope === 'journal' ? receipt.changes.weekJournal?.length === 0 : Object.keys(receipt.changes).length > 0 && Object.values(receipt.changes).every(rows => rows.length === 0);
}
