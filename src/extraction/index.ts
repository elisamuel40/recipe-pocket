/**
 * Extraction public API (ARCHITECTURE.md "Extraction algorithm").
 * Owner: extraction. Pure functions over a Document; must run in a content
 * script isolated world and in jsdom tests. Never executes page code, never
 * reads form values, never uses innerHTML for output.
 */
import type { RecipeV1 } from '../shared/types';
import type { ErrorCode } from '../shared/messages';

export const LIMITS = {
  /** Max characters of text/structured data processed. */
  maxInputChars: 2 * 1024 * 1024,
  maxDepth: 30,
  maxCandidates: 20,
} as const;

export type ExtractionOutcome =
  | { ok: true; candidates: RecipeV1[]; warnings: string[] }
  | { ok: false; code: Extract<ErrorCode, 'NO_RECIPE' | 'INPUT_TOO_LARGE'>; warnings: string[] };

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
  void doc;
  void pageUrl;
  throw new Error('extractFromDocument: not implemented');
}
