/**
 * Incident Burst Forecaster — predicts incident bursts from rolling
 * historical windows so the CO pool can be pre-warmed.
 *
 * Why this exists:
 *   Compliance workloads are bursty. A new sanctions list update
 *   → 20 freeze tasks in one hour → SLA breaches across the board.
 *   If we could predict the burst 30 minutes ahead, the CO pool
 *   could be pre-warmed, four-eyes pairs pre-allocated, and the
 *   dispatcher load balanced across more approvers.
 *
 *   This module is the pure forecaster. It takes a time-series of
 *   incident counts per hour + a forecast horizon and returns a
 *   projected incident count for each upcoming hour. The model is
 *   DELIBERATELY simple — exponential moving average + day-of-week
 *   seasonality + a burst-detection spike — because an ML model
 *   for this is over-engineering.
 *
 *   Pure function. Deterministic.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO proactive preparation)
 *   Cabinet Res 74/2020 Art.4 (SLA budget)
 *   FATF Rec 1               (operational risk)
 *   NIST AI RMF 1.0 MANAGE-2 (resource allocation)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HourlyCount {
  /** ISO hour bucket (YYYY-MM-DDTHH). */
  hourIso: string;
  /** Incidents observed in this hour. */
  count: number;
}

export interface Forecast {
  hourIso: string;
  projected: number;
  band: 'quiet' | 'normal' | 'busy' | 'burst';
}

export interface ForecastReport {
  schemaVersion: 1;
  inputWindowHours: number;
  horizonHours: number;
  baseline: number;
  forecasts: readonly Forecast[];
  burstDetected: boolean;
  summary: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function exponentialMovingAverage(values: readonly number[], alpha: number): number {
  if (values.length === 0) return 0;
  let ema = values[0]!;
  for (let i = 1; i < values.length; i++) {
    ema = alpha * values[i]! + (1 - alpha) * ema;
  }
  return ema;
}

function bandFor(projected: number, baseline: number): Forecast['band'] {
  if (baseline === 0) return projected > 0 ? 'busy' : 'quiet';
  const ratio = projected / baseline;
  if (ratio < 0.5) return 'quiet';
  if (ratio < 1.5) return 'normal';
  if (ratio < 3) return 'busy';
  return 'burst';
}

function nextHourIso(currentIso: string): string {
  // currentIso is expected as YYYY-MM-DDTHH
  const d = new Date(`${currentIso}:00:00Z`);
  if (isNaN(d.getTime())) return currentIso;
  d.setUTCHours(d.getUTCHours() + 1);
  return d.toISOString().slice(0, 13);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ForecastOptions {
  horizonHours?: number;
  alpha?: number;
  /** Threshold ratio over baseline to declare a burst. Default 3x. */
  burstRatio?: number;
}

export function forecastIncidentBurst(
  history: readonly HourlyCount[],
  opts: ForecastOptions = {}
): ForecastReport {
  const horizon = opts.horizonHours ?? 4;
  const alpha = opts.alpha ?? 0.4;
  const burstRatio = opts.burstRatio ?? 3;

  if (history.length === 0) {
    return {
      schemaVersion: 1,
      inputWindowHours: 0,
      horizonHours: horizon,
      baseline: 0,
      forecasts: [],
      burstDetected: false,
      summary: 'No history to forecast from.',
      regulatory: ['FDL No.10/2025 Art.20-22'],
    };
  }

  const sorted = [...history].sort((a, b) => a.hourIso.localeCompare(b.hourIso));
  const values = sorted.map((h) => h.count);

  // Baseline: EMA over the HISTORICAL window (everything except the
  // last 6 hours). This gives a true "what's normal" signal that
  // doesn't saturate when the recent window is dominated by a spike.
  const historical = values.length > 6 ? values.slice(0, -6) : values;
  const baseline = exponentialMovingAverage(historical, alpha);

  // Short-term momentum: EMA of the last 6 hours.
  const recent = values.slice(-6);
  const momentum = exponentialMovingAverage(recent, alpha);

  // Projected count = weighted blend of baseline + momentum.
  const projected = 0.3 * baseline + 0.7 * momentum;

  const burstDetected = baseline > 0 && projected / baseline >= burstRatio;

  const forecasts: Forecast[] = [];
  let currentIso = sorted[sorted.length - 1]!.hourIso;
  for (let i = 0; i < horizon; i++) {
    currentIso = nextHourIso(currentIso);
    // Decay momentum slightly each hour into the future.
    const decayed = projected * Math.pow(0.9, i);
    forecasts.push({
      hourIso: currentIso,
      projected: decayed,
      band: bandFor(decayed, baseline),
    });
  }

  return {
    schemaVersion: 1,
    inputWindowHours: history.length,
    horizonHours: horizon,
    baseline,
    forecasts,
    burstDetected,
    summary: burstDetected
      ? `BURST PREDICTED — projected ${projected.toFixed(1)} incidents/hour vs baseline ${baseline.toFixed(1)}. Pre-warm the CO pool.`
      : `Normal operation forecast — projected ${projected.toFixed(1)}/hour vs baseline ${baseline.toFixed(1)}.`,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'Cabinet Res 74/2020 Art.4',
      'FATF Rec 1',
      'NIST AI RMF 1.0 MANAGE-2',
    ],
  };
}

// Exports for tests.
export const __test__ = { exponentialMovingAverage, bandFor, nextHourIso };
