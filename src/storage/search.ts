/**
 * In-memory library search: case- and diacritic-insensitive substring match
 * over title, tags and ingredient raw text. Folded text is cached per recipe
 * id + revision, so repeated searches only fold changed recipes.
 */
import type { RecipeV1 } from '../shared/types';
import { searchCache } from './state';

const MARKS = /\p{M}+/gu;

/** Lowercase and strip diacritics ("Crème Brûlée" -> "creme brulee"). */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(MARKS, '').toLowerCase();
}

function searchText(r: RecipeV1): string {
  const hit = searchCache.get(r.id);
  if (hit && hit.revision === r.revision) return hit.text;
  const parts: string[] = [r.title, ...r.tags];
  for (const g of r.ingredientGroups) for (const item of g.items) parts.push(item.raw);
  const text = foldText(parts.join('\n'));
  searchCache.set(r.id, { revision: r.revision, text });
  return text;
}

export interface SearchFilter {
  query?: string;
  collectionId?: string;
  tag?: string;
}

export function filterRecipes(recipes: RecipeV1[], opts: SearchFilter): RecipeV1[] {
  const terms = foldText(opts.query ?? '').split(/\s+/).filter(Boolean);
  const tag = opts.tag ? foldText(opts.tag) : undefined;
  return recipes.filter((r) => {
    if (opts.collectionId && !r.collectionIds.includes(opts.collectionId)) return false;
    if (tag !== undefined && !r.tags.some((t) => foldText(t) === tag)) return false;
    if (terms.length === 0) return true;
    const text = searchText(r);
    return terms.every((t) => text.includes(t));
  });
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

export function sortByTitle<T extends { title?: string; name?: string; id: string }>(items: T[]): T[] {
  return items.sort((a, b) => collator.compare(a.title ?? a.name ?? '', b.title ?? b.name ?? '') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
