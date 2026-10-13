// Reproducible acquisition of the three credited, public-domain Explore photographs.
// Only asset sizing/compression is performed; these are real photos, not generated scenes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const output = fileURLToPath(new URL('../public/explore/', import.meta.url));
mkdirSync(output, { recursive: true });
const assets = [
  { id: 'river', file: 'neuse-river.webp', title: 'Neuse River, North Carolina', credit: 'Ken Thomas', license: 'Public domain (PD-self)', source: 'https://commons.wikimedia.org/wiki/File:Neuse_River-27527.jpg', original: 'https://upload.wikimedia.org/wikipedia/commons/9/9b/Neuse_River-27527.jpg', width: 1400 },
  { id: 'trail', file: 'woodland-trail.webp', title: 'Trail to Abrams Falls, Great Smoky Mountains', credit: 'Cynthia L. Cunningham / USGS', license: 'Public domain', source: 'https://www.usgs.gov/media/images/trail-abrams-falls', original: 'https://d9-wret.s3.us-west-2.amazonaws.com/assets/palladium/production/s3fs-public/DSCN2794--Cindy_Cunningham.JPG', width: 1000 },
  { id: 'garden', file: 'pollinator-garden.webp', title: 'Pollinator garden', credit: 'Courtney Celley / USFWS', license: 'Public domain', source: 'https://www.fws.gov/media/pollinator-garden-0', original: 'https://www.fws.gov/sites/default/files/2023-11/Pollinator%20garden%2C%20Courtney%20Celley%2C%20usfws.jpg', width: 1000 },
];
const manifest = await Promise.all(assets.map(async asset => {
  const response = await fetch(asset.original, { headers: { 'User-Agent': 'HALO-Explore-Review/1.0 (credited public-domain asset preparation)' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error(`Photo acquisition failed: ${asset.id} (${response.status})`);
  const original = Buffer.from(await response.arrayBuffer());
  const optimized = await sharp(original).rotate().resize({ width: asset.width, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  writeFileSync(resolve(output, asset.file), optimized);
  return { ...asset, retrieved: '2026-10-09', bytes: optimized.length, originalSha256: createHash('sha256').update(original).digest('hex'), sha256: createHash('sha256').update(optimized).digest('hex'), changes: 'Resized, metadata removed and compressed to WebP. Display crops use CSS; no content was generated.' };
}));
writeFileSync(resolve(output, 'photo-sources.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest.map(({ id, bytes }) => ({ id, bytes }))));
