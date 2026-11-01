/**
 * Pure recipe renderer shared by the side panel, cook mode, print page and the
 * library viewer (UI owner B). All recipe text is untrusted page data and is
 * inserted only as text through h(). No remote images are ever rendered.
 */
import { h } from '../../shared/dom';
import type { IngredientItem, RecipeV1, UnitSystem } from '../../shared/types';
import {
  add,
  parseServingsInput,
  rational,
  scaleFactorForServings,
  toNumber,
  type Rational,
} from '../../domain/index';
import { displayHost, formatDuration, isHttpUrl } from '../common/format';
import { missingSections } from '../common/reader-state';
import {
  ONE,
  UNIT_SYSTEM_LABELS,
  displayIngredient,
  formatAmount,
  isIdentity,
  originalServings,
  targetServings,
} from '../common/scale';

export { displayIngredient } from '../common/scale';

export interface RecipeViewOptions {
  factor: Rational;
  system: UnitSystem;
  /** Render ingredient checkboxes (cook mode). */
  showChecks?: boolean;
  /** Default true. */
  includeNotes?: boolean;
  /** Show the original source line under every changed ingredient. */
  showOriginal?: boolean;
  /** When provided, a "Show original lines" toggle button is rendered and calls back with the new value. */
  onToggleOriginal?: (show: boolean) => void;
  /** Heading level for the recipe title (default 2); sections use level + 1. */
  headingLevel?: 1 | 2 | 3;
  /** Checked ingredient ids (with showChecks). */
  checked?: ReadonlySet<string>;
  onCheck?: (itemId: string, checked: boolean) => void;
  /** Hide the title/attribution header (cook mode renders its own). */
  hideHeader?: boolean;
}

type Level = 1 | 2 | 3 | 4 | 5;
const heading = (level: number, attrs: Record<string, string>, ...children: (Node | string)[]) => {
  const l = Math.min(6, Math.max(1, level));
  return h(`h${l}` as 'h1', attrs, ...children);
};

let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

function hasTransform(opts: Pick<RecipeViewOptions, 'factor' | 'system'>): boolean {
  return !isIdentity(opts.factor) || opts.system !== 'original';
}

/** Approximate marker: visible "≈" plus a screen-reader word. */
export function approxMarker(): HTMLElement[] {
  return [
    h('span', { className: 'approx', 'aria-hidden': 'true' }, '≈ '),
    h('span', { className: 'visually-hidden' }, 'approximately '),
  ];
}

/** One ingredient <li>, with optional checkbox, approximate marker, note and original line. */
export function renderIngredientLine(item: IngredientItem, opts: RecipeViewOptions): HTMLLIElement {
  const d = displayIngredient(item, opts.factor, opts.system);
  const transformed = hasTransform(opts);
  let note = d.note;
  if (!note && d.unchanged && transformed && item.quantity) note = 'Not adjusted; shown as written.';
  const textEl = h('span', { className: 'ing-text' }, d.approximate ? approxMarker() : null, d.text);
  const extras: HTMLElement[] = [];
  if (note) {
    extras.push(h('span', { className: 'ing-note' }, h('span', { className: 'visually-hidden' }, 'Note: '), note));
  }
  if (opts.showOriginal && d.original !== d.text) {
    extras.push(h('span', { className: 'ing-original' }, 'Original: ', d.original));
  }
  const li = h('li', {
    className: `ingredient${d.approximate ? ' is-approx' : ''}${note ? ' has-note' : ''}`,
    'data-item-id': item.id,
  });
  if (opts.showChecks) {
    const id = nextId('ing');
    const box = h('input', { type: 'checkbox', id, checked: opts.checked?.has(item.id) ?? false });
    box.addEventListener('change', () => opts.onCheck?.(item.id, box.checked));
    li.appendChild(h('label', { for: id, className: 'check-label' }, box, h('span', {}, textEl, extras)));
  } else {
    li.append(textEl, ...extras);
  }
  return li;
}

function missingNotice(what: string): HTMLElement {
  return h(
    'p',
    { className: 'notice warn missing', 'data-missing': what },
    h('span', { 'aria-hidden': 'true' }, '! '),
    `Missing: no ${what} were found for this recipe.`,
  );
}

export function renderIngredientGroups(recipe: RecipeV1, opts: RecipeViewOptions, level: Level = 3): HTMLElement {
  const headingId = nextId('ingredients');
  const section = h('section', { className: 'recipe-section ingredients', 'aria-labelledby': headingId });
  const head = h('div', { className: 'section-head' }, heading(level, { id: headingId }, 'Ingredients'));
  if (opts.onToggleOriginal && hasTransform(opts)) {
    const show = !!opts.showOriginal;
    head.appendChild(
      h(
        'button',
        { type: 'button', className: 'link-button', 'aria-pressed': String(show), onclick: () => opts.onToggleOriginal?.(!show) },
        show ? 'Hide original lines' : 'Show original lines',
      ),
    );
  }
  section.appendChild(head);
  const groups = (recipe.ingredientGroups ?? []).filter((g) => g.items.length > 0);
  if (groups.length === 0) {
    section.appendChild(missingNotice('ingredients'));
    return section;
  }
  for (const g of groups) {
    const wrap = h('div', { className: 'group' });
    if (g.title) wrap.appendChild(heading(level + 1, { className: 'group-title' }, g.title));
    wrap.appendChild(h('ul', { className: 'ingredient-list' }, g.items.map((it) => renderIngredientLine(it, opts))));
    section.appendChild(wrap);
  }
  return section;
}

export function renderInstructionGroups(recipe: RecipeV1, level: Level = 3): HTMLElement {
  const headingId = nextId('steps');
  const section = h(
    'section',
    { className: 'recipe-section instructions', 'aria-labelledby': headingId },
    heading(level, { id: headingId }, 'Steps'),
  );
  const groups = (recipe.instructionGroups ?? []).filter((g) => g.steps.length > 0);
  if (groups.length === 0) {
    section.appendChild(missingNotice('steps'));
    return section;
  }
  for (const g of groups) {
    const wrap = h('div', { className: 'group' });
    if (g.title) wrap.appendChild(heading(level + 1, { className: 'group-title' }, g.title));
    wrap.appendChild(
      h('ol', { className: 'step-list' }, g.steps.map((s) => h('li', { className: 'step', 'data-step-id': s.id }, s.text))),
    );
    section.appendChild(wrap);
  }
  return section;
}

function metaItem(label: string, value: string | HTMLElement): HTMLElement[] {
  return [h('dt', {}, label), h('dd', {}, value)];
}

function renderMeta(recipe: RecipeV1, opts: RecipeViewOptions): HTMLElement | null {
  const items: HTMLElement[] = [];
  const missing = new Set(recipe.extraction?.missingFields ?? []);
  const y = recipe.originalYield;
  if (y?.text) {
    let value = y.text;
    if (!isIdentity(opts.factor)) {
      const target = safe(() => targetServings(recipe, opts.factor), null);
      value = target
        ? `${formatAmount(target)} (original: ${y.text})`
        : `×${formatAmount(opts.factor)} (original: ${y.text})`;
    }
    items.push(...metaItem('Yield', value));
  } else if (missing.has('yield')) {
    items.push(...metaItem('Yield', h('span', { className: 'muted' }, 'Not listed')));
  }
  const t = recipe.times;
  const times: [string, string | undefined][] = [
    ['Prep', t?.prep],
    ['Cook', t?.cook],
    ['Total', t?.total],
  ];
  let anyTime = false;
  for (const [label, iso] of times) {
    const v = formatDuration(iso);
    if (v) {
      anyTime = true;
      items.push(...metaItem(label, v));
    }
  }
  if (!anyTime && t?.raw) items.push(...metaItem('Time', t.raw));
  else if (!anyTime && missing.has('times')) items.push(...metaItem('Time', h('span', { className: 'muted' }, 'Not listed')));
  return items.length ? h('dl', { className: 'recipe-meta' }, items) : null;
}

/** Source link + author/publisher attribution. Links open in a new tab without referrer. */
export function renderAttribution(recipe: RecipeV1): HTMLElement | null {
  const parts: (Node | string)[] = [];
  const url = recipe.source?.url;
  if (isHttpUrl(url)) {
    parts.push(
      'Source: ',
      h('a', { href: url, target: '_blank', rel: 'noreferrer noopener', className: 'source-link' }, displayHost(url)),
    );
  }
  if (recipe.source?.author) parts.push(parts.length ? ' · ' : '', `By ${recipe.source.author}`);
  if (recipe.source?.publisher && recipe.source.publisher !== recipe.source.author) {
    parts.push(parts.length ? ' · ' : '', recipe.source.publisher);
  }
  return parts.length ? h('p', { className: 'attribution' }, parts) : null;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * Render a complete recipe. Pure: reads only `recipe` and `opts`, mutates nothing.
 */
export function renderRecipeView(recipe: RecipeV1, opts: RecipeViewOptions): HTMLElement {
  const level = (opts.headingLevel ?? 2) as Level;
  const titleId = nextId('recipe-title');
  const article = h('article', { className: 'recipe-view', 'aria-labelledby': titleId });
  const missing = missingSections(recipe);
  if (!opts.hideHeader) {
    const title = recipe.title?.trim();
    article.appendChild(
      heading(level, { id: titleId, className: 'recipe-title' }, title || 'Untitled recipe'),
    );
    if (!title || missing.includes('title')) {
      article.appendChild(h('p', { className: 'muted' }, 'The page did not provide a recipe title.'));
    }
    const attribution = renderAttribution(recipe);
    if (attribution) article.appendChild(attribution);
    const meta = renderMeta(recipe, opts);
    if (meta) article.appendChild(meta);
  } else {
    article.appendChild(h('span', { id: titleId, className: 'visually-hidden' }, recipe.title || 'Untitled recipe'));
  }
  article.appendChild(renderIngredientGroups(recipe, opts, (level + 1) as Level));
  article.appendChild(renderInstructionGroups(recipe, (level + 1) as Level));
  if ((opts.includeNotes ?? true) && recipe.notes?.trim()) {
    const notesId = nextId('notes');
    article.appendChild(
      h(
        'section',
        { className: 'recipe-section notes', 'aria-labelledby': notesId },
        heading(level + 1, { id: notesId }, 'Notes'),
        recipe.notes
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => h('p', { className: 'note-text' }, p)),
      ),
    );
  }
  return article;
}

// ---------------------------------------------------------------------------
// Servings / units control
// ---------------------------------------------------------------------------

export interface ScaleChange {
  factor: Rational;
  system: UnitSystem;
}

export interface ScaleControlOptions {
  factor: Rational;
  system: UnitSystem;
  onChange: (change: ScaleChange) => void;
}

const MULTIPLIERS: { label: string; aria: string; value: Rational }[] = [
  { label: '×½', aria: 'Half', value: { n: 1, d: 2 } },
  { label: '×1', aria: 'Original amounts', value: { n: 1, d: 1 } },
  { label: '×2', aria: 'Double', value: { n: 2, d: 1 } },
  { label: '×3', aria: 'Triple', value: { n: 3, d: 1 } },
];

function sameRational(a: Rational, b: Rational): boolean {
  return a.n * b.d === b.n * a.d;
}

/**
 * Servings input ("1 1/2"), +/- and reset when the yield is numeric; otherwise
 * a multiplier (×½ ×1 ×2 ×3 and custom). Plus an explicit unit-system select.
 * The control keeps its own display in sync and reports changes via onChange.
 */
export function renderScaleControls(recipe: RecipeV1, opts: ScaleControlOptions): HTMLElement {
  let factor = opts.factor;
  let system = opts.system;
  const orig = originalServings(recipe);
  const root = h('div', { className: 'scale-controls' });
  const errorId = nextId('scale-error');
  const errorEl = h('p', { id: errorId, className: 'field-error', hidden: true });

  const emit = () => opts.onChange({ factor, system });
  const showError = (msg: string | null, input: HTMLInputElement) => {
    errorEl.textContent = msg ?? '';
    errorEl.hidden = !msg;
    if (msg) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };

  if (orig) {
    const inputId = nextId('servings');
    const input = h('input', {
      id: inputId,
      type: 'text',
      inputmode: 'decimal',
      autocomplete: 'off',
      className: 'servings-input',
      'aria-describedby': `${errorId} ${inputId}-hint`,
      size: 6,
    });
    const minus = h('button', { type: 'button', className: 'icon-button', 'aria-label': 'Decrease servings' }, '−');
    const plus = h('button', { type: 'button', className: 'icon-button', 'aria-label': 'Increase servings' }, '+');
    const reset = h('button', { type: 'button' }, 'Reset');
    const hint = h('p', { id: `${inputId}-hint`, className: 'hint muted' }, `Original: ${recipe.originalYield.text || formatAmount(orig)}`);

    const target = () => safe(() => targetServings(recipe, factor), null) ?? orig;
    const sync = () => {
      input.value = formatAmount(target());
      minus.disabled = safe(() => toNumber(target()), 1) <= 1;
      reset.disabled = isIdentity(factor);
    };
    const setTarget = (t: Rational) => {
      const f = safe(() => scaleFactorForServings(recipe, t), null);
      if (!f) {
        showError('Could not scale to that number of servings.', input);
        return;
      }
      factor = f;
      showError(null, input);
      sync();
      emit();
    };
    input.addEventListener('change', () => {
      const t = safe(() => parseServingsInput(input.value), null);
      if (!t) {
        showError('Enter a number of servings greater than 0, such as 4, 1 1/2 or 2.5.', input);
        return;
      }
      setTarget(t);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.dispatchEvent(new Event('change'));
      }
    });
    minus.addEventListener('click', () => {
      const t = target();
      if (safe(() => toNumber(t), 1) > 1) setTarget(safe(() => add(t, rational(-1)), t));
    });
    plus.addEventListener('click', () => setTarget(safe(() => add(target(), rational(1)), target())));
    reset.addEventListener('click', () => {
      factor = ONE;
      showError(null, input);
      sync();
      emit();
    });
    sync();
    root.appendChild(
      h(
        'div',
        { className: 'servings-field' },
        h('label', { for: inputId }, 'Servings'),
        h('div', { className: 'stepper' }, minus, input, plus, reset),
        hint,
        errorEl,
      ),
    );
  } else {
    const legendId = nextId('scale-legend');
    const buttons = MULTIPLIERS.map((m) =>
      h('button', { type: 'button', className: 'chip', 'aria-label': `${m.label}: ${m.aria}`, 'data-factor': `${m.value.n}/${m.value.d}` }, m.label),
    );
    const customId = nextId('multiplier');
    const custom = h('input', {
      id: customId,
      type: 'text',
      inputmode: 'decimal',
      autocomplete: 'off',
      size: 5,
      'aria-describedby': errorId,
    });
    const sync = () => {
      buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(sameRational(MULTIPLIERS[i]!.value, factor))));
      const preset = MULTIPLIERS.some((m) => sameRational(m.value, factor));
      custom.value = preset ? '' : formatAmount(factor);
    };
    buttons.forEach((b, i) =>
      b.addEventListener('click', () => {
        factor = MULTIPLIERS[i]!.value;
        showError(null, custom);
        sync();
        emit();
      }),
    );
    custom.addEventListener('change', () => {
      if (!custom.value.trim()) return;
      const f = safe(() => parseServingsInput(custom.value), null);
      if (!f) {
        showError('Enter a multiplier greater than 0, such as 1 1/2 or 0.75.', custom);
        return;
      }
      factor = f;
      showError(null, custom);
      sync();
      emit();
    });
    custom.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        custom.dispatchEvent(new Event('change'));
      }
    });
    sync();
    root.appendChild(
      h(
        'div',
        { className: 'multiplier-field', role: 'group', 'aria-labelledby': legendId },
        h('span', { id: legendId, className: 'field-label' }, 'Scale amounts'),
        h('p', { className: 'hint muted' }, 'This recipe has no numeric servings, so choose a multiplier.'),
        h('div', { className: 'chip-row' }, buttons, h('label', { for: customId, className: 'inline-label' }, 'Custom ×'), custom),
        errorEl,
      ),
    );
  }

  const selectId = nextId('units');
  const select = h(
    'select',
    { id: selectId },
    (Object.keys(UNIT_SYSTEM_LABELS) as UnitSystem[]).map((s) =>
      h('option', { value: s, selected: s === system }, UNIT_SYSTEM_LABELS[s]),
    ),
  );
  select.value = system;
  select.addEventListener('change', () => {
    system = select.value as UnitSystem;
    emit();
  });
  root.appendChild(h('div', { className: 'units-field' }, h('label', { for: selectId }, 'Units'), select));
  return root;
}
