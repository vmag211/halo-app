'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import MapCanvas, { type MapPoint } from '@/components/map-preview/MapCanvas';
import { airStations, facilities, waterFeatures, waterSeverity, type MapLayer } from '@/lib/frontend/map-preview';
import { radonPoints } from '@/lib/frontend/map-radon-fixture';
import { useHomeDraft } from '@/components/homeguard/HomeWorkspaceState';
import {useProductionResource} from '@/components/production/ProductionContext';
import {parseMapLayer} from '@/lib/frontend/map-service';

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
  const source=useProductionResource<unknown>('map.layer',{layer});
  const data=useMemo(()=>{if(!source.data)return null;try{return parseMapLayer(source.data,layer,true);}catch{return null;}},[source.data,layer]);
  const points:MapPoint[]=!source.production?previewPoints(layer):!data?[]:layer==='water'?data.water.flatMap(item=>item.lat===null||item.lng===null?[]:[{id:item.pwsid,name:item.name,lat:item.lat,lng:item.lng,population:item.population,severity:waterSeverity(item,'overall')}]):layer==='radon'?data.radon.flatMap(item=>{const center=radonPoints.find(p=>p.name===item.name),lat=item.lat??center?.lat,lng=item.lng??center?.lng;return lat===undefined||lng===undefined?[]:[{...item,lat,lng}];}):(layer==='air'?data.air:data.facilities).flatMap(item=>item.lat===null||item.lng===null?[]:[{...item,lat:item.lat,lng:item.lng}]);
  const unavailable=Boolean(source.error||source.production&&!source.loading&&!data);
  return <section className="ex-mini-map" aria-label="Map preview">
    <div className="ex-map-preview-head"><h3>Explore the map</h3><label className="ex-map-preview-layer"><span className="halo-sr">Preview map layer</span><select value={layer} onChange={event => setLayer(event.target.value as MapLayer)}>{(['water', 'air', 'radon', 'facilities'] as MapLayer[]).map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label></div>
    <Link href={mapHref(layer)} prefetch={false} className="ex-map-entry" aria-label={`Explore the map: open the full ${layer} map`}>
      <div className="ex-mini-map-canvas" aria-hidden="true" inert data-map-preview-state={failed||unavailable ? 'unavailable' : source.loading||!ready ? 'loading' : 'ready'}>{!failed ? <MapCanvas previewOnly layer={layer} points={points} selectedId={null} home={null} view={{ lng: -80.35, lat: 35.16, zoom: 7.5 }} onViewChange={noInteraction} onSelect={noInteraction} onReady={setReady} onUnavailable={() => setFailed(true)} patterns={false} /> : <span className="ex-map-preview-fallback">Map preview unavailable. Open the full map or its accessible record list.</span>}<span className="ex-map-open-label">Open map <ArrowUpRight size={16} aria-hidden="true" /></span></div>
      <p className="ex-map-layer-description">{source.loading?'Loading this layer…':unavailable?'This layer is unavailable. Open the map to try again.':source.production&&!points.length?'No mapped records in this layer right now. Open the map for its source note.':descriptions[layer]}</p>
    </Link>
    <div className="ex-map-preview-foot"><small>North Carolina atlas</small><details className="ex-map-attribution"><summary>Map sources</summary><p>Geography: Census and Natural Earth.</p><a href="https://www.census.gov/geographies/mapping-files.html" target="_blank" rel="noreferrer">Census</a> · <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a></details></div>
  </section>;
}
