'use client';
import DateInput from '@/components/ui/DateInput';

import { useState } from 'react';
import { ArrowRight, Check, Clock3, Flag } from 'lucide-react';
import { useHomeCollection, useHomeDraft, useHomeWorkspace } from '@/components/homeguard/HomeWorkspaceState';
import { blankOutcome, noOutcomes, outcomeError, type OutcomeRecord } from '@/lib/frontend/explore-workspace';
import { SaveExplore, ShareTools } from './ExploreShared';

/** Reusable record engine; each feature supplies its own goal, meaning and next routes. */
export default function ExploreOutcome({ origin, title, goal, mechanism, compact = false }: { origin: string; title: string; goal: string; mechanism: string; compact?: boolean }) {
  const workspace = useHomeWorkspace();
  const collection = useHomeCollection<OutcomeRecord>('exploreOutcomes', noOutcomes);
  const record = collection.records.find(item => item.id === origin);
  const [draft, setDraft, clear] = useHomeDraft(`explore:outcome:${origin}`, record ?? blankOutcome(origin, title, goal));
  const [editing, setEditing] = useState(false); const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const current = record ?? draft;
  const text = `${current.title}\nGoal: ${current.goal}\nStatus, reported by me: ${current.status}\n${current.date ? `Update date: ${current.date}\n` : ''}${current.result ? `Result I recorded: ${current.result}\n` : ''}${current.reference ? `My reference: ${current.reference}\n` : ''}${current.nextStep ? `Next step: ${current.nextStep}\n` : ''}This is my personal record, not independent confirmation of an environmental change.`;
  return <section className={`ex-outcome-workspace${compact ? ' ex-outcome-compact' : ''}`} aria-label={`${title} follow-through`}>
    <header><Flag size={20} aria-hidden="true" /><div><h4>{title}</h4><p>{mechanism}</p></div></header>
    <div className="ex-outcome-status"><span>{current.status === 'Result recorded' ? <Check size={17} aria-hidden="true" /> : <Clock3 size={17} aria-hidden="true" />}{record ? current.status : 'Choose a result to work toward'}</span><small>Recorded by you, not independently verified</small></div>
    <p><strong>What you want to achieve</strong><br />{current.goal}</p>
    {record?.result && <div className="ex-recorded-result"><small>Your recorded result{record.date ? ` · ${record.date}` : ''}</small><p>{record.result}</p>{record.reference && <small>Reference: {record.reference}</small>}</div>}
    {!editing ? <button className="ex-text-button" disabled={workspace.pending || workspace.scenario === 'offline'} onClick={() => { setDraft(record ?? draft); setEditing(true); setError(''); }}>{record ? 'Record an update' : 'Set my goal and next step'} <ArrowRight size={16} aria-hidden="true" /></button> : <form className="ex-form" onSubmit={async event => {
      event.preventDefault(); const invalid = outcomeError(draft); setError(invalid ?? ''); if (invalid) return;
      const history = [...(record?.history ?? []), { status: draft.status, date: draft.date, result: draft.result }];
      if (await collection.save({ ...draft, history })) { clear(); setEditing(false); }
    }}><fieldset className="ex-note-fields" disabled={workspace.pending}><label>Answer or result I want<textarea maxLength={500} value={draft.goal} onChange={event => setDraft({ ...draft, goal: event.target.value })} /></label><label>Where things stand<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as OutcomeRecord['status'] })}>{['Open', 'Working on it', 'Waiting for a response', 'Result recorded', 'Closed without a result'].map(value => <option key={value}>{value}</option>)}</select></label><label>Update date<DateInput value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} /></label><label>What actually happened<textarea maxLength={2000} placeholder="For example, I received the dated water report and reviewed its coverage." value={draft.result} onChange={event => setDraft({ ...draft, result: event.target.value })} /></label><label>Reference or reply identifier (optional)<input maxLength={160} value={draft.reference} onChange={event => setDraft({ ...draft, reference: event.target.value })} /></label><label>My next step<textarea maxLength={1000} value={draft.nextStep} onChange={event => setDraft({ ...draft, nextStep: event.target.value })} /></label><label>Check-back date (optional)<DateInput value={draft.followupDate} onChange={event => setDraft({ ...draft, followupDate: event.target.value })} /></label></fieldset>{error && <p role="alert">{error}</p>}<button className="ex-button" disabled={workspace.pending || workspace.scenario === 'offline'}>Save my update</button><button className="ex-text-button" type="button" onClick={() => setEditing(false)}>Keep draft for later</button></form>}
    {record && <><p className="ex-next-step"><strong>Next step</strong>{record.nextStep || 'Choose what to do with the information you have.'}</p><SaveExplore origin={`followthrough:${origin}`} title={record.nextStep || `Check back: ${title}`} reason="Follow up on my own recorded goal. A saved task does not change evidence, contact an office or prove a result." date={record.followupDate || undefined} /><details className="ex-disclosure"><summary>My update history</summary><ol className="ex-activity-history">{record.history.map((item, index) => <li key={index}><strong>{item.status}</strong><small>{item.date || 'No date supplied'}</small>{item.result && <p>{item.result}</p>}</li>)}</ol></details><button className="ex-text-button" onClick={() => setExporting(!exporting)}>{exporting ? 'Close record export' : 'Review my record for export'}</button>{exporting && <div className="ex-share-preview"><pre>{text}</pre><ShareTools text={text} filename="halo-community-follow-through.txt" /></div>}</>}
    <p className="ex-meta">A completed task or recorded reply is useful progress. It does not prove pollution was reduced or a health outcome changed. </p>
  </section>;
}
