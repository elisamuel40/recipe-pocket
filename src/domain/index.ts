/**
 * Domain public API: rational arithmetic, ingredient parsing, scaling, unit
 * conversion, shopping-list merging, URL normalization (PRD R04, R05, R09).
 * Owner: domain. Pure, synchronous, no DOM, no chrome.* APIs.
 * Implementations may live in sibling files; re-export from here and keep
 * these signatures stable (UI, extraction and storage import them).
 */
import type { IngredientItem, QuantityV1, RecipeV1, ShoppingItem, UnitSystem } from '../shared/types';

/** Reduced rational with positive denominator. Integers kept within Number.MAX_SAFE_INTEGER. */
export interface Rational {
  n: number;
  d: number;
}

export interface QuantityRange {
  min: Rational;
  max?: Rational;
}

export interface ParsedIngredient {
  quantity?: QuantityRange;
  /** Canonical unit id when recognized (e.g. "cup", "tbsp", "g", "oz-weight", "fl-oz", "oz-ambiguous"), else the literal unit text. */
  unit?: string;
  unitKnown: boolean;
  ingredient?: string;
  preparation?: string;
  /** Invariant package size, e.g. "2 (14 oz) cans" -> 14 oz. Never scaled. */
  packageSize?: { quantity: QuantityRange; unit: string };
  /** "salt to taste", "pinch" etc.: unchanged by scaling. */
  toTaste: boolean;
  confidence: IngredientItem['confidence'];
}

export interface DisplayIngredient {
  /** Text to show. Equal to item.raw when factor is 1 and system is "original". */
  text: string;
  /** Original source line, always available for "show original". */
  original: string;
  /** True when rounding or conversion makes the value approximate. */
  approximate: boolean;
  /** True when this line could not be scaled/converted and is shown verbatim. */
  unchanged: boolean;
  /** Plain-text note, e.g. "ambiguous oz: review" or "no density: not converted". */
  note?: string;
}

export interface RenderOptions {
  factor: Rational;
  system: UnitSystem;
}

const todo = (name: string): never => {
  throw new Error(`${name}: not implemented`);
};

// ---- Rational arithmetic ----
export function rational(n: number, d = 1): Rational { void n; void d; return todo('rational'); }
export function add(a: Rational, b: Rational): Rational { void a; void b; return todo('add'); }
export function mul(a: Rational, b: Rational): Rational { void a; void b; return todo('mul'); }
export function div(a: Rational, b: Rational): Rational { void a; void b; return todo('div'); }
export function eq(a: Rational, b: Rational): boolean { void a; void b; return todo('eq'); }
export function toNumber(r: Rational): number { void r; return todo('toNumber'); }
/** Display as mixed fraction ("1 1/2") using common cooking denominators; exact when possible. */
export function formatRational(r: Rational): { text: string; approximate: boolean } { void r; return todo('formatRational'); }
export function toQuantityV1(q: QuantityRange): QuantityV1 { void q; return todo('toQuantityV1'); }
export function fromQuantityV1(q: QuantityV1): QuantityRange { void q; return todo('fromQuantityV1'); }

// ---- Parsing ----
/** Parse one ingredient line. Handles mixed/Unicode fractions, ranges, packages, "to taste". */
export function parseIngredientLine(raw: string): ParsedIngredient { void raw; return todo('parseIngredientLine'); }
/** Build a persisted IngredientItem from a raw line (fills quantity/unit/ingredient/preparation/confidence). */
export function toIngredientItem(raw: string, id: string): IngredientItem { void raw; void id; return todo('toIngredientItem'); }
/** Parse a yield string ("Makes 12 cookies", "4 servings", "4-6"). */
export function parseYield(text: string): { quantity?: QuantityRange; unit?: string } { void text; return todo('parseYield'); }
/** Parse a free-form servings input from the UI ("3", "1 1/2", "0.5"). Returns null when invalid or <= 0. */
export function parseServingsInput(text: string): Rational | null { void text; return todo('parseServingsInput'); }

// ---- Scaling and conversion ----
/** Render an ingredient for display, always derived from item.raw (the immutable original). */
export function renderIngredient(item: IngredientItem, opts: RenderOptions): DisplayIngredient { void item; void opts; return todo('renderIngredient'); }
/** Factor = target / original servings. Returns null if the recipe yield has no numeric quantity. */
export function scaleFactorForServings(recipe: RecipeV1, target: Rational): Rational | null { void recipe; void target; return todo('scaleFactorForServings'); }

// ---- Shopping lists ----
/**
 * Build shopping items from recipes (each with its own factor). Merge only
 * identical normalized ingredient+unit+preparation keys with compatible
 * quantities; ambiguous items stay separate. Retains source association.
 */
export function buildShoppingItems(
  entries: { recipe: RecipeV1; factor: Rational; itemIds?: string[] }[],
  system: UnitSystem,
): ShoppingItem[] { void entries; void system; return todo('buildShoppingItems'); }
/** Guess a default aisle name for an ingredient ("Produce", "Dairy", ... or "Other"). */
export function defaultAisle(ingredient: string): string { void ingredient; return todo('defaultAisle'); }

// ---- URLs ----
/**
 * Normalize a source URL: http(s) only, strip credentials and fragment, drop
 * known tracking keys (utm_*, fbclid, gclid, mc_cid, mc_eid, ...). Returns null
 * for non-http(s) (javascript:, data:, chrome:, file:) or invalid URLs.
 */
export function normalizeSourceUrl(url: string): string | null { void url; return todo('normalizeSourceUrl'); }
