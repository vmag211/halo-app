'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sourceOperationsCopy as copy } from '@/lib/frontend/copy/source-operations';
import { applySourceOperation, sourceEvidenceLabels, sourceOperationError, sourceOperationFixtures, sourceOperationTarget, type OperatorRole, type OperatorSource, type SourceDecision, type SourceOperation } from '@/lib/frontend/source-operations-preview';
import './source-operations-review.css';

const decisions: Record<SourceDecision, string> = { approve: 'Approve candidate', quarantine: 'Quarantine candidate', publish: 'Publish reviewed content', withdraw: 'Withdraw publication', translation: 'Approve Spanish translation', retry: 'Retry failed run' };

/** Deliberately outside the consumer shell. This does not confer an operator role. */
export default function SourceOperationsReview() {
  const [sources, setSources] = useState(sourceOperationFixtures);
  const sourceRef = useRef(sources);
  const [role, setRole] = useState<OperatorRole>('denied');
  const roleRef = useRef(role);
  const [outcome, setOutcome] = useState('saved');
  const outcomeRef = useRef(outcome);
  useLayoutEffect(() => { roleRef.current = role; outcomeRef.current = outcome; }, [role, outcome]);
  const [statusResult, setStatusResult] = useState('unknown');
  const [selected, setSelected] = useState('guidance');
  const [reason, setReason] = useState('');
  const [review, setReview] = useState<SourceOperation | null>(null);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState<SourceOperation | null>(null);
  const [notice, setNotice] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const source = sources.find(item => item.id === selected)!;
  const published = source.versions.find(item => item.id === source.publishedId);
  const candidate = source.versions.find(item => item.id === source.candidateId);
  const changeSources = (next: OperatorSource[]) => { sourceRef.current = next; setSources(next); };
  const prepare = (decision: SourceDecision) => {
    if (uncertain) { setNotice(copy.unknown); return; }
    const request: SourceOperation = { sourceId: source.id, sourceRevision: source.revision, target: sourceOperationTarget(source, decision), decision, requestId: crypto.randomUUID(), reason: reason.trim(), recordedAt: new Date().toISOString() };
    const error = sourceOperationError(source, request, role);
    if (error) { setNotice(error); return; }
    setReview(request); setNotice('');
  };
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; setPending(false); setReview(null); setNotice(copy.cancellation); };
  const confirm = () => {
    if (!review || pending || uncertain) return;
    setPending(true); setNotice('');
    timer.current = setTimeout(() => {
      timer.current = null; setPending(false);
      const latest = sourceRef.current.find(item => item.id === review.sourceId);
      if (!latest) { setNotice(copy.changed); return; }
      const error = sourceOperationError(latest, review, roleRef.current);
      if (error) { setNotice(error); return; }
      if (!navigator.onLine || outcomeRef.current === 'offline') { setNotice(copy.offline); return; }
      if (outcomeRef.current === 'failure') { setNotice(copy.failure); return; }
      if (outcomeRef.current === 'unknown') { setUncertain(review); setNotice(copy.unknown); return; }
      const result = applySourceOperation(latest, review, roleRef.current);
      if (result.error) { setNotice(result.error); return; }
      changeSources(sourceRef.current.map(item => item.id === latest.id ? result.source : item));
      setReview(null); setReason(''); setNotice(`${copy.submitted} ${copy.preserved}`);
    }, 500);
  };
  const inspectStatus = () => {
    if (!navigator.onLine || outcome === 'offline') { setNotice(copy.offline); return; }
    if (role === 'denied') { setNotice(copy.forbidden); return; }
    if (statusResult !== 'not-written') { setNotice(copy.unknownPending); return; }
    setUncertain(null); setNotice(copy.noWrite);
  };
  const simulateRevision = () => {
    changeSources(sourceRef.current.map(item => item.id === selected ? { ...item, revision: item.revision + 1 } : item));
    setNotice('A newer source revision is available for this review. Published evidence has not changed.');
  };
  const comparison = [
    ['Records', published?.count.toString(), candidate?.count.toString()],
    ['Geography', published?.geography, candidate?.geography],
    ['Units', published?.units, candidate?.units],
    ['Observed', published?.observed, candidate?.observed],
    ['Source published', published?.published, candidate?.published],
    ['Retrieved', published?.retrieved, candidate?.retrieved],
    ['Required fields', published?.requiredFields, candidate?.requiredFields],
    ['Parser', published?.parser, candidate?.parser],
    ['Meaning', published ? sourceEvidenceLabels[published.evidence] : undefined, candidate ? sourceEvidenceLabels[candidate.evidence] : undefined],
  ];
  return <details className="source-ops-review">
    <summary>Source operations review</summary>
    <p>{copy.reviewOnly}</p>
    <div className="source-ops-controls">
      <label>{copy.role}<select value={role} onChange={event => setRole(event.target.value as OperatorRole)}><option value="denied">Household user, access denied</option><option value="viewer">Operator viewer</option><option value="reviewer">Source reviewer</option><option value="publisher">Source publisher</option></select></label>
      <label>{copy.outcome}<select value={outcome} onChange={event => setOutcome(event.target.value)}><option value="saved">Saved</option><option value="failure">Failed, not saved</option><option value="offline">Offline</option><option value="unknown">Unknown, no write occurred</option></select></label>
      <label>Operator status check<select value={statusResult} onChange={event => setStatusResult(event.target.value)}><option value="unknown">Still unconfirmed</option><option value="not-written">Confirmed not written</option></select></label>
    </div>
    {role === 'denied' ? <p role="status">{copy.denied}</p> : <section aria-label="Source operations workspace">
      <header><h2>{copy.title}</h2><span>Review role: {role}</span></header>
      <label>Source<select value={selected} disabled={pending || !!review || !!uncertain} onChange={event => { setSelected(event.target.value); setReason(''); setNotice(''); }}>
        {sources.map(item => <option key={item.id} value={item.id}>{item.name} · {item.freshness} · {item.run.rejected} rejected</option>)}
      </select></label>
      <div className="source-ops-health"><span>{source.freshness === 'stale' ? 'Stale, last valid retained' : 'Current reviewed source'}</span><span>{source.run.rejected} rejected</span><span>Review due {source.nextReview}</span></div>
      <dl className="source-ops-summary"><div><dt>Current publication</dt><dd>{source.publishedId ?? 'No active publication'}</dd></div><div><dt>Incoming candidate</dt><dd>{candidate ? `${candidate.id} · ${candidate.status}` : 'No candidate'}</dd></div><div><dt>Last successful run</dt><dd>{source.lastSuccess}</dd></div><div><dt>Coverage</dt><dd>{source.coverage}</dd></div></dl>
      <details><summary>Source record and safe run diagnostics</summary>
        <dl className="source-ops-summary">{[['Owner',source.owner],['Issuing organization',source.organization],['Supporting URL',source.url],['Access and reuse',source.terms],['Method',source.method],['Cadence',source.cadence],['Link state',source.link],['Run',source.run.id],['Parser',source.run.parser],['Attempts',String(source.run.attempts)],['Request key',source.run.requestKey],['Reviewer',candidate?.reviewer ?? published?.reviewer ?? 'Retained in history']].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <p>{source.run.diagnostic}</p>
      </details>
      <details open><summary>Compare revisions</summary>
        <div className="source-ops-comparison" role="table" aria-label="Published and candidate revision comparison">
          <div role="row"><span role="columnheader">Field</span><span role="columnheader">Published</span><span role="columnheader">Candidate</span></div>
          {comparison.map(([label,before,after]) => <div role="row" key={label}><strong role="rowheader">{label}</strong><span role="cell">{before ?? 'Unavailable'}</span><span role="cell" data-changed={!!after && before !== after}>{after ?? 'Not supplied'}</span></div>)}
        </div>
        {!!candidate?.failures.length && <ul className="source-ops-failures">{candidate.failures.map(failure => <li key={failure}>{failure}</li>)}</ul>}
      </details>
      <details><summary>Translation and supported coverage</summary><p>{copy.translations}</p><p>English: {published ? `${published.id}, published` : 'No active publication'}. Spanish: {(candidate ?? published)?.translation ?? 'No active version'}{candidate?.translation === 'approved' ? ` for ${candidate.id}, awaiting matching publication` : published?.translation === 'approved' ? ` for ${published.id}` : ''}.</p><p>{source.coverage}. No other geography or language is claimed by these records.</p></details>
      <label>{copy.reason}<textarea value={reason} maxLength={500} rows={3} disabled={pending || !!review || !!uncertain} onChange={event => setReason(event.target.value.replace(/\u2014/g, ','))} placeholder="What was checked, and why is this decision appropriate?" /></label>
      <div className="source-ops-actions" role="group" aria-label="Source decisions">
        {(Object.keys(decisions) as SourceDecision[]).map(decision => <button type="button" key={decision} disabled={pending || !!review || !!uncertain || role === 'viewer'} onClick={() => prepare(decision)}>{decisions[decision]}</button>)}
      </div>
      <button type="button" className="source-ops-fixture-change" onClick={simulateRevision}>Simulate a newer source revision</button>
      {review && <section className="source-ops-confirm" role="region" aria-label="Source decision review">
        <h3>{decisions[review.decision]}</h3><p>{source.name} · {review.target} · source revision {review.sourceRevision}</p><small>Operation {review.requestId}</small>
        <p>{review.reason}</p>
        {review.decision === 'retry' ? <p>{copy.retryScope}</p> : <p>{review.decision === 'publish' ? 'New recommendations would use this reviewed version. Linked saved work would be flagged for review through a separate deduplicated notification intent.' : review.decision === 'withdraw' ? 'This publication stops supplying new recommendations. Existing linked work needs a source-withdrawn notice, not silent deletion or completion.' : 'Only the selected source revision changes. Publication remains a separate publisher decision.'}</p>}
        <p>{copy.preserved}</p>
        {uncertain ? <button type="button" onClick={inspectStatus}>Check operation status</button> : <div className="source-ops-actions"><button type="button" onClick={confirm} disabled={pending}>{pending ? copy.pending : 'Confirm decision'}</button><button type="button" onClick={cancel}>{pending ? 'Cancel pending decision' : 'Cancel decision'}</button></div>}
      </section>}
      <details><summary>Retained versions and audit history</summary><ul>{source.versions.map(item => <li key={item.id}>{item.id} · {item.status} · {item.reviewer} · {sourceEvidenceLabels[item.evidence]}</li>)}</ul>{source.audit.length ? <ol>{source.audit.map(item => <li key={item.requestId}>{decisions[item.decision]} · {item.target} · revision {item.revision} · {item.role} · {item.recordedAt}<p>{item.reason}</p></li>)}</ol> : <p>No decisions recorded.</p>}</details>
      {notice && <p className="source-ops-notice" role="status">{notice}</p>}
    </section>}
  </details>;
}
