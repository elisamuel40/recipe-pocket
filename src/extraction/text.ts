/**
 * Plain-text helpers for extraction. Page strings are untrusted: markup is
 * stripped to text with a manual tokenizer and entity decoder. Nothing here
 * creates DOM nodes or uses innerHTML, so no page code can run and no
 * resource can load.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0',
  ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009', shy: '',
  ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›', prime: '′', Prime: '″',
  frac12: '½', frac14: '¼', frac34: '¾', frac13: '⅓', frac23: '⅔',
  frac15: '⅕', frac25: '⅖', frac35: '⅗', frac45: '⅘', frac16: '⅙',
  frac56: '⅚', frac18: '⅛', frac38: '⅜', frac58: '⅝', frac78: '⅞',
  frasl: '⁄', deg: '°', times: '×', divide: '÷', minus: '−', plusmn: '±',
  micro: 'µ', copy: '©', reg: '®', trade: '™', sect: '§', para: '¶',
  cent: '¢', pound: '£', euro: '€', yen: '¥', iexcl: '¡', iquest: '¿',
  sup1: '¹', sup2: '²', sup3: '³', ordf: 'ª', ordm: 'º',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å',
  AElig: 'Æ', Ccedil: 'Ç', Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë',
  Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î', Iuml: 'Ï', Ntilde: 'Ñ', Ograve: 'Ò',
  Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', Oslash: 'Ø', Ugrave: 'Ù',
  Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü', Yacute: 'Ý', szlig: 'ß',
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å',
  aelig: 'æ', ccedil: 'ç', egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë',
  igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï', ntilde: 'ñ', ograve: 'ò',
  oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø', ugrave: 'ù',
  uacute: 'ú', ucirc: 'û', uuml: 'ü', yacute: 'ý', yuml: 'ÿ', OElig: 'Œ',
  oelig: 'œ', Scaron: 'Š', scaron: 'š',
};

function codePointToString(cp: number): string {
  if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '�';
  if (cp < 0x20 && cp !== 0x0a && cp !== 0x09) return ' ';
  return String.fromCodePoint(cp);
}

/** Decode HTML character references. Unknown named references are left as-is. */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31})(;?)/g, (m, body: string, semi: string) => {
    if (body.startsWith('#')) {
      const cp = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return codePointToString(cp);
    }
    if (!semi) return m;
    const v = NAMED_ENTITIES[body];
    return v === undefined ? m : v;
  });
}

const BLOCK_TAGS = new Set([
  'p', 'div', 'br', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'table', 'section',
  'article', 'blockquote', 'dd', 'dt', 'dl', 'hr', 'pre', 'header', 'footer', 'figure', 'figcaption',
]);

/** Remove markup from a string. Block tags become newlines, inline tags vanish. */
export function stripTags(s: string): string {
  let t = s.replace(/<!--[\s\S]*?(-->|$)/g, '');
  // Raw-text elements: their content is never text for the user.
  t = t.replace(/<(script|style|noscript|template|iframe|object|svg|math|textarea|select)\b[\s\S]*?(<\/\1\s*>|$)/gi, '');
  t = t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  t = t.replace(/<\/?([A-Za-z][A-Za-z0-9-]*)\b[^>]*>/g, (_m, name: string) =>
    BLOCK_TAGS.has(name.toLowerCase()) ? '\n' : '',
  );
  // Doctype / processing instructions / stray "<!" constructs.
  t = t.replace(/<[!?][^>]*>/g, ' ');
  return t;
}

const TAG_LIKE = /<\/?[A-Za-z][A-Za-z0-9-]*(\s[^>]*)?\/?>|<!--/;
const ENTITY_LIKE = /&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]+);/;

function cleanOnce(s: string): string {
  let t = s;
  if (TAG_LIKE.test(t)) t = stripTags(t);
  return decodeEntities(t);
}

/** Normalize whitespace on one line: NBSP and friends -> space, collapse runs. */
export function collapse(s: string): string {
  return s
    .replace(/[\u00A0\u2007\u202F\u2000-\u200A\u3000]/g, ' ')
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Convert an untrusted string (possibly HTML or entity-encoded, possibly
 * double-encoded) into plain-text lines. Empty lines are dropped.
 */
export function htmlToLines(input: unknown): string[] {
  if (typeof input !== 'string' && typeof input !== 'number') return [];
  let t = cleanOnce(String(input));
  // One more pass for double-encoded content ("&lt;p&gt;" or "&amp;#8217;").
  if (TAG_LIKE.test(t) || ENTITY_LIKE.test(t)) t = cleanOnce(t);
  return t
    .split(/\r\n|\r|\n|\u2028|\u2029/)
    .map(collapse)
    .filter((l) => l.length > 0);
}

/** Convert an untrusted string to a single plain-text line. */
export function htmlToText(input: unknown): string {
  return htmlToLines(input).join(' ');
}

/** Lowercased alphanumerics only, for loose title comparison. */
export function titleKey(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
}

export function similarTitles(a: string, b: string): boolean {
  const ka = titleKey(a);
  const kb = titleKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const [short, long] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  return short.length >= 6 && long.includes(short);
}
