/** Small pure formatting helpers shared by extension pages. */

/** "PT1H30M" -> "1 hr 30 min". Returns null for missing or unparseable durations. */
export function formatDuration(iso: string | undefined): string | null {
  if (!iso) return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(iso.trim());
  if (!m || (!m[1] && !m[2] && !m[3] && !m[4])) return null;
  const days = Number(m[1] ?? 0);
  const hours = Number(m[2] ?? 0) + days * 24;
  let minutes = Number(m[3] ?? 0);
  const seconds = Number(m[4] ?? 0);
  if (seconds >= 30) minutes += 1;
  const parts: string[] = [];
  if (hours) parts.push(`${hours} hr`);
  if (minutes) parts.push(`${minutes} min`);
  if (!parts.length) return seconds ? `${seconds} sec` : null;
  return parts.join(' ');
}

/** True only for http(s) URLs (never javascript:, data:, chrome:, file:). */
export function isHttpUrl(url: string | undefined | null): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Host name for display ("www.example.com" -> "example.com"); '' when invalid. */
export function displayHost(url: string | undefined | null): string {
  if (!isHttpUrl(url)) return '';
  return new URL(url).hostname.replace(/^www\./, '');
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
