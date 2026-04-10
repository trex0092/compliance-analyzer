import { describe, it, expect } from 'vitest';
import {
  buildStrNarrative,
  isNarrativeFilingReady,
  MIN_NARRATIVE_LENGTH,
  type StrNarrativeInput,
} from '@/services/strNarrativeBuilder';

const sample: StrNarrativeInput = {
  filingType: 'STR',
  subject: {
    fullName: 'Acme Metals LLC',
    entityType: 'entity',
    nationality: 'UAE',
    idNumber: 'TL-12345',
    registeredAddress: 'DMCC Dubai',
  },
  relationship: {
    onboardingDate: '01/01/2025',
    accountNumber: 'C-9912',
    productType: 'Gold trading',
  },
  suspicion: {
    who: 'Acme Metals LLC and undisclosed intermediaries',
    what: 'Repeated sub-threshold cash purchases of gold bars',
    where: 'Gold Souk Dubai and DMCC free zone',
    when: 'February through March 2026 during non-business hours',
    why: 'Pattern consistent with structuring to avoid DPMS CTR threshold',
    how: 'Six payments of AED 48000-52000 made across three days by different runners',
  },
  redFlags: [
    {
      code: 'RF-001',
      description: 'Structuring below DPMS AED 55K threshold',
      regulatoryReference: 'MoE Circular 08/AML/2021',
    },
    {
      code: 'RF-014',
      description: 'Cash-intensive operation without economic rationale',
      regulatoryReference: 'FATF Rec 22',
    },
  ],
  evidence: [
    {
      refId: 'EV-001',
      description: 'CCTV footage from sales counter',
      vaultHash: 'abc123def456ghi789',
    },
    { refId: 'EV-002', description: 'Till receipts summary' },
  ],
  actionTaken: [
    'Account flagged in internal monitoring',
    'Enhanced due diligence initiated',
  ],
  reportingOfficer: {
    fullName: 'Sarah Al-Mansouri',
    officerId: 'CO-42',
    role: 'Compliance Officer',
  },
  reportDate: '10/04/2026',
};

describe('strNarrativeBuilder — structure', () => {
  it('produces all sections', () => {
    const n = buildStrNarrative(sample);
    expect(n.sections.header).toContain('STR');
    expect(n.sections.subject).toContain('Acme Metals LLC');
    expect(n.sections.suspicion).toContain('WHO:');
    expect(n.sections.redFlags).toContain('RF-001');
    expect(n.sections.evidence).toContain('EV-001');
    expect(n.sections.signature).toContain('Sarah Al-Mansouri');
  });

  it('narrative is deterministic', () => {
    const a = buildStrNarrative(sample);
    const b = buildStrNarrative(sample);
    expect(a.text).toBe(b.text);
  });

  it('meets minimum length', () => {
    const n = buildStrNarrative(sample);
    expect(n.characterCount).toBeGreaterThanOrEqual(MIN_NARRATIVE_LENGTH);
  });
});

describe('strNarrativeBuilder — compliance guards', () => {
  it('warns when too short', () => {
    const tiny = buildStrNarrative({
      ...sample,
      subject: { fullName: 'X', entityType: 'individual' },
      relationship: { onboardingDate: '01/01/2025' },
      suspicion: { who: 'X', what: 'Y', where: 'Z', when: 'A', why: 'B', how: 'C' },
      redFlags: [],
      evidence: [],
      actionTaken: [],
    });
    expect(tiny.warnings.some((w) => w.includes('chars'))).toBe(true);
  });

  it('detects tip-off language (FDL Art.29)', () => {
    const bad = buildStrNarrative({
      ...sample,
      actionTaken: ['We notified the subject that you are under investigation'],
    });
    expect(bad.warnings.some((w) => w.includes('tipping-off'))).toBe(true);
  });

  it('requires at least one red flag for STR', () => {
    const n = buildStrNarrative({ ...sample, redFlags: [] });
    expect(n.warnings.some((w) => w.includes('red flag'))).toBe(true);
  });

  it('isNarrativeFilingReady is true for clean narrative', () => {
    const n = buildStrNarrative(sample);
    expect(isNarrativeFilingReady(n)).toBe(true);
  });

  it('isNarrativeFilingReady is false when warnings present', () => {
    const n = buildStrNarrative({ ...sample, redFlags: [] });
    expect(isNarrativeFilingReady(n)).toBe(false);
  });
});
