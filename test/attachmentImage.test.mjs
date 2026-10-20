/**
 * lib/attachmentImage.js (B14 Rulings A2 to A5): every stored photo is the
 * server's own re-encode, with no EXIF, GPS, XMP, IPTC or ICC left, and only
 * a decodable JPEG, PNG or WebP within the limits is accepted.
 *
 * The metadata proof uses a real JPEG fixture, test/fixtures/attachments/gps-exif.jpg,
 * made with a camera Make and Model, an Artist, an Orientation of 6 and a GPS
 * IFD (35 46 12.34 N, 78 38 56.78 W), plus an XMP packet and an ICC profile.
 * The first test proves the fixture really carries all of that (the GPS
 * read from the TIFF structure itself), so the later assertions that none of
 * it survives are not vacuous.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { IMAGE_LIMITS, processImage, sniffImageType } from '../lib/attachmentImage.js';

const FIXTURE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/attachments/gps-exif.jpg'));

/** Every marker segment of a JPEG up to the scan, as [marker, payload]. */
function jpegSegments(bytes) {
  assert.equal(bytes.readUInt16BE(0), 0xffd8, 'a JPEG starts with SOI');
  const segments = [];
  let at = 2;
  while (at < bytes.length) {
    assert.equal(bytes[at], 0xff, `a marker at ${at}`);
    const marker = bytes[at + 1];
    if (marker === 0xda) break; // start of scan: entropy-coded data follows
    const length = bytes.readUInt16BE(at + 2);
    segments.push([marker, bytes.subarray(at + 4, at + 2 + length)]);
    at += 2 + length;
  }
  return segments;
}

/** The GPS latitude in an EXIF block (as sharp's metadata().exif gives it): [deg, min, sec], or null. */
function gpsLatitude(exif) {
  if (!exif) return null;
  const tiff = exif.subarray(exif.indexOf('Exif\0\0') === 0 ? 6 : 0);
  const little = tiff.toString('latin1', 0, 2) === 'II';
  const u16 = (offset) => (little ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset));
  const u32 = (offset) => (little ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset));
  const entries = (ifd) => Array.from({ length: u16(ifd) }, (_, n) => ifd + 2 + n * 12);
  const gpsPointer = entries(u32(4)).find((entry) => u16(entry) === 0x8825);
  if (gpsPointer === undefined) return null;
  const latitude = entries(u32(gpsPointer + 8)).find((entry) => u16(entry) === 0x0002);
  if (latitude === undefined) return null;
  const values = u32(latitude + 8);
  return [0, 1, 2].map((n) => u32(values + n * 8) / u32(values + n * 8 + 4));
}

const PRIVATE_TEXT = ['HALO-FIXTURE-CAMERA', 'PRIVATE-MODEL', 'PRIVATE-ARTIST', 'PRIVATE-XMP', 'xmpmeta', 'Exif', 'http://ns.adobe.com', '35.7701'];

test('the fixture really carries EXIF GPS, camera fields, orientation, XMP and an ICC profile', async () => {
  const meta = await sharp(FIXTURE).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.deepEqual([meta.width, meta.height, meta.orientation], [64, 48, 6]);
  assert.ok(meta.exif && meta.xmp && meta.icc);
  assert.deepEqual(gpsLatitude(meta.exif), [35, 46, 12.34]);
  const text = FIXTURE.toString('latin1');
  for (const marker of ['HALO-FIXTURE-CAMERA', 'PRIVATE-ARTIST', 'PRIVATE-XMP']) assert.ok(text.includes(marker), marker);
  assert.ok(jpegSegments(FIXTURE).some(([marker]) => marker === 0xe1), 'an APP1 (EXIF/XMP) segment');
});

test('the processed JPEG keeps the picture, applies the orientation, and carries no EXIF, GPS, XMP, IPTC or ICC at all', async () => {
  const out = await processImage(FIXTURE);
  assert.equal(out.ok, true);
  assert.equal(out.mime, 'image/jpeg');
  assert.deepEqual([out.width, out.height], [48, 64], 'orientation 6 is applied to the pixels, then dropped');
  const meta = await sharp(out.bytes).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['jpeg', 48, 64]);
  for (const key of ['exif', 'xmp', 'iptc', 'icc', 'orientation']) assert.equal(meta[key], undefined, key);
  assert.equal(gpsLatitude(meta.exif), null);
  // Byte level: no APPn segment but JFIF's APP0, and no trace of any private text.
  assert.deepEqual(jpegSegments(out.bytes).map(([marker]) => marker).filter((marker) => marker >= 0xe1 && marker <= 0xef), []);
  const text = out.bytes.toString('latin1');
  for (const marker of PRIVATE_TEXT) assert.ok(!text.includes(marker), `"${marker}" survived`);
  // The fixture's GPS seconds as a rational (1234/100), in either byte order, appear nowhere.
  for (const rational of [[0, 0, 0x04, 0xd2, 0, 0, 0, 0x64], [0xd2, 0x04, 0, 0, 0x64, 0, 0, 0]]) {
    assert.equal(out.bytes.includes(Buffer.from(rational)), false, 'a GPS rational survived');
  }
  assert.ok(FIXTURE.includes(Buffer.from([0xd2, 0x04, 0, 0, 0x64, 0, 0, 0])) || FIXTURE.includes(Buffer.from([0, 0, 0x04, 0xd2, 0, 0, 0, 0x64])), 'the fixture holds it');
  // The picture is still the picture: the colour of the fixture.
  const { data } = await sharp(out.bytes).raw().toBuffer({ resolveWithObject: true });
  assert.ok(Math.abs(data[0] - 30) < 8 && Math.abs(data[1] - 120) < 8 && Math.abs(data[2] - 200) < 8, `pixel ${[...data.subarray(0, 3)]}`);
});

test('PNG and WebP carrying EXIF and XMP come back in their own format with none of it', async () => {
  const exif = { IFD0: { Make: 'HALO-FIXTURE-CAMERA' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 46/1 1234/100' } };
  const base = () => sharp({ create: { width: 20, height: 10, channels: 4, background: { r: 10, g: 200, b: 90, alpha: 0.5 } } });
  for (const [format, encode] of [['png', (pipeline) => pipeline.png()], ['webp', (pipeline) => pipeline.webp()]]) {
    const input = await encode(base()).withExif(exif).withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">PRIVATE-XMP</x:xmpmeta>').toBuffer();
    const before = await sharp(input).metadata();
    assert.ok(before.exif && before.xmp, `${format} fixture carries metadata`);
    const out = await processImage(input);
    assert.equal(out.ok, true, format);
    assert.equal(out.mime, `image/${format}`);
    const meta = await sharp(out.bytes).metadata();
    assert.equal(meta.format, format);
    for (const key of ['exif', 'xmp', 'iptc', 'icc']) assert.equal(meta[key], undefined, `${format} ${key}`);
    assert.equal(meta.hasAlpha, true, `${format} keeps transparency`);
    const text = out.bytes.toString('latin1');
    for (const marker of ['HALO-FIXTURE-CAMERA', 'PRIVATE-XMP', 'eXIf', 'iTXt', 'EXIF', 'XMP ']) assert.ok(!text.includes(marker), `${format}: "${marker}"`);
  }
});

test('the type is the file\'s own signature: PDF, SVG, GIF, HEIC/AVIF, TIFF and text are refused whatever they are called', async () => {
  const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).gif().toBuffer();
  const avif = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).avif().toBuffer();
  const tiff = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).tiff().toBuffer();
  const refused = {
    pdf: Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF'),
    svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><script>alert(1)</script></svg>'),
    gif, avif, tiff,
    html: Buffer.from('<!doctype html><title>x</title>'),
  };
  for (const [name, bytes] of Object.entries(refused)) {
    assert.equal(sniffImageType(bytes), null, name);
    assert.deepEqual(await processImage(bytes), { ok: false, reason: 'unsupported_type' }, name);
  }
});

test('a damaged, truncated or disguised image is undecodable; the limits are checked before any decode', async () => {
  assert.deepEqual(await processImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('not really a jpeg')])), { ok: false, reason: 'undecodable' });
  assert.deepEqual(await processImage(FIXTURE.subarray(0, Math.floor(FIXTURE.length * 0.8))), { ok: false, reason: 'undecodable' });
  // A WebP header around PNG bytes: the signature says WebP, the decoder disagrees.
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } }).png().toBuffer();
  const disguised = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), png]);
  assert.equal((await processImage(disguised)).ok, false);
  assert.deepEqual(await processImage(Buffer.alloc(0)), { ok: false, reason: 'too_large' });
  const huge = Buffer.alloc(IMAGE_LIMITS.inputBytes + 1);
  FIXTURE.copy(huge);
  assert.deepEqual(await processImage(huge), { ok: false, reason: 'too_large' });
});

test('an image over 40 megapixels is refused from its header, before its pixels are decoded', async () => {
  const wide = await sharp({ create: { width: 10_000, height: 4_001, channels: 3, background: '#fff' } }).png({ compressionLevel: 9 }).toBuffer();
  assert.deepEqual(await processImage(wide), { ok: false, reason: 'too_many_pixels' });
  assert.equal(IMAGE_LIMITS.pixels, 40_000_000);
});
