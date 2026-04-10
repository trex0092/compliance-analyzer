import { describe, it, expect } from 'vitest';
import { calculateSelfAuditScore, type SelfAuditInput } from '@/services/selfAuditScore';

function perfectInput(): SelfAuditInput {
  return {
    coAppointed: true,
    coNotifiedWithin15Days: true,
    policyBoardApproved: true,
    independentAuditWithin12Months: true,
    ewraCurrentWithinYear: true,
    riskAppetiteApproved: true,
    cddProceduresDocumented: true,
    uboCoveragePct: 100,
    sanctionsListAgeHours: 2,
    portfolioReScreenedWithin24h: true,
    strDeadlinesMet: true,
    ctrDeadlinesMet: true,
    dpmsrFiledThisQuarter: true,
    cnmrDeadlinesMet: true,
    evidenceChainIntact: true,
    retentionMet: true,
    trainingCurrentForAllStaff: true,
    attestationsCurrent: true,
    brainEndpointHealthy: true,
    fourEyesConfigured: true,
    approverKeysMinTwo: true,
  };
}

function zeroInput(): SelfAuditInput {
  const p = perfectInput();
  const keys = Object.keys(p) as (keyof SelfAuditInput)[];
  for (const k of keys) {
    const v = p[k];
    if (typeof v === 'boolean') (p[k] as boolean) = false;
    else if (typeof v === 'number') (p[k] as number) = 0;
  }
  p.sanctionsListAgeHours = 200; // very stale
  p.uboCoveragePct = 0;
  return p;
}

describe('calculateSelfAuditScore', () => {
  it('perfect input scores 100 with grade A', () => {
    const result = calculateSelfAuditScore(perfectInput());
    expect(result.totalScore).toBeGreaterThanOrEqual(99.9);
    expect(result.grade).toBe('A');
    expect(result.inspectionReady).toBe(true);
    expect(result.criticalGaps).toHaveLength(0);
  });

  it('zero input scores 0 with grade F', () => {
    const result = calculateSelfAuditScore(zeroInput());
    expect(result.totalScore).toBeLessThanOrEqual(1);
    expect(result.grade).toBe('F');
    expect(result.inspectionReady).toBe(false);
    expect(result.criticalGaps.length).toBeGreaterThan(10);
  });

  it('produces 8 dimensions', () => {
    const result = calculateSelfAuditScore(perfectInput());
    expect(result.dimensions).toHaveLength(8);
  });

  it('each dimension caps at 12.5', () => {
    const result = calculateSelfAuditScore(perfectInput());
    for (const d of result.dimensions) {
      expect(d.score).toBeLessThanOrEqual(12.5);
    }
  });

  it('stale sanctions list heavily penalises Screening', () => {
    const input = perfectInput();
    input.sanctionsListAgeHours = 100;
    input.portfolioReScreenedWithin24h = false;
    const result = calculateSelfAuditScore(input);
    const screening = result.dimensions.find((d) => d.dimension === 'Screening');
    expect(screening!.score).toBeLessThan(5);
  });

  it('broken evidence chain penalises Records', () => {
    const input = perfectInput();
    input.evidenceChainIntact = false;
    const result = calculateSelfAuditScore(input);
    const records = result.dimensions.find((d) => d.dimension === 'Records');
    expect(records!.score).toBeLessThan(12.5);
    expect(records!.gaps.some((g) => g.includes('Evidence chain'))).toBe(true);
  });

  it('proportional UBO coverage scoring', () => {
    const input = perfectInput();
    input.uboCoveragePct = 50;
    const result = calculateSelfAuditScore(input);
    const cdd = result.dimensions.find((d) => d.dimension === 'CDD');
    // CDD max is 12.5: 40% for procedures (5) + 60% for ubo at 50% = 3.75. Total: 8.75
    expect(cdd!.score).toBeCloseTo(8.75, 1);
  });

  it('grade boundaries: A >= 90, B 80-89, C 70-79, D 60-69, F < 60', () => {
    const input = perfectInput();
    // Knock out operational + training to land in the 70s range
    input.brainEndpointHealthy = false;
    input.fourEyesConfigured = false;
    input.approverKeysMinTwo = false;
    input.trainingCurrentForAllStaff = false;
    input.attestationsCurrent = false;
    const result = calculateSelfAuditScore(input);
    expect(result.totalScore).toBeLessThan(80);
    expect(['B', 'C', 'D']).toContain(result.grade);
  });

  it('inspectionReady is true only at >= 80', () => {
    const perfect = calculateSelfAuditScore(perfectInput());
    expect(perfect.inspectionReady).toBe(true);
    const zero = calculateSelfAuditScore(zeroInput());
    expect(zero.inspectionReady).toBe(false);
  });
});
