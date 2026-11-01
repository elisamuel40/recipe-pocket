/**
 * Storage public API (ARCHITECTURE.md "Arithmetic and persistence", PRD R03, R10, R13).
 * Owner: storage. IndexedDB only (never chrome.storage). Usable from any
 * extension page. Tests run against fake-indexeddb.
 *
 * Errors: reject with StorageError whose code is 'QUOTA' | 'INVALID_BACKUP' |
 * 'CONFLICT' | 'SESSION_ONLY' | 'NOT_FOUND' | 'INVALID_RECORD' |
 * 'UNSUPPORTED_MEDIA' | 'BLOCKED'. Failed writes leave existing records
 * intact (single transaction per operation).
 *
 * Session-only mode: when Preferences.sessionOnly is true every write except
 * setSessionOnly() (and the deleteAllData() privacy action) rejects with
 * SESSION_ONLY, and preference changes are kept in memory only for the
 * current page. The flag is read inside each write transaction, so it applies
 * across all open extension pages.
 *
 * Privacy: nothing here records access history or timestamps.
 */
import {
  DEFAULT_PREFERENCES,
  type Collection,
  type LocalImage,
  type Preferences,
  type RecipeV1,
  type ShoppingList,
} from '../shared/types';
import {
  META_PREFERENCES,
  META_SESSION_ONLY,
  STORES,
  deleteDatabase,
  req,
  runTx,
} from './db';
import { StorageError } from './errors';
import { type StoredImage, prepareImageBlob, toLocalImage } from './images';
import { filterRecipes, sortByTitle } from './search';
import { sessionPrefs, setSessionPrefs } from './state';
import { normalizeUrl } from './url';
import {
  ValidationError,
  readStoredPreferences,
  sanitizeCollection,
  sanitizePreferencesPatch,
  sanitizeRecipe,
  sanitizeShoppingList,
} from './validate';

export { StorageError, DB_NAME, IMPORT_MAX_BYTES, IMAGE_MAX_BYTES, IMPORT_MAX_DEPTH } from './errors';
export type { StorageErrorCode } from './errors';
export { exportBackup, previewImport, commitImport, utf8ByteLength } from './backup';
export type { ConflictResolution, ImportPreview, ImportResult } from './backup';
export { closeDatabase, DB_VERSION } from './db';
export { setImageReencoder, sniffImageMime } from './images';
export type { ImageReencoder } from './images';
export { foldText } from './search';

export interface SearchOptions {
  query?: string;
  collectionId?: string;
  tag?: string;
}

function asRecordError(err: unknown): unknown {
  return err instanceof ValidationError ? new StorageError('INVALID_RECORD', `Invalid data: ${err.message}.`) : err;
}

function validated<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    throw asRecordError(err);
  }
}

const newId = (): string => crypto.randomUUID();

// ---- Recipes ----
export async function listRecipes(): Promise<RecipeV1[]> {
  const all = await runTx([STORES.recipes], 'readonly', async (tx) => {
    return (await req(tx.objectStore(STORES.recipes).getAll())) as RecipeV1[];
  });
  return sortByTitle(all);
}

export async function getRecipe(id: string): Promise<RecipeV1 | undefined> {
  return runTx([STORES.recipes], 'readonly', async (tx) => {
    return (await req(tx.objectStore(STORES.recipes).get(id))) as RecipeV1 | undefined;
  });
}

/**
 * Insert or update. A recipe with an empty id, or an id not yet stored, is
 * inserted (empty ids get a new UUID) with revision 1. For updates,
 * recipe.revision must equal the stored revision (else CONFLICT). Returns the
 * stored record with revision + 1. The source URL is stored normalized.
 */
export async function saveRecipe(recipe: RecipeV1): Promise<RecipeV1> {
  const clean = validated(() => sanitizeRecipe(recipe, 'recipe', { allowEmptyId: true }));
  if (!clean.id) clean.id = newId();
  return runTx(
    [STORES.recipes],
    'readwrite',
    async (tx) => {
      const store = tx.objectStore(STORES.recipes);
      const cur = (await req(store.get(clean.id))) as RecipeV1 | undefined;
      let stored: RecipeV1;
      if (!cur) {
        stored = { ...clean, revision: 1 };
      } else {
        if (cur.revision !== clean.revision) {
          throw new StorageError('CONFLICT', 'This recipe was changed elsewhere. Reload it before saving.');
        }
        stored = { ...clean, revision: cur.revision + 1 };
      }
      await req(store.put(stored));
      return stored;
    },
    { checkSession: true },
  );
}

export async function deleteRecipe(id: string): Promise<void> {
  await runTx(
    [STORES.recipes],
    'readwrite',
    async (tx) => {
      const store = tx.objectStore(STORES.recipes);
      const cur = await req(store.getKey(id));
      if (cur === undefined) throw new StorageError('NOT_FOUND', 'Recipe not found.');
      await req(store.delete(id));
    },
    { checkSession: true },
  );
}

/** Duplicate detection (R03): saved recipes with the same normalized source URL. */
export async function findBySourceUrl(url: string): Promise<RecipeV1[]> {
  const normalized = normalizeUrl(url);
  if (!normalized) return [];
  return runTx([STORES.recipes], 'readonly', async (tx) => {
    return (await req(tx.objectStore(STORES.recipes).index('sourceUrl').getAll(normalized))) as RecipeV1[];
  });
}

/**
 * Local search across title, tags and ingredient text; case- and
 * diacritic-insensitive; every query word must match. Optional collection and
 * tag filters. Results sorted by title.
 */
export async function searchRecipes(opts: SearchOptions): Promise<RecipeV1[]> {
  const source = await runTx([STORES.recipes], 'readonly', async (tx) => {
    const store = tx.objectStore(STORES.recipes);
    const q = opts.collectionId ? store.index('collectionIds').getAll(opts.collectionId) : store.getAll();
    return (await req(q)) as RecipeV1[];
  });
  return sortByTitle(filterRecipes(source, opts));
}

// ---- Collections ----
export async function listCollections(): Promise<Collection[]> {
  const all = await runTx([STORES.collections], 'readonly', async (tx) => {
    return (await req(tx.objectStore(STORES.collections).getAll())) as Collection[];
  });
  return sortByTitle(all);
}

/** Insert or rename. An empty id gets a new UUID. */
export async function saveCollection(c: Collection): Promise<Collection> {
  const clean = validated(() => sanitizeCollection(c, 'collection', { allowEmptyId: true }));
  if (!clean.id) clean.id = newId();
  return runTx(
    [STORES.collections],
    'readwrite',
    async (tx) => {
      await req(tx.objectStore(STORES.collections).put(clean));
      return clean;
    },
    { checkSession: true },
  );
}

/**
 * Deletes the collection and removes its id from every recipe (one
 * transaction). Affected recipes get revision + 1 so stale editors see CONFLICT.
 */
export async function deleteCollection(id: string): Promise<void> {
  await runTx(
    [STORES.collections, STORES.recipes],
    'readwrite',
    async (tx) => {
      const collections = tx.objectStore(STORES.collections);
      if ((await req(collections.getKey(id))) === undefined) throw new StorageError('NOT_FOUND', 'Collection not found.');
      const recipes = tx.objectStore(STORES.recipes);
      const members = (await req(recipes.index('collectionIds').getAll(id))) as RecipeV1[];
      for (const r of members) {
        recipes.put({ ...r, collectionIds: r.collectionIds.filter((c) => c !== id), revision: r.revision + 1 });
      }
      await req(collections.delete(id));
    },
    { checkSession: true },
  );
}

// ---- Shopping lists ----
export async function listShoppingLists(): Promise<ShoppingList[]> {
  const all = await runTx([STORES.shoppingLists], 'readonly', async (tx) => {
    return (await req(tx.objectStore(STORES.shoppingLists).getAll())) as ShoppingList[];
  });
  return sortByTitle(all);
}

export async function getShoppingList(id: string): Promise<ShoppingList | undefined> {
  return runTx([STORES.shoppingLists], 'readonly', async (tx) => {
    return (await req(tx.objectStore(STORES.shoppingLists).get(id))) as ShoppingList | undefined;
  });
}

/** Same revision rules as saveRecipe. */
export async function saveShoppingList(list: ShoppingList): Promise<ShoppingList> {
  const clean = validated(() => sanitizeShoppingList(list, 'shoppingList', { allowEmptyId: true }));
  if (!clean.id) clean.id = newId();
  return runTx(
    [STORES.shoppingLists],
    'readwrite',
    async (tx) => {
      const store = tx.objectStore(STORES.shoppingLists);
      const cur = (await req(store.get(clean.id))) as ShoppingList | undefined;
      if (cur && cur.revision !== clean.revision) {
        throw new StorageError('CONFLICT', 'This list was changed elsewhere. Reload it before saving.');
      }
      const stored = { ...clean, revision: cur ? cur.revision + 1 : 1 };
      await req(store.put(stored));
      return stored;
    },
    { checkSession: true },
  );
}

export async function deleteShoppingList(id: string): Promise<void> {
  await runTx(
    [STORES.shoppingLists],
    'readwrite',
    async (tx) => {
      const store = tx.objectStore(STORES.shoppingLists);
      if ((await req(store.getKey(id))) === undefined) throw new StorageError('NOT_FOUND', 'Shopping list not found.');
      await req(store.delete(id));
    },
    { checkSession: true },
  );
}

// ---- Images ----
/**
 * Sniffs magic bytes (PNG/JPEG/WebP only; SVG/HTML and anything else
 * rejected with UNSUPPORTED_MEDIA), enforces 5 MB, decodes and re-encodes,
 * then stores under a new id.
 */
export async function putImage(file: Blob): Promise<LocalImage> {
  const { bytes, mime } = await prepareImageBlob(file);
  const rec: StoredImage = { id: newId(), mime, bytes: bytes.slice().buffer };
  await runTx(
    [STORES.images],
    'readwrite',
    async (tx) => {
      await req(tx.objectStore(STORES.images).add(rec));
    },
    { checkSession: true },
  );
  return toLocalImage(rec);
}

export async function getImage(id: string): Promise<LocalImage | undefined> {
  const rec = await runTx([STORES.images], 'readonly', async (tx) => {
    return (await req(tx.objectStore(STORES.images).get(id))) as StoredImage | undefined;
  });
  return rec ? toLocalImage(rec) : undefined;
}

/** Deletes the image and clears localImageId on recipes that used it (one transaction). */
export async function deleteImage(id: string): Promise<void> {
  await runTx(
    [STORES.images, STORES.recipes],
    'readwrite',
    async (tx) => {
      const images = tx.objectStore(STORES.images);
      if ((await req(images.getKey(id))) === undefined) throw new StorageError('NOT_FOUND', 'Image not found.');
      const recipes = tx.objectStore(STORES.recipes);
      const all = (await req(recipes.getAll())) as RecipeV1[];
      for (const r of all) {
        if (r.localImageId === id) {
          const next: RecipeV1 = { ...r, revision: r.revision + 1 };
          delete next.localImageId;
          recipes.put(next);
        }
      }
      await req(images.delete(id));
    },
    { checkSession: true },
  );
}

// ---- Preferences ----
async function readPrefsState(): Promise<{ sessionOnly: boolean; stored: Partial<Preferences> }> {
  return runTx([STORES.meta], 'readonly', async (tx) => {
    const meta = tx.objectStore(STORES.meta);
    const flag = (await req(meta.get(META_SESSION_ONLY))) as { value?: unknown } | undefined;
    const prefs = (await req(meta.get(META_PREFERENCES))) as { value?: unknown } | undefined;
    return { sessionOnly: flag?.value === true, stored: readStoredPreferences(prefs?.value) };
  });
}

/**
 * Normal mode: DEFAULT_PREFERENCES < persisted preferences.
 * Session-only mode: DEFAULT_PREFERENCES < persisted preferences (read only,
 * left from before session-only was turned on) < in-memory changes.
 */
export async function getPreferences(): Promise<Preferences> {
  const { sessionOnly, stored } = await readPrefsState();
  if (sessionOnly) return { ...DEFAULT_PREFERENCES, ...stored, ...sessionPrefs, sessionOnly: true };
  return { ...DEFAULT_PREFERENCES, ...stored, sessionOnly: false };
}

/**
 * Update preferences. In session-only mode changes stay in memory for this
 * page only. A `sessionOnly` key is applied first via setSessionOnly().
 */
export async function setPreferences(p: Partial<Preferences>): Promise<Preferences> {
  const patch = validated(() => sanitizePreferencesPatch(p));
  if (p.sessionOnly !== undefined) {
    if (typeof p.sessionOnly !== 'boolean') throw new StorageError('INVALID_RECORD', 'Invalid data: preferences.sessionOnly must be true or false.');
    await setSessionOnly(p.sessionOnly);
  }
  const wroteToMemory = await runTx([STORES.meta], 'readwrite', async (tx) => {
    const meta = tx.objectStore(STORES.meta);
    const flag = (await req(meta.get(META_SESSION_ONLY))) as { value?: unknown } | undefined;
    if (flag?.value === true) return true; // no persistent write
    const cur = (await req(meta.get(META_PREFERENCES))) as { value?: unknown } | undefined;
    const next = { ...readStoredPreferences(cur?.value), ...patch };
    await req(meta.put({ key: META_PREFERENCES, value: next }));
    return false;
  });
  if (wroteToMemory) setSessionPrefs({ ...sessionPrefs, ...patch });
  return getPreferences();
}

/**
 * The only write allowed in session-only mode: persists the flag itself.
 * This single boolean is the deliberate exception to "session-only writes
 * nothing": without it the choice could not survive a restart, and the next
 * page would silently start saving. Toggling clears in-memory session
 * preferences (they are discarded, never persisted).
 */
export async function setSessionOnly(on: boolean): Promise<void> {
  if (typeof on !== 'boolean') throw new StorageError('INVALID_RECORD', 'Invalid data: sessionOnly must be true or false.');
  await runTx([STORES.meta], 'readwrite', async (tx) => {
    await req(tx.objectStore(STORES.meta).put({ key: META_SESSION_ONLY, value: on }));
  });
  setSessionPrefs({});
}

// ---- Totals / delete all ----
export async function countAll(): Promise<{ recipes: number; collections: number; shoppingLists: number; images: number }> {
  return runTx([STORES.recipes, STORES.collections, STORES.shoppingLists, STORES.images], 'readonly', async (tx) => ({
    recipes: await req(tx.objectStore(STORES.recipes).count()),
    collections: await req(tx.objectStore(STORES.collections).count()),
    shoppingLists: await req(tx.objectStore(STORES.shoppingLists).count()),
    images: await req(tx.objectStore(STORES.images).count()),
  }));
}

/**
 * Closes DB handles and deletes the whole database (R13), then resets
 * in-memory caches. Allowed in session-only mode. Afterwards preferences are
 * back to defaults (session-only off). Exported backup files are outside
 * extension control and are not affected.
 */
export async function deleteAllData(opts?: { timeoutMs?: number; onBlocked?: () => void }): Promise<void> {
  await deleteDatabase(opts);
}
