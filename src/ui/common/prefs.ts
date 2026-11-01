/**
 * Preference loading/saving for UI pages with session-only awareness.
 * Never throws: pages must render with defaults even if storage fails.
 */
import { DEFAULT_PREFERENCES, type Preferences } from '../../shared/types';
import { getPreferences, setPreferences } from '../../storage/index';
import { applyPreferences } from './theme';

export async function loadPreferences(): Promise<Preferences> {
  try {
    return { ...DEFAULT_PREFERENCES, ...(await getPreferences()) };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

/** Load preferences and apply theme/font scale to the current page. */
export async function loadAndApplyPreferences(): Promise<Preferences> {
  const p = await loadPreferences();
  applyPreferences(p);
  return p;
}

export interface PreferenceUpdate {
  prefs: Preferences;
  /** False when the change is kept in memory only (session-only or failure). */
  persisted: boolean;
  /** Plain-text message when the write failed for a reason other than session-only mode. */
  error?: string;
}

/**
 * Apply a preference change in memory and try to persist it. In session-only
 * mode the change stays in memory for this page (SESSION_ONLY is expected).
 */
export async function updatePreferences(current: Preferences, patch: Partial<Preferences>): Promise<PreferenceUpdate> {
  const next = { ...current, ...patch };
  if (current.sessionOnly) return { prefs: next, persisted: false };
  try {
    const saved = await setPreferences(patch);
    return { prefs: { ...next, ...saved, ...patch }, persisted: true };
  } catch (e) {
    if (errorCode(e) === 'SESSION_ONLY') return { prefs: next, persisted: false };
    return { prefs: next, persisted: false, error: storageErrorMessage(e, 'preference') };
  }
}

export function errorCode(e: unknown): string | undefined {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const c = (e as { code: unknown }).code;
    return typeof c === 'string' ? c : undefined;
  }
  return undefined;
}

/** User-facing, plain-text explanation for a storage failure. */
export function storageErrorMessage(e: unknown, what: 'recipe' | 'list' | 'preference' = 'recipe'): string {
  const thing = what === 'list' ? 'shopping list' : what === 'preference' ? 'setting' : 'recipe';
  switch (errorCode(e)) {
    case 'QUOTA':
      return `Not saved: this device is out of storage space for Recipe Pocket. Free up disk space or delete saved recipes, then try again. Your saved data was not changed.`;
    case 'SESSION_ONLY':
      return `Not saved: session-only mode is on, so nothing is written to this device. Turn it off in Settings to save this ${thing}.`;
    case 'CONFLICT':
      return `Not saved: this ${thing} was changed in another window. Reopen it and try again. Your saved data was not changed.`;
    case 'NOT_FOUND':
      return `Not saved: the ${thing} no longer exists on this device.`;
    default:
      return `Not saved: something went wrong while writing the ${thing}. Your saved data was not changed. Try again.`;
  }
}
