import { describe, expect, it } from 'vitest';
import { normalizeSourceUrl } from '../../src/domain';

describe('normalizeSourceUrl', () => {
  it('keeps plain http(s) URLs', () => {
    expect(normalizeSourceUrl('https://example.com/recipes/soup')).toBe('https://example.com/recipes/soup');
    expect(normalizeSourceUrl('http://example.com/')).toBe('http://example.com/');
  });

  it('strips credentials and fragments', () => {
    expect(normalizeSourceUrl('https://user:pass@example.com/a#step-3')).toBe('https://example.com/a');
  });

  it('removes tracking keys and keeps meaningful params', () => {
    expect(
      normalizeSourceUrl(
        'https://example.com/r?id=42&utm_source=x&UTM_Medium=y&fbclid=1&gclid=2&dclid=3&msclkid=4&mc_cid=5&mc_eid=6&igshid=7&_ga=8&ref_src=9&yclid=10&page=2',
      ),
    ).toBe('https://example.com/r?id=42&page=2');
    expect(normalizeSourceUrl('https://example.com/r?recipe=pasta%20bake&utm_campaign=z')).toBe(
      'https://example.com/r?recipe=pasta%20bake',
    );
    expect(normalizeSourceUrl('https://example.com/r?utm_source=a&fbclid=b')).toBe('https://example.com/r');
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>1</script>',
    'file:///etc/passwd',
    'chrome://settings',
    'chrome-extension://abc/page.html',
    'ftp://example.com/a',
    'not a url',
    '',
    '/relative/path',
  ])('rejects %j', (url) => {
    expect(normalizeSourceUrl(url)).toBeNull();
  });

  it('trims whitespace', () => {
    expect(normalizeSourceUrl('  https://example.com/a  ')).toBe('https://example.com/a');
  });
});
