/**
 * Regression test for BUG #6 — screening test coverage must reflect
 * the six regulatory bodies CLAUDE.md mandates: UN, OFAC, EU, UK,
 * UAE, EOCN. In UAE's current regulatory architecture UAE + EOCN are
 * one upstream list (maintained by the Executive Office for CTFEF
 * per Cabinet Res 74/2020 Art.3-7); the 6th selectable list on the
 * MLRO UI is INTERPOL (Red/Blue/Yellow Notices, INTERPOL Constitution
 * Art.3).
 *
 * This test enumerates the selectable list ids in the UI module
 * (screening-command-modules.js) + the backend list-code mapping,
 * and asserts both cover the six regulatory bodies with no silent
 * drops.
 *
 * Regulatory basis: FDL No.(10)/2025 Art.20-21 (CO duty of care —
 * every selected list must either be screened or visibly flagged as
 * integration-pending), Cabinet Res 74/2020 Art.4 (mandatory list
 * coverage), CLAUDE.md §Regulatory Domain Knowledge.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');

// The six regulatory bodies per CLAUDE.md, mapped to the ID the UI
// uses for the corresponding checkbox row.
const SIX_REGULATORY_BODIES: Readonly<Record<string, string>> = {
  UN: 'un_unsc',
  OFAC: 'ofac_sdn',
  EU: 'eu_csfl',
  UK: 'uk_ofsi',
  UAE_EOCN: 'uae_eocn',
  INTERPOL: 'interpol',
};

describe('Screening — 6-body list coverage (BUG #6)', () => {
  const uiSrc = readFileSync(
    resolve(ROOT, 'screening-command-modules.js'),
    'utf8',
  );
  const backendSrc = readFileSync(
    resolve(ROOT, 'netlify/functions/screening-run.mts'),
    'utf8',
  );

  it('UI SANCTIONS_LISTS contains the six regulatory bodies', () => {
    // The UI catalog may list additional bodies (SECO, OSFI, DFAT, …)
    // that are not yet wired to a backend fetcher; BUG #1 surfaced
    // those explicitly via pendingIntegrationLists. This assertion
    // only checks the six mandatory ones are PRESENT in the UI.
    for (const [body, uiId] of Object.entries(SIX_REGULATORY_BODIES)) {
      expect(
        uiSrc.includes(`id: '${uiId}'`),
        `UI SANCTIONS_LISTS must declare id '${uiId}' for regulator '${body}' (CLAUDE.md §Regulatory Domain Knowledge).`,
      ).toBe(true);
    }
  });

  it('LIST_ID_TO_BACKEND maps the six selectable regulator ids to a backend code', () => {
    // The 6 UI ids must either all map to a backend code (LIST_NAMES
    // or INTERPOL post-enrichment) or be explicitly partitioned into
    // pendingIntegrationLists per the BUG #1 fix. No silent drops.
    for (const [body, uiId] of Object.entries(SIX_REGULATORY_BODIES)) {
      const mappingLine = new RegExp(`${uiId}\\s*:\\s*['"]([A-Z_]+)['"]`);
      expect(
        mappingLine.test(uiSrc),
        `LIST_ID_TO_BACKEND must map UI id '${uiId}' (regulator '${body}') to a backend list code — otherwise the selection is silently dropped (BUG #1).`,
      ).toBe(true);
    }
  });

  it('backend LIST_NAMES covers the five automated fetchers (UN, OFAC, EU, UK, UAE/EOCN)', () => {
    // INTERPOL is the exception — it's enriched post-fan-out at line
    // ~1190 because it has manual-verification semantics, not via
    // LIST_NAMES. Every OTHER body must be in the fan-out so a
    // selected regulator is always actually fetched.
    const fiveAutomated = ['UN', 'OFAC', 'EU', 'UK_OFSI', 'UAE_EOCN'];
    for (const code of fiveAutomated) {
      const pattern = new RegExp(`['\"]${code}['\"]`);
      expect(
        pattern.test(backendSrc),
        `backend LIST_NAMES must include '${code}' — missing means silent coverage gap for that regulator.`,
      ).toBe(true);
    }
  });

  it('INTERPOL has a distinct post-fan-out enrichment block, not in LIST_NAMES', () => {
    // Confirms the regulatory architecture note in the BUG #4 code
    // comment stays accurate — INTERPOL is intentionally NOT in the
    // automated fan-out. If a future refactor moves it in, the code
    // comment must be updated.
    expect(backendSrc).toMatch(/list:\s*['"]INTERPOL['"]/);
    // Also confirm it is NOT in the core LIST_NAMES literal.
    const listNamesLiteral = backendSrc.match(
      /const\s+LIST_NAMES[\s\S]*?=\s*\[([\s\S]*?)\];/,
    );
    expect(listNamesLiteral, 'LIST_NAMES literal must be statically declarable').toBeTruthy();
    if (listNamesLiteral) {
      expect(
        listNamesLiteral[1].includes('INTERPOL'),
        'INTERPOL must live in the post-fan-out block, not inside LIST_NAMES (BUG #4 note).',
      ).toBe(false);
    }
  });

  it('every MANDATORY list has a non-empty upstream guarantee', () => {
    // MANDATORY_LIST_NAMES is the integrity-gate: if any of these
    // errored, the screening verdict must surface SCREENING INCOMPLETE
    // instead of a clean "no freeze" (Cabinet Res 74/2020 Art.4).
    const mandatoryMatch = backendSrc.match(
      /MANDATORY_LIST_NAMES\s*=\s*new\s+Set\(\[([^\]]+)\]\)/,
    );
    expect(mandatoryMatch, 'MANDATORY_LIST_NAMES must remain a declared Set').toBeTruthy();
    if (mandatoryMatch) {
      // The mandatory set must include UN (source of cascaded UAE
      // coverage under Cabinet Res 74/2020 Art.3) and UAE_EOCN
      // (domestic authority). No silent downgrade allowed.
      expect(mandatoryMatch[1]).toContain("'UN'");
      expect(mandatoryMatch[1]).toContain("'UAE_EOCN'");
    }
  });

  it('top-level response surfaces fourEyesRequired (BUG #3 fix)', () => {
    // Asana dispatcher should not need to traverse deepBrain +
    // weaponized to decide whether to open a Four-Eyes Approvals
    // task. The top-level flag is the single source of truth for
    // high-risk screenings.
    expect(backendSrc).toMatch(/fourEyesRequired:\s*topLevelFourEyesRequired/);
    expect(backendSrc).toMatch(/topLevelFourEyesRequired\s*=/);
  });

  it('fanout panic recorder replaces the silent .catch(() => {}) pattern (BUG #2 fix)', () => {
    // Every runListWithFallback .catch must route through the
    // recordFanoutPanic logger. A fresh re-introduction of
    // `.catch(() => {})` would be a regression.
    expect(backendSrc).toMatch(/const\s+recordFanoutPanic\s*=/);
    expect(backendSrc).toMatch(/\.catch\(recordFanoutPanic\(/);
    // The flagged legacy pattern must not appear inside the fanout
    // Promise.all block (anywhere else in the file is fine — this
    // test targets the screening fanout specifically).
    const fanoutMatch = backendSrc.match(
      /const\s+fanout\s*=\s*Promise\.all\(\[([\s\S]*?)\]\);/,
    );
    expect(fanoutMatch, 'fanout = Promise.all literal must exist').toBeTruthy();
    if (fanoutMatch) {
      expect(fanoutMatch[1]).not.toMatch(/\.catch\(\(\)\s*=>\s*\{\}\)/);
    }
  });

  it('error-state short TTL is wired (BUG #5 fix)', () => {
    expect(backendSrc).toMatch(/SANCTIONS_CACHE_TTL_ERROR_MS/);
    expect(backendSrc).toMatch(/listCacheShortTtl\s*=/);
  });
});
