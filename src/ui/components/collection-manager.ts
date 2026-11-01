/**
 * Collections manager dialog (PRD R03): create, rename, delete.
 * Owner: UI owner B. Deleting a collection keeps its recipes (storage removes
 * the collection id from every recipe in one transaction).
 */
import { clear, h, uid } from '../../shared/dom';
import type { Collection } from '../../shared/types';
import * as storage from '../../storage/index';
import { confirmDialog, focusKey, openDialog, SESSION_ONLY_MESSAGE, storageErrorMessage } from './collection-dialogs';

export interface CollectionManagerOptions {
  readOnly: boolean;
  announce: (msg: string) => void;
  onChange: () => void;
}

export function openCollectionManager(opts: CollectionManagerOptions): void {
  let collections: Collection[] = [];
  const listWrap = h('div', { className: 'collection-list' }, h('p', { className: 'muted' }, 'Loading…'));
  const error = h('p', { className: 'field-error', role: 'alert', hidden: true });
  const newInput = h('input', { id: 'rp-new-collection', type: 'text', autocomplete: 'off' });
  const addBtn = h('button', { type: 'button', className: 'primary', 'data-key': 'col-add' }, 'Add collection');

  const showError = (msg: string | null): void => {
    error.textContent = msg ?? '';
    error.hidden = !msg;
  };
  const duplicate = (name: string, exceptId?: string): boolean =>
    collections.some((c) => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase());

  async function reload(focus?: string): Promise<void> {
    try {
      collections = (await storage.listCollections()).slice().sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      showError(storageErrorMessage(e));
      return;
    }
    render();
    if (focus) focusKey(dlg.dialog, focus);
  }

  function render(): void {
    clear(listWrap);
    if (collections.length === 0) {
      listWrap.appendChild(h('p', { className: 'muted' }, 'No collections yet.'));
      return;
    }
    const ul = h('ul', { className: 'plain-list' });
    for (const c of collections) {
      const inputId = `rp-col-${c.id}`;
      const input = h('input', { id: inputId, type: 'text', 'data-key': `col-name:${c.id}`, readonly: opts.readOnly });
      input.value = c.name;
      const rename = async (): Promise<void> => {
        if (opts.readOnly) return showError(SESSION_ONLY_MESSAGE);
        const name = input.value.trim();
        if (!name) return showError('Enter a name for the collection.');
        if (name === c.name) return;
        if (duplicate(name, c.id)) return showError(`A collection named "${name}" already exists.`);
        try {
          await storage.saveCollection({ id: c.id, name });
          showError(null);
          opts.announce(`Collection renamed to "${name}".`);
          opts.onChange();
          await reload(`col-name:${c.id}`);
        } catch (e) {
          showError(storageErrorMessage(e));
        }
      };
      input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void rename();
        }
      });
      ul.appendChild(
        h(
          'li',
          { className: 'collection-row' },
          h('label', { for: inputId, className: 'visually-hidden' }, `Name of collection ${c.name}`),
          input,
          h('button', { type: 'button', 'aria-label': `Rename collection ${c.name}`, onclick: () => void rename() }, 'Rename'),
          h(
            'button',
            {
              type: 'button',
              className: 'danger',
              'aria-label': `Delete collection ${c.name}`,
              onclick: async () => {
                if (opts.readOnly) return showError(SESSION_ONLY_MESSAGE);
                const ok = await confirmDialog({
                  title: `Delete collection "${c.name}"?`,
                  message: ['The recipes stay in your library. They are only removed from this collection.'],
                  confirmLabel: 'Delete collection',
                  danger: true,
                });
                if (!ok) return;
                try {
                  await storage.deleteCollection(c.id);
                  showError(null);
                  opts.announce(`Collection "${c.name}" deleted.`);
                  opts.onChange();
                  await reload('col-add');
                } catch (e) {
                  showError(storageErrorMessage(e));
                }
              },
            },
            'Delete',
          ),
        ),
      );
    }
    listWrap.appendChild(ul);
  }

  async function add(): Promise<void> {
    if (opts.readOnly) return showError(SESSION_ONLY_MESSAGE);
    const name = newInput.value.trim();
    if (!name) {
      showError('Enter a name for the new collection.');
      newInput.focus();
      return;
    }
    if (duplicate(name)) {
      showError(`A collection named "${name}" already exists.`);
      newInput.focus();
      return;
    }
    try {
      await storage.saveCollection({ id: uid(), name });
      newInput.value = '';
      showError(null);
      opts.announce(`Collection "${name}" created.`);
      opts.onChange();
      await reload();
      newInput.focus();
    } catch (e) {
      showError(storageErrorMessage(e));
    }
  }
  addBtn.addEventListener('click', () => void add());
  newInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void add();
    }
  });

  const dlg = openDialog({
    title: 'Collections',
    className: 'rp-collections',
    build: (close) => ({
      body: [
        opts.readOnly ? h('p', { className: 'notice warn' }, SESSION_ONLY_MESSAGE) : '',
        listWrap,
        h('div', { className: 'field' }, h('label', { for: 'rp-new-collection' }, 'New collection name'), newInput),
        addBtn,
        error,
      ],
      actions: [h('button', { type: 'button', onclick: () => close() }, 'Close')],
      initialFocus: newInput,
    }),
  });
  void reload();
}
