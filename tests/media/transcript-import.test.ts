// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyTranscriptFile, mountTranscriptImport } from '../../src/ui/components/transcript-import';
import type { TranscriptDraft } from '../../src/media/index';

let container: HTMLElement;
let unmount: () => void;

const flush = () => new Promise((r) => setTimeout(r, 0));
const button = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement;
const textarea = () => container.querySelector('textarea') as HTMLTextAreaElement;
const fileInput = () => container.querySelector('input[type=file]') as HTMLInputElement;

function pickFile(file: File): void {
  const input = fileInput();
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

function bigFile(name: string, bytes: number, type = ''): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  unmount?.();
  container.remove();
});

describe('classifyTranscriptFile', () => {
  it('classifies text, media, oversized and unsupported files', () => {
    expect(classifyTranscriptFile({ name: 'a.srt', type: '', size: 10 })).toBe('text');
    expect(classifyTranscriptFile({ name: 'a.VTT', type: 'text/vtt', size: 10 })).toBe('text');
    expect(classifyTranscriptFile({ name: 'a.txt', type: 'text/plain', size: 2 * 1024 * 1024 + 1 })).toBe('too-large');
    expect(classifyTranscriptFile({ name: 'clip.mp4', type: 'video/mp4', size: 10 })).toBe('media');
    expect(classifyTranscriptFile({ name: 'voice', type: 'audio/ogg', size: 10 })).toBe('media');
    expect(classifyTranscriptFile({ name: 'page.html', type: 'text/html', size: 10 })).toBe('unsupported');
  });
});

describe('mountTranscriptImport', () => {
  it('renders labelled controls without innerHTML-injected markup', () => {
    unmount = mountTranscriptImport(container, { onDraft: () => {} });
    for (const el of container.querySelectorAll('input, textarea')) {
      expect(container.querySelector(`label[for="${el.id}"]`)).not.toBeNull();
    }
    expect(document.activeElement?.tagName).toBe('H2');
  });

  it('pasted text produces a review step and hands the draft over', () => {
    const onDraft = vi.fn<(d: TranscriptDraft) => void>();
    unmount = mountTranscriptImport(container, { onDraft });
    textarea().value = 'Ingredients\n2 cups flour\n<img src=x onerror=alert(1)>\nInstructions\nMix well.';
    button('Create draft').click();
    expect(container.querySelector('h2')?.textContent).toBe('Review the draft');
    expect(document.activeElement).toBe(container.querySelector('h2'));
    expect(container.textContent).toContain('Check before saving');
    expect(container.textContent).toContain('2 cups flour');
    expect(container.textContent).toContain('Mix well.');
    // Untrusted text is shown as text, never parsed as HTML.
    expect(container.querySelector('img')).toBeNull();
    button('Use this draft').click();
    expect(onDraft).toHaveBeenCalledTimes(1);
    expect(onDraft.mock.calls[0]?.[0].recipe.extraction.method).toBe('transcript');
    expect(textarea().value).toBe('');
  });

  it('shows an error when nothing was pasted', () => {
    const onDraft = vi.fn();
    unmount = mountTranscriptImport(container, { onDraft });
    button('Create draft').click();
    expect(container.querySelector('[role=alert]:not([hidden])')?.textContent).toMatch(/Paste a transcript/);
    expect(textarea().getAttribute('aria-invalid')).toBe('true');
    expect(onDraft).not.toHaveBeenCalled();
  });

  it('reads a local .srt file into the text box', async () => {
    unmount = mountTranscriptImport(container, { onDraft: () => {} });
    pickFile(new File(['1\n00:00:01,000 --> 00:00:02,000\nStir the sauce\n'], 'clip.srt', { type: '' }));
    await flush();
    expect(textarea().value).toContain('Stir the sauce');
    expect(container.querySelector('[role=status]')?.textContent).toMatch(/Loaded clip\.srt/);
  });

  it('rejects an oversized file', async () => {
    unmount = mountTranscriptImport(container, { onDraft: () => {} });
    pickFile(bigFile('huge.txt', 3 * 1024 * 1024, 'text/plain'));
    await flush();
    expect(container.querySelector('.transcript-import__error')?.textContent).toMatch(/larger than 2 MB/);
    expect(textarea().value).toBe('');
  });

  it('rejects unsupported file types', async () => {
    unmount = mountTranscriptImport(container, { onDraft: () => {} });
    pickFile(new File(['<p>hi</p>'], 'page.html', { type: 'text/html' }));
    await flush();
    expect(container.querySelector('.transcript-import__error')?.textContent).toMatch(/\.txt, \.srt or \.vtt/);
  });

  it('explains the speech-recognition limitation for audio/video files without reading them', async () => {
    unmount = mountTranscriptImport(container, { onDraft: () => {} });
    const video = bigFile('recipe.mp4', 50 * 1024 * 1024, 'video/mp4');
    const textSpy = vi.spyOn(video, 'text');
    pickFile(video);
    await flush();
    const notice = container.querySelector('.transcript-import__limitation') as HTMLElement;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toMatch(/not available in this build/);
    expect(notice.textContent).toMatch(/Paste the video captions/);
    expect(textSpy).not.toHaveBeenCalled();
    const link = notice.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')?.startsWith('#')).toBe(true);
    link.click();
    const help = container.querySelector('details') as HTMLDetailsElement;
    expect(help.open).toBe(true);
    expect(document.activeElement).toBe(help.querySelector('summary'));
  });

  it('cancel clears buffers, calls onCancel and ignores a late file read', async () => {
    const onCancel = vi.fn();
    const onDraft = vi.fn();
    unmount = mountTranscriptImport(container, { onDraft, onCancel });
    let resolve!: (s: string) => void;
    const slow = new File(['x'], 'slow.txt', { type: 'text/plain' });
    vi.spyOn(slow, 'text').mockReturnValue(new Promise<string>((r) => (resolve = r)));
    pickFile(slow);
    textarea().value = 'Mix the batter';
    button('Create draft').click();
    button('Cancel').click();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(container.querySelector('h2')?.textContent).toBe('Import a video transcript');
    expect(textarea().value).toBe('');
    resolve('late content');
    await flush();
    expect(textarea().value).toBe('');
    expect(onDraft).not.toHaveBeenCalled();
  });

  it('Back keeps the pasted text; unmount removes the component', () => {
    unmount = mountTranscriptImport(container, { onDraft: () => {} });
    textarea().value = 'Whisk the eggs';
    button('Create draft').click();
    button('Back').click();
    expect(textarea().value).toBe('Whisk the eggs');
    expect(document.activeElement).toBe(textarea());
    unmount();
    expect(container.children.length).toBe(0);
  });
});
