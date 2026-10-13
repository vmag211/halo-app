import { sourceOperationsCopy as copy } from './copy/source-operations';

export type OperatorRole = 'denied' | 'viewer' | 'reviewer' | 'publisher';
export type SourceDecision = 'approve' | 'quarantine' | 'publish' | 'withdraw' | 'translation' | 'retry';
export type SourceEvidenceState = 'measured' | 'zero' | 'non-detect' | 'missing' | 'partial' | 'invalid';
export type SourceRevision = {
  id: string; count: number; geography: string; units: string; observed: string; published: string;
  retrieved: string; parser: string; content: string; requiredFields: string; evidence: SourceEvidenceState;
  failures: string[]; status: 'incoming' | 'approved' | 'quarantined' | 'published' | 'superseded' | 'withdrawn';
  reviewer: string; translation: 'not-requested' | 'pending' | 'approved';
};
export type SourceRun = { id: string; state: 'complete' | 'failed'; parser: string; rejected: number; diagnostic: string; requestKey: string; attempts: number };
export type SourceAudit = { requestId: string; decision: SourceDecision; target: string; reason: string; role: OperatorRole; revision: number; recordedAt: string };
export type OperatorSource = {
  id: string; name: string; owner: string; organization: string; url: string; terms: string; method: string;
  cadence: string; lastSuccess: string; nextReview: string; freshness: 'current' | 'stale'; link: 'available' | 'broken';
  coverage: string; revision: number; publishedId: string | null; candidateId: string | null;
  versions: SourceRevision[]; run: SourceRun; audit: SourceAudit[];
};
export type SourceOperation = { sourceId: string; sourceRevision: number; target: string; decision: SourceDecision; requestId: string; reason: string; recordedAt: string };

const revision = (id: string, patch: Partial<SourceRevision> = {}): SourceRevision => ({
  id, count: 18, geography: 'Review county only', units: 'µg/L', observed: '2026-10-08', published: '2026-10-09', retrieved: '2026-10-10T13:00:00Z',
  parser: 'review-parser-2', content: id, requiredFields: '18 of 18 complete', evidence: 'measured', failures: [], status: 'published', reviewer: 'Review editor', translation: 'not-requested', ...patch,
});
const source = (id: string, name: string): OperatorSource => ({
  id, name, owner: 'Evidence review team', organization: 'Synthetic source provider', url: `https://example.org/review/${id}`,
  terms: 'Synthetic review content only. Production access and reuse must be verified separately.', method: 'Reviewed public-source import',
  cadence: 'Weekly', lastSuccess: '2026-10-10T13:00:00Z', nextReview: '2026-10-17', freshness: 'current', link: 'available', coverage: 'Review county only',
  revision: 1, publishedId: null, candidateId: null, versions: [],
  run: { id: `${id}-run-2`, state: 'complete', parser: 'review-parser-2', rejected: 0, diagnostic: 'Required fields and source dates validated.', requestKey: `${id}/release-2/parser-2`, attempts: 1 }, audit: [],
});

/** New mutable review state per mount. No public service or account is consulted. */
export function sourceOperationFixtures(): OperatorSource[] {
  return [
    { ...source('guidance', 'Native planting guide'), organization: 'Synthetic editorial source', method: 'Human-reviewed guidance import', cadence: 'Review every 90 days', coverage: 'Review county only', nextReview: '2026-10-12',
      publishedId: 'guide-2', candidateId: 'guide-3',
      versions: [revision('guide-2', { count: 3, units: 'Not applicable', requiredFields: '3 of 3 complete', observed: '2026-09-01', published: '2026-09-04', parser: 'manual-review-1' }), revision('guide-3', { count: 4, units: 'Not applicable', requiredFields: '4 of 4 complete', status: 'incoming', parser: 'manual-review-1', translation: 'pending', reviewer: 'Not reviewed' })],
    },
    { ...source('water', 'Water evidence import'), freshness: 'stale', publishedId: 'water-5', candidateId: 'water-6',
      versions: [revision('water-5'), revision('water-6', { count: 0, units: 'mg/L, unexpectedly changed', geography: 'Outside expected coverage', requiredFields: 'Required result fields missing', observed: 'Invalid date', evidence: 'invalid', status: 'incoming', reviewer: 'Not reviewed', failures: ['Unexpectedly empty dataset is not a measured zero.', 'Units changed without a reviewed conversion.', 'Geometry falls outside expected coverage.', 'Observation date and required fields are invalid.'] })],
      run: { id: 'water-run-6', state: 'failed', parser: 'review-parser-2', rejected: 18, diagnostic: 'Schema validation failed. Raw rows and request headers are intentionally not shown.', requestKey: 'water/release-6/parser-2', attempts: 1 },
    },
    { ...source('air', 'Air monitor feed'), freshness: 'stale', link: 'broken', publishedId: 'air-7', candidateId: null, cadence: 'Hourly', nextReview: '2026-10-11',
      versions: [revision('air-7', { count: 12, units: 'µg/m³', requiredFields: '12 of 12 complete', evidence: 'partial' })],
      run: { id: 'air-run-8', state: 'failed', parser: 'review-parser-2', rejected: 0, diagnostic: 'Fetch unavailable. The last successful dated revision is retained, marked stale, and is not an all-clear.', requestKey: 'air/release-8/parser-2', attempts: 1 },
    },
  ];
}

export function sourceOperationTarget(source: OperatorSource, decision: SourceDecision): string {
  if (decision === 'retry') return source.run.id;
  if (decision === 'withdraw') return source.publishedId ?? '';
  return source.candidateId ?? source.publishedId ?? '';
}

export function sourceOperationError(source: OperatorSource, request: SourceOperation, role: OperatorRole): string | null {
  if (source.audit.some(entry => entry.requestId === request.requestId)) return copy.duplicate;
  if (!['reviewer', 'publisher'].includes(role) || (['publish', 'withdraw'].includes(request.decision) && role !== 'publisher')) return copy.forbidden;
  if (request.sourceId !== source.id || request.sourceRevision !== source.revision || request.target !== sourceOperationTarget(source, request.decision)) return copy.changed;
  if (request.reason.trim().length < 8 || request.reason.length > 500 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(request.reason)) return copy.reasonRequired;
  if (!request.requestId || !Number.isFinite(Date.parse(request.recordedAt)) || !['approve', 'quarantine', 'publish', 'withdraw', 'translation', 'retry'].includes(request.decision)) return copy.changed;
  if (request.decision === 'retry') return source.run.state === 'failed' ? null : 'Only a failed run can be retried. Inspect its latest result first.';
  const target = source.versions.find(item => item.id === request.target);
  if (!target) return copy.changed;
  if (request.decision === 'withdraw') return target.status === 'published' ? null : copy.changed;
  if (['approve', 'publish', 'translation'].includes(request.decision) && (target.failures.length || target.evidence === 'invalid' || target.status === 'quarantined' || target.status === 'withdrawn')) return copy.invalid;
  if (request.decision === 'publish' && target.status !== 'approved') return copy.approvedFirst;
  if (request.decision === 'approve' && target.status !== 'incoming') return 'Only a new validated candidate can be approved.';
  if (request.decision === 'quarantine' && !['incoming', 'approved'].includes(target.status)) return 'Only an unpublished candidate can be quarantined. Withdraw published advice separately.';
  if (request.decision === 'translation' && (target.translation !== 'pending' || !['approved', 'published'].includes(target.status))) return 'Approve the matching source content before approving its pending translation.';
  return null;
}

export function applySourceOperation(source: OperatorSource, request: SourceOperation, role: OperatorRole): { source: OperatorSource; error: string | null } {
  const error = sourceOperationError(source, request, role);
  if (error) return { source, error };
  let publishedId = source.publishedId;
  let candidateId = source.candidateId;
  const versions = source.versions.map(item => {
    if (request.decision === 'publish' && item.id === source.publishedId) return { ...item, status: 'superseded' as const };
    if (item.id !== request.target) return item;
    switch (request.decision) {
      case 'approve': return { ...item, status: 'approved' as const, reviewer: 'Review operator' };
      case 'quarantine': return { ...item, status: 'quarantined' as const, reviewer: 'Review operator' };
      case 'publish': publishedId = item.id; candidateId = null; return { ...item, status: 'published' as const };
      case 'withdraw': publishedId = null; return { ...item, status: 'withdrawn' as const };
      case 'translation': return { ...item, translation: 'approved' as const };
      default: return item;
    }
  });
  const run = request.decision === 'retry' ? { ...source.run, attempts: source.run.attempts + 1, state: 'complete' as const, diagnostic: 'Bounded retry completed. No new candidate was accepted or published; the last valid dated record is unchanged.' } : source.run;
  return { error: null, source: { ...source, publishedId, candidateId, versions, run, revision: source.revision + 1,
    audit: [...source.audit, { requestId: request.requestId, decision: request.decision, target: request.target, reason: request.reason.trim(), role, revision: source.revision + 1, recordedAt: request.recordedAt }],
  } };
}

export const sourceEvidenceLabels: Record<SourceEvidenceState, string> = {
  measured: 'Reported value', zero: 'Reported measured zero', 'non-detect': 'Non-detect with original qualifier', missing: 'No result supplied', partial: 'Partial coverage', invalid: 'Invalid import, not interpretable',
};
