/**
 * Per-page in-memory state. Never persisted. Cleared by closeDatabase() and
 * deleteAllData().
 */
import type { Preferences } from '../shared/types';

/** Preference changes made while session-only mode is on (memory only). */
export let sessionPrefs: Partial<Preferences> = {};

export function setSessionPrefs(p: Partial<Preferences>): void {
  sessionPrefs = p;
}

/** Search text cache: recipe id -> { revision, folded text }. */
export const searchCache = new Map<string, { revision: number; text: string }>();

export function resetMemoryState(): void {
  sessionPrefs = {};
  searchCache.clear();
}
