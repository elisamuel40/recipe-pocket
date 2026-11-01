import { describe, expect, it } from 'vitest';
import { buildShoppingItems, defaultAisle, normalizeKeyText, rational, toIngredientItem } from '../../src/domain';
import type { RecipeV1 } from '../../src/shared/types';

let seq = 0;
function recipe(id: string, title: string, lines: string[]): RecipeV1 {
  return {
    schemaVersion: 1,
    id,
    title,
    source: { url: '' },
    originalYield: { text: '4 servings' },
    times: { raw: '' },
    ingredientGroups: [{ id: `${id}-g`, title: '', items: lines.map((l) => toIngredientItem(l, `${id}-${seq++}`)) }],
    instructionGroups: [],
    notes: '',
    tags: [],
    collectionIds: [],
    extraction: { method: 'manual', missingFields: [], warnings: [] },
    revision: 1,
  };
}

const ONE = rational(1);

describe('buildShoppingItems', () => {
  it('merges identical normalized keys and keeps every source', () => {
    const a = recipe('a', 'Pancakes', ['1 cup flour', '2 eggs']);
    const b = recipe('b', 'Bread', ['2 cups Flour', '1 egg']);
    const items = buildShoppingItems([{ recipe: a, factor: ONE }, { recipe: b, factor: ONE }], 'original');
    expect(items).toHaveLength(2);
    const flour = items.find((i) => i.ingredient?.toLowerCase() === 'flour')!;
    expect(flour.quantity).toEqual({ minNumerator: 3, minDenominator: 1 });
    expect(flour.unit).toBe('cup');
    expect(flour.text).toBe('3 cups flour');
    expect(flour.sources).toEqual([
      { recipeId: 'a', recipeTitle: 'Pancakes', raw: '1 cup flour' },
      { recipeId: 'b', recipeTitle: 'Bread', raw: '2 cups Flour' },
    ]);
    const eggs = items.find((i) => i.ingredient?.startsWith('egg'))!;
    expect(eggs.quantity).toEqual({ minNumerator: 3, minDenominator: 1 });
    expect(eggs.unit).toBeUndefined();
    expect(eggs.aisle).toBe('Dairy & Eggs');
    expect(flour.aisle).toBe('Pantry');
    for (const i of items) {
      expect(i.checked).toBe(false);
      expect(i.manual).toBe(false);
      expect(i.id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('applies each entry factor before merging', () => {
    const a = recipe('a', 'A', ['1 1/2 cups milk']);
    const b = recipe('b', 'B', ['1/2 cup milk']);
    const items = buildShoppingItems([{ recipe: a, factor: rational(2, 3) }, { recipe: b, factor: rational(2) }], 'original');
    expect(items).toHaveLength(1);
    expect(items[0]!.quantity).toEqual({ minNumerator: 2, minDenominator: 1 });
  });

  it('merges ranges by adding min and max', () => {
    const a = recipe('a', 'A', ['1-2 tbsp oil']);
    const b = recipe('b', 'B', ['1 tbsp oil']);
    const items = buildShoppingItems([{ recipe: a, factor: ONE }, { recipe: b, factor: ONE }], 'original');
    expect(items).toHaveLength(1);
    expect(items[0]!.quantity).toEqual({ minNumerator: 2, minDenominator: 1, maxNumerator: 3, maxDenominator: 1 });
    expect(items[0]!.text).toBe('2–3 tbsp oil');
  });

  it('keeps different units, preparations and ambiguous items separate', () => {
    const a = recipe('a', 'A', ['1 cup flour', '1 onion, chopped', '8 oz cheese', 'salt to taste', '1,5 kg Mehl']);
    const b = recipe('b', 'B', ['100 g flour', '1 onion, sliced', '8 oz cheese', 'salt to taste', '1,5 kg Mehl']);
    const items = buildShoppingItems([{ recipe: a, factor: ONE }, { recipe: b, factor: ONE }], 'original');
    expect(items).toHaveLength(10);
    for (const i of items) expect(i.sources).toHaveLength(1);
  });

  it('a unitless count does not merge with a measured quantity', () => {
    const a = recipe('a', 'A', ['2 onions']);
    const b = recipe('b', 'B', ['1 cup onion']);
    expect(buildShoppingItems([{ recipe: a, factor: ONE }, { recipe: b, factor: ONE }], 'original')).toHaveLength(2);
  });

  it('singularizes simple plurals for the key', () => {
    const a = recipe('a', 'A', ['2 tomatoes']);
    const b = recipe('b', 'B', ['1 tomato']);
    const items = buildShoppingItems([{ recipe: a, factor: ONE }, { recipe: b, factor: ONE }], 'original');
    expect(items).toHaveLength(1);
    expect(items[0]!.quantity).toEqual({ minNumerator: 3, minDenominator: 1 });
    expect(items[0]!.aisle).toBe('Produce');
  });

  it('package sizes are part of the key and never scaled', () => {
    const a = recipe('a', 'A', ['2 (14 oz) cans tomatoes', '1 (28 oz) can tomatoes']);
    const b = recipe('b', 'B', ['1 (14 oz) can tomatoes']);
    const items = buildShoppingItems([{ recipe: a, factor: rational(2) }, { recipe: b, factor: ONE }], 'original');
    expect(items).toHaveLength(2);
    const small = items.find((i) => i.sources.length === 2)!;
    expect(small.quantity).toEqual({ minNumerator: 5, minDenominator: 1 });
    expect(small.text).toBe('5 (14 oz) cans tomatoes');
    expect(small.aisle).toBe('Pantry');
  });

  it('honours itemIds subsets', () => {
    const a = recipe('a', 'A', ['1 cup flour', '2 eggs', '1 tsp salt']);
    const ids = [a.ingredientGroups[0]!.items[1]!.id];
    const items = buildShoppingItems([{ recipe: a, factor: ONE, itemIds: ids }], 'original');
    expect(items).toHaveLength(1);
    expect(items[0]!.sources[0]!.raw).toBe('2 eggs');
  });

  it('metric system merges volumes in different units via exact base conversion', () => {
    const a = recipe('a', 'A', ['1 cup milk']);
    const b = recipe('b', 'B', ['250 ml milk']);
    const items = buildShoppingItems([{ recipe: a, factor: ONE }, { recipe: b, factor: ONE }], 'metric');
    expect(items).toHaveLength(1);
    expect(items[0]!.unit).toBe('ml');
    expect(items[0]!.text).toBe('485 ml milk');
    // Volume and mass never merge.
    const c = recipe('c', 'C', ['100 g milk']);
    expect(buildShoppingItems([{ recipe: a, factor: ONE }, { recipe: c, factor: ONE }], 'metric')).toHaveLength(2);
  });

  it('single-source items show the rendered line', () => {
    const a = recipe('a', 'A', ['1 1/2 cups flour, sifted']);
    const items = buildShoppingItems([{ recipe: a, factor: rational(2) }], 'original');
    expect(items[0]!.text).toBe('3 cups flour, sifted');
    expect(items[0]!.preparation).toBe('sifted');
  });
});

describe('normalizeKeyText', () => {
  it('normalizes case, spacing, parentheses and plurals', () => {
    expect(normalizeKeyText('  Tomatoes ')).toBe('tomato');
    expect(normalizeKeyText('Berries (fresh)')).toBe('berry');
    expect(normalizeKeyText('peaches')).toBe('peach');
    expect(normalizeKeyText('Eggs')).toBe('egg');
    expect(normalizeKeyText('glass')).toBe('glass');
  });
});

describe('defaultAisle', () => {
  it.each([
    ['onion', 'Produce'],
    ['bell pepper', 'Produce'],
    ['fresh basil', 'Produce'],
    ['whole milk', 'Dairy & Eggs'],
    ['unsalted butter', 'Dairy & Eggs'],
    ['eggs', 'Dairy & Eggs'],
    ['chicken thighs', 'Meat & Seafood'],
    ['salmon fillets', 'Meat & Seafood'],
    ['sourdough bread', 'Bakery'],
    ['all-purpose flour', 'Pantry'],
    ['chicken broth', 'Pantry'],
    ['peanut butter', 'Pantry'],
    ['coconut milk', 'Pantry'],
    ['kosher salt', 'Spices'],
    ['black pepper', 'Spices'],
    ['garlic powder', 'Spices'],
    ['frozen peas', 'Frozen'],
    ['xanthan gum', 'Other'],
    ['', 'Other'],
  ])('%s -> %s', (ingredient, aisle) => {
    expect(defaultAisle(ingredient)).toBe(aisle);
  });
});
