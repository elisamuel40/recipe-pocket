// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preferences, RecipeV1 } from '../../src/shared/types';
import { DEFAULT_PREFERENCES } from '../../src/shared/types';

vi.mock('../../src/storage/index', () => {
  class StorageError extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
  }
  return {
    StorageError,
    findBySourceUrl: vi.fn(async () => []),
    saveRecipe: vi.fn(async (r: RecipeV1) => ({ ...r, revision: r.revision + 1 })),
    setPreferences: vi.fn(async (p: Partial<Preferences>) => ({ ...p })),
    getPreferences: vi.fn(async () => ({})),
    listShoppingLists: vi.fn(async () => []),
    saveShoppingList: vi.fn(async (l: unknown) => l),
    listCollections: vi.fn(async () => []),
    saveCollection: vi.fn(),
    putImage: vi.fn(),
    getImage: vi.fn(async () => undefined),
    deleteImage: vi.fn(),
  };
});

import * as storage from '../../src/storage/index';
import { mountReaderPanel, type PanelEnv } from '../../src/ui/components/reader-panel';

type Listener = Parameters<PanelEnv['onMessage']>[0];

function recipe(over: Partial<RecipeV1> = {}): RecipeV1 {
  return {
    schemaVersion: 1,
    id: 'draft-1',
    title: 'Tomato Soup',
    source: { url: 'https://example.com/soup' },
    originalYield: { text: '4 servings', quantity: { minNumerator: 4, minDenominator: 1 } },
    times: { raw: '' },
    ingredientGroups: [{ id: 'g', title: '', items: [{ id: 'i', raw: '2 cups stock', confidence: 'high', quantity: { minNumerator: 2, minDenominator: 1 }, unit: 'cup', ingredient: 'stock' }] }],
    instructionGroups: [{ id: 's', title: '', steps: [{ id: 'a', text: 'Simmer.' }] }],
    notes: '',
    tags: [],
    collectionIds: [],
    extraction: { method: 'json-ld', missingFields: [], warnings: [] },
    revision: 0,
    ...over,
  };
}

interface Pending {
  req: { requestId: string; tabId: number };
  resolve: (v: unknown) => void;
}

function makeEnv() {
  const pending: Pending[] = [];
  let listener: Listener | null = null;
  let onActivated: ((i: { tabId: number; windowId: number }) => void) | null = null;
  let onUpdated: ((id: number, c: { url?: string; status?: string }) => void) | null = null;
  const env: PanelEnv & { opened: string[]; activeTab: { id?: number; url?: string } } = {
    opened: [],
    activeTab: { id: 1, url: 'https://example.com/soup' },
    getWindowId: async () => 7,
    getActiveTab: async () => env.activeTab,
    sendExtract: (req) => new Promise((resolve) => pending.push({ req, resolve })),
    openPage: (p) => env.opened.push(p),
    openOptions: vi.fn(),
    onMessage: (cb) => (listener = cb),
    onTabActivated: (cb) => (onActivated = cb),
    onTabUpdated: (cb) => (onUpdated = cb),
    isTrustedSender: (s) => s.id === 'ext',
    isPrintPageSender: (s) => s.id === 'ext' && s.url === 'chrome-extension://ext/ui/print.html?id=x',
  };
  return {
    env,
    pending,
    message: (msg: unknown, sender: chrome.runtime.MessageSender) => {
      const sendResponse = vi.fn();
      listener!(msg, sender, sendResponse);
      return sendResponse;
    },
    activate: (tabId: number, windowId = 7) => onActivated!({ tabId, windowId }),
    update: (tabId: number, c: { url?: string; status?: string }) => onUpdated!(tabId, c),
  };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};
const resultFor = (p: Pending, candidates: RecipeV1[]) =>
  p.resolve({ type: 'EXTRACTION_RESULT', requestId: p.req.requestId, url: 'https://example.com/soup', candidates, warnings: [] });
const button = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text);

const onboarded: Preferences = { ...DEFAULT_PREFERENCES, onboarded: true };
let root: HTMLElement;

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  vi.mocked(storage.findBySourceUrl).mockResolvedValue([]);
  vi.mocked(storage.saveRecipe).mockImplementation(async (r) => ({ ...r, revision: r.revision + 1 }));
  vi.mocked(storage.setPreferences).mockImplementation(async (p) => ({ ...DEFAULT_PREFERENCES, ...p }));
});
afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('side panel: first launch', () => {
  it('explains privacy and reads only when asked', async () => {
    const t = makeEnv();
    await mountReaderPanel(root, t.env, { ...DEFAULT_PREFERENCES });
    expect(root.textContent).toContain('Reads this page when you ask. Saves only on this device.');
    expect(button(root, 'Library')).toBeTruthy();
    expect(button(root, 'Settings')).toBeTruthy();
    expect(t.pending).toHaveLength(0);
    button(root, 'Read recipe')!.click();
    await flush();
    expect(storage.setPreferences).toHaveBeenCalledWith({ onboarded: true });
    expect(t.pending).toHaveLength(1);
    expect(t.pending[0]!.req).toMatchObject({ tabId: 1 });
  });

  it('dismisses in session-only mode without persisting', async () => {
    const t = makeEnv();
    await mountReaderPanel(root, t.env, { ...DEFAULT_PREFERENCES, sessionOnly: true });
    button(root, 'Dismiss')!.click();
    await flush();
    expect(storage.setPreferences).not.toHaveBeenCalled();
    expect(root.textContent).toContain('Read a recipe');
  });

  it('dismisses even if storage reports SESSION_ONLY', async () => {
    vi.mocked(storage.setPreferences).mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'SESSION_ONLY' }));
    const t = makeEnv();
    await mountReaderPanel(root, t.env, { ...DEFAULT_PREFERENCES });
    button(root, 'Dismiss')!.click();
    await flush();
    expect(root.textContent).not.toContain('Welcome to Recipe Pocket');
  });
});

describe('side panel: reading', () => {
  it('reads on load and shows the ready view', async () => {
    const t = makeEnv();
    await mountReaderPanel(root, t.env, onboarded);
    await flush();
    expect(root.textContent).toContain('Reading this page');
    resultFor(t.pending[0]!, [recipe()]);
    await flush();
    expect(root.querySelector('h1')!.textContent).toBe('Tomato Soup');
    for (const label of ['Save', 'Print', 'Add to shopping list', 'Cook mode', 'Library']) expect(button(root, label)).toBeTruthy();
    expect(root.querySelector('.servings-input')).not.toBeNull();
  });

  it('discards a late result from an earlier request', async () => {
    const t = makeEnv();
    const panel = await mountReaderPanel(root, t.env, onboarded);
    await flush();
    t.env.activeTab = { id: 2, url: 'https://example.com/bread' };
    void panel.read();
    await flush();
    expect(t.pending).toHaveLength(2);
    resultFor(t.pending[0]!, [recipe({ title: 'Stale' })]);
    await flush();
    expect(root.textContent).not.toContain('Stale');
    resultFor(t.pending[1]!, [recipe({ title: 'Bread' })]);
    await flush();
    expect(root.querySelector('h1')!.textContent).toBe('Bread');
  });

  it('only re-reads for ACTION_CLICKED from the service worker in this window', async () => {
    const t = makeEnv();
    await mountReaderPanel(root, t.env, onboarded);
    await flush();
    t.message({ type: 'ACTION_CLICKED', tabId: 1, windowId: 99 }, { id: 'ext' });
    t.message({ type: 'ACTION_CLICKED', tabId: 1, windowId: 7 }, { id: 'evil' });
    t.message({ type: 'ACTION_CLICKED', tabId: 1, windowId: 7 }, { id: 'ext', tab: { id: 3 } as chrome.tabs.Tab });
    await flush();
    expect(t.pending).toHaveLength(1);
    t.message({ type: 'ACTION_CLICKED', tabId: 1, windowId: 7 }, { id: 'ext' });
    await flush();
    expect(t.pending).toHaveLength(2);
  });

  it('marks the recipe as from another tab instead of replacing it', async () => {
    const t = makeEnv();
    await mountReaderPanel(root, t.env, onboarded);
    await flush();
    resultFor(t.pending[0]!, [recipe()]);
    await flush();
    t.activate(5, 99); // other window: ignored
    expect(root.querySelector('.page-change')).toBeNull();
    t.activate(5);
    expect(root.querySelector('h1')!.textContent).toBe('Tomato Soup');
    expect(root.querySelector('.page-change')!.textContent).toContain('another tab');
    t.update(1, { url: 'https://example.com/other' });
    t.activate(1);
    expect(root.querySelector('.page-change')!.textContent).toContain('page changed');
    expect(t.pending).toHaveLength(1);
  });

  it('explains restricted pages', async () => {
    const t = makeEnv();
    await mountReaderPanel(root, t.env, onboarded);
    await flush();
    t.pending[0]!.resolve({ type: 'EXTRACTION_ERROR', requestId: t.pending[0]!.req.requestId, code: 'RESTRICTED_PAGE' });
    await flush();
    expect(root.textContent).toContain('chrome://');
    expect(root.textContent).toContain('toolbar icon');
  });

  it('offers retry after a timeout', async () => {
    const t = makeEnv();
    await mountReaderPanel(root, t.env, onboarded);
    await flush();
    t.pending[0]!.resolve({ type: 'EXTRACTION_ERROR', requestId: t.pending[0]!.req.requestId, code: 'CANCELLED' });
    await flush();
    expect(root.textContent).toContain('took too long');
    button(root, 'Try again')!.click();
    await flush();
    expect(t.pending).toHaveLength(2);
  });

  it('lists multiple candidates with previews and never combines them', async () => {
    const t = makeEnv();
    await mountReaderPanel(root, t.env, onboarded);
    await flush();
    resultFor(t.pending[0]!, [recipe({ id: 'a', title: 'Pastry' }), recipe({ id: 'b', title: 'Filling' })]);
    await flush();
    expect(root.querySelectorAll('.candidate')).toHaveLength(2);
    expect(root.querySelector('.candidate')!.textContent).toContain('1 ingredient · 1 step');
    root.querySelectorAll<HTMLButtonElement>('.candidate button')[1]!.click();
    await flush();
    expect(root.querySelector('h1')!.textContent).toBe('Filling');
    expect(root.textContent).not.toContain('Pastry');
  });

  it('highlights missing sections for partial recipes', async () => {
    const t = makeEnv();
    await mountReaderPanel(root, t.env, onboarded);
    await flush();
    resultFor(t.pending[0]!, [recipe({ instructionGroups: [], extraction: { method: 'dom', missingFields: ['instructions'], warnings: [] } })]);
    await flush();
    expect(root.textContent).toContain('Partial recipe. Missing: steps');
    expect(button(root, 'Edit before saving')).toBeTruthy();
    expect(root.querySelector('[data-missing="steps"]')).not.toBeNull();
  });
});

describe('side panel: actions', () => {
  async function ready(t = makeEnv(), r = recipe()) {
    await mountReaderPanel(root, t.env, onboarded);
    await flush();
    resultFor(t.pending[0]!, [r]);
    await flush();
    return t;
  }

  it('saves explicitly and shows the saved state', async () => {
    const t = await ready();
    expect(storage.saveRecipe).not.toHaveBeenCalled();
    button(root, 'Save')!.click();
    await flush();
    expect(storage.findBySourceUrl).toHaveBeenCalledWith('https://example.com/soup');
    expect(storage.saveRecipe).toHaveBeenCalledOnce();
    expect(root.textContent).toContain('Saved on this device.');
    button(root, 'Open in library')!.click();
    expect(t.env.opened.at(-1)).toBe('ui/library.html#recipe=draft-1');
  });

  it('warns about duplicates and supports Save anyway / Open saved', async () => {
    vi.mocked(storage.findBySourceUrl).mockResolvedValue([recipe({ id: 'saved-9', title: 'Old soup' })]);
    const t = await ready();
    button(root, 'Save')!.click();
    await flush();
    expect(storage.saveRecipe).not.toHaveBeenCalled();
    expect(root.textContent).toContain('Old soup');
    button(root, 'Open saved')!.click();
    expect(t.env.opened.at(-1)).toBe('ui/library.html#recipe=saved-9');
    button(root, 'Save anyway')!.click();
    await flush();
    expect(storage.saveRecipe).toHaveBeenCalledOnce();
  });

  it('explains quota failures and allows retry', async () => {
    vi.mocked(storage.saveRecipe).mockRejectedValueOnce(Object.assign(new Error('full'), { code: 'QUOTA' }));
    await ready();
    button(root, 'Save')!.click();
    await flush();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('out of storage space');
    expect(button(root, 'Save')!.disabled).toBe(false);
  });

  it('explains session-only mode on save', async () => {
    vi.mocked(storage.saveRecipe).mockRejectedValueOnce(Object.assign(new Error('s'), { code: 'SESSION_ONLY' }));
    await ready();
    button(root, 'Save')!.click();
    await flush();
    expect(root.textContent).toContain('session-only mode is on');
  });

  it('prints through a draft id and answers only the print page', async () => {
    const t = await ready();
    button(root, 'Print')!.click();
    const path = t.env.opened.at(-1)!;
    expect(path).toMatch(/^ui\/print\.html\?id=/);
    const printId = new URLSearchParams(path.split('?')[1]).get('id')!;
    const req = { type: 'PRINT_DRAFT_REQUEST', printId };
    expect(t.message(req, { id: 'ext', url: 'https://evil.example/' })).not.toHaveBeenCalled();
    expect(t.message({ ...req, printId: 'unknown' }, { id: 'ext', url: 'chrome-extension://ext/ui/print.html?id=x' })).not.toHaveBeenCalled();
    const respond = t.message(req, { id: 'ext', url: 'chrome-extension://ext/ui/print.html?id=x' });
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PRINT_DRAFT_RESPONSE', printId, recipe: expect.objectContaining({ title: 'Tomato Soup' }), options: expect.objectContaining({ factorNumerator: 1, factorDenominator: 1 }) }),
    );
  });

  it('adds an unsaved draft to a new shopping list', async () => {
    await ready();
    button(root, 'Add to shopping list')!.click();
    await flush();
    const form = root.querySelector('form.add-to-list') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    const saved = vi.mocked(storage.saveShoppingList).mock.calls[0]![0];
    expect(saved.name).toBe('Shopping list');
    expect(saved.items[0]!.sources[0]).toMatchObject({ recipeId: 'draft-1', recipeTitle: 'Tomato Soup' });
    expect(storage.saveRecipe).not.toHaveBeenCalled();
    expect(root.textContent).toContain('Added 1 ingredient to “Shopping list”.');
  });

  it('asks before replacing a recipe being edited', async () => {
    const t = await ready();
    button(root, 'Edit')!.click();
    await flush();
    expect(root.querySelector('.editor-host')).not.toBeNull();
    t.message({ type: 'ACTION_CLICKED', tabId: 1, windowId: 7 }, { id: 'ext' });
    await flush();
    const dialog = root.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain('unsaved edits');
    button(root, 'Keep editing')!.click();
    await flush();
    expect(t.pending).toHaveLength(1);
    expect(root.querySelector('.editor-host')).not.toBeNull();
  });

  it('saves from "Edit before saving" through the editor', async () => {
    await ready();
    button(root, 'Edit')!.click();
    await flush();
    const save = button(root, 'Save recipe')!;
    expect(save).toBeTruthy();
    save.click();
    await flush();
    expect(storage.saveRecipe).toHaveBeenCalledOnce();
    expect(root.querySelector('.editor-host')).toBeNull();
    expect(root.textContent).toContain('Saved on this device.');
  });

  it('keeps the editor open when an edited save fails', async () => {
    vi.mocked(storage.saveRecipe).mockRejectedValueOnce(Object.assign(new Error('full'), { code: 'QUOTA' }));
    await ready();
    button(root, 'Edit')!.click();
    await flush();
    button(root, 'Save recipe')!.click();
    await flush();
    expect(root.querySelector('.editor-host')).not.toBeNull();
    expect(root.textContent).toContain('out of storage space');
  });

  it('enters and leaves cook mode', async () => {
    await ready();
    button(root, 'Cook mode')!.click();
    expect(root.querySelector('.cook-mode')).not.toBeNull();
    button(root, 'Exit cook mode')!.click();
    expect(root.querySelector('.cook-mode')).toBeNull();
    expect(root.querySelector('h1')!.textContent).toBe('Tomato Soup');
  });
});
