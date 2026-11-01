/** ISO 8601 duration helpers for recipe times. */

const ISO_RE = /^P(?!$)(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?=\d)(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/** Returns the canonical (uppercase) ISO duration or undefined when invalid. */
export function normalizeIsoDuration(v: string): string | undefined {
  const s = v.trim().toUpperCase();
  return ISO_RE.test(s) ? s : undefined;
}

/** Human display for an ISO duration, e.g. "PT1H30M" -> "1 hr 30 min". */
export function isoToHuman(iso: string): string {
  const m = ISO_RE.exec(iso);
  if (!m) return iso;
  const [, y, mo, w, d, h, mi, s] = m;
  const parts: string[] = [];
  if (y && Number(y)) parts.push(`${y} yr`);
  if (mo && Number(mo)) parts.push(`${mo} mo`);
  if (w && Number(w)) parts.push(`${w} wk`);
  if (d && Number(d)) parts.push(`${d} day${Number(d) === 1 ? '' : 's'}`);
  if (h && Number(h)) parts.push(`${h} hr`);
  if (mi && Number(mi)) parts.push(`${mi} min`);
  if (s && Number(s)) parts.push(`${s} sec`);
  return parts.length ? parts.join(' ') : '0 min';
}

/**
 * Parse simple human durations ("1 hour 15 minutes", "45 mins", "2 hrs") into
 * ISO. Returns undefined for anything ambiguous (ranges, fractions, words).
 */
export function humanToIso(text: string): string | undefined {
  const s = text.toLowerCase().replace(/,/g, ' ').trim();
  if (!s || /\d\s*[-–—]\s*\d|\bto\b|\/|[¼½¾⅓⅔]/.test(s)) return undefined;
  const re = /(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g;
  let d = 0;
  let h = 0;
  let mi = 0;
  let sec = 0;
  let found = false;
  let consumed = s;
  for (const m of s.matchAll(re)) {
    found = true;
    const n = Number(m[1]);
    const u = m[2] ?? '';
    if (u.startsWith('d')) d += n;
    else if (u.startsWith('h')) h += n;
    else if (u.startsWith('m')) mi += n;
    else sec += n;
    consumed = consumed.replace(m[0], ' ');
  }
  if (!found || /\d/.test(consumed)) return undefined;
  if (!Number.isInteger(d) || !Number.isInteger(mi) || !Number.isInteger(sec)) return undefined;
  if (!Number.isInteger(h)) {
    const whole = Math.floor(h);
    mi += Math.round((h - whole) * 60);
    h = whole;
  }
  let out = 'P';
  if (d) out += `${d}D`;
  if (h || mi || sec) out += 'T' + (h ? `${h}H` : '') + (mi ? `${mi}M` : '') + (sec ? `${sec}S` : '');
  return out === 'P' ? 'PT0M' : out;
}
