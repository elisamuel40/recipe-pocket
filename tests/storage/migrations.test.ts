import { beforeEach, describe, expect, it } from 'vitest';
import { makeRecipe, resetDb } from './helpers';
import { DB_NAME, DB_VERSION, closeDatabase, getRecipe, listRecipes, saveRecipe } from '../../src/storage';
import { MIGRATIONS, type MigrationStep, openWithMigrations, req } from '../../src/storage/db';

beforeEach(resetDb);

async function storeNames(db: IDBDatabase): Promise<string[]> {
  return [...db.objectStoreNames].sort();
}

describe('schema', () => {
  it('fresh open creates every store and index at DB_VERSION', async () => {
    const db = await openWithMigrations('fresh', MIGRATIONS);
    expect(db.version).toBe(DB_VERSION);
    expect(await storeNames(db)).toEqual(['collections', 'images', 'meta', 'recipes', 'shoppingLists']);
    const tx = db.transaction('recipes', 'readonly');
    const recipes = tx.objectStore('recipes');
    expect(recipes.keyPath).toBe('id');
    expect([...recipes.indexNames].sort()).toEqual(['collectionIds', 'sourceUrl', 'tags']);
    expect(recipes.index('collectionIds').multiEntry).toBe(true);
    expect(recipes.index('tags').multiEntry).toBe(true);
    expect(recipes.index('sourceUrl').keyPath).toBe('source.url');
    db.close();
  });
});

describe('migration framework', () => {
  // A hypothetical future v2 step: adds a store and transforms existing records with a cursor.
  const v2: MigrationStep = (db, tx) => {
    db.createObjectStore('future', { keyPath: 'id' });
    const cursorReq = tx.objectStore('recipes').openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      cursor.update({ ...cursor.value, notes: `${cursor.value.notes}[migrated]` });
      cursor.continue();
    };
  };

  it('opens a database created by an older version and runs only the pending steps', async () => {
    await saveRecipe(makeRecipe({ id: 'old', notes: 'n' }));
    await closeDatabase();

    const db = await openWithMigrations(DB_NAME, [...MIGRATIONS, v2]);
    expect(db.version).toBe(DB_VERSION + 1);
    expect(await storeNames(db)).toContain('future');
    const rec = await req(db.transaction('recipes').objectStore('recipes').get('old'));
    expect(rec.notes).toBe('n[migrated]');
    db.close();
  });

  it('a failing step aborts the upgrade: version and data unchanged', async () => {
    await saveRecipe(makeRecipe({ id: 'keep', notes: 'n' }));
    await closeDatabase();

    const failing: MigrationStep = (db, tx) => {
      v2(db, tx);
      throw new Error('boom');
    };
    await expect(openWithMigrations(DB_NAME, [...MIGRATIONS, failing])).rejects.toThrow('boom');

    // The app still opens at the old version with records intact.
    const recipes = await listRecipes();
    expect(recipes.map((r) => [r.id, r.notes])).toEqual([['keep', 'n']]);
    const db = await openWithMigrations(DB_NAME, MIGRATIONS);
    expect(db.version).toBe(DB_VERSION);
    expect(await storeNames(db)).not.toContain('future');
    db.close();
  });

  it('an open connection closes itself when another page upgrades (versionchange)', async () => {
    await saveRecipe(makeRecipe({ id: 'a' }));
    // The storage module's cached connection must not block this upgrade.
    const db = await openWithMigrations(DB_NAME, [...MIGRATIONS, (d) => void d.createObjectStore('x')]);
    expect(db.version).toBe(DB_VERSION + 1);
    db.close();
    // The module reopens lazily (at its own version it cannot downgrade: VersionError surfaces).
    await expect(getRecipe('a')).rejects.toMatchObject({ name: 'VersionError' });
  });
});
