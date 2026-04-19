/**
 * Forensic Investigator — the "look harder" layer on top of the
 * deliberative brain chain. Where the brain chain answers
 * "is this the subject?", this module answers:
 *
 *   - Why is the subject on N lists at once? (linkage)
 *   - Does the evidence pattern match typical fraud/ML patterns?
 *   - Which FATF Rec 10 identifiers are still missing?
 *   - What is the next investigative step that most reduces uncertainty?
 *   - Which regulatory red flags apply right now?
 *
 * It is intentionally NOT a scoring layer — it produces a structured
 * investigation packet the MLRO can read like a detective's notebook.
 * Every finding cites the specific regulation or FATF recommendation
 * that makes it actionable, and every recommendation is labelled with
 * the identifier it would collect, so the MLRO knows the shortest
 * path to a defensible decision.
 *
 * Pure function — no I/O, no globals. Deterministic. Tests pin every
 * finding so the audit trail is stable across re-runs.
 *
 * Regulatory basis:
 *   FATF Rec 10               positive ID — explicit gap analysis
 *   FATF Rec 13-14            correspondent banking + wire transfers
 *   FDL No.10/2025 Art.12     CDD depth tied to risk-based approach
 *   FDL No.10/2025 Art.15-16  threshold-aware investigation
 *   FDL No.10/2025 Art.20-21  CO decision duty
 *   Cabinet Res 134/2025 Art.14  PEP / EDD red flags
 *   Cabinet Res 74/2020 Art.4    TFS — freeze applies to THE subject
 *   EU AI Act Art.13+14       human oversight of automated decisions
 *   NIST AI RMF Measure 2.9   explainability
 *   ISO/IEC 42001 § 6.1.3     AI decision auditability
 */

import type { IdentityMatchBreakdown } from './identityMatchScore';
import type { WatchlistEntry } from './screeningWatchlist';
import type { CalibratedIdentityScore } from './identityScoreBayesian';
import type { EvidenceObservations } from './identityScoreBayesian';
import type { SubjectCorroboration } from './multiListCorroboration';
import type { HypothesisReasoningResult } from './hypothesisReasoner';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type FindingSeverity = 'info' | 'notable' | 'concerning' | 'critical';
export type RedFlagCategory =
  | 'identity-gap'
  | 'contradiction'
  | 'multi-list'
  | 'pep-indicator'
  | 'hypothesis-ambiguity'
  | 'pattern-anomaly'
  | 'procedural';

export interface ForensicFinding {
  /** Short, scannable label — one line in the MLRO notebook. */
  label: string;
  /** Full explanation including WHY this matters. */
  detail: string;
  /** Severity — drives sort order; critical findings surface first. */
  severity: FindingSeverity;
  /** Which regulatory anchor this finding ties back to. */
  regulatory: string;
  /** Which category the finding belongs to (drives UI colouring). */
  category: RedFlagCategory;
}

export interface InvestigativeStep {
  /** Short action label. */
  action: string;
  /** Identifier this step would collect or verify. */
  identifier: 'dob' | 'nationality' | 'id' | 'pin' | 'alias' | 'address' | 'source-of-funds';
  /**
   * Estimated probability-promotion potential in percentage points —
   * how much the calibrated posterior could move if the step resolves
   * positively. Copied from the calibrator's counterfactual when
   * available, otherwise conservative heuristic.
   */
  expectedProbabilityGain: number;
  /** Regulatory anchor that makes this step mandatory or advisable. */
  regulatory: string;
}

export interface ForensicInvestigation {
  /** Findings sorted: critical → concerning → notable → info. */
  findings: readonly ForensicFinding[];
  /** Recommended next investigative steps, in priority order. */
  nextSteps: readonly InvestigativeStep[];
  /** Single-line verdict for the Asana notes. */
  verdict: string;
  /** Severity of the most severe finding — drives UI pill colour. */
  overallSeverity: FindingSeverity;
  /** Number of FATF Rec 10 identifiers still missing. */
  identityGapCount: number;
  /** True when the brain chain is decisive AND evidence is complete. */
  investigationComplete: boolean;
}

// ---------------------------------------------------------------------------
// Input shape — narrow on purpose. Every caller already has these
// values from the brain chain + calibrator + corroboration modules,
// so we ask for them instead of re-deriving.
// ---------------------------------------------------------------------------

export interface ForensicInvestigationInput {
  subject: WatchlistEntry;
  breakdown: IdentityMatchBreakdown;
  evidence: EvidenceObservations;
  calibrated: CalibratedIdentityScore;
  hypotheses: HypothesisReasoningResult;
  corroboration?: SubjectCorroboration;
  /** Recent alert count on this subject — fuels the pattern-anomaly check. */
  recentAlertCount?: number;
  /** Was the match raised by an AMENDMENT event? (drives a specific finding). */
  isAmendment?: boolean;
}

// ---------------------------------------------------------------------------
// Severity ordering
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  critical: 0,
  concerning: 1,
  notable: 2,
  info: 3,
};

function maxSeverity(a: FindingSeverity, b: FindingSeverity): FindingSeverity {
  return SEVERITY_ORDER[a] <= SEVERITY_ORDER[b] ? a : b;
}

// ---------------------------------------------------------------------------
// Finding generators — each returns 0-N findings.
// ---------------------------------------------------------------------------

function identityGapFindings(input: ForensicInvestigationInput): ForensicFinding[] {
  const out: ForensicFinding[] = [];
  const e = input.evidence;
  if (!e.subjectHasDob) {
    out.push({
      label: 'Subject DoB missing',
      detail:
        'The subject profile has no date of birth on file. Without DoB the calibrator cannot produce a tight interval; a single DoB match typically flips a POSSIBLE into an ALERT band.',
      severity: 'concerning',
      regulatory: 'FATF Rec 10; Cabinet Res 134/2025 Art.7-10',
      category: 'identity-gap',
    });
  } else if (!e.hitHasDob) {
    out.push({
      label: 'List entry DoB not published',
      detail:
        'The list entry carries no DoB. This is typical for older UN/EU designations; treat as latent uncertainty and verify via designating-authority website or gazette.',
      severity: 'notable',
      regulatory: 'FATF Rec 10',
      category: 'identity-gap',
    });
  }
  if (!e.subjectHasId) {
    out.push({
      label: 'Subject ID / passport number missing',
      detail:
        'No ID number on file. Capturing the subject ID during the next CDD refresh is the highest-leverage evidence move (log-odds delta ≈ +3.0).',
      severity: 'concerning',
      regulatory: 'FDL No.10/2025 Art.12; Cabinet Res 134/2025 Art.7-10',
      category: 'identity-gap',
    });
  }
  if (!e.subjectHasNationality) {
    out.push({
      label: 'Subject nationality missing',
      detail:
        'Nationality not on file — weakens pattern reasoning when the list entry carries a high-risk jurisdiction code.',
      severity: 'notable',
      regulatory: 'FATF Rec 10; FDL No.10/2025 Art.12',
      category: 'identity-gap',
    });
  }
  if (!e.subjectHasPin) {
    out.push({
      label: 'No designation pin',
      detail:
        'The subject has not been pinned to a specific list entry. Pinning (MLRO "this is them") turns every future hit on the same designation into an instant corroborated match.',
      severity: 'notable',
      regulatory: 'FDL No.10/2025 Art.20-21',
      category: 'identity-gap',
    });
  }
  return out;
}

function contradictionFindings(input: ForensicInvestigationInput): ForensicFinding[] {
  const out: ForensicFinding[] = [];
  for (const field of input.calibrated.contradictions) {
    out.push({
      label: `Contradicting ${field}`,
      detail: `The subject and list entry both carry ${field} values and they do not agree. This is strong negative evidence — one side must be wrong or this is a different person. Resolve BEFORE any freeze decision.`,
      severity: 'critical',
      regulatory: 'FATF Rec 10; FDL No.10/2025 Art.20',
      category: 'contradiction',
    });
  }
  return out;
}

function multiListFindings(input: ForensicInvestigationInput): ForensicFinding[] {
  const out: ForensicFinding[] = [];
  const c = input.corroboration;
  if (!c || c.lists.length <= 1) return out;
  const severity: FindingSeverity =
    c.lists.length >= 4 ? 'critical' : c.lists.length >= 3 ? 'concerning' : 'notable';
  out.push({
    label: `Cross-list corroboration × ${c.lists.length}`,
    detail: `Same subject is concurrently on ${c.lists.join(' + ')}. Multi-list convergence is the single strongest evidence signal short of a pin — at ${c.lists.length} lists the coincidence probability is effectively zero.`,
    severity,
    regulatory: 'FATF Rec 6; FDL No.10/2025 Art.35',
    category: 'multi-list',
  });
  return out;
}

function hypothesisAmbiguityFindings(input: ForensicInvestigationInput): ForensicFinding[] {
  const out: ForensicFinding[] = [];
  if (input.hypotheses.decisive) return out;
  const { leading } = input.hypotheses;
  const second = input.hypotheses.ranked[1];
  if (!second) return out;
  out.push({
    label: 'Ambiguous hypothesis ranking',
    detail: `Leading hypothesis ${leading.hypothesis} is only ${(leading.margin * 100).toFixed(1)} pp ahead of ${second.hypothesis}. Collect the identifier the top counterfactual highlights before committing.`,
    severity: 'concerning',
    regulatory: 'EU AI Act Art.14 (human oversight); FDL Art.20',
    category: 'hypothesis-ambiguity',
  });
  return out;
}

function patternAnomalyFindings(input: ForensicInvestigationInput): ForensicFinding[] {
  const out: ForensicFinding[] = [];
  const recent = input.recentAlertCount ?? 0;
  if (recent >= 3) {
    out.push({
      label: `Repeat-hit pattern (${recent} in 90d)`,
      detail: `Subject has triggered ${recent} alerts in the last 90 days. Repeated firings on the same subject indicate either a persistent risk event or a calibration gap in the suppression rules. Escalate regardless of the current band.`,
      severity: 'concerning',
      regulatory: 'Cabinet Res 134/2025 Art.19 (periodic internal review)',
      category: 'pattern-anomaly',
    });
  }
  // Name-score weak but id score strong — very specific identifier-reuse pattern.
  if (input.breakdown.name < 0.5 && input.breakdown.id >= 0.999) {
    out.push({
      label: 'Identifier reuse pattern',
      detail:
        'ID / passport number agrees but the name does not. This is the canonical "stale ID re-issued" pattern — contact the issuing authority to verify whether the document was re-assigned to a new holder.',
      severity: 'concerning',
      regulatory: 'FATF Rec 10',
      category: 'pattern-anomaly',
    });
  }
  if (input.isAmendment) {
    out.push({
      label: 'Designation amendment',
      detail:
        'This alert was raised by an AMENDMENT event. Verify WHICH field changed (new identifiers or additional aliases are materially different from a cosmetic typo fix).',
      severity: 'notable',
      regulatory: 'FDL No.10/2025 Art.20-21',
      category: 'pattern-anomaly',
    });
  }
  return out;
}

function proceduralFindings(input: ForensicInvestigationInput): ForensicFinding[] {
  const out: ForensicFinding[] = [];
  if (!input.subject.resolvedIdentity) {
    out.push({
      label: 'Identity unresolved → FATF Rec 10 clamp',
      detail:
        'The subject has no resolved identity on file. The classification is automatically clamped from ALERT to POSSIBLE until the MLRO pins or dismisses the identity in Screening Command.',
      severity: 'notable',
      regulatory: 'FATF Rec 10',
      category: 'procedural',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Investigative-step generator — translates calibrator counterfactuals
// into actionable MLRO next-steps, sorted by expected probability gain.
// ---------------------------------------------------------------------------

function sigmoid(x: number): number {
  if (x > 40) return 1;
  if (x < -40) return 0;
  const e = Math.exp(x);
  return e / (1 + e);
}

function buildNextSteps(input: ForensicInvestigationInput): InvestigativeStep[] {
  const out: InvestigativeStep[] = [];
  const current = input.calibrated.probability;
  for (const cf of input.calibrated.counterfactuals) {
    const projectedProbability = sigmoid(input.calibrated.logOdds + cf.logOddsDelta);
    const gain = Math.max(0, projectedProbability - current);
    const identifier = mapComponentToIdentifier(cf.component);
    out.push({
      action: cf.action,
      identifier,
      expectedProbabilityGain: Math.round(gain * 1000) / 10, // percentage points, 1dp
      regulatory: identifierRegulatory(identifier),
    });
  }
  // Always recommend source-of-funds on freeze/escalate bands — regulators expect it.
  if (input.calibrated.probability >= 0.6 && !out.some((s) => s.identifier === 'source-of-funds')) {
    out.push({
      action: 'Collect source-of-funds + source-of-wealth declaration for the subject',
      identifier: 'source-of-funds',
      expectedProbabilityGain: 0,
      regulatory: 'FDL No.10/2025 Art.12; Cabinet Res 134/2025 Art.14',
    });
  }
  out.sort((a, b) => b.expectedProbabilityGain - a.expectedProbabilityGain);
  return out;
}

function mapComponentToIdentifier(
  component: 'name' | 'dob' | 'nationality' | 'id' | 'pin' | 'alias'
): InvestigativeStep['identifier'] {
  if (component === 'name' || component === 'alias') return 'alias';
  return component;
}

function identifierRegulatory(id: InvestigativeStep['identifier']): string {
  switch (id) {
    case 'dob':
    case 'nationality':
    case 'id':
    case 'alias':
      return 'FATF Rec 10; Cabinet Res 134/2025 Art.7-10';
    case 'pin':
      return 'FDL No.10/2025 Art.20-21';
    case 'address':
      return 'Cabinet Res 134/2025 Art.7-10';
    case 'source-of-funds':
      return 'FDL No.10/2025 Art.12; Cabinet Res 134/2025 Art.14';
  }
}

// ---------------------------------------------------------------------------
// Main investigator
// ---------------------------------------------------------------------------

export function runForensicInvestigation(input: ForensicInvestigationInput): ForensicInvestigation {
  const findings: ForensicFinding[] = [
    ...identityGapFindings(input),
    ...contradictionFindings(input),
    ...multiListFindings(input),
    ...hypothesisAmbiguityFindings(input),
    ...patternAnomalyFindings(input),
    ...proceduralFindings(input),
  ];

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const overallSeverity: FindingSeverity = findings.reduce<FindingSeverity>(
    (acc, f) => maxSeverity(acc, f.severity),
    'info'
  );

  const identityGapCount = findings.filter((f) => f.category === 'identity-gap').length;
  const nextSteps = buildNextSteps(input);

  const investigationComplete =
    input.hypotheses.decisive &&
    input.calibrated.unobserved.length === 0 &&
    input.calibrated.contradictions.length === 0;

  const verdict = buildVerdict(
    overallSeverity,
    findings.length,
    identityGapCount,
    investigationComplete
  );

  return {
    findings,
    nextSteps,
    verdict,
    overallSeverity,
    identityGapCount,
    investigationComplete,
  };
}

function buildVerdict(
  severity: FindingSeverity,
  findingsCount: number,
  identityGaps: number,
  complete: boolean
): string {
  if (complete) {
    return 'INVESTIGATION COMPLETE — evidence set is full and hypothesis ranking is decisive. Proceed per confidence-triage band.';
  }
  const parts: string[] = [];
  parts.push(`Overall severity: ${severity.toUpperCase()}`);
  parts.push(`${findingsCount} finding${findingsCount === 1 ? '' : 's'}`);
  parts.push(`${identityGaps} identity gap${identityGaps === 1 ? '' : 's'}`);
  return `${parts.join('; ')}. Close the top-ranked next step before committing.`;
}
