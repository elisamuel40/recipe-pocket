/**
 * Ingredient line, yield and servings parsing.
 *
 * The parser is conservative: anything it cannot read with confidence is kept
 * verbatim (confidence "low") and never scaled. It also records the exact
 * character spans of the leading quantity and unit so rendering can replace
 * only those spans and leave the rest of the source line untouched.
 */
import type { IngredientItem } from '../shared/types';
import { cmp, div, fromDecimalString, rational, toQuantityV1 } from './rational';
import type { ParsedIngredient, QuantityRange, Rational } from './types';
import { matchUnitAt, TO_TASTE_UNITS, type UnitDef } from './units';

const VULGAR: Record<string, [number, number]> = {
  '½': [1, 2], '⅓': [1, 3], '⅔': [2, 3], '¼': [1, 4], '¾': [3, 4],
  '⅕': [1, 5], '⅖': [2, 5], '⅗': [3, 5], '⅘': [4, 5], '⅙': [1, 6], '⅚': [5, 6],
  '⅐': [1, 7], '⅛': [1, 8], '⅜': [3, 8], '⅝': [5, 8], '⅞': [7, 8], '⅑': [1, 9], '⅒': [1, 10],
};
const VULGAR_CLASS = `[${Object.keys(VULGAR).join('')}]`;
const SP = '[ \\t\\u00A0\\u202F]';

export type NumberStyle = 'fraction' | 'decimal';

interface NumberToken {
  value: Rational;
  end: number;
  style: NumberStyle;
  mixedHyphen?: boolean;
}

interface QuantityToken {
  range?: QuantityRange;
  end: number;
  style: NumberStyle;
  /** Separator text between min and max for ranges (" to ", "-", "–"). */
  sep?: string;
  /** Decimal-comma ambiguity ("1,5" or "1,500"): not interpreted. */
  comma?: boolean;
  mixedHyphen?: boolean;
}

function sticky(src: string, flags = ''): RegExp {
  return new RegExp(src, `y${flags}`);
}

const RE_INT_OR_DEC = sticky('(\\d+)(?:([.,])(\\d+))?|\\.(\\d+)');
const RE_FRACTION = sticky(`${SP}*[/\\u2044]${SP}*(\\d+)`);
const RE_INT_VULGAR = sticky(`${SP}*(${VULGAR_CLASS})`);
const RE_MIXED = sticky(`${SP}+(\\d+)${SP}*[/\\u2044]${SP}*(\\d+)`);
const RE_MIXED_HYPHEN = sticky('-(\\d+)[/\\u2044](\\d+)');
const RE_RANGE_SEP = sticky(`${SP}*[-\\u2010\\u2011\\u2012\\u2013\\u2014\\u2212]${SP}*|${SP}+to${SP}+`, 'i');

function execAt(re: RegExp, s: string, pos: number): RegExpExecArray | null {
  re.lastIndex = pos;
  return re.exec(s);
}

function parseNumberAt(s: string, pos: number): NumberToken | { comma: true; end: number } | null {
  const ch = s[pos];
  if (ch && VULGAR[ch]) {
    const [n, d] = VULGAR[ch];
    return { value: rational(n, d), end: pos + 1, style: 'fraction' };
  }
  const m = execAt(RE_INT_OR_DEC, s, pos);
  if (!m) return null;
  let end = pos + m[0].length;
  if (m[4] !== undefined) {
    return { value: fromDecimalString(`0.${m[4]}`)!, end, style: 'decimal' };
  }
  const intText = m[1]!;
  if (m[2] === ',') return { comma: true, end };
  if (m[2] === '.') {
    return { value: fromDecimalString(`${intText}.${m[3]}`)!, end, style: 'decimal' };
  }
  const whole = fromDecimalString(intText)!;
  let f = execAt(RE_FRACTION, s, end);
  if (f && Number(f[1]) > 0) {
    return { value: div(whole, rational(Number(f[1]))), end: end + f[0].length, style: 'fraction' };
  }
  f = execAt(RE_INT_VULGAR, s, end);
  if (f) {
    const [n, d] = VULGAR[f[1]!]!;
    return { value: addInt(whole, n, d), end: end + f[0].length, style: 'fraction' };
  }
  f = execAt(RE_MIXED, s, end);
  if (f) {
    const n = Number(f[1]);
    const d = Number(f[2]);
    if (d > 0 && n < d) return { value: addInt(whole, n, d), end: end + f[0].length, style: 'fraction' };
  }
  f = execAt(RE_MIXED_HYPHEN, s, end);
  if (f) {
    const n = Number(f[1]);
    const d = Number(f[2]);
    if (d > 0 && n < d) return { value: addInt(whole, n, d), end: end + f[0].length, style: 'fraction', mixedHyphen: true };
  }
  return { value: whole, end, style: 'fraction' };
}

function addInt(whole: Rational, n: number, d: number): Rational {
  return rational(whole.n * d + n, d);
}

/** Parse a number or range ("1 1/2", "½", "1-2", "1 to 2", "0.5") starting at pos. */
export function parseQuantityAt(s: string, pos: number): QuantityToken | null {
  const first = parseNumberAt(s, pos);
  if (!first) return null;
  if ('comma' in first) return { end: first.end, style: 'decimal', comma: true };
  const sep = execAt(RE_RANGE_SEP, s, first.end);
  if (sep) {
    const second = parseNumberAt(s, first.end + sep[0].length);
    if (second) {
      if ('comma' in second) return { end: second.end, style: 'decimal', comma: true };
      const tok: QuantityToken = {
        range: { min: first.value, max: second.value },
        end: second.end,
        style: first.style === 'decimal' || second.style === 'decimal' ? 'decimal' : 'fraction',
        sep: sep[0],
      };
      if (first.mixedHyphen || second.mixedHyphen) tok.mixedHyphen = true;
      return tok;
    }
  }
  const tok: QuantityToken = { range: { min: first.value }, end: first.end, style: first.style };
  if (first.mixedHyphen) tok.mixedHyphen = true;
  return tok;
}

export type NotScaledReason = 'comma' | 'toTaste' | 'nonScalable' | 'noQuantity';

/** Internal analysis with character spans; used by rendering and shopping lists. */
export interface LineAnalysis {
  raw: string;
  parsed: ParsedIngredient;
  /** Why the line must be shown verbatim; undefined when scalable. */
  reason?: NotScaledReason;
  qStart: number;
  qEnd: number;
  sep?: string;
  style: NumberStyle;
  unitDef?: UnitDef;
  unitStart: number;
  unitEnd: number;
  unitText: string;
}

const RE_LEAD = sticky('(?:\\s|[•▢*·▪◦]|-(?=\\s))*');
const RE_NON_SCALABLE = sticky(
  `${SP}*-?${SP}*(?:°|º|degrees?(?![a-z])|deg(?![a-z])|[x×]${SP}*\\d|inch(?:es)?(?![a-z])|in\\.|["”″]|cm(?![a-z])|centimet|mm(?![a-z])|minutes?(?![a-z])|mins?(?![a-z])|hours?(?![a-z])|hrs?(?![a-z])|seconds?(?![a-z])|secs?(?![a-z]))`,
  'i',
);
const RE_PAREN_OPEN = sticky(`${SP}*\\(${SP}*`);
const RE_PAREN_CLOSE = sticky(`${SP}*\\)`);
const RE_DASH_GAP = sticky(`${SP}*-?${SP}*`);
const RE_SPACES = sticky(`${SP}*`);
const RE_SPACES1 = sticky(`${SP}+`);
const RE_OF = sticky(`${SP}*(?:of${SP}+)?`, 'i');
const RE_TO_TASTE = /\b(?:to taste|as needed|as required|as desired|according to taste)\b/i;
const RE_PINCH = /\b(?:pinch(?:es)?|dash(?:es)?)\b/i;

function isMeasureUnit(u: UnitDef): boolean {
  return u.dimension === 'mass' || u.dimension === 'volume' || u.dimension === 'ambiguous';
}

/** Split "onion (large), finely chopped" into ingredient "onion" and preparation "finely chopped". */
function splitRest(rest: string): { ingredient?: string; preparation?: string } {
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === '(' || c === '[') depth++;
    else if ((c === ')' || c === ']') && depth > 0) depth--;
    else if (c === ',' && depth === 0) {
      cut = i;
      break;
    }
  }
  const head = cut >= 0 ? rest.slice(0, cut) : rest;
  const tail = cut >= 0 ? rest.slice(cut + 1) : '';
  const ingredient = head
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-–:;.\s]+|[-–:;.\s]+$/g, '');
  const preparation = tail.replace(/\s+/g, ' ').trim().replace(/[.;\s]+$/, '');
  const out: { ingredient?: string; preparation?: string } = {};
  if (ingredient) out.ingredient = ingredient;
  if (preparation) out.preparation = preparation;
  return out;
}

export function analyzeLine(raw: string): LineAnalysis {
  const text = typeof raw === 'string' ? raw : '';
  const lead = execAt(RE_LEAD, text, 0);
  const start = lead ? lead[0].length : 0;
  const base: LineAnalysis = {
    raw: text,
    parsed: { unitKnown: false, toTaste: false, confidence: 'low' },
    qStart: start,
    qEnd: start,
    style: 'fraction',
    unitStart: start,
    unitEnd: start,
    unitText: '',
  };

  const q = parseQuantityAt(text, start);

  if (!q) {
    const toTaste = RE_TO_TASTE.test(text) || RE_PINCH.test(text);
    const cleaned = text
      .slice(start)
      .replace(/^(?:an?\s+)?(?:pinch(?:es)?|dash(?:es)?)\s+(?:of\s+)?/i, '')
      .replace(/,?\s*(?:or\s+)?(?:to taste|as needed|as required|as desired|according to taste)\b/gi, '');
    base.parsed = { ...splitRest(cleaned), unitKnown: false, toTaste, confidence: toTaste ? 'high' : 'low' };
    base.reason = toTaste ? 'toTaste' : 'noQuantity';
    return base;
  }

  if (q.comma || !q.range) {
    base.qEnd = q.end;
    base.parsed = { ...splitRest(text.slice(q.end)), unitKnown: false, toTaste: false, confidence: 'low' };
    base.reason = 'comma';
    return base;
  }

  base.qEnd = q.end;
  base.style = q.style;
  if (q.sep !== undefined) base.sep = q.sep;

  if (execAt(RE_NON_SCALABLE, text, q.end)) {
    base.parsed = { ...splitRest(text.slice(start)), unitKnown: false, toTaste: false, confidence: 'medium' };
    base.reason = 'nonScalable';
    return base;
  }

  let pos = q.end;
  let packageSize: ParsedIngredient['packageSize'];

  // "2 (14 oz) cans"
  const open = execAt(RE_PAREN_OPEN, text, pos);
  if (open) {
    const pq = parseQuantityAt(text, pos + open[0].length);
    if (pq?.range) {
      const gap = execAt(RE_DASH_GAP, text, pq.end)!;
      const pu = matchUnitAt(text, pq.end + gap[0].length);
      if (pu && isMeasureUnit(pu.unit)) {
        const close = execAt(RE_PAREN_CLOSE, text, pu.end);
        if (close) {
          packageSize = { quantity: pq.range, unit: pu.unit.id };
          pos = pu.end + close[0].length;
        }
      }
    }
  }
  // "2 14-oz cans"
  if (!packageSize) {
    const sp = execAt(RE_SPACES1, text, pos);
    if (sp) {
      const pn = parseQuantityAt(text, pos + sp[0].length);
      if (pn?.range && !pn.range.max) {
        const gap = execAt(RE_DASH_GAP, text, pn.end)!;
        const pu = matchUnitAt(text, pn.end + gap[0].length);
        if (pu && isMeasureUnit(pu.unit)) {
          const sp2 = execAt(RE_SPACES1, text, pu.end);
          const cu = sp2 ? matchUnitAt(text, pu.end + sp2[0].length) : null;
          if (cu && cu.unit.dimension === 'count') {
            packageSize = { quantity: pn.range, unit: pu.unit.id };
            pos = pu.end;
          }
        }
      }
    }
  }

  const gap = execAt(RE_SPACES, text, pos)!;
  const um = matchUnitAt(text, pos + gap[0].length);
  let restStart = pos;
  if (um) {
    base.unitDef = um.unit;
    base.unitStart = pos + gap[0].length;
    base.unitEnd = um.end;
    base.unitText = um.text;
    restStart = um.end;
  } else {
    base.unitStart = pos;
    base.unitEnd = pos;
  }
  const of = execAt(RE_OF, text, restStart);
  if (um && of) restStart += of[0].length;

  const split = splitRest(text.slice(restStart));
  const toTaste = um ? TO_TASTE_UNITS.has(um.unit.id) : false;

  let confidence: ParsedIngredient['confidence'] = 'high';
  if (!split.ingredient) confidence = 'low';
  else if (um?.unit.id === 'oz-ambiguous' || q.mixedHyphen) confidence = 'medium';
  if (q.range.max && cmp(q.range.max, q.range.min) < 0) confidence = 'low';
  if (q.range.min.n === 0 && !q.range.max) confidence = 'low';

  const parsed: ParsedIngredient = {
    quantity: q.range,
    unitKnown: Boolean(um),
    toTaste,
    confidence,
    ...split,
  };
  if (um) parsed.unit = um.unit.id;
  if (packageSize) parsed.packageSize = packageSize;
  base.parsed = parsed;
  if (toTaste) base.reason = 'toTaste';
  return base;
}

/** Parse one ingredient line. Handles mixed/Unicode fractions, ranges, packages, "to taste". */
export function parseIngredientLine(raw: string): ParsedIngredient {
  return analyzeLine(raw).parsed;
}

/** Build a persisted IngredientItem from a raw line (fills quantity/unit/ingredient/preparation/confidence). */
export function toIngredientItem(raw: string, id: string): IngredientItem {
  const p = parseIngredientLine(raw);
  const item: IngredientItem = { id, raw, confidence: p.confidence };
  if (p.quantity) item.quantity = toQuantityV1(p.quantity);
  if (p.unit) item.unit = p.unit;
  if (p.ingredient) item.ingredient = p.ingredient;
  if (p.preparation) item.preparation = p.preparation;
  return item;
}

/** Parse a yield string ("Makes 12 cookies", "4 servings", "Serves 4-6", "1 loaf", "12"). */
export function parseYield(text: string): { quantity?: QuantityRange; unit?: string } {
  if (typeof text !== 'string') return {};
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (!(/\d/.test(c) || VULGAR[c] || (c === '.' && /\d/.test(text[i + 1] ?? '')))) continue;
    if (i > 0 && /[\dA-Za-z.]/.test(text[i - 1]!)) continue;
    const q = parseQuantityAt(text, i);
    if (!q || q.comma || !q.range) continue;
    if (q.range.min.n <= 0) return {};
    if (q.range.max && cmp(q.range.max, q.range.min) < 0) return {};
    const out: { quantity?: QuantityRange; unit?: string } = { quantity: q.range };
    const unit = text
      .slice(q.end)
      .split(/[(,;]/)[0]!
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[.:\s]+$/, '');
    if (unit) out.unit = unit;
    return out;
  }
  return {};
}

const MAX_SERVINGS = 10000;

/** Parse a free-form servings input from the UI ("3", "1 1/2", "0.5", "½"). Returns null when invalid or <= 0. */
export function parseServingsInput(text: string): Rational | null {
  if (typeof text !== 'string') return null;
  let s = text.trim();
  if (!s || s.length > 32) return null;
  // A servings box never holds thousands, so "1,5" can only mean 1.5 here.
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  const tok = parseNumberAt(s, 0);
  if (!tok || 'comma' in tok || tok.end !== s.length) return null;
  const v = tok.value;
  if (v.n <= 0 || cmp(v, rational(MAX_SERVINGS)) > 0) return null;
  return v;
}
