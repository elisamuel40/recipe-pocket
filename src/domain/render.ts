/**
 * Scaling and unit conversion for display. Every render re-parses item.raw,
 * the immutable original line, so repeated transforms never accumulate error.
 */
import type { IngredientItem, RecipeV1, UnitSystem } from '../shared/types';
import { analyzeLine, parseYield, type LineAnalysis, type NumberStyle } from './parse';
import { div, eq, formatDecimal, formatRational, fromQuantityV1, mul, rational, roundTo, scaleRange, toNumber } from './rational';
import type { DisplayIngredient, QuantityRange, Rational, RenderOptions } from './types';
import { chooseUnit, convertQuantity, inflectUnitWord, toBase, UNIT_BY_ID } from './units';

export const NOTES = {
  comma: 'ambiguous decimal comma: not scaled',
  toTaste: 'to taste: not scaled',
  nonScalable: 'temperature, time or size: not scaled',
  noQuantity: 'no quantity found: shown as written',
  ambiguousOz: 'ambiguous oz (weight or fluid?): review; not converted',
  invalidFactor: 'invalid scale factor: shown as written',
} as const;

const ONE = rational(1);

/** Metric display rounding: 5-unit steps from 100, whole units from 10, one decimal from 1, else two decimals. */
export function formatMetricNumber(r: Rational): { text: string; approximate: boolean } {
  const v = Math.abs(toNumber(r));
  let rounded: Rational;
  if (v >= 100) rounded = mul(roundTo(div(r, rational(5)), 1), rational(5));
  else if (v >= 10) rounded = roundTo(r, 1);
  else if (v >= 1) return formatDecimal(r, 1);
  else return formatDecimal(r, 2);
  return { text: formatDecimal(rounded, 0).text, approximate: !eq(rounded, r) || r.approximate === true };
}

function isMetricUnit(unitId: string | undefined): boolean {
  return unitId !== undefined && UNIT_BY_ID.get(unitId)?.system === 'metric';
}

/** Format one quantity value in the given style. */
export function formatValue(r: Rational, style: NumberStyle | 'metric'): { text: string; approximate: boolean } {
  if (style === 'metric') return formatMetricNumber(r);
  if (style === 'decimal') return formatDecimal(r, 2);
  return formatRational(r);
}

/** Format a quantity or range, e.g. "1 1/2" or "2–4". */
export function formatRange(q: QuantityRange, style: NumberStyle | 'metric', sep = '–'): { text: string; approximate: boolean } {
  const a = formatValue(q.min, style);
  if (!q.max) return a;
  const b = formatValue(q.max, style);
  return { text: `${a.text}${sep}${b.text}`, approximate: a.approximate || b.approximate };
}

/** Grammatical number follows the displayed (rounded) value: "1 cup", "1/4 cup", "1 1/8 cups", "2–4 cups". */
function isPluralText(formatted: string, sep: string): boolean {
  const last = (sep && formatted.includes(sep) ? formatted.slice(formatted.lastIndexOf(sep) + sep.length) : formatted).trim();
  return !/^(?:0(?:\.\d+)?|1|\d+\/\d+)$/.test(last);
}

/** Display label for a canonical unit id, e.g. "cups", "tbsp", "ml". */
export function unitLabel(unitId: string, plural: boolean): string {
  const u = UNIT_BY_ID.get(unitId);
  if (!u) return unitId;
  return plural ? u.labelPlural : u.label;
}

/**
 * Convert a quantity in `unitId` to the display unit for `system`.
 * Returns null when no conversion applies (original system, unit already in
 * that system, count/ambiguous/unknown unit).
 */
export function convertForSystem(q: QuantityRange, unitId: string, system: UnitSystem): { quantity: QuantityRange; unit: string } | null {
  if (system === 'original') return null;
  const u = UNIT_BY_ID.get(unitId);
  if (!u?.toBase || (u.dimension !== 'mass' && u.dimension !== 'volume')) return null;
  if (u.system === system) return null;
  const base = toBase(q, unitId)!;
  const target = chooseUnit(base, u.dimension, system);
  const quantity = convertQuantity(q, unitId, target)!;
  return { quantity, unit: target };
}

function verbatim(raw: string, note?: string): DisplayIngredient {
  const out: DisplayIngredient = { text: raw, original: raw, approximate: false, unchanged: true };
  if (note) out.note = note;
  return out;
}

function renderAnalysis(a: LineAnalysis, factor: Rational, system: UnitSystem): DisplayIngredient {
  const raw = a.raw;
  const q = a.parsed.quantity;
  if (a.reason || !q) return verbatim(raw, NOTES[a.reason ?? 'noQuantity']);

  const unit = a.unitDef;
  const note = unit?.id === 'oz-ambiguous' && system !== 'original' ? NOTES.ambiguousOz : undefined;
  const scaled = scaleRange(q, factor);

  const converted = unit ? convertForSystem(scaled, unit.id, system) : null;
  if (converted) {
    const style = system === 'metric' ? 'metric' : 'fraction';
    const f = formatRange(converted.quantity, style, a.sep ?? '–');
    const label = unitLabel(converted.unit, isPluralText(f.text, a.sep ?? '–'));
    const text = `${raw.slice(0, a.qStart)}${f.text} ${label}${raw.slice(a.unitEnd)}`;
    const out: DisplayIngredient = { text, original: raw, approximate: true, unchanged: false };
    if (note) out.note = note;
    return out;
  }

  if (eq(factor, ONE)) {
    const out: DisplayIngredient = { text: raw, original: raw, approximate: false, unchanged: false };
    if (note) out.note = note;
    return out;
  }

  const style: NumberStyle | 'metric' = isMetricUnit(unit?.id) ? 'metric' : a.style;
  const f = formatRange(scaled, style, a.sep ?? '–');
  let unitText = a.unitText;
  if (unit && unitText) unitText = inflectUnitWord(unit, unitText, isPluralText(f.text, a.sep ?? '–')) ?? unitText;
  const text = unit
    ? `${raw.slice(0, a.qStart)}${f.text}${raw.slice(a.qEnd, a.unitStart)}${unitText}${raw.slice(a.unitEnd)}`
    : `${raw.slice(0, a.qStart)}${f.text}${raw.slice(a.qEnd)}`;
  const out: DisplayIngredient = { text, original: raw, approximate: f.approximate, unchanged: false };
  if (note) out.note = note;
  return out;
}

/** Render an ingredient for display, always derived from item.raw (the immutable original). */
export function renderIngredient(item: IngredientItem, opts: RenderOptions): DisplayIngredient {
  const raw = typeof item.raw === 'string' ? item.raw : '';
  const factor = opts.factor;
  if (!factor || !Number.isFinite(factor.n) || !Number.isFinite(factor.d) || factor.d <= 0 || factor.n <= 0) {
    return verbatim(raw, NOTES.invalidFactor);
  }
  if (eq(factor, ONE) && opts.system === 'original') {
    return { text: raw, original: raw, approximate: false, unchanged: false };
  }
  return renderAnalysis(analyzeLine(raw), factor, opts.system);
}

/** Original servings as a rational (yield quantity minimum, or parsed from yield text). */
export function originalServings(recipe: RecipeV1): Rational | null {
  const y = recipe.originalYield;
  if (!y) return null;
  let min: Rational | undefined;
  if (y.quantity) {
    try {
      min = fromQuantityV1(y.quantity).min;
    } catch {
      min = undefined;
    }
  }
  if (!min && typeof y.text === 'string') min = parseYield(y.text).quantity?.min;
  if (!min || min.n <= 0) return null;
  return min;
}

/** Factor = target / original servings. Returns null if the recipe yield has no numeric quantity. */
export function scaleFactorForServings(recipe: RecipeV1, target: Rational): Rational | null {
  const orig = originalServings(recipe);
  if (!orig || !target || target.n <= 0 || target.d <= 0) return null;
  return div(target, orig);
}
