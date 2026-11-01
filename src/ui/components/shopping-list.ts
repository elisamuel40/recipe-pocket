/**
 * Shopping list editor (PRD R09). Owner: UI owner B.
 * Items grouped by editable aisles; check/uncheck, manual entries, move
 * between aisles, delete, clear checked, print, copy as plain text.
 * Source association stays visible ("from: Recipe title").
 */
import { clear, h, uid } from '../../shared/dom';
import type { ShoppingItem, ShoppingList } from '../../shared/types';
import * as storage from '../../storage/index';
import { defaultAisle } from '../../domain/index';
import {
  confirmDialog,
  errorCode,
  focusKey,
  promptDialog,
  SESSION_ONLY_MESSAGE,
  storageErrorMessage,
} from './collection-dialogs';

export interface ShoppingListEditorOptions {
  /** Session-only: edits other than checking are blocked; checks stay in memory. */
  readOnly: boolean;
  announce: (msg: string) => void;
  onDeleted: () => void;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const FALLBACK_AISLE = 'Other';

/** Every item aisle appears in list.aisles (appended in first-seen order). */
export function normalizeAisles(list: ShoppingList): ShoppingList {
  const aisles = list.aisles.filter((a, i) => a && list.aisles.indexOf(a) === i);
  for (const item of list.items) {
    if (!item.aisle) item.aisle = FALLBACK_AISLE;
    if (!aisles.includes(item.aisle)) aisles.push(item.aisle);
  }
  return { ...list, aisles };
}

export function sourceText(item: ShoppingItem): string {
  if (item.manual || item.sources.length === 0) return 'Added by you';
  const titles = Array.from(new Set(item.sources.map((s) => s.recipeTitle || 'Untitled recipe')));
  return `from: ${titles.join('; ')}`;
}

/** Plain-text rendering for the clipboard. */
export function shoppingListToText(list: ShoppingList): string {
  const out: string[] = [list.name, ''];
  const n = normalizeAisles(clone(list));
  for (const aisle of n.aisles) {
    const items = n.items.filter((i) => i.aisle === aisle);
    if (items.length === 0) continue;
    out.push(aisle);
    for (const i of items) {
      const src = i.manual || i.sources.length === 0 ? '' : ` (${sourceText(i)})`;
      out.push(`${i.checked ? '[x]' : '[ ]'} ${i.text}${src}`);
    }
    out.push('');
  }
  return out.join('\n').trimEnd() + '\n';
}

export function mountShoppingListEditor(container: HTMLElement, initial: ShoppingList, opts: ShoppingListEditorOptions): () => void {
  let list = normalizeAisles(clone(initial));
  let disposed = false;
  let chain: Promise<void> = Promise.resolve();
  const root = h('div', { className: 'shopping-editor' });
  const blocked = (): boolean => {
    if (opts.readOnly) opts.announce(SESSION_ONLY_MESSAGE);
    return opts.readOnly;
  };

  /** Serialize saves so each uses the latest revision. On failure, reload the stored list. */
  function persist(): void {
    if (opts.readOnly) return;
    chain = chain.then(async () => {
      if (disposed) return;
      try {
        const stored = await storage.saveShoppingList(clone(list));
        list.revision = stored.revision;
      } catch (e) {
        const msg =
          errorCode(e) === 'CONFLICT'
            ? 'This list was changed in another tab or window. The latest version is shown; your last change was not saved.'
            : `${storageErrorMessage(e)} The saved version of the list is shown.`;
        opts.announce(msg);
        try {
          const fresh = await storage.getShoppingList(list.id);
          if (fresh && !disposed) {
            list = normalizeAisles(clone(fresh));
            render();
          }
        } catch {
          /* keep in-memory state; message already shown */
        }
      }
    });
  }

  function update(mutator: () => void, message: string, focus?: string | string[]): void {
    mutator();
    list = normalizeAisles(list);
    render(focus);
    opts.announce(message);
    persist();
  }

  const aisleSelect = (id: string, selected: string, label: string, auto: boolean, key?: string): HTMLSelectElement => {
    const sel = h(
      'select',
      { id, 'aria-label': label, 'data-key': key ?? null },
      auto ? h('option', { value: '' }, 'Choose automatically') : null,
      list.aisles.map((a) => h('option', { value: a, selected: a === selected }, a)),
    );
    sel.value = selected;
    return sel;
  };

  function renderItem(item: ShoppingItem): HTMLElement {
    const cbId = `rp-si-${item.id}`;
    const cb = h('input', { type: 'checkbox', id: cbId, 'data-key': `si-check:${item.id}`, checked: item.checked });
    cb.checked = item.checked;
    cb.addEventListener('change', () => {
      item.checked = cb.checked;
      render(`si-check:${item.id}`);
      opts.announce(`${item.text} ${item.checked ? 'checked' : 'unchecked'}.${opts.readOnly ? ' Not saved: session-only mode.' : ''}`);
      persist();
    });
    const sel = aisleSelect(`rp-si-aisle-${item.id}`, item.aisle, `Aisle for ${item.text}`, false, `si-aisle:${item.id}`);
    sel.addEventListener('change', () => {
      if (blocked()) {
        sel.value = item.aisle;
        return;
      }
      const to = sel.value;
      update(() => (item.aisle = to), `${item.text} moved to ${to}.`, `si-aisle:${item.id}`);
    });
    return h(
      'li',
      { className: `shopping-item${item.checked ? ' is-checked' : ''}` },
      h(
        'div',
        { className: 'shopping-item-main' },
        cb,
        h('label', { for: cbId }, h('span', { className: 'item-text' }, item.text), item.checked ? h('span', { className: 'visually-hidden' }, ' (checked)') : null),
      ),
      h('p', { className: 'item-source muted' }, sourceText(item)),
      h(
        'div',
        { className: 'shopping-item-actions no-print' },
        sel,
        h(
          'button',
          {
            type: 'button',
            'aria-label': `Delete ${item.text}`,
            'aria-disabled': opts.readOnly ? 'true' : null,
            onclick: () => {
              if (blocked()) return;
              const idx = list.items.indexOf(item);
              const next = list.items[idx + 1] ?? list.items[idx - 1];
              update(() => list.items.splice(idx, 1), `${item.text} deleted.`, next ? `si-check:${next.id}` : 'add-text');
            },
          },
          'Delete',
        ),
      ),
    );
  }

  function renderAisleEditor(): HTMLDetailsElement {
    const ol = h('ol', { className: 'aisle-list' });
    list.aisles.forEach((aisle, i) => {
      const inputId = `rp-aisle-${i}`;
      const count = list.items.filter((it) => it.aisle === aisle).length;
      const input = h('input', { id: inputId, type: 'text', 'data-key': `aisle-name:${aisle}` });
      input.value = aisle;
      const rename = (): void => {
        const name = input.value.trim().replace(/\s+/g, ' ');
        if (name === aisle) return;
        if (blocked()) {
          input.value = aisle;
          return;
        }
        if (!name) {
          opts.announce('Enter a name for the aisle.');
          input.value = aisle;
          return;
        }
        if (list.aisles.some((a) => a !== aisle && a.toLowerCase() === name.toLowerCase())) {
          opts.announce(`An aisle named "${name}" already exists. Move items there instead, then remove this aisle.`);
          input.value = aisle;
          return;
        }
        update(
          () => {
            list.aisles[i] = name;
            for (const it of list.items) if (it.aisle === aisle) it.aisle = name;
          },
          `Aisle renamed to ${name}.`,
          `aisle-name:${name}`,
        );
      };
      input.addEventListener('change', rename);
      input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          rename();
        }
      });
      const moveAisle = (dir: -1 | 1): void => {
        if (blocked()) return;
        const j = i + dir;
        if (j < 0 || j >= list.aisles.length) return;
        update(
          () => {
            list.aisles.splice(i, 1);
            list.aisles.splice(j, 0, aisle);
          },
          `${aisle} moved to position ${j + 1} of ${list.aisles.length}.`,
          dir < 0 ? [`aisle-up:${aisle}`, `aisle-down:${aisle}`] : [`aisle-down:${aisle}`, `aisle-up:${aisle}`],
        );
      };
      ol.appendChild(
        h(
          'li',
          { className: 'aisle-row' },
          h('label', { for: inputId, className: 'visually-hidden' }, `Name of aisle ${i + 1}`),
          input,
          h('span', { className: 'muted' }, `${count} ${count === 1 ? 'item' : 'items'}`),
          h('button', { type: 'button', className: 'icon-btn', 'data-key': `aisle-up:${aisle}`, 'aria-label': `Move aisle ${aisle} up`, disabled: i === 0, onclick: () => moveAisle(-1) }, '↑'),
          h('button', { type: 'button', className: 'icon-btn', 'data-key': `aisle-down:${aisle}`, 'aria-label': `Move aisle ${aisle} down`, disabled: i === list.aisles.length - 1, onclick: () => moveAisle(1) }, '↓'),
          h(
            'button',
            {
              type: 'button',
              'aria-label': `Remove aisle ${aisle}`,
              onclick: () => {
                if (blocked()) return;
                const others = list.aisles.filter((a) => a !== aisle);
                const target = count === 0 ? null : aisle === FALLBACK_AISLE ? (others[0] ?? null) : FALLBACK_AISLE;
                if (count > 0 && !target) {
                  opts.announce('This is the only aisle and it still has items. Add another aisle first.');
                  return;
                }
                update(
                  () => {
                    list.aisles = others;
                    if (target) {
                      if (!list.aisles.includes(target)) list.aisles.push(target);
                      for (const it of list.items) if (it.aisle === aisle) it.aisle = target;
                    }
                  },
                  target ? `Aisle ${aisle} removed. Its items moved to ${target}.` : `Aisle ${aisle} removed.`,
                  'aisle-add-text',
                );
              },
            },
            'Remove',
          ),
        ),
      );
    });
    const addInput = h('input', { id: 'rp-aisle-new', type: 'text', 'data-key': 'aisle-add-text' });
    const addAisle = (): void => {
      if (blocked()) return;
      const name = addInput.value.trim().replace(/\s+/g, ' ');
      if (!name) return opts.announce('Enter a name for the new aisle.');
      if (list.aisles.some((a) => a.toLowerCase() === name.toLowerCase())) return opts.announce(`An aisle named "${name}" already exists.`);
      update(() => list.aisles.push(name), `Aisle ${name} added.`, 'aisle-add-text');
    };
    addInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addAisle();
      }
    });
    const details = h(
      'details',
      { className: 'aisle-editor no-print', 'data-key': 'aisle-details' },
      h('summary', {}, 'Edit aisles'),
      h('p', { className: 'hint muted' }, 'Rename, reorder, add or remove aisles. Items in a removed aisle move to "Other".'),
      ol,
      h('div', { className: 'inline-form' }, h('label', { for: 'rp-aisle-new' }, 'New aisle'), addInput, h('button', { type: 'button', onclick: addAisle }, 'Add aisle')),
    );
    return details;
  }

  let aisleEditorOpen = false;

  function render(focus?: string | string[]): void {
    const detailsWasOpen = root.querySelector<HTMLDetailsElement>('details.aisle-editor')?.open ?? aisleEditorOpen;
    aisleEditorOpen = detailsWasOpen;
    clear(root);
    const checkedCount = list.items.filter((i) => i.checked).length;

    // Add item form
    const addText = h('input', { id: 'rp-add-item', type: 'text', 'data-key': 'add-text', autocomplete: 'off' });
    const addAisleSel = aisleSelect('rp-add-item-aisle', '', 'Aisle for the new item', true);
    const addItem = (): void => {
      if (blocked()) return;
      const text = addText.value.trim();
      if (!text) {
        opts.announce('Type an item to add.');
        addText.focus();
        return;
      }
      const aisle = addAisleSel.value || safeDefaultAisle(text);
      update(
        () => list.items.push({ id: uid(), text, aisle, checked: false, manual: true, sources: [] }),
        `${text} added to ${aisle}.`,
        'add-text',
      );
    };
    addText.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addItem();
      }
    });

    const ro = opts.readOnly ? 'true' : null;
    root.append(
      h('h1', { id: 'rp-list-title', tabindex: '-1' }, list.name),
      h('p', { className: 'muted', 'data-testid': 'list-summary' }, `${list.items.length} ${list.items.length === 1 ? 'item' : 'items'}, ${checkedCount} checked`),
      h(
        'div',
        { className: 'toolbar no-print' },
        h('button', { type: 'button', onclick: () => window.print() }, 'Print list'),
        h('button', { type: 'button', onclick: () => void copyText() }, 'Copy as text'),
        h('button', { type: 'button', 'aria-disabled': ro, onclick: () => void rename() }, 'Rename list'),
        h('button', { type: 'button', 'aria-disabled': ro, disabled: checkedCount === 0 && !opts.readOnly, onclick: () => void clearChecked() }, 'Clear checked items'),
        h('button', { type: 'button', className: 'danger', 'aria-disabled': ro, onclick: () => void deleteList() }, 'Delete list'),
      ),
      h(
        'section',
        { className: 'add-item no-print', 'aria-labelledby': 'rp-add-item-h' },
        h('h2', { id: 'rp-add-item-h' }, 'Add an item'),
        h(
          'div',
          { className: 'inline-form' },
          h('label', { for: 'rp-add-item' }, 'Item'),
          addText,
          h('label', { for: 'rp-add-item-aisle' }, 'Aisle'),
          addAisleSel,
          h('button', { type: 'button', className: 'primary', 'aria-disabled': ro, onclick: addItem }, 'Add item'),
        ),
      ),
    );

    const fallback = h('pre', { className: 'copy-fallback', hidden: true, tabindex: '0', 'aria-label': 'Shopping list as text' });
    if (list.items.length === 0) {
      root.appendChild(h('p', { className: 'empty-state' }, 'This list is empty. Add items above, or create a list from recipes.'));
    }
    for (const aisle of list.aisles) {
      const items = list.items.filter((i) => i.aisle === aisle);
      if (items.length === 0) continue;
      const hid = `rp-aisle-h-${list.aisles.indexOf(aisle)}`;
      root.appendChild(
        h(
          'section',
          { className: 'aisle', 'aria-labelledby': hid },
          h('h2', { id: hid }, aisle, h('span', { className: 'muted' }, ` (${items.length})`)),
          h('ul', { className: 'shopping-items' }, items.map(renderItem)),
        ),
      );
    }
    const details = renderAisleEditor();
    details.open = aisleEditorOpen;
    details.addEventListener('toggle', () => (aisleEditorOpen = details.open));
    root.append(details, fallback);
    if (focus) {
      const keys = Array.isArray(focus) ? focus : [focus];
      if (!keys.some((k) => focusKey(root, k))) root.querySelector<HTMLElement>('h1')?.focus();
    }
  }

  function safeDefaultAisle(text: string): string {
    try {
      const a = defaultAisle(text);
      return a || FALLBACK_AISLE;
    } catch {
      return FALLBACK_AISLE;
    }
  }

  async function copyText(): Promise<void> {
    const text = shoppingListToText(list);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      opts.announce('Shopping list copied as plain text.');
    } catch {
      const pre = root.querySelector<HTMLElement>('pre.copy-fallback');
      if (pre) {
        pre.textContent = text;
        pre.hidden = false;
        pre.focus();
      }
      opts.announce('Copying was blocked by the browser. The list is shown as text below; select it and copy.');
    }
  }

  async function rename(): Promise<void> {
    if (blocked()) return;
    const name = await promptDialog({ title: 'Rename list', label: 'List name', value: list.name, confirmLabel: 'Rename' });
    if (!name || name === list.name) return;
    update(() => (list.name = name), `List renamed to ${name}.`);
  }

  async function clearChecked(): Promise<void> {
    if (blocked()) return;
    const n = list.items.filter((i) => i.checked).length;
    if (n === 0) return opts.announce('No checked items to clear.');
    const ok = await confirmDialog({
      title: `Remove ${n} checked ${n === 1 ? 'item' : 'items'}?`,
      message: ['Checked items are removed from this list. Unchecked items stay.'],
      confirmLabel: `Remove ${n} checked ${n === 1 ? 'item' : 'items'}`,
      danger: true,
    });
    if (!ok) return;
    update(() => (list.items = list.items.filter((i) => !i.checked)), `${n} checked ${n === 1 ? 'item' : 'items'} removed.`, 'add-text');
  }

  async function deleteList(): Promise<void> {
    if (blocked()) return;
    const ok = await confirmDialog({
      title: `Delete list "${list.name}"?`,
      message: [`This deletes the list and its ${list.items.length} items from this device. Your recipes are not affected.`],
      confirmLabel: 'Delete list',
      danger: true,
    });
    if (!ok) return;
    try {
      await chain;
      await storage.deleteShoppingList(list.id);
      opts.announce(`List "${list.name}" deleted.`);
      opts.onDeleted();
    } catch (e) {
      opts.announce(storageErrorMessage(e));
    }
  }

  clear(container);
  container.appendChild(root);
  render();
  return () => {
    disposed = true;
    root.remove();
  };
}
