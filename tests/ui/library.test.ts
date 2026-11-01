// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecipeV1 } from '../../src/shared/types';
import { getRecipe, listRecipes, saveCollection, saveRecipe, setSessionOnly } from '../../src/storage';
import { initLibrary, parseRoute, singleRecipeBackup, sourceLabel } from '../../src/ui/library';
import { makeRecipe, resetDb } from '../storage/helpers';

let app: HTMLElement;
let dispose: (() => void) | null = null;
const tabsCreate = vi.fn();

beforeEach(async () => {
  await resetDb();
  document.body.innerHTML = '';
  history.replaceState(null, '', '/ui/library.html');
  app = document.createElement('div');
  document.body.appendChild(app);
  tabsCreate.mockReset();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { id: 'test', getURL: (p: string) => `chrome-extension://test/${p}` },
    tabs: { create: tabsCreate },
  };
});
afterEach(() => {
  dispose?.();
  dispose = null;
});

async function start(hash = ''): Promise<void> {
  if (hash) history.replaceState(null, '', `/ui/library.html${hash}`);
  dispose = await initLibrary(app);
}
const button = (name: string, root: ParentNode = document): HTMLButtonElement => {
  const b = Array.from(root.querySelectorAll('button')).find((x) => x.getAttribute('aria-label') === name || x.textContent?.trim() === name);
  if (!b) throw new Error(`button not found: ${name}`);
  return b;
};
const navigate = (hash: string): void => {
  location.hash = hash;
};

describe('helpers', () => {
  it('parses deep links', () => {
    expect(parseRoute('#recipe=abc')).toEqual({ name: 'recipe', id: 'abc' });
    expect(parseRoute('#lists')).toEqual({ name: 'lists' });
    expect(parseRoute('#new')).toEqual({ name: 'new' });
    expect(parseRoute('#list=a%20b')).toEqual({ name: 'list', id: 'a b' });
    expect(parseRoute('')).toEqual({ name: 'recipes' });
    expect(parseRoute('#nonsense')).toEqual({ name: 'recipes' });
  });
  it('labels sources by host name as text', () => {
    expect(sourceLabel(makeRecipe({ source: { url: 'https://www.example.com/a?b=1' } }))).toBe('example.com');
    expect(sourceLabel(makeRecipe({ source: { url: '' }, extraction: { method: 'manual', missingFields: [], warnings: [] } }))).toBe('Your recipe');
  });
  it('builds a one-recipe backup with only its collections', async () => {
    const r = makeRecipe({ collectionIds: ['c1'] });
    const b = await singleRecipeBackup(r, [{ id: 'c1', name: 'A' }, { id: 'c2', name: 'B' }]);
    expect(b).toMatchObject({ format: 'recipe-pocket-backup', version: 1, recipes: [r], collections: [{ id: 'c1', name: 'A' }], shoppingLists: [] });
  });
});

describe('library page', () => {
  it('explains how to read a tab when the library is empty', async () => {
    await start();
    expect(app.querySelector('h1')!.textContent).toBe('Recipes');
    expect(app.textContent).toMatch(/Your library is empty/);
    expect(app.textContent).toMatch(/Click the Recipe Pocket icon in the toolbar/);
    expect(app.querySelector('header')).not.toBeNull();
    expect(app.querySelector('main')).not.toBeNull();
    expect(app.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
  });

  it('lists recipes with host and tags as text, and searches', async () => {
    await saveRecipe(makeRecipe({ id: 'x', title: '<img src=x onerror=alert(1)> Tart', tags: ['<b>dessert</b>'] }));
    await saveRecipe(makeRecipe({ id: 'y', title: 'Lentil soup', source: { url: 'https://www.soups.example/lentil' }, tags: ['dinner'] }));
    await start();
    await vi.waitFor(() => expect(app.querySelectorAll('.recipe-list li')).toHaveLength(2));
    expect(app.querySelector('main img, main b')).toBeNull();
    expect(app.textContent).toContain('<img src=x onerror=alert(1)> Tart');
    expect(app.textContent).toContain('soups.example');
    const search = app.querySelector<HTMLInputElement>('#rp-search')!;
    search.value = 'lentil';
    search.dispatchEvent(new Event('input'));
    await vi.waitFor(() => expect(app.querySelectorAll('.recipe-list li')).toHaveLength(1), { timeout: 2000 });
    expect(app.querySelector('.recipe-list a')!.textContent).toBe('Lentil soup');
    expect(app.querySelector('.result-count')!.textContent).toBe('1 recipe found');
    // Tag filter
    search.value = '';
    search.dispatchEvent(new Event('input'));
    const tag = app.querySelector<HTMLSelectElement>('#rp-filter-tag')!;
    tag.value = 'dinner';
    tag.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(app.querySelector('.recipe-list a')!.textContent).toBe('Lentil soup'), { timeout: 2000 });
  });

  it('filters by collection', async () => {
    await saveCollection({ id: 'c1', name: 'Soups' });
    await saveRecipe(makeRecipe({ id: 'x', title: 'Tart' }));
    await saveRecipe(makeRecipe({ id: 'y', title: 'Lentil soup', collectionIds: ['c1'] }));
    await start();
    await vi.waitFor(() => expect(app.querySelectorAll('.recipe-list li')).toHaveLength(2));
    const sel = app.querySelector<HTMLSelectElement>('#rp-filter-collection')!;
    sel.value = 'c1';
    sel.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(app.querySelectorAll('.recipe-list li')).toHaveLength(1));
    expect(app.querySelector('.recipe-list a')!.textContent).toBe('Lentil soup');
  });

  it('opens a recipe deep link with view, scale controls and actions', async () => {
    await saveRecipe(makeRecipe({ id: 'r1', title: 'Pancakes' }));
    await start('#recipe=r1');
    await vi.waitFor(() => expect(app.querySelector('h1')?.textContent).toBe('Pancakes'));
    expect(app.querySelector('.scale-controls')).not.toBeNull();
    for (const name of ['Edit', 'Duplicate', 'Print', 'Export this recipe', 'Add to shopping list', 'Delete']) button(name, app);
    expect(document.title).toContain('Pancakes');
  });

  it('prints a saved recipe through the print page', async () => {
    await saveRecipe(makeRecipe({ id: 'r1', title: 'Pancakes' }));
    await start('#recipe=r1');
    await vi.waitFor(() => button('Print', app));
    button('Print', app).click();
    expect(tabsCreate).toHaveBeenCalledWith({ url: 'chrome-extension://test/ui/print.html?recipe=r1&n=1&d=1&units=original&notes=1' });
  });

  it('delete asks for confirmation; cancel keeps the record', async () => {
    await saveRecipe(makeRecipe({ id: 'r1', title: 'Pancakes' }));
    await start('#recipe=r1');
    await vi.waitFor(() => button('Delete', app));
    button('Delete', app).click();
    const dialog = document.querySelector('dialog')!;
    expect(dialog.textContent).toMatch(/Delete "Pancakes"\?/);
    button('Cancel', dialog).click();
    expect(document.querySelector('dialog')).toBeNull();
    expect(await getRecipe('r1')).toBeDefined();
    button('Delete', app).click();
    button('Delete recipe').click();
    await vi.waitFor(async () => expect(await getRecipe('r1')).toBeUndefined());
  });

  it('duplicates with a new id, revision 0 and "(copy)"', async () => {
    await saveRecipe(makeRecipe({ id: 'r1', title: 'Pancakes' }));
    await start('#recipe=r1');
    await vi.waitFor(() => button('Duplicate', app));
    button('Duplicate', app).click();
    await vi.waitFor(async () => expect(await listRecipes()).toHaveLength(2));
    const copy = (await listRecipes()).find((r) => r.id !== 'r1')!;
    expect(copy.title).toBe('Pancakes (copy)');
    expect(copy.revision).toBe(1); // stored once from revision 0
    await vi.waitFor(() => expect(location.hash).toBe(`#recipe=${copy.id}`));
  });

  it('creates a manual recipe from #new', async () => {
    await start('#new');
    await vi.waitFor(() => expect(app.querySelector('form.rp-editor')).not.toBeNull());
    const title = app.querySelector<HTMLInputElement>('[data-key="title"]')!;
    title.value = 'Grandma\'s stew';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    const line = app.querySelector<HTMLInputElement>('.editor-lines input')!;
    line.value = '1 kg beef';
    line.dispatchEvent(new Event('input', { bubbles: true }));
    app.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(async () => expect(await listRecipes()).toHaveLength(1));
    const r = (await listRecipes())[0]!;
    expect(r).toMatchObject({ title: 'Grandma\'s stew', source: { url: '' }, extraction: { method: 'manual' } });
    await vi.waitFor(() => expect(location.hash).toBe(`#recipe=${r.id}`));
  });

  it('edit: a concurrent change shows a conflict notice and keeps the editor open', async () => {
    const saved = await saveRecipe(makeRecipe({ id: 'r1', title: 'Pancakes' }));
    await start('#edit=r1');
    await vi.waitFor(() => expect(app.querySelector('form.rp-editor')).not.toBeNull());
    await saveRecipe({ ...saved, title: 'Changed in another tab' });
    app.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(app.textContent).toMatch(/changed in another tab or window/));
    expect(app.querySelector('form.rp-editor')).not.toBeNull();
    expect((await getRecipe('r1'))!.title).toBe('Changed in another tab');
    button('Load latest version', app).click();
    await vi.waitFor(() => expect(app.querySelector<HTMLInputElement>('[data-key="title"]')?.value).toBe('Changed in another tab'));
  });

  it('asks before leaving an editor with unsaved changes', async () => {
    await saveRecipe(makeRecipe({ id: 'r1', title: 'Pancakes' }));
    await start('#edit=r1');
    await vi.waitFor(() => expect(app.querySelector('form.rp-editor')).not.toBeNull());
    const title = app.querySelector<HTMLInputElement>('[data-key="title"]')!;
    title.value = 'Edited';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    navigate('#lists');
    await vi.waitFor(() => expect(document.querySelector('dialog')?.textContent).toMatch(/Discard unsaved changes/));
    expect(location.hash).toBe('#edit=r1');
    button('Keep editing').click();
    expect(app.querySelector<HTMLInputElement>('[data-key="title"]')!.value).toBe('Edited');
    navigate('#lists');
    await vi.waitFor(() => expect(document.querySelector('dialog')).not.toBeNull());
    button('Discard changes').click();
    await vi.waitFor(() => expect(app.querySelector('h1')?.textContent).toBe('Shopping lists'));
  });

  it('session-only mode shows a persistent banner and explains disabled saving actions', async () => {
    await saveRecipe(makeRecipe({ id: 'r1', title: 'Pancakes' }));
    await setSessionOnly(true);
    await start('#recipe=r1');
    await vi.waitFor(() => button('Delete', app));
    expect(app.querySelector('.session-banner')!.textContent).toMatch(/Nothing will be saved/);
    for (const name of ['Edit', 'Duplicate', 'Add to shopping list', 'Delete']) {
      const b = button(name, app);
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.getAttribute('aria-describedby')).toBe('rp-session-note');
    }
    button('Delete', app).click();
    expect(document.querySelector('dialog')).toBeNull();
    await vi.waitFor(() => expect(app.querySelector('[role="status"]')!.textContent).toMatch(/Session-only mode is on/));
    expect(await getRecipe('r1')).toBeDefined();
    // Print and export still work.
    expect(button('Print', app).hasAttribute('aria-disabled')).toBe(false);
  });

  it('manages collections from a dialog (create, rename, delete)', async () => {
    await start();
    button('Manage collections', app).click();
    const dialog = document.querySelector('dialog')!;
    const input = dialog.querySelector<HTMLInputElement>('#rp-new-collection')!;
    input.value = 'Soups';
    button('Add collection', dialog).click();
    await vi.waitFor(() => expect(dialog.querySelector('.collection-row')).not.toBeNull());
    const name = dialog.querySelector<HTMLInputElement>('.collection-row input')!;
    name.value = 'Stews';
    button('Rename collection Soups', dialog).click();
    await vi.waitFor(() => button('Delete collection Stews', dialog));
    button('Delete collection Stews', dialog).click();
    const confirm = Array.from(document.querySelectorAll('dialog')).pop()!;
    expect(confirm.textContent).toMatch(/recipes stay in your library/);
    button('Delete collection', confirm).click();
    await vi.waitFor(() => expect(dialog.textContent).toMatch(/No collections yet/));
  });
});

describe('recipe type guard', () => {
  it('fixture is a valid RecipeV1 shape', () => {
    const r: RecipeV1 = makeRecipe();
    expect(r.schemaVersion).toBe(1);
  });
});
