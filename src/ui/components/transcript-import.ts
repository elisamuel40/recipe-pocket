/**
 * Transcript / caption import (PRD R11, R12). Owner: media.
 * Paste text or choose a local .txt/.srt/.vtt file, then review a draft.
 * Everything stays on this device. DOM is built only with h(); never innerHTML.
 * Optional styles: ui/transcript-import.css (works without it).
 */
import { clear, h } from '../../shared/dom';
import {
  draftFromTranscript,
  isLocalSpeechRecognitionAvailable,
  MAX_TRANSCRIPT_FILE_BYTES,
  type TranscriptDraft,
} from '../../media/index';

export interface TranscriptImportOptions {
  onDraft: (draft: TranscriptDraft) => void;
  onCancel?: () => void;
}

const TEXT_EXTENSIONS = ['txt', 'srt', 'vtt'];
const MEDIA_EXTENSIONS = [
  'mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'flv', '3gp', 'mpeg', 'mpg',
  'mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'weba', 'amr', 'aiff', 'aif',
];

export const MEDIA_LIMITATION_TEXT =
  'Speech recognition on this device is not available in this build yet, so Recipe Pocket cannot turn an audio or video file into text. ' +
  'The file was not read or uploaded. Paste the video captions or a transcript instead, or choose a .txt, .srt or .vtt caption file.';

let instanceCounter = 0;

function extensionOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? (m[1] ?? '').toLowerCase() : '';
}

export function classifyTranscriptFile(file: { name: string; type: string; size: number }):
  | 'text'
  | 'media'
  | 'too-large'
  | 'unsupported' {
  const ext = extensionOf(file.name);
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('audio/') || type.startsWith('video/') || MEDIA_EXTENSIONS.includes(ext)) return 'media';
  if (!TEXT_EXTENSIONS.includes(ext)) return 'unsupported';
  if (file.size > MAX_TRANSCRIPT_FILE_BYTES) return 'too-large';
  return 'text';
}

export function mountTranscriptImport(container: HTMLElement, opts: TranscriptImportOptions): () => void {
  const n = ++instanceCounter;
  const ids = {
    heading: `tpi-heading-${n}`,
    title: `tpi-title-${n}`,
    url: `tpi-url-${n}`,
    text: `tpi-text-${n}`,
    textHint: `tpi-text-hint-${n}`,
    file: `tpi-file-${n}`,
    fileHint: `tpi-file-hint-${n}`,
    error: `tpi-error-${n}`,
    help: `tpi-help-${n}`,
    review: `tpi-review-heading-${n}`,
  };

  let mounted = true;
  /** Incremented to invalidate pending File.text() reads after cancel/unmount. */
  let readToken = 0;
  let draft: TranscriptDraft | null = null;

  const root = h('section', { className: 'transcript-import', 'aria-labelledby': ids.heading });
  container.appendChild(root);

  // ---- Input step elements (kept across Back so the user's text survives) ----
  const titleInput = h('input', { id: ids.title, type: 'text', autocomplete: 'off', maxlength: 200 });
  const urlInput = h('input', { id: ids.url, type: 'text', inputmode: 'url', autocomplete: 'off', spellcheck: 'false', placeholder: 'https://' });
  const textArea = h('textarea', { id: ids.text, rows: 10, spellcheck: 'false', 'aria-describedby': ids.textHint });
  const fileInput = h('input', {
    id: ids.file,
    type: 'file',
    accept: '.txt,.srt,.vtt,text/plain,text/vtt,application/x-subrip,audio/*,video/*',
    'aria-describedby': ids.fileHint,
  });
  const status = h('p', { className: 'muted transcript-import__status', role: 'status', 'aria-live': 'polite' });
  const error = h('div', { id: ids.error, className: 'notice error transcript-import__error', role: 'alert', hidden: true });
  const limitation = h('div', { className: 'notice warn transcript-import__limitation', role: 'alert', hidden: true });

  const helpSummary = h('summary', {}, 'How to get a transcript from a video');
  const help = h(
    'details',
    { id: ids.help, className: 'transcript-import__help' },
    helpSummary,
    h(
      'ul',
      {},
      h('li', {}, 'Many video pages have a "Show transcript" or captions option. Open it, select the text and copy it here.'),
      h('li', {}, 'If you have a caption file (.srt or .vtt) or a text transcript you are allowed to use, choose it with "Choose a file".'),
      h('li', {}, 'You can also type the ingredients and steps while you watch.'),
      h('li', {}, 'Recipe Pocket does not download videos and does not get around logins, DRM or download restrictions. It cannot read audio that the page does not show as text.'),
      h('li', {}, 'Turning speech in an audio or video file into text on this device is not available in this build yet.'),
    ),
  );

  const showHelp = (e: Event): void => {
    e.preventDefault();
    help.open = true;
    helpSummary.focus();
  };

  const setError = (msg: string, field?: HTMLElement): void => {
    clear(error);
    error.append(msg);
    error.hidden = false;
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('aria-describedby', `${field.getAttribute('aria-describedby') ?? ''} ${ids.error}`.trim());
    }
  };
  const clearError = (): void => {
    clear(error);
    error.hidden = true;
    for (const field of [textArea, fileInput]) {
      field.removeAttribute('aria-invalid');
      const described = (field.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((t) => t && t !== ids.error);
      if (described.length) field.setAttribute('aria-describedby', described.join(' '));
      else field.removeAttribute('aria-describedby');
    }
  };
  const hideLimitation = (): void => {
    clear(limitation);
    limitation.hidden = true;
  };
  const showLimitation = (): void => {
    clear(limitation);
    limitation.append(
      h('p', {}, MEDIA_LIMITATION_TEXT),
      h('p', {}, h('a', { href: `#${ids.help}`, onclick: showHelp }, 'How to get captions or a transcript')),
    );
    limitation.hidden = false;
  };

  const onFileChange = async (): Promise<void> => {
    clearError();
    hideLimitation();
    status.textContent = '';
    const file = fileInput.files?.[0];
    if (!file) return;
    const kind = classifyTranscriptFile(file);
    if (kind === 'media') {
      fileInput.value = '';
      if (isLocalSpeechRecognitionAvailable()) return; // Not reachable in this build (see docs/video-gate.md).
      showLimitation();
      return;
    }
    if (kind === 'unsupported') {
      fileInput.value = '';
      setError('This file type is not supported. Choose a .txt, .srt or .vtt file.', fileInput);
      return;
    }
    if (kind === 'too-large') {
      fileInput.value = '';
      setError('This file is larger than 2 MB. Choose a smaller caption or transcript file, or paste the text.', fileInput);
      return;
    }
    const token = ++readToken;
    status.textContent = `Reading ${file.name}…`;
    let content: string;
    try {
      content = await file.text();
    } catch {
      if (!mounted || token !== readToken) return;
      status.textContent = '';
      fileInput.value = '';
      setError('The file could not be read. Try again or paste the text.', fileInput);
      return;
    }
    if (!mounted || token !== readToken) return; // Cancelled or unmounted meanwhile.
    fileInput.value = '';
    if (content.includes('\u0000')) {
      status.textContent = '';
      setError('This file does not look like text. Choose a .txt, .srt or .vtt file.', fileInput);
      return;
    }
    textArea.value = content;
    status.textContent = `Loaded ${file.name}. Review the text, then choose Create draft.`;
  };

  const resetInputs = (): void => {
    readToken++;
    draft = null;
    titleInput.value = '';
    urlInput.value = '';
    textArea.value = '';
    fileInput.value = '';
    status.textContent = '';
    clearError();
    hideLimitation();
    help.open = false;
  };

  const cancel = (): void => {
    resetInputs();
    renderInput(false);
    opts.onCancel?.();
  };

  const createDraft = (): void => {
    clearError();
    if (textArea.value.trim() === '') {
      setError('Paste a transcript or choose a caption file first.', textArea);
      textArea.focus();
      return;
    }
    draft = draftFromTranscript(textArea.value, { title: titleInput.value, sourceUrl: urlInput.value });
    renderReview();
  };

  const useDraft = (): void => {
    if (!draft) return;
    const handed = draft;
    resetInputs();
    opts.onDraft(handed);
    if (mounted) renderInput(false);
  };

  // ---- Renderers ----
  function renderInput(focusText: boolean): void {
    clear(root);
    const heading = h('h2', { id: ids.heading, tabindex: -1 }, 'Import a video transcript');
    root.append(
      heading,
      h('p', { className: 'muted' }, 'Paste captions or a transcript, or choose a .txt, .srt or .vtt file. The text stays on this device and nothing is saved until you choose Save.'),
      h(
        'form',
        {
          className: 'transcript-import__form',
          novalidate: true,
          onsubmit: (e: Event) => {
            e.preventDefault();
            createDraft();
          },
        },
        h('div', { className: 'transcript-import__field' }, h('label', { for: ids.title }, 'Recipe title (optional)'), titleInput),
        h('div', { className: 'transcript-import__field' }, h('label', { for: ids.url }, 'Video link (optional)'), urlInput),
        h(
          'div',
          { className: 'transcript-import__field' },
          h('label', { for: ids.text }, 'Transcript or captions'),
          h('p', { id: ids.textHint, className: 'muted transcript-import__hint' }, 'Timestamps and caption numbers are removed automatically.'),
          textArea,
        ),
        h(
          'div',
          { className: 'transcript-import__field' },
          h('label', { for: ids.file }, 'Or choose a file'),
          h('p', { id: ids.fileHint, className: 'muted transcript-import__hint' }, 'Text (.txt), SubRip (.srt) or WebVTT (.vtt), up to 2 MB.'),
          fileInput,
        ),
        status,
        error,
        limitation,
        help,
        h(
          'div',
          { className: 'transcript-import__actions' },
          h('button', { type: 'submit', className: 'primary' }, 'Create draft'),
          h('button', { type: 'button', onclick: cancel }, 'Cancel'),
        ),
      ),
    );
    if (focusText) textArea.focus();
    else heading.focus();
  }

  function renderReview(): void {
    if (!draft) return;
    const d = draft;
    clear(root);
    const heading = h('h2', { id: ids.review, tabindex: -1 }, 'Review the draft');
    root.setAttribute('aria-labelledby', ids.review);
    const ingredientCount = d.recipe.ingredientGroups.reduce((s, g) => s + g.items.length, 0);
    const stepCount = d.recipe.instructionGroups.reduce((s, g) => s + g.steps.length, 0);

    root.append(
      h(
      'div',
      { className: 'transcript-import__review' },
      heading,
      h(
        'div',
        { className: 'notice warn' },
        h('strong', {}, 'Check before saving. '),
        'Quantities, ingredients and steps come from a transcript and can be misheard or missing. Compare them with the video before you save.',
      ),
      h('p', {}, h('strong', {}, 'Title: '), d.recipe.title),
      d.recipe.source.url ? h('p', { className: 'muted' }, 'Video link: ', d.recipe.source.url) : null,
      d.warnings.length > 1
        ? h('ul', { className: 'transcript-import__warnings' }, d.warnings.slice(1).map((w) => h('li', {}, w)))
        : null,
      h('h3', {}, `Ingredients (${ingredientCount})`),
      ingredientCount === 0
        ? h('p', { className: 'muted' }, 'No ingredients recognized.')
        : d.recipe.ingredientGroups.map((g) =>
            h(
              'div',
              { className: 'transcript-import__group' },
              g.title ? h('h4', {}, g.title) : null,
              h('ul', {}, g.items.map((it) => h('li', {}, it.raw))),
            ),
          ),
      h('h3', {}, `Steps (${stepCount})`),
      stepCount === 0
        ? h('p', { className: 'muted' }, 'No steps recognized.')
        : d.recipe.instructionGroups.map((g) =>
            h(
              'div',
              { className: 'transcript-import__group' },
              g.title ? h('h4', {}, g.title) : null,
              h('ol', {}, g.steps.map((s) => h('li', {}, s.text))),
            ),
          ),
      h('h3', {}, `Lines not sorted (${d.unclassified.length})`),
      d.unclassified.length === 0
        ? h('p', { className: 'muted' }, 'Every line was sorted.')
        : [
            h('p', { className: 'muted' }, 'These lines were not placed in the recipe. Add anything that belongs in the editor.'),
            h('ul', { className: 'transcript-import__unclassified' }, d.unclassified.map((l) => h('li', {}, l))),
          ],
      h(
        'div',
        { className: 'transcript-import__actions' },
        h('button', { type: 'button', className: 'primary', onclick: useDraft }, 'Use this draft'),
        h(
          'button',
          {
            type: 'button',
            onclick: () => {
              draft = null;
              root.setAttribute('aria-labelledby', ids.heading);
              renderInput(true);
            },
          },
          'Back',
        ),
        h('button', { type: 'button', onclick: cancel }, 'Cancel'),
      ),
      ),
    );
    heading.focus();
  }

  fileInput.addEventListener('change', () => void onFileChange());
  renderInput(false);

  return () => {
    if (!mounted) return;
    mounted = false;
    readToken++;
    draft = null;
    textArea.value = '';
    fileInput.value = '';
    root.remove();
  };
}
