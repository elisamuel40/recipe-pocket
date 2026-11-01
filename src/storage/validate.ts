/**
 * Record validation and sanitization. Every sanitizer builds a fresh object
 * containing only known fields (unknown fields are dropped), so nothing
 * unexpected reaches IndexedDB. Text is never transformed (e.g. HTML-looking
 * strings are stored verbatim; rendering escapes them).
 *
 * Errors carry a plain-text reason made only of known field names and array
 * indices, never of input content.
 */
import {
  SCHEMA_VERSION,
  type Collection,
  type Confidence,
  type ExtractionMethod,
  type IngredientGroup,
  type IngredientItem,
  type InstructionGroup,
  type Preferences,
  type QuantityV1,
  type RecipeField,
  type RecipeV1,
  type ShoppingItem,
  type ShoppingList,
  type ThemePreference,
  type UnitSystem,
} from '../shared/types';
import { normalizeUrl } from './url';

export class ValidationError extends Error {
  constructor(
    public readonly path: string,
    reason: string,
  ) {
    super(`${path || 'record'} ${reason}`);
    this.name = 'ValidationError';
  }
}

export interface SanitizeContext {
  /** Number of unknown fields dropped (for import warnings). */
  stripped: number;
}

const MAX_ID_LENGTH = 256;

type Obj = Record<string, unknown>;

function isPlainObject(v: unknown): v is Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function obj(v: unknown, path: string, known: readonly string[], ctx?: SanitizeContext): Obj {
  if (!isPlainObject(v)) throw new ValidationError(path, 'must be an object');
  if (ctx) {
    for (const k of Object.keys(v)) if (!known.includes(k)) ctx.stripped++;
  }
  return v;
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string') throw new ValidationError(path, 'must be text');
  return v;
}

function optStr(v: unknown, path: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  return str(v, path);
}

function id(v: unknown, path: string): string {
  const s = str(v, path);
  if (s.length === 0 || s.length > MAX_ID_LENGTH) throw new ValidationError(path, 'must be a non-empty id');
  return s;
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') throw new ValidationError(path, 'must be true or false');
  return v;
}

function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new ValidationError(path, 'must be a list');
  return v;
}

function strArr(v: unknown, path: string): string[] {
  return arr(v, path).map((x, i) => str(x, `${path}[${i}]`));
}

function int(v: unknown, path: string, min: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min) {
    throw new ValidationError(path, `must be a whole number >= ${min}`);
  }
  return v;
}

function oneOf<T extends string>(v: unknown, path: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new ValidationError(path, `must be one of: ${allowed.join(', ')}`);
  }
  return v as T;
}

/** Assign only defined optional values (keeps records free of `undefined` keys). */
function put<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

const CONFIDENCE: readonly Confidence[] = ['high', 'medium', 'low'];
const METHODS: readonly ExtractionMethod[] = ['json-ld', 'microdata', 'dom', 'manual', 'transcript'];
const FIELDS: readonly RecipeField[] = ['title', 'ingredients', 'instructions', 'yield', 'times', 'author'];
const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];
const UNIT_SYSTEMS: readonly UnitSystem[] = ['original', 'us', 'metric'];

function quantity(v: unknown, path: string, ctx?: SanitizeContext): QuantityV1 | undefined {
  if (v === undefined || v === null) return undefined;
  const o = obj(v, path, ['minNumerator', 'minDenominator', 'maxNumerator', 'maxDenominator'], ctx);
  const q: QuantityV1 = {
    minNumerator: int(o.minNumerator, `${path}.minNumerator`, Number.MIN_SAFE_INTEGER),
    minDenominator: int(o.minDenominator, `${path}.minDenominator`, 1),
  };
  const hasMaxN = o.maxNumerator !== undefined && o.maxNumerator !== null;
  const hasMaxD = o.maxDenominator !== undefined && o.maxDenominator !== null;
  if (hasMaxN !== hasMaxD) throw new ValidationError(path, 'must have both maxNumerator and maxDenominator, or neither');
  if (hasMaxN) {
    q.maxNumerator = int(o.maxNumerator, `${path}.maxNumerator`, Number.MIN_SAFE_INTEGER);
    q.maxDenominator = int(o.maxDenominator, `${path}.maxDenominator`, 1);
  }
  return q;
}

/** Validate a source URL: empty, or http(s) (returned normalized). */
export function sourceUrl(v: unknown, path: string): string {
  const s = str(v, path);
  if (s.trim() === '') return '';
  const n = normalizeUrl(s);
  if (!n) throw new ValidationError(path, 'must be an http or https link');
  return n;
}

function ingredientItem(v: unknown, path: string, ctx?: SanitizeContext): IngredientItem {
  const o = obj(v, path, ['id', 'raw', 'quantity', 'unit', 'ingredient', 'preparation', 'confidence'], ctx);
  const item: IngredientItem = {
    id: id(o.id, `${path}.id`),
    raw: str(o.raw, `${path}.raw`),
    confidence: oneOf(o.confidence, `${path}.confidence`, CONFIDENCE),
  };
  put(item, 'quantity', quantity(o.quantity, `${path}.quantity`, ctx));
  put(item, 'unit', optStr(o.unit, `${path}.unit`));
  put(item, 'ingredient', optStr(o.ingredient, `${path}.ingredient`));
  put(item, 'preparation', optStr(o.preparation, `${path}.preparation`));
  return item;
}

function ingredientGroup(v: unknown, path: string, ctx?: SanitizeContext): IngredientGroup {
  const o = obj(v, path, ['id', 'title', 'items'], ctx);
  return {
    id: id(o.id, `${path}.id`),
    title: str(o.title, `${path}.title`),
    items: arr(o.items, `${path}.items`).map((x, i) => ingredientItem(x, `${path}.items[${i}]`, ctx)),
  };
}

function instructionGroup(v: unknown, path: string, ctx?: SanitizeContext): InstructionGroup {
  const o = obj(v, path, ['id', 'title', 'steps'], ctx);
  return {
    id: id(o.id, `${path}.id`),
    title: str(o.title, `${path}.title`),
    steps: arr(o.steps, `${path}.steps`).map((x, i) => {
      const p = `${path}.steps[${i}]`;
      const s = obj(x, p, ['id', 'text'], ctx);
      return { id: id(s.id, `${p}.id`), text: str(s.text, `${p}.text`) };
    }),
  };
}

const RECIPE_KEYS = [
  'schemaVersion', 'id', 'title', 'source', 'originalYield', 'times', 'ingredientGroups',
  'instructionGroups', 'notes', 'tags', 'collectionIds', 'localImageId', 'extraction', 'revision',
] as const;

/**
 * Validate and sanitize a recipe. With `allowEmptyId`, an empty/missing id is
 * returned as '' so the caller can assign a new one.
 */
export function sanitizeRecipe(
  v: unknown,
  path = 'recipe',
  opts: { allowEmptyId?: boolean; ctx?: SanitizeContext } = {},
): RecipeV1 {
  const { ctx } = opts;
  const o = obj(v, path, RECIPE_KEYS, ctx);
  if (o.schemaVersion !== SCHEMA_VERSION) throw new ValidationError(`${path}.schemaVersion`, `must be ${SCHEMA_VERSION}`);
  const rawId = opts.allowEmptyId && (o.id === undefined || o.id === null || o.id === '') ? '' : id(o.id, `${path}.id`);

  const src = obj(o.source, `${path}.source`, ['url', 'author', 'publisher'], ctx);
  const source: RecipeV1['source'] = { url: sourceUrl(src.url, `${path}.source.url`) };
  put(source, 'author', optStr(src.author, `${path}.source.author`));
  put(source, 'publisher', optStr(src.publisher, `${path}.source.publisher`));

  const y = obj(o.originalYield, `${path}.originalYield`, ['text', 'quantity', 'unit'], ctx);
  const originalYield: RecipeV1['originalYield'] = { text: str(y.text, `${path}.originalYield.text`) };
  put(originalYield, 'quantity', quantity(y.quantity, `${path}.originalYield.quantity`, ctx));
  put(originalYield, 'unit', optStr(y.unit, `${path}.originalYield.unit`));

  const t = obj(o.times, `${path}.times`, ['prep', 'cook', 'total', 'raw'], ctx);
  const times: RecipeV1['times'] = { raw: str(t.raw, `${path}.times.raw`) };
  put(times, 'prep', optStr(t.prep, `${path}.times.prep`));
  put(times, 'cook', optStr(t.cook, `${path}.times.cook`));
  put(times, 'total', optStr(t.total, `${path}.times.total`));

  const e = obj(o.extraction, `${path}.extraction`, ['method', 'missingFields', 'warnings'], ctx);
  const extraction: RecipeV1['extraction'] = {
    method: oneOf(e.method, `${path}.extraction.method`, METHODS),
    missingFields: arr(e.missingFields, `${path}.extraction.missingFields`).map((f, i) =>
      oneOf(f, `${path}.extraction.missingFields[${i}]`, FIELDS),
    ),
    warnings: strArr(e.warnings, `${path}.extraction.warnings`),
  };

  const recipe: RecipeV1 = {
    schemaVersion: SCHEMA_VERSION,
    id: rawId,
    title: str(o.title, `${path}.title`),
    source,
    originalYield,
    times,
    ingredientGroups: arr(o.ingredientGroups, `${path}.ingredientGroups`).map((g, i) =>
      ingredientGroup(g, `${path}.ingredientGroups[${i}]`, ctx),
    ),
    instructionGroups: arr(o.instructionGroups, `${path}.instructionGroups`).map((g, i) =>
      instructionGroup(g, `${path}.instructionGroups[${i}]`, ctx),
    ),
    notes: str(o.notes, `${path}.notes`),
    tags: strArr(o.tags, `${path}.tags`),
    collectionIds: arr(o.collectionIds, `${path}.collectionIds`).map((c, i) => id(c, `${path}.collectionIds[${i}]`)),
    extraction,
    revision: int(o.revision, `${path}.revision`, 0),
  };
  const img = o.localImageId;
  if (img !== undefined && img !== null && img !== '') recipe.localImageId = id(img, `${path}.localImageId`);
  return recipe;
}

export function sanitizeCollection(
  v: unknown,
  path = 'collection',
  opts: { allowEmptyId?: boolean; ctx?: SanitizeContext } = {},
): Collection {
  const o = obj(v, path, ['id', 'name'], opts.ctx);
  const cid = opts.allowEmptyId && (o.id === undefined || o.id === null || o.id === '') ? '' : id(o.id, `${path}.id`);
  return { id: cid, name: str(o.name, `${path}.name`) };
}

function shoppingItem(v: unknown, path: string, ctx?: SanitizeContext): ShoppingItem {
  const o = obj(
    v,
    path,
    ['id', 'text', 'quantity', 'unit', 'ingredient', 'preparation', 'aisle', 'checked', 'manual', 'sources'],
    ctx,
  );
  const item: ShoppingItem = {
    id: id(o.id, `${path}.id`),
    text: str(o.text, `${path}.text`),
    aisle: str(o.aisle, `${path}.aisle`),
    checked: bool(o.checked, `${path}.checked`),
    manual: bool(o.manual, `${path}.manual`),
    sources: arr(o.sources, `${path}.sources`).map((s, i) => {
      const p = `${path}.sources[${i}]`;
      const so = obj(s, p, ['recipeId', 'recipeTitle', 'raw'], ctx);
      return {
        recipeId: id(so.recipeId, `${p}.recipeId`),
        recipeTitle: str(so.recipeTitle, `${p}.recipeTitle`),
        raw: str(so.raw, `${p}.raw`),
      };
    }),
  };
  put(item, 'quantity', quantity(o.quantity, `${path}.quantity`, ctx));
  put(item, 'unit', optStr(o.unit, `${path}.unit`));
  put(item, 'ingredient', optStr(o.ingredient, `${path}.ingredient`));
  put(item, 'preparation', optStr(o.preparation, `${path}.preparation`));
  return item;
}

export function sanitizeShoppingList(
  v: unknown,
  path = 'shoppingList',
  opts: { allowEmptyId?: boolean; ctx?: SanitizeContext } = {},
): ShoppingList {
  const o = obj(v, path, ['id', 'name', 'aisles', 'items', 'revision'], opts.ctx);
  const lid = opts.allowEmptyId && (o.id === undefined || o.id === null || o.id === '') ? '' : id(o.id, `${path}.id`);
  return {
    id: lid,
    name: str(o.name, `${path}.name`),
    aisles: strArr(o.aisles, `${path}.aisles`),
    items: arr(o.items, `${path}.items`).map((x, i) => shoppingItem(x, `${path}.items[${i}]`, opts.ctx)),
    revision: int(o.revision, `${path}.revision`, 0),
  };
}

/** Validate a partial preferences update (sessionOnly is handled separately). */
export function sanitizePreferencesPatch(v: unknown): Partial<Omit<Preferences, 'sessionOnly'>> {
  const o = obj(v, 'preferences', ['theme', 'fontScale', 'unitSystem', 'sessionOnly', 'onboarded']);
  const out: Partial<Omit<Preferences, 'sessionOnly'>> = {};
  if (o.theme !== undefined) out.theme = oneOf(o.theme, 'preferences.theme', THEMES);
  if (o.unitSystem !== undefined) out.unitSystem = oneOf(o.unitSystem, 'preferences.unitSystem', UNIT_SYSTEMS);
  if (o.onboarded !== undefined) out.onboarded = bool(o.onboarded, 'preferences.onboarded');
  if (o.fontScale !== undefined) {
    const f = o.fontScale;
    if (typeof f !== 'number' || !Number.isFinite(f) || f < 0.8 || f > 2.5) {
      throw new ValidationError('preferences.fontScale', 'must be a number from 0.8 to 2.5');
    }
    out.fontScale = f;
  }
  return out;
}

/** Lenient read of persisted preferences: keeps only valid known fields. */
export function readStoredPreferences(v: unknown): Partial<Omit<Preferences, 'sessionOnly'>> {
  if (!isPlainObject(v)) return {};
  const out: Partial<Omit<Preferences, 'sessionOnly'>> = {};
  for (const key of ['theme', 'fontScale', 'unitSystem', 'onboarded'] as const) {
    try {
      Object.assign(out, sanitizePreferencesPatch({ [key]: v[key] }));
    } catch {
      /* ignore corrupted field, fall back to default */
    }
  }
  return out;
}
