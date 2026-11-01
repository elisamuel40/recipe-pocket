import { describe, expect, it } from 'vitest';
import {
  convertQuantity,
  formatMetricNumber,
  rational,
  renderIngredient,
  scaleFactorForServings,
  toIngredientItem,
  type Rational,
} from '../../src/domain';
import type { RecipeV1, UnitSystem } from '../../src/shared/types';

const item = (raw: string) => toIngredientItem(raw, 'i1');
const render = (raw: string, factor: Rational, system: UnitSystem = 'original') =>
  renderIngredient(item(raw), { factor, system });
const ONE = rational(1);

describe('renderIngredient: identity', () => {
  const lines = [
    '1 1/2 cups flour',
    '½ tsp salt',
    '2 (14 oz) cans tomatoes',
    'salt to taste',
    '1,5 kg Mehl',
    'Sal al gusto',
    '  3 eggs  ',
    '8 oz cheese',
  ];
  it.each(lines)('factor 1 + original returns raw: %j', (raw) => {
    const d = render(raw, ONE);
    expect(d.text).toBe(raw);
    expect(d.original).toBe(raw);
    expect(d.approximate).toBe(false);
  });

  it('does not mutate the item', () => {
    const it1 = item('1 cup milk');
    const snapshot = JSON.stringify(it1);
    renderIngredient(it1, { factor: rational(3), system: 'metric' });
    expect(JSON.stringify(it1)).toBe(snapshot);
  });

  it('derives from raw even if structured fields disagree', () => {
    const it1 = { ...item('1 cup milk'), quantity: { minNumerator: 99, minDenominator: 1 } };
    expect(renderIngredient(it1, { factor: rational(2), system: 'original' }).text).toBe('2 cups milk');
  });
});

describe('renderIngredient: scaling', () => {
  it('1 1/2 cups x 2/3 = 1 cup', () => {
    const d = render('1 1/2 cups flour', rational(2, 3));
    expect(d.text).toBe('1 cup flour');
    expect(d.approximate).toBe(false);
  });

  it('replaces only the leading quantity and keeps the rest of the line', () => {
    expect(render('1 onion, finely chopped (about 1 cup)', rational(2)).text).toBe('2 onion, finely chopped (about 1 cup)');
    expect(render('2 cups flour, plus more for the 9x13-inch pan', rational(2)).text).toBe(
      '4 cups flour, plus more for the 9x13-inch pan',
    );
    expect(render('1 tsp salt, bake at 350°F for 20 minutes', rational(3)).text).toBe(
      '3 tsp salt, bake at 350°F for 20 minutes',
    );
  });

  it('ranges: 1-2 x 2 = 2-4, keeping the separator', () => {
    expect(render('1-2 tbsp oil', rational(2)).text).toBe('2-4 tbsp oil');
    expect(render('1–2 tbsp oil', rational(2)).text).toBe('2–4 tbsp oil');
    expect(render('1 to 2 cloves garlic, minced', rational(2)).text).toBe('2 to 4 cloves garlic, minced');
  });

  it('Unicode fractions and mixed numbers', () => {
    expect(render('½ tsp salt', rational(2)).text).toBe('1 tsp salt');
    expect(render('1½ cups milk', rational(2)).text).toBe('3 cups milk');
    expect(render('⅓ cup oil', rational(3)).text).toBe('1 cup oil');
  });

  it('unit words follow grammatical number', () => {
    expect(render('1 cup milk', rational(2)).text).toBe('2 cups milk');
    expect(render('2 cups milk', rational(1, 2)).text).toBe('1 cup milk');
    expect(render('1 Tablespoon oil', rational(3)).text).toBe('3 Tablespoons oil');
    expect(render('1 tbsp oil', rational(3)).text).toBe('3 tbsp oil');
  });

  it('unitless counts and unknown units scale the number only', () => {
    expect(render('3 eggs', rational(1, 3)).text).toBe('1 eggs');
    expect(render('2 knobs ginger', rational(2)).text).toBe('4 knobs ginger');
  });

  it('decimal input stays decimal', () => {
    expect(render('0.5 cup milk', rational(3)).text).toBe('1.5 cups milk');
    expect(render('0.5 kg beef', rational(3)).text).toBe('1.5 kg beef');
  });

  it('metric units in original system use metric rounding', () => {
    const d = render('250 g butter', rational(1, 3));
    expect(d.text).toBe('83 g butter');
    expect(d.approximate).toBe(true);
    expect(render('250 g butter', rational(2)).text).toBe('500 g butter');
    expect(render('250 g butter', rational(3, 4)).text).toBe('190 g butter'); // 187.5 -> 5 g steps from 100
    expect(render('1 cup milk', rational(51, 50)).text).toBe('1 cup milk'); // displayed value decides plural
  });

  it('non-cooking fractions are rounded and flagged approximate', () => {
    const d = render('1 cup milk', rational(1, 5));
    expect(d.text).toBe('1/4 cup milk');
    expect(d.approximate).toBe(true);
  });

  it('never scales temperatures, times, pan sizes or package sizes', () => {
    for (const raw of ['350°F oven', '9x13-inch pan', '20 minutes', '180 °C']) {
      const d = render(raw, rational(2));
      expect(d.text).toBe(raw);
      expect(d.unchanged).toBe(true);
      expect(d.note).toBeTruthy();
    }
    expect(render('2 (14 oz) cans tomatoes', rational(2)).text).toBe('4 (14 oz) cans tomatoes');
    expect(render('2 (14 oz) cans tomatoes', rational(2), 'metric').text).toBe('4 (14 oz) cans tomatoes');
    expect(render('2 14-oz cans beans', rational(3)).text).toBe('6 14-oz cans beans');
  });

  it('"to taste" lines stay unchanged', () => {
    for (const raw of ['salt to taste', 'a pinch of nutmeg', '2 pinches salt']) {
      const d = render(raw, rational(3));
      expect(d.text).toBe(raw);
      expect(d.unchanged).toBe(true);
    }
  });

  it('decimal-comma and unparseable lines stay verbatim with a note', () => {
    const d = render('1,5 kg Mehl', rational(2));
    expect(d.text).toBe('1,5 kg Mehl');
    expect(d.unchanged).toBe(true);
    expect(d.note).toMatch(/comma/);
    const s = render('Sal al gusto', rational(2));
    expect(s.text).toBe('Sal al gusto');
    expect(s.unchanged).toBe(true);
  });

  it('100 sequential transforms then reset returns the exact original', () => {
    const it1 = item('1 1/3 cups sugar');
    let factor = ONE;
    for (let i = 0; i < 100; i++) {
      const k = rational((i % 9) + 1, (i % 4) + 2);
      factor = rational(k.n, k.d); // UI-style: each transform is a fresh factor
      renderIngredient(it1, { factor, system: i % 3 === 0 ? 'metric' : 'us' });
    }
    expect(renderIngredient(it1, { factor: ONE, system: 'original' }).text).toBe('1 1/3 cups sugar');
    // Scale by 3 is exact: 1 1/3 x 3 = 4.
    expect(renderIngredient(it1, { factor: rational(3), system: 'original' })).toMatchObject({
      text: '4 cups sugar',
      approximate: false,
    });
  });

  it('property: scaling by k then 1/k (composed factor) renders the original', () => {
    const raws = ['1 1/2 cups flour', '¾ tsp salt', '2-3 cloves garlic', '3 eggs'];
    for (let n = 1; n <= 12; n++) {
      for (let d = 1; d <= 12; d++) {
        const k = rational(n, d);
        const composed = rational(k.n * k.d, k.d * k.n); // k x 1/k
        for (const raw of raws) expect(render(raw, composed).text).toBe(raw);
      }
    }
  });

  it('rejects invalid factors', () => {
    expect(render('1 cup milk', rational(0)).unchanged).toBe(true);
    expect(render('1 cup milk', rational(-1)).text).toBe('1 cup milk');
  });
});

describe('renderIngredient: unit conversion', () => {
  it('US cup to metric uses 236.588 ml and is approximate', () => {
    const d = render('1 cup milk', ONE, 'metric');
    expect(d.text).toBe('235 ml milk');
    expect(d.approximate).toBe(true);
    expect(d.original).toBe('1 cup milk');
    expect(render('4 cups stock', ONE, 'metric').text).toBe('945 ml stock');
    expect(render('5 cups stock', ONE, 'metric').text).toBe('1.2 l stock');
  });

  it('tsp/tbsp to metric', () => {
    expect(render('1 tsp vanilla', ONE, 'metric').text).toBe('4.9 ml vanilla');
    expect(render('1 tbsp oil', ONE, 'metric').text).toBe('15 ml oil');
  });

  it('mass conversions both ways', () => {
    expect(render('1 lb ground beef', ONE, 'metric').text).toBe('455 g ground beef');
    expect(render('3 lb pork shoulder', ONE, 'metric').text).toBe('1.4 kg pork shoulder');
    expect(render('250 g butter', ONE, 'us').text).toBe('8 7/8 oz butter');
    expect(render('1 kg potatoes', ONE, 'us').text).toBe('2 1/4 lb potatoes');
  });

  it('metric volume to US', () => {
    expect(render('250 ml milk', ONE, 'us').text).toBe('1 cup milk');
    expect(render('500 ml milk', ONE, 'us').text).toBe('2 1/8 cups milk'); // 500 ml = 2.11 cups, 1/8 steps
    expect(render('5 ml vanilla', ONE, 'us').text).toBe('1 tsp vanilla');
    expect(render('15 ml oil', ONE, 'us').text).toBe('1 tbsp oil');
  });

  it('fl oz is volume and converts', () => {
    expect(render('4 fl oz cream', ONE, 'metric').text).toBe('120 ml cream');
  });

  it('ambiguous oz is never converted and needs review', () => {
    const d = render('8 oz cheese', ONE, 'metric');
    expect(d.text).toBe('8 oz cheese');
    expect(d.note).toMatch(/ambiguous oz/);
    const s = render('8 oz cheese', rational(2), 'metric');
    expect(s.text).toBe('16 oz cheese');
    expect(s.note).toMatch(/review/);
  });

  it('units already in the chosen system are not converted', () => {
    expect(render('1 cup milk', ONE, 'us').text).toBe('1 cup milk');
    expect(render('250 g sugar', ONE, 'metric').text).toBe('250 g sugar');
  });

  it('scaling plus conversion derives from the original', () => {
    expect(render('1 1/2 cups flour', rational(2), 'metric').text).toBe('710 ml flour');
    expect(render('1-2 cups milk', ONE, 'metric').text).toBe('235-475 ml milk');
  });

  it('count and unknown units are not converted', () => {
    expect(render('2 cloves garlic', ONE, 'metric').text).toBe('2 cloves garlic');
    expect(render('3 eggs', rational(2), 'us').text).toBe('6 eggs');
  });

  it('volume never converts to mass (no density table): cups stay a volume', () => {
    const d = render('2 cups flour', ONE, 'metric');
    expect(d.text).toMatch(/ml flour$/);
    expect(d.text).not.toMatch(/\bg\b/);
    expect(convertQuantity({ min: rational(1) }, 'cup', 'g')).toBeNull();
    expect(convertQuantity({ min: rational(100) }, 'g', 'ml')).toBeNull();
    expect(convertQuantity({ min: rational(1) }, 'oz-ambiguous', 'g')).toBeNull();
  });

  it('dimensional checks are exact within a dimension', () => {
    expect(convertQuantity({ min: rational(1) }, 'cup', 'tbsp')).toEqual({ min: rational(16) });
    expect(convertQuantity({ min: rational(1) }, 'tbsp', 'tsp')).toEqual({ min: rational(3) });
    expect(convertQuantity({ min: rational(1) }, 'gallon', 'cup')).toEqual({ min: rational(16) });
    expect(convertQuantity({ min: rational(1) }, 'cup', 'fl-oz')).toEqual({ min: rational(8) });
    expect(convertQuantity({ min: rational(1) }, 'lb', 'oz-weight')).toEqual({ min: rational(16) });
    expect(convertQuantity({ min: rational(1) }, 'kg', 'g')).toEqual({ min: rational(1000) });
    expect(convertQuantity({ min: rational(1) }, 'cup', 'ml')).toEqual({ min: rational(2365882365, 10000000) });
    expect(convertQuantity({ min: rational(1) }, 'lb', 'g')).toEqual({ min: rational(45359237, 100000) });
    const roundTrip = convertQuantity(convertQuantity({ min: rational(3, 4) }, 'cup', 'ml')!, 'ml', 'cup');
    expect(roundTrip).toEqual({ min: rational(3, 4) });
  });
});

describe('formatMetricNumber', () => {
  it('rounds sensibly', () => {
    expect(formatMetricNumber(rational(23658, 100)).text).toBe('235');
    expect(formatMetricNumber(rational(1478, 100)).text).toBe('15');
    expect(formatMetricNumber(rational(49, 10)).text).toBe('4.9');
    expect(formatMetricNumber(rational(1, 3)).text).toBe('0.33');
    expect(formatMetricNumber(rational(500))).toEqual({ text: '500', approximate: false });
  });
});

describe('scaleFactorForServings', () => {
  const recipe = (originalYield: RecipeV1['originalYield']): RecipeV1 =>
    ({ originalYield } as unknown as RecipeV1);

  it('uses originalYield.quantity min', () => {
    const r = recipe({ text: 'Serves 4-6', quantity: { minNumerator: 4, minDenominator: 1, maxNumerator: 6, maxDenominator: 1 } });
    expect(scaleFactorForServings(r, rational(8))).toEqual(rational(2));
    expect(scaleFactorForServings(r, rational(3))).toEqual(rational(3, 4));
  });

  it('falls back to parsing the yield text', () => {
    expect(scaleFactorForServings(recipe({ text: 'Makes 12 cookies' }), rational(6))).toEqual(rational(1, 2));
  });

  it('returns null without a numeric yield or with a bad target', () => {
    expect(scaleFactorForServings(recipe({ text: 'A crowd' }), rational(2))).toBeNull();
    expect(scaleFactorForServings(recipe({ text: '4 servings' }), rational(0))).toBeNull();
  });
});
