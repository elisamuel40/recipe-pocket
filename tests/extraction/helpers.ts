import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { RecipeV1 } from '../../src/shared/types';

const here = dirname(fileURLToPath(import.meta.url));

export function loadFixture(name: string): Document {
  const html = readFileSync(join(here, '..', 'fixtures', 'extraction', name), 'utf8');
  return parseHtml(html);
}

/** DOMParser documents are inert: scripts never run, resources never load. */
export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

export const ingredientLines = (r: RecipeV1): string[] => r.ingredientGroups.flatMap((g) => g.items.map((i) => i.raw));
export const steps = (r: RecipeV1): string[] => r.instructionGroups.flatMap((g) => g.steps.map((s) => s.text));
export const allText = (r: RecipeV1): string => JSON.stringify(r);
