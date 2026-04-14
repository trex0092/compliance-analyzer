/**
 * Behavioural Velocity Detector — new brain subsystem.
 *
 * Scores three orthogonal velocity signals that the feature-vector-
 * only brain cannot see because they require LOOKING ACROSS CASES
 * in time:
 *
 *   1. Burst detection:  mean inter-case interval is unusually short
 *      compared to the tenant's historical baseline.
 *   2. Off-hours concentration: a high fraction of cases open
 *      outside normal UAE business hours (Sun-Thu 08:00-18:00
 *      Asia/Dubai), a well-documented structuring signal.
 *   3. Weekend clustering: a high fraction of cases open on Friday
 *      or Saturday (UAE weekend), suggesting deliberate avoidance
 *      of MLRO scrutiny.
 *
 * Pure function. Deterministic. No state. Reads a bag of
 * CaseSnapshot objects (sourced from the brain memory store) and
 * returns a VelocityReport with numeric scores + explainability.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO duty — velocity is a diligence signal)
 *   FATF Rec 20              (continuous transaction monitoring)
 *   MoE Circular 08/AML/2021 (DPMS timing-based typologies)
 *   Cabinet Res 134/2025 Art.19 (internal review visibility)
 */

import type { CaseSnapshot } from './crossCasePatternCorrelator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VelocitySignal {
  /** 0..1 — higher = more anomalous. */
  score: number;
  /** Plain-English explanation. */
  description: string;
  /** Data the UI can drill into. */
  data: Record<string, number>;
}

export interface VelocityReport {
  tenantId: string;
  caseCount: number;
  /** 0..1 composite of the three signals; max over components. */
  compositeScore: number;
  /** Severity band derived from compositeScore. */
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  burst: VelocitySignal;
  offHours: VelocitySignal;
  weekend: VelocitySignal;
  /** Summary text safe for the Brain Console + STR narrative. */
  summary: string;
  regulatory: string;
}

export interface VelocityConfig {
  /** Minimum cases required to produce a signal. Default 3. */
  minCases?: number;
  /** Asia/Dubai business-hours window (inclusive). Default 8..18. */
  businessHoursStart?: number;
  businessHoursEnd?: number;
  /** Burst threshold in hours — below this mean interval fires. Default 4. */
  burstThresholdHours?: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function asiaDubaiHour(iso: string): number | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  // Asia/Dubai is UTC+4 year-round (no DST).
  const shifted = new Date(t + 4 * 3_600_000);
  return shifted.getUTCHours();
}

function asiaDubaiDayOfWeek(iso: string): number | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const shifted = new Date(t + 4 * 3_600_000);
  // 0 = Sunday, 5 = Friday, 6 = Saturday. UAE weekend = Fri + Sat.
  return shifted.getUTCDay();
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function severityOf(score: number): VelocityReport['severity'] {
  if (score >= 0.85) return 'critical';
  if (score >= 0.7) return 'high';
  if (score >= 0.5) return 'medium';
  if (score >= 0.3) return 'low';
  return 'info';
}

// ---------------------------------------------------------------------------
// Signal detectors
// ---------------------------------------------------------------------------

function computeBurst(cases: readonly CaseSnapshot[], burstThresholdHours: number): VelocitySignal {
  if (cases.length < 2) {
    return {
      score: 0,
      description: 'Insufficient cases for burst detection (need at least 2).',
      data: { caseCount: cases.length, meanIntervalHours: 0 },
    };
  }
  const times = cases
    .map((c) => Date.parse(c.openedAt))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (times.length < 2) {
    return {
      score: 0,
      description: 'Case timestamps could not be parsed.',
      data: { caseCount: cases.length, meanIntervalHours: 0 },
    };
  }
  let totalDelta = 0;
  for (let i = 1; i < times.length; i++) totalDelta += times[i] - times[i - 1];
  const meanIntervalMs = totalDelta / (times.length - 1);
  const meanIntervalHours = meanIntervalMs / 3_600_000;
  // Score: linearly mapped from burstThreshold → 0 down to 0 → 1.
  const score = clamp01(1 - meanIntervalHours / burstThresholdHours);
  return {
    score,
    description:
      score >= 0.5
        ? `Mean inter-case interval ${meanIntervalHours.toFixed(2)}h is below the ${burstThresholdHours}h burst threshold — tenant is opening cases unusually fast.`
        : `Mean inter-case interval ${meanIntervalHours.toFixed(2)}h is within expected cadence.`,
    data: {
      caseCount: cases.length,
      meanIntervalHours: Number(meanIntervalHours.toFixed(3)),
      burstThresholdHours,
    },
  };
}

function computeOffHours(
  cases: readonly CaseSnapshot[],
  businessHoursStart: number,
  businessHoursEnd: number
): VelocitySignal {
  let offHours = 0;
  let counted = 0;
  for (const c of cases) {
    const h = asiaDubaiHour(c.openedAt);
    if (h === null) continue;
    counted += 1;
    if (h < businessHoursStart || h > businessHoursEnd) offHours += 1;
  }
  if (counted === 0) {
    return {
      score: 0,
      description: 'No parseable timestamps for off-hours analysis.',
      data: { counted: 0, offHours: 0, fraction: 0 },
    };
  }
  const fraction = offHours / counted;
  // Score: 0 at ≤25% off-hours (normal), linearly up to 1 at 100%.
  const score = clamp01((fraction - 0.25) / 0.75);
  return {
    score,
    description:
      score >= 0.5
        ? `${(fraction * 100).toFixed(0)}% of cases opened outside Asia/Dubai business hours (${businessHoursStart}:00-${businessHoursEnd}:00) — elevated MLRO-avoidance signal.`
        : `${(fraction * 100).toFixed(0)}% of cases opened outside business hours — within normal range.`,
    data: {
      counted,
      offHours,
      fraction: Number(fraction.toFixed(3)),
    },
  };
}

function computeWeekend(cases: readonly CaseSnapshot[]): VelocitySignal {
  let weekend = 0;
  let counted = 0;
  for (const c of cases) {
    const d = asiaDubaiDayOfWeek(c.openedAt);
    if (d === null) continue;
    counted += 1;
    if (d === 5 || d === 6) weekend += 1; // Fri or Sat (UAE weekend)
  }
  if (counted === 0) {
    return {
      score: 0,
      description: 'No parseable timestamps for weekend analysis.',
      data: { counted: 0, weekend: 0, fraction: 0 },
    };
  }
  const fraction = weekend / counted;
  // Score: 0 at ≤15% weekend (baseline noise), up to 1 at 80%+.
  const score = clamp01((fraction - 0.15) / 0.65);
  return {
    score,
    description:
      score >= 0.5
        ? `${(fraction * 100).toFixed(0)}% of cases opened on UAE weekend (Fri-Sat) — elevated clustering signal.`
        : `${(fraction * 100).toFixed(0)}% of cases opened on UAE weekend — within normal range.`,
    data: {
      counted,
      weekend,
      fraction: Number(fraction.toFixed(3)),
    },
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Required<Omit<VelocityConfig, 'minCases'>> & { minCases: number } = {
  minCases: 3,
  businessHoursStart: 8,
  businessHoursEnd: 18,
  burstThresholdHours: 4,
};

export function analyseBehaviouralVelocity(
  tenantId: string,
  cases: readonly CaseSnapshot[],
  cfg: VelocityConfig = {}
): VelocityReport {
  const full = {
    minCases: cfg.minCases ?? DEFAULT_CONFIG.minCases,
    businessHoursStart: cfg.businessHoursStart ?? DEFAULT_CONFIG.businessHoursStart,
    businessHoursEnd: cfg.businessHoursEnd ?? DEFAULT_CONFIG.businessHoursEnd,
    burstThresholdHours: cfg.burstThresholdHours ?? DEFAULT_CONFIG.burstThresholdHours,
  };

  const scoped = cases.filter((c) => c.tenantId === tenantId);

  if (scoped.length < full.minCases) {
    const zero: VelocitySignal = {
      score: 0,
      description: `Velocity analysis needs at least ${full.minCases} cases; only ${scoped.length} present.`,
      data: { caseCount: scoped.length },
    };
    return {
      tenantId,
      caseCount: scoped.length,
      compositeScore: 0,
      severity: 'info',
      burst: zero,
      offHours: zero,
      weekend: zero,
      summary: `Behavioural velocity: insufficient history (${scoped.length} cases < ${full.minCases} minimum).`,
      regulatory: 'FATF Rec 20; MoE Circular 08/AML/2021; FDL Art.20-21',
    };
  }

  const burst = computeBurst(scoped, full.burstThresholdHours);
  const offHours = computeOffHours(scoped, full.businessHoursStart, full.businessHoursEnd);
  const weekend = computeWeekend(scoped);
  const compositeScore = Math.max(burst.score, offHours.score, weekend.score);
  const severity = severityOf(compositeScore);

  const summary =
    severity === 'info'
      ? `Behavioural velocity clean across ${scoped.length} cases.`
      : `Behavioural velocity ${severity.toUpperCase()} — composite ${(compositeScore * 100).toFixed(0)}% across ${scoped.length} cases. Burst ${(burst.score * 100).toFixed(0)}%, off-hours ${(offHours.score * 100).toFixed(0)}%, weekend ${(weekend.score * 100).toFixed(0)}%.`;

  return {
    tenantId,
    caseCount: scoped.length,
    compositeScore,
    severity,
    burst,
    offHours,
    weekend,
    summary,
    regulatory:
      'FATF Rec 20; MoE Circular 08/AML/2021; FDL No.10/2025 Art.20-21; Cabinet Res 134/2025 Art.19',
  };
}

// Exports for tests.
export const __test__ = {
  asiaDubaiHour,
  asiaDubaiDayOfWeek,
  clamp01,
  severityOf,
  computeBurst,
  computeOffHours,
  computeWeekend,
};
