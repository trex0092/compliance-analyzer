/**
 * Tests for the global window.prettyEntityType display helper defined at
 * the top of compliance-suite.js. This helper is exercised across three
 * display sites (approval queue row, approval notes, TFS Asana sync note)
 * so the MLRO and auditors never see a raw lowercase canonical token.
 *
 * Regulatory basis: FDL No.10/2025 Art.20-21 (CO-facing output quality
 * is part of situational awareness — lower-case enum leaks look like
 * incomplete data to auditors).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

type PrettyEntityType = (raw: unknown) => string;

let prettyEntityType: PrettyEntityType;

beforeAll(() => {
  // compliance-suite.js is a browser IIFE-wrapped script — we only need
  // the tiny global helper defined at the top (before the first IIFE).
  // Instead of pulling in the whole 5700-line file (which assumes DOM),
  // we extract just the helper definition and eval it against a minimal
  // window shim.
  const path = join(__dirname, '..', 'compliance-suite.js');
  const src = readFileSync(path, 'utf8');
  const start = src.indexOf('window.prettyEntityType = function');
  expect(start).toBeGreaterThan(-1);
  // The helper ends at the matching closing };  Find it by tracking braces.
  let depth = 0;
  let inString: string | null = null;
  let i = src.indexOf('{', start);
  let end = -1;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      if (c === '\\') { i++; continue; }
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inString = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        // Expect `};` immediately after the closing brace.
        end = i + 2;
        break;
      }
    }
  }
  expect(end).toBeGreaterThan(start);
  const helperSrc = src.slice(start, end);
  const sandbox: { window: { prettyEntityType?: PrettyEntityType } } = { window: {} };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const runner = new Function('window', helperSrc + '\nreturn window.prettyEntityType;');
  prettyEntityType = runner(sandbox.window) as PrettyEntityType;
  expect(typeof prettyEntityType).toBe('function');
});

describe('prettyEntityType — canonical tokens', () => {
  it('individual → Individual', () => {
    expect(prettyEntityType('individual')).toBe('Individual');
  });
  it('organisation → Organisation', () => {
    expect(prettyEntityType('organisation')).toBe('Organisation');
  });
  it('unspecified → Unspecified', () => {
    expect(prettyEntityType('unspecified')).toBe('Unspecified');
  });
});

describe('prettyEntityType — legacy tokens', () => {
  it('Individual (capitalised legacy) → Individual', () => {
    expect(prettyEntityType('Individual')).toBe('Individual');
  });
  it('Company (legacy TFS dropdown) → Organisation', () => {
    expect(prettyEntityType('Company')).toBe('Organisation');
  });
  it('legal_entity (legacy server contract) → Organisation', () => {
    expect(prettyEntityType('legal_entity')).toBe('Organisation');
  });
  it('organization (US spelling) → Organisation', () => {
    expect(prettyEntityType('organization')).toBe('Organisation');
  });
});

describe('prettyEntityType — empty / unknown', () => {
  it('empty string → em-dash', () => {
    expect(prettyEntityType('')).toBe('—');
  });
  it('whitespace → em-dash', () => {
    expect(prettyEntityType('   ')).toBe('—');
  });
  it('null → em-dash', () => {
    expect(prettyEntityType(null)).toBe('—');
  });
  it('undefined → em-dash', () => {
    expect(prettyEntityType(undefined)).toBe('—');
  });
  it('unknown value passes through in sentence case', () => {
    expect(prettyEntityType('robot')).toBe('Robot');
  });
});
