// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnnouncer } from '../../src/ui/common/status';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('createAnnouncer', () => {
  it('announces through the region’s own document, even if the global one is gone when the timer fires', () => {
    vi.useFakeTimers();
    const region = document.createElement('div');
    createAnnouncer(region)('Saved on this device.');
    vi.stubGlobal('document', undefined);
    vi.advanceTimersByTime(30);
    expect(region.textContent).toBe('Saved on this device.');
  });
});
