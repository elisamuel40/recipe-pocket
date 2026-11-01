/**
 * Bundled help and troubleshooting (PRD R14). Owner: UI owner B.
 * Plain text only; shown in Settings. No remote content.
 */
import { h } from '../shared/dom';

interface Topic {
  title: string;
  body: (string | HTMLElement)[];
}

const TOPICS: Topic[] = [
  {
    title: 'Read a recipe',
    body: [
      'Open a recipe page, then click the Recipe Pocket icon in the Chrome toolbar. The side panel opens and reads only that tab, only when you click.',
      'Nothing is saved until you select Save. Closing the panel discards an unsaved recipe.',
    ],
  },
  {
    title: 'Pages that cannot be read',
    body: [
      'Chrome does not let extensions read some pages: chrome:// pages, the Chrome Web Store, other extensions, the built-in PDF viewer and some local files. The panel says "restricted page" when this happens.',
      'To save a recipe from one of these pages, select "New recipe" in the Library and type or paste it.',
    ],
  },
  {
    title: 'Sites that block reading',
    body: [
      'Some sites show a robot check, require a login or use a paywall. Recipe Pocket does not bypass these. Finish the check or sign in as you normally would, reload the page, then try again.',
      'If the recipe still cannot be read, copy the text from the page and create a recipe by hand.',
    ],
  },
  {
    title: 'Partial or missing recipes',
    body: [
      'If a page has no complete recipe, the panel highlights what is missing (for example ingredients or steps). Missing parts are left empty, never made up.',
      'Use Edit to fill in the gaps before you save. If a page has several recipes, choose the one you want; recipes are never combined automatically.',
    ],
  },
  {
    title: 'Back up and move your recipes',
    body: [
      'In Settings, select "Export backup" to save a JSON file with your recipes, collections and shopping lists. Keep it somewhere safe: Recipe Pocket has no cloud copy.',
      'To restore or move to another computer, select "Import backup". You see what will change before anything is written, and existing recipes are skipped unless you choose otherwise.',
      'Exported files and PDFs are outside the extension. Deleting data in Recipe Pocket does not delete them.',
    ],
  },
  {
    title: 'Keyboard use',
    body: [
      h(
        'ul',
        {},
        h('li', {}, 'Tab and Shift+Tab move between controls; Enter or Space activates buttons and checkboxes.'),
        h('li', {}, 'Escape closes a dialog without making changes.'),
        h('li', {}, 'In the editor, Enter in an ingredient line adds a new line. Use the arrow buttons next to a line or step to reorder it.'),
        h('li', {}, 'To open the side panel from the keyboard, assign a shortcut to Recipe Pocket at chrome://extensions/shortcuts.'),
      ),
    ],
  },
  {
    title: 'Storage is full or saving fails',
    body: [
      'If saving fails because the device is out of space, your existing recipes are kept. Free up disk space or delete recipes you no longer need, then try again.',
      'If session-only mode is on, nothing can be saved. Turn it off in Settings.',
    ],
  },
];

/** Help section content. Each topic is a <details> so the page stays short. */
export function renderHelp(headingLevel: 2 | 3 = 3): HTMLElement {
  const wrap = h('div', { className: 'help-topics' });
  for (const t of TOPICS) {
    const summaryHeading = h(headingLevel === 2 ? 'h2' : 'h3', { className: 'help-topic-title' }, t.title);
    wrap.appendChild(
      h(
        'details',
        { className: 'help-topic' },
        h('summary', {}, summaryHeading),
        ...t.body.map((b) => (typeof b === 'string' ? h('p', {}, b) : b)),
      ),
    );
  }
  return wrap;
}
