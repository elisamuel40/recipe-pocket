/**
 * Shared data contracts (ARCHITECTURE.md "Data contract").
 * Owned by the Integrator. Changes must be additive and backward compatible:
 * persisted records and backups depend on these shapes.
 */

export const SCHEMA_VERSION = 1 as const;

/** Persisted quantity: reduced rational min, optional rational max for ranges ("1–2"). */
export interface QuantityV1 {
  minNumerator: number;
  minDenominator: number;
  maxNumerator?: number;
  maxDenominator?: number;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface IngredientItem {
  id: string;
  /** Original line exactly as found on the source (plain text). Never rewritten. */
  raw: string;
  quantity?: QuantityV1;
  unit?: string;
  ingredient?: string;
  preparation?: string;
  confidence: Confidence;
}

export interface IngredientGroup {
  id: string;
  /** Empty string when the source has no heading for the group. */
  title: string;
  items: IngredientItem[];
}

export interface InstructionStep {
  id: string;
  text: string;
}

export interface InstructionGroup {
  id: string;
  title: string;
  steps: InstructionStep[];
}

export type ExtractionMethod = 'json-ld' | 'microdata' | 'dom' | 'manual' | 'transcript';

export type RecipeField =
  | 'title'
  | 'ingredients'
  | 'instructions'
  | 'yield'
  | 'times'
  | 'author';

export interface ExtractionInfo {
  method: ExtractionMethod;
  missingFields: RecipeField[];
  /** Human-readable, plain-text warnings (limits hit, ambiguous parsing, ...). */
  warnings: string[];
}

export interface RecipeSource {
  /** Normalized http(s) URL (no credentials, fragment or known tracking keys). Empty for manual recipes. */
  url: string;
  author?: string;
  publisher?: string;
}

export interface RecipeYield {
  text: string;
  quantity?: QuantityV1;
  unit?: string;
}

export interface RecipeTimes {
  /** ISO 8601 durations when known (e.g. "PT15M"). */
  prep?: string;
  cook?: string;
  total?: string;
  /** Original time text as shown on the source, for display when parsing fails. */
  raw: string;
}

export interface RecipeV1 {
  schemaVersion: typeof SCHEMA_VERSION;
  /** Random local UUID (crypto.randomUUID). */
  id: string;
  title: string;
  source: RecipeSource;
  originalYield: RecipeYield;
  times: RecipeTimes;
  ingredientGroups: IngredientGroup[];
  instructionGroups: InstructionGroup[];
  /** Free-form notes (source notes and user notes), plain text. */
  notes: string;
  tags: string[];
  collectionIds: string[];
  localImageId?: string;
  extraction: ExtractionInfo;
  /** Incremented on every successful save; used for optimistic concurrency. */
  revision: number;
}

export interface Collection {
  id: string;
  name: string;
}

export interface ShoppingItemSource {
  recipeId: string;
  recipeTitle: string;
  /** IngredientItem.raw that produced this entry. */
  raw: string;
}

export interface ShoppingItem {
  id: string;
  /** Display text (merged quantity + ingredient, or manual entry). */
  text: string;
  quantity?: QuantityV1;
  unit?: string;
  ingredient?: string;
  preparation?: string;
  aisle: string;
  checked: boolean;
  manual: boolean;
  sources: ShoppingItemSource[];
}

export interface ShoppingList {
  id: string;
  name: string;
  aisles: string[];
  items: ShoppingItem[];
  revision: number;
}

export interface LocalImage {
  id: string;
  /** Re-encoded image bytes (PNG/JPEG/WebP only, max 5 MB). */
  blob: Blob;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
}

export type ThemePreference = 'system' | 'light' | 'dark';
export type UnitSystem = 'original' | 'us' | 'metric';

export interface Preferences {
  theme: ThemePreference;
  /** Reader/cook font scale, 1 = default. Range 0.8–2.5. */
  fontScale: number;
  unitSystem: UnitSystem;
  /** When true nothing is written persistently except this flag itself. */
  sessionOnly: boolean;
  /** First-launch explanation dismissed. */
  onboarded: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  fontScale: 1,
  unitSystem: 'original',
  sessionOnly: false,
  onboarded: false,
};

/** Versioned backup file (R10). */
export interface BackupFileV1 {
  format: 'recipe-pocket-backup';
  version: 1;
  recipes: RecipeV1[];
  collections: Collection[];
  shoppingLists: ShoppingList[];
  /** Images as data URLs keyed by LocalImage.id; optional. */
  images?: { id: string; mime: LocalImage['mime']; dataUrl: string }[];
}
