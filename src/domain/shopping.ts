/**
 * Shopping-list building (PRD R09). Lines merge only when their normalized
 * ingredient + unit + preparation (+ package size) keys match and both
 * quantities are known in the same unit (or both are unitless counts).
 * Anything ambiguous stays a separate item. Every item keeps its sources.
 */
import type { IngredientItem, RecipeV1, ShoppingItem, ShoppingItemSource, UnitSystem } from '../shared/types';
import { analyzeLine } from './parse';
import { addRanges, scaleRange, toQuantityV1 } from './rational';
import { formatRange, renderIngredient, unitLabel } from './render';
import type { QuantityRange, Rational } from './types';
import { chooseUnit, convertQuantity, toBase, UNIT_BY_ID } from './units';

export const AISLES = ['Produce', 'Dairy & Eggs', 'Meat & Seafood', 'Bakery', 'Pantry', 'Spices', 'Frozen', 'Other'] as const;

/** Ordered keyword rules: first match wins, so specific phrases come before generic words. */
const AISLE_RULES: [RegExp, string][] = [
  [/\bfrozen\b|\bice cream\b/, 'Frozen'],
  [/\b(bell peppers?|green beans?|green onions?|spring onions?|scallions?|jalape[nñ]os?|chil(?:e|i)s? peppers?)\b/, 'Produce'],
  [/\b(garlic powder|onion powder|chil(?:e|i) powder|curry powder|red pepper flakes|black pepper|white pepper|peppercorns?|salt|pepper|paprika|cumin|cinnamon|nutmeg|turmeric|cayenne|allspice|cardamom|coriander seeds?|oregano|ground ginger|ground cloves|bay leaf|bay leaves|chili flakes|seasoning|spice|dried \w+)\b/, 'Spices'],
  [/\b(baking powder|baking soda|bicarbonate|broth|stock|bouillon|flour|sugar|oil|vinegar|rice|pasta|spaghetti|noodles?|lentils?|chickpeas?|beans?|oats?|honey|syrup|cornstarch|corn starch|yeast|cocoa|chocolate|vanilla|nuts?|almonds?|walnuts?|pecans?|peanuts?|cashews?|soy sauce|sauce|ketchup|mustard|mayonnaise|mayo|tomato paste|canned \w+|breadcrumbs?|bread crumbs|panko|coconut milk|raisins?|jam|tahini|cereal|crackers?)\b/, 'Pantry'],
  [/\b(milk|buttermilk|butter|cream|cheese|yogh?urt|eggs?|egg yolks?|egg whites?|parmesan|mozzarella|cheddar|ricotta|feta|cr[eè]me fra[iî]che|ghee)\b/, 'Dairy & Eggs'],
  [/\b(chicken|beef|pork|lamb|turkey|bacon|sausages?|ham|fish|salmon|tuna|shrimps?|prawns?|cod|steak|mince|anchov(?:y|ies)|crab|lobster|scallops?|mussels?|clams?|veal|duck|chorizo|prosciutto|pancetta)\b/, 'Meat & Seafood'],
  [/\b(bread|buns?|rolls?|tortillas?|baguettes?|pitas?|croissants?|bagels?|brioche|naan|pizza dough)\b/, 'Bakery'],
  [/\b(onions?|shallots?|garlic|tomato(?:es)?|potato(?:es)?|carrots?|celery|lettuce|spinach|lemons?|limes?|oranges?|apples?|bananas?|berr(?:y|ies)|strawberr(?:y|ies)|blueberr(?:y|ies)|basil|parsley|cilantro|coriander|mint|thyme|rosemary|sage|dill|chives|ginger|mushrooms?|cucumbers?|zucchini|courgettes?|avocados?|cabbage|kale|broccoli|cauliflower|eggplants?|aubergines?|peas|corn|squash|pumpkin|leeks?|radish(?:es)?|beets?|grapes?|pears?|peach(?:es)?|mangoes?|pineapple|herbs?|greens|arugula|rocket|fruit|vegetables?)\b/, 'Produce'],
];

/** Guess a default aisle name for an ingredient ("Produce", "Dairy & Eggs", ... or "Other"). */
export function defaultAisle(ingredient: string): string {
  const s = (typeof ingredient === 'string' ? ingredient : '').toLowerCase();
  for (const [re, aisle] of AISLE_RULES) if (re.test(s)) return aisle;
  return 'Other';
}

function singularize(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('oes')) return word.slice(0, -2);
  if (/(?:ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) return word.slice(0, -1);
  return word;
}

/** Normalized merge key text: lowercase, no parentheticals/punctuation, simple plurals singularized. */
export function normalizeKeyText(text: string | undefined): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(singularize)
    .join(' ');
}

interface Bucket {
  key: string;
  mergeable: boolean;
  quantity?: QuantityRange;
  /** Canonical unit id of `quantity` ("ml"/"g" when normalized to base), undefined for unitless counts. */
  unit?: string;
  baseDimension?: 'volume' | 'mass';
  ingredient?: string;
  preparation?: string;
  packageText?: string;
  aisleHint: string;
  first: { item: IngredientItem; factor: Rational };
  sources: ShoppingItemSource[];
}

/**
 * Build shopping items from recipes (each with its own factor). Merge only
 * identical normalized ingredient+unit+preparation keys with compatible
 * quantities; ambiguous items stay separate. Retains source association.
 */
export function buildShoppingItems(
  entries: { recipe: RecipeV1; factor: Rational; itemIds?: string[] }[],
  system: UnitSystem,
): ShoppingItem[] {
  const buckets = new Map<string, Bucket>();
  let unique = 0;

  for (const entry of entries ?? []) {
    const recipe = entry.recipe;
    const factor = entry.factor;
    const wanted = entry.itemIds ? new Set(entry.itemIds) : null;
    for (const group of recipe.ingredientGroups ?? []) {
      for (const item of group.items ?? []) {
        if (wanted && !wanted.has(item.id)) continue;
        if (typeof item.raw !== 'string' || !item.raw.trim()) continue;
        const source: ShoppingItemSource = { recipeId: recipe.id, recipeTitle: recipe.title, raw: item.raw };
        const a = analyzeLine(item.raw);
        const p = a.parsed;
        const unitId = p.unit;
        const mergeable =
          !a.reason &&
          p.quantity !== undefined &&
          p.ingredient !== undefined &&
          p.confidence !== 'low' &&
          unitId !== 'oz-ambiguous' &&
          factor.n > 0;

        let quantity: QuantityRange | undefined = p.quantity && factor.n > 0 ? scaleRange(p.quantity, factor) : undefined;
        let unit = unitId;
        let baseDimension: Bucket['baseDimension'];
        const def = unitId ? UNIT_BY_ID.get(unitId) : undefined;
        if (quantity && unitId && system !== 'original' && def?.toBase && (def.dimension === 'volume' || def.dimension === 'mass')) {
          quantity = toBase(quantity, unitId)!;
          baseDimension = def.dimension;
          unit = def.dimension === 'volume' ? 'ml' : 'g';
        }
        const pkg = p.packageSize;
        const packageText = pkg ? `${formatRange(pkg.quantity, 'fraction').text} ${unitLabel(pkg.unit, false)}` : undefined;
        const key = mergeable
          ? [normalizeKeyText(p.ingredient), unit ?? '', normalizeKeyText(p.preparation), packageText ?? ''].join('|')
          : `#${unique++}`;

        const existing = buckets.get(key);
        if (existing && existing.quantity && quantity) {
          existing.quantity = addRanges(existing.quantity, quantity);
          existing.sources.push(source);
          continue;
        }
        const containerHint = def?.dimension === 'count' && /^(can|jar|box|carton|bottle)$/.test(def.id) ? 'canned ' : '';
        const bucket: Bucket = {
          key,
          mergeable,
          aisleHint: `${containerHint}${p.ingredient ?? item.raw}`,
          first: { item, factor },
          sources: [source],
        };
        if (quantity) bucket.quantity = quantity;
        if (unit) bucket.unit = unit;
        if (baseDimension) bucket.baseDimension = baseDimension;
        if (p.ingredient) bucket.ingredient = p.ingredient;
        if (p.preparation) bucket.preparation = p.preparation;
        if (packageText) bucket.packageText = packageText;
        buckets.set(key, bucket);
      }
    }
  }

  const items: ShoppingItem[] = [];
  for (const b of buckets.values()) {
    let quantity = b.quantity;
    let unit = b.unit;
    if (quantity && b.baseDimension && system !== 'original') {
      unit = chooseUnit(quantity, b.baseDimension, system);
      quantity = convertQuantity(quantity, b.baseDimension === 'volume' ? 'ml' : 'g', unit)!;
    }
    let text: string;
    if (b.sources.length === 1 || !quantity) {
      text = renderIngredient(b.first.item, { factor: b.first.factor, system }).text;
    } else {
      const metric = unit !== undefined && UNIT_BY_ID.get(unit)?.system === 'metric';
      const q = formatRange(quantity, metric ? 'metric' : 'fraction');
      const plural = (quantity.max ?? quantity.min).n > (quantity.max ?? quantity.min).d;
      const parts = [q.text];
      if (b.packageText) parts.push(`(${b.packageText})`);
      if (unit) parts.push(unitLabel(unit, plural));
      if (b.ingredient) parts.push(b.ingredient);
      text = parts.join(' ') + (b.preparation ? `, ${b.preparation}` : '');
    }
    const out: ShoppingItem = {
      id: crypto.randomUUID(),
      text,
      aisle: defaultAisle(b.aisleHint),
      checked: false,
      manual: false,
      sources: b.sources,
    };
    if (quantity) out.quantity = toQuantityV1(quantity);
    if (unit) out.unit = unit;
    if (b.ingredient) out.ingredient = b.ingredient;
    if (b.preparation) out.preparation = b.preparation;
    items.push(out);
  }
  return items;
}
