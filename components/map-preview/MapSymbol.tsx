import { mapSymbols } from '@/lib/frontend/map-symbols';
import type { MapLayer } from '@/lib/frontend/map-preview';

export default function MapSymbol({ layer, severity }: { layer: MapLayer; severity: string }) {
  const symbol = mapSymbols[layer];
  return <svg className="halo-map-symbol" data-severity={severity} data-layer={layer} viewBox="0 0 24 24" aria-hidden="true">
    {symbol.body && <path d={symbol.body} className="halo-map-symbol-body"/>}
    {symbol.detail && <path d={symbol.detail} className="halo-map-symbol-detail"/>}
    {severity === 'no_data' && <path d="M5 20 19 6" className="halo-map-symbol-missing"/>}
  </svg>;
}
