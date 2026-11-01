// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { decodeEntities, htmlToLines, htmlToText, similarTitles } from '../../src/extraction/text';
import { humanToIso, isoToHuman, normalizeIsoDuration } from '../../src/extraction/duration';

describe('text helpers', () => {
  it('decodes named, decimal and hex references; leaves unknown ones', () => {
    expect(decodeEntities('&frac12; &#189; &#xBD; &bogus; &amp;')).toBe('½ ½ ½ &bogus; &');
    expect(decodeEntities('&#0; &#xD800; &#1114112;')).toBe('� � �');
  });

  it('strips tags, comments and raw-text elements', () => {
    expect(htmlToText('<b>Mix</b> <!-- x --><style>p{}</style>well<script>alert(1)</script>.')).toBe('Mix well.');
    expect(htmlToLines('<p>One</p><p>Two<br>Three</p>')).toEqual(['One', 'Two', 'Three']);
    expect(htmlToText('use a pan < 9 inches & > 8')).toBe('use a pan < 9 inches & > 8');
  });

  it('handles double-encoded markup', () => {
    expect(htmlToText('&lt;strong&gt;Hot&lt;/strong&gt; &amp;amp; fresh')).toBe('Hot & fresh');
  });

  it('compares titles loosely', () => {
    expect(similarTitles('The Best Cookies!', 'the best cookies')).toBe(true);
    expect(similarTitles('Alpha Soup', 'Beta Salad')).toBe(false);
  });
});

describe('durations', () => {
  it('validates and humanizes ISO durations', () => {
    expect(normalizeIsoDuration('pt1h30m')).toBe('PT1H30M');
    expect(normalizeIsoDuration('P')).toBeUndefined();
    expect(normalizeIsoDuration('30 minutes')).toBeUndefined();
    expect(isoToHuman('PT1H30M')).toBe('1 hr 30 min');
  });

  it('parses only unambiguous human durations', () => {
    expect(humanToIso('1 hour 15 minutes')).toBe('PT1H15M');
    expect(humanToIso('45 mins')).toBe('PT45M');
    expect(humanToIso('20 to 25 minutes')).toBeUndefined();
    expect(humanToIso('1 ½ hours')).toBeUndefined();
    expect(humanToIso('overnight')).toBeUndefined();
  });
});
