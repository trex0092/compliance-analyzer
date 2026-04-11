/**
 * Temporal Pattern Detector — 90-day sliding window pattern detector.
 *
 * Phase 2 weaponization subsystem #26.
 *
 * Many AML/CFT red flags only emerge across time: structuring over weeks,
 * CDD decay, repeat alerts for the same entity, seasonality in cash
 * deposits. The temporal pattern detector scans a configurable window
 * (default 90 days per FATF Rec 10 and Cabinet Res 134/2025 Art.7-10)
 * and flags three specific patterns:
 *
 *   1. Repeat-alert pattern — same entity flagged 3+ times in the window
 *   2. Escalating-severity pattern — severity of flags is trending up
 *   3. Burst pattern — more than N flags in a single day (max 1/day norm)
 *
 * This feeds causalEngine (MegaBrain subsystem #4) with longitudinal
 * context that the single-shot subsystems miss.
 *
 * Regulatory basis:
 *   - FATF Rec 10 (ongoing monitoring)
 *   - Cabinet Res 134/2025 Art.7-10 (CDD tiers + periodic review)
 *   - MoE Circular 08/AML/2021 (transaction monitoring)
 */

import { DEFAULT_CLAMP_POLICY, type ClampPolicy } from './clampPolicy';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TemporalEvent {
  entityId: string;
  /** ISO timestamp. */
  at: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  kind: string;
}

export interface TemporalPatternReport {
  entityId: string;
  windowDays: number;
  hasRepeatPattern: boolean;
  repeatCount: number;
  hasEscalatingPattern: boolean;
  hasBurstPattern: boolean;
  burstDay?: string;
  burstCount?: number;
  /** Overall pattern strength in [0,1]. */
  strength: number;
  narrative: string;
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<TemporalEvent['severity'], number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export function detectTemporalPatterns(
  events: readonly TemporalEvent[],
  entityId: string,
  referenceDate: Date = new Date(),
  policy: Readonly<ClampPolicy> = DEFAULT_CLAMP_POLICY
): TemporalPatternReport {
  const windowMs = policy.temporalWindowDays * 24 * 60 * 60 * 1000;
  const windowStart = referenceDate.getTime() - windowMs;

  const inWindow = events
    .filter((e) => e.entityId === entityId)
    .map((e) => ({ ...e, atMs: Date.parse(e.at) }))
    .filter((e) => Number.isFinite(e.atMs) && e.atMs >= windowStart)
    .sort((a, b) => a.atMs - b.atMs);

  const repeatCount = inWindow.length;
  const hasRepeatPattern = repeatCount >= 3;

  // Escalating: severity rank is non-decreasing and at least one step up.
  let hasEscalatingPattern = false;
  if (inWindow.length >= 2) {
    let nonDecreasing = true;
    let sawIncrease = false;
    for (let i = 1; i < inWindow.length; i++) {
      const prev = SEVERITY_RANK[inWindow[i - 1].severity];
      const curr = SEVERITY_RANK[inWindow[i].severity];
      if (curr < prev) {
        nonDecreasing = false;
        break;
      }
      if (curr > prev) sawIncrease = true;
    }
    hasEscalatingPattern = nonDecreasing && sawIncrease;
  }

  // Burst: more than 1 event on a single day (UTC).
  const byDay = new Map<string, number>();
  for (const ev of inWindow) {
    const day = new Date(ev.atMs).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  let burstDay: string | undefined;
  let burstCount: number | undefined;
  for (const [day, count] of byDay.entries()) {
    if (count >= 2 && (!burstCount || count > burstCount)) {
      burstDay = day;
      burstCount = count;
    }
  }
  const hasBurstPattern = !!burstCount;

  // Strength: weighted sum normalised to [0,1].
  let strength = 0;
  if (hasRepeatPattern) strength += 0.4;
  if (hasEscalatingPattern) strength += 0.3;
  if (hasBurstPattern) strength += 0.3;

  const parts: string[] = [];
  if (hasRepeatPattern) parts.push(`${repeatCount} events in window`);
  if (hasEscalatingPattern) parts.push('severity escalating');
  if (hasBurstPattern) parts.push(`burst on ${burstDay} (${burstCount} events)`);

  const narrative =
    parts.length === 0
      ? `Temporal pattern detector: no material patterns in the last ${policy.temporalWindowDays} days.`
      : `Temporal pattern detector (${policy.temporalWindowDays}d window): ${parts.join(', ')}.`;

  return {
    entityId,
    windowDays: policy.temporalWindowDays,
    hasRepeatPattern,
    repeatCount,
    hasEscalatingPattern,
    hasBurstPattern,
    burstDay,
    burstCount,
    strength,
    narrative,
  };
}
