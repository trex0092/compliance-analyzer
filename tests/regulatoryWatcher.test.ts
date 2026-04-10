/**
 * Regulatory Watcher — hash stability tests.
 *
 * The watcher hashes fetched HTML with whitespace + script/style stripped
 * so that trivial reformatting of regulator pages doesn't produce
 * spurious "change detected" signals. These tests lock that behaviour in.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — tsx TS file, no type declarations in vitest context
import { hashContent, SOURCES } from '../scripts/regulatory-watcher.ts';

describe('regulatory-watcher: hashContent', () => {
  it('same content → same hash', () => {
    const a = '<html><body>Hello regulator</body></html>';
    expect(hashContent(a)).toBe(hashContent(a));
  });

  it('whitespace differences → same hash', () => {
    const a = '<html><body>Hello regulator</body></html>';
    const b = '<html>\n  <body>\n    Hello   regulator\n  </body>\n</html>';
    expect(hashContent(a)).toBe(hashContent(b));
  });

  it('script blocks stripped before hashing (timestamp immunity)', () => {
    const a = '<html><body>Policy text</body><script>var t=1;</script></html>';
    const b = '<html><body>Policy text</body><script>var t=999;</script></html>';
    expect(hashContent(a)).toBe(hashContent(b));
  });

  it('style blocks stripped before hashing', () => {
    const a = '<html><style>body{color:red}</style><body>Text</body></html>';
    const b = '<html><style>body{color:blue}</style><body>Text</body></html>';
    expect(hashContent(a)).toBe(hashContent(b));
  });

  it('different content → different hash', () => {
    const a = '<html><body>Old rule</body></html>';
    const b = '<html><body>New rule with different wording</body></html>';
    expect(hashContent(a)).not.toBe(hashContent(b));
  });

  it('extract regex only hashes the matched region', () => {
    const a = 'NOISE <body>core policy text</body> MORE NOISE';
    const b = 'DIFFERENT NOISE <body>core policy text</body> OTHER NOISE';
    const re = /<body>[^<]*<\/body>/;
    expect(hashContent(a, re)).toBe(hashContent(b, re));
  });

  it('hash is a 64-character sha256 hex string', () => {
    const h = hashContent('anything');
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('regulatory-watcher: SOURCES catalogue', () => {
  it('has at least five sources', () => {
    expect(SOURCES.length).toBeGreaterThanOrEqual(5);
  });

  it('every source has a unique id', () => {
    const ids = new Set<string>(SOURCES.map((s: { id: string }) => s.id));
    expect(ids.size).toBe(SOURCES.length);
  });

  it('every source has an https url and regulatory citation', () => {
    for (const s of SOURCES as Array<{
      id: string;
      url: string;
      regulatoryRef: string;
    }>) {
      expect(s.url, `${s.id} url`).toMatch(/^https:\/\//);
      expect(s.regulatoryRef, `${s.id} ref`).toBeTruthy();
    }
  });

  it('includes the core UAE sources', () => {
    const ids = new Set<string>(SOURCES.map((s: { id: string }) => s.id));
    expect(ids.has('uae-moe-dpms')).toBe(true);
    expect(ids.has('uae-eocn-tfs')).toBe(true);
  });
});
