/**
 * Integrity test for the vanilla JS browser modules shipped alongside
 * index.html. These modules are loaded as <script src="..."></script>
 * and are not transpiled — they must parse as plain ES5+ in the
 * browser and expose the public globals the HTML references.
 *
 * We don't run them (no DOM here), but we assert:
 *   - The file parses as a valid JS Function body.
 *   - Each module assigns the expected globals to `window`.
 *   - The module is wrapped in an IIFE so it doesn't leak locals.
 *
 * This catches the single biggest class of regressions we've seen:
 * "someone renamed window.foo to window.bar and forgot the HTML".
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSrc(name: string): string {
  return readFileSync(resolve(__dirname, '..', name), 'utf8');
}

interface ModuleSpec {
  file: string;
  globals: string[];
  /** Requires the file to be wrapped in an IIFE. */
  requireIife?: boolean;
}

const MODULES: ModuleSpec[] = [
  {
    file: 'esg-portfolio-client.js',
    globals: ['esgRefresh', 'esgOpenForm', 'esgSaveScore', 'esgExportCsv'],
    requireIife: true,
  },
  {
    file: 'global-status-bar.js',
    globals: ['gsbRefresh'],
    requireIife: true,
  },
  {
    file: 'customer-360-client.js',
    globals: ['c360Refresh', 'c360Render', 'c360OnSelect', 'c360OpenIncident', 'c360DraftStr'],
    requireIife: true,
  },
  {
    file: 'str-drafter-client.js',
    globals: ['strDrafterOpen', 'strDrafterClose', 'strDrafterBuild', 'strDrafterCopy', 'strDrafterSaveCase'],
    requireIife: true,
  },
  {
    file: 'metals-trading.js',
    globals: ['mtInit', 'mtSelectMetal', 'mtToggleRunning', 'mtSetSide', 'mtSetOrderType', 'mtSubmitOrder', 'mtPreTradeCheck'],
    requireIife: true,
  },
];

describe('vanilla JS browser modules — integrity', () => {
  for (const mod of MODULES) {
    describe(mod.file, () => {
      const src = readSrc(mod.file);

      it('parses as a valid JavaScript function body', () => {
        expect(() => new Function(src)).not.toThrow();
      });

      if (mod.requireIife) {
        it('is wrapped in an IIFE', () => {
          // Looser check: the file must start with "(function" (after any
          // leading comments / whitespace) and end with ")();" — the two
          // most common IIFE forms. Tolerates trailing newlines.
          const trimmed = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').trim();
          expect(trimmed.startsWith('(function')).toBe(true);
          expect(/\}\s*\)\s*\(\s*\)\s*;?\s*$/.test(trimmed)).toBe(true);
        });
      }

      for (const g of mod.globals) {
        it(`exposes window.${g}`, () => {
          const patterns = [
            new RegExp(`window\\.${g}\\s*=`),
            new RegExp(`window\\["${g}"\\]\\s*=`),
          ];
          expect(patterns.some((p) => p.test(src))).toBe(true);
        });
      }
    });
  }
});

describe('index.html references the modules it loads', () => {
  const html = readSrc('index.html');
  const scripts = ['esg-portfolio-client.js', 'global-status-bar.js', 'customer-360-client.js', 'str-drafter-client.js', 'metals-trading.js'];
  for (const s of scripts) {
    it(`includes <script src="${s}...">`, () => {
      expect(html).toMatch(new RegExp('src="' + s));
    });
  }
});

// The top-level "Customer 360" nav tab was retired in PR #322 — the
// data-arg="customer360" trigger no longer exists. The panel itself is
// still mounted in index.html (reachable from other surfaces), so we
// keep an integrity check on the content block without asserting the
// removed tab entry.
describe('Customer 360 panel is mounted in index.html', () => {
  const html = readSrc('index.html');
  it('has a tab-customer360 content block', () => {
    expect(html).toMatch(/id="tab-customer360"/);
  });
});

describe('STR drafter modal is mounted in index.html', () => {
  const html = readSrc('index.html');
  it('has a strDrafterModal element', () => {
    expect(html).toMatch(/id="strDrafterModal"/);
  });
  it('has a strDrafterOutput display target', () => {
    expect(html).toMatch(/id="strDrafterOutput"/);
  });
});
