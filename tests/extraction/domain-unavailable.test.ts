// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

// Simulate the domain module being unimplemented: every parser throws.
vi.mock('../../src/domain/index', () => {
  const boom = (): never => {
    throw new Error('not implemented');
  };
  return { toIngredientItem: boom, parseYield: boom, normalizeSourceUrl: boom, toQuantityV1: boom };
});

import { extractFromDocument } from '../../src/extraction/index';
import { loadFixture } from './helpers';

describe('extraction without domain parsers', () => {
  it('falls back to raw low-confidence items and a fragment-free http(s) URL', () => {
    const out = extractFromDocument(loadFixture('jsonld-array.html'), 'https://user:pw@recipes.example/a?b=1#frag');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const r = out.candidates[0];
    expect(r?.source.url).toBe('https://recipes.example/a?b=1');
    expect(r?.ingredientGroups[0]?.items[0]).toEqual({ id: expect.any(String), raw: '1 ½ cups long-grain rice', confidence: 'low' });
    expect(r?.originalYield).toEqual({ text: '4 servings' });
  });

  it('rejects non-http(s) page URLs', () => {
    const out = extractFromDocument(loadFixture('jsonld-array.html'), 'javascript:alert(1)');
    expect(out.ok && out.candidates[0]?.source.url).toBe('');
  });
});

describe('ids without crypto.randomUUID (non-secure http page)', () => {
  it('still produces unique v4 UUIDs', () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true, writable: true });
    try {
      const out = extractFromDocument(loadFixture('jsonld-multiple.html'), 'http://recipes.example/');
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      const ids = out.candidates.flatMap((c) => [c.id, ...c.ingredientGroups.flatMap((g) => g.items.map((i) => i.id))]);
      for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(new Set(ids).size).toBe(ids.length);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true, writable: true });
    }
  });
});
