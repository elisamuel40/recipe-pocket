/**
 * Print page view (R06): attribution, groups, notes toggle, selected servings
 * and units. Controls are hidden by print CSS. No upload; window.print() only.
 */
import { clear, h } from '../../shared/dom';
import type { RecipeV1 } from '../../shared/types';
import type { PrintViewOptions } from '../common/print-params';
import { isHttpUrl } from '../common/format';
import { UNIT_SYSTEM_LABELS, scaleSummary } from '../common/scale';
import { renderRecipeView } from './recipe-view';

export function renderPrintPage(root: HTMLElement, recipe: RecipeV1, options: PrintViewOptions, print: () => void = () => window.print()): void {
  let includeNotes = options.includeNotes;
  const articleHost = h('div', { className: 'print-article' });
  const notesId = 'print-include-notes';
  const notesBox = h('input', { type: 'checkbox', id: notesId, checked: includeNotes });
  const hasNotes = !!recipe.notes?.trim();
  notesBox.disabled = !hasNotes;

  const render = () => {
    const article = renderRecipeView(recipe, { factor: options.factor, system: options.system, includeNotes, headingLevel: 1 });
    const title = article.querySelector('.recipe-title');
    const summary = h(
      'p',
      { className: 'print-summary' },
      `${scaleSummary(recipe, options.factor)} · Units: ${UNIT_SYSTEM_LABELS[options.system]}`,
    );
    if (title?.nextSibling) article.insertBefore(summary, title.nextSibling);
    else article.prepend(summary);
    const footer = h('footer', { className: 'print-attribution' });
    const url = recipe.source?.url;
    if (isHttpUrl(url)) footer.appendChild(h('p', {}, 'Original recipe: ', h('span', { className: 'print-url' }, url)));
    if (recipe.source?.author) footer.appendChild(h('p', {}, `Author: ${recipe.source.author}`));
    if (recipe.source?.publisher) footer.appendChild(h('p', {}, `Publisher: ${recipe.source.publisher}`));
    footer.appendChild(h('p', { className: 'muted' }, 'Printed locally with Recipe Pocket.'));
    article.appendChild(footer);
    articleHost.replaceChildren(article);
  };

  notesBox.addEventListener('change', () => {
    includeNotes = notesBox.checked;
    render();
  });

  const controls = h(
    'header',
    { className: 'print-controls no-print', 'aria-label': 'Print options' },
    h('button', { type: 'button', className: 'primary', onclick: () => print() }, 'Print / Save as PDF'),
    h('div', { className: 'inline-field' }, notesBox, h('label', { for: notesId }, hasNotes ? 'Include notes' : 'Include notes (this recipe has none)')),
    h('p', { className: 'muted hint' }, 'To save a PDF, choose “Save as PDF” as the destination in the print dialog. Nothing is uploaded.'),
  );

  clear(root);
  const main = h('main', { id: 'main' }, articleHost);
  root.append(controls, main);
  document.title = `${recipe.title || 'Untitled recipe'} – Recipe Pocket`;
  render();
}

export function renderPrintProblem(root: HTMLElement, title: string, message: string): void {
  clear(root);
  root.appendChild(h('main', { id: 'main', className: 'print-problem' }, h('h1', {}, title), h('p', {}, message)));
}
