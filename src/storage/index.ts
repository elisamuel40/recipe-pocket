/**
 * Storage public API (ARCHITECTURE.md "Arithmetic and persistence", PRD R03, R10, R13).
 * Owner: storage. IndexedDB only (never chrome.storage). Usable from any
 * extension page. Tests run against fake-indexeddb.
 *
 * Errors: reject with StorageError whose code is 'QUOTA' | 'INVALID_BACKUP' |
 * 'CONFLICT' | 'SESSION_ONLY' | 'NOT_FOUND'. Failed writes must leave existing
 * records intact (single transaction per operation).
 *
 * Session-only mode: when Preferences.sessionOnly is true every write except
 * setSessionOnly() rejects with SESSION_ONLY, and preferences are kept in
 * memory only for the current page.
 */
import type {
  BackupFileV1,
  Collection,
  LocalImage,
  Preferences,
  RecipeV1,
  ShoppingList,
} from '../shared/types';

export type StorageErrorCode = 'QUOTA' | 'INVALID_BACKUP' | 'CONFLICT' | 'SESSION_ONLY' | 'NOT_FOUND';

export class StorageError extends Error {
  constructor(
    public readonly code: StorageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export const DB_NAME = 'recipe-pocket';
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export type ConflictResolution = 'skip' | 'duplicate' | 'replace';

export interface ImportPreview {
  /** Parsed, validated and migrated backup (never written until commitImport). */
  backup: BackupFileV1;
  recipeCount: number;
  collectionCount: number;
  shoppingListCount: number;
  imageCount: number;
  /** Incoming recipes whose id or normalized source URL already exists. */
  conflicts: { incomingId: string; existingId: string; title: string; reason: 'id' | 'source' }[];
  warnings: string[];
}

export interface ImportResult {
  added: number;
  replaced: number;
  skipped: number;
}

export interface SearchOptions {
  query?: string;
  collectionId?: string;
  tag?: string;
}

const todo = (name: string): never => {
  throw new Error(`${name}: not implemented`);
};

// ---- Recipes ----
export async function listRecipes(): Promise<RecipeV1[]> { return todo('listRecipes'); }
export async function getRecipe(id: string): Promise<RecipeV1 | undefined> { void id; return todo('getRecipe'); }
/**
 * Insert or update. For updates, recipe.revision must equal the stored
 * revision (else CONFLICT). Returns the stored record with revision + 1.
 */
export async function saveRecipe(recipe: RecipeV1): Promise<RecipeV1> { void recipe; return todo('saveRecipe'); }
export async function deleteRecipe(id: string): Promise<void> { void id; return todo('deleteRecipe'); }
/** Duplicate detection (R03): saved recipes with the same normalized source URL. */
export async function findBySourceUrl(url: string): Promise<RecipeV1[]> { void url; return todo('findBySourceUrl'); }
/** Local search across title, tags and ingredient text (target < 200 ms at 1,000 recipes). */
export async function searchRecipes(opts: SearchOptions): Promise<RecipeV1[]> { void opts; return todo('searchRecipes'); }

// ---- Collections ----
export async function listCollections(): Promise<Collection[]> { return todo('listCollections'); }
export async function saveCollection(c: Collection): Promise<Collection> { void c; return todo('saveCollection'); }
/** Deletes the collection and removes its id from every recipe (one transaction). */
export async function deleteCollection(id: string): Promise<void> { void id; return todo('deleteCollection'); }

// ---- Shopping lists ----
export async function listShoppingLists(): Promise<ShoppingList[]> { return todo('listShoppingLists'); }
export async function getShoppingList(id: string): Promise<ShoppingList | undefined> { void id; return todo('getShoppingList'); }
export async function saveShoppingList(list: ShoppingList): Promise<ShoppingList> { void list; return todo('saveShoppingList'); }
export async function deleteShoppingList(id: string): Promise<void> { void id; return todo('deleteShoppingList'); }

// ---- Images ----
/** Validates type (PNG/JPEG/WebP; SVG/HTML rejected) and size, decodes and re-encodes, stores. */
export async function putImage(file: Blob): Promise<LocalImage> { void file; return todo('putImage'); }
export async function getImage(id: string): Promise<LocalImage | undefined> { void id; return todo('getImage'); }
export async function deleteImage(id: string): Promise<void> { void id; return todo('deleteImage'); }

// ---- Preferences ----
export async function getPreferences(): Promise<Preferences> { return todo('getPreferences'); }
export async function setPreferences(p: Partial<Preferences>): Promise<Preferences> { void p; return todo('setPreferences'); }
/** The only write allowed in session-only mode: persists the flag itself. */
export async function setSessionOnly(on: boolean): Promise<void> { void on; return todo('setSessionOnly'); }

// ---- Totals / delete all ----
export async function countAll(): Promise<{ recipes: number; collections: number; shoppingLists: number; images: number }> { return todo('countAll'); }
/** Closes DB handles and deletes the whole database (R13). */
export async function deleteAllData(): Promise<void> { return todo('deleteAllData'); }

// ---- Backups (R10) ----
/** Serialize everything to a BackupFileV1 JSON string. */
export async function exportBackup(opts?: { includeImages?: boolean }): Promise<string> { void opts; return todo('exportBackup'); }
/**
 * Parse and validate (size <= 10 MB, schema, prototype keys, depth, http(s)
 * source links), migrate older versions, and compute conflicts. No writes.
 */
export async function previewImport(text: string): Promise<ImportPreview> { void text; return todo('previewImport'); }
/** Atomic commit: either everything is written or nothing is. No overwrite by default (resolution 'skip'). */
export async function commitImport(preview: ImportPreview, resolution: ConflictResolution): Promise<ImportResult> { void preview; void resolution; return todo('commitImport'); }
