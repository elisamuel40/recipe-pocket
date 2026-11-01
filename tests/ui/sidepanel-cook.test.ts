// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RecipeV1 } from '../../src/shared/types';
import { clampFontScale, mountCookMode } from '../../src/ui/components/cook-mode';

const recipe: RecipeV1 = {
  schemaVersion: 1,
  id: 'r',
  title: 'Soup',
  source: { url: '' },
  originalYield: { text: '' },
  times: { raw: '' },
  ingredientGroups: [{ id: 'g', title: '', items: [{ id: 'i1', raw: '1 onion', confidence: 'high' }, { id: 'i2', raw: 'salt', confidence: 'high' }] }],
  instructionGroups: [
    { id: 'a', title: 'Base', steps: [{ id: 's1', text: 'Chop.' }, { id: 's2', text: 'Fry.' }] },
    { id: 'b', title: 'Finish', steps: [{ id: 's3', text: 'Simmer.' }] },
  ],
  notes: '',
  tags: [],
  collectionIds: [],
  extraction: { method: 'manual', missingFields: [], warnings: [] },
  revision: 0,
};

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.replaceChildren();
});

function mount(over: Partial<Parameters<typeof mountCookMode>[2]> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const opts = { factor: { n: 1, d: 1 }, system: 'original' as const, prefs: { theme: 'system' as const, fontScale: 1 }, onPrefsChange: vi.fn(), onClose: vi.fn(), ...over };
  cleanup = mountCookMode(host, recipe, opts);
  return { host, opts };
}
const key = (k: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

describe('cook mode', () => {
  it('focuses the title and shows the first step', () => {
    const { host } = mount();
    expect(document.activeElement?.classList.contains('cook-title')).toBe(true);
    expect(host.querySelector('.cook-step-count')!.textContent).toBe('Step 1 of 3');
    expect(host.querySelector('.cook-step-text')!.textContent).toBe('Chop.');
    expect(host.querySelector('[aria-current="step"]')!.textContent).toBe('Chop.');
  });

  it('moves with buttons and keys and announces changes', () => {
    const { host } = mount();
    const live = host.querySelector('[aria-live="polite"][role="status"]')!;
    key('ArrowRight');
    expect(host.querySelector('.cook-step-text')!.textContent).toBe('Fry.');
    expect(live.textContent).toBe('Step 2 of 3. Fry.');
    key('j');
    expect(host.querySelector('.cook-step-group')!.textContent).toBe('Finish');
    key('j'); // stays on last step
    expect(host.querySelector('.cook-step-count')!.textContent).toBe('Step 3 of 3');
    key('k');
    key('ArrowLeft');
    expect(host.querySelector('.cook-step-count')!.textContent).toBe('Step 1 of 3');
    const [prev, next] = [...host.querySelectorAll<HTMLButtonElement>('.cook-nav button')];
    expect(prev!.disabled).toBe(true);
    next!.click();
    expect(host.querySelector('.cook-step-text')!.textContent).toBe('Fry.');
  });

  it('ignores step keys while typing in a field', () => {
    const { host } = mount();
    const select = host.querySelector('select')!;
    select.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(host.querySelector('.cook-step-count')!.textContent).toBe('Step 1 of 3');
  });

  it('adjusts text size and theme through onPrefsChange', () => {
    const { host, opts } = mount();
    host.querySelector<HTMLButtonElement>('[aria-label="Larger text"]')!.click();
    expect(opts.onPrefsChange).toHaveBeenLastCalledWith({ fontScale: 1.1 });
    const select = host.querySelector('select')!;
    select.value = 'dark';
    select.dispatchEvent(new Event('change'));
    expect(opts.onPrefsChange).toHaveBeenLastCalledWith({ theme: 'dark' });
    expect(clampFontScale(9)).toBe(2.5);
    expect(clampFontScale(0.1)).toBe(0.8);
  });

  it('has ingredient checkboxes and clears progress on close', () => {
    const { host, opts } = mount();
    const box = host.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    box.click();
    expect(box.checked).toBe(true);
    key('Escape');
    expect(opts.onClose).toHaveBeenCalled();
    cleanup!();
    cleanup = null;
    expect(host.querySelector('.cook-mode')).toBeNull();
    // Keyboard listener removed.
    const again = mount();
    expect(again.host.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false);
  });
});
