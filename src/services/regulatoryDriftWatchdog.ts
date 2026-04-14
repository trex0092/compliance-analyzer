/**
 * Regulatory Drift Watchdog — detects when the regulatory constants
 * the brain is CURRENTLY USING diverge from what was considered
 * "authoritative" at the time of the last MLRO sign-off.
 *
 * Why this exists:
 *   - src/domain/constants.ts is the single source of truth for every
 *     AED threshold, deadline, and retention period.
 *   - REGULATORY_CONSTANTS_VERSION is bumped whenever a constant
 *     changes, but nothing ACTIVELY alerts the MLRO when a drift
 *     happens between two brain runs.
 *   - A silent drift (e.g. someone updating DPMS_CASH_THRESHOLD_AED
 *     from 55_000 to 50_000 in a PR) can silently invalidate every
 *     compliance decision produced after the change. Regulators
 *     expect an auditable trail proving the brain ran against the
 *     correct version on every case.
 *
 * This watchdog is a pure function — it takes a "baseline" snapshot
 * (what the MLRO signed off) and the current constants, and returns
 * a DriftReport describing exactly which values changed, with
 * regulatory citations and severity.
 *
 * Integration points (future commits):
 *   - brainSuperRunner can call checkRegulatoryDrift() before every
 *     decision and attach the report to the response.
 *   - A cron job can write the current snapshot every day and diff
 *     against yesterday, auto-filing an Asana incident on any drift.
 *   - The Brain Console can show a "Drift Status" card with the
 *     current version + last-signed-off version + drift count.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-24 (CO duty + audit trail + reconstruction)
 *   Cabinet Res 134/2025 Art.19 (internal review before decision)
 *   FATF Rec 20 (continuous monitoring)
 *   MoE Circular 08/AML/2021 (DPMS compliance programme)
 */

import {
  DPMS_CASH_THRESHOLD_AED,
  CROSS_BORDER_CASH_THRESHOLD_AED,
  UBO_OWNERSHIP_THRESHOLD_PCT,
  STR_FILING_DEADLINE_BUSINESS_DAYS,
  CTR_FILING_DEADLINE_BUSINESS_DAYS,
  CNMR_FILING_DEADLINE_BUSINESS_DAYS,
  EOCN_FREEZE_IMMEDIATELY,
  RECORD_RETENTION_YEARS,
  UBO_REVERIFICATION_WORKING_DAYS,
  REGULATORY_CONSTANTS_VERSION,
} from '../domain/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A named regulatory constant that the watchdog tracks. Every tracked
 * constant MUST have a regulatory citation + severity so drift can be
 * routed to the correct owner.
 */
export type TrackedValue = number | boolean;

export interface TrackedConstant {
  /** Stable key — used in the drift report. */
  key: string;
  /** Current value from constants.ts. */
  current: TrackedValue;
  /** Regulatory citation owning this value. */
  regulatory: string;
  /** Severity when this constant drifts. */
  severity: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * A snapshot of every tracked constant + the regulatory constants
 * version at a point in time. The MLRO signs off on a snapshot
 * when they approve the current regulatory interpretation; the
 * watchdog diffs future runs against this baseline.
 */
export interface RegulatoryBaseline {
  version: string;
  capturedAtIso: string;
  values: Record<string, TrackedValue>;
}

/** A single drift finding. */
export interface DriftFinding {
  key: string;
  previous: TrackedValue | null;
  current: TrackedValue;
  delta: number | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  regulatory: string;
  description: string;
}

export interface DriftReport {
  /** True when the snapshot exactly matches the baseline. */
  clean: boolean;
  /** Detected version mismatch — highest-level signal. */
  versionDrifted: boolean;
  /** Baseline version (what MLRO signed off). */
  baselineVersion: string;
  /** Current version from constants.ts. */
  currentVersion: string;
  /** Per-key findings (empty when clean). */
  findings: readonly DriftFinding[];
  /** Top severity across all findings. */
  topSeverity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  /** Plain-English summary for the MLRO / Asana task / STR narrative. */
  summary: string;
}

// ---------------------------------------------------------------------------
// Tracked constants — authoritative list
// ---------------------------------------------------------------------------

export function getTrackedConstants(): readonly TrackedConstant[] {
  return [
    {
      key: 'DPMS_CASH_THRESHOLD_AED',
      current: DPMS_CASH_THRESHOLD_AED,
      regulatory: 'MoE Circular 08/AML/2021; FDL No.10/2025 Art.16',
      severity: 'critical',
    },
    {
      key: 'CROSS_BORDER_CASH_THRESHOLD_AED',
      current: CROSS_BORDER_CASH_THRESHOLD_AED,
      regulatory: 'FDL No.10/2025 Art.17',
      severity: 'critical',
    },
    {
      key: 'UBO_OWNERSHIP_THRESHOLD_PCT',
      current: UBO_OWNERSHIP_THRESHOLD_PCT,
      regulatory: 'Cabinet Decision 109/2023',
      severity: 'critical',
    },
    {
      key: 'STR_FILING_DEADLINE_BUSINESS_DAYS',
      current: STR_FILING_DEADLINE_BUSINESS_DAYS,
      regulatory: 'FDL No.10/2025 Art.26-27',
      severity: 'high',
    },
    {
      key: 'CTR_FILING_DEADLINE_BUSINESS_DAYS',
      current: CTR_FILING_DEADLINE_BUSINESS_DAYS,
      regulatory: 'FDL No.10/2025 Art.16',
      severity: 'high',
    },
    {
      key: 'CNMR_FILING_DEADLINE_BUSINESS_DAYS',
      current: CNMR_FILING_DEADLINE_BUSINESS_DAYS,
      regulatory: 'Cabinet Res 74/2020 Art.6',
      severity: 'high',
    },
    {
      key: 'EOCN_FREEZE_IMMEDIATELY',
      current: EOCN_FREEZE_IMMEDIATELY,
      regulatory: 'Cabinet Res 74/2020 Art.4-5',
      severity: 'critical',
    },
    {
      key: 'RECORD_RETENTION_YEARS',
      current: RECORD_RETENTION_YEARS,
      regulatory: 'FDL No.10/2025 Art.24',
      severity: 'high',
    },
    {
      key: 'UBO_REVERIFICATION_WORKING_DAYS',
      current: UBO_REVERIFICATION_WORKING_DAYS,
      regulatory: 'Cabinet Decision 109/2023',
      severity: 'medium',
    },
  ];
}

// ---------------------------------------------------------------------------
// Baseline capture
// ---------------------------------------------------------------------------

/**
 * Capture the current regulatory constants as an immutable baseline.
 * This is the "MLRO signed off on this version" snapshot.
 */
export function captureRegulatoryBaseline(now: Date = new Date()): RegulatoryBaseline {
  const values: Record<string, TrackedValue> = {};
  for (const c of getTrackedConstants()) {
    values[c.key] = c.current;
  }
  return {
    version: REGULATORY_CONSTANTS_VERSION,
    capturedAtIso: now.toISOString(),
    values: Object.freeze(values) as Record<string, TrackedValue>,
  };
}

// ---------------------------------------------------------------------------
// Drift detection
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<DriftFinding['severity'], number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Diff the current constants against a previously-captured baseline.
 * Returns a DriftReport with per-key findings and the top severity.
 */
export function checkRegulatoryDrift(baseline: RegulatoryBaseline): DriftReport {
  const tracked = getTrackedConstants();
  const findings: DriftFinding[] = [];

  for (const c of tracked) {
    const previous = baseline.values[c.key];
    if (previous === undefined) {
      // New constant added after the baseline was captured. Report as a
      // low-severity finding so the MLRO knows to re-baseline.
      findings.push({
        key: c.key,
        previous: null,
        current: c.current,
        delta: null,
        severity: 'low',
        regulatory: c.regulatory,
        description: `New tracked constant ${c.key} added since baseline — MLRO must re-baseline.`,
      });
      continue;
    }
    if (previous !== c.current) {
      const delta =
        typeof previous === 'number' && typeof c.current === 'number'
          ? c.current - previous
          : null;
      findings.push({
        key: c.key,
        previous,
        current: c.current,
        delta,
        severity: c.severity,
        regulatory: c.regulatory,
        description:
          `${c.key} changed from ${previous} to ${c.current}` +
          (delta !== null ? ` (delta ${delta.toFixed(2)})` : '') +
          `. Every decision produced after this change must be re-validated.`,
      });
    }
  }

  const versionDrifted = baseline.version !== REGULATORY_CONSTANTS_VERSION;
  if (versionDrifted && findings.length === 0) {
    // Version bumped but no numeric constant drifted — still a
    // low-severity finding so the MLRO investigates the notes field.
    findings.push({
      key: 'REGULATORY_CONSTANTS_VERSION',
      previous: null,
      current: 0,
      delta: null,
      severity: 'low',
      regulatory: 'FDL No.10/2025 Art.22',
      description:
        `Version bumped from ${baseline.version} to ${REGULATORY_CONSTANTS_VERSION} ` +
        `without a tracked-constant change. Check REGULATORY_CONSTANTS_NOTES for ` +
        `non-numeric updates (e.g. list membership changes).`,
    });
  }

  findings.sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
  );

  let topSeverity: DriftReport['topSeverity'] = 'none';
  let topRank = 0;
  for (const f of findings) {
    const r = SEVERITY_RANK[f.severity];
    if (r > topRank) {
      topRank = r;
      topSeverity = f.severity;
    }
  }

  const clean = findings.length === 0 && !versionDrifted;
  const summary = clean
    ? `Regulatory constants clean. Version ${REGULATORY_CONSTANTS_VERSION} matches baseline.`
    : `Regulatory drift detected: ${findings.length} finding(s), ` +
      `version ${baseline.version} → ${REGULATORY_CONSTANTS_VERSION}. ` +
      `Top severity: ${topSeverity}. ` +
      `Every compliance decision produced after ${baseline.capturedAtIso} must be ` +
      `re-validated against the new constants.`;

  return {
    clean,
    versionDrifted,
    baselineVersion: baseline.version,
    currentVersion: REGULATORY_CONSTANTS_VERSION,
    findings,
    topSeverity,
    summary,
  };
}

/**
 * Convenience: capture a baseline and diff against itself. Always
 * returns a clean report — used in tests and as a "hello world"
 * call.
 */
export function selfCheck(): DriftReport {
  return checkRegulatoryDrift(captureRegulatoryBaseline());
}

// Exports for tests.
export const __test__ = { SEVERITY_RANK };
