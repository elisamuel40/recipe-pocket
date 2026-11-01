import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import type { RecipeV1 } from '../../src/shared/types';
import { closeDatabase, setImageReencoder } from '../../src/storage';

/** Fresh, empty IndexedDB and cleared storage module caches. */
export async function resetDb(): Promise<void> {
  await closeDatabase();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  setImageReencoder(null);
}

let n = 0;
export function makeRecipe(over: Partial<RecipeV1> = {}): RecipeV1 {
  n++;
  return {
    schemaVersion: 1,
    id: `r-${n}`,
    title: `Recipe ${n}`,
    source: { url: `https://example.com/recipes/${n}` },
    originalYield: { text: '4 servings', quantity: { minNumerator: 4, minDenominator: 1 }, unit: 'servings' },
    times: { raw: '30 min', total: 'PT30M' },
    ingredientGroups: [
      {
        id: 'g1',
        title: '',
        items: [
          { id: 'i1', raw: '1 1/2 cups flour', quantity: { minNumerator: 3, minDenominator: 2 }, unit: 'cup', ingredient: 'flour', confidence: 'high' },
          { id: 'i2', raw: 'salt to taste', confidence: 'medium' },
        ],
      },
    ],
    instructionGroups: [{ id: 's1', title: '', steps: [{ id: 'st1', text: 'Mix.' }, { id: 'st2', text: 'Bake.' }] }],
    notes: '',
    tags: [],
    collectionIds: [],
    extraction: { method: 'json-ld', missingFields: [], warnings: [] },
    revision: 0,
    ...over,
  };
}

/** Minimal valid PNG/JPEG/WebP headers (enough for magic-byte sniffing). */
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
export const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 8, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);

/** Test re-encoder: returns the bytes unchanged (validation logic still runs). */
export function usePassthroughReencoder(): void {
  setImageReencoder(async (bytes, mime) => ({ bytes, mime }));
}

export function quotaError(): DOMException {
  return new DOMException('The quota has been exceeded.', 'QuotaExceededError');
}
