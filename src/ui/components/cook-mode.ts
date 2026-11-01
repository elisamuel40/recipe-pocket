/**
 * Cook mode (R08): large adjustable text, theme choice, ingredient checks,
 * current-step focus with Next/Previous and keyboard (ArrowLeft/ArrowRight, k/j).
 * Progress lives only in this component and is discarded on close.
 */
import { clear, h } from '../../shared/dom';
import type { Preferences, RecipeV1, ThemePreference, UnitSystem } from '../../shared/types';
import type { Rational } from '../../domain/index';
import { renderIngredientGroups } from './recipe-view';

export interface CookModeOptions {
  factor: Rational;
  system: UnitSystem;
  prefs: Pick<Preferences, 'theme' | 'fontScale'>;
  /** Called when the user changes text size or theme; the caller applies and persists. */
  onPrefsChange: (patch: Partial<Pick<Preferences, 'theme' | 'fontScale'>>) => void;
  onClose: () => void;
}

export interface FlatStep {
  id: string;
  text: string;
  groupTitle: string;
}

export function flattenSteps(recipe: RecipeV1): FlatStep[] {
  return (recipe.instructionGroups ?? []).flatMap((g) => g.steps.map((s) => ({ id: s.id, text: s.text, groupTitle: g.title })));
}

export const FONT_MIN = 0.8;
export const FONT_MAX = 2.5;
export const FONT_STEP = 0.1;

export function clampFontScale(v: number): number {
  return Math.round(Math.min(FONT_MAX, Math.max(FONT_MIN, v)) * 10) / 10;
}

/** Mounts cook mode into container. Returns a cleanup function (removes key listener, clears progress). */
export function mountCookMode(container: HTMLElement, recipe: RecipeV1, opts: CookModeOptions): () => void {
  const steps = flattenSteps(recipe);
  const checked = new Set<string>();
  let current = 0;
  let fontScale = clampFontScale(opts.prefs.fontScale || 1);
  let theme: ThemePreference = opts.prefs.theme;

  const live = h('div', { className: 'visually-hidden', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const titleId = `cook-title-${Math.random().toString(36).slice(2)}`;
  const title = h('h2', { id: titleId, tabindex: '-1', className: 'cook-title' }, 'Cook mode: ', recipe.title || 'Untitled recipe');

  // Toolbar
  const sizeLabel = h('span', { className: 'cook-size', 'aria-live': 'polite' });
  const smaller = h('button', { type: 'button', 'aria-label': 'Smaller text' }, 'A−');
  const larger = h('button', { type: 'button', 'aria-label': 'Larger text' }, 'A+');
  const themeId = `${titleId}-theme`;
  const themeSelect = h(
    'select',
    { id: themeId },
    h('option', { value: 'system' }, 'System'),
    h('option', { value: 'light' }, 'Light'),
    h('option', { value: 'dark' }, 'Dark'),
  );
  themeSelect.value = theme;
  const close = h('button', { type: 'button', className: 'primary' }, 'Exit cook mode');

  const syncSize = () => {
    sizeLabel.textContent = `Text ${Math.round(fontScale * 100)}%`;
    smaller.disabled = fontScale <= FONT_MIN;
    larger.disabled = fontScale >= FONT_MAX;
  };
  const changeSize = (delta: number) => {
    const next = clampFontScale(fontScale + delta);
    if (next === fontScale) return;
    fontScale = next;
    syncSize();
    opts.onPrefsChange({ fontScale });
  };
  smaller.addEventListener('click', () => changeSize(-FONT_STEP));
  larger.addEventListener('click', () => changeSize(FONT_STEP));
  themeSelect.addEventListener('change', () => {
    theme = themeSelect.value as ThemePreference;
    opts.onPrefsChange({ theme });
  });
  close.addEventListener('click', () => opts.onClose());

  const toolbar = h(
    'div',
    { className: 'cook-toolbar', role: 'toolbar', 'aria-label': 'Cook mode settings' },
    h('div', { className: 'button-row' }, smaller, sizeLabel, larger),
    h('div', { className: 'inline-field' }, h('label', { for: themeId }, 'Theme'), themeSelect),
    close,
  );

  // Current step
  const stepCount = h('p', { className: 'cook-step-count' });
  const stepGroup = h('p', { className: 'cook-step-group muted' });
  const stepText = h('p', { className: 'cook-step-text' });
  const prev = h('button', { type: 'button' }, '← Previous');
  const next = h('button', { type: 'button', className: 'primary' }, 'Next →');
  const stepList = h('ol', { className: 'cook-step-list' });

  const renderList = () => {
    clear(stepList);
    steps.forEach((s, i) => {
      const btn = h(
        'button',
        { type: 'button', className: 'cook-step-button', 'aria-label': `Go to step ${i + 1}: ${s.text}` },
        s.text,
      );
      btn.addEventListener('click', () => go(i));
      stepList.appendChild(
        h('li', { className: i === current ? 'current' : i < current ? 'done' : '', 'aria-current': i === current ? 'step' : null }, btn),
      );
    });
  };

  const renderStep = (announce: boolean) => {
    if (steps.length === 0) {
      stepCount.textContent = 'No steps';
      stepText.textContent = 'This recipe has no steps.';
      prev.disabled = true;
      next.disabled = true;
      return;
    }
    const s = steps[current]!;
    stepCount.textContent = `Step ${current + 1} of ${steps.length}`;
    stepGroup.textContent = s.groupTitle;
    stepGroup.hidden = !s.groupTitle;
    stepText.textContent = s.text;
    prev.disabled = current === 0;
    next.disabled = current === steps.length - 1;
    renderList();
    if (announce) {
      live.textContent = '';
      live.textContent = `Step ${current + 1} of ${steps.length}. ${s.text}`;
    }
  };

  const go = (i: number) => {
    if (i < 0 || i >= steps.length || i === current) return;
    current = i;
    renderStep(true);
  };
  prev.addEventListener('click', () => go(current - 1));
  next.addEventListener('click', () => go(current + 1));

  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName;
    const typing =
      tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && (t as HTMLInputElement).type !== 'checkbox') || t?.isContentEditable;
    if (typing) return;
    if (e.key === 'ArrowRight' || e.key === 'j') {
      e.preventDefault();
      go(current + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'k') {
      e.preventDefault();
      go(current - 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      opts.onClose();
    }
  };
  document.addEventListener('keydown', onKey);

  const ingredients = renderIngredientGroups(
    recipe,
    {
      factor: opts.factor,
      system: opts.system,
      showChecks: true,
      checked,
      onCheck: (id, on) => (on ? checked.add(id) : checked.delete(id)),
    },
    3,
  );

  const root = h(
    'section',
    { className: 'cook-mode', 'aria-labelledby': titleId },
    title,
    toolbar,
    h('p', { className: 'hint muted' }, 'Use Next and Previous, or the arrow keys (also J and K). Progress is cleared when you exit.'),
    h(
      'section',
      { className: 'cook-current', 'aria-label': 'Current step' },
      stepCount,
      stepGroup,
      stepText,
      h('div', { className: 'button-row cook-nav' }, prev, next),
    ),
    ingredients,
    h('section', { className: 'recipe-section', 'aria-label': 'All steps' }, h('h3', {}, 'All steps'), stepList),
    live,
  );

  clear(container);
  container.appendChild(root);
  syncSize();
  renderStep(false);
  title.focus();

  return () => {
    document.removeEventListener('keydown', onKey);
    checked.clear();
    root.remove();
  };
}
