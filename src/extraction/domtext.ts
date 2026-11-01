/**
 * Read visible page text as an ordered list of blocks (headings, list items,
 * paragraphs). Skips scripts/styles, form controls, hidden elements, comments,
 * navigation, footers and recommendation widgets. Only textContent-style
 * reads are used; form values and page scripts are never touched.
 */
import type { ExtractionContext } from './draft';
import { collapse } from './text';

export type Zone = 'ingredients' | 'instructions' | 'notes' | undefined;

export interface Block {
  kind: 'heading' | 'item' | 'para';
  /** 1–6 for h1–h6; 7 for inferred (bold or "Label:") headings; 0 otherwise. */
  level: number;
  text: string;
  lines: string[];
  list?: Element;
  ordered?: boolean;
  zone?: Zone;
  el?: Element;
}

const SKIP_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed', 'svg', 'math', 'canvas',
  'video', 'audio', 'img', 'picture', 'source', 'link', 'meta', 'head', 'title',
  'form', 'input', 'textarea', 'select', 'option', 'button', 'label', 'fieldset', 'datalist', 'output',
  'nav', 'footer', 'aside', 'dialog', 'menu',
]);

const BLOCK_TAGS = new Set([
  'address', 'article', 'blockquote', 'dd', 'details', 'div', 'dl', 'dt', 'figcaption', 'figure',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'ol', 'p', 'pre', 'section',
  'summary', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'ul', 'center',
]);

const PARA_TAGS = new Set(['p', 'dt', 'dd', 'blockquote', 'figcaption', 'pre', 'td', 'th', 'summary', 'address']);

const PROTECTED_TAGS = new Set(['html', 'body', 'main']);

/** Class/id token patterns that mark non-recipe regions. */
const EXCLUDED_TOKEN = /comment|disqus|respond|related|recommend|sidebar|widget|newsletter|subscribe|share|social|breadcrumb|popup|modal|cookie|promo|advert|jump-to|skip-link/i;
/** Tokens that mention comments but describe page state, not a comment region. */
const STATE_TOKEN = /(open|closed|status|count|enabled|disabled)$/i;
/** Layout modifier tokens such as "has-sidebar" describe a wrapper, not a region. */
const MODIFIER_PREFIX = /^(has|with|no|show|hide|is|enable|disable|without)[-_]/i;

function tokens(el: Element): string[] {
  const cls = el.getAttribute('class') ?? '';
  const id = el.getAttribute('id') ?? '';
  return (cls + ' ' + id).split(/\s+/).filter(Boolean);
}

/** True when the element (and its subtree) must never be read. */
export function isExcluded(el: Element): boolean {
  const tag = el.localName;
  if (SKIP_TAGS.has(tag)) return true;
  if (el.hasAttribute('hidden')) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  const style = el.getAttribute('style');
  if (style && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) return true;
  const role = el.getAttribute('role');
  if (role === 'navigation' || role === 'complementary' || role === 'contentinfo' || role === 'dialog' || role === 'form' || role === 'search') return true;
  const itemtype = el.getAttribute('itemtype') ?? '';
  if (/schema\.org\/(Comment|UserComments)\b/i.test(itemtype)) return true;
  if (el.getAttribute('itemprop') === 'comment') return true;
  if (PROTECTED_TAGS.has(tag)) return false;
  for (const t of tokens(el)) {
    if (!EXCLUDED_TOKEN.test(t) || STATE_TOKEN.test(t) || MODIFIER_PREFIX.test(t)) continue;
    const isComment = /comment|disqus|respond/i.test(t);
    // Never drop the article itself or a layout wrapper that holds the page title.
    if (!isComment && (tag === 'article' || el.querySelector('h1'))) continue;
    if (isComment && el.querySelector('h1') && !/^(comments?|commentlist|comment-list|comments-area|comment-respond|respond|disqus_thread)$/i.test(t)) continue;
    return true;
  }
  return false;
}

/** True when el or any ancestor (up to stop) is excluded. */
export function isInExcludedRegion(el: Element, stop?: Element | null): boolean {
  for (let cur: Element | null = el; cur && cur !== stop; cur = cur.parentElement) {
    if (isExcluded(cur)) return true;
  }
  return false;
}

interface Line {
  text: string;
  bold: number;
  total: number;
}

// Underline is included: older blogs mark recipe group headings with <u> (e.g. "<u>Pastry</u><br>").
const isBoldTag = (t: string): boolean => t === 'strong' || t === 'b' || t === 'u' || /^h[1-6]$/.test(t);

/** Collect text lines from a list of nodes (br and nested blocks break lines). */
function textLines(nodes: Iterable<Node>, skipLists: boolean): Line[] {
  const lines: Line[] = [{ text: '', bold: 0, total: 0 }];
  const cur = (): Line => lines[lines.length - 1] as Line;
  const newLine = (): void => {
    if (cur().text.trim()) lines.push({ text: '', bold: 0, total: 0 });
  };
  const walk = (n: Node, bold: boolean): void => {
    if (n.nodeType === 3) {
      const data = n.nodeValue ?? '';
      const l = cur();
      l.text += data;
      const nonspace = data.replace(/\s+/g, '').length;
      l.total += nonspace;
      if (bold) l.bold += nonspace;
      return;
    }
    if (n.nodeType !== 1) return;
    const el = n as Element;
    const tag = el.localName;
    if (tag === 'br') {
      newLine();
      return;
    }
    if (isExcluded(el)) return;
    if (skipLists && (tag === 'ul' || tag === 'ol')) return;
    const block = BLOCK_TAGS.has(tag);
    if (block) newLine();
    const b = bold || isBoldTag(tag);
    for (const c of Array.from(el.childNodes)) walk(c, b);
    if (block) newLine();
  };
  for (const n of nodes) walk(n, false);
  return lines
    .map((l) => ({ ...l, text: collapse(l.text) }))
    .filter((l) => l.text.length > 0);
}

const LABEL_HEADING = /^[^\d¼½¾⅓⅔⅛⅜⅝⅞]{2,60}:$/u;

/** "Cinnamon Filling (enough for 9 tarts)": emphasized label followed only by a parenthetical. */
const PAREN_SUFFIX = /^(.+?)\s*\([^()]*\)$/;

function isPseudoHeading(l: Line): boolean {
  if (l.text.length > 60) return false;
  if (l.total > 0 && l.bold === l.total && !/[.!?]$/.test(l.text) && l.text.split(/\s+/).length <= 8) return true;
  const paren = PAREN_SUFFIX.exec(l.text);
  if (paren && l.bold > 0) {
    const label = (paren[1] as string).replace(/\s+/g, '');
    if (l.bold === label.length && !/\d/.test(label) && (paren[1] as string).split(/\s+/).length <= 6) return true;
  }
  return LABEL_HEADING.test(l.text) && l.text.split(/\s+/).length <= 8;
}

export interface LinearizeOptions {
  /** Assign ingredient/instruction/notes zones from class names (recipe cards). */
  zones?: boolean;
  /** Bound on the number of blocks produced. */
  maxBlocks?: number;
}

function zoneOf(el: Element): Zone {
  const t = tokens(el).join(' ');
  if (!t) return undefined;
  if (/ingredient/i.test(t)) return 'ingredients';
  if (/instruction|direction|method|recipe-steps|preparation/i.test(t)) return 'instructions';
  if (/(^|[-_\s])notes?($|[-_\s])/i.test(t)) return 'notes';
  return undefined;
}

/** Linearize visible text under root into ordered blocks. */
export function linearize(root: Element, ctx: ExtractionContext, opts: LinearizeOptions = {}): Block[] {
  const out: Block[] = [];
  const maxBlocks = opts.maxBlocks ?? 20000;
  let stopped = false;
  // Each scan of page text has its own 2 MB budget (structured data is counted separately).
  let used = 0;

  const push = (b: Block): void => {
    if (stopped) return;
    if (out.length >= maxBlocks) {
      stopped = true;
      ctx.warn('The page has more text blocks than can be scanned; only the first part was read.');
      return;
    }
    if (used + b.text.length > ctx.maxChars) {
      stopped = true;
      ctx.limitHit = true;
      ctx.warn('The page text exceeds the 2 MB input limit; content after that point was not read.');
      return;
    }
    used += b.text.length;
    out.push(b);
  };

  const emitLines = (lines: Line[], el: Element, zone: Zone, kind: 'item' | 'para', list?: Element, ordered?: boolean): void => {
    if (!lines.length) return;
    let rest = lines;
    const first = lines[0] as Line;
    if (isPseudoHeading(first) && (kind === 'para' || lines.length > 1 || /:$|^for\s/i.test(first.text))) {
      push({ kind: 'heading', level: 7, text: first.text, lines: [first.text], zone, el });
      rest = lines.slice(1);
    }
    if (!rest.length) return;
    const texts = rest.map((l) => l.text);
    const b: Block = { kind, level: 0, text: texts.join('\n'), lines: texts, zone, el };
    if (list) {
      b.list = list;
      b.ordered = !!ordered;
    }
    push(b);
  };

  const visit = (el: Element, parentZone: Zone): void => {
    if (stopped || isExcluded(el)) return;
    const tag = el.localName;
    const zone = opts.zones ? (parentZone ?? zoneOf(el)) : undefined;
    const h = /^h([1-6])$/.exec(tag);
    if (h) {
      const text = textLines(el.childNodes, false).map((l) => l.text).join(' ');
      if (text) push({ kind: 'heading', level: Number(h[1]), text, lines: [text], zone, el });
      return;
    }
    if (tag === 'li') {
      const list = el.parentElement;
      emitLines(textLines(el.childNodes, true), el, zone, 'item', list ?? el, list?.localName === 'ol');
      for (const c of Array.from(el.children)) {
        if (c.localName === 'ul' || c.localName === 'ol') visit(c, zone);
      }
      return;
    }
    if (PARA_TAGS.has(tag)) {
      emitLines(textLines(el.childNodes, false), el, zone, 'para');
      return;
    }
    // Generic container: inline runs between block children become paragraphs.
    let run: Node[] = [];
    const flush = (): void => {
      if (run.length) emitLines(textLines(run, false), el, zone, 'para');
      run = [];
    };
    for (const c of Array.from(el.childNodes)) {
      if (stopped) return;
      if (c.nodeType === 1) {
        const ce = c as Element;
        if (BLOCK_TAGS.has(ce.localName) || ce.children.length > 0 && containsBlock(ce)) {
          flush();
          visit(ce, zone);
          continue;
        }
        run.push(c);
      } else if (c.nodeType === 3) {
        run.push(c);
      }
    }
    flush();
  };

  visit(root, undefined);
  return out;
}

function containsBlock(el: Element): boolean {
  for (const c of Array.from(el.children)) {
    if (BLOCK_TAGS.has(c.localName)) return true;
  }
  return false;
}

/** Visible text of one element as a single line (used for small metadata fields). */
export function elementText(el: Element): string {
  if (isExcluded(el)) return '';
  return textLines(el.childNodes, false).map((l) => l.text).join(' ');
}
