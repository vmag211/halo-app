'use client';

import { useEffect, useRef, useState } from 'react';
import SeverityPill from '@/components/ui/SeverityPill';
import { findMapRecords, type MapResult } from '@/lib/frontend/map-tools';
import type { MapLayer } from '@/lib/frontend/map-preview';
import MapSymbol from './MapSymbol';

export default function MapResults({ records, layer, visibleIds, home, query, onQuery, onSelect, blocked, loading, focusSearch = false, onSearchFocused }: {
  records: MapResult[]; layer: MapLayer; visibleIds: string[]; home: { lat: number; lng: number } | null;
  query: string; onQuery: (query: string) => void; onSelect: (id: string) => void; blocked: boolean; loading: boolean;
  /** Opened from Find a location: start in the search field rather than on the sheet's Close. */
  focusSearch?: boolean; onSearchFocused?: () => void;
}) {
  const search = useRef<HTMLInputElement>(null);
  // After the sheet's showModal (a parent effect) has placed its own initial focus.
  useEffect(() => { if (!focusSearch) return; const frame = requestAnimationFrame(() => { search.current?.focus({ preventScroll: true }); onSearchFocused?.(); }); return () => cancelAnimationFrame(frame); }, [focusSearch, onSearchFocused]);
  const [scope,setScope] = useState('all');
  const [sort,setSort] = useState('name');
  const canSortNearby = home && layer !== 'radon';
  const matches = findMapRecords(records, query, scope === 'view' ? visibleIds : null, sort === 'nearest' && canSortNearby ? home : null);
  return <div className="halo-map-results">
    <label>Find a location in this layer<input ref={search} type="search" value={query} onChange={e=>onQuery(e.target.value)} placeholder={layer==='radon'?'County name':'Name or system ID'}/></label>
    <div className="halo-map-results-tools">
      <div role="group" aria-label="Results area">{[['all','All records'],['view','In this view']].map(([key,label])=><button key={key} aria-pressed={scope===key} onClick={()=>setScope(key)}>{label}</button>)}</div>
      <label>Sort results<select aria-label="Sort results" value={sort} onChange={e=>setSort(e.target.value)}><option value="name">Name</option>{canSortNearby&&<option value="nearest">Nearest my home</option>}</select></label>
    </div>
    <p>{layer==='water'?'Includes unmapped systems. Records cover the state.':'This list is an alternative to selecting markers on the map.'} {scope==='view'&&'Only records in the current map window are shown.'}</p>
    {sort==='nearest'&&canSortNearby&&<p className="halo-map-results-caution">Straight-line distance from your approximate home. Nearby utilities may not supply your water. Unmapped records appear last.</p>}
    {blocked?<p role="status">No saved results for this layer.</p>:loading?<p role="status">Loading locations for this layer.</p>:<>
      <p role="status" className="halo-map-results-count">{matches.length} {matches.length===1?'record':'records'}{query.trim()?` matching “${query.trim()}”`:''}</p>
      {matches.map(p=><button key={p.id} className="halo-map-result" onClick={()=>onSelect(p.id)}>
        <MapSymbol layer={layer} severity={p.severity}/><span><strong>{p.name}</strong><small>{p.sub}{p.distance!==null&&` · ${p.distance.toFixed(1)} mi`}</small><span className="halo-map-result-reading">{p.reading}</span></span><SeverityPill severity={p.severity}/>
      </button>)}
      {!matches.length&&<div className="halo-map-results-empty"><p role="status">No matching locations. {scope==='view'?'Try all records or zoom out.':'Try a different name.'}</p><button onClick={()=>{onQuery('');setScope('all');}}>Show all records</button></div>}
    </>}
  </div>;
}
