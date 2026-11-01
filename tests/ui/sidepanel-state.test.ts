import { describe, expect, it } from 'vitest';
import type { RecipeV1 } from '../../src/shared/types';
import {
  initialReaderState,
  isPartial,
  reduceReader,
  sameDocument,
  type ReaderEvent,
  type ReaderState,
} from '../../src/ui/common/reader-state';

function cand(id: string, over: Partial<RecipeV1> = {}): RecipeV1 {
  return {
    schemaVersion: 1,
    id,
    title: `Recipe ${id}`,
    source: { url: 'https://example.com/r' },
    originalYield: { text: '' },
    times: { raw: '' },
    ingredientGroups: [{ id: 'g', title: '', items: [{ id: 'i', raw: '1 egg', confidence: 'high' }] }],
    instructionGroups: [{ id: 's', title: '', steps: [{ id: 'st', text: 'Cook.' }] }],
    notes: '',
    tags: [],
    collectionIds: [],
    extraction: { method: 'json-ld', missingFields: [], warnings: [] },
    revision: 0,
    ...over,
  };
}

const run = (events: ReaderEvent[], s: ReaderState = initialReaderState()) => events.reduce(reduceReader, s);
const start = (requestId: string, tabId = 1, url = 'https://example.com/r'): ReaderEvent => ({ type: 'START', requestId, tabId, url });
const result = (requestId: string, candidates: RecipeV1[], url = 'https://example.com/r'): ReaderEvent => ({
  type: 'RESPONSE',
  requestId,
  message: { type: 'EXTRACTION_RESULT', requestId, url, candidates, warnings: [] },
});
const error = (requestId: string, code: string): ReaderEvent => ({
  type: 'RESPONSE',
  requestId,
  message: { type: 'EXTRACTION_ERROR', requestId, code },
});

describe('reader state machine', () => {
  it('loading -> ready with a single complete candidate', () => {
    const s = run([start('a'), result('a', [cand('1')])]);
    expect(s.phase).toBe('ready');
    expect(s.selectedIndex).toBe(0);
    expect(s.tabId).toBe(1);
  });

  it('partial when ingredients or steps are missing', () => {
    const c = cand('1', { instructionGroups: [], extraction: { method: 'dom', missingFields: ['instructions'], warnings: [] } });
    expect(isPartial(c)).toBe(true);
    expect(run([start('a'), result('a', [c])]).phase).toBe('partial');
  });

  it('multiple candidates require a choice and are never combined', () => {
    let s = run([start('a'), result('a', [cand('1'), cand('2')])]);
    expect(s.phase).toBe('multiple');
    expect(s.selectedIndex).toBeNull();
    s = reduceReader(s, { type: 'SELECT', index: 1 });
    expect(s.phase).toBe('ready');
    expect(s.candidates[s.selectedIndex!]!.id).toBe('2');
    expect(s.candidates).toHaveLength(2);
    s = reduceReader(s, { type: 'BACK_TO_CHOICES' });
    expect(s.phase).toBe('multiple');
  });

  it('discards results from an older request', () => {
    const s = run([start('old'), start('new'), result('old', [cand('stale')])]);
    expect(s.phase).toBe('loading');
    expect(run([result('new', [cand('fresh')])], s).candidates[0]!.id).toBe('fresh');
  });

  it('ignores a duplicate response after the request completed', () => {
    const s = run([start('a'), result('a', [cand('1')])]);
    expect(reduceReader(s, result('a', [cand('2')]))).toBe(s);
  });

  it('ignores responses whose inner requestId does not match', () => {
    const s = run([start('a'), { type: 'RESPONSE', requestId: 'a', message: { type: 'EXTRACTION_RESULT', requestId: 'b', url: 'x', candidates: [], warnings: [] } }]);
    expect(s.phase).toBe('error');
  });

  it('maps error codes to states', () => {
    expect(run([start('a'), error('a', 'RESTRICTED_PAGE')]).phase).toBe('restricted');
    expect(run([start('a'), error('a', 'PAGE_CHANGED')]).phase).toBe('restricted');
    expect(run([start('a'), error('a', 'NO_RECIPE')]).phase).toBe('none');
    expect(run([start('a'), error('a', 'CANCELLED')]).phase).toBe('timeout');
    expect(run([start('a'), error('a', 'INPUT_TOO_LARGE')]).phase).toBe('error');
    expect(run([start('a'), { type: 'RESPONSE', requestId: 'a', message: undefined }]).phase).toBe('error');
    expect(run([start('a'), { type: 'FAILED', requestId: 'a' }]).phase).toBe('error');
    expect(run([start('a'), result('a', [])]).phase).toBe('none');
  });

  it('drops malformed candidates', () => {
    const s = run([start('a'), result('a', [{ nope: true } as unknown as RecipeV1, cand('ok')])]);
    expect(s.phase).toBe('ready');
    expect(s.candidates).toHaveLength(1);
  });

  it('switching tabs keeps the recipe but marks it as from another tab', () => {
    let s = run([start('a'), result('a', [cand('1')])]);
    s = reduceReader(s, { type: 'TAB_ACTIVATED', tabId: 2 });
    expect(s.phase).toBe('ready');
    expect(s.candidates[0]!.id).toBe('1');
    expect(s.pageChange).toBe('tab');
    s = reduceReader(s, { type: 'TAB_ACTIVATED', tabId: 1 });
    expect(s.pageChange).toBeNull();
  });

  it('navigation of the bound tab marks the result; same-document fragments do not', () => {
    let s = run([start('a'), result('a', [cand('1')])]);
    expect(reduceReader(s, { type: 'TAB_NAVIGATED', tabId: 1, url: 'https://example.com/r#step-2' })).toBe(s);
    expect(reduceReader(s, { type: 'TAB_NAVIGATED', tabId: 9, url: 'https://other.example/' })).toBe(s);
    s = reduceReader(s, { type: 'TAB_NAVIGATED', tabId: 1, url: 'https://example.com/other' });
    expect(s.pageChange).toBe('navigated');
    // Returning to the tab does not clear a navigation flag.
    s = reduceReader(reduceReader(s, { type: 'TAB_ACTIVATED', tabId: 2 }), { type: 'TAB_ACTIVATED', tabId: 1 });
    expect(s.pageChange).toBe('navigated');
  });

  it('a result whose URL differs from the requested page is flagged, not silently accepted', () => {
    const s = run([start('a', 1, 'https://example.com/r'), result('a', [cand('1')], 'https://example.com/elsewhere')]);
    expect(s.phase).toBe('ready');
    expect(s.pageChange).toBe('navigated');
  });

  it('navigation during loading carries over to the result', () => {
    const s = run([start('a'), { type: 'TAB_NAVIGATED', tabId: 1 }, result('a', [cand('1')])]);
    expect(s.pageChange).toBe('navigated');
  });

  it('a new START clears page-change flags', () => {
    const s = run([start('a'), result('a', [cand('1')]), { type: 'TAB_ACTIVATED', tabId: 2 }, start('b', 2)]);
    expect(s.pageChange).toBeNull();
    expect(s.tabId).toBe(2);
  });

  it('sameDocument ignores fragments only', () => {
    expect(sameDocument('https://a/x#1', 'https://a/x')).toBe(true);
    expect(sameDocument('https://a/x?p=1', 'https://a/x?p=2')).toBe(false);
    expect(sameDocument(null, 'https://a/x')).toBe(false);
  });
});
