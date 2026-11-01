import { describe, expect, it } from 'vitest';
import { parseIngredientLine, parseServingsInput, parseYield, rational, toIngredientItem } from '../../src/domain';

const q = (n: number, d = 1) => rational(n, d);

describe('parseIngredientLine: quantities', () => {
  it.each([
    ['3 eggs', q(3)],
    ['0.5 kg beef', q(1, 2)],
    ['.25 cup milk', q(1, 4)],
    ['1 1/2 cups flour', q(3, 2)],
    ['1/2 cup sugar', q(1, 2)],
    ['1½ cups milk', q(3, 2)],
    ['1 ½ cups milk', q(3, 2)],
    ['½ tsp salt', q(1, 2)],
    ['⅓ cup oil', q(1, 3)],
    ['¼ cup oil', q(1, 4)],
    ['¾ cup oil', q(3, 4)],
    ['⅛ tsp cayenne', q(1, 8)],
    ['2⅔ cups water', q(8, 3)],
    ['1⁄2 cup cream', q(1, 2)],
    ['200g flour', q(200)],
  ])('%s', (line, min) => {
    const p = parseIngredientLine(line);
    expect(p.quantity?.min).toEqual(min);
    expect(p.quantity?.max).toBeUndefined();
  });

  it.each([
    ['1-2 tbsp oil', q(1), q(2)],
    ['1–2 tbsp oil', q(1), q(2)],
    ['1 - 2 tbsp oil', q(1), q(2)],
    ['1 to 2 cloves garlic', q(1), q(2)],
    ['½-1 tsp chili flakes', q(1, 2), q(1)],
    ['1 1/2 - 2 cups stock', q(3, 2), q(2)],
  ])('range %s', (line, min, max) => {
    const p = parseIngredientLine(line);
    expect(p.quantity).toEqual({ min, max });
  });

  it('treats "1-1/2" as a mixed number with medium confidence', () => {
    const p = parseIngredientLine('1-1/2 cups sugar');
    expect(p.quantity).toEqual({ min: q(3, 2) });
    expect(p.confidence).toBe('medium');
  });

  it('flags decimal-comma ambiguity instead of guessing', () => {
    for (const line of ['1,5 kg flour', '1,500 g flour']) {
      const p = parseIngredientLine(line);
      expect(p.quantity).toBeUndefined();
      expect(p.confidence).toBe('low');
    }
  });

  it('unitless counts', () => {
    const p = parseIngredientLine('3 eggs');
    expect(p.unit).toBeUndefined();
    expect(p.unitKnown).toBe(false);
    expect(p.ingredient).toBe('eggs');
    expect(p.confidence).toBe('high');
  });
});

describe('parseIngredientLine: units', () => {
  it.each([
    ['1 tsp salt', 'tsp'],
    ['1 teaspoon salt', 'tsp'],
    ['2 teaspoons salt', 'tsp'],
    ['1 t salt', 'tsp'],
    ['1 tbsp oil', 'tbsp'],
    ['1 Tbsp. oil', 'tbsp'],
    ['2 tablespoons oil', 'tbsp'],
    ['2 T sugar', 'tbsp'],
    ['1 tbs oil', 'tbsp'],
    ['1 cup milk', 'cup'],
    ['2 cups milk', 'cup'],
    ['2 c. milk', 'cup'],
    ['4 fl oz cream', 'fl-oz'],
    ['4 fl. oz. cream', 'fl-oz'],
    ['4 fluid ounces cream', 'fl-oz'],
    ['1 pint cream', 'pint'],
    ['1 qt stock', 'quart'],
    ['1 quart stock', 'quart'],
    ['1 gallon water', 'gallon'],
    ['250 ml milk', 'ml'],
    ['250 mL milk', 'ml'],
    ['250 millilitres milk', 'ml'],
    ['1 l water', 'l'],
    ['1 L water', 'l'],
    ['1 liter water', 'l'],
    ['2 dl cream', 'dl'],
    ['100 g sugar', 'g'],
    ['100 grams sugar', 'g'],
    ['1 kg potatoes', 'kg'],
    ['500 mg saffron', 'mg'],
    ['8 oz cheese', 'oz-ambiguous'],
    ['8 ounces cheese', 'oz-ambiguous'],
    ['8 oz. wt. chocolate', 'oz-weight'],
    ['1 lb beef', 'lb'],
    ['2 lbs beef', 'lb'],
    ['2 pounds beef', 'lb'],
    ['2 cloves garlic', 'clove'],
  ])('%s -> %s', (line, unit) => {
    const p = parseIngredientLine(line);
    expect(p.unit).toBe(unit);
    expect(p.unitKnown).toBe(true);
  });

  it('does not mistake ingredient words for units', () => {
    expect(parseIngredientLine('2 large eggs').unit).toBeUndefined();
    expect(parseIngredientLine('2 garlic bulbs').unit).toBeUndefined();
    expect(parseIngredientLine('3 tomatoes').unit).toBeUndefined();
    expect(parseIngredientLine('1 lemon').unit).toBeUndefined();
  });

  it('bare oz is ambiguous with medium confidence; fl oz is volume', () => {
    expect(parseIngredientLine('8 oz cheese').confidence).toBe('medium');
    expect(parseIngredientLine('4 fl oz cream').confidence).toBe('high');
  });
});

describe('parseIngredientLine: structure', () => {
  it('package sizes: count 2, invariant package 14 oz', () => {
    const p = parseIngredientLine('2 (14 oz) cans tomatoes');
    expect(p.quantity).toEqual({ min: q(2) });
    expect(p.packageSize).toEqual({ quantity: { min: q(14) }, unit: 'oz-ambiguous' });
    expect(p.unit).toBe('can');
    expect(p.ingredient).toBe('tomatoes');
  });

  it('package sizes without parentheses', () => {
    const p = parseIngredientLine('2 14-ounce cans beans');
    expect(p.quantity).toEqual({ min: q(2) });
    expect(p.packageSize).toEqual({ quantity: { min: q(14) }, unit: 'oz-ambiguous' });
    const g = parseIngredientLine('1 (400 g) tin chickpeas');
    expect(g.packageSize).toEqual({ quantity: { min: q(400) }, unit: 'g' });
  });

  it('to taste / pinch / as needed', () => {
    for (const line of ['salt to taste', 'Salt and pepper, to taste', 'a pinch of nutmeg', 'pinch of salt', 'oil as needed']) {
      const p = parseIngredientLine(line);
      expect(p.toTaste, line).toBe(true);
      expect(p.quantity).toBeUndefined();
    }
    expect(parseIngredientLine('salt to taste').ingredient).toBe('salt');
    expect(parseIngredientLine('2 pinches salt').toTaste).toBe(true);
    expect(parseIngredientLine('1 tsp salt, or to taste').toTaste).toBe(false);
  });

  it('preparation after the comma', () => {
    const p = parseIngredientLine('1 onion, finely chopped');
    expect(p.ingredient).toBe('onion');
    expect(p.preparation).toBe('finely chopped');
  });

  it('parenthetical notes are removed from the ingredient name only', () => {
    const p = parseIngredientLine('250 g butter (softened), cubed');
    expect(p.ingredient).toBe('butter');
    expect(p.preparation).toBe('cubed');
    const c = parseIngredientLine('1 cup (240 ml) water');
    expect(c.unit).toBe('cup');
    expect(c.ingredient).toBe('water');
  });

  it('"of" after the unit is skipped', () => {
    expect(parseIngredientLine('2 cups of flour').ingredient).toBe('flour');
  });

  it('temperatures, sizes and times are not quantities', () => {
    for (const line of ['350°F oven', '9x13-inch pan', '9-inch pie crust', '20 minutes resting', '180 °C']) {
      const p = parseIngredientLine(line);
      expect(p.quantity, line).toBeUndefined();
    }
  });

  it('non-English or unparseable lines are low confidence and keep text', () => {
    const p = parseIngredientLine('Sal al gusto');
    expect(p.quantity).toBeUndefined();
    expect(p.confidence).toBe('low');
    expect(parseIngredientLine('').confidence).toBe('low');
    expect(parseIngredientLine('漢字のテキスト').confidence).toBe('low');
  });

  it('bullet prefixes are skipped', () => {
    expect(parseIngredientLine('• 2 cups flour').quantity).toEqual({ min: q(2) });
    expect(parseIngredientLine('- 2 cups flour').quantity).toEqual({ min: q(2) });
  });
});

describe('toIngredientItem', () => {
  it('builds a persisted item', () => {
    expect(toIngredientItem('1 1/2 cups flour, sifted', 'a')).toEqual({
      id: 'a',
      raw: '1 1/2 cups flour, sifted',
      quantity: { minNumerator: 3, minDenominator: 2 },
      unit: 'cup',
      ingredient: 'flour',
      preparation: 'sifted',
      confidence: 'high',
    });
    expect(toIngredientItem('1-2 tbsp oil', 'b').quantity).toEqual({
      minNumerator: 1,
      minDenominator: 1,
      maxNumerator: 2,
      maxDenominator: 1,
    });
    const t = toIngredientItem('salt to taste', 'c');
    expect(t.quantity).toBeUndefined();
    expect(t.raw).toBe('salt to taste');
  });
});

describe('parseYield', () => {
  it.each([
    ['Makes 12 cookies', q(12), undefined, 'cookies'],
    ['4 servings', q(4), undefined, 'servings'],
    ['Serves 4-6', q(4), q(6), undefined],
    ['1 loaf', q(1), undefined, 'loaf'],
    ['12', q(12), undefined, undefined],
    ['Yield: 8 slices (about 1 cup each)', q(8), undefined, 'slices'],
    ['Serves 2 to 3 people', q(2), q(3), 'people'],
  ])('%s', (text, min, max, unit) => {
    const y = parseYield(text);
    expect(y.quantity?.min).toEqual(min);
    expect(y.quantity?.max).toEqual(max);
    expect(y.unit).toBe(unit);
  });

  it('returns no quantity when there is no number', () => {
    expect(parseYield('A crowd')).toEqual({});
    expect(parseYield('')).toEqual({});
  });
});

describe('parseServingsInput', () => {
  it.each([
    ['3', q(3)],
    ['1 1/2', q(3, 2)],
    ['0.5', q(1, 2)],
    ['½', q(1, 2)],
    ['1½', q(3, 2)],
    [' 6 ', q(6)],
    ['3/4', q(3, 4)],
    ['1,5', q(3, 2)],
  ])('%s', (text, value) => {
    expect(parseServingsInput(text)).toEqual(value);
  });

  it.each(['', '0', '-2', 'abc', '3 people', '1/0', '0.0', '100000'])('rejects %j', (text) => {
    expect(parseServingsInput(text)).toBeNull();
  });
});
