import { describe, expect, it } from 'vitest';
import {
  draftFromTranscript,
  isLocalSpeechRecognitionAvailable,
  REVIEW_WARNING,
  UNTITLED_TRANSCRIPT,
} from '../../src/media/index';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const allIngredients = (d: ReturnType<typeof draftFromTranscript>) => d.recipe.ingredientGroups.flatMap((g) => g.items);
const allSteps = (d: ReturnType<typeof draftFromTranscript>) => d.recipe.instructionGroups.flatMap((g) => g.steps);

const written = [
  'Lemon Garlic Pasta',
  '',
  'Ingredients',
  '- 200 g spaghetti',
  '- 2 cloves garlic, minced',
  '- salt to taste',
  '- zest of 1 lemon',
  'For the topping:',
  '- parmesan',
  '',
  'Instructions',
  '1. Boil the spaghetti in salted water.',
  '2. Fry the garlic gently in olive oil.',
  '3. Toss everything together and serve.',
].join('\n');

describe('draftFromTranscript', () => {
  it('builds a schema-valid transcript draft', () => {
    const d = draftFromTranscript(written, { sourceUrl: 'https://video.example/watch?v=abc&utm_source=x#t=10' });
    const r = d.recipe;
    expect(r.schemaVersion).toBe(1);
    expect(r.revision).toBe(0);
    expect(r.id).toMatch(UUID);
    expect(r.extraction.method).toBe('transcript');
    expect(r.title).toBe('Lemon Garlic Pasta');
    expect(r.source.url.startsWith('https://video.example/watch?v=abc')).toBe(true);
    expect(r.source.url).not.toContain('utm_source');
    expect(r.source.url).not.toContain('#');
    expect(r.extraction.missingFields).toEqual(['yield', 'times', 'author']);
    expect(d.warnings[0]).toBe(REVIEW_WARNING);
    expect(r.extraction.warnings).toEqual(d.warnings);
    const ids = [r.id, ...r.ingredientGroups.map((g) => g.id), ...allIngredients(d).map((i) => i.id), ...allSteps(d).map((s) => s.id)];
    for (const id of ids) expect(id).toMatch(UUID);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('classifies ingredients, groups and steps in order', () => {
    const d = draftFromTranscript(written, {});
    expect(allIngredients(d).map((i) => i.raw)).toEqual([
      '200 g spaghetti',
      '2 cloves garlic, minced',
      'salt to taste',
      'zest of 1 lemon',
      'parmesan',
    ]);
    expect(d.recipe.ingredientGroups.map((g) => g.title)).toEqual(['', 'For the topping']);
    expect(allSteps(d).map((s) => s.text)).toEqual([
      'Boil the spaghetti in salted water.',
      'Fry the garlic gently in olive oil.',
      'Toss everything together and serve.',
    ]);
    expect(d.unclassified).toEqual([]);
  });

  it('never invents values: every ingredient and step comes verbatim from the input', () => {
    const spoken = [
      'WEBVTT',
      '',
      '00:00.000 --> 00:02.000',
      "hey everyone welcome back to my kitchen",
      '',
      '00:02.000 --> 00:04.000',
      '2 cups of flour',
      '',
      '00:04.000 --> 00:06.000',
      "now we're going to whisk in some milk",
      '',
      '00:06.000 --> 00:08.000',
      'a little bit of butter',
      '',
      '00:08.000 --> 00:10.000',
      "don't forget to subscribe",
      '',
      '00:10.000 --> 00:12.000',
      'bake for 20 minutes',
    ].join('\n');
    const d = draftFromTranscript(spoken, {});
    const source = spoken.toLowerCase();
    for (const i of allIngredients(d)) expect(source).toContain(i.raw.toLowerCase());
    for (const s of allSteps(d)) expect(source).toContain(s.text.toLowerCase());
    expect(allIngredients(d).map((i) => i.raw)).toEqual(['2 cups of flour']);
    expect(allSteps(d).map((s) => s.text)).toEqual(["now we're going to whisk in some milk", 'bake for 20 minutes']);
    expect(d.unclassified).toEqual(['hey everyone welcome back to my kitchen', 'a little bit of butter', "don't forget to subscribe"]);
    // Spoken captions never yield a guessed title.
    expect(d.recipe.title).toBe(UNTITLED_TRANSCRIPT);
    expect(d.recipe.extraction.missingFields).toContain('title');
    expect(d.warnings.some((w) => /mishear/i.test(w))).toBe(true);
  });

  it('keeps missing quantities missing', () => {
    const d = draftFromTranscript('Ingredients:\nsalt to taste\nfresh basil\na pinch of pepper', {});
    const items = allIngredients(d);
    expect(items.map((i) => i.raw)).toEqual(['salt to taste', 'fresh basil', 'a pinch of pepper']);
    for (const item of items) {
      expect(item.quantity).toBeUndefined();
      expect(item.raw).not.toMatch(/\d/);
    }
  });

  it('returns an empty draft with warnings for empty or silent transcripts', () => {
    for (const input of ['', '   \n\n', 'WEBVTT\n\n00:00.000 --> 00:05.000\n\n']) {
      const d = draftFromTranscript(input, {});
      expect(d.recipe.ingredientGroups).toEqual([]);
      expect(d.recipe.instructionGroups).toEqual([]);
      expect(d.unclassified).toEqual([]);
      expect(d.recipe.title).toBe(UNTITLED_TRANSCRIPT);
      expect(d.recipe.extraction.missingFields).toEqual(['title', 'ingredients', 'instructions', 'yield', 'times', 'author']);
      expect(d.warnings.some((w) => /No transcript text/.test(w))).toBe(true);
    }
  });

  it('puts unrecognized prose in unclassified and does not guess a title without structure', () => {
    const d = draftFromTranscript('My grandmother loved this dish\nIt reminds me of summer.', {});
    expect(d.recipe.title).toBe(UNTITLED_TRANSCRIPT);
    expect(d.unclassified).toEqual(['My grandmother loved this dish', 'It reminds me of summer.']);
    expect(d.warnings.some((w) => /2 lines were not sorted/.test(w))).toBe(true);
  });

  it('uses the provided title and drops non-http source links with a warning', () => {
    const d = draftFromTranscript('Stir the soup', { title: '  Quick   Soup ', sourceUrl: 'javascript:alert(1)' });
    expect(d.recipe.title).toBe('Quick Soup');
    expect(d.recipe.source.url).toBe('');
    expect(d.warnings.some((w) => /not a valid http/.test(w))).toBe(true);
  });

  it('does not treat quantity + time as an ingredient', () => {
    const d = draftFromTranscript('20 minutes in the oven', {});
    expect(allIngredients(d)).toEqual([]);
    expect(d.unclassified).toEqual(['20 minutes in the oven']);
  });

  it('reports speech recognition as unavailable', () => {
    expect(isLocalSpeechRecognitionAvailable()).toBe(false);
  });
});
