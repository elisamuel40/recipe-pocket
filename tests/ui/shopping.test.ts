// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShoppingList } from '../../src/shared/types';
import { getShoppingList, listShoppingLists, saveRecipe, saveShoppingList } from '../../src/storage';
import { mountShoppingListEditor, normalizeAisles, shoppingListToText } from '../../src/ui/components/shopping-list';
import { mountShoppingLists } from '../../src/ui/components/shopping-lists';
import { makeRecipe, resetDb } from '../storage/helpers';

let container: HTMLElement;
let unmount: (() => void) | null = null;
const announce = vi.fn();

beforeEach(async () => {
  await resetDb();
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  announce.mockReset();
});
afterEach(() => {
  unmount?.();
  unmount = null;
});

const sampleList = (): ShoppingList => ({
  id: 'L1',
  name: 'Weekly',
  aisles: ['Produce', 'Dairy'],
  revision: 0,
  items: [
    { id: 'a', text: '2 onions', aisle: 'Produce', checked: false, manual: false, sources: [{ recipeId: 'r1', recipeTitle: 'Soup', raw: '2 onions' }] },
    { id: 'b', text: '1 cup milk', aisle: 'Dairy', checked: true, manual: false, sources: [{ recipeId: 'r2', recipeTitle: 'Pancakes', raw: '1 cup milk' }, { recipeId: 'r1', recipeTitle: 'Soup', raw: 'milk' }] },
  ],
});

const button = (name: string, root: ParentNode = document): HTMLButtonElement => {
  const b = Array.from(root.querySelectorAll('button')).find((x) => x.getAttribute('aria-label') === name || x.textContent?.trim() === name);
  if (!b) throw new Error(`button not found: ${name}`);
  return b;
};
const aisleHeadings = (): string[] =>
  Array.from(container.querySelectorAll('section.aisle h2')).map((h) => h.firstChild!.textContent!);

async function mountSaved(list = sampleList()) {
  const stored = await saveShoppingList(list);
  unmount = mountShoppingListEditor(container, stored, { readOnly: false, announce, onDeleted: vi.fn() });
  return stored;
}
const stored = async () => (await getShoppingList('L1'))!;

describe('shopping list text', () => {
  it('formats aisles, checks and sources as plain text', () => {
    expect(shoppingListToText(sampleList())).toBe(
      'Weekly\n\nProduce\n[ ] 2 onions (from: Soup)\n\nDairy\n[x] 1 cup milk (from: Pancakes; Soup)\n',
    );
  });
  it('normalizeAisles adds aisles used by items', () => {
    const l = sampleList();
    l.items[0]!.aisle = 'Bakery';
    expect(normalizeAisles(l).aisles).toEqual(['Produce', 'Dairy', 'Bakery']);
  });
});

describe('shopping list editor', () => {
  it('groups items by aisle and keeps the source association visible', async () => {
    await mountSaved();
    expect(aisleHeadings()).toEqual(['Produce', 'Dairy']);
    const sources = Array.from(container.querySelectorAll('.item-source')).map((p) => p.textContent);
    expect(sources).toEqual(['from: Soup', 'from: Pancakes; Soup']);
  });

  it('checks and unchecks items and persists the change', async () => {
    await mountSaved();
    const cb = container.querySelector<HTMLInputElement>('#rp-si-a')!;
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    await vi.waitFor(async () => expect((await stored()).items.find((i) => i.id === 'a')!.checked).toBe(true));
    expect(container.querySelector('#rp-si-a')!.closest('li')!.className).toContain('is-checked');
    const cb2 = container.querySelector<HTMLInputElement>('#rp-si-a')!;
    cb2.checked = false;
    cb2.dispatchEvent(new Event('change'));
    await vi.waitFor(async () => expect((await stored()).items.find((i) => i.id === 'a')!.checked).toBe(false));
  });

  it('adds a manual entry to the chosen aisle', async () => {
    await mountSaved();
    const text = container.querySelector<HTMLInputElement>('#rp-add-item')!;
    text.value = 'Paper towels';
    const sel = container.querySelector<HTMLSelectElement>('#rp-add-item-aisle')!;
    sel.value = 'Dairy';
    button('Add item', container).click();
    await vi.waitFor(async () => expect((await stored()).items).toHaveLength(3));
    const item = (await stored()).items[2]!;
    expect(item).toMatchObject({ text: 'Paper towels', aisle: 'Dairy', manual: true, checked: false, sources: [] });
    expect(Array.from(container.querySelectorAll('.item-source')).map((p) => p.textContent)).toContain('Added by you');
    expect(document.activeElement?.id).toBe('rp-add-item');
  });

  it('chooses an aisle automatically for a manual entry', async () => {
    await mountSaved();
    const text = container.querySelector<HTMLInputElement>('#rp-add-item')!;
    text.value = 'carrots';
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await vi.waitFor(async () => expect((await stored()).items).toHaveLength(3));
    expect((await stored()).items[2]!.aisle).toBeTruthy();
  });

  it('moves an item between aisles', async () => {
    await mountSaved();
    const sel = container.querySelector<HTMLSelectElement>('#rp-si-aisle-a')!;
    sel.value = 'Dairy';
    sel.dispatchEvent(new Event('change'));
    await vi.waitFor(async () => expect((await stored()).items.find((i) => i.id === 'a')!.aisle).toBe('Dairy'));
    expect(aisleHeadings()).toEqual(['Dairy']);
  });

  it('adds, renames, reorders and removes aisles', async () => {
    await mountSaved();
    // Add
    const add = container.querySelector<HTMLInputElement>('#rp-aisle-new')!;
    add.value = 'Bakery';
    button('Add aisle', container).click();
    await vi.waitFor(async () => expect((await stored()).aisles).toEqual(['Produce', 'Dairy', 'Bakery']));
    // Rename Produce -> Vegetables (items follow)
    const name = container.querySelector<HTMLInputElement>('#rp-aisle-0')!;
    name.value = 'Vegetables';
    name.dispatchEvent(new Event('change'));
    await vi.waitFor(async () => expect((await stored()).aisles[0]).toBe('Vegetables'));
    expect((await stored()).items.find((i) => i.id === 'a')!.aisle).toBe('Vegetables');
    // Reorder: move Dairy up
    button('Move aisle Dairy up', container).click();
    await vi.waitFor(async () => expect((await stored()).aisles).toEqual(['Dairy', 'Vegetables', 'Bakery']));
    expect(aisleHeadings()).toEqual(['Dairy', 'Vegetables']);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Move aisle Dairy down');
    // Remove an aisle with items: they move to "Other".
    button('Remove aisle Dairy', container).click();
    await vi.waitFor(async () => expect((await stored()).aisles).toEqual(['Vegetables', 'Bakery', 'Other']));
    expect((await stored()).items.find((i) => i.id === 'b')!.aisle).toBe('Other');
  });

  it('rejects a duplicate aisle name', async () => {
    await mountSaved();
    const name = container.querySelector<HTMLInputElement>('#rp-aisle-0')!;
    name.value = 'dairy';
    name.dispatchEvent(new Event('change'));
    expect(announce).toHaveBeenCalledWith(expect.stringMatching(/already exists/));
    expect(name.value).toBe('Produce');
  });

  it('deletes an item and clears checked items after confirmation', async () => {
    await mountSaved();
    button('Delete 2 onions', container).click();
    await vi.waitFor(async () => expect((await stored()).items.map((i) => i.id)).toEqual(['b']));
    button('Clear checked items', container).click();
    // Cancel keeps the item
    button('Cancel').click();
    await new Promise((r) => setTimeout(r, 20));
    expect((await stored()).items).toHaveLength(1);
    button('Clear checked items', container).click();
    button('Remove 1 checked item').click();
    await vi.waitFor(async () => expect((await stored()).items).toHaveLength(0));
  });

  it('copies the list as plain text to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await mountSaved();
    button('Copy as text', container).click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(shoppingListToText(sampleList())));
  });

  it('reloads and tells the user when another tab changed the list', async () => {
    const s = await mountSaved();
    // Another tab saves a newer revision.
    await saveShoppingList({ ...s, name: 'Changed elsewhere' });
    const cb = container.querySelector<HTMLInputElement>('#rp-si-a')!;
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(announce).toHaveBeenCalledWith(expect.stringMatching(/changed in another tab/)));
    await vi.waitFor(() => expect(container.querySelector('h1')!.textContent).toBe('Changed elsewhere'));
  });

  it('item text with markup is rendered as text', async () => {
    const l = sampleList();
    l.items[0]!.text = '<img src=x onerror=alert(1)>';
    l.items[0]!.sources[0]!.recipeTitle = '<b>Soup</b>';
    await mountSaved(l);
    expect(container.querySelector('img, b')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.textContent).toContain('from: <b>Soup</b>');
  });
});

describe('shopping lists overview', () => {
  it('creates a list from selected recipes with a per-recipe factor', async () => {
    await saveRecipe(makeRecipe({ id: 'soup', title: 'Soup' }));
    await saveRecipe(makeRecipe({ id: 'bread', title: 'Bread' }));
    const openList = vi.fn();
    unmount = mountShoppingLists(container, { readOnly: false, unitSystem: 'original', announce, openList });
    await vi.waitFor(() => expect(container.textContent).toMatch(/No shopping lists yet/));
    button('New list from recipes', container).click();
    await vi.waitFor(() => expect(document.querySelector('dialog')).not.toBeNull());
    const dialog = document.querySelector('dialog')!;
    const nameInput = dialog.querySelector<HTMLInputElement>('#rp-newlist-name')!;
    nameInput.value = 'Party';
    const rows = Array.from(dialog.querySelectorAll('.picker-row'));
    const soupRow = rows.find((r) => r.textContent!.includes('Soup'))!;
    soupRow.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked = true;
    soupRow.querySelector<HTMLInputElement>('input[type="text"]')!.value = '2';
    button('Create list', dialog).click();
    await vi.waitFor(() => expect(openList).toHaveBeenCalled());
    const lists = await listShoppingLists();
    expect(lists).toHaveLength(1);
    const list = lists[0]!;
    expect(list.name).toBe('Party');
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items.every((i) => i.sources.every((s) => s.recipeTitle === 'Soup'))).toBe(true);
    const flour = list.items.find((i) => i.sources.some((s) => s.raw === '1 1/2 cups flour'))!;
    expect(flour.quantity).toEqual({ minNumerator: 3, minDenominator: 1 }); // 1 1/2 × 2
    for (const i of list.items) expect(list.aisles).toContain(i.aisle);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('requires at least one recipe and a valid factor', async () => {
    await saveRecipe(makeRecipe({ id: 'soup', title: 'Soup' }));
    unmount = mountShoppingLists(container, { readOnly: false, unitSystem: 'original', announce, openList: vi.fn() });
    button('New list from recipes', container).click();
    await vi.waitFor(() => expect(document.querySelector('dialog')).not.toBeNull());
    const dialog = document.querySelector('dialog')!;
    button('Create list', dialog).click();
    await vi.waitFor(() => expect(dialog.textContent).toMatch(/Select at least one recipe/));
    dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked = true;
    dialog.querySelector<HTMLInputElement>('.picker-row input[type="text"]')!.value = '-3';
    button('Create list', dialog).click();
    await vi.waitFor(() => expect(dialog.textContent).toMatch(/greater than 0/));
    expect(await listShoppingLists()).toHaveLength(0);
    // Escape closes without creating.
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('session-only: write actions are explained, not performed', async () => {
    unmount = mountShoppingLists(container, { readOnly: true, unitSystem: 'original', announce, openList: vi.fn() });
    const b = button('New list from recipes', container);
    expect(b.getAttribute('aria-disabled')).toBe('true');
    b.click();
    expect(announce).toHaveBeenCalledWith(expect.stringMatching(/Session-only mode is on/));
    expect(document.querySelector('dialog')).toBeNull();
  });
});
