/**
 * Pure scaling helpers for UI pages. All arithmetic goes through the domain
 * rational API; factors always apply to the immutable original recipe.
 */
import type { IngredientItem, RecipeV1, UnitSystem } from '../../shared/types';
import {
  formatRational,
  mul,
  rational,
  renderIngredient,
  type DisplayIngredient,
  type Rational,
} from '../../domain/index';

export const ONE: Rational = { n: 1, d: 1 };

export function isIdentity(f: Rational): boolean {
  return f.n === f.d;
}

/** Text for a rational ("1 1/2"); falls back to n/d if formatting fails. */
export function formatAmount(r: Rational): string {
  try {
    return formatRational(r).text;
  } catch {
    return r.d === 1 ? String(r.n) : `${r.n}/${r.d}`;
  }
}

/** Original numeric servings (minimum of a range), or null when the yield has no number. */
export function originalServings(recipe: RecipeV1): Rational | null {
  const q = recipe.originalYield?.quantity;
  if (!q || !(q.minNumerator > 0) || !(q.minDenominator > 0)) return null;
  try {
    return rational(q.minNumerator, q.minDenominator);
  } catch {
    return { n: q.minNumerator, d: q.minDenominator };
  }
}

export function targetServings(recipe: RecipeV1, factor: Rational): Rational | null {
  const orig = originalServings(recipe);
  if (!orig) return null;
  return mul(orig, factor);
}

export const UNIT_SYSTEM_LABELS: Record<UnitSystem, string> = {
  original: 'Original units',
  us: 'US customary',
  metric: 'Metric',
};

/**
 * Display text for one ingredient. Derived from item.raw via the domain;
 * if the domain cannot handle a line it is shown verbatim and marked unchanged.
 */
export function displayIngredient(item: IngredientItem, factor: Rational, system: UnitSystem): DisplayIngredient {
  try {
    return renderIngredient(item, { factor, system });
  } catch {
    const transformed = !isIdentity(factor) || system !== 'original';
    return {
      text: item.raw,
      original: item.raw,
      approximate: false,
      unchanged: true,
      note: transformed ? 'Could not adjust this line; shown as written.' : undefined,
    };
  }
}

/** Human summary such as "Servings: 8 (original 4)" or "Scale: ×2". */
export function scaleSummary(recipe: RecipeV1, factor: Rational): string {
  const target = (() => {
    try {
      return targetServings(recipe, factor);
    } catch {
      return null;
    }
  })();
  if (target) {
    const orig = originalServings(recipe)!;
    return isIdentity(factor)
      ? `Servings: ${formatAmount(orig)}`
      : `Servings: ${formatAmount(target)} (original ${formatAmount(orig)})`;
  }
  return isIdentity(factor) ? 'Original amounts' : `Scale: ×${formatAmount(factor)} of the original amounts`;
}
