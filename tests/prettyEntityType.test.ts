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

// ---------------------------------------------------------------------------
// computeTfs2SubjectFingerprint — cross-device opt-in dedup key
// ---------------------------------------------------------------------------
//
// Regulatory basis: FDL No.(10)/2025 Art.20-21 (the MLRO must see an
// accurate cross-device count; a per-browser ID would inflate the count
// and make the banner meaningless).

type Fingerprint = (record: unknown) => string;
let computeFingerprint: Fingerprint;

describe('computeTfs2SubjectFingerprint', () => {
  beforeAll(() => {
    // Extract the real helper from compliance-suite.js so any drift in the
    // FNV-1a implementation breaks these tests immediately. The function is
    // declared inside an IIFE but also exposed as global.
    // computeTfs2SubjectFingerprint, so we pluck it via the same sandboxed-
    // Function pattern used by the prettyEntityType extractor above.
    const path = join(__dirname, '..', 'compliance-suite.js');
    const src = readFileSync(path, 'utf8');
    const start = src.indexOf('function computeTfs2SubjectFingerprint');
    expect(start).toBeGreaterThan(-1);
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
        if (depth === 0) { end = i + 1; break; }
      }
    }
    expect(end).toBeGreaterThan(start);
    const helperSrc = src.slice(start, end);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const runner = new Function(helperSrc + '\nreturn computeTfs2SubjectFingerprint;');
    computeFingerprint = runner() as Fingerprint;
    expect(typeof computeFingerprint).toBe('function');
  });

  it('is deterministic for the same input', () => {
    const rec = { screenedName: 'Jane Doe', dob: '15/01/1980', idNumber: 'P12345' };
    expect(computeFingerprint(rec)).toBe(computeFingerprint(rec));
  });

  it('same subject on two devices → same fingerprint', () => {
    const a = { screenedName: '  Jane  Doe  ', dob: '15/01/1980', idNumber: 'p12345' };
    const b = { screenedName: 'Jane Doe',     dob: '15/01/1980', idNumber: 'P12345' };
    expect(computeFingerprint(a)).toBe(computeFingerprint(b));
  });

  it('different DOB → different fingerprints even with same name', () => {
    const a = { screenedName: 'Jane Doe', dob: '15/01/1980', idNumber: '' };
    const b = { screenedName: 'Jane Doe', dob: '16/01/1980', idNumber: '' };
    expect(computeFingerprint(a)).not.toBe(computeFingerprint(b));
  });

  it('different idNumber → different fingerprints even with same name', () => {
    const a = { screenedName: 'Jane Doe', dob: '', idNumber: 'P12345' };
    const b = { screenedName: 'Jane Doe', dob: '', idNumber: 'P67890' };
    expect(computeFingerprint(a)).not.toBe(computeFingerprint(b));
  });

  it('returns empty string when no identifying data at all', () => {
    expect(computeFingerprint({})).toBe('');
    expect(computeFingerprint({ screenedName: '   ' })).toBe('');
    expect(computeFingerprint(null)).toBe('');
  });

  it('is Unicode-safe (Arabic name)', () => {
    const rec = { screenedName: 'محمد الراشد', dob: '01/01/1970', idNumber: '' };
    const fp = computeFingerprint(rec);
    expect(fp).toMatch(/^tfs2:[0-9a-f]{8}$/);
    // Same input → same hash
    expect(computeFingerprint({ ...rec })).toBe(fp);
  });

  it('starts with the tfs2: namespace', () => {
    const fp = computeFingerprint({ screenedName: 'Test Subject' });
    expect(fp.startsWith('tfs2:')).toBe(true);
    expect(fp.length).toBe('tfs2:'.length + 8);
  });
});
