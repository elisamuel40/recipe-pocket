import { describe, expect, it } from 'vitest';
import {
  add,
  addRanges,
  cmp,
  div,
  eq,
  formatRational,
  fromDecimalString,
  fromQuantityV1,
  mul,
  rational,
  scaleRange,
  sub,
  toNumber,
  toQuantityV1,
} from '../../src/domain';

describe('rational', () => {
  it('reduces and normalizes the sign', () => {
    expect(rational(2, 4)).toEqual({ n: 1, d: 2 });
    expect(rational(3, -6)).toEqual({ n: -1, d: 2 });
    expect(rational(0, 5)).toEqual({ n: 0, d: 1 });
    expect(rational(7)).toEqual({ n: 7, d: 1 });
  });

  it('converts decimal inputs exactly', () => {
    expect(rational(0.5)).toEqual({ n: 1, d: 2 });
    expect(rational(0.1)).toEqual({ n: 1, d: 10 });
    expect(fromDecimalString('1.25')).toEqual({ n: 5, d: 4 });
    expect(fromDecimalString('.75')).toEqual({ n: 3, d: 4 });
    expect(fromDecimalString('abc')).toBeNull();
  });

  it('rejects zero denominators and division by zero', () => {
    expect(() => rational(1, 0)).toThrow();
    expect(() => div(rational(1), rational(0))).toThrow();
  });

  it('1 1/2 x 2/3 = 1', () => {
    expect(mul(rational(3, 2), rational(2, 3))).toEqual({ n: 1, d: 1 });
  });

  it('1/3 x 3 = 1 and 1/3 + 1/3 + 1/3 = 1', () => {
    expect(eq(mul(rational(1, 3), rational(3)), rational(1))).toBe(true);
    expect(add(add(rational(1, 3), rational(1, 3)), rational(1, 3))).toEqual({ n: 1, d: 1 });
  });

  it('add, sub, div, cmp', () => {
    expect(add(rational(1, 4), rational(1, 6))).toEqual({ n: 5, d: 12 });
    expect(sub(rational(1, 2), rational(1, 3))).toEqual({ n: 1, d: 6 });
    expect(div(rational(3, 4), rational(3, 8))).toEqual({ n: 2, d: 1 });
    expect(cmp(rational(1, 3), rational(1, 2))).toBe(-1);
    expect(cmp(rational(2, 4), rational(1, 2))).toBe(0);
    expect(toNumber(rational(3, 4))).toBe(0.75);
  });

  it('ranges: 1-2 x 2 = 2-4; ranges add min and max', () => {
    const r = scaleRange({ min: rational(1), max: rational(2) }, rational(2));
    expect(r).toEqual({ min: { n: 2, d: 1 }, max: { n: 4, d: 1 } });
    expect(addRanges({ min: rational(1), max: rational(2) }, { min: rational(1, 2) })).toEqual({
      min: { n: 3, d: 2 },
      max: { n: 5, d: 2 },
    });
  });

  it('property: scaling by k then 1/k returns the original exactly', () => {
    const bases = [rational(1), rational(3, 2), rational(1, 3), rational(7, 8), rational(250)];
    for (let num = 1; num <= 40; num++) {
      for (let den = 1; den <= 12; den++) {
        const k = rational(num, den);
        for (const b of bases) {
          expect(eq(mul(mul(b, k), div(rational(1), k)), b)).toBe(true);
        }
      }
    }
  });

  it('100 sequential transforms stay exact (no float drift)', () => {
    let x = rational(3, 2);
    const factors: [number, number][] = [];
    for (let i = 0; i < 100; i++) factors.push([(i % 7) + 1, (i % 5) + 2]);
    for (const [n, d] of factors) {
      x = mul(x, rational(n, d));
      x = div(x, rational(n, d));
    }
    // A long cumulative chain also stays exact while it fits in safe integers.
    let y = rational(1, 3);
    for (let i = 0; i < 100; i++) y = mul(y, rational(i % 2 === 0 ? 3 : 1, i % 2 === 0 ? 1 : 3));
    expect(y).toEqual({ n: 1, d: 3 });
    expect(x).toEqual({ n: 3, d: 2 });
    expect(x.approximate).toBeUndefined();
  });

  it('guards overflow: approximates within MAX_SAFE_INTEGER and flags approximate', () => {
    const big = rational(Number.MAX_SAFE_INTEGER - 2, 3);
    const r = mul(big, rational(Number.MAX_SAFE_INTEGER - 4, 7));
    expect(Math.abs(r.n)).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(r.d).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(r.approximate).toBe(true);
    const tiny = mul(rational(1, 999999937), rational(1, 999999929));
    expect(tiny.d).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(tiny.approximate).toBe(true);
    // Approximation propagates.
    expect(add(r, rational(1)).approximate).toBe(true);
  });

  it('QuantityV1 round trip', () => {
    const q = { min: rational(1, 2), max: rational(3, 4) };
    expect(toQuantityV1(q)).toEqual({ minNumerator: 1, minDenominator: 2, maxNumerator: 3, maxDenominator: 4 });
    expect(fromQuantityV1(toQuantityV1(q))).toEqual(q);
    expect(toQuantityV1({ min: rational(2) })).toEqual({ minNumerator: 2, minDenominator: 1 });
    expect(fromQuantityV1({ minNumerator: 4, minDenominator: 8 })).toEqual({ min: { n: 1, d: 2 } });
  });
});

describe('formatRational', () => {
  it('formats exact cooking fractions', () => {
    expect(formatRational(rational(3, 2))).toEqual({ text: '1 1/2', approximate: false });
    expect(formatRational(rational(1, 3))).toEqual({ text: '1/3', approximate: false });
    expect(formatRational(rational(2))).toEqual({ text: '2', approximate: false });
    expect(formatRational(rational(11, 8))).toEqual({ text: '1 3/8', approximate: false });
    expect(formatRational(rational(3, 16))).toEqual({ text: '3/16', approximate: false });
    expect(formatRational(rational(0))).toEqual({ text: '0', approximate: false });
  });

  it('rounds other denominators to the nearest friendly fraction and flags approximate', () => {
    expect(formatRational(rational(1, 5))).toEqual({ text: '1/4', approximate: true });
    expect(formatRational(rational(33, 100))).toEqual({ text: '1/3', approximate: true });
    expect(formatRational(rational(201, 100))).toEqual({ text: '2', approximate: true });
  });

  it('shows very small values as decimals', () => {
    const f = formatRational(rational(1, 100));
    expect(f.approximate).toBe(true);
    expect(f.text).toBe('0.01');
  });

  it('flags values that were already approximate', () => {
    expect(formatRational({ n: 1, d: 2, approximate: true }).approximate).toBe(true);
  });
});
