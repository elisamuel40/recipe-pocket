import { beforeEach, describe, expect, it } from 'vitest';
import { PNG, makeRecipe, resetDb, usePassthroughReencoder } from './helpers';
import {
  DB_NAME,
  StorageError,
  countAll,
  deleteAllData,
  getPreferences,
  putImage,
  saveCollection,
  saveRecipe,
  saveShoppingList,
  searchRecipes,
  setPreferences,
  setSessionOnly,
} from '../../src/storage';
import { DEFAULT_PREFERENCES } from '../../src/shared/types';

beforeEach(resetDb);

async function dbExists(): Promise<boolean> {
  const dbs = await indexedDB.databases();
  return dbs.some((d) => d.name === DB_NAME);
}

describe('deleteAllData', () => {
  it('removes every store and resets preferences and caches', async () => {
    usePassthroughReencoder();
    await saveRecipe(makeRecipe({ id: 'a', title: 'Soup' }));
    await saveCollection({ id: 'k', name: 'K' });
    await saveShoppingList({ id: 'L', name: 'L', aisles: [], items: [], revision: 0 });
    await putImage(new Blob([PNG]));
    await setPreferences({ theme: 'dark' });
    expect((await searchRecipes({ query: 'soup' })).length).toBe(1); // warm the search cache

    await deleteAllData();
    expect(await dbExists()).toBe(false);
    expect(await countAll()).toEqual({ recipes: 0, collections: 0, shoppingLists: 0, images: 0 });
    expect(await getPreferences()).toEqual(DEFAULT_PREFERENCES);
    expect(await searchRecipes({ query: 'soup' })).toEqual([]);
  });

  it('works in session-only mode and keeps session-only on', async () => {
    await saveRecipe(makeRecipe());
    await setSessionOnly(true);
    await deleteAllData();
    expect((await countAll()).recipes).toBe(0);
    expect((await getPreferences()).sessionOnly).toBe(true);
    await expect(saveRecipe(makeRecipe())).rejects.toMatchObject({ code: 'SESSION_ONLY' });
  });

  it('a connection that ignores versionchange blocks; rejects with BLOCKED after timeout', async () => {
    await saveRecipe(makeRecipe());
    // A foreign connection that does not close on versionchange.
    const stubborn = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(DB_NAME);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    stubborn.onversionchange = null;
    let blocked = 0;
    const err = await deleteAllData({ timeoutMs: 50, onBlocked: () => blocked++ }).then(() => null, (e: unknown) => e);
    expect(blocked).toBe(1);
    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).code).toBe('BLOCKED');
    stubborn.close(); // the queued delete now completes
    await new Promise((r) => setTimeout(r, 20));
    expect(await dbExists()).toBe(false);
  });
});
