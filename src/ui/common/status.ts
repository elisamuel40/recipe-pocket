/** Status messages with aria-live and non-color cues (a text label and glyph). */
import { clear, h } from '../../shared/dom';

export type StatusKind = 'info' | 'success' | 'warn' | 'error';

const LABEL: Record<StatusKind, string> = { info: 'Note', success: 'Done', warn: 'Warning', error: 'Error' };
const GLYPH: Record<StatusKind, string> = { info: 'i', success: '✓', warn: '!', error: '✕' };

/** A visible message block. Use role="alert" for errors that need immediate attention. */
export function notice(kind: StatusKind, message: string | Node, ...extra: Node[]): HTMLElement {
  const cls = kind === 'error' ? 'notice error' : kind === 'warn' ? 'notice warn' : kind === 'success' ? 'notice success' : 'notice';
  return h(
    'div',
    { className: cls, role: kind === 'error' ? 'alert' : null },
    h('span', { className: 'notice-glyph', 'aria-hidden': 'true' }, GLYPH[kind]),
    h('span', { className: 'visually-hidden' }, `${LABEL[kind]}: `),
    h('div', { className: 'notice-body' }, typeof message === 'string' ? h('p', {}, message) : message, ...extra),
  );
}

/** Creates a polite live region; returns a function that announces text into it. */
export function createAnnouncer(region: HTMLElement): (text: string) => void {
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-atomic', 'true');
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (text: string) => {
    clear(region);
    if (timer) clearTimeout(timer);
    // A short delay makes repeated identical messages announce again.
    timer = setTimeout(() => region.appendChild(region.ownerDocument.createTextNode(text)), 30);
  };
}

/**
 * Inline confirmation (no window.confirm; works in side panels and tests).
 * Renders into host, focuses the confirm button and resolves with the choice.
 */
export function confirmInline(
  host: HTMLElement,
  opts: { message: string; confirmLabel: string; cancelLabel?: string },
): Promise<boolean> {
  return new Promise((resolve) => {
    const id = `confirm-${Math.random().toString(36).slice(2)}`;
    const done = (v: boolean) => {
      box.remove();
      resolve(v);
    };
    const yes = h('button', { type: 'button', className: 'primary', onclick: () => done(true) }, opts.confirmLabel);
    const no = h('button', { type: 'button', onclick: () => done(false) }, opts.cancelLabel ?? 'Cancel');
    const box = h(
      'div',
      { className: 'notice warn confirm', role: 'alertdialog', 'aria-labelledby': id },
      h('p', { id }, opts.message),
      h('div', { className: 'button-row' }, yes, no),
    );
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        done(false);
      }
    });
    host.prepend(box);
    yes.focus();
  });
}
