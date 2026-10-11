'use client';

import { Info } from 'lucide-react';
import type { MapPoint } from './MapCanvas';
import MapSymbol from './MapSymbol';
import { compounds, quarterLabel, readingDate, type Compound, type MapLayer, type WaterFeature } from '@/lib/frontend/map-preview';

const descriptions = {
  water: { unit: 'systems', focus: 'over limit', caution: 'System samples, not tap readings.', next: 'Open a system to compare compounds, dates, and supplied limits.' },
  facilities: { unit: 'facilities', focus: 'in violation', caution: 'Compliance records, not exposure.', next: 'Open a facility to review the reported programs and inspection date.' },
  air: { unit: 'monitors', focus: 'elevated or higher', caution: 'Readings are at monitors only.', next: 'Compare the observation times before comparing station readings.' },
  radon: { unit: 'counties', focus: 'Zone 1 or 2', caution: 'Regional potential, not a home test.', next: 'Select your county to understand the zone and its limitations.' },
};
const levels = ['good', 'moderate', 'elevated', 'high', 'severe', 'no_data'];
export function summarizePoints(points: MapPoint[], layer: MapLayer) {
  const flagged = points.filter(p => layer === 'water' || layer === 'facilities' ? p.flagged : layer === 'radon' ? (p.zone ?? 3) < 3 : ['elevated', 'high', 'severe'].includes(p.severity)).length;
  const missing = points.filter(p => p.severity === 'no_data').length;
  return { count: points.length, flagged, missing, groups: levels.map(severity => ({ severity, count: points.filter(p => p.severity === severity).length })) };
}

export function MapInsightCard({ points, layer, onOpen, loading }: { points: MapPoint[]; layer: MapLayer; onOpen: () => void; loading: boolean }) {
  const info = summarizePoints(points, layer), copy = descriptions[layer];
  return <button className="halo-map-insight" onClick={onOpen} aria-label="Open area brief" disabled={loading}>
    <span className="halo-map-insight-heading"><span>IN THIS VIEW</span><span>Area brief <Info size={14}/></span></span>
    <span className="halo-map-insight-numbers">{loading ? 'Updating the view…' : <><strong>{info.count}</strong> {copy.unit}<i/><strong>{info.flagged}</strong> {copy.focus}</>}</span>
    <span className="halo-map-insight-note">{copy.caution}</span>
  </button>;
}

export function MapKey({ layer, patterns, onOpen }: { layer: MapLayer; patterns: boolean; onOpen: () => void }) {
  const density = patterns && ['water', 'facilities'].includes(layer);
  const categories = layer === 'radon' ? [['good','Zone 3'],['elevated','Zone 2'],['high','Zone 1']] : layer === 'facilities' ? [['good','No violation'],['elevated','Violation'],['high','Significant'],['no_data','Unknown']] : [['good','Good'],['moderate','Moderate'],['elevated','Elevated'],['high','High'],['severe','Severe'],['no_data',layer === 'water' ? 'Not comparable' : 'No data']];
  return <button className="halo-map-key" onClick={onOpen} aria-label="Legend">
    <span className="halo-map-key-records"><span className="halo-map-key-title">{layer === 'radon' ? 'County radon potential' : layer === 'air' ? 'Monitor AQI categories' : layer === 'facilities' ? 'Reported compliance' : 'System result categories'}<Info size={14}/></span>
      <span className="halo-map-key-categories">{categories.map(([severity,label])=><span key={severity}><MapSymbol layer={layer} severity={severity}/>{label}</span>)}</span>
      <span className="halo-map-key-footnote">{layer === 'water' ? 'Larger water symbols serve more people. An exclamation marks an over-limit result.' : layer === 'facilities' ? 'Building groups contain multiple sites. An exclamation marks a violation.' : layer === 'air' ? 'Wind symbols locate monitors. Numbers are AQI, not wind speed.' : 'Zone 1 has the highest regional potential. Your home needs its own test.'}</span>
    </span>
    {density && <span className="halo-map-key-density"><span className="halo-map-key-title">{layer === 'water' ? 'Over-limit system density' : 'Noncompliance record density'}</span><span className="halo-map-key-scale" data-density="true" aria-hidden="true"/><span className="halo-map-key-labels"><span>Sparse</span><span>Clustered</span></span><span className="halo-map-key-footnote">Record density, not concentration or exposure.</span></span>}
  </button>;
}

export function AreaBrief({ points, allPoints, layer, compound, quarter, water, hasHome, onSelect, banner }: { points: MapPoint[]; allPoints: MapPoint[]; layer: MapLayer; compound: Compound; quarter: string; water: WaterFeature[]; hasHome: boolean; onSelect: (id: string) => void; banner: string | null }) {
  const info = summarizePoints(points, layer), copy = descriptions[layer];
  const dates = water.flatMap(w => w.latest_sample_iso ? [w.latest_sample_iso] : []).sort();
  const own = water.find(w => w.pwsid === 'SAMPLE-01');
  return <div className="halo-map-brief">
    <section className="halo-map-brief-lead"><span className="halo-map-eyebrow">{layer === 'water' ? `${compounds.find(c => c[0] === compound)?.[1]} · ${quarterLabel(quarter)}` : `${layer[0].toUpperCase() + layer.slice(1)} · Current map window`}</span><h3>Read the pattern.<br/>Check the evidence.</h3><p>{copy.caution} These summaries describe the sample records currently mapped in view.</p></section>
    <dl className="halo-map-brief-metrics"><div><dd>{info.count}</dd><dt>{copy.unit} in view</dt></div><div><dd>{info.flagged}</dd><dt>{copy.focus}</dt></div><div><dd>{info.missing}</dd><dt>{layer === 'water' ? 'without a comparable result' : 'without a category'}</dt></div></dl>
    <section className="halo-map-distribution"><h4>How the records are distributed</h4><div className="halo-map-distribution-bar" aria-hidden="true">{info.groups.filter(g => g.count > 0).map(g => <span key={g.severity} data-level={g.severity} style={{flex:g.count}}/>)}</div><ul>{info.groups.filter(g => g.count > 0).map(g => <li key={g.severity}><span data-level={g.severity}/>{layer === 'radon' ? ({good:'Zone 3',elevated:'Zone 2',high:'Zone 1'}[g.severity] ?? 'Unknown') : g.severity === 'no_data' ? 'Not comparable / unknown' : g.severity[0].toUpperCase() + g.severity.slice(1)}<strong>{g.count}</strong></li>)}</ul>{!info.count&&<p>No records are in this view. Zoom out to explore the layer.</p>}</section>
    {layer === 'water' && <section className="halo-map-brief-context"><h4>Coverage before conclusions</h4><p>{allPoints.length} of {water.length} returned systems have a map location. {water.length - allPoints.length} are available only in the list.</p>{dates.length > 0 && <p>Returned sample dates: {dates[0] === dates.at(-1) ? readingDate(dates[0]) : `${readingDate(dates[0])} to ${readingDate(dates.at(-1))}`}.</p>}<p>The heat layer uses equal-weight locations of systems above a supplied comparison limit. Its 35 km smoothing radius is a display choice, not a service area or pollution boundary. Color uses a fixed scale so panning does not change its meaning.</p></section>}
    {layer === 'facilities' && <section className="halo-map-brief-context"><h4>What the warm areas mean</h4><p>These are concentrations of mapped facilities with a reported violation. Each facility has equal weight with a 35 km display radius. This selected NC-08 dataset does not cover every facility, and it does not show a plume.</p></section>}
    {layer === 'air' && <section className="halo-map-brief-context"><h4>Separate places, separate times</h4><p>Each wind symbol is one monitor, not a wind direction or coverage area. No air-quality values are estimated between stations.</p></section>}
    {layer === 'radon' && <section className="halo-map-brief-context"><h4>A regional starting point</h4><p>County color comes from the supplied zone, not the number of nearby tests. Neighboring homes can differ even inside one county.</p></section>}
    {hasHome && layer === 'water' && own && <section className="halo-map-home-context"><span className="halo-map-eyebrow">Your sample system</span><h4>{own.name}</h4><p>Its record belongs to your selected system, not whichever marker is closest on the map.</p><button onClick={() => onSelect(own.pwsid)}>Review your system</button></section>}
    {banner && <p className="halo-map-brief-context">{banner}{layer === 'water' && '. 1st means the lowest share of people served by over-limit systems. This county rank is separate from the map-window counts.'}</p>}
    <footer><h4>A useful next step</h4><p>{copy.next}</p><p>Preview observations are fictional. No household risk or new score is calculated here.</p></footer>
  </div>;
}
