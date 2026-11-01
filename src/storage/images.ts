/**
 * Local image validation and re-encoding. The type is decided by sniffing
 * magic bytes, never by Blob.type or file extension. Only PNG, JPEG and WebP
 * are accepted; SVG, HTML and everything else is rejected.
 */
import type { LocalImage } from '../shared/types';
import { IMAGE_MAX_BYTES, StorageError } from './errors';

export type ImageMime = LocalImage['mime'];
export type Bytes = Uint8Array<ArrayBuffer>;

/** Returns the detected type, or null when the bytes are not PNG/JPEG/WebP. */
export function sniffImageMime(b: Uint8Array): ImageMime | null {
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return 'image/webp';
  }
  return null;
}

/** Decode + re-encode seam. Must return image bytes (re-checked by the caller). */
export type ImageReencoder = (bytes: Bytes, mime: ImageMime) => Promise<{ bytes: Bytes; mime: ImageMime }>;

/** Longest side after re-encoding; larger images are scaled down. */
export const IMAGE_MAX_DIMENSION = 4096;

/**
 * Default re-encoder for extension pages/workers: createImageBitmap +
 * OffscreenCanvas. Fails closed (UNSUPPORTED_MEDIA) where those APIs are
 * missing, so an image is never stored without being decoded and re-encoded.
 */
export const canvasReencoder: ImageReencoder = async (bytes, mime) => {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    throw new StorageError('UNSUPPORTED_MEDIA', 'Images cannot be processed in this context.');
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
  } catch {
    throw new StorageError('UNSUPPORTED_MEDIA', 'The image could not be decoded.');
  }
  try {
    const scale = Math.min(1, IMAGE_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height, 1));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new StorageError('UNSUPPORTED_MEDIA', 'Images cannot be processed in this context.');
    ctx.drawImage(bitmap, 0, 0, w, h);
    const out = await canvas.convertToBlob({ type: mime, quality: 0.9 });
    const outBytes = new Uint8Array(await out.arrayBuffer());
    const outMime = sniffImageMime(outBytes);
    if (!outMime) throw new StorageError('UNSUPPORTED_MEDIA', 'The image could not be re-encoded.');
    return { bytes: outBytes, mime: outMime };
  } finally {
    bitmap.close();
  }
};

let reencoder: ImageReencoder = canvasReencoder;

/** Replace the re-encoder (tests, or contexts with a different codec). Pass null to restore the default. */
export function setImageReencoder(fn: ImageReencoder | null): void {
  reencoder = fn ?? canvasReencoder;
}

/** Validate size/type of raw bytes, decode and re-encode, and validate the output again. */
export async function prepareImageBytes(bytes: Bytes): Promise<{ bytes: Bytes; mime: ImageMime }> {
  if (bytes.byteLength === 0) throw new StorageError('UNSUPPORTED_MEDIA', 'The image file is empty.');
  if (bytes.byteLength > IMAGE_MAX_BYTES) {
    throw new StorageError('UNSUPPORTED_MEDIA', 'Images must be 5 MB or smaller.');
  }
  const mime = sniffImageMime(bytes);
  if (!mime) throw new StorageError('UNSUPPORTED_MEDIA', 'Only PNG, JPEG and WebP images are supported.');
  const out = await reencoder(bytes, mime);
  const outMime = sniffImageMime(out.bytes);
  if (!outMime || outMime !== out.mime) {
    throw new StorageError('UNSUPPORTED_MEDIA', 'The image could not be re-encoded.');
  }
  if (out.bytes.byteLength > IMAGE_MAX_BYTES) {
    throw new StorageError('UNSUPPORTED_MEDIA', 'The processed image is larger than 5 MB.');
  }
  return { bytes: out.bytes, mime: outMime };
}

export async function prepareImageBlob(file: Blob): Promise<{ bytes: Bytes; mime: ImageMime }> {
  // Check the size before reading anything into memory.
  if (file.size > IMAGE_MAX_BYTES) throw new StorageError('UNSUPPORTED_MEDIA', 'Images must be 5 MB or smaller.');
  return prepareImageBytes(new Uint8Array(await file.arrayBuffer()));
}

// ---- data URL helpers (backups) ----

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/;

/** Parse a base64 image data URL; returns null when malformed. */
export function parseImageDataUrl(dataUrl: string): { mime: ImageMime; bytes: Bytes } | null {
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m || m[2] === undefined) return null;
  let bin: string;
  try {
    bin = atob(m[2]);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: m[1] as ImageMime, bytes };
}

/** Stored image record shape. */
export interface StoredImage {
  id: string;
  mime: ImageMime;
  bytes: ArrayBuffer;
}

export function toLocalImage(rec: StoredImage): LocalImage {
  return { id: rec.id, mime: rec.mime, blob: new Blob([rec.bytes], { type: rec.mime }) };
}
