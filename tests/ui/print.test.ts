// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { RecipeV1 } from '../../src/shared/types';
import { toIngredientItem } from '../../src/domain/index';
import { draftPrintPath, parsePrintParams, savedRecipePrintPath } from '../../src/ui/common/print-params';
import { renderPrintPage } from '../../src/ui/components/print-view';

const recipe = (): RecipeV1 => ({
  schemaVersion: 1,
  id: 'r',
  title: 'Bread <b>bold</b>',
  source: { url: 'https://bakery.example/bread', author: 'Sam Baker' },
  originalYield: { text: '2 loaves', quantity: { minNumerator: 2, minDenominator: 1 } },
  times: { raw: '' },
  ingredientGroups: [{ id: 'g', title: 'Dough', items: [toIngredientItem('2 cups water', 'i')] }],
  instructionGroups: [{ id: 's', title: 'Bake', steps: [{ id: 'a', text: 'Knead.' }, { id: 'b', text: 'Bake at 220°C.' }] }],
  notes: 'Use a hot oven.',
  tags: [],
  collectionIds: [],
  extraction: { method: 'json-ld', missingFields: [], warnings: [] },
  revision: 1,
});

describe('print params', () => {
  it('parses draft and saved forms', () => {
    expect(parsePrintParams('?id=abc-123')).toEqual({ kind: 'draft', printId: 'abc-123' });
    expect(parsePrintParams('?recipe=r1&n=3&d=2&units=metric&notes=0')).toEqual({
      kind: 'saved',
      recipeId: 'r1',
      options: { factor: { n: 3, d: 2 }, system: 'metric', includeNotes: false },
    });
    expect(parsePrintParams('?recipe=r1')).toEqual({
      kind: 'saved',
      recipeId: 'r1',
      options: { factor: { n: 1, d: 1 }, system: 'original', includeNotes: true },
    });
  });

  it('rejects or neutralizes bad input', () => {
    expect(parsePrintParams('')).toBeNull();
    expect(parsePrintParams('?id=<script>')).toBeNull();
    expect(parsePrintParams('?recipe=../x')).toBeNull();
    const p = parsePrintParams('?recipe=r&n=-1&d=0&units=imperial');
    expect(p && p.kind === 'saved' && p.options).toEqual({ factor: { n: 1, d: 1 }, system: 'original', includeNotes: true });
  });

  it('round-trips saved print paths', () => {
    const path = savedRecipePrintPath('r1', { factor: { n: 1, d: 2 }, system: 'us', includeNotes: true });
    expect(path).toBe('ui/print.html?recipe=r1&n=1&d=2&units=us&notes=1');
    expect(parsePrintParams(path.slice(path.indexOf('?')))).toMatchObject({ kind: 'saved', options: { factor: { n: 1, d: 2 } } });
    expect(draftPrintPath('p1')).toBe('ui/print.html?id=p1');
  });
});

describe('print page', () => {
  it('renders attribution, groups, scaled servings, units and notes; escapes text', () => {
    const root = document.createElement('div');
    renderPrintPage(root, recipe(), { factor: { n: 2, d: 1 }, system: 'original', includeNotes: true });
    expect(root.querySelector('b')).toBeNull();
    expect(root.querySelector('h1')!.textContent).toBe('Bread <b>bold</b>');
    expect(root.querySelector('.print-summary')!.textContent).toBe('Servings: 4 (original 2) · Units: Original units');
    expect(root.querySelector('.ingredient .ing-text')!.textContent).toBe('4 cups water');
    expect([...root.querySelectorAll('.group-title')].map((n) => n.textContent)).toEqual(['Dough', 'Bake']);
    expect(root.querySelectorAll('.step')).toHaveLength(2);
    expect(root.querySelector('.print-attribution')!.textContent).toContain('https://bakery.example/bread');
    expect(root.querySelector('.print-attribution')!.textContent).toContain('Author: Sam Baker');
    expect(root.querySelector('.notes')).not.toBeNull();
    expect(document.title).toBe('Bread <b>bold</b> – Recipe Pocket');
  });

  it('toggles notes and calls print', () => {
    const root = document.createElement('div');
    const print = vi.fn();
    renderPrintPage(root, recipe(), { factor: { n: 1, d: 1 }, system: 'metric', includeNotes: true }, print);
    const box = root.querySelector<HTMLInputElement>('#print-include-notes')!;
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(root.querySelector('.notes')).toBeNull();
    const btn = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Print / Save as PDF')!;
    btn.click();
    expect(print).toHaveBeenCalledOnce();
    expect(root.querySelector('.print-controls')!.classList.contains('no-print')).toBe(true);
    expect(root.querySelector('.print-summary')!.textContent).toContain('Units: Metric');
  });
});
