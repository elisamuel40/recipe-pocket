/**
 * Transcript -> draft recipe (PRD R11). Owner: media.
 * Conservative, line-based classification. Never invents quantities,
 * ingredients or steps: every ingredient raw and every step text is a line
 * (minus list markers) taken from the user's transcript.
 */
import { normalizeSourceUrl, toIngredientItem } from '../domain/index';
import type {
  IngredientGroup,
  IngredientItem,
  InstructionGroup,
  RecipeField,
  RecipeV1,
} from '../shared/types';
import { SCHEMA_VERSION } from '../shared/types';
import { captionsToPlainText, isCaptionFormat, normalizeNewlines } from './captions';

export interface TranscriptDraft {
  /** Draft recipe; extraction.method = 'transcript'. Must be reviewed before Save. */
  recipe: RecipeV1;
  /** Lines the parser could not classify, shown to the user for manual placement. */
  unclassified: string[];
  warnings: string[];
}

export const UNTITLED_TRANSCRIPT = 'Untitled transcript recipe';
/** Hard input limit (characters) for transcript text; larger input is truncated with a warning. */
export const MAX_TRANSCRIPT_CHARS = 2_000_000;
/** Hard limit on processed lines; reported, never silent. */
export const MAX_TRANSCRIPT_LINES = 5_000;
const MAX_TITLE_CHARS = 200;

export const REVIEW_WARNING =
  'Transcript-derived draft: check every quantity, ingredient and step against the video before saving.';

const newId = (): string => globalThis.crypto.randomUUID();

// ---- Line patterns ----
const UNICODE_FRACTIONS = '½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞';
const NUM = `(?:\\d+(?:[.,]\\d+)?(?:\\s+\\d+/\\d+)?|\\d+/\\d+|\\d*\\s*[${UNICODE_FRACTIONS}])`;
const QTY = `${NUM}(?:\\s*(?:-|–|to)\\s*${NUM})?`;
const UNITS = [
  'cups?', 'c\\.', 'tablespoons?', 'tbsps?\\.?', 'tbs\\.?', 'tbl\\.?', 'teaspoons?', 'tsps?\\.?',
  'grams?', 'g', 'kilograms?', 'kg', 'milligrams?', 'mg', 'millilit(?:er|re)s?', 'ml', 'lit(?:er|re)s?', 'l',
  'ounces?', 'oz\\.?', 'fl\\.?\\s*oz\\.?', 'pounds?', 'lbs?\\.?', 'pints?', 'quarts?', 'gallons?',
  'pinch(?:es)?', 'dash(?:es)?', 'cloves?', 'cans?', 'sticks?', 'packages?', 'packets?', 'slices?',
  'handfuls?', 'bunch(?:es)?', 'sprigs?', 'heads?', 'pieces?', 'jars?', 'bottles?', 'drops?', 'knobs?',
];
const QTY_UNIT_LINE = new RegExp(`^(?:about\\s+|approx\\.?\\s+)?${QTY}\\s*(?:${UNITS.join('|')})(?=[\\s.,)(]|$)\\s*(?:of\\s+)?\\S`, 'i');
const QTY_LEADING = new RegExp(`^(?:about\\s+)?${QTY}\\s*\\S`, 'i');
/** Quantity followed by time/temperature words: a step detail, not an ingredient. */
const QTY_TIME = new RegExp(`^${QTY}\\s*(?:-\\s*)?(?:minutes?|mins?|hours?|hrs?|seconds?|secs?|degrees?|°)`, 'i');

const INGREDIENT_CUE = /^(?:the\s+)?(?:ingredients?|what\s+you(?:'ll|\s+will)?\s+need|you(?:'ll|\s+will)\s+need|shopping\s+list)\b\s*(?::|-|–)?\s*(.*)$/i;
const INSTRUCTION_CUE = /^(?:the\s+)?(?:instructions?|directions?|method|steps?|preparation|how\s+to\s+make\s+(?:it|this))\b\s*(?::|-|–)?\s*(.*)$/i;

const VERBS = [
  'add', 'arrange', 'bake', 'beat', 'blend', 'boil', 'bring', 'broil', 'brush', 'chill', 'chop', 'coat', 'combine',
  'cook', 'cool', 'cover', 'crack', 'cream', 'crush', 'cut', 'dice', 'dip', 'divide', 'drain', 'drizzle', 'dust',
  'flip', 'fold', 'form', 'fry', 'garnish', 'grate', 'grease', 'grill', 'heat', 'julienne', 'knead', 'ladle',
  'layer', 'let', 'line', 'marinate', 'mash', 'measure', 'melt', 'microwave', 'mince', 'mix', 'peel', 'place',
  'pour', 'preheat', 'prepare', 'press', 'puree', 'purée', 'put', 'reduce', 'refrigerate', 'remove', 'rest',
  'rinse', 'roast', 'roll', 'rub', 'saute', 'sauté', 'scoop', 'scramble', 'sear', 'season', 'serve', 'set',
  'shape', 'shred', 'sift', 'simmer', 'slice', 'soak', 'spoon', 'spread', 'sprinkle', 'squeeze', 'steam',
  'stir', 'strain', 'stuff', 'swirl', 'taste', 'toast', 'top', 'toss', 'transfer', 'turn', 'whip', 'whisk',
];
const STEP_PREFIX = '(?:(?:so|okay|ok|and|then|now|next|first|second|third|finally|lastly|after\\s+that|once\\s+(?:that\'s|it\'s)\\s+done)[,\\s]+)*';
const STEP_SUBJECT = "(?:(?:you|we|i)(?:'re|'ll|\\s+are|\\s+will|\\s+can|\\s+should|\\s+want|\\s+need|\\s+have|\\s+just)?(?:\\s+(?:going|gonna|want|need|have))?(?:\\s+to)?\\s+)?(?:just\\s+|gently\\s+|slowly\\s+|carefully\\s+)?";
const IMPERATIVE = new RegExp(`^${STEP_PREFIX}${STEP_SUBJECT}(?:${VERBS.join('|')})\\b`, 'i');
const COOKING_VERB_ANYWHERE = new RegExp(`\\b(?:${VERBS.join('|')})(?:s|es|ed|ing)?\\b`, 'i');
const FILLER = /\b(?:subscribe|like\s+and\s+(?:comment|share|follow)|link\s+in\s+(?:my\s+)?bio|follow\s+(?:me|for)|smash\s+that|notification|sponsor(?:ed)?|patreon|discount\s+code|music)\b|^\[[^\]]*\]$|^\([^)]*\)$/i;

const BULLET = /^\s*(?:[-*•·–—▪●◦]|•)\s+/;
const NUMBERED = /^\s*(?:step\s*)?\d{1,3}\s*[.):]\s+|^\s*step\s+\d{1,3}\s*[-–:]?\s*/i;

type Mode = 'none' | 'ingredients' | 'instructions';

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function isHeading(s: string): boolean {
  return /:$/.test(s) && s.length <= 40 && wordCount(s) <= 5 && !QTY_LEADING.test(s);
}

function isTitleLike(s: string): boolean {
  return (
    s.length >= 3 &&
    s.length <= 60 &&
    wordCount(s) <= 8 &&
    !/[.!?,:;]$/.test(s) &&
    !QTY_LEADING.test(s) &&
    !IMPERATIVE.test(s) &&
    !INGREDIENT_CUE.test(s) &&
    !INSTRUCTION_CUE.test(s) &&
    !FILLER.test(s) &&
    !BULLET.test(s) &&
    !NUMBERED.test(s) &&
    /\p{L}/u.test(s)
  );
}

function fallbackNormalizeUrl(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.username = '';
    u.password = '';
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (/^(?:utm_.*|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|si|_hsenc|_hsmi)$/i.test(key)) u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return null;
  }
}

function safeNormalizeUrl(url: string): string | null {
  try {
    return normalizeSourceUrl(url);
  } catch {
    // Domain implementation unavailable: conservative local fallback.
    return fallbackNormalizeUrl(url);
  }
}

function makeIngredient(raw: string): IngredientItem {
  const id = newId();
  try {
    const item = toIngredientItem(raw, id);
    // raw is the immutable original; never let a parser rewrite it.
    const out: IngredientItem = { ...item, id, raw };
    // Transcript guard: no numeral in the line means no quantity ("a pinch" stays unquantified).
    if (out.quantity && !new RegExp(`[\\d${UNICODE_FRACTIONS}]`).test(raw)) {
      delete out.quantity;
      out.confidence = 'low';
    }
    return out;
  } catch {
    return { id, raw, confidence: 'low' };
  }
}

/**
 * Turn user-supplied transcript/caption text (plain text, SRT or WebVTT) into
 * a draft recipe. Never invents quantities or steps; unknown lines go to
 * `unclassified`.
 */
export function draftFromTranscript(text: string, opts: { title?: string; sourceUrl?: string }): TranscriptDraft {
  const warnings: string[] = [REVIEW_WARNING];
  let input = typeof text === 'string' ? text : '';
  if (input.length > MAX_TRANSCRIPT_CHARS) {
    input = input.slice(0, MAX_TRANSCRIPT_CHARS);
    warnings.push(`Transcript was longer than ${MAX_TRANSCRIPT_CHARS.toLocaleString('en-US')} characters; only the beginning was read.`);
  }
  const fromCaptions = isCaptionFormat(input);
  const plain = captionsToPlainText(input);

  // Keep blank-line structure for title detection on plain text.
  const rawLines = normalizeNewlines(plain).split('\n').map((l) => l.trim());
  let lines = rawLines.filter((l) => l !== '');
  if (lines.length > MAX_TRANSCRIPT_LINES) {
    warnings.push(`Transcript had more than ${MAX_TRANSCRIPT_LINES.toLocaleString('en-US')} lines; only the first ${MAX_TRANSCRIPT_LINES.toLocaleString('en-US')} were read.`);
    lines = lines.slice(0, MAX_TRANSCRIPT_LINES);
  }

  // ---- Title ----
  let title = (opts.title ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_CHARS);
  let startIndex = 0;
  if (!title && !fromCaptions && lines.length > 1) {
    const first = lines[0] ?? '';
    const firstRawIdx = rawLines.indexOf(first);
    const followedByBlank = rawLines[firstRawIdx + 1] === '';
    const second = lines[1] ?? '';
    const followedByCue = INGREDIENT_CUE.test(second) || INSTRUCTION_CUE.test(second);
    if (isTitleLike(first) && (followedByBlank || followedByCue)) {
      title = first;
      startIndex = 1;
    }
  }

  // ---- Classification ----
  const ingredientGroups: IngredientGroup[] = [];
  const instructionGroups: InstructionGroup[] = [];
  const unclassified: string[] = [];
  let mode: Mode = 'none';

  const currentIngredientGroup = (): IngredientGroup => {
    let g = ingredientGroups[ingredientGroups.length - 1];
    if (!g) {
      g = { id: newId(), title: '', items: [] };
      ingredientGroups.push(g);
    }
    return g;
  };
  const currentInstructionGroup = (): InstructionGroup => {
    let g = instructionGroups[instructionGroups.length - 1];
    if (!g) {
      g = { id: newId(), title: '', steps: [] };
      instructionGroups.push(g);
    }
    return g;
  };
  const addIngredient = (raw: string): void => {
    currentIngredientGroup().items.push(makeIngredient(raw));
  };
  const addStep = (s: string): void => {
    currentInstructionGroup().steps.push({ id: newId(), text: s });
  };

  const classify = (original: string): void => {
    const hasMarker = BULLET.test(original) || NUMBERED.test(original);
    const line = original.replace(BULLET, '').replace(NUMBERED, '').trim();
    if (line === '') return;

    const ingCue = INGREDIENT_CUE.exec(line);
    if (ingCue && (ingCue[1] === '' || /^(?:ingredients?|what|you|shopping|the)/i.test(line)) && wordCount(line) <= 4 + wordCount(ingCue[1] ?? '')) {
      // "Ingredients" / "Ingredients: 2 cups flour"
      if (ingCue[1] === '' || /[:\-–]/.test(line.slice(0, line.length - (ingCue[1] ?? '').length))) {
        mode = 'ingredients';
        if (ingCue[1]) classify(ingCue[1]);
        return;
      }
    }
    const insCue = INSTRUCTION_CUE.exec(line);
    if (insCue && (insCue[1] === '' || /[:\-–]/.test(line.slice(0, line.length - (insCue[1] ?? '').length)))) {
      mode = 'instructions';
      if (insCue[1]) classify(insCue[1]);
      return;
    }

    if (FILLER.test(line)) {
      unclassified.push(line);
      return;
    }

    if (mode !== 'none' && isHeading(line)) {
      const headingTitle = line.replace(/:$/, '').trim();
      if (mode === 'ingredients') {
        const last = ingredientGroups[ingredientGroups.length - 1];
        if (last && last.items.length === 0) last.title = headingTitle;
        else ingredientGroups.push({ id: newId(), title: headingTitle, items: [] });
      } else {
        const last = instructionGroups[instructionGroups.length - 1];
        if (last && last.steps.length === 0) last.title = headingTitle;
        else instructionGroups.push({ id: newId(), title: headingTitle, steps: [] });
      }
      return;
    }

    const imperative = IMPERATIVE.test(line);
    const qtyUnit = QTY_UNIT_LINE.test(line) && !QTY_TIME.test(line);

    if (mode === 'instructions') {
      if (qtyUnit && !imperative && line.length <= 80 && !hasMarker) {
        addIngredient(line);
      } else if (imperative || hasMarker || (!fromCaptions && wordCount(line) >= 2) || (fromCaptions && COOKING_VERB_ANYWHERE.test(line))) {
        addStep(line);
      } else {
        unclassified.push(line);
      }
      return;
    }

    if (qtyUnit && line.length <= (mode === 'ingredients' ? 160 : 80)) {
      addIngredient(line);
      return;
    }

    if (mode === 'ingredients') {
      const sentenceCount = (line.match(/[.!?](\s|$)/g) ?? []).length;
      if (!imperative && line.length <= 100 && sentenceCount <= 1 && !/[?]$/.test(line)) {
        addIngredient(line);
        return;
      }
    }

    if (imperative) {
      addStep(line);
      return;
    }

    unclassified.push(line);
  };

  for (let i = startIndex; i < lines.length; i++) classify(lines[i] ?? '');

  const ingredientsOut = ingredientGroups.filter((g) => g.items.length > 0);
  const instructionsOut = instructionGroups.filter((g) => g.steps.length > 0);

  // ---- Source URL ----
  let url = '';
  const rawUrl = (opts.sourceUrl ?? '').trim();
  if (rawUrl) {
    const normalized = safeNormalizeUrl(rawUrl);
    if (normalized) url = normalized;
    else warnings.push('The video link is not a valid http(s) address, so it was not kept.');
  }

  // ---- Missing fields and warnings ----
  const missingFields: RecipeField[] = [];
  if (!title) missingFields.push('title');
  if (ingredientsOut.length === 0) missingFields.push('ingredients');
  if (instructionsOut.length === 0) missingFields.push('instructions');
  missingFields.push('yield', 'times', 'author');

  if (lines.length === 0) {
    warnings.push('No transcript text was found. Paste captions or a transcript, or add the recipe by hand.');
  } else {
    if (ingredientsOut.length === 0) warnings.push('No ingredient lines were recognized. Add ingredients by hand.');
    if (instructionsOut.length === 0) warnings.push('No steps were recognized. Add steps by hand.');
  }
  if (unclassified.length > 0) {
    warnings.push(
      `${unclassified.length} ${unclassified.length === 1 ? 'line was' : 'lines were'} not sorted into ingredients or steps. Review them and add anything that belongs to the recipe.`,
    );
  }
  if (fromCaptions) warnings.push('Captions can mishear numbers and units (for example "fifteen" and "fifty"). Compare quantities with the video.');

  const recipe: RecipeV1 = {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    title: title || UNTITLED_TRANSCRIPT,
    source: { url },
    originalYield: { text: '' },
    times: { raw: '' },
    ingredientGroups: ingredientsOut,
    instructionGroups: instructionsOut,
    notes: '',
    tags: [],
    collectionIds: [],
    extraction: { method: 'transcript', missingFields, warnings: [...warnings] },
    revision: 0,
  };

  return { recipe, unclassified, warnings };
}
