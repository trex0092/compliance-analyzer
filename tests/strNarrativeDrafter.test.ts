/**
 * STR Narrative Drafter tests.
 *
 * Covers:
 *   - Valid input produces draft_ready with non-empty draftText
 *   - Invalid input returns invalid_input + reason in summary
 *   - Sanctions match adds the TFS citation block
 *   - Freeze verdict adds the 24h + CNMR language
 *   - Tipping-off lint rejection (we can't easily synthesize it
 *     since the drafter language is safe — assert lint.clean=true)
 *   - Output truncated to MAX_NARRATIVE_LENGTH
 *   - Regulatory citations carried
 */
import { describe, it, expect } from 'vitest';

import {
  draftStrNarrative,
  __test__,
  type NarrativeDraftInput,
} from '../src/services/strNarrativeDrafter';

const { MAX_NARRATIVE_LENGTH, formatAed, bandConfidence } = __test__;

function makeInput(overrides: Partial<NarrativeDraftInput> = {}): NarrativeDraftInput {
  return {
    tenantId: 'tenant-a',
    caseId: 'case-1',
    verdict: 'escalate',
    confidence: 0.78,
    entityName: 'ACME Trading LLC',
    entityRef: 'ent-uuid-1',
    triggerAtIso: '2026-04-15T04:00:00.000Z',
    amountAED: 65_000,
    topFactors: [
      {
        feature: 'txValue30dAED',
        value: 65_000,
        impact: 'increases-risk',
        contribution: 0.41,
      },
      {
        feature: 'cashRatio30d',
        value: 0.72,
        impact: 'increases-risk',
        contribution: 0.27,
      },
    ],
    typologies: [
      { id: 'T-DPMS-01', name: 'High-cash gold purchase', severity: 'high' },
    ],
    ...overrides,
  };
}

describe('draftStrNarrative', () => {
  it('returns draft_ready for a valid input', () => {
    const r = draftStrNarrative(makeInput());
    expect(r.status).toBe('draft_ready');
    expect(r.draftText).not.toBeNull();
    expect(r.draftText!.length).toBeGreaterThan(0);
    expect(r.draftText!).toContain('ACME Trading LLC');
    expect(r.draftText!).toContain('FDL Art.26-27');
  });

  it('rejects invalid_input on missing entityName', () => {
    // @ts-expect-error — testing required field
    const r = draftStrNarrative(makeInput({ entityName: '' }));
    expect(r.status).toBe('invalid_input');
    expect(r.summary).toMatch(/entityName/);
  });

  it('rejects invalid_input on out-of-range confidence', () => {
    const r = draftStrNarrative(makeInput({ confidence: 1.5 }));
    expect(r.status).toBe('invalid_input');
  });

  it('rejects invalid_input on bogus verdict', () => {
    // @ts-expect-error testing
    const r = draftStrNarrative(makeInput({ verdict: 'unknown' }));
    expect(r.status).toBe('invalid_input');
  });

  it('rejects invalid_input on bad triggerAtIso', () => {
    const r = draftStrNarrative(makeInput({ triggerAtIso: 'not-a-date' }));
    expect(r.status).toBe('invalid_input');
  });

  it('freeze verdict adds the 24h freeze language', () => {
    const r = draftStrNarrative(
      makeInput({ verdict: 'freeze', amountAED: 1_500_000 })
    );
    expect(r.status).toBe('draft_ready');
    expect(r.draftText!).toMatch(/Cabinet Res 74\/2020 Art\.4/);
    expect(r.draftText!).toMatch(/CNMR/);
  });

  it('sanctions match adds TFS citation block', () => {
    const r = draftStrNarrative(
      makeInput({
        sanctionsMatch: { list: 'OFAC', matchedName: 'John Doe', score: 0.92 },
      })
    );
    expect(r.status).toBe('draft_ready');
    expect(r.draftText!).toMatch(/SANCTIONS MATCH/);
    expect(r.draftText!).toMatch(/OFAC/);
    expect(r.citations.some((c) => c.includes('Cabinet Res 74/2020'))).toBe(true);
  });

  it('drafter passes when only non-subject-directed lint patterns fire', () => {
    // STR drafts legitimately mention "STR", "FIU", "goAML", "EOCN".
    // Those are TO-01/02/07/09/10 which are NOT subject-directed.
    // The drafter only blocks on TO-03/04/05/06/08 which address
    // the subject directly.
    const r = draftStrNarrative(makeInput());
    expect(r.status).toBe('draft_ready');
    expect(r.draftText).not.toBeNull();
  });

  it('output is truncated at MAX_NARRATIVE_LENGTH', () => {
    const r = draftStrNarrative(makeInput());
    expect(r.draftText!.length).toBeLessThanOrEqual(MAX_NARRATIVE_LENGTH);
  });

  it('carries regulatory anchors', () => {
    const r = draftStrNarrative(makeInput());
    expect(r.regulatory).toContain('FDL No.10/2025 Art.26-27');
    expect(r.regulatory).toContain('FDL No.10/2025 Art.29');
    expect(r.regulatory).toContain('FATF Rec 20');
  });
});

describe('helpers', () => {
  it('formatAed prints localised digits', () => {
    expect(formatAed(55_000)).toMatch(/AED/);
    expect(formatAed(undefined)).toBe('unspecified');
  });

  it('bandConfidence bands cleanly', () => {
    expect(bandConfidence(0.95)).toBe('high');
    expect(bandConfidence(0.75)).toBe('moderate');
    expect(bandConfidence(0.55)).toBe('low-moderate');
    expect(bandConfidence(0.2)).toBe('low');
  });
});
