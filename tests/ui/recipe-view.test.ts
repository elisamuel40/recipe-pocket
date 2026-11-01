// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { RecipeV1 } from '../../src/shared/types';
import { rational, toIngredientItem } from '../../src/domain/index';
import { renderRecipeView, renderScaleControls } from '../../src/ui/components/recipe-view';

function recipe(over: Partial<RecipeV1> = {}): RecipeV1 {
  return {
    schemaVersion: 1,
    id: 'r1',
    title: 'Lemon Cake',
    source: { url: 'https://www.example.com/cake?x=1', author: 'Ana Cook', publisher: 'Example Kitchen' },
    originalYield: { text: '4 servings', quantity: { minNumerator: 4, minDenominator: 1 } },
    times: { prep: 'PT15M', cook: 'PT1H5M', raw: '' },
    ingredientGroups: [
      { id: 'g1', title: 'Cake', items: [toIngredientItem('1 1/2 cups flour', 'i1'), toIngredientItem('salt to taste', 'i2')] },
      { id: 'g2', title: 'Glaze', items: [toIngredientItem('2 tbsp lemon juice', 'i3')] },
    ],
    instructionGroups: [
      { id: 's1', title: '', steps: [{ id: 'st1', text: 'Mix.' }, { id: 'st2', text: 'Bake at 350°F for 30 minutes.' }] },
    ],
    notes: 'Keeps 3 days.\n\nFreezes well.',
    tags: [],
    collectionIds: [],
    extraction: { method: 'json-ld', missingFields: [], warnings: [] },
    revision: 0,
    ...over,
  };
}

const ONE = { n: 1, d: 1 };

describe('renderRecipeView', () => {
  it('renders hostile page text as text, never markup', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const r = recipe({
      title: payload,
      notes: payload,
      source: { url: 'https://example.com/', author: payload },
      ingredientGroups: [{ id: 'g', title: payload, items: [{ id: 'i', raw: payload, confidence: 'low' }] }],
      instructionGroups: [{ id: 's', title: payload, steps: [{ id: 'st', text: '<script>alert(1)</script>' }] }],
    });
    const el = renderRecipeView(r, { factor: ONE, system: 'original' });
    document.body.appendChild(el);
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('h2')!.textContent).toBe(payload);
    expect(el.textContent).toContain('<script>alert(1)</script>');
  });

  it('renders title, attribution link, metadata, groups in order and notes', () => {
    const el = renderRecipeView(recipe(), { factor: ONE, system: 'original' });
    const link = el.querySelector('a.source-link') as HTMLAnchorElement;
    expect(link.getAttribute('rel')).toBe('noreferrer noopener');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.textContent).toBe('example.com');
    expect(el.querySelector('.attribution')!.textContent).toContain('By Ana Cook');
    expect(el.querySelector('.attribution')!.textContent).toContain('Example Kitchen');
    expect(el.querySelector('.recipe-meta')!.textContent).toContain('15 min');
    expect(el.querySelector('.recipe-meta')!.textContent).toContain('1 hr 5 min');
    expect([...el.querySelectorAll('.group-title')].map((g) => g.textContent)).toEqual(['Cake', 'Glaze']);
    expect([...el.querySelectorAll('.ingredient .ing-text')].map((n) => n.textContent)).toEqual([
      '1 1/2 cups flour',
      'salt to taste',
      '2 tbsp lemon juice',
    ]);
    expect(el.querySelectorAll('ol.step-list > li')).toHaveLength(2);
    expect(el.querySelectorAll('.note-text')).toHaveLength(2);
    expect(el.querySelectorAll('img')).toHaveLength(0);
  });

  it('shows note subheadings and run-in labels in bold, one block per line', () => {
    const notes = 'Chop the chocolate by hand.\n\nSizes and uses:\n\nSmall: <b>Great</b> for parties.\nThis size is the best of both worlds: more surface.';
    const el = renderRecipeView(recipe({ notes }), { factor: ONE, system: 'original' });
    const ps = [...el.querySelectorAll('.notes .note-text')];
    expect(ps.map((p) => p.textContent)).toEqual([
      'Chop the chocolate by hand.',
      'Sizes and uses:',
      'Small: <b>Great</b> for parties.',
      'This size is the best of both worlds: more surface.',
    ]);
    expect(ps[1]!.classList.contains('note-heading')).toBe(true);
    expect(ps[2]!.querySelector('strong')!.textContent).toBe('Small:');
    // Note text is never parsed as markup; long sentences with a colon get no label.
    expect(el.querySelector('.notes b')).toBeNull();
    expect(ps[3]!.querySelector('strong')).toBeNull();
    expect(ps[0]!.querySelector('strong')).toBeNull();
  });

  it('omits notes when includeNotes is false', () => {
    const el = renderRecipeView(recipe(), { factor: ONE, system: 'original', includeNotes: false });
    expect(el.querySelector('.notes')).toBeNull();
  });

  it('never links non-http sources', () => {
    const el = renderRecipeView(recipe({ source: { url: 'javascript:alert(1)' } }), { factor: ONE, system: 'original' });
    expect(el.querySelector('a')).toBeNull();
  });

  it('scales from the original and keeps unscalable lines readable', () => {
    const el = renderRecipeView(recipe(), { factor: rational(2), system: 'original', showOriginal: true });
    const lines = [...el.querySelectorAll('.ingredient')];
    expect(lines[0]!.querySelector('.ing-text')!.textContent).toBe('3 cups flour');
    expect(lines[0]!.querySelector('.ing-original')!.textContent).toBe('Original: 1 1/2 cups flour');
    expect(lines[1]!.querySelector('.ing-text')!.textContent).toBe('salt to taste');
    // Steps (times/temperatures) are never scaled.
    expect(el.textContent).toContain('Bake at 350°F for 30 minutes.');
    expect(el.querySelector('.recipe-meta')!.textContent).toContain('original: 4 servings');
  });

  it('marks approximate conversions visibly and for screen readers', () => {
    const el = renderRecipeView(recipe(), { factor: ONE, system: 'metric' });
    const first = el.querySelector('.ingredient')!;
    expect(first.classList.contains('is-approx')).toBe(true);
    expect(first.querySelector('.approx')!.getAttribute('aria-hidden')).toBe('true');
    expect(first.querySelector('.approx')!.textContent).toContain('≈');
    expect(first.querySelector('.visually-hidden')!.textContent).toContain('approximately');
  });

  it('shows missing sections instead of fabricating them', () => {
    const r = recipe({ ingredientGroups: [], extraction: { method: 'dom', missingFields: ['ingredients'], warnings: [] } });
    const el = renderRecipeView(r, { factor: ONE, system: 'original' });
    expect(el.querySelector('[data-missing="ingredients"]')).not.toBeNull();
  });

  it('renders checkboxes and reports checks', () => {
    const onCheck = vi.fn();
    const el = renderRecipeView(recipe(), { factor: ONE, system: 'original', showChecks: true, checked: new Set(['i2']), onCheck });
    document.body.appendChild(el);
    const boxes = el.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    expect(boxes).toHaveLength(3);
    expect(boxes[1]!.checked).toBe(true);
    boxes[0]!.click();
    expect(onCheck).toHaveBeenCalledWith('i1', true);
    // Each checkbox has an accessible label.
    expect(el.querySelector(`label[for="${boxes[0]!.id}"]`)!.textContent).toContain('flour');
  });

  it('uses the requested heading level', () => {
    const el = renderRecipeView(recipe(), { factor: ONE, system: 'original', headingLevel: 1 });
    expect(el.querySelector('h1')!.textContent).toBe('Lemon Cake');
    expect(el.querySelectorAll('h2')).toHaveLength(3); // Ingredients, Steps, Notes
  });
});

describe('renderScaleControls', () => {
  it('accepts mixed-number servings and computes the factor', () => {
    const onChange = vi.fn();
    const el = renderScaleControls(recipe(), { factor: ONE, system: 'original', onChange });
    document.body.appendChild(el);
    const input = el.querySelector<HTMLInputElement>('.servings-input')!;
    expect(input.value).toBe('4');
    expect(el.querySelector(`label[for="${input.id}"]`)!.textContent).toBe('Servings');
    input.value = '6';
    input.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenLastCalledWith({ factor: { n: 3, d: 2 }, system: 'original' });
    input.value = '1 1/2';
    input.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenLastCalledWith({ factor: { n: 3, d: 8 }, system: 'original' });
  });

  it('flags invalid servings without changing the factor', () => {
    const onChange = vi.fn();
    const el = renderScaleControls(recipe(), { factor: ONE, system: 'original', onChange });
    const input = el.querySelector<HTMLInputElement>('.servings-input')!;
    input.value = 'lots';
    input.dispatchEvent(new Event('change'));
    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect((el.querySelector('.field-error') as HTMLElement).hidden).toBe(false);
  });

  it('plus, minus and reset', () => {
    const onChange = vi.fn();
    const el = renderScaleControls(recipe(), { factor: ONE, system: 'original', onChange });
    const [minus, plus, reset] = [...el.querySelectorAll<HTMLButtonElement>('.stepper button')];
    plus!.click();
    expect(onChange).toHaveBeenLastCalledWith({ factor: { n: 5, d: 4 }, system: 'original' });
    minus!.click();
    minus!.click();
    expect(onChange).toHaveBeenLastCalledWith({ factor: { n: 3, d: 4 }, system: 'original' });
    reset!.click();
    expect(onChange).toHaveBeenLastCalledWith({ factor: { n: 1, d: 1 }, system: 'original' });
    expect(el.querySelector<HTMLInputElement>('.servings-input')!.value).toBe('4');
  });

  it('offers multipliers when the yield is not numeric', () => {
    const onChange = vi.fn();
    const r = recipe({ originalYield: { text: 'One loaf' } });
    const el = renderScaleControls(r, { factor: ONE, system: 'original', onChange });
    expect(el.querySelector('.servings-input')).toBeNull();
    const chips = [...el.querySelectorAll<HTMLButtonElement>('.chip')];
    expect(chips.map((c) => c.textContent)).toEqual(['×½', '×1', '×2', '×3']);
    expect(chips[1]!.getAttribute('aria-pressed')).toBe('true');
    chips[0]!.click();
    expect(onChange).toHaveBeenLastCalledWith({ factor: { n: 1, d: 2 }, system: 'original' });
    expect(chips[0]!.getAttribute('aria-pressed')).toBe('true');
    const custom = el.querySelector<HTMLInputElement>('.chip-row input')!;
    custom.value = '1 1/2';
    custom.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenLastCalledWith({ factor: { n: 3, d: 2 }, system: 'original' });
  });

  it('switches unit systems explicitly', () => {
    const onChange = vi.fn();
    const el = renderScaleControls(recipe(), { factor: ONE, system: 'original', onChange });
    const select = el.querySelector('select')!;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Original units', 'US customary', 'Metric']);
    select.value = 'metric';
    select.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenLastCalledWith({ factor: ONE, system: 'metric' });
  });
});
