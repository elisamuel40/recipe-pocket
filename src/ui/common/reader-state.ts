/**
 * Pure side-panel reader state machine (no chrome.*, no DOM).
 *
 * Binds every extraction result to requestId + tabId + url and discards stale
 * results (ARCHITECTURE.md "Bind results to tab ID + URL + request ID").
 * Tab switches and navigations never replace the displayed recipe; they only
 * flag it as coming from a different page so the UI can offer a re-read.
 */
import type { RecipeField, RecipeV1 } from '../../shared/types';
import { isExtractionError, isExtractionResult, type ErrorCode } from '../../shared/messages';

export type ReaderPhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'partial'
  | 'multiple'
  | 'restricted'
  | 'none'
  | 'error'
  | 'timeout';

/** Why the displayed result may no longer match what the user is looking at. */
export type PageChange = 'tab' | 'navigated' | null;

export interface ReaderState {
  phase: ReaderPhase;
  /** Request currently bound to the panel (latest START). */
  requestId: string | null;
  /** Tab the bound request targets. */
  tabId: number | null;
  /** URL of the bound page (from the result, or from the tab when the request started). */
  url: string | null;
  candidates: RecipeV1[];
  selectedIndex: number | null;
  warnings: string[];
  errorCode: ErrorCode | 'UNKNOWN' | null;
  pageChange: PageChange;
  /** Most recently activated tab in this window, when known. */
  activeTabId: number | null;
}

export type ReaderEvent =
  | { type: 'START'; requestId: string; tabId: number; url?: string }
  | { type: 'RESPONSE'; requestId: string; message: unknown }
  | { type: 'FAILED'; requestId: string }
  | { type: 'TAB_ACTIVATED'; tabId: number }
  | { type: 'TAB_NAVIGATED'; tabId: number; url?: string }
  | { type: 'SELECT'; index: number }
  | { type: 'BACK_TO_CHOICES' }
  | { type: 'RESET' };

export function initialReaderState(): ReaderState {
  return {
    phase: 'idle',
    requestId: null,
    tabId: null,
    url: null,
    candidates: [],
    selectedIndex: null,
    warnings: [],
    errorCode: null,
    pageChange: null,
    activeTabId: null,
  };
}

/** Sections that make a candidate "partial" (R01: missing data is visibly missing). */
export function missingSections(r: RecipeV1): RecipeField[] {
  const missing = new Set<RecipeField>(r.extraction?.missingFields ?? []);
  const items = (r.ingredientGroups ?? []).reduce((n, g) => n + (g.items?.length ?? 0), 0);
  const steps = (r.instructionGroups ?? []).reduce((n, g) => n + (g.steps?.length ?? 0), 0);
  if (items === 0) missing.add('ingredients');
  if (steps === 0) missing.add('instructions');
  if (!r.title?.trim()) missing.add('title');
  return [...missing];
}

/** A candidate is partial when it lacks ingredients, instructions or a title. */
export function isPartial(r: RecipeV1): boolean {
  return missingSections(r).some((f) => f === 'ingredients' || f === 'instructions' || f === 'title');
}

export function phaseForError(code: ErrorCode | 'UNKNOWN'): ReaderPhase {
  switch (code) {
    case 'RESTRICTED_PAGE':
    case 'PAGE_CHANGED':
      return 'restricted';
    case 'NO_RECIPE':
    case 'PARTIAL_RECIPE':
      return 'none';
    case 'CANCELLED':
      return 'timeout';
    default:
      return 'error';
  }
}

/** Same document, ignoring the fragment (in-page anchors are not navigations). */
export function sameDocument(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const strip = (u: string) => {
    const i = u.indexOf('#');
    return i === -1 ? u : u.slice(0, i);
  };
  return strip(a) === strip(b);
}

/** True when a response for requestId must be ignored. */
export function isStale(state: ReaderState, requestId: string): boolean {
  return state.requestId === null || state.requestId !== requestId || state.phase !== 'loading';
}

/** The candidate currently shown (ready/partial), if any. */
export function selectedCandidate(state: ReaderState): RecipeV1 | null {
  if (state.selectedIndex === null) return null;
  return state.candidates[state.selectedIndex] ?? null;
}

function phaseForCandidate(r: RecipeV1): ReaderPhase {
  return isPartial(r) ? 'partial' : 'ready';
}

export function reduceReader(state: ReaderState, event: ReaderEvent): ReaderState {
  switch (event.type) {
    case 'START':
      return {
        ...initialReaderState(),
        phase: 'loading',
        requestId: event.requestId,
        tabId: event.tabId,
        url: event.url ?? null,
        activeTabId: event.tabId,
      };

    case 'RESPONSE': {
      if (isStale(state, event.requestId)) return state;
      const m = event.message;
      if (isExtractionResult(m) && m.requestId === event.requestId) {
        const candidates = m.candidates.filter(isRecipeLike);
        const url = m.url || state.url;
        // The bound tab navigated away while reading and the result reports another page.
        const pageChange: PageChange =
          state.pageChange ?? (state.url && url && !sameDocument(state.url, url) ? 'navigated' : null);
        if (candidates.length === 0) {
          return { ...state, phase: 'none', url, warnings: m.warnings, candidates: [], pageChange };
        }
        if (candidates.length === 1) {
          const only = candidates[0]!;
          return { ...state, phase: phaseForCandidate(only), url, warnings: m.warnings, candidates, selectedIndex: 0, pageChange };
        }
        return { ...state, phase: 'multiple', url, warnings: m.warnings, candidates, selectedIndex: null, pageChange };
      }
      if (isExtractionError(m) && m.requestId === event.requestId) {
        return { ...state, phase: phaseForError(m.code), errorCode: m.code };
      }
      return { ...state, phase: 'error', errorCode: 'UNKNOWN' };
    }

    case 'FAILED':
      if (isStale(state, event.requestId)) return state;
      return { ...state, phase: 'error', errorCode: 'UNKNOWN' };

    case 'TAB_ACTIVATED': {
      const next = { ...state, activeTabId: event.tabId };
      if (state.phase === 'idle' || state.tabId === null) return next;
      if (event.tabId !== state.tabId) return { ...next, pageChange: state.pageChange ?? 'tab' };
      // Back on the bound tab: a pure tab switch is resolved, a navigation is not.
      return { ...next, pageChange: state.pageChange === 'tab' ? null : state.pageChange };
    }

    case 'TAB_NAVIGATED': {
      if (state.phase === 'idle' || state.tabId === null || event.tabId !== state.tabId) return state;
      if (event.url && sameDocument(event.url, state.url)) return state;
      return { ...state, pageChange: 'navigated' };
    }

    case 'SELECT': {
      if (state.phase !== 'multiple' && state.phase !== 'ready' && state.phase !== 'partial') return state;
      const c = state.candidates[event.index];
      if (!c) return state;
      return { ...state, phase: phaseForCandidate(c), selectedIndex: event.index };
    }

    case 'BACK_TO_CHOICES':
      if (state.candidates.length < 2) return state;
      return { ...state, phase: 'multiple', selectedIndex: null };

    case 'RESET':
      return { ...initialReaderState(), activeTabId: state.activeTabId };
  }
}

/** Minimal structural check before rendering untrusted candidate data. */
export function isRecipeLike(v: unknown): v is RecipeV1 {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Partial<RecipeV1>;
  return (
    typeof r.id === 'string' &&
    typeof r.title === 'string' &&
    typeof r.source === 'object' &&
    r.source !== null &&
    Array.isArray(r.ingredientGroups) &&
    r.ingredientGroups.every((g) => g && Array.isArray(g.items)) &&
    Array.isArray(r.instructionGroups) &&
    r.instructionGroups.every((g) => g && Array.isArray(g.steps))
  );
}
