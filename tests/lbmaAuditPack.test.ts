/**
 * LBMA audit pack — pure mapping + rendering tests.
 *
 * No file I/O, no simulator invocation. Exercises the assembly and
 * markdown rendering functions with a fixed InspectionResult so any
 * regression in the MoE-area → LBMA-step mapping is caught in CI.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — tsx-executed TS file
import {
  LBMA_STEPS,
  AREA_TO_STEP,
  assembleSteps,
  renderMarkdown,
} from '../scripts/lbma-audit-pack.ts';

// Shape must match the simulator's output.
const fakeInspection = {
  score: 72,
  grade: 'C',
  maxPenalty: 850_000,
  gaps: [
    { id: 'GOV-03', area: 'Governance', item: 'CO notification', weight: 3, penalty: 50_000, reason: 'Missing' },
    { id: 'CDD-02', area: 'CDD',        item: 'EDD applied',     weight: 5, penalty: 200_000, reason: 'No EDD' },
    { id: 'TFS-02', area: 'TFS',        item: '24h freeze',      weight: 5, penalty: 500_000, reason: 'Manual only' },
    { id: 'DPMS-01', area: 'DPMS',      item: 'Quarterly DPMSR', weight: 4, penalty: 200_000, reason: 'Late Q1' },
  ],
  passed: [
    { id: 'GOV-01', area: 'Governance',       item: 'AML policy',       weight: 5, penalty: 50_000 },
    { id: 'CDD-01', area: 'CDD',              item: 'CDD procedures',    weight: 5, penalty: 100_000 },
    { id: 'REC-01', area: 'Records',          item: '5-year retention',  weight: 4, penalty: 100_000 },
    { id: 'RA-01',  area: 'Risk Assessment',  item: 'EWRA',              weight: 5, penalty: 200_000 },
  ],
};

describe('LBMA audit pack: LBMA_STEPS', () => {
  it('has all five LBMA RGG v9 steps', () => {
    expect(LBMA_STEPS).toHaveLength(5);
    expect(LBMA_STEPS.map((s: { step: number }) => s.step)).toEqual([1, 2, 3, 4, 5]);
  });

  it('step 1 is about company management systems', () => {
    expect(LBMA_STEPS[0].title.toLowerCase()).toContain('management systems');
  });

  it('step 4 is about independent audit', () => {
    expect(LBMA_STEPS[3].title.toLowerCase()).toContain('independent audit');
  });
});

describe('LBMA audit pack: AREA_TO_STEP mapping', () => {
  it('Governance → Step 1', () => {
    expect(AREA_TO_STEP.Governance).toBe(1);
  });

  it('Risk Assessment → Step 2', () => {
    expect(AREA_TO_STEP['Risk Assessment']).toBe(2);
  });

  it('CDD / STR / TFS → Step 3 (response strategy)', () => {
    expect(AREA_TO_STEP.CDD).toBe(3);
    expect(AREA_TO_STEP.STR).toBe(3);
    expect(AREA_TO_STEP.TFS).toBe(3);
  });

  it('Records / Training → Step 4 (audit)', () => {
    expect(AREA_TO_STEP.Records).toBe(4);
    expect(AREA_TO_STEP.Training).toBe(4);
  });

  it('DPMS → Step 5 (sourcing disclosure)', () => {
    expect(AREA_TO_STEP.DPMS).toBe(5);
  });
});

describe('LBMA audit pack: assembleSteps', () => {
  it('groups passed and gaps into the correct LBMA step', () => {
    const steps = assembleSteps(fakeInspection);
    expect(steps).toHaveLength(5);
    const step1 = steps[0];
    const step3 = steps[2];
    const step5 = steps[4];

    // Step 1 has GOV-01 passed + GOV-03 gap
    expect(step1.passed.map((p: { id: string }) => p.id)).toContain('GOV-01');
    expect(step1.gaps.map((g: { id: string }) => g.id)).toContain('GOV-03');
    expect(step1.status).toBe('partial');

    // Step 3 has CDD-02 + TFS-02 gaps
    expect(step3.gaps.map((g: { id: string }) => g.id)).toEqual(['CDD-02', 'TFS-02']);

    // Step 5 has DPMS-01 gap only
    expect(step5.gaps.map((g: { id: string }) => g.id)).toEqual(['DPMS-01']);
  });

  it('computes penalty exposure per step', () => {
    const steps = assembleSteps(fakeInspection);
    // Step 3 has CDD-02 (200K) + TFS-02 (500K) = 700K
    expect(steps[2].penaltyExposure).toBe(700_000);
  });

  it('marks fully-passed steps as compliant', () => {
    const inspection = {
      ...fakeInspection,
      gaps: [],
      passed: fakeInspection.passed,
    };
    const steps = assembleSteps(inspection);
    // Steps with any passed items should be compliant; others not-tested
    const withPasses = steps.filter((s: { passed: unknown[] }) => s.passed.length > 0);
    for (const s of withPasses) {
      expect(s.status).toBe('compliant');
    }
  });
});

describe('LBMA audit pack: renderMarkdown', () => {
  const md = renderMarkdown('2026-04-10', fakeInspection, assembleSteps(fakeInspection));

  it('starts with the LBMA RGG v9 header', () => {
    expect(md).toMatch(/^# LBMA Responsible Gold Guidance v9 — Audit Pack/);
  });

  it('includes the generated date', () => {
    expect(md).toContain('**Generated:** 2026-04-10');
  });

  it('lists all five LBMA steps', () => {
    for (let i = 1; i <= 5; i++) {
      expect(md).toContain(`## Step ${i} —`);
    }
  });

  it('includes a remediation plan sorted by penalty', () => {
    expect(md).toContain('## Remediation plan');
    // Scope the ordering check to the remediation plan section only.
    const planIdx = md.indexOf('## Remediation plan');
    const planSection = md.slice(planIdx);
    const tfsIdx = planSection.indexOf('24h freeze');
    const cddIdx = planSection.indexOf('EDD applied');
    expect(tfsIdx).toBeGreaterThan(0);
    expect(cddIdx).toBeGreaterThan(0);
    // TFS-02 (500K) must appear before CDD-02 (200K) in the sorted plan
    expect(tfsIdx).toBeLessThan(cddIdx);
  });

  it('includes the MLRO sign-off block', () => {
    expect(md).toContain('## Sign-off');
    expect(md).toContain('Reviewed by MLRO');
    expect(md).toContain('Approved by Board');
    expect(md).toContain('Filed with independent auditor');
  });

  it('includes overall penalty exposure formatted with thousand separators', () => {
    expect(md).toContain('AED 850,000');
  });
});
