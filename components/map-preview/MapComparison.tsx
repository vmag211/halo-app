'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowLeftRight, Check, Search, X } from 'lucide-react';
import { mapComparisonCopy as c } from '@/lib/frontend/copy/map-comparison';
import { comparisonDisplay, comparisonObserved, comparisonRows, reviewComparisonRecord, type ComparisonCase, type PublicComparisonRecord } from '@/lib/frontend/map-comparison-preview';
import { compounds, type Compound } from '@/lib/frontend/map-preview';

export default function MapComparison({ records, firstId, secondId, compound, latest, scenario, blocked, offline, loading, onSelect, onCompound, onBack, onClear, onRetry }: {
  records: PublicComparisonRecord[]; firstId: string; secondId?: string; compound: Compound;
  latest: boolean; scenario: ComparisonCase; blocked: boolean; offline: boolean; loading: boolean;
  onSelect: (first: string, second?: string) => void; onCompound: (compound: Compound) => void;
  onBack: () => void; onClear: () => void; onRetry: () => void;
}) {
  const [query, setQuery] = useState('');
  const [replacing, setReplacing] = useState<'first' | 'second' | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const first = records.find(record => record.id === firstId);
  const rawSecond = records.find(record => record.id === secondId);
  const second = rawSecond ? reviewComparisonRecord(rawSecond, scenario) : undefined;
  const previousFirst = useRef(firstId);
  const previousSecond = useRef(secondId);
  const previousReplacing = useRef(replacing);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (secondId && (previousFirst.current !== firstId || previousSecond.current !== secondId || previousReplacing.current && !replacing)) resultHeading.current?.focus({ preventScroll: true });
    if (previousSecond.current && !secondId) search.current?.focus({ preventScroll: true });
    previousFirst.current = firstId;
    previousSecond.current = secondId;
    previousReplacing.current = replacing;
  }, [firstId, secondId, replacing]);
  useEffect(() => { if (replacing) search.current?.focus({ preventScroll: true }); }, [replacing]);
  const choices = records.filter(record => record.id !== (replacing === 'first' ? secondId : firstId)
    && query.trim().toLocaleLowerCase('en-US').split(/\s+/).every(term => `${record.id} ${record.name}`.toLocaleLowerCase('en-US').includes(term)));
  const isWater = first?.scope === c.scopeWater;
  function choose(id: string) {
    if (replacing === 'first') onSelect(id, secondId); else onSelect(firstId, id);
    setReplacing(null); setQuery(''); setAnnouncement('');
  }
  const state = loading || scenario === 'loading' ? 'loading' : blocked ? 'blocked' : scenario === 'error' ? 'error' : 'ready';
  return <section className="halo-map-record-compare" aria-label={c.title}>
    <div className="halo-map-comparison-actions"><button onClick={onBack}><ArrowLeft size={17}/>{c.back}</button><button onClick={onClear}>{c.clear}</button></div>
    {state !== 'ready' ? <div role={state === 'loading' ? 'status' : 'alert'} className="halo-map-comparison-state">
      {state === 'loading' && <span className="halo-spinner" aria-hidden="true"/>}
      <p>{state === 'loading' ? c.loading : state === 'blocked' ? c.blocked : c.failed}</p>
      {state !== 'loading' && !offline && <button onClick={onRetry}>{c.retry}</button>}
    </div> : !first ? <div role="status"><p>{c.selectionMissing}</p><p>{records.length ? c.chooseFirst : c.unsupported}</p></div> : <>
      {offline && <p className="halo-map-comparison-note">{c.cached}</p>}
      <details className="halo-map-comparison-change" open={!second||!!replacing}><summary hidden={!second||!!replacing}>{c.change}</summary><div className="halo-map-comparison-selection">
        <div><span>{c.first}</span><strong>{first.name}</strong><button aria-label={`${c.replace} ${c.first.toLowerCase()}`} onClick={() => { setReplacing('first'); setQuery(''); }}><ArrowLeftRight size={15}/>{c.replace}</button></div>
        <div><span>{c.second}</span><strong>{second?.name ?? c.choose}</strong>{second && <div className="halo-map-comparison-actions"><button aria-label={`${c.replace} ${c.second.toLowerCase()}`} onClick={() => { setReplacing('second'); setQuery(''); }}><ArrowLeftRight size={15}/>{c.replace}</button><button aria-label={`${c.remove} ${c.second.toLowerCase()}`} onClick={() => { onSelect(firstId); setReplacing(null); setQuery(''); }}><X size={15}/>{c.remove}</button></div>}</div>
      </div></details>
      {(replacing || !second) ? <div className="halo-map-comparison-picker">
        {secondId && !second && <p role="status">{c.selectionMissing}</p>}
        <label><Search size={17}/><span className="halo-sr">{c.search}</span><input ref={search} type="search" value={query} placeholder={c.search} onChange={event => setQuery(event.target.value)}/></label>
        {replacing && second && <button className="halo-map-comparison-cancel" onClick={() => { setReplacing(null); setQuery(''); setAnnouncement(c.cancelled); }}>{c.cancel}</button>}
        {choices.length ? <ul>{choices.map(record => <li key={record.id}><button onClick={() => choose(record.id)}><span><strong>{record.name}</strong><small>{record.id}</small></span><span aria-hidden="true">+</span></button></li>)}</ul> : <div role="status"><p>{query ? c.noMatches : c.empty}</p>{query && <button onClick={() => setQuery('')}>{c.resetSearch}</button>}</div>}
      </div> : <div className="halo-map-comparison-evidence">
        <h3 className="halo-sr" ref={resultHeading} tabIndex={-1}>{c.basis}</h3>
        {isWater && <label className="halo-map-comparison-compound">{c.compound}<select value={compound} onChange={event => onCompound(event.target.value as Compound)}>{compounds.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>}
        <p className="halo-map-comparison-note">{latest && c.latest} {Array.from(new Set([first.coverageLabel,second.coverageLabel])).join(' ')}</p>
        {comparisonRows(first, second, compound).map(row => <section key={row.analyte} className="halo-map-comparison-row" data-compatible={row.compatible} aria-label={row.analyte}>
          <h4>{row.analyte}<span>{row.compatible ? <><Check size={14}/>{row.warnings.length ? c.limited : c.matched}</> : c.unavailable}</span></h4>
          {row.warnings.filter(warning=>warning===c.dateDifference).map(warning=><p className="halo-map-comparison-note" key={warning}>{warning}</p>)}
          <dl>{[{item:first,observation:row.first},{item:second,observation:row.second}].map(({item,observation}, index) => {
            return <div key={item.id}><dt><span className="halo-map-comparison-letter" aria-hidden="true">{index === 0 ? 'A' : 'B'}</span>{item.name}</dt>
              <dd><strong>{item.status === 'withdrawn' ? c.withdrawn : comparisonDisplay(observation)}</strong>{observation?.analyte !== row.analyte && <small>{observation?.analyte}</small>}<small>{c.date}: {comparisonObserved(observation)}</small><small>{c.period}: {observation?.periodLabel ?? c.unknown}</small></dd></div>;
          })}</dl>
          {row.reasons.length > 0 && <ul className="halo-map-comparison-reasons">{row.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
        </section>)}
        <p className="halo-map-comparison-note">{isWater ? c.waterLimit : c.airLimit} {c.noDifference}</p>
        <details className="halo-map-comparison-sources"><summary>{c.source}</summary>{[first, second].map(record => <section key={record.id}><h4>{record.name}</h4><dl>
          <div><dt>{c.provenance}</dt><dd>{record.kind}</dd></div><div><dt>{c.scope}</dt><dd>{record.scope}</dd></div>
          <div><dt>{c.coverage}</dt><dd>{record.coverageLabel}</dd></div><div><dt>{c.basis}</dt><dd>{record.denominator ?? c.unknown}</dd></div>
          <div><dt>{c.release}</dt><dd>{record.sourceVersion ?? c.unknown}</dd></div><div><dt>{c.method}</dt><dd>{record.values.find(value => value.value !== null)?.method ?? c.unknown}</dd></div>
        </dl><p>{record.sourceUrl ? record.sourceName : c.sourceUnavailable}</p><a href={record.sourceUrl ?? record.backgroundUrl} target="_blank" rel="noreferrer">{record.sourceUrl ? record.sourceName : c.background}</a></section>)}</details>
      </div>}
      <p className="halo-map-comparison-note">{c.publicOnly}</p>
    </>}
    <span className="halo-sr" role="status">{announcement}</span>
  </section>;
}
