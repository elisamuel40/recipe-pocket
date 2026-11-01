// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  countAll,
  exportBackup,
  getPreferences,
  listRecipes,
  saveCollection,
  saveRecipe,
  saveShoppingList,
} from '../../src/storage';
import { ISSUES_URL, initOptions } from '../../src/ui/options';
import { makeRecipe, resetDb } from '../storage/helpers';

let app: HTMLElement;

beforeEach(async () => {
  await resetDb();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
  app = document.createElement('div');
  document.body.appendChild(app);
});

const button = (name: string, root: ParentNode = document): HTMLButtonElement => {
  const b = Array.from(root.querySelectorAll('button')).find((x) => x.textContent?.trim() === name || x.getAttribute('aria-label') === name);
  if (!b) throw new Error(`button not found: ${name}`);
  return b;
};
const pickFile = (text: string, name = 'backup.json'): void => {
  const input = app.querySelector<HTMLInputElement>('#rp-import')!;
  Object.defineProperty(input, 'files', { value: [new File([text], name, { type: 'application/json' })], configurable: true });
  input.dispatchEvent(new Event('change'));
};

async function seed(): Promise<void> {
  await saveRecipe(makeRecipe({ id: 'a', title: 'Apple pie' }));
  await saveRecipe(makeRecipe({ id: 'b', title: 'Bread' }));
  await saveCollection({ id: 'c', name: 'Baking' });
  await saveShoppingList({ id: 'l', name: 'Weekly', aisles: ['Other'], items: [], revision: 0 });
}

describe('settings page structure', () => {
  it('has landmarks, ordered headings and labelled controls', async () => {
    await initOptions(app);
    expect(app.querySelector('main h1')!.textContent).toBe('Settings');
    const h2 = Array.from(app.querySelectorAll('main > section > h2')).map((h) => h.textContent);
    expect(h2).toEqual(['Appearance and units', 'Privacy', 'Backup and restore', 'Delete all data', 'Help and troubleshooting', 'Support', 'Licenses']);
    for (const el of Array.from(app.querySelectorAll('input, select'))) {
      const id = el.id;
      expect(id, el.outerHTML).toBeTruthy();
      expect(app.querySelector(`label[for="${id}"]`), `label for ${id}`).not.toBeNull();
    }
  });

  it('shows the privacy summary, help, public-disclosure warning and licenses without promising priority support', async () => {
    await initOptions(app);
    const text = app.textContent!;
    expect(text).toMatch(/No analytics/);
    expect(text).toMatch(/Removing the extension from Chrome deletes its stored data/);
    expect(text).toMatch(/outside the extension/);
    expect(text).toMatch(/Pages that cannot be read/);
    expect(text).toMatch(/Sites that block reading/);
    expect(text).toMatch(/Keyboard use/);
    expect(text).toMatch(/Issues are public/);
    expect(text).toMatch(/Do not include private recipes/);
    expect(text).toMatch(/MIT License/);
    expect(text).toMatch(/no paid or priority support/);
    const link = app.querySelector<HTMLAnchorElement>(`a[href="${ISSUES_URL}"]`)!;
    expect(link.rel).toContain('noopener');
    expect(ISSUES_URL).toBe('https://github.com/elisamuel40/recipe-pocket/issues');
  });
});

describe('preferences', () => {
  it('applies the theme and font scale live and saves them', async () => {
    await initOptions(app);
    const dark = app.querySelector<HTMLInputElement>('#rp-theme-dark')!;
    dark.checked = true;
    dark.dispatchEvent(new Event('change'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    const font = app.querySelector<HTMLSelectElement>('#rp-font')!;
    font.value = '1.5';
    font.dispatchEvent(new Event('change'));
    expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('1.5');
    await vi.waitFor(async () => expect(await getPreferences()).toMatchObject({ theme: 'dark', fontScale: 1.5 }));
    const units = app.querySelector<HTMLSelectElement>('#rp-units')!;
    units.value = 'metric';
    units.dispatchEvent(new Event('change'));
    await vi.waitFor(async () => expect((await getPreferences()).unitSystem).toBe('metric'));
  });

  it('turns session-only mode on and explains it', async () => {
    await initOptions(app);
    expect(app.querySelector('#rp-session-hint')!.textContent).toMatch(/only value stored is this on\/off setting itself/);
    const cb = app.querySelector<HTMLInputElement>('#rp-session')!;
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    await vi.waitFor(async () => expect((await getPreferences()).sessionOnly).toBe(true));
    await vi.waitFor(() => expect(app.textContent).toMatch(/Session-only mode is on\. Recipes, lists/));
    expect(app.querySelector<HTMLInputElement>('#rp-import')!.disabled).toBe(true);
    // Preference changes now apply to the page only.
    const light = app.querySelector<HTMLInputElement>('#rp-theme-light')!;
    light.checked = true;
    light.dispatchEvent(new Event('change'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    await vi.waitFor(() => expect(app.textContent).toMatch(/applied to this page only/));
  });
});

describe('delete all local data', () => {
  it('shows counts, and cancel preserves everything', async () => {
    await seed();
    await initOptions(app);
    button('Delete all local data…', app).click();
    await vi.waitFor(() => expect(document.querySelector('dialog')).not.toBeNull());
    const dialog = document.querySelector('dialog')!;
    expect(dialog.textContent).toMatch(/2 recipes, 1 collection, 1 shopping list and 0 photos/);
    // Focus starts on the safe choice.
    expect(document.activeElement?.textContent).toBe('Cancel, keep everything');
    expect(button('Delete 2 recipes and all other data', dialog).className).toContain('danger');
    button('Cancel, keep everything', dialog).click();
    await vi.waitFor(() => expect(app.textContent).toMatch(/Cancelled\. Nothing was deleted/));
    expect(await countAll()).toEqual({ recipes: 2, collections: 1, shoppingLists: 1, images: 0 });
  });

  it('Escape cancels too', async () => {
    await seed();
    await initOptions(app);
    button('Delete all local data…', app).click();
    await vi.waitFor(() => expect(document.querySelector('dialog')).not.toBeNull());
    document.querySelector('dialog')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('dialog')).toBeNull();
    expect((await countAll()).recipes).toBe(2);
  });

  it('deletes everything only after the labelled confirm', async () => {
    await seed();
    await initOptions(app);
    button('Delete all local data…', app).click();
    await vi.waitFor(() => expect(document.querySelector('dialog')).not.toBeNull());
    button('Delete 2 recipes and all other data').click();
    await vi.waitFor(() => expect(app.textContent).toMatch(/All local data was deleted/));
    expect(await countAll()).toEqual({ recipes: 0, collections: 0, shoppingLists: 0, images: 0 });
  });
});

describe('backup import', () => {
  it('previews counts and conflicts; default resolution skips', async () => {
    await seed();
    const backup = await exportBackup();
    await initOptions(app);
    pickFile(backup);
    await vi.waitFor(() => expect(app.querySelector('.import-preview')).not.toBeNull());
    const preview = app.querySelector('.import-preview')!;
    expect(preview.textContent).toMatch(/2 recipes/);
    expect(preview.textContent).toMatch(/Already in your library \(2\)/);
    expect(preview.textContent).toMatch(/Apple pie/);
    expect(app.querySelector<HTMLInputElement>('#rp-res-skip')!.checked).toBe(true);
    button('Import', preview).click();
    await vi.waitFor(() => expect(app.textContent).toMatch(/Import finished: 0 added, 0 replaced, 2 skipped/));
    expect((await countAll()).recipes).toBe(2);
  });

  it('passes the chosen resolution (duplicate) to the commit', async () => {
    await seed();
    const backup = await exportBackup();
    await initOptions(app);
    pickFile(backup);
    await vi.waitFor(() => expect(app.querySelector('.import-preview')).not.toBeNull());
    const dup = app.querySelector<HTMLInputElement>('#rp-res-duplicate')!;
    dup.checked = true;
    dup.dispatchEvent(new Event('change'));
    button('Import', app.querySelector('.import-preview')!).click();
    await vi.waitFor(() => expect(app.textContent).toMatch(/Import finished: 2 added, 0 replaced, 0 skipped/));
    expect((await listRecipes()).length).toBe(4);
  });

  it('replace overwrites the conflicting recipes', async () => {
    await seed();
    const parsed = JSON.parse(await exportBackup());
    parsed.recipes[0].title = 'Imported title';
    await initOptions(app);
    pickFile(JSON.stringify(parsed));
    await vi.waitFor(() => expect(app.querySelector('.import-preview')).not.toBeNull());
    const rep = app.querySelector<HTMLInputElement>('#rp-res-replace')!;
    rep.checked = true;
    rep.dispatchEvent(new Event('change'));
    button('Import', app.querySelector('.import-preview')!).click();
    await vi.waitFor(() => expect(app.textContent).toMatch(/0 added, 2 replaced, 0 skipped/));
    expect((await listRecipes()).map((r) => r.title)).toContain('Imported title');
  });

  it('cancel in the preview changes nothing', async () => {
    const backup = JSON.stringify({ format: 'recipe-pocket-backup', version: 1, recipes: [makeRecipe({ id: 'new1' })], collections: [], shoppingLists: [] });
    await initOptions(app);
    pickFile(backup);
    await vi.waitFor(() => expect(app.querySelector('.import-preview')).not.toBeNull());
    expect(app.querySelector('#rp-res-skip')).toBeNull(); // no conflicts, no choice needed
    button('Cancel', app.querySelector('.import-preview')!).click();
    await vi.waitFor(() => expect(app.textContent).toMatch(/Import cancelled\. Nothing was changed/));
    expect((await countAll()).recipes).toBe(0);
  });

  it('an invalid backup shows the plain-text reason and changes nothing', async () => {
    await seed();
    await initOptions(app);
    pickFile('{"format":"something-else","version":1}');
    await vi.waitFor(() => expect(app.querySelector('.import-area [role="alert"]')).not.toBeNull());
    expect(app.querySelector('.import-area [role="alert"]')!.textContent).toMatch(/can't be imported: .+ Nothing was changed\./);
    expect(app.querySelector('.import-preview')).toBeNull();
    expect((await countAll()).recipes).toBe(2);
  });

  it('a hostile backup is rejected and its text is never rendered as markup', async () => {
    await initOptions(app);
    pickFile('{"__proto__":{"polluted":true},"format":"recipe-pocket-backup","version":1,"recipes":[],"collections":[],"shoppingLists":[]}');
    await vi.waitFor(() => expect(app.querySelector('.import-area [role="alert"]')).not.toBeNull());
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    pickFile('not json <img src=x onerror=alert(1)>');
    await vi.waitFor(() => expect(app.querySelector('.import-area [role="alert"]')).not.toBeNull());
    expect(app.querySelector('img')).toBeNull();
  });
});

describe('backup export', () => {
  it('downloads via an object URL with a sanitized filename and revokes it', async () => {
    await seed();
    const create = vi.fn(() => 'blob:backup');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const clicks: HTMLAnchorElement[] = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push(this);
    };
    try {
      await initOptions(app);
      button('Export backup', app).click();
      await vi.waitFor(() => expect(clicks).toHaveLength(1));
      expect(clicks[0]!.download).toMatch(/^recipe-pocket-backup-\d{4}-\d{2}-\d{2}\.json$/);
      expect(clicks[0]!.getAttribute('href')).toBe('blob:backup');
      await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:backup'));
      await vi.waitFor(() => expect(app.textContent).toMatch(/Backup exported/));
    } finally {
      HTMLAnchorElement.prototype.click = orig;
    }
  });
});
