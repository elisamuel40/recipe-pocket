/**
 * Settings page (PRD R10, R13, R14). Owner: UI owner B.
 * Theme/font/units, session-only mode, backup export/import, delete all,
 * privacy summary, bundled help, support and licenses. No telemetry, no
 * uninstall URL, no remote resources.
 */
import { clear, h } from '../shared/dom';
import type { Preferences, ThemePreference, UnitSystem } from '../shared/types';
import { DEFAULT_PREFERENCES } from '../shared/types';
import * as storage from '../storage/index';
import type { ConflictResolution, ImportPreview } from '../storage/index';
import { applyPreferences } from './common/theme';
import { renderHelp } from './help';
import {
  confirmDialog,
  downloadText,
  errorCode,
  sanitizeFilename,
  storageErrorMessage,
} from './components/collection-dialogs';

export const ISSUES_URL = 'https://github.com/elisamuel40/recipe-pocket/issues';

const FONT_SCALES: { value: number; label: string }[] = [
  { value: 0.9, label: 'Small (90%)' },
  { value: 1, label: 'Default (100%)' },
  { value: 1.15, label: 'Large (115%)' },
  { value: 1.3, label: 'Larger (130%)' },
  { value: 1.5, label: 'Extra large (150%)' },
  { value: 1.75, label: 'Huge (175%)' },
  { value: 2, label: 'Maximum (200%)' },
];

function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Could not read the file'));
    r.readAsText(file);
  });
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export async function initOptions(app: HTMLElement): Promise<void> {
  let prefs: Preferences = { ...DEFAULT_PREFERENCES };
  let prefsError: string | null = null;
  try {
    prefs = await storage.getPreferences();
  } catch (e) {
    prefsError = storageErrorMessage(e);
  }
  applyPreferences(prefs);

  const status = h('div', { className: 'visually-hidden', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const announce = (msg: string): void => {
    status.textContent = '';
    setTimeout(() => (status.textContent = msg), 30);
  };

  // Status message shown next to a section (visible + announced).
  const sectionStatus = (): HTMLElement => h('p', { className: 'section-status', hidden: true });
  const show = (el: HTMLElement, msg: string, kind: 'ok' | 'error' | 'warn' = 'ok'): void => {
    el.textContent = msg;
    el.className = `section-status ${kind}`;
    el.hidden = false;
    announce(msg);
  };

  // ---------- appearance ----------
  const appearanceStatus = sectionStatus();
  async function savePref(patch: Partial<Preferences>, label: string): Promise<void> {
    prefs = { ...prefs, ...patch };
    applyPreferences(prefs);
    try {
      prefs = { ...prefs, ...(await storage.setPreferences(patch)) };
      if (prefs.sessionOnly) {
        show(appearanceStatus, `${label} applied to this page only. Session-only mode is on, so it is not saved.`, 'warn');
      } else {
        show(appearanceStatus, `${label} saved.`);
      }
    } catch (e) {
      if (errorCode(e) === 'SESSION_ONLY') {
        show(appearanceStatus, `${label} applied to this page only. Session-only mode is on, so it is not saved.`, 'warn');
      } else {
        show(appearanceStatus, `${label} applied, but not saved. ${storageErrorMessage(e)}`, 'error');
      }
    }
  }

  const themeFieldset = h('fieldset', {}, h('legend', {}, 'Theme'));
  (['system', 'light', 'dark'] as ThemePreference[]).forEach((t) => {
    const id = `rp-theme-${t}`;
    const radio = h('input', { type: 'radio', name: 'theme', id, value: t, checked: prefs.theme === t });
    radio.checked = prefs.theme === t;
    radio.addEventListener('change', () => radio.checked && void savePref({ theme: t }, 'Theme'));
    themeFieldset.appendChild(
      h('div', { className: 'radio-row' }, radio, h('label', { for: id }, t === 'system' ? 'Match system setting' : t === 'light' ? 'Light' : 'Dark')),
    );
  });

  const fontSel = h('select', { id: 'rp-font' }, FONT_SCALES.map((f) => h('option', { value: String(f.value) }, f.label)));
  const nearest = FONT_SCALES.reduce((a, b) => (Math.abs(b.value - prefs.fontScale) < Math.abs(a.value - prefs.fontScale) ? b : a));
  fontSel.value = String(nearest.value);
  fontSel.addEventListener('change', () => void savePref({ fontScale: Number(fontSel.value) }, 'Text size'));

  const unitSel = h(
    'select',
    { id: 'rp-units', 'aria-describedby': 'rp-units-hint' },
    h('option', { value: 'original' }, 'Original (as written)'),
    h('option', { value: 'us' }, 'US customary'),
    h('option', { value: 'metric' }, 'Metric'),
  );
  unitSel.value = prefs.unitSystem;
  unitSel.addEventListener('change', () => void savePref({ unitSystem: unitSel.value as UnitSystem }, 'Default units'));

  const appearance = section('appearance', 'Appearance and units', [
    themeFieldset,
    field('rp-font', 'Text size', fontSel, 'Applies to the reader, cook mode, library and settings.'),
    field('rp-units', 'Default units', unitSel, 'You can still switch units for each recipe. Cups are never converted to grams without a known density.', 'rp-units-hint'),
    appearanceStatus,
  ]);

  // ---------- privacy / session-only ----------
  const sessionStatus = sectionStatus();
  const sessionCb = h('input', { type: 'checkbox', id: 'rp-session', 'aria-describedby': 'rp-session-hint' });
  sessionCb.checked = prefs.sessionOnly;
  sessionCb.addEventListener('change', async () => {
    const on = sessionCb.checked;
    try {
      await storage.setSessionOnly(on);
      prefs = { ...prefs, sessionOnly: on };
      show(
        sessionStatus,
        on
          ? 'Session-only mode is on. Recipes, lists, photos and settings will not be saved. Open pages may need a reload to show the change.'
          : 'Session-only mode is off. Recipes are saved on this device when you select Save.',
        on ? 'warn' : 'ok',
      );
      updateWriteControls();
    } catch (e) {
      sessionCb.checked = !on;
      show(sessionStatus, `The setting could not be changed. ${storageErrorMessage(e)}`, 'error');
    }
  });

  const privacy = section('privacy', 'Privacy', [
    h(
      'ul',
      { className: 'privacy-list' },
      h('li', {}, 'Recipe Pocket reads a page only when you click the toolbar icon, and only that tab.'),
      h('li', {}, 'Saved recipes, collections, shopping lists, photos and settings stay on this device. There is no account, cloud sync or server.'),
      h('li', {}, 'No analytics, tracking, usage counters or crash reports. The extension makes no network requests of its own.'),
      h('li', {}, 'Source links open the original site, which may track its own visitors as usual.'),
      h('li', {}, 'Exported backups, copied text and PDFs you save are files outside the extension. Recipe Pocket cannot delete or protect them.'),
      h('li', {}, 'Removing the extension from Chrome deletes its stored data. Export a backup first if you want to keep your recipes.'),
    ),
    h(
      'div',
      { className: 'check-setting' },
      h('div', { className: 'check-row' }, sessionCb, h('label', { for: 'rp-session' }, 'Session-only mode (save nothing)')),
      h(
        'p',
        { id: 'rp-session-hint', className: 'hint muted' },
        'When on, recipes, shopping lists, photos and settings are not written to this device; you can still read, scale and print. ' +
          'The only value stored is this on/off setting itself, so Recipe Pocket remembers to stay in session-only mode. ' +
          'Recipes you saved earlier stay on this device until you delete them.',
      ),
    ),
    sessionStatus,
  ]);

  // ---------- backup ----------
  const backupStatus = sectionStatus();
  const includeImages = h('input', { type: 'checkbox', id: 'rp-export-images', checked: true });
  includeImages.checked = true;
  const exportBtn = h('button', { type: 'button', className: 'primary' }, 'Export backup');
  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    try {
      const text = await storage.exportBackup({ includeImages: includeImages.checked });
      const date = new Date().toISOString().slice(0, 10);
      downloadText(text, `${sanitizeFilename(`recipe-pocket-backup-${date}`, 'recipe-pocket-backup')}.json`);
      show(backupStatus, 'Backup exported to your downloads. Keep it somewhere safe; it is outside Recipe Pocket\'s control.');
    } catch (e) {
      show(backupStatus, `Export failed. ${storageErrorMessage(e)}`, 'error');
    } finally {
      exportBtn.disabled = false;
    }
  });

  const importInput = h('input', { type: 'file', id: 'rp-import', accept: '.json,application/json', 'aria-describedby': 'rp-import-hint' });
  const importArea = h('div', { className: 'import-area', 'aria-live': 'polite' });
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    clear(importArea);
    if (!file) return;
    if (prefs.sessionOnly) {
      showImportError('Session-only mode is on, so nothing can be imported. Turn it off above, then try again.');
      return;
    }
    if (file.size > storage.IMPORT_MAX_BYTES) {
      showImportError('This file is larger than 10 MB, the maximum backup size. Nothing was changed.');
      return;
    }
    let preview: ImportPreview;
    try {
      preview = await storage.previewImport(await readFileText(file));
    } catch (e) {
      showImportError(
        errorCode(e) === 'INVALID_BACKUP'
          ? `This file can't be imported: ${storageErrorMessage(e)} Nothing was changed.`
          : `The file could not be checked. ${storageErrorMessage(e)} Nothing was changed.`,
      );
      return;
    }
    renderPreview(preview);
  });

  function showImportError(msg: string): void {
    clear(importArea);
    importArea.appendChild(h('div', { className: 'notice error', role: 'alert' }, h('p', {}, msg)));
  }

  function renderPreview(preview: ImportPreview): void {
    clear(importArea);
    const heading = h('h3', { id: 'rp-import-h', tabindex: '-1' }, 'Review the import');
    const conflictBox = h('div', {});
    const resolution: { value: ConflictResolution } = { value: 'skip' };
    if (preview.conflicts.length) {
      const fs = h('fieldset', {}, h('legend', {}, `What should happen to the ${plural(preview.conflicts.length, 'recipe that is', 'recipes that are')} already in your library?`));
      const choices: { v: ConflictResolution; label: string; hint: string }[] = [
        { v: 'skip', label: 'Skip them (keep my current recipes)', hint: 'Recommended. Your current recipes are not changed.' },
        { v: 'duplicate', label: 'Import them as copies', hint: 'You get both versions side by side.' },
        { v: 'replace', label: 'Replace my current recipes', hint: 'Your current versions are overwritten.' },
      ];
      for (const c of choices) {
        const id = `rp-res-${c.v}`;
        const radio = h('input', { type: 'radio', name: 'rp-resolution', id, value: c.v, checked: c.v === 'skip', 'aria-describedby': `${id}-hint` });
        radio.checked = c.v === 'skip';
        radio.addEventListener('change', () => radio.checked && (resolution.value = c.v));
        fs.appendChild(h('div', { className: 'radio-choice' }, h('div', { className: 'radio-row' }, radio, h('label', { for: id }, c.label)), h('p', { id: `${id}-hint`, className: 'hint muted' }, c.hint)));
      }
      conflictBox.append(
        h('h4', {}, `Already in your library (${preview.conflicts.length})`),
        h(
          'ul',
          { className: 'conflict-list' },
          preview.conflicts.map((c) => h('li', {}, c.title || 'Untitled recipe', h('span', { className: 'muted' }, c.reason === 'id' ? ' — same recipe' : ' — same source link'))),
        ),
        fs,
      );
    }
    const commitBtn = h('button', { type: 'button', className: 'primary' }, 'Import');
    const cancelBtn = h('button', { type: 'button' }, 'Cancel');
    cancelBtn.addEventListener('click', () => {
      clear(importArea);
      show(backupStatus, 'Import cancelled. Nothing was changed.');
      importInput.focus();
    });
    commitBtn.addEventListener('click', async () => {
      commitBtn.disabled = true;
      cancelBtn.disabled = true;
      try {
        const result = await storage.commitImport(preview, resolution.value);
        clear(importArea);
        show(
          backupStatus,
          `Import finished: ${result.added} added, ${result.replaced} replaced, ${result.skipped} skipped.`,
        );
        importInput.focus();
      } catch (e) {
        showImportError(`Nothing was imported. ${storageErrorMessage(e)}`);
      }
    });
    importArea.append(
      h(
        'section',
        { className: 'import-preview panel-card', 'aria-labelledby': 'rp-import-h' },
        heading,
        h(
          'ul',
          {},
          h('li', {}, plural(preview.recipeCount, 'recipe', 'recipes')),
          h('li', {}, plural(preview.collectionCount, 'collection', 'collections')),
          h('li', {}, plural(preview.shoppingListCount, 'shopping list', 'shopping lists')),
          h('li', {}, plural(preview.imageCount, 'photo', 'photos')),
        ),
        preview.warnings.length
          ? h('div', { className: 'notice warn' }, h('div', { className: 'notice-body' }, h('p', {}, h('strong', {}, 'Warnings')), h('ul', {}, preview.warnings.map((w) => h('li', {}, w)))))
          : null,
        conflictBox,
        h('p', { className: 'hint muted' }, 'Nothing is written until you select Import. The import is all or nothing.'),
        h('div', { className: 'button-row' }, commitBtn, cancelBtn),
      ),
    );
    heading.focus();
  }

  const backup = section('backup', 'Backup and restore', [
    h('p', {}, 'Recipe Pocket has no cloud copy. Export a backup file to keep your recipes safe or move them to another computer.'),
    h('div', { className: 'check-row' }, includeImages, h('label', { for: 'rp-export-images' }, 'Include photos')),
    h('div', { className: 'button-row' }, exportBtn),
    field('rp-import', 'Import a backup file', importInput, 'Choose a Recipe Pocket .json backup (up to 10 MB). You review the changes before anything is written.', 'rp-import-hint'),
    importArea,
    backupStatus,
  ]);

  // ---------- delete all ----------
  const deleteStatus = sectionStatus();
  const deleteBtn = h('button', { type: 'button', className: 'danger' }, 'Delete all local data…');
  deleteBtn.addEventListener('click', async () => {
    let counts: Awaited<ReturnType<typeof storage.countAll>>;
    try {
      counts = await storage.countAll();
    } catch (e) {
      show(deleteStatus, `Could not count your data. ${storageErrorMessage(e)} Nothing was deleted.`, 'error');
      return;
    }
    const summary = `${plural(counts.recipes, 'recipe', 'recipes')}, ${plural(counts.collections, 'collection', 'collections')}, ${plural(counts.shoppingLists, 'shopping list', 'shopping lists')} and ${plural(counts.images, 'photo', 'photos')}`;
    const ok = await confirmDialog({
      title: 'Delete all local data?',
      message: [
        h('p', {}, h('strong', {}, `This permanently deletes ${summary}`), ', plus your settings, from this device. It cannot be undone.'),
        'Exported backup files and saved PDFs are not affected. Export a backup first if you might want your recipes later.',
      ],
      confirmLabel: `Delete ${plural(counts.recipes, 'recipe', 'recipes')} and all other data`,
      cancelLabel: 'Cancel, keep everything',
      danger: true,
    });
    if (!ok) {
      show(deleteStatus, 'Cancelled. Nothing was deleted.');
      return;
    }
    try {
      await storage.deleteAllData();
      prefs = { ...DEFAULT_PREFERENCES };
      applyPreferences(prefs);
      syncControls();
      show(deleteStatus, 'All local data was deleted from this device.');
    } catch (e) {
      show(deleteStatus, `Delete failed. ${storageErrorMessage(e)} Your data was not deleted.`, 'error');
    }
  });

  const dangerZone = section('delete', 'Delete all data', [
    h('p', {}, 'Removes every recipe, collection, shopping list, photo and setting stored by Recipe Pocket on this device. You see how many items will be deleted before you confirm.'),
    deleteBtn,
    deleteStatus,
  ]);

  // ---------- help / support / licenses ----------
  const help = section('help', 'Help and troubleshooting', [renderHelp(3)]);
  const support = section('support', 'Support', [
    h('p', {}, 'Recipe Pocket is free, open-source software maintained by volunteers. There is no paid or priority support.'),
    h(
      'div',
      { className: 'notice warn', role: 'note' },
      h(
        'div',
        { className: 'notice-body' },
        h('p', {}, h('strong', {}, 'Issues are public. '), 'Anything you write on GitHub can be seen by anyone. Do not include private recipes, backup files, screenshots with personal information, names, emails or addresses.'),
      ),
    ),
    h('p', {}, 'To report a bug or suggest an improvement, use the project\'s ', h('a', { href: ISSUES_URL, target: '_blank', rel: 'noopener noreferrer' }, 'GitHub issues page (opens in a new tab)'), '.'),
    h('p', { className: 'muted' }, 'Recipe Pocket never sends reports, diagnostics or feedback automatically.'),
  ]);
  const licenses = section('licenses', 'Licenses', [
    h('p', {}, 'Recipe Pocket is released under the MIT License: you may use, copy, modify and distribute it freely, provided the copyright and license notice are kept. The software is provided "as is", without warranty of any kind.'),
    h('p', {}, h('a', { href: '../LICENSE', target: '_blank', rel: 'noopener' }, 'Read the full MIT License text'), '.'),
    h('p', {}, 'Third-party notices for bundled components, if any, are included in the extension package as THIRD_PARTY_NOTICES.md. Recipes you save belong to their authors; Recipe Pocket keeps the author and original link.'),
  ]);

  function syncControls(): void {
    for (const r of Array.from(themeFieldset.querySelectorAll<HTMLInputElement>('input[name="theme"]'))) r.checked = r.value === prefs.theme;
    const n = FONT_SCALES.reduce((a, b) => (Math.abs(b.value - prefs.fontScale) < Math.abs(a.value - prefs.fontScale) ? b : a));
    fontSel.value = String(n.value);
    unitSel.value = prefs.unitSystem;
    sessionCb.checked = prefs.sessionOnly;
    updateWriteControls();
  }

  function updateWriteControls(): void {
    importInput.disabled = prefs.sessionOnly;
    const hint = document.getElementById('rp-import-hint');
    if (hint) {
      hint.textContent = prefs.sessionOnly
        ? 'Importing is turned off because session-only mode is on.'
        : 'Choose a Recipe Pocket .json backup (up to 10 MB). You review the changes before anything is written.';
    }
  }

  clear(app);
  const toc = h(
    'nav',
    { 'aria-label': 'Settings sections', className: 'settings-toc' },
    h(
      'ul',
      {},
      [
        ['appearance', 'Appearance'],
        ['privacy', 'Privacy'],
        ['backup', 'Backup'],
        ['delete', 'Delete all data'],
        ['help', 'Help'],
        ['support', 'Support'],
        ['licenses', 'Licenses'],
      ].map(([id, label]) => h('li', {}, h('a', { href: `#${id}` }, label!))),
    ),
  );
  app.append(
    h(
      'header',
      { className: 'settings-header' },
      h('p', { className: 'brand' }, 'Recipe Pocket'),
      h('nav', { 'aria-label': 'Pages' }, h('a', { href: 'library.html' }, 'Open library')),
    ),
    h(
      'main',
      { id: 'main', className: 'settings-main' },
      h('h1', {}, 'Settings'),
      prefsError ? h('p', { className: 'notice error', role: 'alert' }, `Settings could not be loaded; defaults are shown. ${prefsError}`) : null,
      prefs.sessionOnly ? h('p', { className: 'notice warn', role: 'note' }, 'Session-only mode is on. Nothing is being saved on this device.') : null,
      toc,
      appearance,
      privacy,
      backup,
      dangerZone,
      help,
      support,
      licenses,
    ),
    status,
  );
  updateWriteControls();
}

function section(id: string, title: string, children: (HTMLElement | string | null)[]): HTMLElement {
  return h('section', { id, className: 'settings-section', 'aria-labelledby': `${id}-h` }, h('h2', { id: `${id}-h` }, title), ...children);
}

function field(id: string, label: string, control: HTMLElement, hint?: string, hintId = `${id}-hint`): HTMLElement {
  if (hint && !control.getAttribute('aria-describedby')) control.setAttribute('aria-describedby', hintId);
  return h('div', { className: 'field' }, h('label', { for: id }, label), hint ? h('p', { id: hintId, className: 'hint muted' }, hint) : null, control);
}

if (document.getElementById('app')?.dataset.page === 'options') {
  void initOptions(document.getElementById('app')!);
}
