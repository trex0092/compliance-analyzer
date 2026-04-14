/**
 * Clamp suggestion generator tests.
 */
import { describe, it, expect } from 'vitest';
import {
  evidenceFromTelemetry,
  generateClampSuggestions,
  __test__,
} from '../src/services/clampSuggestionGenerator';
import type { BrainTelemetryEntry } from '../src/services/brainTelemetryStore';
import { __test__ as cronTest } from '../netlify/functions/brain-clamp-cron.mts';

const { clampDescriptors } = __test__;

function entry(overrides: Partial<BrainTelemetryEntry> = {}): BrainTelemetryEntry {
  return {
    tsIso: '2026-04-14T12:00:00.000Z',
    tenantId: 'tA',
    entityRef: 'opaque',
    verdict: 'flag',
    confidence: 0.7,
    powerScore: 50,
    brainVerdict: 'flag',
    ensembleUnstable: false,
    typologyIds: [],
    crossCaseFindingCount: 0,
    velocitySeverity: null,
    driftSeverity: 'none',
    requiresHumanReview: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// evidenceFromTelemetry
// ---------------------------------------------------------------------------

describe('evidenceFromTelemetry', () => {
  it('empty window yields zero counts', () => {
    const e = evidenceFromTelemetry([]);
    expect(e.totalCases).toBe(0);
    expect(e.falsePositive).toBe(0);
  });

  it('counts flag+ensembleUnstable as falsePositive', () => {
    const e = evidenceFromTelemetry([
      entry({ verdict: 'flag', ensembleUnstable: true }),
      entry({ verdict: 'escalate', ensembleUnstable: true }),
    ]);
    expect(e.falsePositive).toBe(2);
  });

  it('counts pass+typologyIds as falseNegative', () => {
    const e = evidenceFromTelemetry([entry({ verdict: 'pass', typologyIds: ['fatf-tm-1'] })]);
    expect(e.falseNegative).toBe(1);
  });

  it('counts pass+criticalDrift as falseNegative', () => {
    const e = evidenceFromTelemetry([entry({ verdict: 'pass', driftSeverity: 'critical' })]);
    expect(e.falseNegative).toBe(1);
  });

  it('counts stable flag/escalate as truePositive', () => {
    const e = evidenceFromTelemetry([
      entry({ verdict: 'flag', ensembleUnstable: false, driftSeverity: 'none' }),
      entry({ verdict: 'escalate', ensembleUnstable: false, driftSeverity: 'none' }),
    ]);
    expect(e.truePositive).toBe(2);
  });

  it('totalCases counts every valid entry', () => {
    const e = evidenceFromTelemetry([entry(), entry(), entry()]);
    expect(e.totalCases).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// generateClampSuggestions
// ---------------------------------------------------------------------------

describe('generateClampSuggestions', () => {
  it('empty telemetry produces zero suggestions', () => {
    const r = generateClampSuggestions([]);
    expect(r.suggestions).toHaveLength(0);
    expect(r.summary).toMatch(/No clamp movement warranted/);
  });

  it('high FP rate produces raise suggestions', () => {
    const entries: BrainTelemetryEntry[] = [];
    for (let i = 0; i < 100; i++) {
      entries.push(
        entry({ verdict: 'flag', ensembleUnstable: i < 40 }) // 40% FP
      );
    }
    const r = generateClampSuggestions(entries);
    expect(r.suggestions.length).toBeGreaterThan(0);
    for (const s of r.suggestions) {
      expect(s.proposedValue).toBeGreaterThan(s.currentValue);
      expect(s.status).toBe('pending_mlro_review');
    }
  });

  it('high FN rate produces reduce suggestions', () => {
    const entries: BrainTelemetryEntry[] = [];
    for (let i = 0; i < 100; i++) {
      entries.push(
        entry({
          verdict: 'pass',
          typologyIds: i < 20 ? ['fatf-tm-1'] : [], // 20% FN
        })
      );
    }
    const r = generateClampSuggestions(entries);
    expect(r.suggestions.length).toBeGreaterThan(0);
    for (const s of r.suggestions) {
      expect(s.proposedValue).toBeLessThan(s.currentValue);
    }
  });

  it('never proposes for locked regulatory thresholds', () => {
    const entries: BrainTelemetryEntry[] = [];
    for (let i = 0; i < 100; i++) {
      entries.push(entry({ verdict: 'flag', ensembleUnstable: true }));
    }
    const r = generateClampSuggestions(entries);
    const dpms = r.suggestions.find((s) => s.clampKey === 'dpmsCashThresholdAED');
    const border = r.suggestions.find((s) => s.clampKey === 'crossBorderCashThresholdAED');
    expect(dpms).toBeUndefined();
    expect(border).toBeUndefined();
  });
});

describe('clampDescriptors', () => {
  it('regulatory thresholds have step=0 (locked)', () => {
    const ds = clampDescriptors();
    const dpms = ds.find((d) => d.key === 'dpmsCashThresholdAED');
    const border = ds.find((d) => d.key === 'crossBorderCashThresholdAED');
    expect(dpms!.step).toBe(0);
    expect(border!.step).toBe(0);
  });
  it('tunable clamps have positive step', () => {
    const ds = clampDescriptors();
    const tunable = ds.filter(
      (d) => d.key !== 'dpmsCashThresholdAED' && d.key !== 'crossBorderCashThresholdAED'
    );
    for (const d of tunable) expect(d.step).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// brain-clamp-cron helpers
// ---------------------------------------------------------------------------

describe('brain-clamp-cron helpers', () => {
  it('parseTenants splits and trims', () => {
    expect(cronTest.parseTenants('tA, tB ,tC')).toEqual(['tA', 'tB', 'tC']);
  });
  it('parseTenants drops empty entries', () => {
    expect(cronTest.parseTenants('tA,,tB')).toEqual(['tA', 'tB']);
  });
  it('parseTenants returns empty on undefined', () => {
    expect(cronTest.parseTenants(undefined)).toEqual([]);
  });
  it('parseTenants caps at 64 chars', () => {
    expect(cronTest.parseTenants('x'.repeat(65))).toEqual([]);
  });
  it('dayIsoOffset subtracts days correctly', () => {
    const base = new Date('2026-04-14T12:00:00.000Z');
    expect(cronTest.dayIsoOffset(base, 0)).toBe('2026-04-14');
    expect(cronTest.dayIsoOffset(base, -7)).toBe('2026-04-07');
  });
  it('DEFAULT_LOOKBACK_DAYS is 7', () => {
    expect(cronTest.DEFAULT_LOOKBACK_DAYS).toBe(7);
  });
});
