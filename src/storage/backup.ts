/**
 * Versioned JSON backups (PRD R10): export, validated preview, atomic commit.
 *
 * previewImport never writes. commitImport re-validates the preview, decodes
 * and re-encodes images before opening the transaction (image decoding is
 * async and would otherwise auto-commit it), then writes everything in one
 * readwrite transaction: either all changes land or none do.
 */
import type { BackupFileV1, Collection, LocalImage, RecipeV1, ShoppingList } from '../shared/types';
import { STORES, req, runTx } from './db';
import { IMAGE_MAX_BYTES, IMPORT_MAX_BYTES, IMPORT_MAX_DEPTH, StorageError } from './errors';
import { type Bytes, type StoredImage, bytesToBase64, parseImageDataUrl, prepareImageBytes, sniffImageMime } from './images';
import {
  type SanitizeContext,
  ValidationError,
  sanitizeCollection,
  sanitizeRecipe,
  sanitizeShoppingList,
} from './validate';

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

export const BACKUP_FORMAT = 'recipe-pocket-backup';
export const BACKUP_VERSION = 1;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function invalid(reason: string): StorageError {
  return new StorageError('INVALID_BACKUP', reason);
}

/** UTF-8 byte length without allocating an encoded copy. */
export function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/** Max bracket nesting of JSON text, scanned before parsing (strings skipped). */
function jsonTextDepth(text: string, limit: number): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 0x5c) i++; // backslash: skip escaped char
      else if (c === 0x22) inString = false;
    } else if (c === 0x22) inString = true;
    else if (c === 0x7b || c === 0x5b) {
      depth++;
      if (depth > max) {
        max = depth;
        if (max > limit) return max;
      }
    } else if (c === 0x7d || c === 0x5d) depth--;
  }
  return max;
}

/** Reject prototype-pollution keys anywhere and enforce depth on the parsed tree. */
function scanTree(root: unknown): void {
  const stack: { v: unknown; depth: number }[] = [{ v: root, depth: 0 }];
  while (stack.length) {
    const { v, depth } = stack.pop()!;
    if (typeof v !== 'object' || v === null) continue;
    const d = depth + 1;
    if (d > IMPORT_MAX_DEPTH) throw invalid(`The backup is nested more than ${IMPORT_MAX_DEPTH} levels deep.`);
    if (Array.isArray(v)) {
      for (const x of v) stack.push({ v: x, depth: d });
    } else {
      for (const k of Object.keys(v)) {
        if (FORBIDDEN_KEYS.has(k)) throw invalid('The backup contains a forbidden field name (__proto__, constructor or prototype).');
        stack.push({ v: (v as Record<string, unknown>)[k], depth: d });
      }
    }
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Pre-version-1 ("legacy", version 0) layout, defined for migration:
 * { format: 'recipe-pocket-backup', version: 0,
 *   recipes: [{ id, name, url?, ingredients: string[], steps: string[], tags?, notes?, collections?: string[] }],
 *   collections?: [{ id, name }] }
 */
function migrateV0toV1(o: Obj): Obj {
  if (!Array.isArray(o.recipes)) throw invalid('recipes must be a list.');
  const recipes = o.recipes.map((r: unknown, i: number) => {
    if (!isObj(r)) throw invalid(`recipes[${i}] must be an object.`);
    const rid = r.id;
    const lines = (v: unknown, field: string): string[] => {
      if (v === undefined) return [];
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw invalid(`recipes[${i}].${field} must be a list of text.`);
      return v as string[];
    };
    const ingredients = lines(r.ingredients, 'ingredients');
    const steps = lines(r.steps, 'steps');
    const missing: string[] = [];
    if (ingredients.length === 0) missing.push('ingredients');
    if (steps.length === 0) missing.push('instructions');
    return {
      schemaVersion: 1,
      id: rid,
      title: r.name,
      source: { url: r.url ?? '' },
      originalYield: { text: '' },
      times: { raw: '' },
      ingredientGroups: [
        { id: `${String(rid)}-ig0`, title: '', items: ingredients.map((raw, n) => ({ id: `${String(rid)}-i${n}`, raw, confidence: 'low' })) },
      ],
      instructionGroups: [{ id: `${String(rid)}-sg0`, title: '', steps: steps.map((text, n) => ({ id: `${String(rid)}-s${n}`, text })) }],
      notes: r.notes ?? '',
      tags: r.tags ?? [],
      collectionIds: r.collections ?? [],
      extraction: { method: 'manual', missingFields: missing, warnings: [] },
      revision: 0,
    };
  });
  return {
    format: BACKUP_FORMAT,
    version: 1,
    recipes,
    collections: o.collections ?? [],
    shoppingLists: [],
  };
}

/** BACKUP_MIGRATIONS[v] upgrades a parsed backup from version v to v + 1. */
const BACKUP_MIGRATIONS: readonly ((o: Obj) => Obj)[] = [migrateV0toV1];

function assertUniqueIds(items: { id: string }[], label: string): void {
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.id)) throw invalid(`The backup contains the same ${label} id more than once.`);
    seen.add(it.id);
  }
}

/** Validate and sanitize a version-1 backup object (unknown fields dropped). */
export function sanitizeBackupV1(o: unknown, warnings: string[] = []): BackupFileV1 {
  if (!isObj(o)) throw invalid('The backup must be a JSON object.');
  if (o.format !== BACKUP_FORMAT || o.version !== BACKUP_VERSION) throw invalid('This file is not a Recipe Pocket backup.');
  const ctx: SanitizeContext = { stripped: 0 };
  for (const k of Object.keys(o)) {
    if (!['format', 'version', 'recipes', 'collections', 'shoppingLists', 'images'].includes(k)) ctx.stripped++;
  }
  const list = (v: unknown, name: string, required: boolean): unknown[] => {
    if (v === undefined && !required) return [];
    if (!Array.isArray(v)) throw invalid(`${name} must be a list.`);
    return v;
  };
  try {
    const recipes = list(o.recipes, 'recipes', true).map((r, i) => sanitizeRecipe(r, `recipes[${i}]`, { ctx }));
    const collections = list(o.collections, 'collections', false).map((c, i) => sanitizeCollection(c, `collections[${i}]`, { ctx }));
    const shoppingLists = list(o.shoppingLists, 'shoppingLists', false).map((l, i) =>
      sanitizeShoppingList(l, `shoppingLists[${i}]`, { ctx }),
    );
    assertUniqueIds(recipes, 'recipe');
    assertUniqueIds(collections, 'collection');
    assertUniqueIds(shoppingLists, 'shopping list');
    const out: BackupFileV1 = { format: BACKUP_FORMAT, version: 1, recipes, collections, shoppingLists };
    if (o.images !== undefined && o.images !== null) {
      const images = list(o.images, 'images', true).map((img, i) => {
        if (!isObj(img)) throw invalid(`images[${i}] must be an object.`);
        for (const k of Object.keys(img)) if (!['id', 'mime', 'dataUrl'].includes(k)) ctx.stripped++;
        if (typeof img.id !== 'string' || img.id.length === 0 || img.id.length > 256) throw invalid(`images[${i}].id must be a non-empty id.`);
        if (typeof img.dataUrl !== 'string') throw invalid(`images[${i}].dataUrl must be text.`);
        const parsed = parseImageDataUrl(img.dataUrl);
        if (!parsed) throw invalid(`images[${i}] must be a PNG, JPEG or WebP data URL.`);
        if (parsed.bytes.byteLength > IMAGE_MAX_BYTES) throw invalid(`images[${i}] is larger than 5 MB.`);
        if (img.mime !== parsed.mime || sniffImageMime(parsed.bytes) !== parsed.mime) {
          throw invalid(`images[${i}] content does not match a PNG, JPEG or WebP image.`);
        }
        return { id: img.id, mime: parsed.mime, dataUrl: img.dataUrl };
      });
      assertUniqueIds(images, 'image');
      out.images = images;
    }
    if (ctx.stripped > 0) warnings.push(`Ignored ${ctx.stripped} unknown field(s).`);
    return out;
  } catch (err) {
    if (err instanceof ValidationError) throw invalid(`Invalid backup: ${err.message}.`);
    throw err;
  }
}

/** Size, JSON, depth, prototype-key, format and version checks, then migration and sanitization. */
export function parseBackupText(text: string, warnings: string[] = []): BackupFileV1 {
  if (typeof text !== 'string') throw invalid('The backup must be text.');
  if (text.length > IMPORT_MAX_BYTES || utf8ByteLength(text) > IMPORT_MAX_BYTES) {
    throw invalid('The backup is larger than 10 MB.');
  }
  if (jsonTextDepth(text, IMPORT_MAX_DEPTH) > IMPORT_MAX_DEPTH) {
    throw invalid(`The backup is nested more than ${IMPORT_MAX_DEPTH} levels deep.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw invalid('The file is not valid JSON.');
  }
  scanTree(parsed);
  if (!isObj(parsed)) throw invalid('The backup must be a JSON object.');
  if (parsed.format !== BACKUP_FORMAT) throw invalid('This file is not a Recipe Pocket backup.');
  const version = parsed.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    throw invalid('The backup version is missing or invalid.');
  }
  if (version > BACKUP_VERSION) throw invalid('This backup was made by a newer version of Recipe Pocket.');
  let current: Obj = parsed;
  for (let v = version; v < BACKUP_VERSION; v++) {
    const step = BACKUP_MIGRATIONS[v];
    if (!step) throw invalid('This backup version cannot be imported.');
    current = step(current);
  }
  if (version < BACKUP_VERSION) warnings.push(`Converted a version ${version} backup to version ${BACKUP_VERSION}.`);
  return sanitizeBackupV1(current, warnings);
}

export async function exportBackup(opts?: { includeImages?: boolean }): Promise<string> {
  const includeImages = opts?.includeImages ?? false;
  const stores = [STORES.recipes, STORES.collections, STORES.shoppingLists, ...(includeImages ? [STORES.images] : [])];
  const data = await runTx(stores, 'readonly', async (tx) => {
    const recipes = (await req(tx.objectStore(STORES.recipes).getAll())) as RecipeV1[];
    const collections = (await req(tx.objectStore(STORES.collections).getAll())) as Collection[];
    const shoppingLists = (await req(tx.objectStore(STORES.shoppingLists).getAll())) as ShoppingList[];
    const images = includeImages ? ((await req(tx.objectStore(STORES.images).getAll())) as StoredImage[]) : undefined;
    return { recipes, collections, shoppingLists, images };
  });
  const backup: BackupFileV1 = {
    format: BACKUP_FORMAT,
    version: 1,
    recipes: data.recipes,
    collections: data.collections,
    shoppingLists: data.shoppingLists,
  };
  if (data.images) {
    backup.images = data.images.map((img) => ({
      id: img.id,
      mime: img.mime,
      dataUrl: `data:${img.mime};base64,${bytesToBase64(new Uint8Array(img.bytes))}`,
    }));
  }
  // Compact JSON keeps the file as small as possible (imports are capped at 10 MB).
  return JSON.stringify(backup);
}

export async function previewImport(text: string): Promise<ImportPreview> {
  const warnings: string[] = [];
  const backup = parseBackupText(text, warnings);
  const existing = await runTx([STORES.recipes], 'readonly', async (tx) => {
    return (await req(tx.objectStore(STORES.recipes).getAll())) as RecipeV1[];
  });
  const byId = new Map(existing.map((r) => [r.id, r]));
  const byUrl = new Map<string, RecipeV1>();
  for (const r of existing) if (r.source.url && !byUrl.has(r.source.url)) byUrl.set(r.source.url, r);
  const conflicts: ImportPreview['conflicts'] = [];
  for (const r of backup.recipes) {
    const sameId = byId.get(r.id);
    if (sameId) {
      conflicts.push({ incomingId: r.id, existingId: sameId.id, title: r.title, reason: 'id' });
      continue;
    }
    const sameUrl = r.source.url ? byUrl.get(r.source.url) : undefined;
    if (sameUrl) conflicts.push({ incomingId: r.id, existingId: sameUrl.id, title: r.title, reason: 'source' });
  }
  return {
    backup,
    recipeCount: backup.recipes.length,
    collectionCount: backup.collections.length,
    shoppingListCount: backup.shoppingLists.length,
    imageCount: backup.images?.length ?? 0,
    conflicts,
    warnings,
  };
}

const newId = (): string => crypto.randomUUID();

export async function commitImport(preview: ImportPreview, resolution: ConflictResolution = 'skip'): Promise<ImportResult> {
  if (resolution !== 'skip' && resolution !== 'duplicate' && resolution !== 'replace') {
    throw invalid('Unknown conflict resolution.');
  }
  // Re-validate: the preview object may have been modified since previewImport.
  const backup = sanitizeBackupV1(preview?.backup);

  // Decode and re-encode images before the transaction (async work outside IndexedDB).
  const prepared = new Map<string, { bytes: Bytes; mime: LocalImage['mime'] }>();
  for (const img of backup.images ?? []) {
    const parsed = parseImageDataUrl(img.dataUrl);
    if (!parsed) throw invalid('An image in the backup is not a valid data URL.');
    try {
      prepared.set(img.id, await prepareImageBytes(parsed.bytes));
    } catch (err) {
      if (err instanceof StorageError && err.code === 'UNSUPPORTED_MEDIA') {
        throw invalid(`An image in the backup could not be processed: ${err.message}`);
      }
      throw err;
    }
  }

  return runTx(
    [STORES.recipes, STORES.collections, STORES.shoppingLists, STORES.images],
    'readwrite',
    async (tx) => {
      const recipeStore = tx.objectStore(STORES.recipes);
      const collectionStore = tx.objectStore(STORES.collections);
      const listStore = tx.objectStore(STORES.shoppingLists);
      const imageStore = tx.objectStore(STORES.images);

      // Conflicts are recomputed here, against the state inside this transaction.
      const existingRecipes = (await req(recipeStore.getAll())) as RecipeV1[];
      const existingCollections = (await req(collectionStore.getAll())) as Collection[];
      const existingLists = (await req(listStore.getAll())) as ShoppingList[];
      const existingImageIds = new Set((await req(imageStore.getAllKeys())) as string[]);

      const recipeById = new Map(existingRecipes.map((r) => [r.id, r]));
      const recipeByUrl = new Map<string, RecipeV1>();
      for (const r of existingRecipes) if (r.source.url && !recipeByUrl.has(r.source.url)) recipeByUrl.set(r.source.url, r);
      const collectionById = new Map(existingCollections.map((c) => [c.id, c]));
      const listById = new Map(existingLists.map((l) => [l.id, l]));

      // Collections: identical (same id and name) merge; otherwise per resolution.
      const collectionMap = new Map<string, string>();
      const knownCollections = new Set(collectionById.keys());
      for (const c of backup.collections) {
        const cur = collectionById.get(c.id);
        if (!cur) {
          collectionStore.put(c);
          collectionMap.set(c.id, c.id);
        } else if (cur.name === c.name || resolution === 'skip') {
          collectionMap.set(c.id, c.id);
        } else if (resolution === 'replace') {
          collectionStore.put(c);
          collectionMap.set(c.id, c.id);
        } else {
          const nid = newId();
          collectionStore.put({ ...c, id: nid });
          collectionMap.set(c.id, nid);
        }
        knownCollections.add(collectionMap.get(c.id)!);
      }

      // Images: written only when referenced by a recipe that is written.
      const imageMap = new Map<string, string | null>();
      const resolveImage = (imageId: string | undefined): string | undefined => {
        if (!imageId) return undefined;
        if (imageMap.has(imageId)) return imageMap.get(imageId) ?? undefined;
        const img = prepared.get(imageId);
        let target: string | null;
        if (!img) {
          target = existingImageIds.has(imageId) ? imageId : null;
        } else if (!existingImageIds.has(imageId) || resolution === 'replace') {
          imageStore.put({ id: imageId, mime: img.mime, bytes: img.bytes.slice().buffer } satisfies StoredImage);
          target = imageId;
        } else if (resolution === 'skip') {
          target = imageId; // keep the local image with this id
        } else {
          target = newId();
          imageStore.put({ id: target, mime: img.mime, bytes: img.bytes.slice().buffer } satisfies StoredImage);
        }
        imageMap.set(imageId, target);
        return target ?? undefined;
      };

      const finalize = (r: RecipeV1, id: string, revision: number): RecipeV1 => {
        const out: RecipeV1 = {
          ...r,
          id,
          revision,
          collectionIds: [...new Set(r.collectionIds.map((c) => collectionMap.get(c) ?? c).filter((c) => knownCollections.has(c)))],
        };
        delete out.localImageId;
        const img = resolveImage(r.localImageId);
        if (img) out.localImageId = img;
        return out;
      };

      const result: ImportResult = { added: 0, replaced: 0, skipped: 0 };
      const recipeMap = new Map<string, string>();
      for (const r of backup.recipes) {
        const sameId = recipeById.get(r.id);
        const conflict = sameId ?? (r.source.url ? recipeByUrl.get(r.source.url) : undefined);
        if (!conflict) {
          recipeStore.put(finalize(r, r.id, 1));
          recipeMap.set(r.id, r.id);
          result.added++;
        } else if (resolution === 'skip') {
          recipeMap.set(r.id, conflict.id);
          result.skipped++;
        } else if (resolution === 'replace') {
          // Replace in place: keep the local id so existing references stay valid.
          recipeStore.put(finalize(r, conflict.id, conflict.revision + 1));
          recipeMap.set(r.id, conflict.id);
          result.replaced++;
        } else {
          const id = sameId ? newId() : r.id;
          recipeStore.put(finalize(r, id, 1));
          recipeMap.set(r.id, id);
          result.added++;
        }
      }

      for (const l of backup.shoppingLists) {
        const remapped: ShoppingList = {
          ...l,
          items: l.items.map((it) => ({
            ...it,
            sources: it.sources.map((s) => ({ ...s, recipeId: recipeMap.get(s.recipeId) ?? s.recipeId })),
          })),
        };
        const cur = listById.get(l.id);
        if (!cur) listStore.put({ ...remapped, revision: 1 });
        else if (resolution === 'replace') listStore.put({ ...remapped, revision: cur.revision + 1 });
        else if (resolution === 'duplicate') listStore.put({ ...remapped, id: newId(), revision: 1 });
        // skip: keep the local list
      }
      return result;
    },
    { checkSession: true },
  );
}
