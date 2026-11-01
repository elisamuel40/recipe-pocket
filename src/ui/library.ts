/**
 * Library tab (PRD R03, R07, R09, R13). Owner: UI owner B.
 * Deep links: #recipe=<id>, #edit=<id>, #new, #import, #lists, #list=<id>.
 * Unsaved editor changes are never discarded silently (hash changes and tab
 * close ask first). All text through h(); no remote resources.
 */
import { clear, h, uid } from '../shared/dom';
import type { BackupFileV1, Collection, Preferences, RecipeV1, UnitSystem } from '../shared/types';
import { DEFAULT_PREFERENCES } from '../shared/types';
import * as storage from '../storage/index';
import { rational, type Rational } from '../domain/index';
import { applyPreferences } from './common/theme';
import { renderRecipeView, renderScaleControls } from './components/recipe-view';
import { mountTranscriptImport } from './components/transcript-import';
import { emptyRecipe, mountEditor } from './components/editor';
import { openCollectionManager } from './components/collection-manager';
import { mountShoppingLists, openAddToList } from './components/shopping-lists';
import { mountShoppingListEditor } from './components/shopping-list';
import {
  confirmDialog,
  downloadText,
  errorCode,
  sanitizeFilename,
  SESSION_ONLY_MESSAGE,
  storageErrorMessage,
} from './components/collection-dialogs';

type Route =
  | { name: 'recipes' }
  | { name: 'recipe'; id: string }
  | { name: 'edit'; id: string }
  | { name: 'new' }
  | { name: 'import' }
  | { name: 'lists' }
  | { name: 'list'; id: string };

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const [key, ...rest] = raw.split('=');
  const value = decodeURIComponent(rest.join('='));
  switch (key) {
    case 'recipe':
      return value ? { name: 'recipe', id: value } : { name: 'recipes' };
    case 'edit':
      return value ? { name: 'edit', id: value } : { name: 'recipes' };
    case 'new':
      return { name: 'new' };
    case 'import':
      return { name: 'import' };
    case 'lists':
      return { name: 'lists' };
    case 'list':
      return value ? { name: 'list', id: value } : { name: 'lists' };
    default:
      return { name: 'recipes' };
  }
}

/** Host name of a source URL as plain text, or a label for manual recipes. */
export function sourceLabel(r: RecipeV1): string {
  if (!r.source.url) return r.extraction.method === 'transcript' ? 'From a transcript' : 'Your recipe';
  try {
    return new URL(r.source.url).hostname.replace(/^www\./, '');
  } catch {
    return 'Unknown source';
  }
}

/** One-recipe backup file (R10 format) for "Export this recipe". */
export async function singleRecipeBackup(recipe: RecipeV1, collections: Collection[]): Promise<BackupFileV1> {
  const backup: BackupFileV1 = {
    format: 'recipe-pocket-backup',
    version: 1,
    recipes: [recipe],
    collections: collections.filter((c) => recipe.collectionIds.includes(c.id)),
    shoppingLists: [],
  };
  if (recipe.localImageId) {
    try {
      const img = await storage.getImage(recipe.localImageId);
      if (img) backup.images = [{ id: img.id, mime: img.mime, dataUrl: await blobToDataUrl(img.blob) }];
    } catch {
      /* image unavailable: export without it */
    }
  }
  return backup;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

export async function initLibrary(app: HTMLElement): Promise<() => void> {
  let prefs: Preferences = { ...DEFAULT_PREFERENCES };
  try {
    prefs = await storage.getPreferences();
  } catch {
    /* defaults */
  }
  applyPreferences(prefs);
  const readOnly = prefs.sessionOnly;

  // ---------- shell ----------
  const status = h('div', { className: 'visually-hidden', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const toast = h('p', { className: 'status-line', 'aria-hidden': 'true', hidden: true });
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const announce = (msg: string): void => {
    status.textContent = '';
    setTimeout(() => (status.textContent = msg), 30);
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 8000);
  };

  const main = h('main', { id: 'main', tabindex: '-1', className: 'library-main' });
  const navRecipes = h('a', { href: '#', 'data-nav': 'recipes' }, 'Recipes');
  const navLists = h('a', { href: '#lists', 'data-nav': 'lists' }, 'Shopping lists');
  const skip = h('a', { href: '#main', className: 'skip-link' }, 'Skip to content');
  skip.addEventListener('click', (e) => {
    e.preventDefault();
    main.focus();
  });
  const sessionNote = readOnly
    ? h(
        'div',
        { className: 'notice warn session-banner', id: 'rp-session-note', role: 'note' },
        h('strong', {}, 'Session-only mode is on. '),
        'Nothing will be saved on this device: saving, editing, deleting and creating are turned off. Existing recipes can still be viewed, printed and exported. ',
        h('a', { href: 'options.html' }, 'Change in Settings'),
      )
    : null;

  clear(app);
  app.append(
    skip,
    h(
      'header',
      { className: 'library-header' },
      h('p', { className: 'brand' }, 'Recipe Pocket'),
      h('nav', { 'aria-label': 'Library' }, h('ul', {}, h('li', {}, navRecipes), h('li', {}, navLists), h('li', {}, h('a', { href: 'options.html' }, 'Settings')))),
    ),
    ...(sessionNote ? [sessionNote] : []),
    toast,
    main,
    status,
  );

  // ---------- state ----------
  let collections: Collection[] = [];
  let cleanupView: (() => void) | null = null;
  let editorDirty = false;
  let currentHash = location.hash;
  const filters = { query: '', collectionId: '', tag: '' };
  let viewFactor: Rational = rational(1);
  let viewSystem: UnitSystem = prefs.unitSystem;
  let viewRecipeId = '';

  async function refreshCollections(): Promise<void> {
    try {
      collections = (await storage.listCollections()).slice().sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      collections = [];
    }
  }

  /** Button for an action that writes. In session-only mode it stays focusable and explains why it does nothing. */
  function writeButton(label: string, onClick: () => void, attrs: Record<string, string> = {}): HTMLButtonElement {
    const btn = h('button', {
      type: 'button',
      ...attrs,
      'aria-disabled': readOnly ? 'true' : null,
      'aria-describedby': readOnly ? 'rp-session-note' : null,
    }, label);
    btn.addEventListener('click', () => (readOnly ? announce(SESSION_ONLY_MESSAGE) : onClick()));
    return btn;
  }

  function setTitle(t: string): void {
    document.title = `${t} – Recipe Pocket`;
  }

  function markNav(route: Route): void {
    const lists = route.name === 'lists' || route.name === 'list';
    navRecipes.toggleAttribute('aria-current', !lists);
    navLists.toggleAttribute('aria-current', lists);
    if (!lists) navRecipes.setAttribute('aria-current', 'page');
    else navLists.setAttribute('aria-current', 'page');
  }

  function go(hash: string): void {
    if (location.hash === hash || (hash === '#' && location.hash === '')) void render();
    else location.hash = hash;
  }

  async function confirmLeave(): Promise<boolean> {
    if (!editorDirty) return true;
    const ok = await confirmDialog({
      title: 'Discard unsaved changes?',
      message: ['You have changes in the editor that are not saved.'],
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      danger: true,
    });
    if (ok) editorDirty = false;
    return ok;
  }

  const onHashChange = async (): Promise<void> => {
    const target = location.hash;
    if (editorDirty) {
      // Restore the editor's URL first, then ask.
      history.replaceState(null, '', currentHash || location.pathname);
      if (!(await confirmLeave())) return;
      history.replaceState(null, '', target || location.pathname);
    }
    void render();
  };
  const onBeforeUnload = (e: BeforeUnloadEvent): void => {
    if (editorDirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  window.addEventListener('hashchange', onHashChange);
  window.addEventListener('beforeunload', onBeforeUnload);

  async function render(): Promise<void> {
    currentHash = location.hash;
    cleanupView?.();
    cleanupView = null;
    editorDirty = false;
    clear(main);
    const route = parseRoute(location.hash);
    markNav(route);
    await refreshCollections();
    switch (route.name) {
      case 'recipes':
        return renderList();
      case 'recipe':
        return renderDetail(route.id);
      case 'edit':
        return renderEdit(route.id);
      case 'new':
        return renderNew(emptyRecipe(), null);
      case 'import':
        return renderImport();
      case 'lists':
        setTitle('Shopping lists');
        cleanupView = mountShoppingLists(main, { readOnly, unitSystem: prefs.unitSystem, announce, openList: (id) => go(`#list=${encodeURIComponent(id)}`) });
        return;
      case 'list':
        return renderShoppingList(route.id);
    }
  }

  // ---------- recipe list ----------
  async function renderList(): Promise<void> {
    setTitle('Library');
    let all: RecipeV1[] = [];
    let loadError: unknown = null;
    try {
      all = await storage.listRecipes();
    } catch (e) {
      loadError = e;
    }
    const tags = Array.from(new Set(all.flatMap((r) => r.tags))).sort((a, b) => a.localeCompare(b));
    if (filters.collectionId && !collections.some((c) => c.id === filters.collectionId)) filters.collectionId = '';
    if (filters.tag && !tags.includes(filters.tag)) filters.tag = '';

    const search = h('input', { id: 'rp-search', type: 'search', autocomplete: 'off', 'aria-describedby': 'rp-search-hint' });
    search.value = filters.query;
    const colSel = h(
      'select',
      { id: 'rp-filter-collection' },
      h('option', { value: '' }, 'All collections'),
      collections.map((c) => h('option', { value: c.id }, c.name)),
    );
    colSel.value = filters.collectionId;
    const tagSel = h('select', { id: 'rp-filter-tag' }, h('option', { value: '' }, 'All tags'), tags.map((t) => h('option', { value: t }, t)));
    tagSel.value = filters.tag;
    const count = h('p', { className: 'result-count', 'aria-live': 'polite' });
    const results = h('div', { className: 'results' });

    main.append(
      h('h1', {}, 'Recipes'),
      h(
        'div',
        { className: 'toolbar' },
        writeButton('New recipe', () => go('#new'), { className: 'primary' }),
        writeButton('Import transcript', () => go('#import')),
        h('button', { type: 'button', onclick: () => openCollectionManager({ readOnly, announce, onChange: () => void render() }) }, 'Manage collections'),
      ),
    );

    if (loadError) {
      main.appendChild(h('p', { className: 'notice error', role: 'alert' }, `Your recipes could not be loaded. ${storageErrorMessage(loadError)}`));
      return;
    }
    if (all.length === 0) {
      main.appendChild(
        h(
          'section',
          { className: 'empty-state', 'aria-labelledby': 'rp-empty-h' },
          h('h2', { id: 'rp-empty-h' }, 'Your library is empty'),
          h('p', {}, 'To save a recipe from the web:'),
          h(
            'ol',
            {},
            h('li', {}, 'Open a recipe page in a Chrome tab.'),
            h('li', {}, 'Click the Recipe Pocket icon in the toolbar. The recipe opens in the side panel.'),
            h('li', {}, 'Select Save. The recipe is stored only on this device.'),
          ),
          h('p', {}, 'You can also select "New recipe" to type one in, or "Import transcript" to start from video captions.'),
        ),
      );
      return;
    }

    main.append(
      h(
        'form',
        { className: 'filters', role: 'search', 'aria-label': 'Search recipes', onsubmit: (e: Event) => e.preventDefault() },
        h('div', { className: 'field' }, h('label', { for: 'rp-search' }, 'Search'), h('p', { id: 'rp-search-hint', className: 'hint muted' }, 'Matches titles, tags and ingredients.'), search),
        h('div', { className: 'field' }, h('label', { for: 'rp-filter-collection' }, 'Collection'), colSel),
        h('div', { className: 'field' }, h('label', { for: 'rp-filter-tag' }, 'Tag'), tagSel),
      ),
      count,
      results,
    );

    let seq = 0;
    const run = async (): Promise<void> => {
      const mine = ++seq;
      let found: RecipeV1[];
      try {
        found = await storage.searchRecipes({
          query: filters.query.trim() || undefined,
          collectionId: filters.collectionId || undefined,
          tag: filters.tag || undefined,
        });
      } catch (e) {
        if (mine !== seq) return;
        clear(results);
        results.appendChild(h('p', { className: 'notice error' }, storageErrorMessage(e)));
        return;
      }
      if (mine !== seq || !results.isConnected) return;
      clear(results);
      count.textContent = `${found.length} ${found.length === 1 ? 'recipe' : 'recipes'}${filters.query || filters.collectionId || filters.tag ? ' found' : ''}`;
      if (found.length === 0) {
        results.appendChild(h('p', { className: 'empty-state' }, 'No recipes match. Try other words or clear the filters.'));
        return;
      }
      results.appendChild(
        h(
          'ul',
          { className: 'card-list recipe-list' },
          found.map((r) =>
            h(
              'li',
              { className: 'card' },
              h('a', { href: `#recipe=${encodeURIComponent(r.id)}`, className: 'card-title' }, r.title || 'Untitled recipe'),
              h('p', { className: 'muted card-meta' }, sourceLabel(r)),
              r.tags.length ? h('p', { className: 'tags' }, h('span', { className: 'visually-hidden' }, 'Tags: '), r.tags.map((t) => h('span', { className: 'tag' }, t))) : null,
            ),
          ),
        ),
      );
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    search.addEventListener('input', () => {
      filters.query = search.value;
      clearTimeout(timer);
      timer = setTimeout(() => void run(), 200);
    });
    colSel.addEventListener('change', () => {
      filters.collectionId = colSel.value;
      void run();
    });
    tagSel.addEventListener('change', () => {
      filters.tag = tagSel.value;
      void run();
    });
    cleanupView = () => clearTimeout(timer);
    await run();
  }

  // ---------- detail ----------
  async function renderDetail(id: string): Promise<void> {
    let recipe: RecipeV1 | undefined;
    try {
      recipe = await storage.getRecipe(id);
    } catch (e) {
      main.appendChild(h('p', { className: 'notice error', role: 'alert' }, storageErrorMessage(e)));
      return;
    }
    if (!recipe) {
      setTitle('Recipe not found');
      main.append(
        h('h1', {}, 'Recipe not found'),
        h('p', {}, 'This recipe is not in your library. It may have been deleted.'),
        h('a', { href: '#' }, 'Back to all recipes'),
      );
      return;
    }
    const r = recipe;
    setTitle(r.title || 'Untitled recipe');
    if (viewRecipeId !== r.id) {
      viewRecipeId = r.id;
      viewFactor = rational(1);
      viewSystem = prefs.unitSystem;
    }
    let objectUrl: string | null = null;
    const viewHost = h('div', { className: 'recipe-view-host' });
    const imageHost = h('div', { className: 'recipe-image' });
    const colNames = collections.filter((c) => r.collectionIds.includes(c.id)).map((c) => c.name);
    const controls = renderScaleControls(r, {
      factor: viewFactor,
      system: viewSystem,
      onChange: ({ factor, system }) => {
        viewFactor = factor;
        viewSystem = system;
        paint();
      },
    });
    const meta = h(
      'div',
      { className: 'detail-meta' },
      r.tags.length ? h('p', {}, h('strong', {}, 'Tags: '), r.tags.join(', ')) : null,
      colNames.length ? h('p', {}, h('strong', {}, 'Collections: '), colNames.join(', ')) : null,
    );
    const actions = h(
      'div',
      { className: 'toolbar detail-actions', role: 'group', 'aria-label': 'Recipe actions' },
      writeButton('Edit', () => go(`#edit=${encodeURIComponent(r.id)}`), { className: 'primary' }),
      writeButton('Duplicate', () => void duplicate(r)),
      h('button', { type: 'button', onclick: () => printRecipe(r) }, 'Print'),
      h('button', { type: 'button', onclick: () => void exportRecipe(r) }, 'Export this recipe'),
      writeButton('Add to shopping list', () => void openAddToList(r, viewFactor, viewSystem, announce)),
      writeButton('Delete', () => void deleteRecipe(r), { className: 'danger' }),
    );
    const block = h('div', { className: 'detail-controls' }, meta, controls, actions);
    /** Render the view; the controls block sits under the title (before the first section) for heading order. */
    function paint(): void {
      clear(viewHost);
      const article = renderRecipeView(r, { factor: viewFactor, system: viewSystem, showChecks: false, includeNotes: true, headingLevel: 1 });
      viewHost.appendChild(article);
      const firstSection = article.querySelector('section');
      if (firstSection) article.insertBefore(block, firstSection);
      else article.appendChild(block);
    }

    main.append(h('p', { className: 'back-link' }, h('a', { href: '#' }, '← All recipes')), imageHost, viewHost);
    paint();

    if (r.localImageId) {
      try {
        const img = await storage.getImage(r.localImageId);
        if (img && typeof URL.createObjectURL === 'function' && imageHost.isConnected) {
          objectUrl = URL.createObjectURL(img.blob);
          imageHost.appendChild(h('img', { src: objectUrl, alt: `Photo of ${r.title || 'this recipe'}` }));
        }
      } catch {
        /* no image */
      }
    }
    cleanupView = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }

  function printRecipe(r: RecipeV1): void {
    const units = viewSystem;
    const url = chrome.runtime.getURL(
      `ui/print.html?recipe=${encodeURIComponent(r.id)}&n=${viewFactor.n}&d=${viewFactor.d}&units=${units}&notes=1`,
    );
    void chrome.tabs.create({ url });
  }

  async function exportRecipe(r: RecipeV1): Promise<void> {
    try {
      const backup = await singleRecipeBackup(r, collections);
      downloadText(JSON.stringify(backup, null, 2), `recipe-pocket-${sanitizeFilename(r.title)}.json`);
      announce(`Exported "${r.title}". The file is in your downloads and is outside Recipe Pocket's control.`);
    } catch (e) {
      announce(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function duplicate(r: RecipeV1): Promise<void> {
    const copy: RecipeV1 = JSON.parse(JSON.stringify(r)) as RecipeV1;
    copy.id = uid();
    copy.revision = 0;
    copy.title = `${r.title || 'Untitled recipe'} (copy)`;
    delete copy.localImageId;
    if (r.localImageId) {
      try {
        const img = await storage.getImage(r.localImageId);
        if (img) copy.localImageId = (await storage.putImage(img.blob)).id;
      } catch {
        /* duplicate without the photo */
      }
    }
    try {
      const saved = await storage.saveRecipe(copy);
      announce(`Duplicated as "${saved.title}".`);
      go(`#recipe=${encodeURIComponent(saved.id)}`);
    } catch (e) {
      if (copy.localImageId) void storage.deleteImage(copy.localImageId).catch(() => undefined);
      announce(storageErrorMessage(e));
    }
  }

  async function deleteRecipe(r: RecipeV1): Promise<void> {
    const ok = await confirmDialog({
      title: `Delete "${r.title || 'Untitled recipe'}"?`,
      message: ['This removes the recipe from this device. Exported files and printed copies are not affected.'],
      confirmLabel: 'Delete recipe',
      danger: true,
    });
    if (!ok) return;
    try {
      await storage.deleteRecipe(r.id);
    } catch (e) {
      announce(storageErrorMessage(e));
      return;
    }
    if (r.localImageId) {
      try {
        const others = (await storage.listRecipes()).some((o) => o.localImageId === r.localImageId);
        if (!others) await storage.deleteImage(r.localImageId);
      } catch {
        /* leave the image; harmless */
      }
    }
    announce(`Deleted "${r.title || 'Untitled recipe'}".`);
    go('#');
  }

  // ---------- edit / new / import ----------
  function trackDirty(container: HTMLElement): void {
    const mark = (): void => {
      editorDirty = true;
    };
    container.addEventListener('input', mark);
    container.addEventListener('change', mark);
    container.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.row-actions, .group-actions, .editor-group > button, .editor-groups > button')) mark();
    });
  }

  async function renderEdit(id: string): Promise<void> {
    if (readOnly) {
      main.append(h('h1', {}, 'Editing is off'), h('p', { className: 'notice warn' }, SESSION_ONLY_MESSAGE), h('a', { href: `#recipe=${encodeURIComponent(id)}` }, 'Back to the recipe'));
      return;
    }
    let recipe: RecipeV1 | undefined;
    try {
      recipe = await storage.getRecipe(id);
    } catch (e) {
      main.appendChild(h('p', { className: 'notice error', role: 'alert' }, storageErrorMessage(e)));
      return;
    }
    if (!recipe) {
      main.append(h('h1', {}, 'Recipe not found'), h('a', { href: '#' }, 'Back to all recipes'));
      return;
    }
    setTitle(`Edit ${recipe.title || 'recipe'}`);
    const notice = h('div', { className: 'editor-notice' });
    const host = h('div', { className: 'editor-host' });
    main.append(h('h1', { className: 'visually-hidden' }, 'Recipe library'), h('p', { className: 'back-link' }, h('a', { href: `#recipe=${encodeURIComponent(id)}` }, '← Back to recipe')), notice, host);
    trackDirty(host);
    const stop = mountEditor(host, recipe, {
      saveLabel: 'Save changes',
      onCancel: () => {
        editorDirty = false;
        go(`#recipe=${encodeURIComponent(id)}`);
      },
      onSave: async (updated) => {
        try {
          await storage.saveRecipe(updated);
        } catch (e) {
          if (errorCode(e) === 'CONFLICT') {
            clear(notice);
            notice.appendChild(
              h(
                'div',
                { className: 'notice warn', role: 'alert' },
                h('p', {}, 'This recipe was changed in another tab or window, so your changes were not saved. Copy anything you want to keep, then load the latest version.'),
                h('button', { type: 'button', onclick: () => { editorDirty = false; void render(); } }, 'Load latest version'),
              ),
            );
          }
          throw new Error(storageErrorMessage(e));
        }
        editorDirty = false;
        announce(`Saved "${updated.title}".`);
        go(`#recipe=${encodeURIComponent(updated.id)}`);
      },
    });
    cleanupView = stop;
  }

  function renderNew(recipe: RecipeV1, review: { unclassified: string[]; warnings: string[] } | null): void {
    if (readOnly) {
      main.append(h('h1', {}, 'Creating recipes is off'), h('p', { className: 'notice warn' }, SESSION_ONLY_MESSAGE), h('a', { href: '#' }, 'Back to all recipes'));
      return;
    }
    setTitle('New recipe');
    const host = h('div', { className: 'editor-host' });
    main.append(h('h1', { className: 'visually-hidden' }, 'Recipe library'), h('p', { className: 'back-link' }, h('a', { href: '#' }, '← All recipes')));
    if (review) {
      main.appendChild(
        h(
          'section',
          { className: 'notice warn review-notice', 'aria-labelledby': 'rp-review-h' },
          h('h2', { id: 'rp-review-h' }, 'Review this draft before saving'),
          h('p', {}, 'The draft was made from a transcript. Check every quantity and step; nothing was invented, so missing details stay empty.'),
          review.warnings.length ? h('ul', {}, review.warnings.map((w) => h('li', {}, w))) : null,
          review.unclassified.length
            ? h('div', {}, h('p', {}, 'These lines could not be placed. Copy them into ingredients, steps or notes as needed:'), h('ul', { className: 'unclassified' }, review.unclassified.map((l) => h('li', {}, l))))
            : null,
        ),
      );
    }
    main.appendChild(host);
    trackDirty(host);
    if (review) editorDirty = true;
    cleanupView = mountEditor(host, recipe, {
      saveLabel: 'Save recipe',
      onCancel: () => {
        editorDirty = false;
        go('#');
      },
      onSave: async (r) => {
        let saved: RecipeV1;
        try {
          saved = await storage.saveRecipe(r);
        } catch (e) {
          throw new Error(storageErrorMessage(e));
        }
        editorDirty = false;
        announce(`Saved "${saved.title}".`);
        go(`#recipe=${encodeURIComponent(saved.id)}`);
      },
    });
  }

  function renderImport(): void {
    if (readOnly) {
      main.append(h('h1', {}, 'Importing is off'), h('p', { className: 'notice warn' }, SESSION_ONLY_MESSAGE), h('a', { href: '#' }, 'Back to all recipes'));
      return;
    }
    setTitle('Import transcript');
    const host = h('div', { className: 'import-host' });
    main.append(h('p', { className: 'back-link' }, h('a', { href: '#' }, '← All recipes')), h('h1', {}, 'Import a transcript'), host);
    let stop: (() => void) | null = mountTranscriptImport(host, {
      onDraft: (draft) => {
        stop?.();
        stop = null;
        clear(main);
        renderNew(draft.recipe, { unclassified: draft.unclassified, warnings: draft.warnings });
        const editorStop = cleanupView;
        cleanupView = () => editorStop?.();
      },
      onCancel: () => go('#'),
    });
    cleanupView = () => stop?.();
  }

  // ---------- shopping list ----------
  async function renderShoppingList(id: string): Promise<void> {
    let list;
    try {
      list = await storage.getShoppingList(id);
    } catch (e) {
      main.appendChild(h('p', { className: 'notice error', role: 'alert' }, storageErrorMessage(e)));
      return;
    }
    main.appendChild(h('p', { className: 'back-link no-print' }, h('a', { href: '#lists' }, '← All shopping lists')));
    if (!list) {
      setTitle('List not found');
      main.append(h('h1', {}, 'List not found'), h('p', {}, 'This shopping list may have been deleted.'));
      return;
    }
    setTitle(list.name);
    const host = h('div', {});
    main.appendChild(host);
    cleanupView = mountShoppingListEditor(host, list, { readOnly, announce, onDeleted: () => go('#lists') });
  }

  await render();
  return () => {
    window.removeEventListener('hashchange', onHashChange);
    window.removeEventListener('beforeunload', onBeforeUnload);
    cleanupView?.();
    cleanupView = null;
  };
}

if (document.getElementById('app')?.dataset.page === 'library') {
  void initLibrary(document.getElementById('app')!);
}
