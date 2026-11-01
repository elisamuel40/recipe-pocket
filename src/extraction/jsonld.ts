/**
 * JSON-LD (schema.org Recipe) extraction. Each script block is parsed on its
 * own; a broken block only adds a warning. Walks arrays and @graph, accepts
 * @type arrays, resolves local @id references with a visited set and depth
 * limit. Script elements are read via textContent and never executed.
 */
import { emptyDraft, type Draft, type ExtractionContext } from './draft';
import { normalizeIsoDuration, isoToHuman } from './duration';
import { htmlToLines, htmlToText } from './text';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function typesOf(o: Obj): string[] {
  const t = o['@type'];
  const arr = Array.isArray(t) ? t : [t];
  return arr
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.replace(/^.*[/#:]/, '').toLowerCase());
}

const hasType = (o: Obj, type: string): boolean => typesOf(o).includes(type);

function parseBlock(text: string): Json | undefined {
  try {
    return JSON.parse(text) as Json;
  } catch {
    /* try a conservative cleanup below */
  }
  const cleaned = text
    .replace(/^\s*<!--/, '')
    .replace(/-->\s*$/, '')
    .replace(/^\s*\/\/\s*<!\[CDATA\[/, '')
    .replace(/\/\/\s*\]\]>\s*$/, '')
    // Raw control characters (e.g. literal newlines inside strings) are invalid JSON.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F]+/g, ' ')
    .replace(/;\s*$/, '')
    .replace(/,\s*([}\]])/g, '$1');
  try {
    return JSON.parse(cleaned) as Json;
  } catch {
    return undefined;
  }
}

class Graph {
  readonly index = new Map<string, Obj>();
  depthHit = false;
  constructor(readonly maxDepth: number) {}

  /** Index every node carrying an @id (first, richest definition wins). */
  indexAll(root: Json, depth = 0): void {
    if (depth > this.maxDepth) {
      this.depthHit = true;
      return;
    }
    if (Array.isArray(root)) {
      for (const v of root) this.indexAll(v, depth + 1);
      return;
    }
    if (!isObj(root)) return;
    const id = root['@id'];
    if (typeof id === 'string' && Object.keys(root).length > 1) {
      const prev = this.index.get(id);
      if (!prev || Object.keys(root).length > Object.keys(prev).length) this.index.set(id, root);
    }
    for (const [k, v] of Object.entries(root)) {
      if (k === '@context') continue;
      if (typeof v === 'object' && v !== null) this.indexAll(v, depth + 1);
    }
  }

  /** Resolve a bare {"@id": "..."} reference. Cycles end at the visited set. */
  resolve(v: Json | undefined, visited: Set<string>): Json | undefined {
    let cur = v;
    for (let hops = 0; hops < this.maxDepth && isObj(cur); hops++) {
      const id = cur['@id'];
      if (typeof id !== 'string' || Object.keys(cur).length !== 1) return cur;
      if (visited.has(id)) return undefined;
      visited.add(id);
      const target = this.index.get(id);
      if (!target) return undefined;
      cur = target;
    }
    return cur;
  }
}

function findRecipes(root: Json, graph: Graph, out: Obj[], seen: Set<Obj>, seenIds: Set<string>, depth: number): void {
  if (depth > graph.maxDepth) {
    graph.depthHit = true;
    return;
  }
  if (Array.isArray(root)) {
    for (const v of root) findRecipes(v, graph, out, seen, seenIds, depth + 1);
    return;
  }
  if (!isObj(root)) return;
  if (hasType(root, 'recipe')) {
    const id = root['@id'];
    const rich = typeof id === 'string' ? (graph.index.get(id) ?? root) : root;
    if (seen.has(rich) || (typeof id === 'string' && seenIds.has(id))) return;
    seen.add(rich);
    if (typeof id === 'string') seenIds.add(id);
    out.push(rich);
    return;
  }
  for (const [k, v] of Object.entries(root)) {
    if (k === '@context') continue;
    if (typeof v === 'object' && v !== null) findRecipes(v, graph, out, seen, seenIds, depth + 1);
  }
}

// ---------- Field normalization ----------

function firstText(v: Json | undefined, graph: Graph): string {
  const r = graph.resolve(v, new Set());
  if (Array.isArray(r)) {
    for (const x of r) {
      const t = firstText(x, graph);
      if (t) return t;
    }
    return '';
  }
  if (typeof r === 'string' || typeof r === 'number') return htmlToText(r);
  if (isObj(r)) return htmlToText(r['name'] ?? r['text'] ?? r['@value'] ?? '');
  return '';
}

function names(v: Json | undefined, graph: Graph, depth = 0): string[] {
  if (depth > 5) return [];
  const r = graph.resolve(v, new Set());
  if (Array.isArray(r)) return r.flatMap((x) => names(x, graph, depth + 1));
  if (typeof r === 'string') return [htmlToText(r)].filter(Boolean);
  if (isObj(r)) {
    const n = htmlToText(r['name'] ?? '');
    return n ? [n] : [];
  }
  return [];
}

function pickYield(v: Json | undefined): string | undefined {
  const vals = (Array.isArray(v) ? v : [v])
    .map((x) => (typeof x === 'string' || typeof x === 'number' ? htmlToText(x) : isObj(x) ? htmlToText(x['value'] ?? x['name'] ?? '') : ''))
    .filter(Boolean);
  if (!vals.length) return undefined;
  return vals.find((x) => /\p{L}/u.test(x)) ?? vals[0];
}

const ING_HEADING = /^[^\d¼½¾⅓⅔⅛⅜⅝⅞]{2,60}:$/u;

/** Split a flat ingredient list into groups using conservative "For the x:" style headings. */
export function groupIngredientLines(lines: string[]): { title: string; lines: string[] }[] {
  const groups: { title: string; lines: string[] }[] = [{ title: '', lines: [] }];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] as string;
    if (ING_HEADING.test(l) && i < lines.length - 1) {
      groups.push({ title: l.replace(/:$/, '').trim(), lines: [] });
    } else {
      (groups[groups.length - 1] as { lines: string[] }).lines.push(l);
    }
  }
  return groups.filter((g) => g.lines.length > 0);
}

function ingredientLines(v: Json | undefined, graph: Graph, depth = 0): string[] {
  if (depth > 10) return [];
  const r = graph.resolve(v, new Set());
  if (Array.isArray(r)) return r.flatMap((x) => ingredientLines(x, graph, depth + 1));
  if (typeof r === 'string' || typeof r === 'number') {
    // A single string may hold several lines.
    return htmlToLines(r);
  }
  if (isObj(r)) {
    if (r['itemListElement'] !== undefined) return ingredientLines(r['itemListElement'], graph, depth + 1);
    const t = htmlToText(r['text'] ?? r['name'] ?? r['value'] ?? '');
    return t ? [t] : [];
  }
  return [];
}

class StepCollector {
  groups: { title: string; steps: string[] }[] = [];
  private current: { title: string; steps: string[] } | null = null;

  open(title: string): void {
    this.current = { title, steps: [] };
    this.groups.push(this.current);
  }
  close(): void {
    this.current = null;
  }
  add(text: string): void {
    if (!text) return;
    if (!this.current) this.open('');
    (this.current as { steps: string[] }).steps.push(text);
  }
}

function sortedList(v: Json | undefined): Json[] {
  const arr = Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
  const allPos = arr.every((x) => isObj(x) && Number.isFinite(Number(x['position'])));
  if (!allPos || arr.length < 2) return arr;
  return [...arr].sort((a, b) => Number((a as Obj)['position']) - Number((b as Obj)['position']));
}

function collectSteps(v: Json | undefined, graph: Graph, c: StepCollector, visited: Set<string>, depth: number, sectionTitle: string): void {
  if (depth > graph.maxDepth) {
    graph.depthHit = true;
    return;
  }
  const r = graph.resolve(v, visited);
  if (r === undefined || r === null) return;
  if (typeof r === 'string' || typeof r === 'number') {
    for (const line of htmlToLines(r)) c.add(line);
    return;
  }
  if (Array.isArray(r)) {
    for (const x of sortedList(r)) collectSteps(x, graph, c, visited, depth + 1, sectionTitle);
    return;
  }
  if (!isObj(r)) return;
  // A reference back to a recipe is never a step.
  if (hasType(r, 'recipe')) return;
  if (hasType(r, 'howtosection')) {
    const name = htmlToText(r['name'] ?? '');
    const title = sectionTitle && name ? `${sectionTitle}: ${name}` : name || sectionTitle;
    c.open(title);
    collectSteps(sortedList(r['itemListElement'] ?? r['steps'] ?? r['step']), graph, c, visited, depth + 1, title);
    c.close();
    return;
  }
  if (hasType(r, 'listitem') && r['item'] !== undefined && r['text'] === undefined) {
    collectSteps(r['item'], graph, c, visited, depth + 1, sectionTitle);
    return;
  }
  const text = htmlToText(r['text'] ?? '');
  const name = htmlToText(r['name'] ?? '');
  if (text || name || r['description'] !== undefined) {
    if (text) c.add(text);
    else if (name) c.add(name);
    else c.add(htmlToText(r['description']));
    // HowToStep may itself contain sub-steps.
    if (r['itemListElement'] !== undefined) collectSteps(sortedList(r['itemListElement']), graph, c, visited, depth + 1, sectionTitle);
    return;
  }
  if (r['itemListElement'] !== undefined) {
    collectSteps(sortedList(r['itemListElement']), graph, c, visited, depth + 1, sectionTitle);
  }
}

function setTime(d: Draft, key: 'prep' | 'cook' | 'total', label: string, v: Json | undefined): void {
  const s = typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined;
  if (!s || !s.trim()) return;
  const iso = normalizeIsoDuration(s);
  if (iso) {
    d.times[key] = iso;
    d.times.raw.push(`${label}: ${isoToHuman(iso)}`);
  } else {
    const txt = htmlToText(s);
    if (txt) d.times.raw.push(`${label}: ${txt}`);
  }
}

function recipeToDraft(r: Obj, graph: Graph): Draft {
  const d = emptyDraft('json-ld');
  d.title = firstText(r['name'], graph) || firstText(r['headline'], graph);
  const authors = names(r['author'], graph);
  if (authors.length) d.author = [...new Set(authors)].join(', ');
  const pubs = names(r['publisher'], graph);
  if (pubs.length) d.publisher = pubs[0];
  d.yieldText = pickYield(r['recipeYield'] ?? r['yield']);
  setTime(d, 'prep', 'Prep', r['prepTime']);
  setTime(d, 'cook', 'Cook', r['cookTime']);
  setTime(d, 'total', 'Total', r['totalTime']);
  d.ingredientGroups = groupIngredientLines(ingredientLines(r['recipeIngredient'] ?? r['ingredients'], graph));
  const c = new StepCollector();
  const selfId = typeof r['@id'] === 'string' ? [r['@id']] : [];
  collectSteps(r['recipeInstructions'], graph, c, new Set(selfId), 0, '');
  d.instructionGroups = c.groups.filter((g) => g.steps.length > 0);
  return d;
}

/** Extract Recipe drafts from all JSON-LD blocks in the document. */
export function extractJsonLd(doc: Document, ctx: ExtractionContext): Draft[] {
  const scripts = Array.from(doc.querySelectorAll('script[type]')).filter(
    (s) => (s.getAttribute('type') ?? '').split(';')[0]?.trim().toLowerCase() === 'application/ld+json',
  );
  const graph = new Graph(ctx.maxDepth);
  const roots: Json[] = [];
  scripts.forEach((s, i) => {
    const text = s.textContent ?? '';
    if (!text.trim()) return;
    if (ctx.used + text.length > ctx.maxChars) {
      ctx.limitHit = true;
      ctx.warn(`Structured data block ${i + 1} was not read because it would exceed the 2 MB input limit.`);
      return;
    }
    ctx.used += text.length;
    const parsed = parseBlock(text);
    if (parsed === undefined) {
      ctx.warn(`Structured data block ${i + 1} is not valid JSON and was skipped.`);
      return;
    }
    roots.push(parsed);
  });
  for (const r of roots) graph.indexAll(r);

  const recipes: Obj[] = [];
  const seen = new Set<Obj>();
  const seenIds = new Set<string>();
  for (const r of roots) findRecipes(r, graph, recipes, seen, seenIds, 0);

  if (recipes.length > ctx.maxCandidates) {
    ctx.warn(`The page lists ${recipes.length} structured recipes; only the first ${ctx.maxCandidates} were read.`);
  }
  const drafts = recipes.slice(0, ctx.maxCandidates).map((r) => recipeToDraft(r, graph));
  if (graph.depthHit) {
    ctx.warn(`Some structured data is nested deeper than ${ctx.maxDepth} levels and was not read.`);
  }
  return drafts;
}
