/**
 * DOM-based strategies: schema.org microdata, explicit recipe-card containers
 * (generic class patterns only) and a bounded heading/layout fallback.
 */
import { emptyDraft, type Draft, type ExtractionContext } from './draft';
import { type Block, elementText, isExcluded, isInExcludedRegion, linearize } from './domtext';
import { humanToIso, normalizeIsoDuration, isoToHuman } from './duration';
import {
  applyTimeLine,
  blocksToIngredients,
  blocksToInstructions,
  classifyHeading,
  sectionGroupTitle,
  yieldFromLine,
  type SectionKind,
} from './sections';
import { collapse } from './text';

// ---------- Page metadata ----------

export interface PageMeta {
  title: string;
  author?: string;
  publisher?: string;
}

function metaContent(doc: Document, selector: string): string {
  const el = doc.querySelector(selector);
  return collapse(el?.getAttribute('content') ?? '');
}

export function readPageMeta(doc: Document): PageMeta {
  const h1 = Array.from(doc.querySelectorAll('h1')).find((h) => !isInExcludedRegion(h));
  const title =
    (h1 ? elementText(h1) : '') ||
    metaContent(doc, 'meta[property="og:title"]') ||
    collapse(doc.title ?? '').split(/\s+[|–—]\s+/)[0] ||
    '';
  const meta: PageMeta = { title };
  const author = metaContent(doc, 'meta[name="author"]');
  if (author) meta.author = author;
  const publisher = metaContent(doc, 'meta[property="og:site_name"]');
  if (publisher) meta.publisher = publisher;
  return meta;
}

// ---------- Microdata ----------

function itemValue(el: Element): string {
  const tag = el.localName;
  if (tag === 'meta') return collapse(el.getAttribute('content') ?? '');
  if (tag === 'time') return collapse(el.getAttribute('datetime') ?? '') || elementText(el);
  if (tag === 'data' || tag === 'meter') return collapse(el.getAttribute('value') ?? '');
  return elementText(el);
}

function scopeProps(scope: Element): Map<string, Element[]> {
  const map = new Map<string, Element[]>();
  for (const el of Array.from(scope.querySelectorAll('[itemprop]'))) {
    const owner = el.hasAttribute('itemscope') ? el.parentElement?.closest('[itemscope]') : el.closest('[itemscope]');
    if (owner !== scope) continue;
    if (el.parentElement && el.parentElement !== scope && isInExcludedRegion(el.parentElement, scope)) continue;
    if (el.localName !== 'meta' && el.localName !== 'link' && isExcluded(el)) continue;
    for (const name of (el.getAttribute('itemprop') ?? '').split(/\s+/).filter(Boolean)) {
      const list = map.get(name) ?? [];
      list.push(el);
      map.set(name, list);
    }
  }
  return map;
}

const isRecipeType = (el: Element): boolean =>
  (el.getAttribute('itemtype') ?? '').split(/\s+/).some((t) => /schema\.org\/Recipe$/i.test(t));

function microTime(d: Draft, key: 'prep' | 'cook' | 'total', label: string, els: Element[] | undefined): void {
  const el = els?.[0];
  if (!el) return;
  const v = itemValue(el);
  const iso = normalizeIsoDuration(v) ?? humanToIso(v);
  if (iso) d.times[key] = iso;
  const shown = el.localName === 'meta' ? (iso ? isoToHuman(iso) : v) : elementText(el) || v;
  if (shown) d.times.raw.push(`${label}: ${shown}`);
}

function microInstructionBlocks(el: Element, ctx: ExtractionContext): Block[] {
  if (el.hasAttribute('itemscope')) {
    const props = scopeProps(el);
    const out: Block[] = [];
    const name = props.get('name')?.[0];
    const steps = props.get('itemListElement') ?? props.get('step') ?? [];
    if (steps.length) {
      if (name) out.push({ kind: 'heading', level: 7, text: itemValue(name), lines: [itemValue(name)], el });
      for (const s of steps) out.push(...microInstructionBlocks(s, ctx));
      return out;
    }
    const text = props.get('text')?.[0] ?? name;
    const t = text ? itemValue(text) : elementText(el);
    return t ? [{ kind: 'item', level: 0, text: t, lines: [t], el }] : [];
  }
  return linearize(el, ctx, { maxBlocks: 2000 });
}

export function extractMicrodata(doc: Document, ctx: ExtractionContext, meta: PageMeta): Draft[] {
  const scopes = Array.from(doc.querySelectorAll('[itemscope][itemtype]')).filter(
    (el) => isRecipeType(el) && !isInExcludedRegion(el),
  );
  const drafts: Draft[] = [];
  for (const scope of scopes.slice(0, ctx.maxCandidates)) {
    const props = scopeProps(scope);
    const d = emptyDraft('microdata');
    const nameEl = props.get('name')?.[0];
    d.title = nameEl ? itemValue(nameEl) : '';
    const authorEl = props.get('author')?.[0];
    if (authorEl) {
      const n = authorEl.hasAttribute('itemscope') ? scopeProps(authorEl).get('name')?.[0] : undefined;
      d.author = (n ? itemValue(n) : itemValue(authorEl)) || undefined;
    }
    if (!d.author && meta.author) d.author = meta.author;
    if (meta.publisher) d.publisher = meta.publisher;
    const y = props.get('recipeYield')?.[0];
    if (y) d.yieldText = itemValue(y) || undefined;
    microTime(d, 'prep', 'Prep', props.get('prepTime'));
    microTime(d, 'cook', 'Cook', props.get('cookTime'));
    microTime(d, 'total', 'Total', props.get('totalTime'));
    const ingEls = [...(props.get('recipeIngredient') ?? []), ...(props.get('ingredients') ?? [])];
    ingEls.sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));
    const ingBlocks = ingEls.flatMap((el) =>
      el.localName === 'meta' ? [{ kind: 'item' as const, level: 0, text: itemValue(el), lines: [itemValue(el)].filter(Boolean), el }] : linearize(el, ctx, { maxBlocks: 2000 }),
    );
    d.ingredientGroups = blocksToIngredients(ingBlocks, d);
    const insBlocks = (props.get('recipeInstructions') ?? []).flatMap((el) => microInstructionBlocks(el, ctx));
    d.instructionGroups = blocksToInstructions(insBlocks);
    drafts.push(d);
  }
  if (scopes.length > ctx.maxCandidates) {
    ctx.warn(`The page marks up ${scopes.length} recipes; only the first ${ctx.maxCandidates} were read.`);
  }
  return drafts;
}

// ---------- Heading-section strategy ----------

interface Section {
  kind: SectionKind;
  heading: Block;
  start: number;
  blocks: Block[];
}

const MAX_SECTION_BLOCKS = 400;

function findSections(blocks: Block[]): Section[] {
  const sections: Section[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const h = blocks[i] as Block;
    if (h.kind !== 'heading') continue;
    const kind = classifyHeading(h.text);
    if (!kind) continue;
    const body: Block[] = [];
    let j = i + 1;
    for (; j < blocks.length && body.length < MAX_SECTION_BLOCKS; j++) {
      const b = blocks[j] as Block;
      if (b.kind === 'heading') {
        if (classifyHeading(b.text)) break;
        const sub = b.level === 7 || b.level > h.level || /^for\s/i.test(b.text);
        if (!sub) break;
      }
      body.push(b);
    }
    sections.push({ kind, heading: h, start: i, blocks: body });
    i = j - 1;
  }
  return sections;
}

function titleBefore(blocks: Block[], index: number, level: number, fallback: string): string {
  for (let i = index - 1; i >= 0 && i >= index - 200; i--) {
    const b = blocks[i] as Block;
    if (b.kind !== 'heading' || classifyHeading(b.text)) continue;
    if (b.level < level || (level === 7 && b.level <= 6)) return b.text.replace(/:\s*$/, '');
  }
  return fallback;
}

/** Recipes delimited by Ingredients / Instructions headings. */
export function headingStrategy(blocks: Block[], meta: PageMeta, method: Draft['method']): Draft[] {
  const sections = findSections(blocks);
  const drafts: Draft[] = [];
  let cur: Draft | null = null;
  let sawInstr = false;
  for (const s of sections) {
    if (s.kind === 'ingredients' && (!cur || sawInstr)) {
      cur = emptyDraft(method);
      cur.title = titleBefore(blocks, s.start, s.heading.level, meta.title);
      drafts.push(cur);
      sawInstr = false;
    }
    if (!cur) {
      cur = emptyDraft(method);
      cur.title = titleBefore(blocks, s.start, s.heading.level, meta.title);
      drafts.push(cur);
    }
    if (s.kind === 'ingredients') {
      cur.ingredientGroups.push(...blocksToIngredients(s.blocks, cur, sectionGroupTitle(s.heading.text)));
    } else if (s.kind === 'instructions') {
      sawInstr = true;
      cur.instructionGroups.push(...blocksToInstructions(s.blocks, sectionGroupTitle(s.heading.text)));
    } else {
      // One paragraph per block so separate topics stay apart.
      const text = s.blocks.map((b) => (b.kind === 'heading' ? b.text : b.lines.join('\n'))).join('\n\n');
      if (text) cur.notes.push(text);
    }
  }
  return drafts.filter((d) => d.ingredientGroups.length || d.instructionGroups.length);
}

// ---------- Layout inference (no section headings) ----------

const QTY_START = /^\s*(?:about\s+|approx\.?\s+|scant\s+|heaping\s+)?(?:\d|[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|(?:a|one|two|three|four|five|six|eight|twelve)\s+(?:pinch|dash|handful|cups?|tablespoons?|teaspoons?|large|medium|small|whole|sticks?|cloves?|cans?|sprigs?|bunch)|pinch\b|dash\b|handful\b)/i;
const NOTE_START = /^(notes?|tips?|do ahead|make ahead|storage|to store|variations?|substitutions?)\b\s*[:.\-–—]/i;
/** "Label: rest" with a short, digit-free label (inline bold/underlined run-in heading). */
const INLINE_LABEL = /^([^:\d]{2,40}):\s+(\S.*)$/u;
/** Labels that mark a note rather than a step ("Charming tip from…", "Whole wheat variation", "Warm kitchen warning"). */
const NOTE_LABEL = /\b(notes?|tips?|variations?|warnings?|substitutions?|swaps?|do ahead|make ahead|storage|to store|leftovers|serving suggestions?)\b/i;
/** Run-in step labels usually start with an imperative cooking verb or "To …". */
const STEP_LABEL_VERB = /^(to|make|bake|assemble|mix|prepare|prep|cook|roll|cut|fill|finish|form|shape|chill|rest|serve|whisk|combine|glaze|fry|boil|roast|grill|toast|divide|knead|simmer|blend|stir|season|top|cool|freeze|preheat|heat|place|add|beat|fold|pour|spread|layer|brush|sprinkle|garnish|melt|cream|line|grease|drain|soak|marinate|sear|saut[eé]|steam|bring|remove|transfer|let|start|begin|meanwhile|then|next|first|finally)\b/i;

const CONTENT_CONTAINER = 'article, main, [role="main"], .entry-content, .post-content, .post-body, .post';

/** Page chrome after the recipe (site footer) never holds steps. */
function isPageChrome(el: Element | undefined): boolean {
  return !!el?.closest('footer, [role="contentinfo"], #footer, .site-footer');
}

function inlineLabel(line: string): { label: string; rest: string } | undefined {
  const m = INLINE_LABEL.exec(line);
  if (!m) return undefined;
  const label = (m[1] as string).trim();
  if (label.split(/\s+/).length > 6) return undefined;
  return { label, rest: m[2] as string };
}

/** A lone quantity line between ingredient groups ("1 additional large egg (to brush on pastry)"). */
function isLoneQuantityUnit(u: Unit | undefined): boolean {
  return !!u && u.kind === 'para' && u.lines.length === 1 && QTY_START.test(u.lines[0] as string) && (u.lines[0] as string).length <= 120;
}

/** "Alternate fillings: 9 tablespoons chocolate chips, …" — a labeled line of ingredient alternatives. */
function labeledIngredientLine(u: Unit | undefined): { label: string; rest: string } | undefined {
  if (!u || u.kind !== 'para' || u.lines.length !== 1) return undefined;
  const l = inlineLabel(u.lines[0] as string);
  if (!l || !QTY_START.test(l.rest) || l.rest.length > 300 || STEP_LABEL_VERB.test(l.label)) return undefined;
  return l;
}

interface Unit {
  kind: 'heading' | 'list' | 'para';
  level: number;
  text: string;
  lines: string[];
  ordered: boolean;
  el?: Element;
}

function toUnits(blocks: Block[]): Unit[] {
  const units: Unit[] = [];
  let lastList: Element | undefined;
  for (const b of blocks) {
    if (b.kind === 'item') {
      const last = units[units.length - 1];
      if (last && last.kind === 'list' && b.list === lastList) {
        last.lines.push(b.lines.join(' '));
        continue;
      }
      lastList = b.list;
      units.push({ kind: 'list', level: 0, text: b.text, lines: [b.lines.join(' ')], ordered: !!b.ordered, el: b.el });
      continue;
    }
    lastList = undefined;
    units.push({ kind: b.kind, level: b.level, text: b.text, lines: [...b.lines], ordered: false, el: b.el });
  }
  return units;
}

function isIngredientUnit(u: Unit, afterGroupHeading = false): boolean {
  if (u.kind === 'heading' || u.lines.length < (afterGroupHeading ? 1 : 2)) return false;
  if (u.lines.some((l) => l.length > 150)) return false;
  const qty = u.lines.filter((l) => QTY_START.test(l)).length;
  return qty / u.lines.length >= 0.6;
}

/** Infer a recipe from quantity-heavy line groups followed by method paragraphs. */
export function layoutStrategy(blocks: Block[], meta: PageMeta, maxCandidates: number): Draft[] {
  const units = toUnits(blocks);
  const drafts: Draft[] = [];
  let k = 0;
  while (k < units.length && drafts.length < maxCandidates) {
    if (!isIngredientUnit(units[k] as Unit)) {
      k++;
      continue;
    }
    const d = emptyDraft('dom');
    const groups: { title: string; lines: string[] }[] = [];
    const prev = units[k - 1];
    let firstTitle = prev?.kind === 'heading' ? prev.text.replace(/:\s*$/, '') : '';
    let titleIndex = prev?.kind === 'heading' ? k - 2 : k - 1;
    let pending = firstTitle;
    let j = k;
    while (j < units.length) {
      const u = units[j] as Unit;
      if (isIngredientUnit(u) || (pending && isIngredientUnit(u, true))) {
        const lines: string[] = [];
        for (const l of u.lines) {
          const y = yieldFromLine(l);
          if (y) {
            if (!d.yieldText) d.yieldText = y;
          } else if (!applyTimeLine(d, l)) lines.push(l);
        }
        groups.push({ title: pending, lines });
        pending = '';
        j++;
        continue;
      }
      const next = units[j + 1];
      if (u.kind === 'heading' && u.level >= 3 && next && isIngredientUnit(next, true)) {
        pending = u.text.replace(/:\s*$/, '');
        j++;
        continue;
      }
      // A lone quantity line followed by more ingredient groups belongs to the group before it.
      const after = units[j + 1];
      const moreFollow = !!after && (isIngredientUnit(after) || (after.kind === 'heading' && after.level >= 3 && isIngredientUnit(units[j + 2] as Unit, true)));
      if (groups.length && !pending && isLoneQuantityUnit(u) && moreFollow) {
        (groups[groups.length - 1] as { lines: string[] }).lines.push(u.lines[0] as string);
        j++;
        continue;
      }
      // "Alternate fillings: 9 tablespoons chocolate chips, …" right after the groups is its own group.
      const labeled = groups.length && !pending ? labeledIngredientLine(u) : undefined;
      if (labeled) {
        groups.push({ title: labeled.label, lines: [labeled.rest] });
        j++;
        continue;
      }
      break;
    }
    const total = groups.reduce((n, g) => n + g.lines.length, 0);
    if (total < 3) {
      k = j;
      continue;
    }
    // Recipe title: heading before the first group heading, else the group heading itself when alone.
    const before = units[titleIndex];
    if (before?.kind === 'heading') {
      d.title = before.text.replace(/:\s*$/, '');
    } else if (groups.length === 1 && firstTitle) {
      d.title = firstTitle;
      (groups[0] as { title: string }).title = '';
      firstTitle = '';
    } else {
      const searchFrom = titleIndex;
      for (titleIndex = searchFrom; titleIndex >= 0 && titleIndex >= searchFrom - 30; titleIndex--) {
        const u = units[titleIndex] as Unit;
        if (u.kind === 'heading' && u.level <= 6) {
          d.title = u.text;
          break;
        }
      }
    }
    if (!d.title) d.title = meta.title;
    d.ingredientGroups = groups.filter((g) => g.lines.length);

    // Method: following paragraphs / ordered lists until a major heading or another ingredient group.
    const steps: Block[] = [];
    let stepCount = 0;
    let inNotes = false;
    // Steps stay inside the content container that holds the ingredients (article/main/entry).
    const container = (units[k] as Unit).el?.closest(CONTENT_CONTAINER) ?? null;
    for (; j < units.length && stepCount < 60; j++) {
      const u = units[j] as Unit;
      if (isIngredientUnit(u)) break;
      if (isPageChrome(u.el) || (container && u.el && !container.contains(u.el))) break;
      if (u.kind === 'heading') {
        if (u.level <= 3) break;
        if (classifyHeading(u.text) === 'notes') {
          d.notes.push(...(units[j + 1]?.lines ?? []));
          j++;
          continue;
        }
        steps.push({ kind: 'heading', level: 7, text: u.text, lines: u.lines });
        continue;
      }
      if (u.kind === 'list' && !u.ordered && stepCount === 0) continue;
      for (const l of u.lines) {
        const label = inlineLabel(l);
        if (NOTE_START.test(l) || (label && NOTE_LABEL.test(label.label))) {
          d.notes.push(l);
          inNotes = true;
          continue;
        }
        // After the first note, run-in labeled paragraphs that are not cooking actions are notes too
        // ("Pop Tart Minis: …", "Savory version: …").
        if (inNotes && label && !STEP_LABEL_VERB.test(label.label)) {
          d.notes.push(l);
          continue;
        }
        const y = yieldFromLine(l);
        if (y) {
          if (!d.yieldText) d.yieldText = y;
          continue;
        }
        if (l.length < 15) continue;
        steps.push({ kind: u.kind === 'list' ? 'item' : 'para', level: 0, text: l, lines: [l] });
        stepCount++;
      }
    }
    d.instructionGroups = blocksToInstructions(steps);
    if (d.instructionGroups.length) {
      d.warnings.push('Recipe sections were inferred from the page layout; review ingredients and steps before saving.');
      drafts.push(d);
    }
    k = j;
  }
  return drafts;
}

/** DOM fallback over the whole page: heading sections first, then layout inference. */
export function extractDomFallback(doc: Document, ctx: ExtractionContext, meta: PageMeta): Draft[] {
  const root = doc.body ?? doc.documentElement;
  if (!root) return [];
  const blocks = linearize(root, ctx);
  let drafts = headingStrategy(blocks, meta, 'dom');
  if (!drafts.some((d) => d.ingredientGroups.length && d.instructionGroups.length)) {
    const inferred = layoutStrategy(blocks, meta, ctx.maxCandidates);
    if (inferred.length) drafts = inferred;
  }
  for (const d of drafts) {
    if (!d.author && meta.author) d.author = meta.author;
    if (!d.publisher && meta.publisher) d.publisher = meta.publisher;
  }
  return drafts;
}

// ---------- Recipe cards ----------

const CARD_SELECTOR = [
  '[class*="recipe-card" i]',
  '[class*="recipe-container" i]',
  '[class*="recipe-box" i]',
  '[class*="recipe-block" i]',
  '[class*="recipe-plugin" i]',
  '[class*="tasty-recipe" i]',
  '[class*="wprm-recipe-container" i]',
  '[class*="mv-create-card" i]',
  '[class*="easyrecipe" i]',
  '[id*="recipe-card" i]',
].join(',');

function cardMeta(card: Element, d: Draft): void {
  const titleEl = card.querySelector('[class*="recipe-name" i],[class*="recipe-title" i],[class*="card-title" i],[itemprop="name"]');
  if (titleEl && !isInExcludedRegion(titleEl, card)) d.title = elementText(titleEl);
  const yieldEl = Array.from(card.querySelectorAll('[class*="yield" i],[class*="servings" i]')).find((e) => /\d/.test(e.textContent ?? ''));
  if (yieldEl) {
    const t = elementText(yieldEl).replace(/^(yields?|servings|serves)\s*:?\s*(?=\d)/i, '');
    if (t) d.yieldText = t;
  }
  const timeSpecs: ['prep' | 'cook' | 'total', string, RegExp][] = [
    ['prep', 'Prep', /prep[-_]?time/i],
    ['cook', 'Cook', /cook[-_]?time/i],
    ['total', 'Total', /total[-_]?time/i],
  ];
  for (const [key, label, re] of timeSpecs) {
    const el = Array.from(card.querySelectorAll('[class]')).find((e) => re.test(e.getAttribute('class') ?? '') && /\d/.test(e.textContent ?? ''));
    if (!el) continue;
    const dt = el.querySelector('time[datetime], meta[content]');
    const isoAttr = dt ? normalizeIsoDuration(dt.getAttribute('datetime') ?? dt.getAttribute('content') ?? '') : undefined;
    const text = elementText(el).replace(new RegExp(`^${label}(aration)?\\s*(time)?\\s*:?\\s*`, 'i'), '');
    const iso = isoAttr ?? humanToIso(text);
    if (iso) d.times[key] = iso;
    if (text) d.times.raw.push(`${label}: ${text}`);
  }
}

function cardDraft(card: Element, ctx: ExtractionContext, meta: PageMeta): Draft {
  const d = emptyDraft('dom');
  const blocks = linearize(card, ctx, { zones: true, maxBlocks: 5000 });
  cardMeta(card, d);
  const ing = blocks.filter((b) => b.zone === 'ingredients');
  const ins = blocks.filter((b) => b.zone === 'instructions');
  d.ingredientGroups = blocksToIngredients(ing, d);
  d.instructionGroups = blocksToInstructions(ins);
  const notes = blocks.filter((b) => b.zone === 'notes' && !(b.kind === 'heading' && classifyHeading(b.text) === 'notes'));
  if (notes.length) d.notes.push(notes.map((b) => b.lines.join('\n')).join('\n\n'));
  if (!d.ingredientGroups.length || !d.instructionGroups.length) {
    const viaHeadings = headingStrategy(blocks, { title: d.title || meta.title }, 'dom')[0];
    if (viaHeadings) {
      if (!d.ingredientGroups.length) d.ingredientGroups = viaHeadings.ingredientGroups;
      if (!d.instructionGroups.length) d.instructionGroups = viaHeadings.instructionGroups;
      if (!d.notes.length) d.notes = viaHeadings.notes;
      if (!d.yieldText && viaHeadings.yieldText) d.yieldText = viaHeadings.yieldText;
      if (!d.title) d.title = viaHeadings.title;
    }
  }
  if (!d.title) {
    const h = blocks.find((b) => b.kind === 'heading' && b.level <= 6 && !b.zone && !classifyHeading(b.text));
    d.title = h?.text ?? meta.title;
  }
  if (meta.author) d.author = meta.author;
  if (meta.publisher) d.publisher = meta.publisher;
  return d;
}

export function extractCards(doc: Document, ctx: ExtractionContext, meta: PageMeta): Draft[] {
  const all = Array.from(doc.querySelectorAll(CARD_SELECTOR));
  const set = new Set(all);
  const outer = all.filter((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return false;
    return !isInExcludedRegion(el) && !isExcluded(el);
  });
  const drafts: Draft[] = [];
  for (const card of outer) {
    if (drafts.length >= ctx.maxCandidates) {
      ctx.warn(`More than ${ctx.maxCandidates} recipe cards were found; only the first ${ctx.maxCandidates} were read.`);
      break;
    }
    const d = cardDraft(card, ctx, meta);
    if (d.ingredientGroups.length || d.instructionGroups.length) drafts.push(d);
  }
  return drafts;
}
