/**
 * Raw IndexedDB access: versioned schema, migrations, transaction helpers.
 *
 * Migrations: MIGRATIONS[i] upgrades the schema from version i to i + 1 and
 * runs inside the `versionchange` transaction opened by `onupgradeneeded`.
 * If any step throws, the upgrade transaction is aborted, the database stays
 * at its previous version and existing records are untouched. To add a
 * version, append a step; never edit or reorder published steps.
 */
import { DB_NAME, StorageError, mapError } from './errors';
import { resetMemoryState } from './state';

export const STORES = {
  recipes: 'recipes',
  collections: 'collections',
  shoppingLists: 'shoppingLists',
  images: 'images',
  meta: 'meta',
} as const;
export type StoreName = (typeof STORES)[keyof typeof STORES];

/** Meta keys. `meta` records are `{ key, value }`. No timestamps or access history are stored. */
export const META_SESSION_ONLY = 'sessionOnly';
export const META_PREFERENCES = 'preferences';

export type MigrationStep = (db: IDBDatabase, tx: IDBTransaction) => void;

export const MIGRATIONS: readonly MigrationStep[] = [
  // v0 -> v1: initial schema.
  (db) => {
    const recipes = db.createObjectStore(STORES.recipes, { keyPath: 'id' });
    recipes.createIndex('sourceUrl', 'source.url', { unique: false });
    recipes.createIndex('collectionIds', 'collectionIds', { unique: false, multiEntry: true });
    recipes.createIndex('tags', 'tags', { unique: false, multiEntry: true });
    db.createObjectStore(STORES.collections, { keyPath: 'id' });
    db.createObjectStore(STORES.shoppingLists, { keyPath: 'id' });
    // Images are stored as { id, mime, bytes: ArrayBuffer } (portable structured clone).
    db.createObjectStore(STORES.images, { keyPath: 'id' });
    db.createObjectStore(STORES.meta, { keyPath: 'key' });
  },
];

export const DB_VERSION = MIGRATIONS.length;

function factory(): IDBFactory {
  const f = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!f) throw new Error('IndexedDB is not available in this context');
  return f;
}

/**
 * Open `name` at `migrations.length`, running every pending step in the
 * upgrade transaction. Exported for migration tests; app code uses getDb().
 */
export function openWithMigrations(name: string, migrations: readonly MigrationStep[]): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory().open(name, migrations.length);
    } catch (err) {
      reject(mapError(err));
      return;
    }
    let upgradeError: unknown;
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      if (!tx) return;
      const from = event.oldVersion;
      try {
        for (let v = from; v < migrations.length; v++) {
          const step = migrations[v];
          if (step) step(db, tx);
        }
      } catch (err) {
        upgradeError = err;
        try {
          tx.abort();
        } catch {
          /* already aborting */
        }
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        // Another page wants to upgrade or delete the database: let it.
        db.close();
        if (cached && cachedDb === db) {
          cached = null;
          cachedDb = null;
        }
      };
      resolve(db);
    };
    request.onerror = () => {
      reject(mapError(upgradeError ?? request.error));
    };
    request.onblocked = () => {
      // Older connections in other pages receive versionchange and close themselves.
    };
  });
}

let cached: Promise<IDBDatabase> | null = null;
let cachedDb: IDBDatabase | null = null;

export function getDb(): Promise<IDBDatabase> {
  if (!cached) {
    const p = openWithMigrations(DB_NAME, MIGRATIONS).then((db) => {
      cachedDb = db;
      return db;
    });
    cached = p;
    p.catch(() => {
      if (cached === p) cached = null;
    });
  }
  return cached;
}

/** Close this page's connection and reset in-memory caches (session preferences, search index). */
export async function closeDatabase(): Promise<void> {
  const p = cached;
  cached = null;
  cachedDb = null;
  resetMemoryState();
  if (p) {
    try {
      (await p).close();
    } catch {
      /* open failed; nothing to close */
    }
  }
}

/** Promise wrapper for a single request. */
export function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export interface TxOptions {
  /** Reject with SESSION_ONLY (and write nothing) when session-only mode is on. Read inside the same transaction. */
  checkSession?: boolean;
}

/**
 * Run `fn` inside exactly one transaction. `fn` may only await IndexedDB
 * requests from `tx` (any other await would let the transaction auto-commit).
 * Resolves after `complete`; any thrown error or failed request aborts the
 * whole transaction, so nothing from this operation is written.
 */
export async function runTx<T>(
  stores: StoreName[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T> | T,
  opts: TxOptions = {},
): Promise<T> {
  const db = await getDb();
  const names = new Set<StoreName>(stores);
  if (opts.checkSession) names.add(STORES.meta);
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction([...names], mode);
    } catch (err) {
      reject(mapError(err));
      return;
    }
    let result: T;
    let failure: unknown;
    let failed = false;
    tx.oncomplete = () => (failed ? reject(failure) : resolve(result));
    tx.onabort = () => reject(failed ? failure : mapError(tx.error ?? new Error('Transaction aborted')));
    (async () => {
      if (opts.checkSession) {
        const flag = await req(tx.objectStore(STORES.meta).get(META_SESSION_ONLY));
        if ((flag as { value?: unknown } | undefined)?.value === true) {
          throw new StorageError('SESSION_ONLY', 'Session-only mode is on: nothing is saved on this device.');
        }
      }
      result = await fn(tx);
    })().catch((err: unknown) => {
      failed = true;
      failure = mapError(err);
      try {
        tx.abort();
      } catch {
        /* already finished or aborting */
      }
    });
  });
}

/**
 * Delete the whole database. Closes this page's handle first; other pages
 * close theirs on `versionchange`. If still blocked after `timeoutMs`, rejects
 * with BLOCKED (the delete request stays queued and completes once the last
 * connection closes).
 */
export async function deleteDatabase(opts: { timeoutMs?: number; onBlocked?: () => void } = {}): Promise<void> {
  await closeDatabase();
  const timeoutMs = opts.timeoutMs ?? 10_000;
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };
    let request: IDBOpenDBRequest;
    try {
      request = factory().deleteDatabase(DB_NAME);
    } catch (err) {
      reject(mapError(err));
      return;
    }
    request.onsuccess = () => done(resolve);
    request.onerror = () => done(() => reject(mapError(request.error)));
    request.onblocked = () => {
      opts.onBlocked?.();
      if (!timer && !settled) {
        timer = setTimeout(
          () =>
            done(() =>
              reject(new StorageError('BLOCKED', 'Close other Recipe Pocket tabs or windows to finish deleting all data.')),
            ),
          timeoutMs,
        );
      }
    };
  });
  resetMemoryState();
}
