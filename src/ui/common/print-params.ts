/**
 * Print page URL contract (R06). Shared with the library (UI owner B):
 *   ui/print.html?id=<printId>                      unsaved draft held by the side panel
 *   ui/print.html?recipe=<id>&n=1&d=1&units=metric&notes=1   saved recipe from storage
 */
import type { UnitSystem } from '../../shared/types';
import type { Rational } from '../../domain/index';

export interface PrintViewOptions {
  factor: Rational;
  system: UnitSystem;
  includeNotes: boolean;
}

export type PrintParams =
  | { kind: 'draft'; printId: string }
  | { kind: 'saved'; recipeId: string; options: PrintViewOptions };

const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const SYSTEMS: readonly UnitSystem[] = ['original', 'us', 'metric'];
const MAX_TERM = 1_000_000;

function posInt(v: string | null): number | null {
  if (v === null || !/^\d{1,7}$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= MAX_TERM ? n : null;
}

export function parsePrintParams(search: string): PrintParams | null {
  const q = new URLSearchParams(search);
  const printId = q.get('id');
  if (printId !== null) return ID_RE.test(printId) ? { kind: 'draft', printId } : null;
  const recipeId = q.get('recipe');
  if (recipeId === null || !ID_RE.test(recipeId)) return null;
  const n = posInt(q.get('n') ?? '1');
  const d = posInt(q.get('d') ?? '1');
  // Any invalid term falls back to the original amounts rather than a guessed factor.
  const factor = n !== null && d !== null ? { n, d } : { n: 1, d: 1 };
  const units = q.get('units') as UnitSystem | null;
  return {
    kind: 'saved',
    recipeId,
    options: {
      factor,
      system: units && SYSTEMS.includes(units) ? units : 'original',
      includeNotes: q.get('notes') !== '0',
    },
  };
}

/** Extension-relative path for printing a saved recipe; pass to chrome.runtime.getURL. */
export function savedRecipePrintPath(recipeId: string, o: PrintViewOptions): string {
  const q = new URLSearchParams({
    recipe: recipeId,
    n: String(o.factor.n),
    d: String(o.factor.d),
    units: o.system,
    notes: o.includeNotes ? '1' : '0',
  });
  return `ui/print.html?${q.toString()}`;
}

export function draftPrintPath(printId: string): string {
  return `ui/print.html?${new URLSearchParams({ id: printId }).toString()}`;
}
