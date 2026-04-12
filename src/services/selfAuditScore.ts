/**
 * Self-Audit Continuous Compliance Score
 *
 * Rolls together every signal we already collect into ONE score the
 * MLRO can glance at: "how ready are we for an MoE inspection right
 * now?" The answer is a 0-100 score across eight dimensions, updated
 * on every brain event.
 *
 * Dimensions (each worth 12.5 points for a max of 100):
 *   1. Governance     — CO appointed, policy approved, audit fresh
 *   2. Risk           — EWRA current, risk appetite approved
 *   3. CDD            — CDD procedures documented, UBO coverage
 *   4. Screening      — sanctions list freshness, portfolio re-screen
 *   5. Filing         — STR/CTR/DPMSR/CNMR deadlines met
 *   6. Records        — evidence chain intact, 10-year retention
 *   7. Training       — staff training current, attestations tracked
 *   8. Operational    — brain endpoint up, four-eyes configured
 *
 * The dimensions are additive — a catastrophic failure in one does
 * NOT zero the others, because the regulator will still want partial
 * credit for the parts that work. But any score below 60 triggers a
 * critical alert to the MLRO.
 */

// ---------------------------------------------------------------------------
// Input shape — the facts the scorer sees about the current state
// ---------------------------------------------------------------------------

export interface SelfAuditInput {
  // Governance
  coAppointed: boolean;
  coNotifiedWithin15Days: boolean;
  policyBoardApproved: boolean;
  independentAuditWithin12Months: boolean;

  // Risk
  ewraCurrentWithinYear: boolean;
  riskAppetiteApproved: boolean;

  // CDD
  cddProceduresDocumented: boolean;
  uboCoveragePct: number; // 0..100 — portion of customers with UBO identified

  // Screening
  sanctionsListAgeHours: number; // hours since last ingestion
  portfolioReScreenedWithin24h: boolean;

  // Filing
  strDeadlinesMet: boolean;
  ctrDeadlinesMet: boolean;
  dpmsrFiledThisQuarter: boolean;
  cnmrDeadlinesMet: boolean;

  // Records
  evidenceChainIntact: boolean;
  retentionMet: boolean;

  // Training
  trainingCurrentForAllStaff: boolean;
  attestationsCurrent: boolean;

  // Operational
  brainEndpointHealthy: boolean;
  fourEyesConfigured: boolean;
  approverKeysMinTwo: boolean;
}

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

export interface DimensionScore {
  dimension: string;
  score: number; // 0..12.5
  maxScore: number;
  gaps: string[];
  rationale: string;
}

export interface SelfAuditResult {
  totalScore: number; // 0..100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  dimensions: DimensionScore[];
  criticalGaps: string[];
  inspectionReady: boolean; // true if >= 80
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const DIMENSION_MAX = 12.5;

function scoreGovernance(input: SelfAuditInput): DimensionScore {
  const gaps: string[] = [];
  let score = 0;
  if (input.coAppointed) score += DIMENSION_MAX * 0.4;
  else gaps.push('Compliance Officer not appointed (FDL Art.20)');
  if (input.coNotifiedWithin15Days) score += DIMENSION_MAX * 0.1;
  else gaps.push('CO change not notified within 15 days (Cabinet Res 134/2025 Art.18)');
  if (input.policyBoardApproved) score += DIMENSION_MAX * 0.2;
  else gaps.push('AML policy not board-approved (FDL Art.21)');
  if (input.independentAuditWithin12Months) score += DIMENSION_MAX * 0.3;
  else gaps.push('Independent audit overdue (Cabinet Res 134/2025 Art.19)');
  return {
    dimension: 'Governance',
    score: Math.round(score * 100) / 100,
    maxScore: DIMENSION_MAX,
    gaps,
    rationale: gaps.length === 0 ? 'All governance checks pass' : `${gaps.length} gap(s)`,
  };
}

function scoreRisk(input: SelfAuditInput): DimensionScore {
  const gaps: string[] = [];
  let score = 0;
  if (input.ewraCurrentWithinYear) score += DIMENSION_MAX * 0.6;
  else gaps.push('EWRA not updated in the last 12 months (FDL Art.6)');
  if (input.riskAppetiteApproved) score += DIMENSION_MAX * 0.4;
  else gaps.push('Risk appetite not board-approved (Cabinet Res 134/2025 Art.5)');
  return {
    dimension: 'Risk',
    score: Math.round(score * 100) / 100,
    maxScore: DIMENSION_MAX,
    gaps,
    rationale: gaps.length === 0 ? 'Risk framework current' : `${gaps.length} gap(s)`,
  };
}

function scoreCdd(input: SelfAuditInput): DimensionScore {
  const gaps: string[] = [];
  let score = 0;
  if (input.cddProceduresDocumented) score += DIMENSION_MAX * 0.4;
  else gaps.push('CDD procedures not documented (FDL Art.12-14)');
  // UBO coverage is proportional
  const uboScore = (Math.max(0, Math.min(100, input.uboCoveragePct)) / 100) * DIMENSION_MAX * 0.6;
  score += uboScore;
  if (input.uboCoveragePct < 95) {
    gaps.push(`UBO coverage only ${input.uboCoveragePct.toFixed(0)}% (Cabinet Decision 109/2023)`);
  }
  return {
    dimension: 'CDD',
    score: Math.round(score * 100) / 100,
    maxScore: DIMENSION_MAX,
    gaps,
    rationale: `UBO coverage ${input.uboCoveragePct.toFixed(0)}%`,
  };
}

function scoreScreening(input: SelfAuditInput): DimensionScore {
  const gaps: string[] = [];
  let score = 0;
  // Sanctions list freshness — full credit if < 24h
  if (input.sanctionsListAgeHours <= 24) {
    score += DIMENSION_MAX * 0.5;
  } else if (input.sanctionsListAgeHours <= 72) {
    score += DIMENSION_MAX * 0.3;
    gaps.push(`Sanctions list is ${input.sanctionsListAgeHours.toFixed(0)}h old (>24h)`);
  } else {
    gaps.push(`Sanctions list is ${input.sanctionsListAgeHours.toFixed(0)}h old — STALE (>72h)`);
  }
  if (input.portfolioReScreenedWithin24h) score += DIMENSION_MAX * 0.5;
  else gaps.push('Portfolio not re-screened in the last 24h (Cabinet Res 74/2020)');
  return {
    dimension: 'Screening',
    score: Math.round(score * 100) / 100,
    maxScore: DIMENSION_MAX,
    gaps,
    rationale: `Sanctions data ${input.sanctionsListAgeHours.toFixed(0)}h old`,
  };
}

function scoreFiling(input: SelfAuditInput): DimensionScore {
  const gaps: string[] = [];
  let score = 0;
  if (input.strDeadlinesMet) score += DIMENSION_MAX * 0.3;
  else gaps.push('STR filings past deadline (FDL Art.26-27)');
  if (input.ctrDeadlinesMet) score += DIMENSION_MAX * 0.25;
  else gaps.push('CTR filings past deadline (FDL Art.16)');
  if (input.dpmsrFiledThisQuarter) score += DIMENSION_MAX * 0.2;
  else gaps.push('DPMS quarterly report not filed (MoE 08/AML/2021)');
  if (input.cnmrDeadlinesMet) score += DIMENSION_MAX * 0.25;
  else gaps.push('CNMR filings past deadline (Cabinet Res 74/2020 Art.5)');
  return {
    dimension: 'Filing',
    score: Math.round(score * 100) / 100,
    maxScore: DIMENSION_MAX,
    gaps,
    rationale: gaps.length === 0 ? 'All filings current' : `${gaps.length} filing gap(s)`,
  };
}

function scoreRecords(input: SelfAuditInput): DimensionScore {
  const gaps: string[] = [];
  let score = 0;
  if (input.evidenceChainIntact) score += DIMENSION_MAX * 0.6;
  else gaps.push('Evidence chain BROKEN (FDL Art.21; integrity at risk)');
  if (input.retentionMet) score += DIMENSION_MAX * 0.4;
  else gaps.push('10-year retention not met for all records (FDL Art.24)');
  return {
    dimension: 'Records',
    score: Math.round(score * 100) / 100,
    maxScore: DIMENSION_MAX,
    gaps,
    rationale: gaps.length === 0 ? 'Records intact' : 'Integrity issue',
  };
}

function scoreTraining(input: SelfAuditInput): DimensionScore {
  const gaps: string[] = [];
  let score = 0;
  if (input.trainingCurrentForAllStaff) score += DIMENSION_MAX * 0.7;
  else gaps.push('Staff training out of date (FDL Art.21)');
  if (input.attestationsCurrent) score += DIMENSION_MAX * 0.3;
  else gaps.push('Attestations not tracked');
  return {
    dimension: 'Training',
    score: Math.round(score * 100) / 100,
    maxScore: DIMENSION_MAX,
    gaps,
    rationale: gaps.length === 0 ? 'Training current' : `${gaps.length} gap(s)`,
  };
}

function scoreOperational(input: SelfAuditInput): DimensionScore {
  const gaps: string[] = [];
  let score = 0;
  if (input.brainEndpointHealthy) score += DIMENSION_MAX * 0.4;
  else gaps.push('Brain endpoint unhealthy — event stream not reliable');
  if (input.fourEyesConfigured) score += DIMENSION_MAX * 0.3;
  else gaps.push('Four-eyes approvals not configured');
  if (input.approverKeysMinTwo) score += DIMENSION_MAX * 0.3;
  else gaps.push('Fewer than 2 approvers configured — four-eyes impossible');
  return {
    dimension: 'Operational',
    score: Math.round(score * 100) / 100,
    maxScore: DIMENSION_MAX,
    gaps,
    rationale: gaps.length === 0 ? 'All operational checks pass' : `${gaps.length} gap(s)`,
  };
}

// ---------------------------------------------------------------------------
// Top-level aggregator
// ---------------------------------------------------------------------------

export function calculateSelfAuditScore(input: SelfAuditInput): SelfAuditResult {
  const dimensions: DimensionScore[] = [
    scoreGovernance(input),
    scoreRisk(input),
    scoreCdd(input),
    scoreScreening(input),
    scoreFiling(input),
    scoreRecords(input),
    scoreTraining(input),
    scoreOperational(input),
  ];

  const totalScore = Math.round(dimensions.reduce((s, d) => s + d.score, 0) * 100) / 100;

  let grade: SelfAuditResult['grade'];
  if (totalScore >= 90) grade = 'A';
  else if (totalScore >= 80) grade = 'B';
  else if (totalScore >= 70) grade = 'C';
  else if (totalScore >= 60) grade = 'D';
  else grade = 'F';

  const criticalGaps = dimensions.flatMap((d) => d.gaps);

  return {
    totalScore,
    grade,
    dimensions,
    criticalGaps,
    inspectionReady: totalScore >= 80,
  };
}
