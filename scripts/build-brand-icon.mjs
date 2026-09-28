// Render the same approved monochrome mask used by the app, then encode icons.
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
const mask = await sharp(await readFile(new URL('../public/halo-logo-mark.png', import.meta.url))).resize(256, 256).png().toBuffer();
const png = await sharp({ create: { width: 256, height: 256, channels: 4, background: '#0e5e6f' } }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
await writeFile(new URL('../app/favicon.ico', import.meta.url), Buffer.concat([header, png]));
await writeFile(new URL('../public/halo-icon.png', import.meta.url), png);
