import { beforeEach, describe, expect, it } from 'vitest';
import { PNG, makeRecipe, resetDb, usePassthroughReencoder } from './helpers';
import {
  StorageError,
  closeDatabase,
  commitImport,
  countAll,
  deleteCollection,
  deleteImage,
  deleteRecipe,
  deleteShoppingList,
  exportBackup,
  getPreferences,
  listRecipes,
  previewImport,
  putImage,
  saveCollection,
  saveRecipe,
  saveShoppingList,
  setPreferences,
  setSessionOnly,
} from '../../src/storage';
import { DEFAULT_PREFERENCES } from '../../src/shared/types';

beforeEach(resetDb);

/** Dump every store (except meta) for before/after comparison. */
async function snapshot(): Promise<string> {
  const counts = await countAll();
  return JSON.stringify({ counts, backup: await exportBackup({ includeImages: true }) });
}

async function rejectsSessionOnly(p: Promise<unknown>): Promise<void> {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(StorageError);
  expect((err as StorageError).code).toBe('SESSION_ONLY');
}

describe('preferences (normal mode)', () => {
  it('returns defaults, persists changes, validates input', async () => {
    expect(await getPreferences()).toEqual(DEFAULT_PREFERENCES);
    const next = await setPreferences({ theme: 'dark', fontScale: 1.5 });
    expect(next).toMatchObject({ theme: 'dark', fontScale: 1.5, sessionOnly: false });
    await closeDatabase(); // new page / restart
    expect((await getPreferences()).theme).toBe('dark');
    await expect(setPreferences({ fontScale: 9 })).rejects.toMatchObject({ code: 'INVALID_RECORD' });
    await expect(setPreferences({ theme: 'neon' as never })).rejects.toMatchObject({ code: 'INVALID_RECORD' });
  });
});

describe('session-only mode', () => {
  it('rejects every write with SESSION_ONLY and leaves the database unchanged', async () => {
    usePassthroughReencoder();
    const r = await saveRecipe(makeRecipe({ id: 'a' }));
    await saveCollection({ id: 'k', name: 'K' });
    const list = await saveShoppingList({ id: 'L', name: 'L', aisles: [], items: [], revision: 0 });
    const img = await putImage(new Blob([PNG]));
    await setPreferences({ theme: 'light' });
    const before = await snapshot();

    await setSessionOnly(true);
    await rejectsSessionOnly(saveRecipe(makeRecipe({ id: 'b' })));
    await rejectsSessionOnly(saveRecipe({ ...r, title: 'edit' }));
    await rejectsSessionOnly(deleteRecipe('a'));
    await rejectsSessionOnly(saveCollection({ id: 'k2', name: 'K2' }));
    await rejectsSessionOnly(deleteCollection('k'));
    await rejectsSessionOnly(saveShoppingList({ ...list, name: 'x' }));
    await rejectsSessionOnly(deleteShoppingList('L'));
    await rejectsSessionOnly(putImage(new Blob([PNG])));
    await rejectsSessionOnly(deleteImage(img.id));
    const text = JSON.stringify({ format: 'recipe-pocket-backup', version: 1, recipes: [makeRecipe({ id: 'imp' })], collections: [], shoppingLists: [] });
    await rejectsSessionOnly(commitImport(await previewImport(text), 'skip'));

    expect(await snapshot()).toBe(before);
    // Reads still work.
    expect((await listRecipes()).map((x) => x.id)).toEqual(['a']);
  });

  it('keeps preference changes in memory only, merged over defaults and stored prefs', async () => {
    await setPreferences({ theme: 'light' });
    await setSessionOnly(true);
    const p = await setPreferences({ fontScale: 2, unitSystem: 'metric' });
    expect(p).toEqual({ ...DEFAULT_PREFERENCES, theme: 'light', fontScale: 2, unitSystem: 'metric', sessionOnly: true });

    // A new page (or restart) sees the persisted flag but none of the in-memory changes.
    await closeDatabase();
    expect(await getPreferences()).toEqual({ ...DEFAULT_PREFERENCES, theme: 'light', sessionOnly: true });

    // Turning session-only off restores the persisted preferences.
    await setSessionOnly(false);
    expect(await getPreferences()).toEqual({ ...DEFAULT_PREFERENCES, theme: 'light' });
  });

  it('applies across pages: the flag is read inside each write transaction', async () => {
    await setSessionOnly(true);
    // Simulate another page whose in-memory state never saw the toggle.
    await closeDatabase();
    await rejectsSessionOnly(saveRecipe(makeRecipe()));
    await setSessionOnly(false);
    await expect(saveRecipe(makeRecipe({ id: 'ok' }))).resolves.toMatchObject({ id: 'ok' });
  });

  it('setPreferences({ sessionOnly }) delegates to setSessionOnly', async () => {
    await setPreferences({ sessionOnly: true, theme: 'dark' });
    expect(await getPreferences()).toMatchObject({ sessionOnly: true, theme: 'dark' });
    await closeDatabase();
    expect(await getPreferences()).toMatchObject({ sessionOnly: true, theme: 'system' });
  });
});
