'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowUpRight, Droplets, Factory, Mountain, Wind } from 'lucide-react';
import MapCanvas, { type MapPoint } from '@/components/map-preview/MapCanvas';
import { airStations, facilities, waterFeatures, type MapLayer } from '@/lib/frontend/map-preview';
import { radonPoints } from '@/lib/frontend/map-radon-fixture';
import { useHomeDraft } from '@/components/homeguard/HomeWorkspaceState';

const icons = { water: Droplets, air: Wind, radon: Mountain, facilities: Factory };
const descriptions = { water: 'Public water systems and dated sample records.', air: 'Air monitor locations and their observation context.', radon: 'County potential, not a home radon measurement.', facilities: 'Public facility records, not proof of household exposure.' };
const noInteraction = () => {};
function previewPoints(layer: MapLayer): MapPoint[] {
  if (layer === 'water') return waterFeatures().flatMap(item => item.lat === null || item.lng === null ? [] : [{ id: item.pwsid, name: item.name, lat: item.lat, lng: item.lng, population: item.population, severity: item.overall_severity }]);
  if (layer === 'air') return airStations.map(item => ({ ...item }));
  if (layer === 'facilities') return facilities.map(item => ({ ...item }));
  return radonPoints;
}

export default function ExploreMapPreview({ mapHref }: { mapHref: (layer: string) => string }) {
  const [layer, setLayer] = useHomeDraft<MapLayer>('explore:map-layer', 'water'); const [failed, setFailed] = useState(false); const [ready, setReady] = useState(false);
  return <section className="ex-mini-map" aria-label="Map preview">
    <div className="ex-mini-map-heading"><span className="ex-kicker">Explore your area</span><h3>A closer look at the bigger picture.</h3></div>
    <div className="ex-mini-map-tabs" role="group" aria-label="Preview map layer">{(['water', 'air', 'radon', 'facilities'] as MapLayer[]).map(value => { const Icon = icons[value]; return <button key={value} aria-pressed={layer === value} onClick={() => setLayer(value)}><Icon size={16} aria-hidden="true" />{value[0].toUpperCase() + value.slice(1)}</button>; })}</div>
    <Link href={mapHref(layer)} prefetch={false} className="ex-map-entry" aria-label={`Explore the map: open the full ${layer} map`}>
      <div className="ex-mini-map-canvas" aria-hidden="true" inert data-map-preview-state={failed ? 'unavailable' : ready ? 'ready' : 'loading'}>{!failed ? <MapCanvas previewOnly layer={layer} points={previewPoints(layer)} selectedId={null} home={null} view={{ lng: -80.35, lat: 35.16, zoom: 7.5 }} onViewChange={noInteraction} onSelect={noInteraction} onReady={setReady} onUnavailable={() => setFailed(true)} patterns={false} /> : <span className="ex-map-preview-fallback">Map preview unavailable. Open the full map or its accessible record list.</span>}<span className="ex-map-open-label">Open full map <ArrowUpRight size={16} aria-hidden="true" /></span></div>
      <div className="ex-map-copy"><p>{descriptions[layer]}</p><span className="ex-link-label">Explore the map <ArrowUpRight size={17} aria-hidden="true" /></span></div>
    </Link>
    <small>North Carolina sample atlas. Real Census boundaries, fictional readings. Not matched to your chosen area. No private home pin. Full-map controls and record lists open on the next screen.</small>
    <div className="ex-map-attribution"><a href="https://www.census.gov/geographies/mapping-files.html" target="_blank" rel="noreferrer">Census</a> · <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a></div>
  </section>;
}
