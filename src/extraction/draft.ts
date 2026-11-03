/**
 * Intermediate recipe draft used by every extraction strategy, plus merge and
 * finalization into RecipeV1. Domain parsers are called defensively: if they
 * throw (or are not implemented yet) extraction still produces raw items.
 */
import type {
  ExtractionMethod,
  IngredientGroup,
  IngredientItem,
  InstructionGroup,
  RecipeField,
  RecipeV1,
  RecipeYield,
} from '../shared/types';
import { SCHEMA_VERSION } from '../shared/types';
import { normalizeSourceUrl, parseYield, toIngredientItem, toQuantityV1 } from '../domain/index';
import { isoToHuman } from './duration';
import { collapse, similarTitles } from './text';

export interface DraftTimes {
  prep?: string;
  cook?: string;
  total?: string;
  /** Raw human text pieces, e.g. "Prep: 15 min". */
  raw: string[];
}

export interface Draft {
  method: ExtractionMethod;
  title: string;
  author?: string;
  publisher?: string;
  yieldText?: string;
  times: DraftTimes;
  ingredientGroups: { title: string; lines: string[] }[];
  instructionGroups: { title: string; steps: string[] }[];
  /** Steps exist but look damaged (e.g. nested lists flattened); a later stage may replace them. */
  suspectInstructions?: boolean;
  /** Short line right above the ingredient list that names this part of the page ("Garlic Sauce"). */
  sectionLabel?: string;
  notes: string[];
  warnings: string[];
}

export function emptyDraft(method: ExtractionMethod): Draft {
  return { method, title: '', times: { raw: [] }, ingredientGroups: [], instructionGroups: [], notes: [], warnings: [] };
}

export const hasIngredients = (d: Draft): boolean => d.ingredientGroups.some((g) => g.lines.length > 0);
export const hasInstructions = (d: Draft): boolean => d.instructionGroups.some((g) => g.steps.length > 0);
export const isComplete = (d: Draft): boolean => hasIngredients(d) && hasInstructions(d) && !d.suspectInstructions;
export const hasTimes = (d: Draft): boolean => !!(d.times.prep || d.times.cook || d.times.total || d.times.raw.length);

/** Shared state for one extraction run. */
export class ExtractionContext {
  readonly warnings: string[] = [];
  /** Characters of page text / structured data consumed so far. */
  used = 0;
  limitHit = false;
  private readonly seen = new Set<string>();
  constructor(readonly maxChars: number, readonly maxDepth: number, readonly maxCandidates: number) {}

  warn(msg: string): void {
    if (this.seen.has(msg)) return;
    this.seen.add(msg);
    this.warnings.push(msg);
  }
}

/**
 * Fill gaps in `target` from `src`. Never overwrites existing content and
 * never concatenates ingredient or step lists from two sources.
 */
export function mergeInto(target: Draft, src: Draft, note: string): void {
  let used = false;
  if (!hasIngredients(target) && hasIngredients(src)) {
    target.ingredientGroups = src.ingredientGroups;
    used = true;
  }
  if ((!hasInstructions(target) || target.suspectInstructions) && hasInstructions(src)) {
    target.instructionGroups = src.instructionGroups;
    target.suspectInstructions = false;
    used = true;
  }
  if (!target.title && src.title) target.title = src.title;
  if (!target.author && src.author) target.author = src.author;
  if (!target.publisher && src.publisher) target.publisher = src.publisher;
  if (!target.yieldText && src.yieldText) target.yieldText = src.yieldText;
  if (!hasTimes(target) && hasTimes(src)) target.times = src.times;
  if (target.notes.length === 0 && src.notes.length) target.notes = src.notes;
  if (used) {
    target.method = src.method;
    target.warnings.push(note, ...src.warnings);
  }
}

/** Two drafts plausibly describe the same recipe when their titles match. */
export function sameRecipe(a: Draft, b: Draft): boolean {
  return similarTitles(a.title, b.title);
}

// ---------- Domain wrappers ----------

export function safeSourceUrl(url: string): string {
  try {
    const r = normalizeSourceUrl(url);
    if (typeof r === 'string') return r;
    if (r === null) return '';
  } catch {
    /* domain not available: fall through */
  }
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    u.hash = '';
    u.username = '';
    u.password = '';
    return u.href;
  } catch {
    return '';
  }
}

function safeIngredient(raw: string, id: string): IngredientItem {
  try {
    const it = toIngredientItem(raw, id);
    if (it && typeof it === 'object') {
      const confidence = it.confidence === 'high' || it.confidence === 'medium' ? it.confidence : 'low';
      return { ...it, id, raw, confidence };
    }
  } catch {
    /* fall back below */
  }
  return { id, raw, confidence: 'low' };
}

function safeYield(text: string): RecipeYield {
  const out: RecipeYield = { text };
  try {
    const p = parseYield(text);
    if (p?.quantity) {
      try {
        out.quantity = toQuantityV1(p.quantity);
      } catch {
        /* leave quantity unset */
      }
    }
    if (p?.unit) out.unit = p.unit;
  } catch {
    /* text only */
  }
  return out;
}

/**
 * crypto.randomUUID is limited to secure contexts; content scripts on plain
 * http:// pages may not have it, so fall back to getRandomValues (RFC 4122 v4).
 */
function uuid(): string {
  if (typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      /* fall through */
    }
  }
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] as number) & 0x0f) | 0x40;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Convert a draft into a persisted-shape RecipeV1 with fresh ids. */
export function finalize(d: Draft, sourceUrl: string): RecipeV1 {
  const ingredientGroups: IngredientGroup[] = d.ingredientGroups
    .filter((g) => g.lines.length > 0)
    .map((g) => ({ id: uuid(), title: collapse(g.title), items: g.lines.map((l) => safeIngredient(l, uuid())) }));
  const instructionGroups: InstructionGroup[] = d.instructionGroups
    .filter((g) => g.steps.length > 0)
    .map((g) => ({ id: uuid(), title: collapse(g.title), steps: g.steps.map((text) => ({ id: uuid(), text })) }));

  const rawTimes = [...d.times.raw];
  if (!rawTimes.length) {
    if (d.times.prep) rawTimes.push(`Prep: ${isoToHuman(d.times.prep)}`);
    if (d.times.cook) rawTimes.push(`Cook: ${isoToHuman(d.times.cook)}`);
    if (d.times.total) rawTimes.push(`Total: ${isoToHuman(d.times.total)}`);
  }

  const missing: RecipeField[] = [];
  if (!d.title) missing.push('title');
  if (!ingredientGroups.length) missing.push('ingredients');
  if (!instructionGroups.length) missing.push('instructions');
  if (!d.yieldText) missing.push('yield');
  if (!hasTimes(d)) missing.push('times');
  if (!d.author) missing.push('author');

  const recipe: RecipeV1 = {
    schemaVersion: SCHEMA_VERSION,
    id: uuid(),
    title: d.title,
    source: { url: sourceUrl },
    originalYield: d.yieldText ? safeYield(d.yieldText) : { text: '' },
    times: { raw: rawTimes.join('; ') },
    ingredientGroups,
    instructionGroups,
    notes: d.notes.join('\n\n'),
    tags: [],
    collectionIds: [],
    extraction: { method: d.method, missingFields: missing, warnings: [...new Set(d.warnings)] },
    revision: 0,
  };
  if (d.author) recipe.source.author = d.author;
  if (d.publisher) recipe.source.publisher = d.publisher;
  if (d.times.prep) recipe.times.prep = d.times.prep;
  if (d.times.cook) recipe.times.cook = d.times.cook;
  if (d.times.total) recipe.times.total = d.times.total;
  return recipe;
}
