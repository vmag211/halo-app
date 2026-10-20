/**
 * Server-side processing of a private photo before it is stored (B14 plan,
 * docs/backend/plans/b14-private-attachments.md, Rulings A2 to A5).
 *
 * The contract (HALO_BACKEND_WIRING_CURRENT.md:545): "Server code must
 * independently inspect MIME signatures, dimensions/size ... and metadata
 * policy. Never rely only on filename or the client assertion." So:
 *
 *   1. The type is the file's own signature (JPEG, PNG or WebP), never the
 *      name or the declared type, and sharp's decoder must agree with it.
 *   2. The size, before and after, and the pixel count are bounded.
 *   3. The pixels are decoded and encoded again in the same format, with the
 *      EXIF orientation applied and the colour converted to sRGB. sharp writes
 *      no metadata unless asked to, so EXIF (GPS included), XMP, IPTC and ICC
 *      are all left behind.
 *   4. The output is read back and must carry none of them; otherwise this
 *      throws (a 500), because that would be a broken invariant, not a bad file.
 *
 * Anything that is not a decodable image of an allowed type is refused with a
 * reason code; nothing is stored for it. HEIC is not allowed: this sharp
 * build's HEIF decoder reads AVIF only (Ruling A2).
 */
import sharp from 'sharp';

/** Ruling A3 (proposed). */
export const IMAGE_LIMITS = Object.freeze({
  /** The contract's UI limit for an original (10 MiB). Vercel's 4.5 MB body cap is lower in production. */
  inputBytes: 10 * 1024 * 1024,
  /** About an 8,000 by 5,000 photo. */
  pixels: 40_000_000,
  /** The longest side, 0028's household_attachments_file_check: a wider decodable PNG would be a check violation (a 500) at the commit. */
  side: 100_000,
  /** After processing; the bucket's own file_size_limit is the same (0028 section 9). */
  outputBytes: 15 * 1024 * 1024,
});

/** sharp format -> the stored type. */
export const IMAGE_TYPES = Object.freeze({ jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' });

/** Why a file was refused; the route answers each with a 422 and stores nothing. */
export const IMAGE_REFUSALS = Object.freeze({
  unsupported_type: 'Choose a JPEG, PNG or WebP image.',
  undecodable: 'This file could not be read as an image. Nothing was saved.',
  too_many_pixels: 'This image is too large. Choose one under 40 megapixels.',
  too_wide: 'This image is too wide or tall. Choose a smaller one.',
  too_large: 'This image is too large to store. Nothing was saved.',
});

const startsWith = (bytes, signature, offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((value, index) => bytes[offset + index] === value);

/** The image type a file's own first bytes say it is, or null. */
export function sniffImageType(bytes) {
  if (!bytes || typeof bytes.length !== 'number') return null;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  return null;
}

const refuse = (reason) => ({ ok: false, reason });

const ENCODERS = Object.freeze({
  jpeg: (pipeline) => pipeline.jpeg({ quality: 90 }),
  png: (pipeline) => pipeline.png({ compressionLevel: 9 }),
  webp: (pipeline) => pipeline.webp({ quality: 90 }),
});

/**
 * The processed file, or a refusal:
 *   { ok: true, bytes: Buffer, mime, width, height }
 *   { ok: false, reason }   one of IMAGE_REFUSALS
 */
export async function processImage(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input ?? []);
  if (bytes.length < 1 || bytes.length > IMAGE_LIMITS.inputBytes) return refuse('too_large');
  const kind = sniffImageType(bytes);
  if (!kind) return refuse('unsupported_type');

  let meta;
  try {
    meta = await sharp(bytes, { limitInputPixels: false }).metadata();
  } catch {
    return refuse('undecodable');
  }
  if (meta.format !== kind) return refuse('unsupported_type');
  if (!Number.isSafeInteger(meta.width) || !Number.isSafeInteger(meta.height) || meta.width < 1 || meta.height < 1) {
    return refuse('undecodable');
  }
  if (meta.width > IMAGE_LIMITS.side || meta.height > IMAGE_LIMITS.side) return refuse('too_wide');
  if (meta.width * meta.height > IMAGE_LIMITS.pixels) return refuse('too_many_pixels');

  let data;
  let info;
  try {
    // failOn 'warning' (the default) also refuses a truncated or damaged file.
    // One frame only: an animated image keeps its first.
    const pipeline = sharp(bytes, { limitInputPixels: IMAGE_LIMITS.pixels, failOn: 'warning', animated: false })
      .rotate()
      .toColourspace('srgb');
    ({ data, info } = await ENCODERS[kind](pipeline).toBuffer({ resolveWithObject: true }));
  } catch {
    return refuse('undecodable');
  }
  if (data.length < 1 || data.length > IMAGE_LIMITS.outputBytes) return refuse('too_large');

  const check = await sharp(data).metadata();
  if (check.format !== kind || check.exif || check.xmp || check.iptc || check.icc) {
    throw new Error('attachmentImage: processed output still carries metadata');
  }
  return { ok: true, bytes: data, mime: IMAGE_TYPES[kind], width: info.width, height: info.height };
}
