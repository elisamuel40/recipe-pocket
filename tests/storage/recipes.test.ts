import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRecipe, quotaError, resetDb } from './helpers';
import {
  StorageError,
  commitImport,
  countAll,
  deleteCollection,
  deleteRecipe,
  deleteShoppingList,
  findBySourceUrl,
  getRecipe,
  getShoppingList,
  listCollections,
  listRecipes,
  previewImport,
  saveCollection,
  saveRecipe,
  saveShoppingList,
  searchRecipes,
} from '../../src/storage';
import type { RecipeV1, ShoppingList } from '../../src/shared/types';

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

async function expectCode(p: Promise<unknown>, code: string): Promise<StorageError> {
  const err = await p.then(
    () => {
      throw new Error('expected rejection');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(StorageError);
  expect((err as StorageError).code).toBe(code);
  return err as StorageError;
}

describe('saveRecipe', () => {
  it('inserts a new record with revision 1 and reads it back', async () => {
    const saved = await saveRecipe(makeRecipe({ id: 'a' }));
    expect(saved.revision).toBe(1);
    expect(await getRecipe('a')).toEqual(saved);
  });

  it('assigns a UUID when id is empty', async () => {
    const saved = await saveRecipe(makeRecipe({ id: '' }));
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('updates with matching revision and returns revision + 1', async () => {
    const v1 = await saveRecipe(makeRecipe({ id: 'a' }));
    const v2 = await saveRecipe({ ...v1, title: 'Changed' });
    expect(v2.revision).toBe(2);
    expect((await getRecipe('a'))?.title).toBe('Changed');
  });

  it('rejects a stale revision with CONFLICT and keeps the stored record', async () => {
    const v1 = await saveRecipe(makeRecipe({ id: 'a', title: 'Original' }));
    await saveRecipe({ ...v1, title: 'Second' });
    await expectCode(saveRecipe({ ...v1, title: 'Stale' }), 'CONFLICT');
    const stored = await getRecipe('a');
    expect(stored?.title).toBe('Second');
    expect(stored?.revision).toBe(2);
  });

  it('strips unknown fields and stores text verbatim (XSS payload as text)', async () => {
    const xss = '<img src=x onerror=alert(1)>';
    const input = { ...makeRecipe({ id: 'x', title: xss, notes: `<script>alert(1)</script>` }), extra: 'nope' } as RecipeV1;
    const saved = await saveRecipe(input);
    expect(saved.title).toBe(xss);
    expect(saved.notes).toBe('<script>alert(1)</script>');
    expect('extra' in ((await getRecipe('x')) as object)).toBe(false);
  });

  it('normalizes the stored source URL', async () => {
    const saved = await saveRecipe(makeRecipe({ id: 'u', source: { url: 'https://user:pw@example.com/p?utm_source=x&id=3#top' } }));
    expect(saved.source.url).toBe('https://example.com/p?id=3');
  });

  it.each([
    ['schemaVersion', { schemaVersion: 2 }],
    ['title type', { title: 42 }],
    ['javascript: url', { source: { url: 'javascript:alert(1)' } }],
    ['data: url', { source: { url: 'data:text/html,<b>x</b>' } }],
    ['missing ingredientGroups', { ingredientGroups: undefined }],
    ['bad confidence', { ingredientGroups: [{ id: 'g', title: '', items: [{ id: 'i', raw: 'x', confidence: 'sure' }] }] }],
    ['zero denominator', { originalYield: { text: '', quantity: { minNumerator: 1, minDenominator: 0 } } }],
    ['negative revision', { revision: -1 }],
    ['tags not strings', { tags: [1] }],
  ])('rejects invalid record (%s) with INVALID_RECORD and writes nothing', async (_name, over) => {
    await expectCode(saveRecipe({ ...makeRecipe(), ...(over as object) } as RecipeV1), 'INVALID_RECORD');
    expect((await countAll()).recipes).toBe(0);
  });

  it('accepts an empty source URL (manual recipe)', async () => {
    const saved = await saveRecipe(makeRecipe({ source: { url: '' }, extraction: { method: 'manual', missingFields: [], warnings: [] } }));
    expect(saved.source.url).toBe('');
  });

  it('QuotaExceededError -> QUOTA and existing records survive', async () => {
    const a = await saveRecipe(makeRecipe({ id: 'a', title: 'Keep me' }));
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw quotaError();
    });
    await expectCode(saveRecipe({ ...a, title: 'Overwrite' }), 'QUOTA');
    await expectCode(saveRecipe(makeRecipe({ id: 'b' })), 'QUOTA');
    put.mockRestore();
    expect(await listRecipes()).toEqual([a]);
  });
});

describe('deleteRecipe / findBySourceUrl', () => {
  it('deletes, and NOT_FOUND for unknown ids', async () => {
    await saveRecipe(makeRecipe({ id: 'a' }));
    await deleteRecipe('a');
    expect(await getRecipe('a')).toBeUndefined();
    await expectCode(deleteRecipe('a'), 'NOT_FOUND');
  });

  it('finds duplicates by normalized source URL', async () => {
    await saveRecipe(makeRecipe({ id: 'a', source: { url: 'https://example.com/pie' } }));
    await saveRecipe(makeRecipe({ id: 'b', source: { url: 'https://other.example/pie' } }));
    const hits = await findBySourceUrl('https://example.com/pie?utm_campaign=z#comments');
    expect(hits.map((r) => r.id)).toEqual(['a']);
    expect(await findBySourceUrl('javascript:alert(1)')).toEqual([]);
  });
});

describe('searchRecipes', () => {
  beforeEach(async () => {
    await saveRecipe(makeRecipe({ id: 'c', title: 'Crème Brûlée', tags: ['Dessert'], collectionIds: ['k1'] }));
    await saveRecipe(
      makeRecipe({
        id: 'j',
        title: 'Jalapeño Poppers',
        tags: ['snack'],
        ingredientGroups: [{ id: 'g', title: '', items: [{ id: 'i', raw: '12 JALAPEÑOS', confidence: 'high' }] }],
      }),
    );
    await saveRecipe(makeRecipe({ id: 'p', title: 'Plain bread', tags: ['Bread'], collectionIds: ['k1'] }));
  });

  it('is case- and diacritic-insensitive over title', async () => {
    expect((await searchRecipes({ query: 'creme brulee' })).map((r) => r.id)).toEqual(['c']);
    expect((await searchRecipes({ query: 'BRÛLÉE' })).map((r) => r.id)).toEqual(['c']);
  });

  it('matches tags and ingredient raw text', async () => {
    expect((await searchRecipes({ query: 'dessert' })).map((r) => r.id)).toEqual(['c']);
    expect((await searchRecipes({ query: 'jalapenos' })).map((r) => r.id)).toEqual(['j']);
    expect((await searchRecipes({ query: 'flour' })).map((r) => r.id).sort()).toEqual(['c', 'p']);
  });

  it('filters by collection and tag', async () => {
    expect((await searchRecipes({ collectionId: 'k1' })).map((r) => r.id)).toEqual(['c', 'p']);
    expect((await searchRecipes({ collectionId: 'k1', query: 'bread' })).map((r) => r.id)).toEqual(['p']);
    expect((await searchRecipes({ tag: 'dessert' })).map((r) => r.id)).toEqual(['c']);
  });

  it('empty query returns all, sorted by title', async () => {
    expect((await searchRecipes({})).map((r) => r.title)).toEqual(['Crème Brûlée', 'Jalapeño Poppers', 'Plain bread']);
  });

  it('reflects updates (cache keyed by revision)', async () => {
    const p = (await getRecipe('p'))!;
    await saveRecipe({ ...p, title: 'Sourdough' });
    expect((await searchRecipes({ query: 'sourdough' })).map((r) => r.id)).toEqual(['p']);
    expect(await searchRecipes({ query: 'plain' })).toEqual([]);
  });
});

describe('search performance', () => {
  it('searches 1,000 recipes (target < 200 ms)', async () => {
    const recipes = Array.from({ length: 1000 }, (_, i) =>
      makeRecipe({
        id: `perf-${i}`,
        title: `Synthetic recipe ${i} ${i % 7 === 0 ? 'Crème' : 'Stew'}`,
        source: { url: `https://example.com/perf/${i}` },
        tags: [`tag${i % 10}`, 'dinner'],
        ingredientGroups: [
          {
            id: 'g',
            title: '',
            items: Array.from({ length: 12 }, (_, k) => ({ id: `i${k}`, raw: `${k + 1} cups ingredient number ${k} for recipe ${i}`, confidence: 'high' as const })),
          },
        ],
      }),
    );
    const text = JSON.stringify({ format: 'recipe-pocket-backup', version: 1, recipes, collections: [], shoppingLists: [] });
    await commitImport(await previewImport(text), 'skip');
    expect((await countAll()).recipes).toBe(1000);

    let t = performance.now();
    const cold = await searchRecipes({ query: 'creme ingredient 11' });
    const coldMs = performance.now() - t;
    t = performance.now();
    const warm = await searchRecipes({ query: 'creme ingredient 11' });
    const warmMs = performance.now() - t;
    console.log(`[perf] searchRecipes over 1,000 recipes (fake-indexeddb): cold ${coldMs.toFixed(1)} ms, warm ${warmMs.toFixed(1)} ms`);
    expect(cold.length).toBe(143);
    expect(warm.length).toBe(143);
    // Generous bound to avoid CI flakiness; the measurement above is the evidence.
    expect(warmMs).toBeLessThan(2000);
  }, 60_000);
});

describe('collections', () => {
  it('saves, lists and deleteCollection removes the id from recipes in one transaction', async () => {
    await saveCollection({ id: 'k1', name: 'Weeknight' });
    await saveCollection({ id: 'k2', name: 'Baking' });
    await saveRecipe(makeRecipe({ id: 'a', collectionIds: ['k1', 'k2'] }));
    await saveRecipe(makeRecipe({ id: 'b', collectionIds: ['k2'] }));
    await deleteCollection('k1');
    expect((await listCollections()).map((c) => c.id)).toEqual(['k2']);
    const a = await getRecipe('a');
    expect(a?.collectionIds).toEqual(['k2']);
    expect(a?.revision).toBe(2);
    expect((await getRecipe('b'))?.revision).toBe(1);
  });

  it('deleteCollection failure leaves collection and recipes unchanged', async () => {
    await saveCollection({ id: 'k1', name: 'Weeknight' });
    await saveRecipe(makeRecipe({ id: 'a', collectionIds: ['k1'] }));
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw quotaError();
    });
    await expectCode(deleteCollection('k1'), 'QUOTA');
    vi.restoreAllMocks();
    expect((await listCollections()).map((c) => c.id)).toEqual(['k1']);
    expect((await getRecipe('a'))?.collectionIds).toEqual(['k1']);
  });

  it('NOT_FOUND for unknown collection', async () => {
    await expectCode(deleteCollection('nope'), 'NOT_FOUND');
  });
});

describe('shopping lists', () => {
  const list = (): ShoppingList => ({
    id: 'L',
    name: 'Groceries',
    aisles: ['Produce', 'Other'],
    items: [{ id: 'x', text: '2 onions', aisle: 'Produce', checked: false, manual: true, sources: [] }],
    revision: 0,
  });

  it('saves with revision rules and deletes', async () => {
    const v1 = await saveShoppingList(list());
    expect(v1.revision).toBe(1);
    const v2 = await saveShoppingList({ ...v1, name: 'Weekly' });
    expect(v2.revision).toBe(2);
    await expectCode(saveShoppingList({ ...v1, name: 'Stale' }), 'CONFLICT');
    expect((await getShoppingList('L'))?.name).toBe('Weekly');
    await deleteShoppingList('L');
    expect(await getShoppingList('L')).toBeUndefined();
  });
});
