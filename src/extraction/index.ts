/**
 * Extraction public API (ARCHITECTURE.md "Extraction algorithm").
 * Owner: extraction. Pure functions over a Document; must run in a content
 * script isolated world and in jsdom tests. Never executes page code, never
 * reads form values, never uses innerHTML for output.
 *
 * Pipeline: JSON-LD -> microdata -> recipe-card containers -> bounded DOM
 * fallback (heading sections, then layout inference). Later stages only fill
 * gaps in candidates they plausibly match (same title, or the single
 * candidate on a single-recipe page); separate recipes stay separate. One
 * exception: JSON-LD that describes only one section of the recipe on the page
 * gives way to the visible sections (see expandPartialRecipe).
 */
import type { RecipeV1 } from '../shared/types';
import type { ErrorCode } from '../shared/messages';
import { ExtractionContext, finalize, hasIngredients, hasInstructions, isComplete, mergeInto, safeSourceUrl, sameRecipe, type Draft } from './draft';
import { extractCards, extractDomFallback, extractMicrodata, readPageMeta } from './dom';
import { extractJsonLd } from './jsonld';
import { titleKey } from './text';

export const LIMITS = {
  /** Max characters of text/structured data processed. */
  maxInputChars: 2 * 1024 * 1024,
  maxDepth: 30,
  maxCandidates: 20,
} as const;

export type ExtractionOutcome =
  | { ok: true; candidates: RecipeV1[]; warnings: string[] }
  | { ok: false; code: Extract<ErrorCode, 'NO_RECIPE' | 'INPUT_TOO_LARGE'>; warnings: string[] };

/** Plain-text notes attached to candidate.extraction.warnings when a later stage filled gaps. */
export const MERGE_NOTES = {
  microdata: 'Some fields were read from page markup (microdata) because the structured data was incomplete.',
  card: 'Some fields were read from the recipe card on the page because the structured data was incomplete.',
  dom: 'Ingredients or steps were read from the visible page because the structured data was incomplete.',
  partial: 'The structured data covered only part of this recipe, so all sections were read from the visible page.',
} as const;

const useful = (d: Draft): boolean => hasIngredients(d) || hasInstructions(d);

/**
 * Merge `secondary` drafts into matching incomplete `primary` drafts. Unmatched
 * secondary drafts are added as separate candidates unless they duplicate an
 * existing one.
 */
function absorb(primary: Draft[], secondary: Draft[], note: string): void {
  const singleton = primary.length === 1 && secondary.length === 1;
  for (const s of secondary) {
    const match =
      primary.find((p) => !isComplete(p) && sameRecipe(p, s)) ??
      (singleton && !isComplete(primary[0] as Draft) ? primary[0] : undefined);
    if (match) {
      mergeInto(match, s, note);
    } else if (useful(s) && !primary.some((p) => sameRecipe(p, s))) {
      primary.push(s);
    }
  }
}

/** Share of the structured recipe's ingredient lines that a visible section also lists. */
function ingredientCoverage(recipe: Draft, section: Draft): number {
  const keys = (d: Draft): string[] => d.ingredientGroups.flatMap((g) => g.lines.map(titleKey));
  const wanted = keys(recipe);
  const found = new Set(keys(section));
  return wanted.length ? wanted.filter((k) => found.has(k)).length / wanted.length : 0;
}

/**
 * Some CMS templates fill JSON-LD from a single field, so a complete-looking
 * recipe holds only one section (for example a sauce) and omits the main dish.
 * Replace its ingredients and steps when the visible page shows that section
 * plus at least one more under the same title. No heading separates such
 * sections, so they are one recipe, not separate recipes (PRD R02).
 */
function expandPartialRecipe(recipe: Draft, visible: Draft[]): void {
  const sections = visible.filter((v) => sameRecipe(recipe, v) && hasIngredients(v) && hasInstructions(v));
  const isDescribed = (v: Draft): boolean => ingredientCoverage(recipe, v) >= 0.8;
  const firstDescribed = sections.findIndex(isDescribed);
  if (firstDescribed < 0) return;
  // A later section with the same ingredients is a repeat of that section (a print copy, for example).
  const parts = sections.filter((v, i) => i === firstDescribed || !isDescribed(v));
  if (parts.length < 2) return;

  const first = parts[0] as Draft;
  if (first.title.length < recipe.title.length) recipe.title = first.title;
  // The first section is the main dish; a line above its list is not its name (often a byline or book title).
  const titled = <G extends { title: string }>(g: G, i: number): G => ({ ...g, title: g.title || (i > 0 && parts[i]?.sectionLabel) || '' });
  recipe.ingredientGroups = parts.flatMap((p, i) => p.ingredientGroups.map((g) => titled(g, i)));
  recipe.instructionGroups = parts.flatMap((p, i) => p.instructionGroups.map((g) => titled(g, i)));
  if (!recipe.notes.length) recipe.notes = parts.flatMap((p) => p.notes);
  recipe.method = 'dom';
  recipe.warnings.push(MERGE_NOTES.partial, ...new Set(parts.flatMap((p) => p.warnings)));
}

function safely<T>(ctx: ExtractionContext, label: string, fn: () => T[]): T[] {
  try {
    return fn();
  } catch {
    ctx.warn(`Part of the page (${label}) could not be read.`);
    return [];
  }
}

/**
 * Extract recipe candidates from a loaded document.
 * - Each candidate is a full RecipeV1 with fresh random ids, revision 0,
 *   schemaVersion 1, empty tags/collectionIds, and extraction info filled.
 * - A candidate missing ingredients or instructions lists them in
 *   extraction.missingFields (the UI shows the partial state).
 * - Separate recipes are separate candidates; never merged.
 * @param pageUrl location.href of the page; normalized into source.url.
 */
export function extractFromDocument(doc: Document, pageUrl: string): ExtractionOutcome {
  const ctx = new ExtractionContext(LIMITS.maxInputChars, LIMITS.maxDepth, LIMITS.maxCandidates);
  const sourceUrl = safeSourceUrl(pageUrl);
  const meta = safely(ctx, 'page metadata', () => [readPageMeta(doc)])[0] ?? { title: '' };

  // 1. JSON-LD
  const drafts: Draft[] = safely(ctx, 'structured data', () => extractJsonLd(doc, ctx));
  const declaredEmpty = drafts.some((d) => !useful(d));
  for (const d of drafts) {
    if (!d.author && meta.author) d.author = meta.author;
    if (!d.publisher && meta.publisher) d.publisher = meta.publisher;
  }

  // 2. Microdata (always cheap; merges into matching JSON-LD recipes)
  absorb(drafts, safely(ctx, 'microdata', () => extractMicrodata(doc, ctx, meta)), MERGE_NOTES.microdata);

  // 3. Explicit recipe cards
  if (!drafts.length || drafts.some((d) => !isComplete(d))) {
    absorb(drafts, safely(ctx, 'recipe card', () => extractCards(doc, ctx, meta)), MERGE_NOTES.card);
  }

  // 4. Bounded DOM fallback. An empty Recipe object must not suppress this.
  if (!drafts.length || drafts.some((d) => !isComplete(d))) {
    absorb(drafts, safely(ctx, 'page text', () => extractDomFallback(doc, ctx, meta)), MERGE_NOTES.dom);
  }

  // 5. A complete-looking single recipe may still describe only part of the page.
  const single = drafts.length === 1 ? (drafts[0] as Draft) : undefined;
  if (single?.method === 'json-ld' && isComplete(single)) {
    // A separate context: this check must not consume the input budget or add warnings of its own.
    const scratch = new ExtractionContext(LIMITS.maxInputChars, LIMITS.maxDepth, LIMITS.maxCandidates);
    expandPartialRecipe(single, safely(ctx, 'page text', () => extractDomFallback(doc, scratch, meta)));
  }

  const usable = drafts.filter(useful);
  if (declaredEmpty && usable.length < drafts.length) {
    ctx.warn('The page declares a recipe without ingredients or steps; it was not shown.');
  }
  if (!usable.length) {
    return { ok: false, code: ctx.limitHit ? 'INPUT_TOO_LARGE' : 'NO_RECIPE', warnings: ctx.warnings };
  }
  if (usable.length > LIMITS.maxCandidates) {
    ctx.warn(`More than ${LIMITS.maxCandidates} recipes were found; only the first ${LIMITS.maxCandidates} are shown.`);
  }
  const candidates = usable.slice(0, LIMITS.maxCandidates).map((d) => finalize(d, sourceUrl));
  return { ok: true, candidates, warnings: ctx.warnings };
}
