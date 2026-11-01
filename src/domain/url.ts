/** Source URL normalization (ARCHITECTURE.md: reject javascript/data links). */

const TRACKING_KEYS = new Set([
  'fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid', 'igshid', '_ga', 'ref_src', 'yclid',
  'gbraid', 'wbraid', '_hsenc', '_hsmi', 'twclid', 'ttclid',
]);

const MAX_URL_LENGTH = 8192;

export function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  return k.startsWith('utm_') || TRACKING_KEYS.has(k);
}

/**
 * Normalize a source URL: http(s) only, strip credentials and fragment, drop
 * known tracking keys (utm_*, fbclid, gclid, mc_cid, mc_eid, ...). Returns null
 * for non-http(s) (javascript:, data:, chrome:, file:) or invalid URLs.
 */
export function normalizeSourceUrl(url: string): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname) return null;
  u.username = '';
  u.password = '';
  u.hash = '';
  // Filter the raw query so kept parameters retain their original encoding.
  if (u.search) {
    const kept = u.search
      .slice(1)
      .split('&')
      .filter((part) => {
        if (!part) return false;
        const rawKey = part.split('=')[0] ?? '';
        let key: string;
        try {
          key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
        } catch {
          key = rawKey;
        }
        return !isTrackingParam(key);
      });
    u.search = kept.length ? `?${kept.join('&')}` : '';
  }
  return u.toString();
}
