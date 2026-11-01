/**
 * Modal dialog and message helpers used by the library (collections, recipes,
 * shopping lists) and the settings page. Owner: UI owner B.
 *
 * Dialogs use <dialog> + showModal() (native inert background, Escape via the
 * `cancel` event). A manual Tab trap and Escape handler are also installed so
 * behaviour is the same where showModal is unavailable (jsdom in tests).
 * All text goes through h()/textContent.
 */
import { h } from '../../shared/dom';

type Content = Node | string;

export interface DialogHandle {
  dialog: HTMLDialogElement;
  close: () => void;
}

let dialogSeq = 0;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableIn(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[hidden]'));
}

/**
 * Open a modal dialog. `build` receives a close function and returns the body
 * and action elements. Focus returns to the previously focused element on close.
 */
export function openDialog(opts: {
  title: string;
  className?: string;
  build: (close: () => void) => { body: Content[]; actions: HTMLElement[]; initialFocus?: HTMLElement };
  onClose?: () => void;
}): DialogHandle {
  const id = `rp-dialog-${++dialogSeq}`;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let closed = false;
  const dialog = h('dialog', { className: `rp-dialog ${opts.className ?? ''}`.trim(), 'aria-labelledby': `${id}-title` });
  const close = (): void => {
    if (closed) return;
    closed = true;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    dialog.removeAttribute('open');
    dialog.remove();
    if (opener && opener.isConnected) opener.focus();
    opts.onClose?.();
  };
  const { body, actions, initialFocus } = opts.build(close);
  dialog.append(
    h('h2', { id: `${id}-title` }, opts.title),
    h('div', { className: 'rp-dialog-body' }, ...body),
    h('div', { className: 'rp-dialog-actions' }, ...actions),
  );
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  dialog.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusableIn(dialog);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
  document.body.appendChild(dialog);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  (initialFocus ?? focusableIn(dialog)[0])?.focus();
  return { dialog, close };
}

/** Confirmation dialog. Resolves true only when the confirm button is pressed. Cancel/Escape resolve false. */
export function confirmDialog(opts: {
  title: string;
  message: Content[];
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    openDialog({
      title: opts.title,
      className: 'rp-confirm',
      onClose: () => resolve(result),
      build: (close) => {
        const cancel = h('button', { type: 'button', onclick: () => close() }, opts.cancelLabel ?? 'Cancel');
        const confirm = h(
          'button',
          {
            type: 'button',
            className: opts.danger ? 'danger' : 'primary',
            onclick: () => {
              result = true;
              close();
            },
          },
          opts.confirmLabel,
        );
        return {
          body: opts.message.map((m) => (typeof m === 'string' ? h('p', {}, m) : m)),
          actions: [cancel, confirm],
          // Destructive actions start on Cancel so Enter never deletes by accident.
          initialFocus: opts.danger ? cancel : confirm,
        };
      },
    });
  });
}

/** Single text-field dialog. Resolves the trimmed value, or null on cancel. */
export function promptDialog(opts: {
  title: string;
  label: string;
  value?: string;
  confirmLabel: string;
  validate?: (value: string) => string | null;
}): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    openDialog({
      title: opts.title,
      onClose: () => resolve(result),
      build: (close) => {
        const fieldId = `rp-prompt-${++dialogSeq}`;
        const input = h('input', { id: fieldId, type: 'text', value: opts.value ?? '', 'aria-describedby': `${fieldId}-err` });
        const err = h('p', { id: `${fieldId}-err`, className: 'field-error', hidden: true });
        const submit = (): void => {
          const v = input.value.trim();
          const problem = !v ? 'Enter a name.' : (opts.validate?.(v) ?? null);
          if (problem) {
            err.textContent = problem;
            err.hidden = false;
            input.setAttribute('aria-invalid', 'true');
            input.focus();
            return;
          }
          result = v;
          close();
        };
        input.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        });
        return {
          body: [h('label', { for: fieldId }, opts.label), input, err],
          actions: [
            h('button', { type: 'button', onclick: () => close() }, 'Cancel'),
            h('button', { type: 'button', className: 'primary', onclick: submit }, opts.confirmLabel),
          ],
          initialFocus: input,
        };
      },
    });
  });
}

/** StorageError code if `e` looks like one (duck-typed so mocked modules work). */
export function errorCode(e: unknown): string | undefined {
  if (typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string') {
    return (e as { code: string }).code;
  }
  return undefined;
}

export const SESSION_ONLY_MESSAGE =
  'Session-only mode is on, so nothing can be saved or deleted. Turn it off in Settings to make changes.';

/** Plain-text, user-facing explanation for a storage failure. */
export function storageErrorMessage(e: unknown): string {
  switch (errorCode(e)) {
    case 'SESSION_ONLY':
      return SESSION_ONLY_MESSAGE;
    case 'QUOTA':
      return 'There is not enough storage space on this device. Nothing was changed. Free up disk space or delete items you no longer need, then try again.';
    case 'CONFLICT':
      return 'This item was changed in another tab or window, so your change was not saved.';
    case 'NOT_FOUND':
      return 'This item no longer exists. It may have been deleted in another tab.';
    case 'INVALID_RECORD':
    case 'INVALID_BACKUP':
      return e instanceof Error && e.message ? e.message : 'The file is not a valid Recipe Pocket backup.';
    default: {
      const msg = e instanceof Error ? e.message : String(e);
      return `Something went wrong: ${msg}`;
    }
  }
}

/** Make a safe download filename: no path separators, control or reserved characters. */
export function sanitizeFilename(name: string, fallback = 'recipe'): string {
  const cleaned = name
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
    .replace(/[^\p{L}\p{N} ._-]+/gu, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^[.-]+/, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 60)
    .replace(/[.-]+$/, '');
  return cleaned || fallback;
}

/** Download text as a file via Blob + object URL + <a download>; the URL is revoked afterwards. */
export function downloadText(text: string, filename: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, hidden: true });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Move focus to the element with the given data-key inside root (after a re-render). */
export function focusKey(root: ParentNode, key: string): boolean {
  const el = root.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
  if (el && !(el as HTMLButtonElement).disabled) {
    el.focus();
    return true;
  }
  return false;
}
