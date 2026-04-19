/**
 * Temporal Decay — age-weights the evidence contributing to the
 * calibrated posterior.
 *
 * A sanctions designation added yesterday carries very different
 * decision weight from the same designation reconfirmed unchanged for
 * the past seven years. Likewise, an AMENDMENT event observed this
 * morning is materially more actionable than an amendment observed
 * three months ago. The existing composite score treats both as equal
 * weight — this module produces a multiplier that the dispatcher can
 * apply to the log-odds delta so recency is baked into the audit
 * trail.
 *
 * We deliberately do NOT decay the PIN signal — an MLRO designation
 * pin is a point-in-time decision that remains authoritative until
 * explicitly revoked.
 *
 * Regulatory basis:
 *   FATF Rec 10              positive ID — recent confirmation weighs more
 *   FDL No.10/2025 Art.20    ongoing monitoring must be TIME-SENSITIVE
 *   FDL No.10/2025 Art.24    10yr retention — but recency still matters
 *   Cabinet Res 134/2025 Art.19 periodic internal review cadence
 */

export interface TemporalDecayInput {
  /** When this evidence was observed (ISO). */
  observedAtIso: string;
  /** When the scoring run fired (ISO). */
  nowIso: string;
  /**
   * Half-life in days. A 90-day half-life means evidence 90 days old
   * is half-weighted, 180 days old is quarter-weighted, etc.
   */
  halfLifeDays?: number;
}

/**
 * Default half-life = 90 days. Matches the standard DPMS CDD refresh
 * cadence for EDD customers; outside that window, the MLRO should be
 * revisiting the underlying evidence anyway.
 */
const DEFAULT_HALF_LIFE_DAYS = 90;

/**
 * Exponential decay multiplier. Returns a number in (0, 1] — fresh
 * evidence is 1.0, everything older attenuates toward 0. Never returns
 * 0; we want even old evidence to contribute SOMETHING so the audit
 * trail doesn't silently lose it.
 */
export function temporalDecayMultiplier(input: TemporalDecayInput): number {
  const observed = Date.parse(input.observedAtIso);
  const now = Date.parse(input.nowIso);
  if (!Number.isFinite(observed) || !Number.isFinite(now)) return 1;
  const ageMs = Math.max(0, now - observed);
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  const halfLife = input.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
  if (halfLife <= 0) return 1;
  // 2^(-ageDays/halfLife) — exponential decay with half-life parameter.
  const m = Math.pow(2, -ageDays / halfLife);
  // Floor at 0.05 so ten-year-old evidence still counts as a whisper.
  return Math.max(0.05, m);
}

/**
 * Categorical freshness label for the Asana notes — makes the decay
 * visible to the MLRO without forcing them to read the numeric
 * multiplier.
 */
export function describeFreshness(multiplier: number): string {
  if (multiplier >= 0.9) return 'fresh';
  if (multiplier >= 0.6) return 'recent';
  if (multiplier >= 0.3) return 'ageing';
  if (multiplier >= 0.1) return 'stale';
  return 'legacy';
}

/**
 * Convert an age in days to a floor-safe freshness label — useful for
 * the audit trace when the raw multiplier is already computed.
 */
export function freshnessForAgeDays(ageDays: number, halfLifeDays = DEFAULT_HALF_LIFE_DAYS): string {
  const m = Math.max(0.05, Math.pow(2, -Math.max(0, ageDays) / halfLifeDays));
  return describeFreshness(m);
}
