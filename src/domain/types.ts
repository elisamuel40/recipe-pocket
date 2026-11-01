/**
 * Domain value types. Re-exported from ./index.ts (the public API).
 */
import type { IngredientItem, UnitSystem } from '../shared/types';

/**
 * Reduced rational with positive denominator. Integers kept within
 * Number.MAX_SAFE_INTEGER. `approximate` is set (additive, optional) when an
 * operation had to round to stay within safe integer range.
 */
export interface Rational {
  n: number;
  d: number;
  approximate?: boolean;
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
