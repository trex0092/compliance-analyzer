import { describe, it, expect } from 'vitest';
import {
  PENALTY_CATALOGUE,
  lookupPenalty,
  calculateExposure,
  formatExposureReport,
  type Finding,
} from '@/services/penaltyCalculator';

describe('PENALTY_CATALOGUE', () => {
  it('has at least 20 violation codes', () => {
    expect(PENALTY_CATALOGUE.length).toBeGreaterThanOrEqual(20);
  });

  it('every entry has min <= max', () => {
    for (const p of PENALTY_CATALOGUE) {
      expect(p.minAED).toBeLessThanOrEqual(p.maxAED);
    }
  });

  it('every entry has a regulatory citation', () => {
    for (const p of PENALTY_CATALOGUE) {
      expect(p.regulatory).toBeTruthy();
    }
  });

  it('tipping off is marked criminal', () => {
    const tipping = PENALTY_CATALOGUE.find((p) => p.code === 'TIPPING_OFF');
    expect(tipping?.criminal).toBe(true);
  });

  it('late sanctions freeze is marked criminal', () => {
    const freeze = PENALTY_CATALOGUE.find((p) => p.code === 'SANCTIONS_FREEZE_LATE');
    expect(freeze?.criminal).toBe(true);
  });

  it('governance-only violations are NOT marked criminal', () => {
    const policy = PENALTY_CATALOGUE.find((p) => p.code === 'POLICY_NOT_APPROVED');
    expect(policy?.criminal).toBe(false);
  });
});

describe('lookupPenalty', () => {
  it('returns the band for a known code', () => {
    const p = lookupPenalty('UBO_NOT_IDENTIFIED');
    expect(p).not.toBeNull();
    expect(p?.area).toBe('CDD');
  });

  it('returns null for an unknown code', () => {
    // @ts-expect-error — intentional bad input
    expect(lookupPenalty('NOT_A_REAL_CODE')).toBeNull();
  });
});

describe('calculateExposure', () => {
  it('zero findings → zero exposure', () => {
    const exp = calculateExposure([]);
    expect(exp.totalMinAED).toBe(0);
    expect(exp.totalMaxAED).toBe(0);
    expect(exp.findingsCount).toBe(0);
  });

  it('single finding sums min + max', () => {
    const findings: Finding[] = [{ code: 'UBO_NOT_IDENTIFIED', detail: 'No UBOs in 40% of cases' }];
    const exp = calculateExposure(findings);
    expect(exp.totalMinAED).toBe(200_000);
    expect(exp.totalMaxAED).toBe(2_000_000);
    expect(exp.findingsCount).toBe(1);
  });

  it('expected uses severityFactor', () => {
    const atMin = calculateExposure([
      { code: 'UBO_NOT_IDENTIFIED', detail: 'x', severityFactor: 0 },
    ]);
    const atMax = calculateExposure([
      { code: 'UBO_NOT_IDENTIFIED', detail: 'x', severityFactor: 1 },
    ]);
    expect(atMin.totalExpectedAED).toBe(200_000);
    expect(atMax.totalExpectedAED).toBe(2_000_000);
  });

  it('defaults severityFactor to 0.5', () => {
    const exp = calculateExposure([{ code: 'UBO_NOT_IDENTIFIED', detail: 'x' }]);
    // (200K + 2M) / 2 = 1.1M
    expect(exp.totalExpectedAED).toBe(1_100_000);
  });

  it('counts criminal referrals', () => {
    const exp = calculateExposure([
      { code: 'TIPPING_OFF', detail: 'x' },
      { code: 'SANCTIONS_FREEZE_LATE', detail: 'y' },
      { code: 'UBO_NOT_IDENTIFIED', detail: 'z' },
    ]);
    expect(exp.criminalReferrals).toBe(2);
  });

  it('aggregates by area', () => {
    const exp = calculateExposure([
      { code: 'UBO_NOT_IDENTIFIED', detail: 'a' },
      { code: 'EDD_NOT_APPLIED', detail: 'b' },
      { code: 'POLICY_NOT_APPROVED', detail: 'c' },
    ]);
    expect(exp.byArea.CDD.count).toBe(2);
    expect(exp.byArea.Governance.count).toBe(1);
  });

  it('skips unknown codes silently', () => {
    const exp = calculateExposure([
      { code: 'UBO_NOT_IDENTIFIED', detail: 'real' },
      // @ts-expect-error — intentional bad input
      { code: 'NOT_REAL', detail: 'fake' },
    ]);
    expect(exp.findingsCount).toBe(2);
    // But only the real one contributes to the total
    expect(exp.totalMinAED).toBe(200_000);
  });
});

describe('formatExposureReport', () => {
  it('produces a markdown document with totals and line items', () => {
    const exp = calculateExposure([
      { code: 'UBO_NOT_IDENTIFIED', detail: '5 entities missing UBOs' },
      { code: 'TIPPING_OFF', detail: '1 historical tip-off incident' },
    ]);
    const md = formatExposureReport(exp);
    expect(md).toContain('# Penalty Exposure Report');
    expect(md).toContain('**Findings:** 2');
    expect(md).toContain('**Criminal referrals:** 1');
    expect(md).toContain('UBO_NOT_IDENTIFIED');
    expect(md).toContain('TIPPING_OFF');
  });
});
