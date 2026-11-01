/**
 * Side-panel reader controller (R01, R02, R04–R06, R08, R13).
 * chrome.* access is injected through PanelEnv so the flow can be tested in
 * jsdom. Unsaved drafts live only in this module's memory; closing the panel
 * discards them (ARCHITECTURE.md).
 */
import { clear, h, uid } from '../../shared/dom';
import type { Preferences, RecipeV1, UnitSystem } from '../../shared/types';
import {
  isActionClicked,
  isPrintDraftRequest,
  type ExtractRequest,
  type PrintDraftResponse,
  type PrintOptions,
} from '../../shared/messages';
import type { Rational } from '../../domain/index';
import { findBySourceUrl, saveRecipe } from '../../storage/index';
import { applyPreferences } from '../common/theme';
import { storageErrorMessage, updatePreferences } from '../common/prefs';
import {
  initialReaderState,
  missingSections,
  reduceReader,
  selectedCandidate,
  type ReaderEvent,
  type ReaderState,
} from '../common/reader-state';
import { confirmInline, createAnnouncer, notice } from '../common/status';
import { displayHost, isHttpUrl, plural } from '../common/format';
import { ONE } from '../common/scale';
import { draftPrintPath } from '../common/print-params';
import { renderRecipeView, renderScaleControls } from './recipe-view';
import { mountCookMode } from './cook-mode';
import { mountAddToList } from './add-to-list';
import { mountEditor } from './editor';

export interface TabInfo {
  id?: number;
  url?: string;
}

export interface PanelEnv {
  getWindowId(): Promise<number | undefined>;
  getActiveTab(): Promise<TabInfo | undefined>;
  sendExtract(req: ExtractRequest): Promise<unknown>;
  /** Open an extension page (path relative to the extension root) in a new tab. */
  openPage(path: string): void;
  openOptions(): void;
  onMessage(
    cb: (msg: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void) => boolean | void,
  ): void;
  onTabActivated(cb: (info: { tabId: number; windowId: number }) => void): void;
  onTabUpdated(cb: (tabId: number, change: { url?: string; status?: string }) => void): void;
  /** sender.id === this extension. */
  isTrustedSender(sender: chrome.runtime.MessageSender): boolean;
  /** Sender is this extension's print page (extension origin, not a content script). */
  isPrintPageSender(sender: chrome.runtime.MessageSender): boolean;
}

type SubMode = 'reader' | 'editing' | 'cooking';

interface ViewState {
  recipe: RecipeV1;
  factor: Rational;
  system: UnitSystem;
  showOriginal: boolean;
  saved: RecipeV1 | null;
}

const MISSING_LABEL: Record<string, string> = {
  ingredients: 'ingredients',
  instructions: 'steps',
  title: 'title',
  yield: 'yield',
  times: 'times',
  author: 'author',
};

const MAX_PRINT_DRAFTS = 10;

export interface PanelHandle {
  /** Current reader state (tests / debugging). */
  state(): ReaderState;
  read(): Promise<void>;
}

export async function mountReaderPanel(root: HTMLElement, env: PanelEnv, initialPrefs: Preferences): Promise<PanelHandle> {
  let prefs = initialPrefs;
  let reader = initialReaderState();
  let view: ViewState | null = null;
  let mode: SubMode = 'reader';
  let unmountSub: (() => void) | null = null;
  let renderedKey = '';
  const printDrafts = new Map<string, { recipe: RecipeV1; options: PrintOptions }>();

  // ---- Layout ----
  const libraryBtn = h('button', { type: 'button', onclick: () => env.openPage('ui/library.html') }, 'Library');
  const settingsBtn = h('button', { type: 'button', onclick: () => env.openOptions() }, 'Settings');
  const header = h(
    'header',
    { className: 'app-bar' },
    h('span', { className: 'app-name' }, 'Recipe Pocket'),
    h('nav', { 'aria-label': 'Recipe Pocket pages', className: 'button-row' }, libraryBtn, settingsBtn),
  );
  const noticeHost = h('div', { className: 'notice-host' });
  const content = h('div', { className: 'reader-content' });
  const main = h('main', { id: 'main', tabindex: '-1' }, noticeHost, content);
  const liveRegion = h('div', { className: 'visually-hidden' });
  const announce = createAnnouncer(liveRegion);
  clear(root);
  root.append(header, main, liveRegion);

  const windowId = await env.getWindowId().catch(() => undefined);

  // ---- Helpers ----
  const focusFirstHeading = () => {
    const hEl = content.querySelector<HTMLElement>('h1, h2');
    if (hEl) {
      hEl.setAttribute('tabindex', '-1');
      hEl.focus();
    }
  };

  const stopSub = () => {
    unmountSub?.();
    unmountSub = null;
    mode = 'reader';
  };

  const dispatch = (e: ReaderEvent) => {
    const before = reader;
    reader = reduceReader(reader, e);
    if (reader === before) return;
    const key = `${reader.phase}|${reader.requestId}|${reader.selectedIndex}`;
    if (key !== renderedKey) {
      renderedKey = key;
      renderContent();
    }
    renderPageNotice();
  };

  const openLibrary = (recipeId?: string) =>
    env.openPage(recipeId ? `ui/library.html#recipe=${encodeURIComponent(recipeId)}` : 'ui/library.html');

  const setPrefs = async (patch: Partial<Preferences>) => {
    const res = await updatePreferences(prefs, patch);
    prefs = res.prefs;
    applyPreferences(prefs);
    if (res.error) announce(res.error);
  };

  // ---- Reading ----
  async function read(): Promise<void> {
    if (mode === 'editing' || mode === 'cooking') {
      const ok = await confirmInline(noticeHost, {
        message:
          mode === 'editing'
            ? 'Read the current tab? Your unsaved edits to this recipe will be discarded.'
            : 'Read the current tab? This leaves cook mode and clears your progress.',
        confirmLabel: 'Read current tab',
        cancelLabel: mode === 'editing' ? 'Keep editing' : 'Keep cooking',
      });
      if (!ok) return;
    }
    stopSub();
    const tab = await env.getActiveTab().catch(() => undefined);
    const requestId = crypto.randomUUID();
    if (tab?.id === undefined) {
      dispatch({ type: 'START', requestId, tabId: -1 });
      dispatch({ type: 'RESPONSE', requestId, message: { type: 'EXTRACTION_ERROR', requestId, code: 'RESTRICTED_PAGE' } });
      return;
    }
    dispatch({ type: 'START', requestId, tabId: tab.id, url: tab.url });
    announce('Reading the recipe on this page…');
    try {
      const response = await env.sendExtract({ type: 'EXTRACT', requestId, tabId: tab.id });
      dispatch({ type: 'RESPONSE', requestId, message: response });
    } catch {
      dispatch({ type: 'FAILED', requestId });
    }
  }

  // ---- Notices about page changes ----
  function renderPageNotice(): void {
    noticeHost.querySelectorAll('.page-change').forEach((n) => n.remove());
    if (!reader.pageChange || reader.phase === 'idle') return;
    const host = displayHost(reader.url);
    const from = host ? ` (${host})` : '';
    const msg =
      reader.pageChange === 'tab'
        ? `You switched tabs. What you see here is from another tab${from}.`
        : `The page changed after it was read. What you see here is from the earlier page${from}.`;
    const btn = h('button', { type: 'button', onclick: () => void read() }, 'Read current tab');
    const el = notice('warn', msg, h('div', { className: 'button-row' }, btn));
    el.classList.add('page-change');
    noticeHost.appendChild(el);
    announce(msg);
  }

  // ---- Content rendering ----
  function renderContent(): void {
    stopSub();
    view = null;
    clear(content);
    switch (reader.phase) {
      case 'idle':
        return renderIdle();
      case 'loading':
        content.appendChild(
          h('div', { className: 'state loading', 'aria-busy': 'true' }, h('h1', {}, 'Reading this page…'), h('p', { className: 'muted' }, 'This usually takes under a second.')),
        );
        return;
      case 'multiple':
        return renderCandidates();
      case 'ready':
      case 'partial': {
        const r = selectedCandidate(reader);
        if (!r) return;
        view = { recipe: r, factor: ONE, system: prefs.unitSystem, showOriginal: false, saved: null };
        renderReady();
        announce(reader.phase === 'partial' ? `Partial recipe found: ${r.title || 'untitled'}. Some sections are missing.` : `Recipe ready: ${r.title || 'untitled'}.`);
        return;
      }
      case 'restricted':
        return renderProblem(
          'This page can’t be read',
          reader.errorCode === 'PAGE_CHANGED'
            ? 'The page changed while it was being read. Wait for it to finish loading, then try again.'
            : 'Chrome doesn’t let extensions read some pages, such as chrome:// pages, the Chrome Web Store and other extensions. If you switched tabs, go to the recipe tab and click the Recipe Pocket toolbar icon.',
          false,
        );
      case 'none':
        return renderProblem(
          'No recipe found',
          'Recipe Pocket didn’t find a recipe on this page. If the page shows a recipe, enter it yourself.',
          true,
        );
      case 'timeout':
        return renderProblem('Reading took too long', 'Reading the page took more than 5 seconds and was stopped. Try again after the page finishes loading.', true);
      case 'error':
        return renderProblem(
          'Couldn’t read this page',
          reader.errorCode === 'INPUT_TOO_LARGE'
            ? 'This page is too large to read (over 2 MB of text). You can enter the recipe yourself.'
            : 'Something went wrong while reading the page. Try again, or enter the recipe yourself.',
          true,
        );
    }
  }

  function renderIdle(): void {
    const readBtn = h('button', { type: 'button', className: 'primary', onclick: () => void dismissOnboardingAndRead() }, 'Read recipe');
    if (!prefs.onboarded) {
      content.appendChild(
        h(
          'section',
          { className: 'panel-card onboarding', 'aria-labelledby': 'onboard-title' },
          h('h1', { id: 'onboard-title' }, 'Welcome to Recipe Pocket'),
          h('p', {}, 'Reads this page when you ask. Saves only on this device.'),
          h(
            'div',
            { className: 'button-row' },
            readBtn,
            h('button', { type: 'button', onclick: () => openLibrary() }, 'Library'),
            h('button', { type: 'button', onclick: () => env.openOptions() }, 'Settings'),
          ),
          h('button', { type: 'button', className: 'link-button', onclick: () => void dismissOnboarding(true) }, 'Dismiss'),
        ),
      );
      return;
    }
    content.appendChild(
      h(
        'section',
        { className: 'state' },
        h('h1', {}, 'Read a recipe'),
        h('p', {}, 'Open a recipe page, then select Read recipe or click the Recipe Pocket toolbar icon.'),
        readBtn,
      ),
    );
  }

  async function dismissOnboarding(rerender: boolean): Promise<void> {
    if (prefs.onboarded) return;
    await setPrefs({ onboarded: true });
    if (rerender && reader.phase === 'idle') {
      clear(content);
      renderIdle();
      focusFirstHeading();
    }
  }

  async function dismissOnboardingAndRead(): Promise<void> {
    await dismissOnboarding(false);
    await read();
  }

  function renderProblem(title: string, message: string, offerManual: boolean): void {
    const buttons = h('div', { className: 'button-row' }, h('button', { type: 'button', className: 'primary', onclick: () => void read() }, 'Try again'));
    if (offerManual) buttons.appendChild(h('button', { type: 'button', onclick: () => startManualEntry() }, 'Enter recipe manually'));
    content.appendChild(
      h('section', { className: 'state problem' }, h('h1', {}, title), notice(reader.phase === 'error' || reader.phase === 'timeout' ? 'error' : 'info', message), buttons),
    );
    announce(`${title}. ${message}`);
  }

  function renderCandidates(): void {
    const list = h('ul', { className: 'candidate-list' });
    reader.candidates.forEach((c, i) => {
      const items = c.ingredientGroups.reduce((n, g) => n + g.items.length, 0);
      const steps = c.instructionGroups.reduce((n, g) => n + g.steps.length, 0);
      const titleId = `cand-${i}`;
      const descId = `cand-${i}-desc`;
      const sections = [...c.ingredientGroups, ...c.instructionGroups].map((g) => g.title).filter(Boolean).slice(0, 4);
      const preview = c.ingredientGroups.flatMap((g) => g.items).slice(0, 3).map((it) => it.raw);
      list.appendChild(
        h(
          'li',
          { className: 'panel-card candidate' },
          h('h2', { id: titleId }, c.title || `Untitled recipe ${i + 1}`),
          h(
            'div',
            { id: descId },
            h('p', { className: 'muted' }, `${plural(items, 'ingredient')} · ${plural(steps, 'step')}`),
            sections.length ? h('p', {}, 'Sections: ', sections.join(', ')) : null,
            preview.length ? h('ul', { className: 'preview-list' }, preview.map((p) => h('li', {}, p))) : null,
          ),
          h(
            'button',
            { type: 'button', className: 'primary', 'aria-describedby': `${titleId} ${descId}`, onclick: () => { dispatch({ type: 'SELECT', index: i }); focusFirstHeading(); } },
            'Use this recipe',
          ),
        ),
      );
    });
    content.append(
      h('h1', {}, `${reader.candidates.length} recipes found on this page`),
      h('p', {}, 'Choose one. Recipes are never combined.'),
      list,
    );
    announce(`${reader.candidates.length} recipes found. Choose one.`);
  }

  // ---- Ready / partial ----
  const recipeHost = h('div', { className: 'recipe-host' });
  const actionArea = h('div', { className: 'action-area', 'aria-live': 'polite' });

  function rerenderRecipe(): void {
    if (!view) return;
    const v = view;
    recipeHost.replaceChildren(
      renderRecipeView(v.recipe, {
        factor: v.factor,
        system: v.system,
        headingLevel: 1,
        showOriginal: v.showOriginal,
        onToggleOriginal: (show) => {
          v.showOriginal = show;
          rerenderRecipe();
        },
      }),
    );
  }

  function renderReady(): void {
    if (!view) return;
    const v = view;
    clear(content);
    const missing = missingSections(v.recipe).filter((f) => f === 'ingredients' || f === 'instructions' || f === 'title');
    if (missing.length) {
      content.appendChild(
        notice(
          'warn',
          h('p', {}, `Partial recipe. Missing: ${missing.map((m) => MISSING_LABEL[m] ?? m).join(', ')}. Recipe Pocket shows only what the page provides.`),
          h(
            'div',
            { className: 'button-row' },
            h('button', { type: 'button', className: 'primary', onclick: () => startEditing() }, 'Edit before saving'),
            h('button', { type: 'button', onclick: () => startManualEntry() }, 'Enter manually instead'),
          ),
        ),
      );
    }
    if (reader.warnings.length) {
      content.appendChild(
        h('details', { className: 'warnings' }, h('summary', {}, plural(reader.warnings.length, 'reading note')), h('ul', {}, reader.warnings.map((w) => h('li', {}, w)))),
      );
    }
    if (reader.candidates.length > 1) {
      content.appendChild(
        h('button', { type: 'button', className: 'link-button', onclick: () => { dispatch({ type: 'BACK_TO_CHOICES' }); focusFirstHeading(); } }, '← Back to all recipes on this page'),
      );
    }
    content.appendChild(
      renderScaleControls(v.recipe, {
        factor: v.factor,
        system: v.system,
        onChange: ({ factor, system }) => {
          v.factor = factor;
          v.system = system;
          rerenderRecipe();
        },
      }),
    );
    content.appendChild(renderActions());
    content.appendChild(actionArea);
    actionArea.replaceChildren();
    if (v.saved) showSavedState();
    content.appendChild(recipeHost);
    rerenderRecipe();
  }

  let saveBtn: HTMLButtonElement | null = null;

  function renderActions(): HTMLElement {
    saveBtn = h('button', { type: 'button', className: 'primary', onclick: () => void doSave(false) }, 'Save');
    if (view?.saved) markSaved();
    return h(
      'div',
      { className: 'action-bar', role: 'toolbar', 'aria-label': 'Recipe actions' },
      saveBtn,
      h('button', { type: 'button', onclick: () => doPrint() }, 'Print'),
      h('button', { type: 'button', onclick: () => startAddToList() }, 'Add to shopping list'),
      h('button', { type: 'button', onclick: () => startCooking() }, 'Cook mode'),
      h('button', { type: 'button', onclick: () => startEditing() }, 'Edit'),
      h('button', { type: 'button', onclick: () => openLibrary(view?.saved?.id) }, 'Library'),
    );
  }

  function markSaved(): void {
    if (!saveBtn) return;
    saveBtn.textContent = '✓ Saved';
    saveBtn.disabled = true;
    saveBtn.setAttribute('aria-label', 'Saved on this device');
  }

  function showSavedState(): void {
    if (!view?.saved) return;
    const id = view.saved.id;
    actionArea.replaceChildren(
      notice(
        'success',
        'Saved on this device.',
        h('div', { className: 'button-row' }, h('button', { type: 'button', onclick: () => openLibrary(id) }, 'Open in library')),
      ),
    );
  }

  type SaveOutcome = { kind: 'saved'; stored: RecipeV1 } | { kind: 'duplicate'; first: RecipeV1 };

  /** Duplicate check + write. Throws storage errors; existing records stay intact on failure. */
  async function saveDraft(r: RecipeV1, alreadySaved: boolean, force: boolean): Promise<SaveOutcome> {
    if (!force && !alreadySaved && isHttpUrl(r.source?.url)) {
      const dups = (await findBySourceUrl(r.source.url)).filter((d) => d.id !== r.id);
      if (dups.length) return { kind: 'duplicate', first: dups[0]! };
    }
    return { kind: 'saved', stored: await saveRecipe(r) };
  }

  function showDuplicate(first: RecipeV1): void {
    actionArea.replaceChildren(
      notice(
        'warn',
        `You already saved a recipe from this page: “${first.title || 'Untitled recipe'}”.`,
        h(
          'div',
          { className: 'button-row' },
          h('button', { type: 'button', onclick: () => openLibrary(first.id) }, 'Open saved'),
          h('button', { type: 'button', onclick: () => void doSave(true) }, 'Save anyway'),
        ),
      ),
    );
    announce('You already saved a recipe from this page.');
  }

  function applySaved(v: ViewState, stored: RecipeV1): void {
    v.saved = stored;
    v.recipe = stored;
    markSaved();
    showSavedState();
    announce('Saved on this device.');
  }

  async function doSave(force: boolean): Promise<void> {
    if (!view || !saveBtn) return;
    const v = view;
    const btn = saveBtn;
    btn.disabled = true;
    actionArea.replaceChildren(h('p', { className: 'muted' }, 'Saving…'));
    try {
      const out = await saveDraft(v.recipe, !!v.saved, force);
      if (view !== v) return; // panel moved on to another recipe meanwhile
      if (out.kind === 'duplicate') {
        btn.disabled = false;
        showDuplicate(out.first);
        return;
      }
      applySaved(v, out.stored);
    } catch (e) {
      if (view !== v) return;
      btn.disabled = false;
      actionArea.replaceChildren(notice('error', storageErrorMessage(e, 'recipe')));
    }
  }

  function doPrint(): void {
    if (!view) return;
    const printId = uid();
    printDrafts.set(printId, {
      recipe: view.recipe,
      options: { factorNumerator: view.factor.n, factorDenominator: view.factor.d, unitSystem: view.system, includeNotes: true },
    });
    while (printDrafts.size > MAX_PRINT_DRAFTS) printDrafts.delete(printDrafts.keys().next().value as string);
    env.openPage(draftPrintPath(printId));
    announce('Print view opened in a new tab.');
  }

  function startAddToList(): void {
    if (!view) return;
    const v = view;
    unmountSub?.();
    unmountSub = mountAddToList(actionArea, {
      recipe: v.recipe,
      factor: v.factor,
      system: v.system,
      onDone: ({ list, added }) => {
        unmountSub = null;
        const msg = `Added ${plural(added, 'ingredient')} to “${list.name}”.`;
        actionArea.replaceChildren(
          notice('success', msg, h('div', { className: 'button-row' }, h('button', { type: 'button', onclick: () => env.openPage('ui/library.html#lists') }, 'Open shopping lists'))),
        );
        announce(msg);
      },
      onCancel: () => {
        unmountSub = null;
        actionArea.replaceChildren();
        if (v.saved) showSavedState();
      },
    });
  }

  function startCooking(): void {
    if (!view) return;
    const v = view;
    noticeHost.querySelectorAll('.confirm').forEach((n) => n.remove());
    mode = 'cooking';
    clear(content);
    unmountSub = mountCookMode(content, v.recipe, {
      factor: v.factor,
      system: v.system,
      prefs,
      onPrefsChange: (patch) => void setPrefs(patch),
      onClose: () => {
        stopSub();
        renderReady();
        focusFirstHeading();
        announce('Left cook mode. Progress cleared.');
      },
    });
  }

  function blankDraft(): RecipeV1 {
    const url = isHttpUrl(reader.url) ? reader.url : '';
    return {
      schemaVersion: 1,
      id: uid(),
      title: '',
      source: { url },
      originalYield: { text: '' },
      times: { raw: '' },
      ingredientGroups: [{ id: uid(), title: '', items: [] }],
      instructionGroups: [{ id: uid(), title: '', steps: [] }],
      notes: '',
      tags: [],
      collectionIds: [],
      extraction: { method: 'manual', missingFields: [], warnings: [] },
      revision: 0,
    };
  }

  function openEditor(recipe: RecipeV1, onCancelRestore: () => void): void {
    if (typeof mountEditor !== 'function') {
      actionArea.replaceChildren(notice('error', 'The editor is not available in this build.'));
      return;
    }
    stopSub();
    mode = 'editing';
    clear(content);
    const host = h('div', { className: 'editor-host' });
    content.append(h('h1', { tabindex: '-1' }, recipe.title ? `Edit: ${recipe.title}` : 'Enter a recipe'), host);
    unmountSub = mountEditor(host, recipe, {
      saveLabel: 'Save recipe',
      onSave: async (edited) => {
        const prev = view;
        let out: SaveOutcome;
        try {
          out = await saveDraft(edited, !!prev?.saved, false);
        } catch (e) {
          // The editor stays open and shows this message; nothing was written.
          throw new Error(storageErrorMessage(e, 'recipe'));
        }
        stopSub();
        const v: ViewState = {
          recipe: edited,
          factor: prev?.factor ?? ONE,
          system: prev?.system ?? prefs.unitSystem,
          showOriginal: false,
          saved: prev?.saved ?? null,
        };
        view = v;
        renderReady();
        focusFirstHeading();
        if (out.kind === 'duplicate') showDuplicate(out.first);
        else applySaved(v, out.stored);
      },
      onCancel: () => {
        stopSub();
        onCancelRestore();
        focusFirstHeading();
      },
    });
    focusFirstHeading();
  }

  function startEditing(): void {
    if (!view) return;
    openEditor(view.recipe, () => renderReady());
  }

  function startManualEntry(): void {
    const prevView = view;
    const prevPhase = reader.phase;
    openEditor(prevView?.recipe && prevPhase === 'partial' ? prevView.recipe : blankDraft(), () => {
      if (prevView) {
        view = prevView;
        renderReady();
      } else renderContent();
    });
  }

  // ---- Messages and tab events ----
  env.onMessage((msg, sender, sendResponse) => {
    if (!env.isTrustedSender(sender)) return false;
    if (isActionClicked(msg)) {
      if (sender.tab) return false; // only the service worker sends this
      if (windowId !== undefined && msg.windowId === windowId) void read();
      return false;
    }
    if (isPrintDraftRequest(msg)) {
      if (!env.isPrintPageSender(sender)) return false;
      const draft = printDrafts.get(msg.printId);
      if (!draft) return false; // another panel (or none) may hold it
      const res: PrintDraftResponse = { type: 'PRINT_DRAFT_RESPONSE', printId: msg.printId, recipe: draft.recipe, options: draft.options };
      sendResponse(res);
      return false;
    }
    return false;
  });

  env.onTabActivated((info) => {
    if (windowId !== undefined && info.windowId !== windowId) return;
    dispatch({ type: 'TAB_ACTIVATED', tabId: info.tabId });
  });
  env.onTabUpdated((tabId, change) => {
    if (change.url || change.status === 'loading') dispatch({ type: 'TAB_NAVIGATED', tabId, url: change.url });
  });

  // ---- Start ----
  renderedKey = 'idle|null|null';
  renderContent();
  if (prefs.onboarded) void read();

  return { state: () => reader, read };
}
