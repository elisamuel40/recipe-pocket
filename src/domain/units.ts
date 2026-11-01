/**
 * Unit table and dimensional conversion.
 *
 * Conversion factors are exact rationals relative to a base unit per
 * dimension (ml for volume, g for mass):
 * - US cup = 236.5882365 ml (US customary cup, 8 US fl oz; commonly rounded
 *   to 236.588 ml). tsp = cup/48, tbsp = cup/16, fl oz = cup/8,
 *   pint = 2 cups, quart = 4 cups, gallon = 16 cups.
 * - Avoirdupois ounce = 28.349523125 g, pound = 16 oz = 453.59237 g.
 *
 * Only mass<->mass and volume<->volume conversions exist. This module ships
 * no density table, so volume<->mass conversion is never performed.
 */
import type { UnitSystem } from '../shared/types';
import { cmp, div, mul, rational } from './rational';
import type { QuantityRange, Rational } from './types';

export type Dimension = 'volume' | 'mass' | 'count' | 'ambiguous';

export interface UnitDef {
  id: string;
  dimension: Dimension;
  /** Size in base units (ml or g); only for volume and mass. */
  toBase?: Rational;
  /** Measurement system the unit belongs to. */
  system?: 'us' | 'metric';
  /** Short display label used when Recipe Pocket writes the unit itself. */
  label: string;
  labelPlural: string;
  /** Full-word spellings [singular, plural] used to keep grammatical number when scaling. */
  words: [string, string][];
  /** Alias regex sources (matched case-insensitively unless in caseSensitive). */
  patterns: string[];
  caseSensitive?: string[];
}

const CUP_ML = rational(2365882365, 10000000); // 236.5882365
const OZ_G = rational(28349523125, 1000000000); // 28.349523125

const vol = (r: Rational): Rational => r;

/** Order matters: longer / more specific aliases first (fl oz before oz). */
export const UNITS: UnitDef[] = [
  {
    id: 'fl-oz', dimension: 'volume', system: 'us', toBase: div(CUP_ML, rational(8)), label: 'fl oz', labelPlural: 'fl oz',
    words: [['fluid ounce', 'fluid ounces']],
    patterns: ['fluid\\s+ounces?', 'fl\\.?\\s*ounces?', 'fl\\.?\\s*oz\\.?'],
  },
  {
    id: 'oz-weight', dimension: 'mass', system: 'us', toBase: OZ_G, label: 'oz', labelPlural: 'oz',
    words: [],
    patterns: ['ounces?\\s+(?:by\\s+)?weight', 'oz\\.?\\s*wt\\.?', 'wt\\.?\\s*oz\\.?'],
  },
  {
    id: 'tbsp', dimension: 'volume', system: 'us', toBase: div(CUP_ML, rational(16)), label: 'tbsp', labelPlural: 'tbsp',
    words: [['tablespoon', 'tablespoons']],
    patterns: ['tablespoons?', 'tbsps?\\.?', 'tbls?\\.?', 'tbs\\.?'],
    caseSensitive: ['T\\.?'],
  },
  {
    id: 'tsp', dimension: 'volume', system: 'us', toBase: div(CUP_ML, rational(48)), label: 'tsp', labelPlural: 'tsp',
    words: [['teaspoon', 'teaspoons']],
    patterns: ['teaspoons?', 'tsps?\\.?'],
    caseSensitive: ['t\\.?'],
  },
  {
    id: 'cup', dimension: 'volume', system: 'us', toBase: vol(CUP_ML), label: 'cup', labelPlural: 'cups',
    words: [['cup', 'cups']],
    patterns: ['cups?', 'c\\.'],
  },
  {
    id: 'pint', dimension: 'volume', system: 'us', toBase: mul(CUP_ML, rational(2)), label: 'pint', labelPlural: 'pints',
    words: [['pint', 'pints']],
    patterns: ['pints?', 'pts?\\.?'],
  },
  {
    id: 'quart', dimension: 'volume', system: 'us', toBase: mul(CUP_ML, rational(4)), label: 'quart', labelPlural: 'quarts',
    words: [['quart', 'quarts']],
    patterns: ['quarts?', 'qts?\\.?'],
  },
  {
    id: 'gallon', dimension: 'volume', system: 'us', toBase: mul(CUP_ML, rational(16)), label: 'gallon', labelPlural: 'gallons',
    words: [['gallon', 'gallons']],
    patterns: ['gallons?', 'gals?\\.?'],
  },
  {
    id: 'ml', dimension: 'volume', system: 'metric', toBase: rational(1), label: 'ml', labelPlural: 'ml',
    words: [['milliliter', 'milliliters'], ['millilitre', 'millilitres']],
    patterns: ['millilit(?:er|re)s?', 'mls?\\.?'],
  },
  {
    id: 'cl', dimension: 'volume', system: 'metric', toBase: rational(10), label: 'cl', labelPlural: 'cl',
    words: [['centiliter', 'centiliters'], ['centilitre', 'centilitres']],
    patterns: ['centilit(?:er|re)s?', 'cl\\.?'],
  },
  {
    id: 'dl', dimension: 'volume', system: 'metric', toBase: rational(100), label: 'dl', labelPlural: 'dl',
    words: [['deciliter', 'deciliters'], ['decilitre', 'decilitres']],
    patterns: ['decilit(?:er|re)s?', 'dl\\.?'],
  },
  {
    id: 'l', dimension: 'volume', system: 'metric', toBase: rational(1000), label: 'l', labelPlural: 'l',
    words: [['liter', 'liters'], ['litre', 'litres']],
    patterns: ['lit(?:er|re)s?', 'ltrs?\\.?', 'l\\.?'],
  },
  {
    id: 'mg', dimension: 'mass', system: 'metric', toBase: rational(1, 1000), label: 'mg', labelPlural: 'mg',
    words: [['milligram', 'milligrams']],
    patterns: ['milligrams?', 'mg\\.?'],
  },
  {
    id: 'kg', dimension: 'mass', system: 'metric', toBase: rational(1000), label: 'kg', labelPlural: 'kg',
    words: [['kilogram', 'kilograms'], ['kilo', 'kilos']],
    patterns: ['kilograms?', 'kilos?', 'kgs?\\.?'],
  },
  {
    id: 'g', dimension: 'mass', system: 'metric', toBase: rational(1), label: 'g', labelPlural: 'g',
    words: [['gram', 'grams'], ['gramme', 'grammes']],
    patterns: ['grams?', 'grammes?', 'gr\\.?', 'gms?\\.?', 'g\\.?'],
  },
  {
    id: 'lb', dimension: 'mass', system: 'us', toBase: mul(OZ_G, rational(16)), label: 'lb', labelPlural: 'lb',
    words: [['pound', 'pounds']],
    patterns: ['pounds?', 'lbs?\\.?'],
  },
  {
    // Bare "oz"/"ounce": weight or fluid? Never converted; needs review.
    id: 'oz-ambiguous', dimension: 'ambiguous', label: 'oz', labelPlural: 'oz',
    words: [['ounce', 'ounces']],
    patterns: ['ounces?', 'oz\\.?'],
  },
];

/** Count-like units (containers, pieces). Scaled as counts, never converted. */
const COUNT_WORDS: [string, string][] = [
  ['can', 'cans'], ['jar', 'jars'], ['package', 'packages'], ['packet', 'packets'], ['pkg', 'pkgs'],
  ['box', 'boxes'], ['bag', 'bags'], ['bottle', 'bottles'], ['carton', 'cartons'], ['container', 'containers'],
  ['envelope', 'envelopes'], ['stick', 'sticks'], ['clove', 'cloves'], ['slice', 'slices'], ['bunch', 'bunches'],
  ['head', 'heads'], ['sprig', 'sprigs'], ['piece', 'pieces'], ['handful', 'handfuls'], ['pinch', 'pinches'],
  ['dash', 'dashes'], ['stalk', 'stalks'], ['fillet', 'fillets'], ['sheet', 'sheets'],
];

for (const [s, p] of COUNT_WORDS) {
  UNITS.push({
    id: s, dimension: 'count', label: s, labelPlural: p,
    words: [[s, p]],
    patterns: [p === `${s}es` ? `${s}(?:es)?` : `${s}s?`],
  });
}

/** Units that mean "unchanged by scaling". */
export const TO_TASTE_UNITS = new Set(['pinch', 'dash']);

const LETTER = 'A-Za-z\\u00C0-\\u024F';

interface CompiledAlias {
  re: RegExp;
  unit: UnitDef;
}

const COMPILED: CompiledAlias[] = UNITS.flatMap((unit) => [
  ...unit.patterns.map((p) => ({ re: new RegExp(`(?:${p})(?![${LETTER}])`, 'iy'), unit })),
  ...(unit.caseSensitive ?? []).map((p) => ({ re: new RegExp(`(?:${p})(?![${LETTER}])`, 'y'), unit })),
]);

export const UNIT_BY_ID: ReadonlyMap<string, UnitDef> = new Map(UNITS.map((u) => [u.id, u]));

/** Match a unit alias starting exactly at `pos`. Longest match wins. */
export function matchUnitAt(s: string, pos: number): { unit: UnitDef; end: number; text: string } | null {
  let best: { unit: UnitDef; end: number; text: string } | null = null;
  for (const { re, unit } of COMPILED) {
    re.lastIndex = pos;
    const m = re.exec(s);
    if (m && (!best || pos + m[0].length > best.end)) {
      best = { unit, end: pos + m[0].length, text: m[0] };
    }
  }
  return best;
}

/** Return the grammatically adjusted spelling if `text` is a full word alias of `unit`, else null. */
export function inflectUnitWord(unit: UnitDef, text: string, plural: boolean): string | null {
  const lower = text.toLowerCase();
  for (const [s, p] of unit.words) {
    if (lower === s || lower === p) {
      const word = plural ? p : s;
      return text[0] && text[0] !== text[0].toLowerCase() ? word[0]!.toUpperCase() + word.slice(1) : word;
    }
  }
  return null;
}

/** Convert a quantity between two unit ids. Null unless both are the same dimension (mass or volume). */
export function convertQuantity(q: QuantityRange, fromUnit: string, toUnit: string): QuantityRange | null {
  const from = UNIT_BY_ID.get(fromUnit);
  const to = UNIT_BY_ID.get(toUnit);
  if (!from?.toBase || !to?.toBase || from.dimension !== to.dimension) return null;
  const factor = div(from.toBase, to.toBase);
  const out: QuantityRange = { min: mul(q.min, factor) };
  if (q.max) out.max = mul(q.max, factor);
  return out;
}

/** Quantity expressed in the dimension's base unit (ml or g). */
export function toBase(q: QuantityRange, unitId: string): QuantityRange | null {
  const u = UNIT_BY_ID.get(unitId);
  if (!u?.toBase) return null;
  return convertQuantity(q, unitId, u.dimension === 'volume' ? 'ml' : 'g');
}

/**
 * Pick the display unit for a base quantity (ml or g) in the chosen system,
 * based on the larger end of the range.
 */
export function chooseUnit(base: QuantityRange, dimension: 'volume' | 'mass', system: Exclude<UnitSystem, 'original'>): string {
  const v = base.max && cmp(base.max, base.min) > 0 ? base.max : base.min;
  const ge = (unitId: string, amount: Rational): boolean => cmp(v, mul(UNIT_BY_ID.get(unitId)!.toBase!, amount)) >= 0;
  if (system === 'metric') {
    if (dimension === 'volume') return ge('l', rational(1)) ? 'l' : 'ml';
    return ge('kg', rational(1)) ? 'kg' : 'g';
  }
  if (dimension === 'volume') {
    if (ge('cup', rational(1, 4))) return 'cup';
    if (ge('tbsp', rational(1))) return 'tbsp';
    return 'tsp';
  }
  return ge('lb', rational(1)) ? 'lb' : 'oz-weight';
}
