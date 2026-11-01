/**
 * Caption/subtitle stripping (PRD R11). Owner: media.
 * Converts SRT and WebVTT text into plain caption text. Pure; no DOM, no network.
 */

/** `00:00:01,000 --> 00:00:04,000` (SRT) or `00:01.000 --> 00:04.000 align:start` (WebVTT). */
const TIMESTAMP_LINE =
  /^\s*(?:\d{1,3}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?\s*-->\s*(?:\d{1,3}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?(?:\s.*)?$/;
const WEBVTT_HEADER = /^﻿?WEBVTT(?:[ \t].*)?$/;
const VTT_META_BLOCK = /^(?:NOTE|STYLE|REGION)(?:[ \t].*)?$/;

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
  '&lrm;': '',
  '&rlm;': '',
};

/** True when the text looks like SRT or WebVTT rather than plain prose. */
export function isCaptionFormat(text: string): boolean {
  const lines = normalizeNewlines(text).split('\n');
  const first = lines.find((l) => l.trim() !== '');
  if (first !== undefined && WEBVTT_HEADER.test(first.trim())) return true;
  return lines.some((l) => TIMESTAMP_LINE.test(l));
}

export function normalizeNewlines(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

/** Remove WebVTT/SRT markup from one caption text line. */
function cleanCueText(line: string): string {
  let out = line
    // Inline timestamps (<00:00:01.200>), voice/class/lang tags (<v Name>, <c.red>, </c>), and SRT <i>/<b>/<font>.
    .replace(/<[^>\n]{0,200}>/g, '')
    // SRT/ASS style override blocks like {\an8}.
    .replace(/\{\\[^}\n]{0,50}\}/g, '');
  out = out.replace(/&(?:amp|lt|gt|quot|apos|#39|nbsp|lrm|rlm);/g, (m) => ENTITIES[m] ?? m);
  return out.replace(/[ \t ]+/g, ' ').trim();
}

const comparable = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Merge rolling-caption repetition (auto-captions repeat the previous line,
 * or grow it word by word). Keeps order; only touches consecutive lines.
 */
function mergeRolling(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev !== undefined) {
      const a = comparable(prev);
      const b = comparable(line);
      if (b === '' || a === b) continue;
      // Growing caption: "add the" -> "add the flour". Replace the shorter prefix.
      if (a !== '' && b.startsWith(a + ' ')) {
        out[out.length - 1] = line;
        continue;
      }
      // Shrinking repeat: "add the flour" -> "the flour" (tail already shown).
      if (b !== '' && a.endsWith(' ' + b)) continue;
    }
    out.push(line);
  }
  return out;
}

/**
 * Detect and strip SRT/WebVTT timing so the result is plain caption text.
 * Plain text (no timestamps, no WEBVTT header) is returned with normalized
 * newlines and trailing whitespace removed; its lines are not merged.
 */
export function captionsToPlainText(text: string): string {
  const normalized = normalizeNewlines(text);
  if (!isCaptionFormat(normalized)) {
    return normalized
      .split('\n')
      .map((l) => l.replace(/[ \t]+$/, ''))
      .join('\n')
      .trim();
  }

  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of normalized.split('\n')) {
    if (line.trim() === '') {
      if (current.length) blocks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current);

  const textLines: string[] = [];
  blocks.forEach((block, blockIndex) => {
    const head = (block[0] ?? '').trim();
    if (blockIndex === 0 && WEBVTT_HEADER.test(head)) return;
    if (VTT_META_BLOCK.test(head)) return;

    const hasTimestamp = block.some((l) => TIMESTAMP_LINE.test(l));
    if (!hasTimestamp) {
      // Stray block without timing (malformed file): keep its text, drop bare cue numbers.
      for (const l of block) {
        const cleaned = cleanCueText(l);
        if (cleaned !== '' && !/^\d+$/.test(cleaned)) textLines.push(cleaned);
      }
      return;
    }

    let pending: string[] = [];
    let seenTimestamp = false;
    for (let i = 0; i < block.length; i++) {
      const raw = block[i] ?? '';
      if (TIMESTAMP_LINE.test(raw)) {
        // Lines before the first timestamp are cue identifiers/indices.
        // Between two timestamps (missing blank line), only drop a bare index line.
        if (!seenTimestamp) pending = [];
        else if (pending.length && /^\d+$/.test((pending[pending.length - 1] ?? '').trim())) pending.pop();
        textLines.push(...pending.map(cleanCueText).filter((s) => s !== ''));
        pending = [];
        seenTimestamp = true;
        continue;
      }
      pending.push(raw);
    }
    textLines.push(...pending.map(cleanCueText).filter((s) => s !== ''));
  });

  return mergeRolling(textLines).join('\n');
}
