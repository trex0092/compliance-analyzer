/**
 * Tests for netlify/functions/screening-save.mts — exercises the pure
 * validation + outcomeTag logic via __test__. No Netlify runtime, no
 * HTTP, no Blobs, no Asana.
 *
 * Regulatory: FDL No.10/2025 Art.20-21, 24, 26-27, 29; Cabinet Res
 * 134/2025 Art.14, 19; Cabinet Res 74/2020 Art.4-7; Cabinet Decision
 * No.(74)/2020.
 */
import { describe, it, expect } from 'vitest';

// @ts-expect-error — .mts file has no type declarations at test time
import { __test__ } from '../netlify/functions/screening-save.mts';

const { validateInput, outcomeTag } = __test__ as {
  validateInput: (
    input: unknown
  ) => { ok: true; input: Record<string, unknown> } | { ok: false; error: string };
  outcomeTag: (outcome: string) => string;
};

// ---------------------------------------------------------------------------
// validateInput
// ---------------------------------------------------------------------------

const baseInput = () => ({
  subjectName: 'John Doe',
  entityType: 'individual' as const,
  eventType: 'new_customer_onboarding' as const,
  listsScreened: ['UAE_EOCN', 'UN'],
  overallTopScore: 0,
  overallTopClassification: 'none' as const,
  screeningDate: '18/04/2026',
  reviewedBy: 'Jane MLRO',
  outcome: 'negative_no_match' as const,
  rationale: 'No hits across the two mandatory lists; onboarding cleared.',
});

describe('screening-save — validateInput', () => {
  // ---- Shape + subject identity ----

  it('rejects non-object body', () => {
    expect(validateInput(null).ok).toBe(false);
    expect(validateInput('string').ok).toBe(false);
    expect(validateInput(undefined).ok).toBe(false);
  });

  it('rejects missing subjectName', () => {
    const { subjectName: _s, ...rest } = baseInput();
    void _s;
    const r = validateInput(rest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('subjectName');
  });

  it('rejects oversized subjectName', () => {
    const r = validateInput({ ...baseInput(), subjectName: 'x'.repeat(250) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('too long');
  });

  it('rejects oversized subjectId', () => {
    const r = validateInput({ ...baseInput(), subjectId: 'x'.repeat(200) });
    expect(r.ok).toBe(false);
  });

  // ---- Entity type ----

  it('rejects missing entityType', () => {
    const { entityType: _e, ...rest } = baseInput();
    void _e;
    const r = validateInput(rest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('entityType');
  });

  it('rejects invalid entityType', () => {
    const r = validateInput({ ...baseInput(), entityType: 'robot' });
    expect(r.ok).toBe(false);
  });

  it('accepts legal_entity', () => {
    const r = validateInput({ ...baseInput(), entityType: 'legal_entity' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.entityType).toBe('legal_entity');
  });

  // ---- DoB ----

  it('rejects bad dob format', () => {
    const r = validateInput({ ...baseInput(), dob: '1990/13/45' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('dob');
  });

  it('accepts yyyy-mm-dd dob and converts to dd/mm/yyyy', () => {
    const r = validateInput({ ...baseInput(), dob: '1990-05-12' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.dob).toBe('12/05/1990');
  });

  it('accepts dd/mm/yyyy dob unchanged', () => {
    const r = validateInput({ ...baseInput(), dob: '12/05/1990' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.dob).toBe('12/05/1990');
  });

  it('allows omitted dob', () => {
    const r = validateInput(baseInput());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.dob).toBeUndefined();
  });

  // ---- Event type ----

  it('rejects missing eventType', () => {
    const { eventType: _ev, ...rest } = baseInput();
    void _ev;
    const r = validateInput(rest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('eventType');
  });

  it('rejects invalid eventType', () => {
    const r = validateInput({ ...baseInput(), eventType: 'because-the-moon' });
    expect(r.ok).toBe(false);
  });

  it('accepts all 7 allowed event types', () => {
    for (const ev of [
      'new_customer_onboarding',
      'periodic_review',
      'transaction_trigger',
      'name_change',
      'adverse_media_hit',
      'pep_change',
      'ad_hoc',
    ]) {
      const r = validateInput({ ...baseInput(), eventType: ev });
      expect(r.ok, `eventType ${ev} should be accepted`).toBe(true);
    }
  });

  // ---- listsScreened ----

  it('rejects empty listsScreened', () => {
    const r = validateInput({ ...baseInput(), listsScreened: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('listsScreened');
  });

  it('rejects non-array listsScreened', () => {
    const r = validateInput({ ...baseInput(), listsScreened: 'UAE_EOCN' });
    expect(r.ok).toBe(false);
  });

  it('rejects non-string listsScreened entries', () => {
    const r = validateInput({ ...baseInput(), listsScreened: ['UN', 42] });
    expect(r.ok).toBe(false);
  });

  // ---- Scores + classification ----

  it('rejects non-numeric overallTopScore', () => {
    const r = validateInput({ ...baseInput(), overallTopScore: 'high' });
    expect(r.ok).toBe(false);
  });

  it('rejects overallTopScore out of [0,1]', () => {
    expect(validateInput({ ...baseInput(), overallTopScore: -0.1 }).ok).toBe(false);
    expect(validateInput({ ...baseInput(), overallTopScore: 1.5 }).ok).toBe(false);
  });

  it('rejects invalid classification', () => {
    const r = validateInput({ ...baseInput(), overallTopClassification: 'sus' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('overallTopClassification');
  });

  it('accepts all 4 classifications', () => {
    for (const c of ['confirmed', 'potential', 'weak', 'none']) {
      const r = validateInput({
        ...baseInput(),
        overallTopClassification: c,
        overallTopScore: c === 'none' ? 0 : 0.5,
      });
      expect(r.ok, `classification ${c} should be accepted`).toBe(true);
    }
  });

  // ---- Anomalies ----

  it('accepts well-formed anomalies', () => {
    const r = validateInput({
      ...baseInput(),
      anomalies: [{ list: 'OFAC', error: 'network timeout' }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.anomalies).toEqual([{ list: 'OFAC', error: 'network timeout' }]);
    }
  });

  it('rejects non-array anomalies', () => {
    const r = validateInput({ ...baseInput(), anomalies: 'boom' });
    expect(r.ok).toBe(false);
  });

  it('rejects malformed anomaly entry', () => {
    const r = validateInput({ ...baseInput(), anomalies: [{ list: 'OFAC' }] });
    expect(r.ok).toBe(false);
  });

  // ---- Screening date ----

  it('rejects missing screeningDate', () => {
    const { screeningDate: _d, ...rest } = baseInput();
    void _d;
    const r = validateInput(rest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('screeningDate');
  });

  it('rejects malformed screeningDate', () => {
    const r = validateInput({ ...baseInput(), screeningDate: '2026.04.18' });
    expect(r.ok).toBe(false);
  });

  it('converts yyyy-mm-dd screeningDate to dd/mm/yyyy', () => {
    const r = validateInput({ ...baseInput(), screeningDate: '2026-04-18' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.screeningDate).toBe('18/04/2026');
  });

  // ---- Reviewer ----

  it('rejects missing reviewedBy', () => {
    const { reviewedBy: _r, ...rest } = baseInput();
    void _r;
    const r = validateInput(rest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('reviewedBy');
  });

  it('rejects empty reviewedBy', () => {
    const r = validateInput({ ...baseInput(), reviewedBy: '   ' });
    expect(r.ok).toBe(false);
  });

  // ---- Outcome + rationale (the auditor attestation) ----

  it('rejects missing outcome', () => {
    const { outcome: _o, ...rest } = baseInput();
    void _o;
    const r = validateInput(rest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('outcome');
  });

  it('rejects invalid outcome', () => {
    const r = validateInput({ ...baseInput(), outcome: 'mostly_ok' });
    expect(r.ok).toBe(false);
  });

  it('accepts all 4 outcomes', () => {
    for (const o of [
      'negative_no_match',
      'false_positive',
      'partial_match',
      'confirmed_match',
    ]) {
      // Four-eyes gate — partial/confirmed require an independent second
      // approver (FDL Art.20-21; Cabinet Res 134/2025 Art.19).
      const requiresFourEyes = o === 'partial_match' || o === 'confirmed_match';
      const extra = requiresFourEyes
        ? { secondApprover: 'Amira Khalid', secondApproverRole: 'Deputy CO' }
        : {};
      const r = validateInput({ ...baseInput(), outcome: o, ...extra });
      expect(r.ok, `outcome ${o} should be accepted`).toBe(true);
    }
  });

  // ---- Four-eyes gate (FDL Art.20-21; Cabinet Res 134/2025 Art.19) ----

  it('rejects partial_match without a second approver', () => {
    const r = validateInput({ ...baseInput(), outcome: 'partial_match' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('secondApprover');
  });

  it('rejects confirmed_match without a second approver role', () => {
    const r = validateInput({
      ...baseInput(),
      outcome: 'confirmed_match',
      secondApprover: 'Amira Khalid',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('secondApproverRole');
  });

  it('rejects a second approver who is the same person as reviewedBy', () => {
    const base = baseInput();
    const r = validateInput({
      ...base,
      outcome: 'partial_match',
      secondApprover: base.reviewedBy.toUpperCase(),
      secondApproverRole: 'Deputy CO',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('different person');
  });

  it('rejects rationale shorter than 20 chars', () => {
    const r = validateInput({ ...baseInput(), rationale: 'too short' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('20');
  });

  it('rejects missing rationale', () => {
    const { rationale: _r, ...rest } = baseInput();
    void _r;
    const r = validateInput(rest);
    expect(r.ok).toBe(false);
  });

  it('rejects oversized rationale', () => {
    const r = validateInput({ ...baseInput(), rationale: 'x'.repeat(5000) });
    expect(r.ok).toBe(false);
  });

  // ---- Optional fields ----

  it('accepts optional riskTier + jurisdiction + runId', () => {
    const r = validateInput({
      ...baseInput(),
      riskTier: 'high',
      jurisdiction: 'AE',
      runId: 'RUN-123',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.riskTier).toBe('high');
      expect(r.input.jurisdiction).toBe('AE');
      expect(r.input.runId).toBe('RUN-123');
    }
  });

  it('rejects invalid riskTier', () => {
    const r = validateInput({ ...baseInput(), riskTier: 'legendary' });
    expect(r.ok).toBe(false);
  });

  // ---- Key findings (optional, max 4000) ----

  it('accepts optional keyFindings', () => {
    const r = validateInput({
      ...baseInput(),
      keyFindings: 'Top hit on UN 1267/1989 list (0.92). DOB matches.',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.keyFindings).toContain('UN 1267');
  });

  it('rejects non-string keyFindings', () => {
    const r = validateInput({ ...baseInput(), keyFindings: 123 });
    expect(r.ok).toBe(false);
  });

  it('rejects oversized keyFindings', () => {
    const r = validateInput({ ...baseInput(), keyFindings: 'x'.repeat(5000) });
    expect(r.ok).toBe(false);
  });

  it('omits keyFindings when empty-trimmed', () => {
    const r = validateInput({ ...baseInput(), keyFindings: '   ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.keyFindings).toBeUndefined();
  });

  // ---- Trimming ----

  it('trims string fields', () => {
    const r = validateInput({
      ...baseInput(),
      subjectName: '  John Doe  ',
      subjectId: '  CUS-1  ',
      country: '  UAE  ',
      idNumber: '  EID-9  ',
      reviewedBy: '  Jane MLRO  ',
      rationale: '  ' + 'x'.repeat(25) + '  ',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.subjectName).toBe('John Doe');
      expect(r.input.subjectId).toBe('CUS-1');
      expect(r.input.country).toBe('UAE');
      expect(r.input.idNumber).toBe('EID-9');
      expect(r.input.reviewedBy).toBe('Jane MLRO');
      expect((r.input.rationale as string).startsWith('x')).toBe(true);
    }
  });

  // ---- Golden path ----

  it('accepts a complete well-formed disposition', () => {
    const r = validateInput(baseInput());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.subjectName).toBe('John Doe');
      expect(r.input.entityType).toBe('individual');
      expect(r.input.eventType).toBe('new_customer_onboarding');
      expect(r.input.outcome).toBe('negative_no_match');
      expect(r.input.reviewedBy).toBe('Jane MLRO');
      expect(r.input.listsScreened).toEqual(['UAE_EOCN', 'UN']);
    }
  });
});

// ---------------------------------------------------------------------------
// outcomeTag — prefixes used for the Asana task name
// ---------------------------------------------------------------------------

describe('screening-save — outcomeTag', () => {
  it('prefixes confirmed_match with FREEZE-24H (Cabinet Res 74/2020 Art.4-7)', () => {
    expect(outcomeTag('confirmed_match')).toBe('[CONFIRMED MATCH — FREEZE-24H]');
  });

  it('prefixes partial_match with ESCALATED', () => {
    expect(outcomeTag('partial_match')).toBe('[PARTIAL MATCH — ESCALATED]');
  });

  it('prefixes false_positive with DISMISSED', () => {
    expect(outcomeTag('false_positive')).toBe('[FALSE POSITIVE — DISMISSED]');
  });

  it('prefixes negative_no_match with NEGATIVE', () => {
    expect(outcomeTag('negative_no_match')).toBe('[NEGATIVE — NO MATCH]');
  });
});
