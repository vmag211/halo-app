import { writeFile } from 'node:fs/promises';

// Public-domain cartographic context, not environmental observations.
// The preview uses the packaged subset, never an external runtime request.
const base = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const files = ['ne_10m_rivers_lake_centerlines.geojson', 'ne_10m_populated_places_simple.geojson'];
const inside = ([lng,lat]) => lng >= -85 && lng <= -74.5 && lat >= 33 && lat <= 37.2;
const datasets = await Promise.all(files.map(async name => {
  const response = await fetch(base + name);
  if (!response.ok) throw new Error(`Geography source ${response.status}`);
  return response.json();
}));
const rivers = datasets[0].features.flatMap(f => {
  const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
  return lines.filter(line => line.some(inside)).map(coordinates => ({name:f.properties.name_en ?? f.properties.name ?? '', coordinates}));
});
const places = datasets[1].features.filter(f => f.geometry.type === 'Point' && inside(f.geometry.coordinates)).map(f => ({name:f.properties.name,coordinates:f.geometry.coordinates,rank:f.properties.scalerank}));
const output={source:'Natural Earth 1:10m rivers and populated places. Public domain. Generalized geography, not street-level precision.',urls:files.map(f=>base+f),retrieved:'2026-10-01',rivers,places};
await writeFile(new URL('../public/data/map-preview-context.json',import.meta.url),JSON.stringify(output)+'\n');
console.log(`Packaged ${rivers.length} river segments and ${places.length} places.`);
