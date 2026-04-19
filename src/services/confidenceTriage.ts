/**
 * Confidence Triage — maps the calibrated posterior probability to a
 * concrete MLRO action band + deadline + required approvers.
 *
 * The existing composite score lets the dispatcher decide ALERT vs
 * POSSIBLE vs CHANGE. That covers Asana task routing, but it does NOT
 * tell the MLRO:
 *   - how fast the decision must be made
 *   - who must sign off (single, double, board)
 *   - what the filing obligation is (STR / CNMR / both / neither yet)
 *   - what the explicit "if uncertain, do X" next step is
 *
 * This module returns exactly that set of actionable fields, driven by
 * the CALIBRATED probability (not the linear composite), so a hit with
 * a narrow uncertainty interval is triaged differently from a hit with
 * the same point estimate but a wide interval.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21   CO decision duty
 *   FDL No.10/2025 Art.26-27   STR filing within 10 business days
 *   FDL No.10/2025 Art.29      never notify subject
 *   FDL No.10/2025 Art.35      TFS — freeze applies to THE subject
 *   Cabinet Res 74/2020 Art.4  "freeze without delay" (1-2 h)
 *   Cabinet Res 74/2020 Art.6  CNMR within 5 business days
 *   Cabinet Res 134/2025 Art.14  PEP/EDD board approval
 */

import type { CalibratedIdentityScore } from './identityScoreBayesian';

export type ConfidenceBand = 'freeze' | 'escalate' | 'review' | 'dismiss-with-evidence' | 'monitor';

export interface ConfidenceTriageResult {
  band: ConfidenceBand;
  /** Human-readable verdict line for the Asana notes. */
  verdict: string;
  /** Ordered action list — MLRO works top-to-bottom. */
  actions: readonly string[];
  /** Required approvers for the action. */
  approvers: readonly ('MLRO' | 'CO' | 'DeputyMLRO' | 'Board')[];
  /** Deadline in business hours. Undefined = no hard deadline. */
  deadlineBusinessHours?: number;
  /** Filing obligations triggered by this band. */
  filings: readonly ('STR' | 'CNMR' | 'SAR')[];
}

/**
 * Triage thresholds — conservative by design. We would rather escalate
 * a borderline hit to CO than auto-dismiss it.
 *
 *   p >= 0.85                              → freeze now
 *   0.60 <= p < 0.85                       → CO escalate
 *   0.30 <= p < 0.60                       → MLRO review
 *   0.10 <= p < 0.30 AND interval wide     → monitor (gather evidence)
 *   p < 0.10                               → dismiss with recorded reasoning
 *
 * "Interval wide" = (hi - lo) >= 0.30 — we do not dismiss low-point
 * estimates if the uncertainty is high enough that a single missing
 * identifier could promote to ALERT.
 */
export function triageCalibratedScore(c: CalibratedIdentityScore): ConfidenceTriageResult {
  const p = c.probability;
  const [lo, hi] = c.interval;
  const width = hi - lo;

  if (p >= 0.85) {
    return {
      band: 'freeze',
      verdict: `FREEZE NOW — calibrated probability ${(p * 100).toFixed(1)}% (≥ 85%).`,
      actions: [
        'Freeze all assets / accounts linked to the subject (1-2 h SLA).',
        'Open an STR draft in goAML (use the STR NARRATIVE PRE-DRAFT block).',
        'File CNMR to EOCN within 5 business days.',
        'Log freeze timestamp + four-eyes approver in the audit trail.',
        'DO NOT notify the subject (FDL Art.29).',
      ],
      approvers: ['MLRO', 'CO'],
      deadlineBusinessHours: 2,
      filings: ['STR', 'CNMR'],
    };
  }

  if (p >= 0.6) {
    return {
      band: 'escalate',
      verdict: `ESCALATE TO CO — calibrated probability ${(p * 100).toFixed(1)}% (60%-85% band).`,
      actions: [
        'Route to Compliance Officer for confirm/reject decision within 24 business hours.',
        'If CO confirms → promote to FREEZE band and follow freeze playbook.',
        'If CO rejects → record reasoning + dismiss (audit trail retained 10yr).',
        'Consider expediting identity-resolution counterfactuals to reduce uncertainty.',
        'DO NOT notify the subject (FDL Art.29).',
      ],
      approvers: ['MLRO', 'CO'],
      deadlineBusinessHours: 24,
      filings: [],
    };
  }

  if (p >= 0.3) {
    return {
      band: 'review',
      verdict: `MLRO REVIEW — calibrated probability ${(p * 100).toFixed(1)}% (30%-60% band).`,
      actions: [
        'MLRO reviews the reasoning block + top counterfactual within 3 business days.',
        'Collect the identifier highlighted in the top counterfactual (DoB/ID/nationality).',
        'Re-score after evidence collection; promote to ESCALATE if posterior >= 0.60.',
        'If interval remains wide, enrich the subject profile before committing.',
        'DO NOT notify the subject (FDL Art.29).',
      ],
      approvers: ['MLRO'],
      deadlineBusinessHours: 72,
      filings: [],
    };
  }

  if (p >= 0.1 && width >= 0.3) {
    return {
      band: 'monitor',
      verdict: `MONITOR — calibrated probability ${(p * 100).toFixed(1)}% but uncertainty interval is wide (${(width * 100).toFixed(1)} pp).`,
      actions: [
        'Keep the subject on active monitoring; do not dismiss.',
        'Collect any missing identifiers at the next scheduled CDD refresh.',
        'Re-score on the next cron run; promote if new evidence tightens the interval.',
      ],
      approvers: ['MLRO'],
      filings: [],
    };
  }

  return {
    band: 'dismiss-with-evidence',
    verdict: `DISMISS (with recorded reasoning) — calibrated probability ${(p * 100).toFixed(1)}% and interval is tight.`,
    actions: [
      'Record the full reasoning block + counterfactuals in the audit trail.',
      'Dismiss the alert; re-evaluation will occur automatically on the next cron run.',
      'Retain the dismissal decision for 10 years (FDL Art.24).',
    ],
    approvers: ['MLRO'],
    filings: [],
  };
}
