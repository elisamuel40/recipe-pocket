/**
 * Recipe editor (PRD R03, R07). Owner: UI owner B. Used by the library and by
 * the side panel's partial-recipe flow.
 *
 * Works on a copy; onSave receives a new RecipeV1. Every reorder is a button
 * (keyboard accessible, no drag-only interaction). Images are local only:
 * file input -> storage.putImage, shown via an object URL that is revoked on
 * unmount. Never renders remote URLs and never uses innerHTML.
 */
import { clear, h, uid } from '../../shared/dom';
import type { Collection, IngredientItem, RecipeField, RecipeV1 } from '../../shared/types';
import * as storage from '../../storage/index';
import { normalizeSourceUrl, parseYield, toIngredientItem, toQuantityV1 } from '../../domain/index';
import { focusKey, storageErrorMessage } from './collection-dialogs';

export interface EditorOptions {
  onSave: (r: RecipeV1) => void | Promise<void>;
  onCancel: () => void;
  saveLabel?: string;
}

interface LineState {
  id: string;
  raw: string;
}
interface IngGroupState {
  id: string;
  title: string;
  lines: LineState[];
}
interface StepState {
  id: string;
  text: string;
}
interface StepGroupState {
  id: string;
  title: string;
  steps: StepState[];
}

let editorSeq = 0;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function move<T>(arr: T[], from: number, to: number): void {
  if (to < 0 || to >= arr.length) return;
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item as T);
}

/** Split comma-separated tags, trimmed, de-duplicated case-insensitively. */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(',')) {
    const t = part.trim().replace(/\s+/g, ' ');
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

export function mountEditor(container: HTMLElement, recipe: RecipeV1, opts: EditorOptions): () => void {
  const original = clone(recipe);
  const p = `rp-ed-${++editorSeq}`;
  let disposed = false;
  let saving = false;
  let committed = false;
  let objectUrl: string | null = null;
  /** Images uploaded in this session (deleted again if not kept). */
  const uploaded = new Set<string>();

  const state = {
    title: original.title,
    url: original.source.url,
    author: original.source.author ?? '',
    yieldText: original.originalYield.text,
    timesRaw: original.times.raw,
    notes: original.notes,
    tags: original.tags.join(', '),
    collectionIds: new Set(original.collectionIds),
    localImageId: original.localImageId,
    ingGroups: original.ingredientGroups.map<IngGroupState>((g) => ({
      id: g.id,
      title: g.title,
      lines: g.items.map((i) => ({ id: i.id, raw: i.raw })),
    })),
    stepGroups: original.instructionGroups.map<StepGroupState>((g) => ({
      id: g.id,
      title: g.title,
      steps: g.steps.map((s) => ({ id: s.id, text: s.text })),
    })),
  };
  if (state.ingGroups.length === 0) state.ingGroups.push({ id: uid(), title: '', lines: [] });
  if (state.stepGroups.length === 0) state.stepGroups.push({ id: uid(), title: '', steps: [] });
  for (const g of state.ingGroups) if (g.lines.length === 0) g.lines.push({ id: uid(), raw: '' });
  for (const g of state.stepGroups) if (g.steps.length === 0) g.steps.push({ id: uid(), text: '' });

  // ---------- helpers ----------
  const live = h('p', { className: 'visually-hidden', 'aria-live': 'polite', role: 'status' });
  const announce = (msg: string): void => {
    live.textContent = '';
    setTimeout(() => {
      if (!disposed) live.textContent = msg;
    }, 30);
  };

  function textField(
    key: string,
    label: string,
    value: string,
    onInput: (v: string) => void,
    extra: { type?: string; hint?: string; multiline?: boolean; rows?: number; required?: boolean } = {},
  ): { wrap: HTMLElement; input: HTMLInputElement | HTMLTextAreaElement; error: HTMLElement } {
    const id = `${p}-${key}`;
    const describedBy = [extra.hint ? `${id}-hint` : '', `${id}-err`].filter(Boolean).join(' ');
    const input = extra.multiline
      ? h('textarea', { id, rows: extra.rows ?? 4, 'aria-describedby': describedBy, 'data-key': key })
      : h('input', {
          id,
          type: extra.type ?? 'text',
          'aria-describedby': describedBy,
          'data-key': key,
          'aria-required': extra.required ? 'true' : null,
        });
    input.value = value;
    input.addEventListener('input', () => onInput(input.value));
    const error = h('p', { id: `${id}-err`, className: 'field-error', hidden: true });
    const wrap = h(
      'div',
      { className: 'field' },
      h('label', { for: id }, label, extra.required ? h('span', { className: 'muted' }, ' (required)') : null),
      extra.hint ? h('p', { id: `${id}-hint`, className: 'hint muted' }, extra.hint) : null,
      input,
      error,
    );
    return { wrap, input, error };
  }

  function setFieldError(f: { input: HTMLElement; error: HTMLElement }, msg: string | null): void {
    if (msg) {
      f.error.textContent = msg;
      f.error.hidden = false;
      f.input.setAttribute('aria-invalid', 'true');
    } else {
      f.error.textContent = '';
      f.error.hidden = true;
      f.input.removeAttribute('aria-invalid');
    }
  }

  function iconButton(key: string, text: string, label: string, onClick: () => void, disabled = false): HTMLButtonElement {
    return h('button', { type: 'button', className: 'icon-btn', 'aria-label': label, 'data-key': key, disabled, onclick: onClick }, text);
  }

  // ---------- basics ----------
  const titleF = textField('title', 'Title', state.title, (v) => (state.title = v), { required: true });
  const urlF = textField('url', 'Source link', state.url, (v) => (state.url = v), {
    type: 'url',
    hint: 'Optional. A full web address starting with http:// or https://.',
  });
  urlF.input.addEventListener('blur', () => {
    const v = state.url.trim();
    setFieldError(urlF, v && !normalizeSourceUrl(v) ? URL_ERROR : null);
  });
  const authorF = textField('author', 'Author', state.author, (v) => (state.author = v));
  const yieldF = textField('yield', 'Yield', state.yieldText, (v) => (state.yieldText = v), {
    hint: 'For example "4 servings" or "Makes 12 cookies". Used for scaling.',
  });
  const timesF = textField('times', 'Times', state.timesRaw, (v) => (state.timesRaw = v), {
    hint: 'For example "Prep 15 min, cook 1 hour".',
  });

  // ---------- image ----------
  const imgPreview = h('div', { className: 'editor-image-preview' });
  const imgError = h('p', { id: `${p}-img-err`, className: 'field-error', hidden: true, role: 'alert' });
  const imgInput = h('input', {
    id: `${p}-img`,
    type: 'file',
    accept: 'image/png,image/jpeg,image/webp',
    'aria-describedby': `${p}-img-hint ${p}-img-err`,
  });
  const removeImgBtn = h('button', { type: 'button', onclick: () => removeImage() }, 'Remove photo');

  function revokeUrl(): void {
    if (objectUrl && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  function showImage(blob: Blob | null): void {
    revokeUrl();
    clear(imgPreview);
    removeImgBtn.hidden = !state.localImageId;
    if (!blob) {
      imgPreview.appendChild(h('p', { className: 'muted' }, state.localImageId ? 'Photo saved on this device.' : 'No photo.'));
      return;
    }
    if (typeof URL.createObjectURL === 'function') {
      objectUrl = URL.createObjectURL(blob);
      imgPreview.appendChild(h('img', { src: objectUrl, alt: 'Selected recipe photo' }));
    } else {
      imgPreview.appendChild(h('p', { className: 'muted' }, 'Photo selected.'));
    }
  }

  async function loadInitialImage(): Promise<void> {
    if (!state.localImageId) return showImage(null);
    try {
      const img = await storage.getImage(state.localImageId);
      if (!disposed) showImage(img?.blob ?? null);
    } catch {
      if (!disposed) showImage(null);
    }
  }

  imgInput.addEventListener('change', async () => {
    const file = imgInput.files?.[0];
    if (!file) return;
    imgError.hidden = true;
    try {
      const img = await storage.putImage(file);
      if (disposed) {
        void storage.deleteImage(img.id).catch(() => undefined);
        return;
      }
      uploaded.add(img.id);
      state.localImageId = img.id;
      showImage(img.blob);
      announce('Photo added.');
    } catch (e) {
      const code = (e as { code?: string }).code;
      imgError.textContent =
        code === 'SESSION_ONLY' || code === 'QUOTA'
          ? storageErrorMessage(e)
          : `This photo can't be used: ${e instanceof Error ? e.message : String(e)}. Choose a PNG, JPEG or WebP file up to 5 MB.`;
      imgError.hidden = false;
    } finally {
      imgInput.value = '';
    }
  });

  function removeImage(): void {
    state.localImageId = undefined;
    showImage(null);
    announce('Photo removed.');
    imgInput.focus();
  }

  // ---------- ingredients ----------
  const ingWrap = h('div', { className: 'editor-groups' });

  function renderIngredients(focus?: string): void {
    clear(ingWrap);
    const groups = state.ingGroups;
    groups.forEach((g, gi) => {
      const gname = groups.length > 1 ? `group ${gi + 1}` : 'the list';
      const list = h('ol', { className: 'editor-lines' });
      g.lines.forEach((line, li) => {
        const inputId = `${p}-ing-${line.id}`;
        const input = h('input', { id: inputId, type: 'text', 'data-key': `ing:${line.id}`, autocomplete: 'off' });
        input.value = line.raw;
        input.addEventListener('input', () => (line.raw = input.value));
        input.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const nl = { id: uid(), raw: '' };
            g.lines.splice(li + 1, 0, nl);
            renderIngredients(`ing:${nl.id}`);
          }
        });
        input.addEventListener('paste', (e: ClipboardEvent) => {
          const text = e.clipboardData?.getData('text/plain') ?? '';
          const parts = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
          if (parts.length < 2) return;
          e.preventDefault();
          const first = line.raw.trim() ? [] : [parts.shift()!];
          if (first.length) line.raw = first[0]!;
          const added = parts.map((raw) => ({ id: uid(), raw }));
          g.lines.splice(li + 1, 0, ...added);
          renderIngredients(`ing:${(added[added.length - 1] ?? line).id}`);
          announce(`Pasted ${added.length + first.length} ingredient lines.`);
        });
        list.appendChild(
          h(
            'li',
            { className: 'editor-line' },
            h('label', { for: inputId, className: 'visually-hidden' }, `Ingredient ${li + 1} in ${gname}`),
            input,
            h(
              'span',
              { className: 'row-actions' },
              iconButton(`ing-up:${line.id}`, '↑', `Move ingredient ${li + 1} up`, () => moveLine(g, li, -1), li === 0),
              iconButton(`ing-down:${line.id}`, '↓', `Move ingredient ${li + 1} down`, () => moveLine(g, li, 1), li === g.lines.length - 1),
              iconButton(`ing-del:${line.id}`, '✕', `Remove ingredient ${li + 1}`, () => removeLine(g, li)),
            ),
          ),
        );
      });
      const titleId = `${p}-ingg-${g.id}`;
      const titleInput = h('input', { id: titleId, type: 'text', 'data-key': `ingg:${g.id}` });
      titleInput.value = g.title;
      titleInput.addEventListener('input', () => (g.title = titleInput.value));
      ingWrap.appendChild(
        h(
          'fieldset',
          { className: 'editor-group' },
          h('legend', {}, `Ingredient group ${gi + 1}`),
          h(
            'div',
            { className: 'field' },
            h('label', { for: titleId }, 'Group heading (optional)'),
            titleInput,
          ),
          h(
            'div',
            { className: 'group-actions' },
            iconButton(`ingg-up:${g.id}`, '↑ Group', `Move ingredient group ${gi + 1} up`, () => moveGroup(state.ingGroups, gi, -1, 'ingg-up', 'ingg-down', renderIngredients, 'Ingredient group'), gi === 0),
            iconButton(`ingg-down:${g.id}`, '↓ Group', `Move ingredient group ${gi + 1} down`, () => moveGroup(state.ingGroups, gi, 1, 'ingg-up', 'ingg-down', renderIngredients, 'Ingredient group'), gi === groups.length - 1),
            groups.length > 1
              ? h('button', { type: 'button', 'data-key': `ingg-del:${g.id}`, onclick: () => removeIngGroup(gi) }, `Remove group ${gi + 1}`)
              : null,
          ),
          list,
          h('button', { type: 'button', 'data-key': `ing-add:${g.id}`, onclick: () => addLine(g) }, 'Add ingredient'),
        ),
      );
    });
    ingWrap.appendChild(
      h('button', { type: 'button', 'data-key': 'ingg-add', onclick: addIngGroup }, 'Add ingredient group'),
    );
    if (focus) focusKey(ingWrap, focus);
  }

  function moveLine(g: IngGroupState, i: number, dir: -1 | 1): void {
    const line = g.lines[i]!;
    move(g.lines, i, i + dir);
    renderIngredients();
    const pos = g.lines.indexOf(line);
    if (!focusKey(ingWrap, `${dir < 0 ? 'ing-up' : 'ing-down'}:${line.id}`)) {
      focusKey(ingWrap, `${dir < 0 ? 'ing-down' : 'ing-up'}:${line.id}`) || focusKey(ingWrap, `ing:${line.id}`);
    }
    announce(`Ingredient moved to position ${pos + 1} of ${g.lines.length}.`);
  }

  function removeLine(g: IngGroupState, i: number): void {
    g.lines.splice(i, 1);
    if (g.lines.length === 0) g.lines.push({ id: uid(), raw: '' });
    renderIngredients();
    const next = g.lines[Math.min(i, g.lines.length - 1)];
    if (next) focusKey(ingWrap, `ing:${next.id}`);
    announce('Ingredient removed.');
  }

  function addLine(g: IngGroupState): void {
    const nl = { id: uid(), raw: '' };
    g.lines.push(nl);
    renderIngredients(`ing:${nl.id}`);
  }

  function addIngGroup(): void {
    const ng: IngGroupState = { id: uid(), title: '', lines: [{ id: uid(), raw: '' }] };
    state.ingGroups.push(ng);
    renderIngredients(`ingg:${ng.id}`);
    announce('Ingredient group added.');
  }

  function removeIngGroup(gi: number): void {
    state.ingGroups.splice(gi, 1);
    renderIngredients();
    const g = state.ingGroups[Math.min(gi, state.ingGroups.length - 1)];
    if (g) focusKey(ingWrap, `ingg:${g.id}`);
    announce('Ingredient group removed.');
  }

  function moveGroup<G extends { id: string }>(
    arr: G[],
    i: number,
    dir: -1 | 1,
    upKey: string,
    downKey: string,
    rerender: () => void,
    noun: string,
  ): void {
    const g = arr[i]!;
    move(arr, i, i + dir);
    rerender();
    const root = container;
    if (!focusKey(root, `${dir < 0 ? upKey : downKey}:${g.id}`)) focusKey(root, `${dir < 0 ? downKey : upKey}:${g.id}`);
    announce(`${noun} moved to position ${arr.indexOf(g) + 1} of ${arr.length}.`);
  }

  // ---------- instructions ----------
  const stepWrap = h('div', { className: 'editor-groups' });

  function renderSteps(focus?: string): void {
    clear(stepWrap);
    const groups = state.stepGroups;
    groups.forEach((g, gi) => {
      const gname = groups.length > 1 ? `group ${gi + 1}` : 'the list';
      const list = h('ol', { className: 'editor-lines editor-steps' });
      g.steps.forEach((step, si) => {
        const tid = `${p}-step-${step.id}`;
        const ta = h('textarea', { id: tid, rows: 3, 'data-key': `step:${step.id}` });
        ta.value = step.text;
        ta.addEventListener('input', () => (step.text = ta.value));
        list.appendChild(
          h(
            'li',
            { className: 'editor-line' },
            h('label', { for: tid, className: 'visually-hidden' }, `Step ${si + 1} in ${gname}`),
            ta,
            h(
              'span',
              { className: 'row-actions' },
              iconButton(`step-up:${step.id}`, '↑', `Move step ${si + 1} up`, () => moveStep(g, si, -1), si === 0),
              iconButton(`step-down:${step.id}`, '↓', `Move step ${si + 1} down`, () => moveStep(g, si, 1), si === g.steps.length - 1),
              iconButton(`step-del:${step.id}`, '✕', `Remove step ${si + 1}`, () => removeStep(g, si)),
            ),
          ),
        );
      });
      const titleId = `${p}-stepg-${g.id}`;
      const titleInput = h('input', { id: titleId, type: 'text', 'data-key': `stepg:${g.id}` });
      titleInput.value = g.title;
      titleInput.addEventListener('input', () => (g.title = titleInput.value));
      stepWrap.appendChild(
        h(
          'fieldset',
          { className: 'editor-group' },
          h('legend', {}, `Instruction group ${gi + 1}`),
          h('div', { className: 'field' }, h('label', { for: titleId }, 'Group heading (optional)'), titleInput),
          h(
            'div',
            { className: 'group-actions' },
            iconButton(`stepg-up:${g.id}`, '↑ Group', `Move instruction group ${gi + 1} up`, () => moveGroup(state.stepGroups, gi, -1, 'stepg-up', 'stepg-down', renderSteps, 'Instruction group'), gi === 0),
            iconButton(`stepg-down:${g.id}`, '↓ Group', `Move instruction group ${gi + 1} down`, () => moveGroup(state.stepGroups, gi, 1, 'stepg-up', 'stepg-down', renderSteps, 'Instruction group'), gi === groups.length - 1),
            groups.length > 1
              ? h('button', { type: 'button', 'data-key': `stepg-del:${g.id}`, onclick: () => removeStepGroup(gi) }, `Remove group ${gi + 1}`)
              : null,
          ),
          list,
          h('button', { type: 'button', 'data-key': `step-add:${g.id}`, onclick: () => addStep(g) }, 'Add step'),
        ),
      );
    });
    stepWrap.appendChild(h('button', { type: 'button', 'data-key': 'stepg-add', onclick: addStepGroup }, 'Add instruction group'));
    if (focus) focusKey(stepWrap, focus);
  }

  function moveStep(g: StepGroupState, i: number, dir: -1 | 1): void {
    const step = g.steps[i]!;
    move(g.steps, i, i + dir);
    renderSteps();
    if (!focusKey(stepWrap, `${dir < 0 ? 'step-up' : 'step-down'}:${step.id}`)) {
      focusKey(stepWrap, `${dir < 0 ? 'step-down' : 'step-up'}:${step.id}`) || focusKey(stepWrap, `step:${step.id}`);
    }
    announce(`Step moved to position ${g.steps.indexOf(step) + 1} of ${g.steps.length}.`);
  }

  function removeStep(g: StepGroupState, i: number): void {
    g.steps.splice(i, 1);
    if (g.steps.length === 0) g.steps.push({ id: uid(), text: '' });
    renderSteps();
    const next = g.steps[Math.min(i, g.steps.length - 1)];
    if (next) focusKey(stepWrap, `step:${next.id}`);
    announce('Step removed.');
  }

  function addStep(g: StepGroupState): void {
    const ns = { id: uid(), text: '' };
    g.steps.push(ns);
    renderSteps(`step:${ns.id}`);
  }

  function addStepGroup(): void {
    const ng: StepGroupState = { id: uid(), title: '', steps: [{ id: uid(), text: '' }] };
    state.stepGroups.push(ng);
    renderSteps(`stepg:${ng.id}`);
    announce('Instruction group added.');
  }

  function removeStepGroup(gi: number): void {
    state.stepGroups.splice(gi, 1);
    renderSteps();
    const g = state.stepGroups[Math.min(gi, state.stepGroups.length - 1)];
    if (g) focusKey(stepWrap, `stepg:${g.id}`);
    announce('Instruction group removed.');
  }

  // ---------- notes, tags, collections ----------
  const notesF = textField('notes', 'Notes', state.notes, (v) => (state.notes = v), { multiline: true, rows: 4 });
  const tagsF = textField('tags', 'Tags', state.tags, (v) => (state.tags = v), {
    hint: 'Separate tags with commas, for example "dinner, vegetarian".',
  });
  const collWrap = h('div', { className: 'editor-collections' }, h('p', { className: 'muted' }, 'Loading collections…'));

  async function loadCollections(): Promise<void> {
    let cols: Collection[];
    try {
      cols = await storage.listCollections();
    } catch (e) {
      if (disposed) return;
      clear(collWrap);
      collWrap.appendChild(h('p', { className: 'muted' }, `Collections are unavailable: ${storageErrorMessage(e)}`));
      return;
    }
    if (disposed) return;
    clear(collWrap);
    if (cols.length === 0) {
      collWrap.appendChild(
        h('p', { className: 'muted' }, 'No collections yet. Create collections in the Library with "Manage collections".'),
      );
      return;
    }
    for (const c of cols) {
      const id = `${p}-col-${c.id}`;
      const cb = h('input', { type: 'checkbox', id, checked: state.collectionIds.has(c.id) });
      cb.addEventListener('change', () => {
        if (cb.checked) state.collectionIds.add(c.id);
        else state.collectionIds.delete(c.id);
      });
      collWrap.appendChild(h('div', { className: 'check-row' }, cb, h('label', { for: id }, c.name)));
    }
  }

  // ---------- form ----------
  const summary = h('div', { className: 'notice error', role: 'alert', hidden: true, tabindex: '-1' });
  const saveBtn = h('button', { type: 'submit', className: 'primary' }, opts.saveLabel ?? 'Save recipe');
  const cancelBtn = h('button', { type: 'button', onclick: () => cancel() }, 'Cancel');

  const form = h(
    'form',
    { className: 'rp-editor', novalidate: true, 'aria-labelledby': `${p}-h` },
    h('h2', { id: `${p}-h` }, original.title ? 'Edit recipe' : 'New recipe'),
    live,
    summary,
    h('fieldset', { className: 'editor-section' }, h('legend', {}, 'Details'), titleF.wrap, urlF.wrap, authorF.wrap, yieldF.wrap, timesF.wrap),
    h(
      'fieldset',
      { className: 'editor-section' },
      h('legend', {}, 'Photo (optional)'),
      imgPreview,
      h('label', { for: `${p}-img` }, 'Choose a photo from this device'),
      h('p', { id: `${p}-img-hint`, className: 'hint muted' }, 'PNG, JPEG or WebP, up to 5 MB. The photo stays on this device.'),
      imgInput,
      removeImgBtn,
      imgError,
    ),
    h(
      'section',
      { className: 'editor-section', 'aria-labelledby': `${p}-ing-h` },
      h('h3', { id: `${p}-ing-h` }, 'Ingredients'),
      h('p', { className: 'hint muted' }, 'One ingredient per line, exactly as you want it shown. Press Enter for a new line; pasting several lines adds one per line.'),
      ingWrap,
    ),
    h(
      'section',
      { className: 'editor-section', 'aria-labelledby': `${p}-step-h` },
      h('h3', { id: `${p}-step-h` }, 'Instructions'),
      stepWrap,
    ),
    h('fieldset', { className: 'editor-section' }, h('legend', {}, 'Notes and organization'), notesF.wrap, tagsF.wrap,
      h('fieldset', { className: 'editor-subsection' }, h('legend', {}, 'Collections'), collWrap)),
    h('div', { className: 'editor-actions' }, saveBtn, cancelBtn),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void save();
  });

  // ---------- validation and build ----------
  function validate(): { field: { input: HTMLElement; error: HTMLElement }; msg: string }[] {
    const problems: { field: { input: HTMLElement; error: HTMLElement }; msg: string }[] = [];
    setFieldError(titleF, null);
    setFieldError(urlF, null);
    if (!state.title.trim()) problems.push({ field: titleF, msg: 'Add a title.' });
    const u = state.url.trim();
    if (u && !normalizeSourceUrl(u)) problems.push({ field: urlF, msg: URL_ERROR });
    for (const pr of problems) setFieldError(pr.field, pr.msg);
    return problems;
  }

  function build(): RecipeV1 {
    const r = clone(original);
    r.title = state.title.trim();
    const u = state.url.trim();
    r.source = { ...r.source, url: u ? (normalizeSourceUrl(u) ?? '') : '' };
    const author = state.author.trim();
    if (author) r.source.author = author;
    else delete r.source.author;

    const yt = state.yieldText.trim();
    if (yt !== original.originalYield.text.trim()) {
      r.originalYield = { text: yt };
      if (yt) {
        const parsed = parseYield(yt);
        if (parsed.quantity) r.originalYield.quantity = toQuantityV1(parsed.quantity);
        if (parsed.unit) r.originalYield.unit = parsed.unit;
      }
    }
    const tr = state.timesRaw.trim();
    if (tr !== original.times.raw.trim()) {
      // Structured durations came from the source; they no longer match edited text.
      r.times = { raw: tr };
    }

    const origItems = new Map<string, IngredientItem>();
    for (const g of original.ingredientGroups) for (const i of g.items) origItems.set(i.id, i);
    r.ingredientGroups = state.ingGroups
      .map((g) => ({
        id: g.id,
        title: g.title.trim(),
        items: g.lines
          .map((l) => ({ id: l.id, raw: l.raw.trim() }))
          .filter((l) => l.raw)
          .map((l) => {
            const prev = origItems.get(l.id);
            return prev && prev.raw === l.raw ? clone(prev) : toIngredientItem(l.raw, l.id);
          }),
      }))
      .filter((g) => g.items.length > 0);
    r.instructionGroups = state.stepGroups
      .map((g) => ({
        id: g.id,
        title: g.title.trim(),
        steps: g.steps.map((s) => ({ id: s.id, text: s.text.trim() })).filter((s) => s.text),
      }))
      .filter((g) => g.steps.length > 0);

    r.notes = state.notes.trim();
    r.tags = parseTags(state.tags);
    r.collectionIds = Array.from(state.collectionIds);
    if (state.localImageId) r.localImageId = state.localImageId;
    else delete r.localImageId;

    const filled: Record<RecipeField, boolean> = {
      title: !!r.title,
      ingredients: r.ingredientGroups.length > 0,
      instructions: r.instructionGroups.length > 0,
      yield: !!r.originalYield.text,
      times: !!r.times.raw || !!r.times.total || !!r.times.prep || !!r.times.cook,
      author: !!r.source.author,
    };
    r.extraction = { ...r.extraction, missingFields: r.extraction.missingFields.filter((f) => !filled[f]) };
    return r;
  }

  function showSummary(lines: string[]): void {
    clear(summary);
    summary.appendChild(h('p', {}, h('strong', {}, lines.length > 1 ? 'Fix these problems before saving:' : 'Fix this problem before saving:')));
    summary.appendChild(h('ul', {}, lines.map((l) => h('li', {}, l))));
    summary.hidden = false;
  }

  async function cleanupImages(keep: string | undefined): Promise<void> {
    const toDelete = new Set<string>();
    for (const id of uploaded) if (id !== keep) toDelete.add(id);
    if (original.localImageId && original.localImageId !== keep) toDelete.add(original.localImageId);
    uploaded.clear();
    for (const id of toDelete) await storage.deleteImage(id).catch(() => undefined);
  }

  async function save(): Promise<void> {
    if (saving) return;
    summary.hidden = true;
    const problems = validate();
    if (problems.length) {
      showSummary(problems.map((pr) => pr.msg));
      (problems[0]!.field.input as HTMLElement).focus();
      return;
    }
    let result: RecipeV1;
    try {
      result = build();
    } catch (e) {
      showSummary([`The recipe could not be prepared: ${e instanceof Error ? e.message : String(e)}`]);
      summary.focus();
      return;
    }
    saving = true;
    saveBtn.disabled = true;
    saveBtn.setAttribute('aria-busy', 'true');
    announce('Saving…');
    try {
      await opts.onSave(result);
      committed = true;
      await cleanupImages(result.localImageId);
    } catch (e) {
      if (!disposed) {
        showSummary([e instanceof Error && e.message ? e.message : storageErrorMessage(e)]);
        summary.focus();
      }
    } finally {
      saving = false;
      saveBtn.disabled = false;
      saveBtn.removeAttribute('aria-busy');
    }
  }

  function cancel(): void {
    // Images uploaded in this session were never committed; the original stays.
    for (const id of uploaded) void storage.deleteImage(id).catch(() => undefined);
    uploaded.clear();
    opts.onCancel();
  }

  // ---------- mount ----------
  clear(container);
  container.appendChild(form);
  renderIngredients();
  renderSteps();
  void loadInitialImage();
  void loadCollections();

  return () => {
    if (disposed) return;
    disposed = true;
    revokeUrl();
    if (!saving && !committed) {
      for (const id of uploaded) void storage.deleteImage(id).catch(() => undefined);
      uploaded.clear();
    }
    if (form.parentNode === container) container.removeChild(form);
  };
}

const URL_ERROR = 'Enter a full web address starting with http:// or https://, or leave the source link empty.';

/** An empty manual recipe for "New recipe" (R07). */
export function emptyRecipe(): RecipeV1 {
  return {
    schemaVersion: 1,
    id: uid(),
    title: '',
    source: { url: '' },
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
