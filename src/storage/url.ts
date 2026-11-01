/**
 * Source URL normalization for duplicate detection and validation. Delegates
 * to the domain module; falls back to a local equivalent only if the domain
 * implementation throws (e.g. not implemented yet).
 */
import { normalizeSourceUrl } from '../domain';

const TRACKING_KEYS = new Set(['fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid', 'igshid', 'yclid', '_ga', '_gl']);

export function fallbackNormalizeUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.username = '';
  u.password = '';
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) {
    const k = key.toLowerCase();
    if (k.startsWith('utm_') || TRACKING_KEYS.has(k)) u.searchParams.delete(key);
  }
  return u.toString();
}

export function normalizeUrl(input: string): string | null {
  try {
    return normalizeSourceUrl(input);
  } catch {
    return fallbackNormalizeUrl(input);
  }
}
