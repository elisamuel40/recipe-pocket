import { describe, expect, it } from 'vitest';
import { captionsToPlainText, isCaptionFormat } from '../../src/media/index';

describe('captionsToPlainText', () => {
  it('strips SRT indices and timestamps, keeping order', () => {
    const srt = [
      '1',
      '00:00:01,000 --> 00:00:03,500',
      'Today we are making pancakes',
      '',
      '2',
      '00:00:03,500 --> 00:00:06,000',
      '<i>2 cups flour</i>',
      'and 1 egg',
      '',
    ].join('\r\n');
    expect(captionsToPlainText(srt)).toBe('Today we are making pancakes\n2 cups flour\nand 1 egg');
  });

  it('strips WebVTT header, NOTE/STYLE blocks, cue ids, settings and tags', () => {
    const vtt = [
      'WEBVTT - synthetic fixture',
      'Kind: captions',
      '',
      'NOTE this is a comment',
      'spanning two lines',
      '',
      'STYLE',
      '::cue { color: red }',
      '',
      'intro',
      '00:00.000 --> 00:02.000 align:start position:10%',
      '<v Chef>Whisk the eggs</v>',
      '',
      '00:00:02.000 --> 00:00:04.000',
      '<c.yellow>add</c><00:00:02.500><c> sugar &amp; salt</c>',
    ].join('\n');
    expect(captionsToPlainText(vtt)).toBe('Whisk the eggs\nadd sugar & salt');
  });

  it('merges rolling-caption duplicates', () => {
    const vtt = [
      'WEBVTT',
      '',
      '00:00:00.000 --> 00:00:02.000',
      'first add the',
      '',
      '00:00:01.000 --> 00:00:03.000',
      'first add the flour',
      '',
      '00:00:02.000 --> 00:00:04.000',
      'first add the flour',
      'then stir',
      '',
      '00:00:03.000 --> 00:00:05.000',
      'then stir',
      'until smooth',
    ].join('\n');
    expect(captionsToPlainText(vtt)).toBe('first add the flour\nthen stir\nuntil smooth');
  });

  it('handles SRT cues without blank separators', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nOne\n2\n00:00:02,000 --> 00:00:03,000\nTwo';
    expect(captionsToPlainText(srt)).toBe('One\nTwo');
  });

  it('leaves plain text alone (no merging of repeated lines)', () => {
    const plain = 'Pancakes\n\n1 egg\n1 egg\n';
    expect(isCaptionFormat(plain)).toBe(false);
    expect(captionsToPlainText(plain)).toBe('Pancakes\n\n1 egg\n1 egg');
  });

  it('returns empty text for a header-only (silent) caption file', () => {
    expect(captionsToPlainText('WEBVTT\n\n')).toBe('');
    expect(captionsToPlainText('')).toBe('');
  });
});
