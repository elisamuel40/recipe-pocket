// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecipeV1 } from '../../src/shared/types';
import { emptyRecipe, mountEditor, parseTags } from '../../src/ui/components/editor';
import { countAll, getImage, putImage, saveCollection } from '../../src/storage';
import { PNG, makeRecipe, resetDb, usePassthroughReencoder } from '../storage/helpers';

let container: HTMLElement;
let unmount: (() => void) | null = null;

beforeEach(async () => {
  await resetDb();
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  unmount?.();
  unmount = null;
});

const byLabel = (text: string): HTMLInputElement | HTMLTextAreaElement => {
  const label = Array.from(container.querySelectorAll('label')).find((l) => l.textContent?.trim().startsWith(text));
  if (!label) throw new Error(`label not found: ${text}`);
  const el = document.getElementById(label.htmlFor);
  if (!el) throw new Error(`control not found for ${text}`);
  return el as HTMLInputElement;
};
const button = (name: string, root: ParentNode = container): HTMLButtonElement => {
  const b = Array.from(root.querySelectorAll('button')).find(
    (x) => x.getAttribute('aria-label') === name || x.textContent?.trim() === name,
  );
  if (!b) throw new Error(`button not found: ${name}`);
  return b;
};
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string): void => {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const submit = (): void => {
  container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
};

function mount(recipe: RecipeV1, onSave = vi.fn(), onCancel = vi.fn()) {
  unmount = mountEditor(container, recipe, { onSave, onCancel });
  return { onSave, onCancel };
}

describe('mountEditor', () => {
  it('produces a RecipeV1 with groups, order and raw lines', async () => {
    const original = makeRecipe();
    const { onSave } = mount(original);

    type(byLabel('Title'), '  Weeknight bread  ');
    // Add a line to the first group, then move it to the top.
    button('Add ingredient').click();
    const lines = container.querySelectorAll<HTMLInputElement>('.editor-lines input');
    type(lines[2]!, '2 tbsp olive oil');
    button('Move ingredient 3 up').click();
    button('Move ingredient 2 up').click();
    // New titled group with one line.
    button('Add ingredient group').click();
    type(byLabel('Group heading (optional)') as HTMLInputElement, 'x'); // first group heading
    type(byLabel('Group heading (optional)') as HTMLInputElement, '');
    const groupTitles = container.querySelectorAll<HTMLInputElement>('[data-key^="ingg:"]');
    type(groupTitles[1]!, 'Topping');
    const allLines = container.querySelectorAll<HTMLInputElement>('.editor-lines:not(.editor-steps) input');
    type(allLines[3]!, '1/2 cup sugar');
    // Steps: move step 2 up, remove the (now) second step.
    button('Move step 2 up').click();
    button('Remove step 2').click();
    type(byLabel('Tags') as HTMLInputElement, 'dinner, Bread , dinner,, quick');
    type(byLabel('Notes') as HTMLTextAreaElement, ' Keep warm. ');
    submit();

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const r = onSave.mock.calls[0]![0] as RecipeV1;
    expect(r).not.toBe(original);
    expect(r.id).toBe(original.id);
    expect(r.title).toBe('Weeknight bread');
    expect(r.ingredientGroups).toHaveLength(2);
    expect(r.ingredientGroups[0]!.title).toBe('');
    expect(r.ingredientGroups[0]!.items.map((i) => i.raw)).toEqual(['2 tbsp olive oil', '1 1/2 cups flour', 'salt to taste']);
    // Unchanged lines keep their parsed data; new lines are parsed by the domain parser.
    expect(r.ingredientGroups[0]!.items[1]).toEqual(original.ingredientGroups[0]!.items[0]);
    expect(r.ingredientGroups[0]!.items[0]!.quantity).toEqual({ minNumerator: 2, minDenominator: 1 });
    expect(r.ingredientGroups[1]!.title).toBe('Topping');
    expect(r.ingredientGroups[1]!.items.map((i) => i.raw)).toEqual(['1/2 cup sugar']);
    expect(r.instructionGroups[0]!.steps.map((s) => s.text)).toEqual(['Bake.']);
    expect(r.tags).toEqual(['dinner', 'Bread', 'quick']);
    expect(r.notes).toBe('Keep warm.');
    expect(r.revision).toBe(original.revision);
    // Original object untouched.
    expect(original.title).toBe('Recipe ' + original.id.slice(2));
  });

  it('re-parses the yield and replaces stale structured times when text changes', async () => {
    const { onSave } = mount(makeRecipe());
    type(byLabel('Yield'), 'Makes 6 servings');
    type(byLabel('Times'), 'About an hour');
    submit();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const r = onSave.mock.calls[0]![0] as RecipeV1;
    expect(r.originalYield.text).toBe('Makes 6 servings');
    expect(r.originalYield.quantity).toEqual({ minNumerator: 6, minDenominator: 1 });
    expect(r.times).toEqual({ raw: 'About an hour' });
  });

  it('validates the source URL inline and normalizes valid links', async () => {
    const { onSave } = mount(makeRecipe());
    const url = byLabel('Source link');
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com/x', 'not a url']) {
      type(url, bad);
      submit();
      await Promise.resolve();
      expect(onSave).not.toHaveBeenCalled();
      expect(url.getAttribute('aria-invalid')).toBe('true');
      const err = document.getElementById(`${url.id}-err`)!;
      expect(err.hidden).toBe(false);
      expect(err.textContent).toMatch(/http:\/\/ or https:\/\//);
      expect(container.querySelector('[role="alert"]')!.textContent).toMatch(/Fix this problem/);
    }
    type(url, 'https://user:pw@example.com/pie?utm_source=x&id=7#comments');
    submit();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect((onSave.mock.calls[0]![0] as RecipeV1).source.url).toBe('https://example.com/pie?id=7');
    expect(url.hasAttribute('aria-invalid')).toBe(false);
  });

  it('allows an empty source URL and requires a title', async () => {
    const { onSave } = mount(emptyRecipe());
    submit();
    await Promise.resolve();
    expect(onSave).not.toHaveBeenCalled();
    expect(byLabel('Title').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(byLabel('Title'));
    type(byLabel('Title'), 'Toast');
    type(container.querySelector<HTMLInputElement>('.editor-lines input')!, '2 slices bread');
    submit();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const r = onSave.mock.calls[0]![0] as RecipeV1;
    expect(r.source.url).toBe('');
    expect(r.extraction.method).toBe('manual');
    expect(r.instructionGroups).toEqual([]); // empty step dropped
    expect(r.ingredientGroups[0]!.items[0]!.raw).toBe('2 slices bread');
  });

  it('renders untrusted text as text, never markup', async () => {
    const xss = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const recipe = makeRecipe({
      title: xss,
      notes: xss,
      tags: [xss],
      ingredientGroups: [{ id: 'g', title: xss, items: [{ id: 'i', raw: xss, confidence: 'low' }] }],
      instructionGroups: [{ id: 's', title: '', steps: [{ id: 'a', text: xss }] }],
    });
    await saveCollection({ id: 'c1', name: xss });
    const { onSave } = mount(recipe);
    await vi.waitFor(() => expect(container.querySelector('.editor-collections input')).not.toBeNull());
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect((byLabel('Title') as HTMLInputElement).value).toBe(xss);
    expect(container.querySelector('.editor-collections label')!.textContent).toBe(xss);
    submit();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect((onSave.mock.calls[0]![0] as RecipeV1).ingredientGroups[0]!.items[0]!.raw).toBe(xss);
  });

  it('assigns collections with checkboxes', async () => {
    await saveCollection({ id: 'c1', name: 'Soups' });
    await saveCollection({ id: 'c2', name: 'Baking' });
    const { onSave } = mount(makeRecipe({ collectionIds: ['c1'] }));
    await vi.waitFor(() => expect(container.querySelectorAll('.editor-collections input')).toHaveLength(2));
    const soups = byLabel('Soups') as HTMLInputElement;
    const baking = byLabel('Baking') as HTMLInputElement;
    expect(soups.checked).toBe(true);
    soups.click();
    baking.click();
    submit();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect((onSave.mock.calls[0]![0] as RecipeV1).collectionIds).toEqual(['c2']);
  });

  it('reorders with keyboard-focusable buttons and keeps focus on the moved item', () => {
    mount(makeRecipe());
    const up = button('Move ingredient 2 up');
    up.focus();
    up.click();
    // Item is now first: its "up" is disabled, so focus falls to its "down" button.
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Move ingredient 1 down');
    const raws = Array.from(container.querySelectorAll<HTMLInputElement>('.editor-lines input')).map((i) => i.value);
    expect(raws.slice(0, 2)).toEqual(['salt to taste', '1 1/2 cups flour']);
  });

  it('pasting several lines adds one ingredient per line', () => {
    mount(emptyRecipe());
    const input = container.querySelector<HTMLInputElement>('.editor-lines input')!;
    const ev = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(ev, 'clipboardData', { value: { getData: () => '1 cup rice\n2 cups water\n\nsalt' } });
    input.dispatchEvent(ev);
    const raws = Array.from(container.querySelectorAll<HTMLInputElement>('.editor-lines input')).map((i) => i.value);
    expect(raws).toEqual(['1 cup rice', '2 cups water', 'salt']);
  });

  it('cancel calls onCancel and saves nothing', () => {
    const { onSave, onCancel } = mount(makeRecipe());
    type(byLabel('Title'), 'Changed');
    button('Cancel').click();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows the onSave error inline and keeps the form', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('There is not enough storage space on this device.'));
    mount(makeRecipe(), onSave);
    submit();
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')!.textContent).toMatch(/not enough storage/));
    expect(container.querySelector('form')).not.toBeNull();
    expect(button('Save recipe').disabled).toBe(false);
  });

  it('stores a local image, previews it via an object URL and revokes it on unmount', async () => {
    usePassthroughReencoder();
    const create = vi.fn(() => 'blob:preview-1');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const { onSave } = mount(makeRecipe());
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([PNG], 'photo.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(container.querySelector('.editor-image-preview img')).not.toBeNull());
    expect(container.querySelector('.editor-image-preview img')!.getAttribute('src')).toBe('blob:preview-1');
    submit();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const r = onSave.mock.calls[0]![0] as RecipeV1;
    expect(r.localImageId).toBeTruthy();
    expect(await getImage(r.localImageId!)).toBeDefined();
    unmount!();
    unmount = null;
    expect(revoke).toHaveBeenCalledWith('blob:preview-1');
  });

  it('rejects an SVG image with an inline message', async () => {
    usePassthroughReencoder();
    mount(makeRecipe());
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], 'x.svg', { type: 'image/svg+xml' });
    Object.defineProperty(input, 'files', { value: [svg], configurable: true });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(document.getElementById(input.id + '-err')!.hidden).toBe(false));
    expect(container.querySelector('.editor-image-preview img')).toBeNull();
  });

  it('deletes an uploaded image when editing is cancelled', async () => {
    usePassthroughReencoder();
    const img = await putImage(new Blob([PNG], { type: 'image/png' }));
    expect(await getImage(img.id)).toBeDefined();
    // Simulate: user uploads during the session, then cancels.
    const { onCancel } = mount(makeRecipe());
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [new File([PNG], 'p.png', { type: 'image/png' })], configurable: true });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(async () => expect((await countAll()).images).toBe(2));
    button('Cancel').click();
    expect(onCancel).toHaveBeenCalled();
    await vi.waitFor(async () => expect((await countAll()).images).toBe(1));
    // The pre-existing, unrelated image is untouched.
    expect(await getImage(img.id)).toBeDefined();
  });
});

describe('parseTags', () => {
  it('trims, drops empties and de-duplicates case-insensitively', () => {
    expect(parseTags(' a, B ,, b, c  d ')).toEqual(['a', 'B', 'c d']);
  });
});
