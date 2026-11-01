/**
 * "Add to shopping list" picker for the reader: choose an existing list or
 * create one. Works for unsaved drafts: item sources reference the draft id/title.
 */
import { h } from '../../shared/dom';
import type { RecipeV1, ShoppingItem, ShoppingList, UnitSystem } from '../../shared/types';
import { buildShoppingItems, type Rational } from '../../domain/index';
import { listShoppingLists, saveShoppingList } from '../../storage/index';
import { storageErrorMessage } from '../common/prefs';
import { notice } from '../common/status';
import { plural } from '../common/format';

export interface AddToListOptions {
  recipe: RecipeV1;
  factor: Rational;
  system: UnitSystem;
  onDone: (result: { list: ShoppingList; added: number }) => void;
  onCancel: () => void;
}

/** Append new items to a list (new items are kept separate; aisles are unioned). Pure. */
export function appendItems(list: ShoppingList, items: ShoppingItem[]): ShoppingList {
  const aisles = [...list.aisles];
  for (const it of items) if (it.aisle && !aisles.includes(it.aisle)) aisles.push(it.aisle);
  return { ...list, aisles, items: [...list.items, ...items] };
}

export function newList(name: string, items: ShoppingItem[]): ShoppingList {
  return appendItems({ id: crypto.randomUUID(), name, aisles: [], items: [], revision: 0 }, items);
}

export function mountAddToList(container: HTMLElement, opts: AddToListOptions): () => void {
  const groupName = `list-${Math.random().toString(36).slice(2)}`;
  const legendId = `${groupName}-legend`;
  const status = h('div', { className: 'add-list-status' });
  const choices = h('div', { className: 'radio-list' }, h('p', { className: 'muted' }, 'Loading your lists…'));
  const nameId = `${groupName}-name`;
  const nameInput = h('input', { id: nameId, type: 'text', value: 'Shopping list', autocomplete: 'off', maxlength: 100 });
  const newRadio = h('input', { type: 'radio', name: groupName, value: '__new', id: `${groupName}-new`, checked: true });
  const submit = h('button', { type: 'submit', className: 'primary' }, 'Add ingredients');
  const cancel = h('button', { type: 'button', onclick: () => opts.onCancel() }, 'Cancel');
  let lists: ShoppingList[] = [];
  let busy = false;

  const form = h(
    'form',
    { className: 'add-to-list panel-card', 'aria-labelledby': legendId },
    h('h3', { id: legendId }, 'Add to shopping list'),
    h(
      'fieldset',
      {},
      h('legend', {}, 'Choose a list'),
      choices,
      h(
        'div',
        { className: 'radio-row' },
        newRadio,
        h('label', { for: newRadio.id }, 'New list'),
      ),
      h('div', { className: 'stacked-field' }, h('label', { for: nameId }, 'New list name'), nameInput),
    ),
    status,
    h('div', { className: 'button-row' }, submit, cancel),
  );
  nameInput.addEventListener('focus', () => (newRadio.checked = true));

  void listShoppingLists()
    .then((ls) => {
      lists = ls;
      choices.replaceChildren(
        ...ls.map((l) => {
          const id = `${groupName}-${l.id}`;
          return h(
            'div',
            { className: 'radio-row' },
            h('input', { type: 'radio', name: groupName, value: l.id, id }),
            h('label', { for: id }, `${l.name} (${plural(l.items.length, 'item')})`),
          );
        }),
      );
      if (!ls.length) choices.replaceChildren(h('p', { className: 'muted' }, 'You have no shopping lists yet.'));
    })
    .catch(() => {
      choices.replaceChildren(h('p', { className: 'muted' }, 'Could not load existing lists. You can still create a new list.'));
    });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) return;
    const chosen = form.querySelector<HTMLInputElement>(`input[name="${groupName}"]:checked`)?.value ?? '__new';
    let items: ShoppingItem[];
    try {
      items = buildShoppingItems([{ recipe: opts.recipe, factor: opts.factor }], opts.system);
    } catch {
      status.replaceChildren(notice('error', 'Could not prepare the ingredients for a shopping list.'));
      return;
    }
    if (!items.length) {
      status.replaceChildren(notice('warn', 'This recipe has no ingredients to add.'));
      return;
    }
    let target: ShoppingList;
    if (chosen === '__new') {
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.setAttribute('aria-invalid', 'true');
        status.replaceChildren(notice('error', 'Enter a name for the new list.'));
        nameInput.focus();
        return;
      }
      target = newList(name, items);
    } else {
      const existing = lists.find((l) => l.id === chosen);
      if (!existing) return;
      target = appendItems(existing, items);
    }
    busy = true;
    submit.disabled = true;
    status.replaceChildren(h('p', { className: 'muted' }, 'Adding…'));
    saveShoppingList(target)
      .then((saved) => opts.onDone({ list: saved, added: items.length }))
      .catch((err) => {
        status.replaceChildren(notice('error', storageErrorMessage(err, 'list')));
      })
      .finally(() => {
        busy = false;
        submit.disabled = false;
      });
  });

  container.replaceChildren(form);
  form.querySelector<HTMLElement>('h3')?.setAttribute('tabindex', '-1');
  form.querySelector<HTMLElement>('h3')?.focus();
  return () => form.remove();
}
