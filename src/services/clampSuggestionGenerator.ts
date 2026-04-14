/**
 * Clamp Suggestion Generator — derives pending clamp-tuning
 * suggestions from the brain telemetry store.
 *
 * Why this exists:
 *   buildClampSuggestion in clampSuggestionLog.ts produces a
 *   suggestion from an EvidenceSignal { truePositive, falsePositive,
 *   falseNegative, totalCases }. Today that function is only
 *   reachable via /api/brain/clamp-suggestion `propose` — callers
 *   have to hand-feed the evidence counts. That is fine for ad-hoc
 *   review but cannot produce trend-driven suggestions.
 *
 *   This generator bridges BrainTelemetryStore entries to
 *   EvidenceSignal tuples. It walks a date range of telemetry,
 *   interprets verdict + ensembleUnstable + driftSeverity +
 *   requiresHumanReview as proxy labels, and produces candidate
 *   suggestions ready to append to ClampSuggestionBlobStore.
 *
 *   Deliberately conservative. We DO NOT claim to know ground
 *   truth — the generator only flags high-FP / high-FN regimes
 *   inferred from the telemetry patterns, and every suggestion
 *   still lands as pending_mlro_review. Never auto-applied.
 *
 * Proxy label mapping (this is a trade-off, documented):
 *   falsePositive  <= verdicts where the brain flagged/escalated
 *                     AND ensembleUnstable=true (the brain itself
 *                     signalled boundary uncertainty). Treating
 *                     ensemble instability as a proxy for FP.
 *   falseNegative  <= verdicts where the brain PASSED but had a
 *                     non-zero typology matches OR critical drift
 *                     severity (signals a potential miss).
 *   truePositive   <= verdicts where the brain flagged/escalated
 *                     with ensemble stability high and no drift.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO trend-aware monitoring)
 *   Cabinet Res 134/2025 Art.19 (internal review input)
 *   FATF Rec 20
 *   NIST AI RMF 1.0 MEASURE-2 + GOVERN-4
 */

import type { BrainTelemetryEntry } from './brainTelemetryStore';
import {
  buildClampSuggestion,
  type ClampKey,
  type ClampSuggestion,
  type EvidenceSignal,
} from './clampSuggestionLog';
import { DPMS_CASH_THRESHOLD_AED, CROSS_BORDER_CASH_THRESHOLD_AED } from '../domain/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeneratorResult {
  /** Evidence aggregated across the telemetry window. */
  evidence: EvidenceSignal;
  /** Derived suggestions (may be empty). */
  suggestions: readonly ClampSuggestion[];
  /** Plain-English summary. */
  summary: string;
}

// ---------------------------------------------------------------------------
// Telemetry -> Evidence
// ---------------------------------------------------------------------------

/**
 * Convert a telemetry window into an EvidenceSignal. Pure function;
 * no state, no I/O. Tests feed synthetic telemetry to pin the
 * label-proxy logic.
 */
export function evidenceFromTelemetry(entries: readonly BrainTelemetryEntry[]): EvidenceSignal {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let totalCases = 0;
  for (const e of entries) {
    if (!e || typeof e.verdict !== 'string') continue;
    totalCases += 1;
    const flagged = e.verdict === 'flag' || e.verdict === 'escalate' || e.verdict === 'freeze';
    const passed = e.verdict === 'pass';
    if (flagged && e.ensembleUnstable) {
      falsePositive += 1;
    } else if (
      passed &&
      (e.typologyIds.length > 0 || e.driftSeverity === 'high' || e.driftSeverity === 'critical')
    ) {
      falseNegative += 1;
    } else if (flagged && !e.ensembleUnstable && e.driftSeverity === 'none') {
      truePositive += 1;
    }
  }
  return { truePositive, falsePositive, falseNegative, totalCases };
}

// ---------------------------------------------------------------------------
// Per-clamp generator inputs
// ---------------------------------------------------------------------------

interface ClampDescriptor {
  key: ClampKey;
  currentValue: number;
  minValue: number;
  maxValue: number;
  step: number;
  regulatory: string;
}

function clampDescriptors(): readonly ClampDescriptor[] {
  return [
    {
      key: 'sanctionsMatchMin',
      currentValue: 0.5,
      minValue: 0.1,
      maxValue: 0.95,
      step: 0.05,
      regulatory: 'FDL No.10/2025 Art.35',
    },
    {
      key: 'debateThreshold',
      currentValue: 0.15,
      minValue: 0.05,
      maxValue: 0.5,
      step: 0.02,
      regulatory: 'FDL No.10/2025 Art.20-21',
    },
    {
      key: 'uncertaintyCriticalWidth',
      currentValue: 0.35,
      minValue: 0.1,
      maxValue: 0.6,
      step: 0.05,
      regulatory: 'NIST AI RMF 1.0 MEASURE-2',
    },
    {
      key: 'ensembleStabilityThreshold',
      currentValue: 0.8,
      minValue: 0.5,
      maxValue: 0.95,
      step: 0.05,
      regulatory: 'FATF Rec 20',
    },
    {
      key: 'dpmsCashThresholdAED',
      currentValue: DPMS_CASH_THRESHOLD_AED,
      minValue: DPMS_CASH_THRESHOLD_AED, // locked, generator cannot propose
      maxValue: DPMS_CASH_THRESHOLD_AED,
      step: 0, // no movement — regulatory hard threshold
      regulatory: 'MoE Circular 08/AML/2021',
    },
    {
      key: 'crossBorderCashThresholdAED',
      currentValue: CROSS_BORDER_CASH_THRESHOLD_AED,
      minValue: CROSS_BORDER_CASH_THRESHOLD_AED,
      maxValue: CROSS_BORDER_CASH_THRESHOLD_AED,
      step: 0,
      regulatory: 'FDL No.10/2025 Art.17',
    },
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GenerateOptions {
  /** Clock injection for tests. */
  now?: () => Date;
}

/**
 * Run the generator over a telemetry window. Returns the aggregated
 * evidence + any suggestions the builder emitted. Clamps with
 * step===0 are hard regulatory thresholds and are never proposed
 * — the generator skips them even under extreme FP/FN.
 */
export function generateClampSuggestions(
  entries: readonly BrainTelemetryEntry[],
  opts: GenerateOptions = {}
): GeneratorResult {
  const evidence = evidenceFromTelemetry(entries);
  const suggestions: ClampSuggestion[] = [];

  for (const d of clampDescriptors()) {
    if (d.step <= 0) continue;
    const s = buildClampSuggestion({
      clampKey: d.key,
      currentValue: d.currentValue,
      minValue: d.minValue,
      maxValue: d.maxValue,
      step: d.step,
      regulatory: d.regulatory,
      evidence,
      now: opts.now,
    });
    if (s) suggestions.push(s);
  }

  const summary =
    suggestions.length === 0
      ? `Telemetry window scanned (${entries.length} entries, ` +
        `${evidence.totalCases} cases). No clamp movement warranted.`
      : `Telemetry window scanned (${entries.length} entries, ` +
        `${evidence.totalCases} cases). ${suggestions.length} pending ` +
        `MLRO review suggestion(s) emitted.`;

  return { evidence, suggestions, summary };
}

// Exports for tests.
export const __test__ = { clampDescriptors };
