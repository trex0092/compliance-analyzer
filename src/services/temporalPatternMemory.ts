/**
 * Temporal Pattern Memory — per-subject drift detection.
 *
 * Stores the last N verdicts per subject and reports:
 *
 *   - recurrenceCount   — how many alerts in the last 90 days
 *   - confidenceSwing   — spread (max - min) of posteriors
 *   - dismissalStreak   — consecutive prior DISMISS verdicts
 *   - escalationDrift   — trend (first vs last half of the window)
 *   - patternFlags      — named anomalies the MLRO must acknowledge:
 *                          PATTERN_OF_DISMISSAL, CONFIDENCE_VOLATILITY,
 *                          REPEAT_HIT_SURGE, ESCALATION_TREND
 *
 * The module is pure COMPUTATION. The caller is responsible for
 * persistence; the provided `InMemoryPatternStore` is the simplest
 * thing that works for local tests and the dispatcher's hot path when
 * the function has not yet wired the Netlify blob store.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20      CO sees escalation drift, not just current hit
 *   FDL No.10/2025 Art.24      10yr audit retention (caller persists to blobs)
 *   FDL No.10/2025 Art.29      no tipping off — drift flags must not surface
 *                              outside MLRO-only channels
 *   FATF Rec 1                 risk-based approach — drift is a risk signal
 *   EU AI Act Art.14           human oversight — MLRO sees model drift
 *   NIST AI RMF Measure 2.8    drift detection
 *   ISO/IEC 42001 § 6.1.3      AI decision auditability
 */

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type TemporalVerdict = 'FREEZE' | 'ESCALATE' | 'REVIEW' | 'MONITOR' | 'DISMISS';

export interface TemporalVerdictRecord {
  /** ISO timestamp of the decision. */
  observedAtIso: string;
  /** Calibrated posterior at decision time. */
  posterior: number;
  /** Verdict band. */
  verdict: TemporalVerdict;
  /** Optional note captured by the MLRO. */
  note?: string;
}

export type TemporalPatternFlag =
  | 'PATTERN_OF_DISMISSAL'
  | 'CONFIDENCE_VOLATILITY'
  | 'REPEAT_HIT_SURGE'
  | 'ESCALATION_TREND';

export interface TemporalPatternReport {
  subjectId: string;
  sampleSize: number;
  recurrenceCount: number;
  confidenceSwing: number;
  dismissalStreak: number;
  /** >0 when the trend is rising from first half to last half. */
  escalationDrift: number;
  flags: readonly TemporalPatternFlag[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const WINDOW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Analyser
// ---------------------------------------------------------------------------

export function analyseTemporalPattern(
  subjectId: string,
  history: readonly TemporalVerdictRecord[],
  nowIso: string
): TemporalPatternReport {
  const now = Date.parse(nowIso);
  const inWindow: TemporalVerdictRecord[] = [];
  if (Number.isFinite(now)) {
    for (const r of history) {
      const t = Date.parse(r.observedAtIso);
      if (Number.isFinite(t) && now - t <= WINDOW_DAYS * DAY_MS && now - t >= 0) {
        inWindow.push(r);
      }
    }
    inWindow.sort((a, b) => Date.parse(a.observedAtIso) - Date.parse(b.observedAtIso));
  }

  const sampleSize = inWindow.length;
  const recurrenceCount = sampleSize;

  let min = Infinity;
  let max = -Infinity;
  for (const r of inWindow) {
    if (r.posterior < min) min = r.posterior;
    if (r.posterior > max) max = r.posterior;
  }
  const confidenceSwing = sampleSize > 0 ? max - min : 0;

  // Dismissal streak — how many trailing records are DISMISS.
  let dismissalStreak = 0;
  for (let i = inWindow.length - 1; i >= 0; i -= 1) {
    if (inWindow[i].verdict === 'DISMISS') dismissalStreak += 1;
    else break;
  }

  // Escalation drift — compare avg posterior between first and second halves.
  let escalationDrift = 0;
  if (sampleSize >= 4) {
    const mid = Math.floor(sampleSize / 2);
    const firstHalf = inWindow.slice(0, mid);
    const secondHalf = inWindow.slice(mid);
    const avg = (xs: readonly TemporalVerdictRecord[]): number =>
      xs.length > 0 ? xs.reduce((acc, r) => acc + r.posterior, 0) / xs.length : 0;
    escalationDrift = avg(secondHalf) - avg(firstHalf);
  }

  const flags: TemporalPatternFlag[] = [];
  if (dismissalStreak >= 3) flags.push('PATTERN_OF_DISMISSAL');
  if (confidenceSwing >= 0.4) flags.push('CONFIDENCE_VOLATILITY');
  if (recurrenceCount >= 4) flags.push('REPEAT_HIT_SURGE');
  if (escalationDrift >= 0.15) flags.push('ESCALATION_TREND');

  const summary =
    sampleSize === 0
      ? `${subjectId}: no prior verdicts in the ${WINDOW_DAYS}d window`
      : `${subjectId}: n=${sampleSize} swing=${(confidenceSwing * 100).toFixed(0)}pp drift=${(escalationDrift * 100).toFixed(0)}pp dismissStreak=${dismissalStreak} flags=${flags.length > 0 ? flags.join(',') : 'none'}`;

  return {
    subjectId,
    sampleSize,
    recurrenceCount,
    confidenceSwing,
    dismissalStreak,
    escalationDrift,
    flags,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Reference store — in-memory keyed on subjectId. Suitable for tests
// and for dispatcher code paths that have not yet wired a blob store.
// ---------------------------------------------------------------------------

export class InMemoryPatternStore {
  private readonly records = new Map<string, TemporalVerdictRecord[]>();

  record(subjectId: string, r: TemporalVerdictRecord): void {
    const bucket = this.records.get(subjectId) ?? [];
    bucket.push(r);
    this.records.set(subjectId, bucket);
  }

  history(subjectId: string): readonly TemporalVerdictRecord[] {
    return this.records.get(subjectId) ?? [];
  }

  clear(): void {
    this.records.clear();
  }

  analyse(subjectId: string, nowIso: string): TemporalPatternReport {
    return analyseTemporalPattern(subjectId, this.history(subjectId), nowIso);
  }
}
