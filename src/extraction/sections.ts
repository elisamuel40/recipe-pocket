/**
 * Turn linearized blocks into ingredient groups, instruction groups, notes,
 * yield and times. Shared by microdata, recipe-card and DOM fallback code.
 */
import type { Block } from './domtext';
import type { Draft } from './draft';
import { humanToIso } from './duration';

export const ING_HEADING = /^(the\s+)?(ingredients?|ingredient list|what you(?:'|’)?ll need|you(?:'|’)?ll need)\b[^.!?]{0,40}$/i;
export const INSTR_HEADING = /^(instructions?|directions?|method|steps|preparation|procedure|how to make(?: it| them| this)?)\b[^.!?]{0,40}$/i;
export const NOTES_HEADING = /^(recipe\s+|cook(?:'|’)?s\s+|chef(?:'|’)?s\s+)?(notes?|tips?|tips and tricks|variations?|storage|make ahead|do ahead)\b[^.!?]{0,30}$/i;

export type SectionKind = 'ingredients' | 'instructions' | 'notes';

export function classifyHeading(text: string): SectionKind | undefined {
  const t = text.replace(/[:\s]+$/, '').trim();
  if (t.length > 60) return undefined;
  if (ING_HEADING.test(t)) return 'ingredients';
  if (INSTR_HEADING.test(t)) return 'instructions';
  if (NOTES_HEADING.test(t)) return 'notes';
  return undefined;
}

/** Group title from a section heading: "Ingredients" alone gives "", "Ingredients for the sauce" keeps the text. */
export function sectionGroupTitle(text: string): string {
  const t = text.replace(/[:\s]+$/, '').trim();
  if (/^(the\s+)?(ingredients?|instructions?|directions?|method|steps|preparation|procedure)$/i.test(t)) return '';
  return t;
}

export const YIELD_LINE = /^(yields?|makes|serves|servings|portions)\b\s*:?\s*(.*\d.*)$/i;
const TIME_LINE = /^(prep(?:aration)?|cook(?:ing)?|bake|baking|total|active|inactive|rest(?:ing)?|chill(?:ing)?)\s*(?:time)?\s*:\s*(.*\d.*)$|^(prep(?:aration)?|cook(?:ing)?|total)\s+time\s*:?\s*(.*\d.*)$/i;

export function yieldFromLine(line: string): string | undefined {
  const m = YIELD_LINE.exec(line);
  if (!m || line.length > 80) return undefined;
  return line.replace(/^(yields?|servings|portions)\s*:\s*/i, '').trim();
}

/** Apply a "Prep time: 15 minutes" style line to draft times. Returns true when consumed. */
export function applyTimeLine(d: Draft, line: string): boolean {
  if (line.length > 80) return false;
  const m = TIME_LINE.exec(line);
  if (!m) return false;
  const label = (m[1] ?? m[3] ?? '').toLowerCase();
  const value = (m[2] ?? m[4] ?? '').trim();
  const iso = humanToIso(value);
  const key = label.startsWith('prep') ? 'prep' : label.startsWith('total') ? 'total' : label.startsWith('cook') || label.startsWith('bak') ? 'cook' : undefined;
  if (key && iso && !d.times[key]) d.times[key] = iso;
  const pretty = label.charAt(0).toUpperCase() + label.slice(1);
  d.times.raw.push(`${pretty}: ${value}`);
  return true;
}

/** Ingredient groups from blocks. Headings start new groups; yield/time lines are pulled out. */
export function blocksToIngredients(blocks: Block[], d: Draft, initialTitle = ''): { title: string; lines: string[] }[] {
  const groups: { title: string; lines: string[] }[] = [];
  let cur: { title: string; lines: string[] } | null = null;
  let pending = initialTitle;
  for (const b of blocks) {
    if (b.kind === 'heading') {
      const kind = classifyHeading(b.text);
      pending = kind === 'ingredients' ? sectionGroupTitle(b.text) : b.text.replace(/:\s*$/, '');
      cur = null;
      continue;
    }
    for (const line of b.lines) {
      const y = yieldFromLine(line);
      if (y) {
        if (!d.yieldText) d.yieldText = y;
        continue;
      }
      if (applyTimeLine(d, line)) continue;
      if (line.length > 250) {
        d.notes.push(line);
        continue;
      }
      if (!cur) {
        cur = { title: pending, lines: [] };
        groups.push(cur);
        pending = '';
      }
      cur.lines.push(line);
    }
  }
  return groups.filter((g) => g.lines.length > 0);
}

const STEP_LABEL = /^step\s*\d+\s*[:.]?$/i;

/** Instruction groups from blocks. Each list item or paragraph is one step. */
export function blocksToInstructions(blocks: Block[], initialTitle = ''): { title: string; steps: string[] }[] {
  const groups: { title: string; steps: string[] }[] = [];
  let cur: { title: string; steps: string[] } | null = null;
  let pending = initialTitle;
  const add = (text: string): void => {
    if (!cur) {
      cur = { title: pending, steps: [] };
      groups.push(cur);
      pending = '';
    }
    cur.steps.push(text);
  };
  for (const b of blocks) {
    if (b.kind === 'heading') {
      if (STEP_LABEL.test(b.text)) continue;
      const kind = classifyHeading(b.text);
      pending = kind === 'instructions' ? sectionGroupTitle(b.text) : b.text.replace(/:\s*$/, '');
      cur = null;
      continue;
    }
    const lines = b.lines.filter((l) => !STEP_LABEL.test(l));
    if (!lines.length) continue;
    if (b.kind === 'item') add(lines.join(' '));
    else for (const l of lines) add(l);
  }
  return groups.filter((g) => g.steps.length > 0);
}
