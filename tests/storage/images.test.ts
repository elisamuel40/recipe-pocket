import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JPEG, PNG, WEBP, makeRecipe, quotaError, resetDb, usePassthroughReencoder } from './helpers';
import {
  IMAGE_MAX_BYTES,
  StorageError,
  countAll,
  deleteImage,
  getImage,
  getRecipe,
  putImage,
  saveRecipe,
  setImageReencoder,
  sniffImageMime,
} from '../../src/storage';

beforeEach(async () => {
  await resetDb();
  usePassthroughReencoder();
});

async function code(p: Promise<unknown>): Promise<string> {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(StorageError);
  return (e as StorageError).code;
}

const sized = (head: Uint8Array, size: number): Uint8Array<ArrayBuffer> => {
  const b = new Uint8Array(size);
  b.set(head);
  return b;
};

describe('sniffImageMime', () => {
  it('detects PNG, JPEG, WebP by magic bytes', () => {
    expect(sniffImageMime(PNG)).toBe('image/png');
    expect(sniffImageMime(JPEG)).toBe('image/jpeg');
    expect(sniffImageMime(WEBP)).toBe('image/webp');
  });
  it('rejects SVG, HTML, GIF, RIFF-but-not-WEBP and empty', () => {
    const enc = new TextEncoder();
    expect(sniffImageMime(enc.encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImageMime(enc.encode('<!doctype html><script>alert(1)</script>'))).toBeNull();
    expect(sniffImageMime(enc.encode('GIF89a......'))).toBeNull();
    expect(sniffImageMime(enc.encode('RIFF\0\0\0\0WAVEfmt '))).toBeNull();
    expect(sniffImageMime(new Uint8Array())).toBeNull();
  });
});

describe('putImage', () => {
  it.each([
    ['png', PNG, 'image/png'],
    ['jpeg', JPEG, 'image/jpeg'],
    ['webp', WEBP, 'image/webp'],
  ] as const)('stores %s and reads it back', async (_n, bytes, mime) => {
    const img = await putImage(new Blob([bytes], { type: 'application/octet-stream' }));
    expect(img.mime).toBe(mime);
    const back = await getImage(img.id);
    expect(back?.mime).toBe(mime);
    expect(new Uint8Array(await back!.blob.arrayBuffer())).toEqual(bytes);
  });

  it('ignores blob.type: SVG/HTML labelled image/png are rejected', async () => {
    expect(await code(putImage(new Blob(['<svg onload="alert(1)"/>'], { type: 'image/png' })))).toBe('UNSUPPORTED_MEDIA');
    expect(await code(putImage(new Blob(['<html></html>'], { type: 'image/jpeg' })))).toBe('UNSUPPORTED_MEDIA');
    expect((await countAll()).images).toBe(0);
  });

  it('accepts exactly 5 MB and rejects 5 MB + 1 byte', async () => {
    await expect(putImage(new Blob([sized(PNG, IMAGE_MAX_BYTES)]))).resolves.toBeTruthy();
    expect(await code(putImage(new Blob([sized(PNG, IMAGE_MAX_BYTES + 1)])))).toBe('UNSUPPORTED_MEDIA');
  });

  it('runs the re-encoder and re-validates its output', async () => {
    const reenc = vi.fn(async () => ({ bytes: new Uint8Array(JPEG), mime: 'image/jpeg' as const }));
    setImageReencoder(reenc);
    const img = await putImage(new Blob([PNG]));
    expect(reenc).toHaveBeenCalledOnce();
    expect(img.mime).toBe('image/jpeg');

    setImageReencoder(async () => ({ bytes: new TextEncoder().encode('<svg/>'), mime: 'image/png' as const }));
    expect(await code(putImage(new Blob([PNG])))).toBe('UNSUPPORTED_MEDIA');
  });

  it('default re-encoder fails closed without createImageBitmap/OffscreenCanvas', async () => {
    setImageReencoder(null);
    expect(await code(putImage(new Blob([PNG])))).toBe('UNSUPPORTED_MEDIA');
    expect((await countAll()).images).toBe(0);
  });

  it('quota failure stores nothing', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(() => {
      throw quotaError();
    });
    expect(await code(putImage(new Blob([PNG])))).toBe('QUOTA');
    vi.restoreAllMocks();
    expect((await countAll()).images).toBe(0);
  });

  it('deleteImage clears localImageId on recipes', async () => {
    const img = await putImage(new Blob([PNG]));
    await saveRecipe(makeRecipe({ id: 'a', localImageId: img.id }));
    await deleteImage(img.id);
    expect(await getImage(img.id)).toBeUndefined();
    const a = await getRecipe('a');
    expect(a?.localImageId).toBeUndefined();
    expect(a?.revision).toBe(2);
  });
});
