/**
 * Shopping list overview and creation (PRD R09). Owner: UI owner B.
 * Lists are built from selected recipes (each with its own scale factor) via
 * domain.buildShoppingItems, which merges only identical normalized keys and
 * keeps the source association.
 */
import { clear, h, uid } from '../../shared/dom';
import type { RecipeV1, ShoppingItem, ShoppingList, UnitSystem } from '../../shared/types';
import * as storage from '../../storage/index';
import { buildShoppingItems, defaultAisle, parseServingsInput, rational, type Rational } from '../../domain/index';
import { openDialog, promptDialog, SESSION_ONLY_MESSAGE, storageErrorMessage } from './collection-dialogs';

export interface ShoppingListsOptions {
  readOnly: boolean;
  unitSystem: UnitSystem;
  announce: (msg: string) => void;
  /** Navigate to a list (library uses #list=<id>). */
  openList: (id: string) => void;
}

/** Aisle order: first-seen order of the items' aisles; items without an aisle get a default. */
export function aislesFor(items: ShoppingItem[]): string[] {
  const out: string[] = [];
  for (const i of items) {
    if (!i.aisle) {
      try {
        i.aisle = defaultAisle(i.ingredient ?? i.text) || 'Other';
      } catch {
        i.aisle = 'Other';
      }
    }
    if (!out.includes(i.aisle)) out.push(i.aisle);
  }
  return out;
}

export function newListFromRecipes(
  name: string,
  entries: { recipe: RecipeV1; factor: Rational }[],
  system: UnitSystem,
): ShoppingList {
  const items = buildShoppingItems(entries, system);
  return { id: uid(), name, aisles: aislesFor(items), items, revision: 0 };
}

/** Append items built from recipes to an existing list (items from separate builds are not merged). */
export function appendToList(list: ShoppingList, entries: { recipe: RecipeV1; factor: Rational }[], system: UnitSystem): ShoppingList {
  const items = buildShoppingItems(entries, system);
  const aisles = [...list.aisles];
  for (const a of aislesFor(items)) if (!aisles.includes(a)) aisles.push(a);
  return { ...list, aisles, items: [...list.items, ...items] };
}

function countText(list: ShoppingList): string {
  const checked = list.items.filter((i) => i.checked).length;
  return `${list.items.length} ${list.items.length === 1 ? 'item' : 'items'}, ${checked} checked`;
}

export function mountShoppingLists(container: HTMLElement, opts: ShoppingListsOptions): () => void {
  let disposed = false;
  const root = h('section', { className: 'shopping-lists', 'aria-labelledby': 'rp-lists-h' });
  const listWrap = h('div', {}, h('p', { className: 'muted' }, 'Loading shopping lists…'));
  const ro = opts.readOnly ? 'true' : null;
  const guard = (fn: () => void) => () => (opts.readOnly ? opts.announce(SESSION_ONLY_MESSAGE) : fn());

  root.append(
    h('h1', { id: 'rp-lists-h', tabindex: '-1' }, 'Shopping lists'),
    h(
      'div',
      { className: 'toolbar' },
      h('button', { type: 'button', className: 'primary', 'aria-disabled': ro, onclick: guard(() => void createFromRecipes()) }, 'New list from recipes'),
      h('button', { type: 'button', 'aria-disabled': ro, onclick: guard(() => void createEmpty()) }, 'New empty list'),
    ),
    listWrap,
  );

  async function load(): Promise<void> {
    let lists: ShoppingList[];
    try {
      lists = await storage.listShoppingLists();
    } catch (e) {
      if (disposed) return;
      clear(listWrap);
      listWrap.appendChild(h('p', { className: 'notice error' }, storageErrorMessage(e)));
      return;
    }
    if (disposed) return;
    clear(listWrap);
    if (lists.length === 0) {
      listWrap.appendChild(
        h('p', { className: 'empty-state' }, 'No shopping lists yet. Select "New list from recipes" to combine ingredients from saved recipes, or open a recipe and select "Add to shopping list".'),
      );
      return;
    }
    listWrap.appendChild(
      h(
        'ul',
        { className: 'card-list' },
        lists
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((l) =>
            h('li', { className: 'card' }, h('a', { href: `#list=${encodeURIComponent(l.id)}` }, l.name), h('p', { className: 'muted' }, countText(l))),
          ),
      ),
    );
  }

  async function save(list: ShoppingList, message: string): Promise<boolean> {
    try {
      const stored = await storage.saveShoppingList(list);
      opts.announce(message);
      opts.openList(stored.id);
      return true;
    } catch (e) {
      opts.announce(storageErrorMessage(e));
      return false;
    }
  }

  async function createEmpty(): Promise<void> {
    const name = await promptDialog({ title: 'New shopping list', label: 'List name', value: 'Shopping list', confirmLabel: 'Create list' });
    if (!name) return;
    await save({ id: uid(), name, aisles: ['Other'], items: [], revision: 0 }, `List "${name}" created.`);
  }

  async function createFromRecipes(): Promise<void> {
    let recipes: RecipeV1[];
    try {
      recipes = (await storage.listRecipes()).slice().sort((a, b) => a.title.localeCompare(b.title));
    } catch (e) {
      opts.announce(storageErrorMessage(e));
      return;
    }
    openRecipePicker(recipes, opts.unitSystem, async (name, entries) => {
      const list = newListFromRecipes(name, entries, opts.unitSystem);
      return save(list, `List "${name}" created with ${list.items.length} items.`);
    });
  }

  clear(container);
  container.appendChild(root);
  void load();
  return () => {
    disposed = true;
    root.remove();
  };
}

/**
 * Dialog: choose recipes (multi-select) with a scale factor each and a list name.
 * `onCreate` returns true when the list was saved (dialog closes), false to stay open.
 */
export function openRecipePicker(
  recipes: RecipeV1[],
  _system: UnitSystem,
  onCreate: (name: string, entries: { recipe: RecipeV1; factor: Rational }[]) => Promise<boolean>,
): void {
  const nameInput = h('input', { id: 'rp-newlist-name', type: 'text', value: 'Shopping list' });
  const error = h('div', { className: 'notice error', role: 'alert', hidden: true });
  const rows: { recipe: RecipeV1; cb: HTMLInputElement; factor: HTMLInputElement }[] = [];
  const fieldset = h('fieldset', { className: 'recipe-picker' }, h('legend', {}, 'Recipes to include'));
  if (recipes.length === 0) {
    fieldset.appendChild(h('p', { className: 'muted' }, 'No saved recipes yet. Save a recipe first, or create an empty list.'));
  }
  recipes.forEach((recipe, i) => {
    const cbId = `rp-pick-${i}`;
    const fId = `rp-pick-f-${i}`;
    const cb = h('input', { type: 'checkbox', id: cbId });
    const factor = h('input', { type: 'text', id: fId, value: '1', inputmode: 'decimal', size: 5, 'aria-describedby': 'rp-pick-hint' });
    rows.push({ recipe, cb, factor });
    fieldset.appendChild(
      h(
        'div',
        { className: 'picker-row' },
        h('span', { className: 'check-row' }, cb, h('label', { for: cbId }, recipe.title || 'Untitled recipe')),
        h('span', { className: 'factor' }, h('label', { for: fId }, `Scale for ${recipe.title || 'untitled recipe'}`), factor),
      ),
    );
  });

  openDialog({
    title: 'New list from recipes',
    className: 'rp-picker',
    build: (close) => {
      const create = async (): Promise<void> => {
        const problems: string[] = [];
        const name = nameInput.value.trim();
        if (!name) problems.push('Enter a list name.');
        const entries: { recipe: RecipeV1; factor: Rational }[] = [];
        for (const r of rows) {
          r.factor.removeAttribute('aria-invalid');
          if (!r.cb.checked) continue;
          const f = r.factor.value.trim() === '1' ? rational(1) : parseServingsInput(r.factor.value);
          if (!f) {
            r.factor.setAttribute('aria-invalid', 'true');
            problems.push(`Scale for "${r.recipe.title}" must be a number greater than 0, like 1, 2 or 1 1/2.`);
            continue;
          }
          entries.push({ recipe: r.recipe, factor: f });
        }
        if (!problems.length && entries.length === 0) problems.push('Select at least one recipe.');
        if (problems.length) {
          clear(error);
          error.appendChild(h('ul', {}, problems.map((p) => h('li', {}, p))));
          error.hidden = false;
          return;
        }
        error.hidden = true;
        let ok = false;
        try {
          ok = await onCreate(name, entries);
        } catch (e) {
          clear(error);
          error.appendChild(h('p', {}, storageErrorMessage(e)));
          error.hidden = false;
        }
        if (ok) close();
      };
      return {
        body: [
          h('div', { className: 'field' }, h('label', { for: 'rp-newlist-name' }, 'List name'), nameInput),
          h('p', { id: 'rp-pick-hint', className: 'hint muted' }, 'Scale: 1 = as written, 2 = double, 1/2 = half. Matching ingredients are combined only when they are clearly the same.'),
          fieldset,
          error,
        ],
        actions: [
          h('button', { type: 'button', onclick: () => close() }, 'Cancel'),
          h('button', { type: 'button', className: 'primary', onclick: () => void create() }, 'Create list'),
        ],
        initialFocus: nameInput,
      };
    },
  });
}

/** Dialog: add one recipe (at the given factor) to an existing or new list. */
export async function openAddToList(
  recipe: RecipeV1,
  factor: Rational,
  system: UnitSystem,
  announce: (msg: string) => void,
): Promise<void> {
  let lists: ShoppingList[];
  try {
    lists = await storage.listShoppingLists();
  } catch (e) {
    announce(storageErrorMessage(e));
    return;
  }
  const select = h(
    'select',
    { id: 'rp-addto-list' },
    h('option', { value: '' }, 'New list'),
    lists.map((l) => h('option', { value: l.id }, l.name)),
  );
  const nameInput = h('input', { id: 'rp-addto-name', type: 'text', value: 'Shopping list' });
  const nameField = h('div', { className: 'field' }, h('label', { for: 'rp-addto-name' }, 'New list name'), nameInput);
  select.addEventListener('change', () => (nameField.hidden = select.value !== ''));
  const error = h('p', { className: 'field-error', role: 'alert', hidden: true });

  openDialog({
    title: 'Add to shopping list',
    build: (close) => {
      const add = async (): Promise<void> => {
        try {
          let list: ShoppingList;
          if (select.value) {
            const existing = lists.find((l) => l.id === select.value);
            if (!existing) throw new Error('List not found');
            list = appendToList(existing, [{ recipe, factor }], system);
          } else {
            const name = nameInput.value.trim();
            if (!name) {
              error.textContent = 'Enter a name for the new list.';
              error.hidden = false;
              nameInput.focus();
              return;
            }
            list = newListFromRecipes(name, [{ recipe, factor }], system);
          }
          await storage.saveShoppingList(list);
          announce(`Added ingredients from "${recipe.title}" to "${list.name}". Open Shopping lists to view it.`);
          close();
        } catch (e) {
          error.textContent = storageErrorMessage(e);
          error.hidden = false;
        }
      };
      return {
        body: [
          h('p', {}, `Ingredients from "${recipe.title}" are added at the current servings and units.`),
          h('div', { className: 'field' }, h('label', { for: 'rp-addto-list' }, 'Shopping list'), select),
          nameField,
          error,
        ],
        actions: [
          h('button', { type: 'button', onclick: () => close() }, 'Cancel'),
          h('button', { type: 'button', className: 'primary', onclick: () => void add() }, 'Add ingredients'),
        ],
        initialFocus: select,
      };
    },
  });
}
