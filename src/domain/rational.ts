/**
 * Exact rational arithmetic for recipe quantities.
 *
 * Every value is a reduced fraction n/d with d > 0 and |n|, d within
 * Number.MAX_SAFE_INTEGER. Intermediate products use BigInt so nothing is
 * lost to binary floating point. When a reduced result would not fit in safe
 * integers it is replaced by the closest continued-fraction convergent that
 * does fit, and flagged `approximate: true`.
 */
import type { QuantityV1 } from '../shared/types';
import type { QuantityRange, Rational } from './types';

const MAX = BigInt(Number.MAX_SAFE_INTEGER);

function bigAbs(x: bigint): bigint {
  return x < 0n ? -x : x;
}

function bigGcd(a: bigint, b: bigint): bigint {
  a = bigAbs(a);
  b = bigAbs(b);
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/** Best approximation of n/d (d > 0) with numerator and denominator within MAX. */
function approximateBig(n: bigint, d: bigint): Rational {
  const negative = n < 0n;
  let p = bigAbs(n);
  let q = d;
  if (p / q > MAX) {
    return { n: negative ? -Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER, d: 1, approximate: true };
  }
  // Continued fraction convergents h/k.
  let h0 = 0n;
  let h1 = 1n;
  let k0 = 1n;
  let k1 = 0n;
  let bestN = 0n;
  let bestD = 1n;
  while (q !== 0n) {
    const a = p / q;
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    if (h2 > MAX || k2 > MAX) break;
    bestN = h2;
    bestD = k2;
    h0 = h1;
    h1 = h2;
    k0 = k1;
    k1 = k2;
    const r = p - a * q;
    p = q;
    q = r;
  }
  const num = Number(bestN);
  return { n: negative && num !== 0 ? -num : num, d: Number(bestD), approximate: true };
}

function fromBig(n: bigint, d: bigint, approximate = false): Rational {
  if (d === 0n) throw new RangeError('Rational: zero denominator');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = bigGcd(n, d) || 1n;
  n /= g;
  d /= g;
  if (bigAbs(n) > MAX || d > MAX) return approximateBig(n, d);
  const r: Rational = { n: Number(n), d: Number(d) };
  if (r.n === 0) r.n = 0; // normalize -0
  if (approximate) r.approximate = true;
  return r;
}

function isApprox(...rs: Rational[]): boolean {
  return rs.some((r) => r.approximate === true);
}

/** Exact rational from a finite decimal number (uses its shortest decimal representation). */
export function fromNumber(x: number): Rational {
  if (!Number.isFinite(x)) throw new RangeError('Rational: non-finite number');
  if (Number.isInteger(x)) {
    if (Math.abs(x) > Number.MAX_SAFE_INTEGER) return approximateBig(BigInt(x), 1n);
    return { n: x === 0 ? 0 : x, d: 1 };
  }
  return fromDecimalString(String(x)) ?? approximateBig(BigInt(Math.round(x * 1e9)), 1000000000n);
}

/**
 * Parse a plain decimal string ("0.5", ".25", "12", "-1.5", "1e-3") into an
 * exact rational. Returns null when the string is not a decimal number.
 */
export function fromDecimalString(s: string): Rational | null {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(s.trim());
  if (!m) return null;
  const sign = m[1] === '-' ? -1n : 1n;
  const intPart = m[2] ?? '';
  const frac = m[3] ?? '';
  if (intPart === '' && frac === '') return null;
  const exp = m[4] ? parseInt(m[4], 10) : 0;
  if (Math.abs(exp) > 300) return null;
  let n = BigInt((intPart || '0') + frac) * sign;
  let d = 10n ** BigInt(frac.length);
  if (exp > 0) n *= 10n ** BigInt(exp);
  else if (exp < 0) d *= 10n ** BigInt(-exp);
  return fromBig(n, d);
}

/** Create a reduced rational. Non-integer inputs are converted exactly via their decimal form. */
export function rational(n: number, d = 1): Rational {
  if (!Number.isFinite(n) || !Number.isFinite(d)) throw new RangeError('Rational: non-finite input');
  if (d === 0) throw new RangeError('Rational: zero denominator');
  if (Number.isInteger(n) && Number.isInteger(d) && Math.abs(n) <= Number.MAX_SAFE_INTEGER && Math.abs(d) <= Number.MAX_SAFE_INTEGER) {
    return fromBig(BigInt(n), BigInt(d));
  }
  return div(fromNumber(n), fromNumber(d));
}

export function add(a: Rational, b: Rational): Rational {
  const n = BigInt(a.n) * BigInt(b.d) + BigInt(b.n) * BigInt(a.d);
  return fromBig(n, BigInt(a.d) * BigInt(b.d), isApprox(a, b));
}

export function sub(a: Rational, b: Rational): Rational {
  return add(a, { n: -b.n, d: b.d, ...(b.approximate ? { approximate: true } : {}) });
}

export function mul(a: Rational, b: Rational): Rational {
  return fromBig(BigInt(a.n) * BigInt(b.n), BigInt(a.d) * BigInt(b.d), isApprox(a, b));
}

export function div(a: Rational, b: Rational): Rational {
  if (b.n === 0) throw new RangeError('Rational: division by zero');
  return fromBig(BigInt(a.n) * BigInt(b.d), BigInt(a.d) * BigInt(b.n), isApprox(a, b));
}

/** Value equality (ignores the approximate flag). */
export function eq(a: Rational, b: Rational): boolean {
  return cmp(a, b) === 0;
}

/** -1, 0 or 1. */
export function cmp(a: Rational, b: Rational): number {
  const l = BigInt(a.n) * BigInt(b.d);
  const r = BigInt(b.n) * BigInt(a.d);
  return l < r ? -1 : l > r ? 1 : 0;
}

export function isZero(r: Rational): boolean {
  return r.n === 0;
}

export function toNumber(r: Rational): number {
  return r.n / r.d;
}

/** Round to the nearest multiple of 1/denominator (half away from zero), exactly. */
export function roundTo(r: Rational, denominator: number): Rational {
  const n = BigInt(r.n) * BigInt(denominator);
  const d = BigInt(r.d);
  const neg = n < 0n;
  const absN = bigAbs(n);
  let q = absN / d;
  if ((absN % d) * 2n >= d) q += 1n;
  return fromBig(neg ? -q : q, BigInt(denominator), r.approximate === true);
}

/** Cooking denominators tried for exact display. */
const EXACT_DENOMINATORS = [2, 3, 4, 8, 16];
/** Denominators used when rounding to the nearest friendly fraction. */
const NEAREST_DENOMINATORS = [2, 3, 4, 8];

function mixed(r: Rational): string {
  const neg = r.n < 0;
  const n = Math.abs(r.n);
  const whole = Math.floor(n / r.d);
  const rem = n % r.d;
  let text: string;
  if (rem === 0) text = String(whole);
  else if (whole === 0) text = `${rem}/${r.d}`;
  else text = `${whole} ${rem}/${r.d}`;
  return neg ? `-${text}` : text;
}

/** Format a decimal with at most `maxDecimals` places, trimming trailing zeros. */
export function formatDecimal(r: Rational, maxDecimals = 2): { text: string; approximate: boolean } {
  const rounded = roundTo(r, 10 ** maxDecimals);
  const approximate = !eq(rounded, r) || r.approximate === true;
  const neg = rounded.n < 0;
  const scale = 10 ** maxDecimals;
  // rounded.d divides scale, so this is an exact integer.
  const scaled = Math.abs(rounded.n) * (scale / rounded.d);
  const whole = Math.floor(scaled / scale);
  const frac = maxDecimals > 0 ? String(scaled % scale).padStart(maxDecimals, '0').replace(/0+$/, '') : '';
  const text = frac ? `${whole}.${frac}` : String(whole);
  return { text: neg && text !== '0' ? `-${text}` : text, approximate };
}

/**
 * Display as a mixed fraction ("1 1/2") using cooking denominators
 * (2, 3, 4, 8, 16). Exact when the reduced denominator is one of them;
 * otherwise rounds to the nearest 1/2, 1/3, 1/4 or 1/8 and sets approximate.
 * Very small non-zero values (below 1/16) are shown as a short decimal.
 */
export function formatRational(r: Rational): { text: string; approximate: boolean } {
  const flagged = r.approximate === true;
  if (r.d === 1 || EXACT_DENOMINATORS.includes(r.d)) {
    return { text: mixed(r), approximate: flagged };
  }
  const abs = Math.abs(r.n) / r.d;
  if (abs < 1 / 16) {
    // Two significant digits.
    const digits = Math.max(2, 1 - Math.floor(Math.log10(abs)));
    return { text: formatDecimal(r, Math.min(digits, 6)).text, approximate: true };
  }
  let best: Rational | null = null;
  let bestErr = Infinity;
  for (const den of NEAREST_DENOMINATORS) {
    const cand = roundTo(r, den);
    const err = Math.abs(toNumber(sub(cand, r)));
    if (err < bestErr - 1e-12) {
      best = cand;
      bestErr = err;
    }
  }
  const chosen = best ?? r;
  if (chosen.n === 0) return { text: formatDecimal(r, 2).text, approximate: true };
  return { text: mixed(chosen), approximate: true };
}

export function scaleRange(q: QuantityRange, factor: Rational): QuantityRange {
  const out: QuantityRange = { min: mul(q.min, factor) };
  if (q.max) out.max = mul(q.max, factor);
  return out;
}

export function addRanges(a: QuantityRange, b: QuantityRange): QuantityRange {
  const min = add(a.min, b.min);
  if (!a.max && !b.max) return { min };
  return { min, max: add(a.max ?? a.min, b.max ?? b.min) };
}

export function toQuantityV1(q: QuantityRange): QuantityV1 {
  const out: QuantityV1 = { minNumerator: q.min.n, minDenominator: q.min.d };
  if (q.max) {
    out.maxNumerator = q.max.n;
    out.maxDenominator = q.max.d;
  }
  return out;
}

export function fromQuantityV1(q: QuantityV1): QuantityRange {
  const out: QuantityRange = { min: rational(q.minNumerator, q.minDenominator) };
  if (typeof q.maxNumerator === 'number' && typeof q.maxDenominator === 'number') {
    out.max = rational(q.maxNumerator, q.maxDenominator);
  }
  return out;
}
