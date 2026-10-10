'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import './map-canvas.css';

export type MapLayer = 'water' | 'radon' | 'facilities' | 'air';
export type MapPoint = { id: string; name: string; lat: number; lng: number; severity: string; population?: number | null; zone?: number; isOwn?: boolean; flagged?: boolean };
export type MapView = { lng: number; lat: number; zoom: number };
type Coordinate = [number, number];
type Geometry = { type: 'Polygon'; coordinates: Coordinate[][] } | { type: 'MultiPolygon'; coordinates: Coordinate[][][] };
type County = { name: string; geoid: string; geometry: Geometry; center: Coordinate };
type Geography = { source: string; retrieved: string; district_source: string; district_retrieved: string; counties: County[]; district: County };
type CartographicContext = { rivers: {name:string;coordinates:Coordinate[]}[];places:{name:string;coordinates:Coordinate;rank:number}[] };
type Hit = { id: string; name: string; x: number; y: number; cluster?: MapPoint[] };
type Props = {
  layer: MapLayer; points: MapPoint[]; selectedId: string | null;
  home: { lat: number; lng: number } | null; view: MapView;
  onViewChange: (view: MapView) => void; onSelect: (id: string) => void;
  onReady?: (ready: boolean) => void; onUnavailable?: () => void;
  onVisibleCountChange?: (count: number) => void; forceEmpty?: boolean;
  patterns?: boolean; onVisibleIdsChange?: (ids: string[]) => void; previewOnly?: boolean;
};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const bound = (view: MapView): MapView => ({ lng: clamp(view.lng, -84.6, -75), lat: clamp(view.lat, 33.6, 36.8), zoom: clamp(view.zoom, 6, 12) });
const world = (lng: number, lat: number): Coordinate => {
  const sine = Math.sin(clamp(lat, -85, 85) * Math.PI / 180);
  return [(lng + 180) / 360, .5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)];
};
const earth = (x: number, y: number): Coordinate => [(x * 360) - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI];
const shifted = (view: MapView, dx: number, dy: number): MapView => {
  const [x, y] = world(view.lng, view.lat), scale = 256 * 2 ** view.zoom;
  const [lng, lat] = earth(x - dx / scale, y - dy / scale);
  return bound({ ...view, lng, lat });
};
function trace(geometry: Geometry, project: (lng: number, lat: number) => Coordinate) {
  const path = new Path2D();
  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  polygons.forEach(polygon => polygon.forEach(ring => {
    ring.forEach(([lng, lat], index) => {
      const [x, y] = project(lng, lat);
      bounds.left = Math.min(bounds.left, x); bounds.right = Math.max(bounds.right, x);
      bounds.top = Math.min(bounds.top, y); bounds.bottom = Math.max(bounds.bottom, y);
      if (index === 0) path.moveTo(x, y); else path.lineTo(x, y);
    });
    path.closePath();
  }));
  return { path, bounds };
}
const priorityCounties = new Set(['Union County', 'Mecklenburg County', 'Cabarrus County', 'Stanly County', 'Anson County', 'Richmond County', 'Montgomery County', 'Scotland County', 'Robeson County', 'Wake County', 'Buncombe County', 'Guilford County', 'New Hanover County']);
const severityFallbacks: Record<string, string> = { good: '#4cc27a', moderate: '#f0913a', elevated: '#f0605f', high: '#d668ad', severe: '#a870f0', no_data: '#e6e6e6' };

export default function MapCanvas({ layer, points, selectedId, home, view, onViewChange, onSelect, onReady, onUnavailable, onVisibleCountChange, onVisibleIdsChange, patterns = true, forceEmpty = false, previewOnly = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onViewChange, onSelect, onReady, onUnavailable, onVisibleCountChange, onVisibleIdsChange });
  const emittedVisibleCount = useRef<number | null>(null);
  const emittedVisibleIds = useRef('');
  const latest = useRef({ view, layer, points, forceEmpty });
  const hits = useRef<Hit[]>([]);
  const countyPaths = useRef<{ id: string; path: Path2D }[]>([]);
  const pointers = useRef(new Map<number, Coordinate>());
  const gesture = useRef<{ view: MapView; center: Coordinate; distance: number; moved: boolean } | null>(null);
  const [geography, setGeography] = useState<Geography | null>(null);
  const [context, setContext] = useState<CartographicContext | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [dimensions, setDimensions] = useState({ width: 600, height: 600 });
  const [paletteTick, setPaletteTick] = useState(0);
  const [hover, setHover] = useState<Hit | null>(null);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => { callbacks.current = { onViewChange, onSelect, onReady, onUnavailable, onVisibleCountChange, onVisibleIdsChange }; latest.current = { view, layer, points, forceEmpty }; });
  useEffect(() => {
    const abort = new AbortController();
    callbacks.current.onReady?.(false);
    fetch('/data/map-preview-geography.json', { signal: abort.signal }).then(response => {
      if (!response.ok) throw new Error('Atlas unavailable');
      return response.json();
    }).then((data: Geography) => {
      if (!Array.isArray(data.counties) || !data.district?.geometry) throw new Error('Invalid atlas');
      setGeography(data); setError(false); callbacks.current.onReady?.(true);
    }).catch(() => { if (!abort.signal.aborted) { setError(true); callbacks.current.onReady?.(false); callbacks.current.onUnavailable?.(); } });
    fetch('/data/map-preview-context.json', {signal:abort.signal}).then(response=>response.ok?response.json():null).then(data=>{
      if (!abort.signal.aborted && Array.isArray(data?.rivers) && Array.isArray(data?.places)) setContext(data);
    }).catch(()=>{/* Optional geographic context must not hide observations. */});
    return () => abort.abort();
  }, [attempt]);
  useEffect(() => {
    if (!rootRef.current) return;
    const resize = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width && height) setDimensions({ width, height });
    });
    resize.observe(rootRef.current);
    const observer = new MutationObserver(() => setPaletteTick(value => value + 1));
    let node: Element | null = rootRef.current.parentElement;
    while (node) { observer.observe(node, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-appearance', 'data-mode', 'data-contrast'] }); node = node.parentElement; }
    const media = matchMedia('(prefers-color-scheme: dark)');
    const change = () => setPaletteTick(value => value + 1);
    media.addEventListener('change', change);
    return () => { resize.disconnect(); observer.disconnect(); media.removeEventListener('change', change); };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !geography) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) { callbacks.current.onReady?.(false); callbacks.current.onUnavailable?.(); return; }
    const { width, height } = dimensions;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.scale(dpr, dpr);
    const styles = getComputedStyle(canvas);
    const color = (key: string, fallback: string) => styles.getPropertyValue(key).trim() || fallback;
    const sea = color('--map-atlas-sea', '#0d2431'), land = color('--map-atlas-land', '#193440');
    const line = color('--map-atlas-line', '#36535c'), ink = color('--map-atlas-ink', '#a2b6be');
    const white = color('--map-atlas-bright', '#e5f2f1');
    // Resolve HALO's light-dark() tokens through a computed color property.
    // CSS custom property text itself can still contain unresolved functions.
    const severityColors = Object.fromEntries(Object.entries(severityFallbacks).map(([key, fallback]) => {
      const probe = document.createElement('span');
      probe.style.color = `var(--halo-${key === 'no_data' ? 'no-data' : key}, ${fallback})`;
      probe.style.display = 'none'; rootRef.current?.appendChild(probe);
      const resolved = getComputedStyle(probe).color; probe.remove();
      return [key, resolved || fallback];
    }));
    const [cx, cy] = world(view.lng, view.lat), scale = 256 * 2 ** view.zoom;
    const project = (lng: number, lat: number): Coordinate => {
      const [x, y] = world(lng, lat); return [(x - cx) * scale + width / 2, (y - cy) * scale + height / 2];
    };
    ctx.fillStyle = sea; ctx.fillRect(0, 0, width, height);
    // An honest atlas grid, not invented roads, waterways, or exposure areas.
    ctx.strokeStyle = line; ctx.globalAlpha = .18; ctx.lineWidth = .7;
    for (let lng = -85; lng <= -74; lng += .5) { const [x] = project(lng, view.lat); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
    for (let lat = 33; lat <= 38; lat += .5) { const [, y] = project(view.lng, lat); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    ctx.globalAlpha = 1;
    const radonByCounty = new Map(points.map(point => [point.id, point]));
    let visibleCountyCount = 0;
    const visibleCountyIds: string[] = [];
    const statePath = new Path2D();
    countyPaths.current = [];
    geography.counties.forEach(county => {
      const { path, bounds } = trace(county.geometry, project);
      countyPaths.current.push({ id: county.name, path });
      statePath.addPath(path);
      ctx.fillStyle = land; ctx.fill(path, 'evenodd');
      const reading = !forceEmpty && layer === 'radon' ? radonByCounty.get(county.name) ?? points.find(point => point.name === county.name) : undefined;
      if (reading && bounds.right >= 0 && bounds.left <= width && bounds.bottom >= 0 && bounds.top <= height) { visibleCountyCount += 1; visibleCountyIds.push(county.name); }
      if (reading) { ctx.globalAlpha = patterns ? .46 : .13; ctx.fillStyle = severityColors[reading.severity] || severityColors.no_data; ctx.fill(path, 'evenodd'); ctx.globalAlpha = 1; }
      ctx.strokeStyle = line; ctx.lineWidth = .85; ctx.stroke(path);
      if (selectedId === county.name) { ctx.fillStyle = '#79d5c92b'; ctx.fill(path, 'evenodd'); ctx.strokeStyle = '#a1eee0'; ctx.lineWidth = 2.5; ctx.stroke(path); }
    });
    const { path: district } = trace(geography.district.geometry, project);
    ctx.fillStyle = '#59cbbb0d'; ctx.fill(district, 'evenodd');
    ctx.strokeStyle = '#67c5ba'; ctx.globalAlpha = .8; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.4; ctx.stroke(district); ctx.setLineDash([]); ctx.globalAlpha = 1;

    ctx.save(); ctx.clip(statePath);
    context?.rivers.forEach(river=>{
      ctx.beginPath(); river.coordinates.forEach(([lng,lat],index)=>{const [x,y]=project(lng,lat);if(index===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});
      ctx.strokeStyle=color('--map-atlas-water','#3c7386'); ctx.lineWidth=view.zoom>9?2:1.3;ctx.globalAlpha=.6;ctx.stroke();
    });
    ctx.restore();

    // Equal-weight spatial kernels count records, never concentrations or risk.
    // The fixed 35 km radius and fixed color domain do not change with panning.
    if (patterns && !forceEmpty && ['water', 'facilities'].includes(layer)) {
      const radius = 35000 / (40075016.686 * Math.cos(view.lat * Math.PI / 180) / scale);
      const sources = points.filter(p => p.flagged).map(p => project(p.lng, p.lat));
      const step = 4, cols = Math.ceil(width / step), rows = Math.ceil(height / step);
      const surface = document.createElement('canvas'); surface.width = cols; surface.height = rows;
      const surfaceContext = surface.getContext('2d');
      if (surfaceContext && sources.length) {
        const pixels = surfaceContext.createImageData(cols, rows);
        const stops = [[43, 155, 173], [55, 200, 171], [243, 202, 103], [243, 121, 92], [219, 76, 110]];
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
          let density = 0;
          for (const [sx, sy] of sources) { const d2 = ((x * step - sx) ** 2 + (y * step - sy) ** 2) / radius ** 2; if (d2 < 1) density += (1 - d2) ** 2; }
          if (density < .025) continue;
          const value = Math.min(density / 2, 1) * 4, i = Math.min(3, Math.floor(value)), fraction = value - i;
          const offset = (y * cols + x) * 4;
          for (let c = 0; c < 3; c++) pixels.data[offset + c] = Math.round(stops[i][c] + (stops[i + 1][c] - stops[i][c]) * fraction);
          pixels.data[offset + 3] = Math.round(Math.min(.68, density * .85) * 255);
        }
        surfaceContext.putImageData(pixels, 0, 0);
        ctx.save(); ctx.clip(statePath); ctx.imageSmoothingEnabled = true; ctx.drawImage(surface, 0, 0, width, height); ctx.restore();
      }
    }

    // Real place labels create geographic orientation without invented roads.
    // Their neutral dot and sentence case distinguish them from data markers.
    const cityLabels: {x:number;y:number;width:number}[]=[];
    context?.places.slice().sort((a,b)=>a.rank-b.rank).forEach(place=>{
      if(view.zoom<7 && place.rank>5 || view.zoom<8 && place.rank>7) return;
      const [x,y]=project(...place.coordinates);
      if(x<20||x>width-70||y<15||y>height-20) return;
      ctx.save();ctx.setTransform(1,0,0,1,0,0);const insideState=ctx.isPointInPath(statePath,x,y);ctx.restore();if(!insideState)return;
      ctx.font='600 12px system-ui, sans-serif';const labelWidth=ctx.measureText(place.name).width;
      if(cityLabels.some(p=>Math.abs(x-p.x)<(labelWidth+p.width)/2+35 && Math.abs(y-p.y)<30))return;
      cityLabels.push({x,y,width:labelWidth});
      ctx.beginPath();ctx.arc(x,y,2,0,Math.PI*2);ctx.fillStyle=white;ctx.fill();
      ctx.textAlign='left';ctx.strokeStyle=land;ctx.lineWidth=4;ctx.strokeText(place.name,x+7,y+3);ctx.fillStyle=white;ctx.fillText(place.name,x+7,y+3);
    });

    // Label positions are polygon centroids, not invented city coordinates.
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const placedLabels: { x: number; y: number; width: number }[] = [];
    [...geography.counties].sort((a, b) => Number(priorityCounties.has(b.name)) - Number(priorityCounties.has(a.name))).forEach(county => {
      if (view.zoom < 7 && !priorityCounties.has(county.name)) return;
      const [x, y] = project(...county.center);
      if (x < -20 || x > width + 20 || y < 10 || y > height - 30) return;
      ctx.font = `${priorityCounties.has(county.name) ? '600' : '400'} ${view.zoom < 7 ? 9 : 10}px system-ui, sans-serif`;
      const label = county.name.replace(' County', '').toUpperCase();
      const labelWidth = ctx.measureText(label).width;
      if (placedLabels.some(other => Math.abs(x - other.x) < (labelWidth + other.width) / 2 + 8 && Math.abs(y - other.y) < 24) || cityLabels.some(other=>Math.abs(x-other.x)<(labelWidth+other.width)/2+12 && Math.abs(y-other.y)<30)) return;
      placedLabels.push({ x, y, width: labelWidth });
      ctx.strokeStyle = land; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.strokeText(label, x, y);
      ctx.fillStyle = ink; ctx.fillText(label, x, y);
      if (layer === 'radon' && !forceEmpty) {
        const reading = radonByCounty.get(county.name);
        if (reading?.zone) { ctx.font = '10px system-ui, sans-serif'; ctx.fillStyle = white; ctx.fillText(`Zone ${reading.zone}`, x, y + 15); }
      }
    });

    const inFrame = (x: number, y: number) => x > -30 && x < width + 30 && y > -30 && y < height + 30;
    const projected = forceEmpty || layer === 'radon' ? [] : points.filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng)).map(point => ({ point, at: project(point.lng, point.lat) })).filter(item => inFrame(...item.at));
    const visibleCount = layer === 'radon' ? visibleCountyCount : projected.filter(({ at: [x, y] }) => x >= 0 && x <= width && y >= 0 && y <= height).length;
    if (emittedVisibleCount.current !== visibleCount) { emittedVisibleCount.current = visibleCount; callbacks.current.onVisibleCountChange?.(visibleCount); }
    const visibleIds = layer === 'radon' ? visibleCountyIds : projected.filter(({ at: [x, y] }) => x >= 0 && x <= width && y >= 0 && y <= height).map(p => p.point.id);
    const idKey = `${layer}:${visibleIds.slice().sort().join(',')}`;
    if (emittedVisibleIds.current !== idKey) { emittedVisibleIds.current = idKey; callbacks.current.onVisibleIdsChange?.(visibleIds); }
    const groups: { members: MapPoint[]; x: number; y: number }[] = [];
    projected.forEach(({ point, at: [x, y] }) => {
      const group = layer === 'facilities' && view.zoom < 10.5 ? groups.find(candidate => Math.hypot(candidate.x - x, candidate.y - y) < 38) : undefined;
      if (group) { const count = group.members.length; group.x = (group.x * count + x) / (count + 1); group.y = (group.y * count + y) / (count + 1); group.members.push(point); }
      else groups.push({ members: [point], x, y });
    });
    hits.current = [];
    groups.sort((a, b) => Number(a.members.some(p => p.id === selectedId)) - Number(b.members.some(p => p.id === selectedId))).forEach(({ members, x, y }) => {
      const point = members[0], selected = members.some(member => member.id === selectedId);
      if (members.length > 1) {
        ctx.beginPath(); ctx.arc(x, y, 17, 0, Math.PI * 2); ctx.fillStyle = '#183c48'; ctx.fill(); ctx.strokeStyle = '#82c6c4'; ctx.lineWidth = selected ? 3 : 1.5; ctx.stroke();
        ctx.fillStyle = '#eefaf6'; ctx.font = '600 12px system-ui, sans-serif'; ctx.fillText(String(members.length), x, y);
        hits.current.push({ id: `cluster:${point.id}`, name: `${members.length} facilities. Select to expand.`, x, y, cluster: members }); return;
      }
      const radius = layer === 'water' ? clamp(Math.sqrt(Math.max(point.population ?? 0, 0)) / 95, 5.5, 15) : layer === 'air' ? 9 : 7;
      if (layer === 'air' && patterns) {
        ctx.beginPath(); ctx.arc(x, y, 24, 0, Math.PI * 2); ctx.fillStyle = severityColors[point.severity] || severityColors.no_data; ctx.globalAlpha = .13; ctx.fill(); ctx.globalAlpha = .45; ctx.lineWidth = 1; ctx.strokeStyle = ctx.fillStyle; ctx.stroke(); ctx.globalAlpha = 1;
        ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = white; ctx.fillText(point.name.replace(' monitoring station (sample)', ''), x + 30, y); ctx.textAlign = 'center';
      }
      if (point.isOwn || selected) {
        ctx.beginPath(); ctx.arc(x, y, radius + (selected ? 6 : 4), 0, Math.PI * 2); ctx.strokeStyle = selected ? white : '#8fe1d8'; ctx.lineWidth = selected ? 2 : 1.3; ctx.stroke();
      }
      ctx.beginPath();
      if (layer === 'air') { ctx.moveTo(x, y - radius); ctx.lineTo(x + radius, y); ctx.lineTo(x, y + radius); ctx.lineTo(x - radius, y); ctx.closePath(); }
      else if (layer === 'facilities') ctx.roundRect(x - radius, y - radius, radius * 2, radius * 2, 3);
      else ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = severityColors[point.severity] || severityColors.no_data; ctx.fill(); ctx.strokeStyle = sea; ctx.lineWidth = 2; ctx.stroke();
      if (point.severity === 'no_data') { ctx.strokeStyle = sea; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - radius * .45, y + radius * .45); ctx.lineTo(x + radius * .45, y - radius * .45); ctx.stroke(); }
      hits.current.push({ id: point.id, name: point.name, x, y });
    });
    if (home) {
      const [x, y] = project(home.lng, home.lat);
      if (inFrame(x, y)) {
        ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.fillStyle = '#123b4b'; ctx.fill(); ctx.strokeStyle = '#c4f8ee'; ctx.lineWidth = selectedId === 'home' ? 3 : 1.5; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.lineTo(x, y - 7); ctx.lineTo(x + 8, y); ctx.moveTo(x - 5.5, y - 1); ctx.lineTo(x - 5.5, y + 7); ctx.lineTo(x + 5.5, y + 7); ctx.lineTo(x + 5.5, y - 1); ctx.stroke();
        ctx.fillStyle = '#c4f8ee'; ctx.fillRect(x - 1.5, y + 2, 3, 5);
        hits.current.push({ id: 'home', name: 'Sample household location', x, y });
      }
    }
    const metersPerPixel = 40075016.686 * Math.cos(view.lat * Math.PI / 180) / scale;
    const candidateKm = (80 * metersPerPixel) / 1000;
    const power = 10 ** Math.floor(Math.log10(candidateKm));
    const km = [1, 2, 5].map(n => n * power).reverse().find(n => n <= candidateKm) ?? power;
    const pixels = km * 1000 / metersPerPixel;
    const scaleX = width - pixels - 18, scaleY = height * .52;
    ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(scaleX, scaleY - 5); ctx.lineTo(scaleX, scaleY); ctx.lineTo(scaleX + pixels, scaleY); ctx.lineTo(scaleX + pixels, scaleY - 5); ctx.stroke();
    ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.fillStyle = ink; ctx.fillText(`${km} km`, width - 18, scaleY - 12);
  }, [geography, context, dimensions, layer, points, selectedId, home, view, forceEmpty, paletteTick, patterns]);

  const local = (event: { clientX: number; clientY: number }): Coordinate => {
    const rect = canvasRef.current!.getBoundingClientRect(); return [event.clientX - rect.left, event.clientY - rect.top];
  };
  const findHit = (x: number, y: number) => [...hits.current].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y)).find(hit => Math.hypot(hit.x - x, hit.y - y) <= 22);
  const selectAt = useCallback((x: number, y: number) => {
    const hit = [...hits.current].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y)).find(item => Math.hypot(item.x - x, item.y - y) <= 22);
    if (hit?.cluster) {
      const lng = hit.cluster.reduce((sum, item) => sum + item.lng, 0) / hit.cluster.length;
      const lat = hit.cluster.reduce((sum, item) => sum + item.lat, 0) / hit.cluster.length;
      callbacks.current.onViewChange(bound({ lng, lat, zoom: latest.current.view.zoom + 1.5 })); setAnnouncement(`Expanded ${hit.cluster.length} facilities.`);
    } else if (hit) { callbacks.current.onSelect(hit.id); setAnnouncement(`Selected ${hit.name}.`); }
    else if (latest.current.layer === 'radon' && !latest.current.forceEmpty) {
      const ctx = canvasRef.current?.getContext('2d');
      // Hit-test in CSS pixels rather than the backing-store DPR transform.
      ctx?.save(); ctx?.setTransform(1, 0, 0, 1, 0, 0);
      const county = ctx && countyPaths.current.find(item => ctx.isPointInPath(item.path, x, y, 'evenodd'));
      ctx?.restore();
      if (county) { callbacks.current.onSelect(county.id); setAnnouncement(`Selected ${county.id}.`); }
    }
  }, []);
  const startGesture = () => {
    const active = [...pointers.current.values()];
    const center: Coordinate = active.length > 1 ? [(active[0][0] + active[1][0]) / 2, (active[0][1] + active[1][1]) / 2] : active[0];
    gesture.current = { view: latest.current.view, center, distance: active.length > 1 ? Math.hypot(active[0][0] - active[1][0], active[0][1] - active[1][1]) : 0, moved: active.length > 1 };
  };
  const pointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, local(event)); startGesture(); setHover(null);
  };
  const pointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const [x, y] = local(event);
    if (!pointers.current.has(event.pointerId) || !gesture.current) { if (event.pointerType === 'mouse') setHover(findHit(x, y) ?? null); return; }
    pointers.current.set(event.pointerId, [x, y]);
    const active = [...pointers.current.values()], start = gesture.current;
    const center = active.length > 1 ? [(active[0][0] + active[1][0]) / 2, (active[0][1] + active[1][1]) / 2] : active[0];
    const dx = center[0] - start.center[0], dy = center[1] - start.center[1];
    if (Math.hypot(dx, dy) > 4) start.moved = true;
    const next = shifted(start.view, dx, dy);
    if (active.length > 1 && start.distance > 0) next.zoom = clamp(start.view.zoom + Math.log2(Math.hypot(active[0][0] - active[1][0], active[0][1] - active[1][1]) / start.distance), 6, 12);
    callbacks.current.onViewChange(next);
  };
  const pointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const click = pointers.current.size === 1 && gesture.current && !gesture.current.moved;
    pointers.current.delete(event.pointerId);
    if (click) selectAt(...local(event));
    if (pointers.current.size) { startGesture(); if (gesture.current) gesture.current.moved = true; } else gesture.current = null;
  };
  const keyboard = (event: KeyboardEvent<HTMLCanvasElement>) => {
    const moves: Record<string, Coordinate> = { ArrowLeft: [75, 0], ArrowRight: [-75, 0], ArrowUp: [0, 75], ArrowDown: [0, -75] };
    if (moves[event.key]) { event.preventDefault(); onViewChange(shifted(view, ...moves[event.key])); }
    else if (['+', '=', '-', '_'].includes(event.key)) { event.preventDefault(); onViewChange(bound({ ...view, zoom: view.zoom + (['+', '='].includes(event.key) ? .75 : -.75) })); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectAt(dimensions.width / 2, dimensions.height / 2); }
    else if (event.key === 'Home' && home) { event.preventDefault(); onViewChange(bound({ ...home, zoom: 9 })); }
  };

  return <div className="halo-map-atlas" ref={rootRef} data-testid="map-canvas" data-presentation={patterns?'patterns':'locations'}>
    <canvas ref={canvasRef} tabIndex={previewOnly ? -1 : 0} role="application" aria-label="Map of North Carolina. Use arrow keys to pan, plus and minus to zoom, and Enter to select at the center. The results list offers the same observations." onKeyDown={keyboard} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={event => { pointers.current.delete(event.pointerId); gesture.current = null; }} onPointerLeave={() => setHover(null)} onDoubleClick={() => onViewChange(bound({ ...view, zoom: view.zoom + 1 }))} />
    <div className="halo-map-atlas-north" aria-hidden="true"><span>N</span><svg viewBox="0 0 16 22"><path d="M8 1 15 20 8 15 1 20Z" /></svg></div>
    <span className="halo-map-atlas-crosshair" aria-hidden="true" />
    {hover && <div className="halo-map-atlas-tooltip" style={{ left: clamp(hover.x, 95, dimensions.width - 95), top: Math.max(12, hover.y - 44) }}>{hover.name}</div>}
    {!geography && <div className="halo-map-atlas-status" role="status"><span className="halo-map-atlas-status-symbol" aria-hidden="true">◎</span><strong>{error ? 'The map could not be drawn' : 'Opening the atlas'}</strong><p>{error ? 'Your sample observations are still available in the results list.' : 'Loading local Census boundaries. No map account is needed.'}</p>{error && !previewOnly && <button onClick={() => { setError(false); setAttempt(value => value + 1); }}>Try the map again</button>}</div>}
    <div className="halo-map-atlas-credit">{previewOnly ? <span>Census · Natural Earth · Sample observations</span> : <><a href="https://www.census.gov/geographies/mapping-files.html" target="_blank" rel="noopener noreferrer">Census</a> · <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a> · Sample observations</>}</div>
    <p className="halo-map-atlas-sr" role="status" aria-live="polite">{announcement}</p>
  </div>;
}
