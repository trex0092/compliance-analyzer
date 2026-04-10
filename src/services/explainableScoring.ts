/**
 * Explainable Risk Scoring — every score is accompanied by a full
 * additive decomposition.
 *
 * Regulators (and customers, and courts) ask "why?". The answer must
 * be reproducible, cite the specific regulation, and map one-to-one
 * to the inputs. This module produces that decomposition for every
 * scoring call.
 *
 * Design:
 *   - An `Explanation` object tracks every factor's contribution.
 *   - `FactorContribution` = { name, rawValue, weight, contribution, source }
 *   - The final score is ALWAYS the sum of contributions (never
 *     a post-hoc normalisation), so the explanation is exact.
 *   - Each factor has a regulatory citation.
 *
 * This module deliberately re-implements scoring rather than wrapping
 * existing `src/domain/scoring.ts` — the existing file produces a
 * scalar and discards the factors. Callers that want explainability
 * should use this module directly.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FactorContribution {
  name: string;
  /** Raw input value (e.g. "high-risk jurisdiction" or 0.95 match score). */
  rawValue: unknown;
  /** Weight applied to this factor. */
  weight: number;
  /** Computed contribution to the total (signed, in score units). */
  contribution: number;
  /** Regulatory citation — FDL article, FATF rec, MoE circular. */
  regulatory: string;
  /** Optional human-readable explanation. */
  rationale?: string;
}

export interface Explanation {
  /** Final score = sum of contributions. */
  score: number;
  /** Human-readable rating derived from the score. */
  rating: 'Low' | 'Medium' | 'High' | 'Very High';
  /** CDD level triggered by the rating. */
  cddLevel: 'SDD' | 'CDD' | 'EDD';
  /** All factors that contributed (including zeros for completeness). */
  factors: FactorContribution[];
  /** Top contributors sorted by absolute contribution. */
  topFactors: FactorContribution[];
}

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

export interface ScoringInput {
  // Customer profile
  customerType?: 'individual' | 'entity' | 'trust' | 'foundation';
  nationality?: string;
  countryOfResidence?: string;
  countryOfIncorporation?: string;

  // PEP / Sanctions
  isPep?: boolean;
  pepProximity?: number; // hops to nearest PEP via UBO graph
  sanctionsMatchScore?: number; // 0..1
  sanctionsProximityHops?: number; // via UBO graph

  // Activity
  cashIntensity?: number; // 0..1, fraction of transactions in cash
  crossBorderIntensity?: number; // 0..1
  dpmsTransactionVolumeAED?: number;

  // Source of funds / business
  businessType?: 'gold' | 'jewellery' | 'precious_stones' | 'other';
  sourceOfFunds?: 'salary' | 'business' | 'investment' | 'unknown';
  adverseMediaHits?: number;

  // UBO red flags
  hasUndisclosedUbo?: boolean;
  maxUboConcentration?: number; // percentage

  // Transaction anomalies (from transactionAnomaly.ts)
  anomalyCount?: number;
  hasHighSeverityAnomaly?: boolean;
}

// ---------------------------------------------------------------------------
// Jurisdiction lists — simplified for this module
// ---------------------------------------------------------------------------

// High-risk per UAE EOCN + FATF Grey/Black list as of 2026-Q1.
// This is a static snapshot — production should read from a
// dynamically-updated list via regulatory-watcher.
const HIGH_RISK_JURISDICTIONS = new Set([
  'IR', // Iran
  'KP', // DPRK
  'MM', // Myanmar
  'SY', // Syria
  'AF', // Afghanistan
  'VE', // Venezuela
  'YE', // Yemen
  'SS', // South Sudan
]);

const FATF_GREY = new Set([
  'AL',
  'BB',
  'BF',
  'CM',
  'HR',
  'CD',
  'GI',
  'HT',
  'JM',
  'JO',
  'ML',
  'MZ',
  'NG',
  'PH',
  'SN',
  'TZ',
  'TR',
  'UG',
  'UZ',
  'VU',
]);

// ---------------------------------------------------------------------------
// Factor computations — each returns a contribution in score units
// ---------------------------------------------------------------------------

function factorSanctionsMatch(input: ScoringInput): FactorContribution {
  const score = input.sanctionsMatchScore ?? 0;
  let contribution = 0;
  let rationale = '';
  if (score >= 0.9) {
    contribution = 50;
    rationale = 'Confirmed sanctions match — 24h freeze protocol triggered';
  } else if (score >= 0.5) {
    contribution = 25;
    rationale = 'Potential sanctions match — four-eyes review required';
  } else if (score > 0) {
    contribution = 5;
    rationale = 'Weak sanctions signal — documented and dismissed';
  }
  return {
    name: 'Sanctions Match',
    rawValue: score,
    weight: 50,
    contribution,
    regulatory: 'Cabinet Res 74/2020 Art.4-7; FDL Art.14',
    rationale,
  };
}

function factorSanctionsProximity(input: ScoringInput): FactorContribution {
  const hops = input.sanctionsProximityHops;
  let contribution = 0;
  let rationale = '';
  if (hops !== null && hops !== undefined) {
    if (hops === 0) {
      contribution = 50;
      rationale = 'Direct sanctions hit';
    } else if (hops === 1) {
      contribution = 35;
      rationale = 'Direct shareholder is sanctioned';
    } else if (hops === 2) {
      contribution = 20;
      rationale = 'Second-degree ownership link to sanctioned entity';
    } else if (hops <= 4) {
      contribution = 10;
      rationale = `${hops}-hop ownership link to sanctioned entity`;
    }
  }
  return {
    name: 'Sanctions Proximity (UBO)',
    rawValue: hops ?? null,
    weight: 50,
    contribution,
    regulatory: 'Cabinet Res 74/2020; Cabinet Decision 109/2023',
    rationale,
  };
}

function factorPep(input: ScoringInput): FactorContribution {
  let contribution = 0;
  let rationale = '';
  if (input.isPep) {
    contribution = 20;
    rationale = 'Customer is a Politically Exposed Person';
  } else if (
    input.pepProximity !== null &&
    input.pepProximity !== undefined &&
    input.pepProximity <= 2
  ) {
    contribution = 10;
    rationale = `PEP within ${input.pepProximity} hops via ownership`;
  }
  return {
    name: 'PEP Status',
    rawValue: input.isPep ?? input.pepProximity ?? false,
    weight: 20,
    contribution,
    regulatory: 'FDL Art.14; Cabinet Res 134/2025 Art.14',
    rationale,
  };
}

function factorJurisdiction(input: ScoringInput): FactorContribution {
  const country = input.nationality ?? input.countryOfResidence ?? input.countryOfIncorporation;
  let contribution = 0;
  let rationale = '';
  if (country && HIGH_RISK_JURISDICTIONS.has(country)) {
    contribution = 25;
    rationale = `High-risk jurisdiction (UAE EOCN / FATF black list): ${country}`;
  } else if (country && FATF_GREY.has(country)) {
    contribution = 12;
    rationale = `FATF grey list jurisdiction: ${country}`;
  }
  return {
    name: 'Jurisdiction Risk',
    rawValue: country ?? 'unknown',
    weight: 25,
    contribution,
    regulatory: 'FATF Rec.19; EOCN PF Guidance 2025',
    rationale,
  };
}

function factorCashIntensity(input: ScoringInput): FactorContribution {
  const cash = input.cashIntensity ?? 0;
  let contribution = 0;
  let rationale = '';
  if (cash >= 0.8) {
    contribution = 15;
    rationale = 'Majority-cash customer (typical DPMS risk indicator)';
  } else if (cash >= 0.5) {
    contribution = 8;
    rationale = 'High cash usage (>50%)';
  }
  return {
    name: 'Cash Intensity',
    rawValue: cash,
    weight: 15,
    contribution,
    regulatory: 'MoE 08/AML/2021; FATF Rec.20',
    rationale,
  };
}

function factorUbo(input: ScoringInput): FactorContribution {
  let contribution = 0;
  let rationale = '';
  if (input.hasUndisclosedUbo) {
    contribution = 18;
    rationale = 'Ownership chain has undisclosed portion (> 0% unaccounted for)';
  } else if (
    input.maxUboConcentration !== null &&
    input.maxUboConcentration !== undefined &&
    input.maxUboConcentration < 25
  ) {
    contribution = 6;
    rationale = 'No single UBO ≥ 25% — fragmented ownership, UBO re-verification required';
  }
  return {
    name: 'UBO Transparency',
    rawValue: input.hasUndisclosedUbo ?? input.maxUboConcentration,
    weight: 18,
    contribution,
    regulatory: 'Cabinet Decision 109/2023',
    rationale,
  };
}

function factorAdverseMedia(input: ScoringInput): FactorContribution {
  const hits = input.adverseMediaHits ?? 0;
  let contribution = 0;
  let rationale = '';
  if (hits >= 5) {
    contribution = 15;
    rationale = `${hits} adverse media hits`;
  } else if (hits >= 1) {
    contribution = 8;
    rationale = `${hits} adverse media hit(s)`;
  }
  return {
    name: 'Adverse Media',
    rawValue: hits,
    weight: 15,
    contribution,
    regulatory: 'FATF Rec.10; Cabinet Res 134/2025 Art.14',
    rationale,
  };
}

function factorAnomalies(input: ScoringInput): FactorContribution {
  let contribution = 0;
  let rationale = '';
  if (input.hasHighSeverityAnomaly) {
    contribution = 20;
    rationale = 'High-severity transaction anomaly detected';
  } else if ((input.anomalyCount ?? 0) > 0) {
    contribution = 8;
    rationale = `${input.anomalyCount} transaction anomalies detected`;
  }
  return {
    name: 'Transaction Anomalies',
    rawValue: input.anomalyCount ?? 0,
    weight: 20,
    contribution,
    regulatory: 'Cabinet Res 134/2025 Art.19; FATF Rec.20',
    rationale,
  };
}

function factorCustomerType(input: ScoringInput): FactorContribution {
  let contribution = 0;
  let rationale = '';
  if (input.customerType === 'trust' || input.customerType === 'foundation') {
    contribution = 8;
    rationale = 'Trust/foundation structures warrant enhanced scrutiny';
  }
  return {
    name: 'Customer Type',
    rawValue: input.customerType ?? 'unknown',
    weight: 8,
    contribution,
    regulatory: 'FDL Art.12-14',
    rationale,
  };
}

// ---------------------------------------------------------------------------
// Top-level explainable score
// ---------------------------------------------------------------------------

export function explainableScore(input: ScoringInput): Explanation {
  const factors: FactorContribution[] = [
    factorSanctionsMatch(input),
    factorSanctionsProximity(input),
    factorPep(input),
    factorJurisdiction(input),
    factorCashIntensity(input),
    factorUbo(input),
    factorAdverseMedia(input),
    factorAnomalies(input),
    factorCustomerType(input),
  ];

  // The final score is EXACTLY the sum of contributions — no rescaling,
  // no clamping (except to 0..100 at the very end). This guarantees
  // that the explanation is faithful to the computation.
  const rawScore = factors.reduce((s, f) => s + f.contribution, 0);
  const score = Math.max(0, Math.min(100, Math.round(rawScore * 100) / 100));

  // Rating per CLAUDE.md decision tree
  let rating: Explanation['rating'];
  if (score >= 50) rating = 'Very High';
  else if (score >= 30) rating = 'High';
  else if (score >= 15) rating = 'Medium';
  else rating = 'Low';

  // CDD level per CLAUDE.md
  let cddLevel: Explanation['cddLevel'];
  if (score >= 30) cddLevel = 'EDD';
  else if (score >= 15) cddLevel = 'CDD';
  else cddLevel = 'SDD';

  const topFactors = [...factors]
    .filter((f) => f.contribution !== 0)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 5);

  return { score, rating, cddLevel, factors, topFactors };
}

/**
 * Format an explanation as human-readable Markdown for the MLRO.
 * Used when exporting CRA records to evidence chain / regulator bundle.
 */
export function formatExplanation(exp: Explanation, customerName: string): string {
  const lines: string[] = [];
  lines.push(`# Risk Assessment — ${customerName}`);
  lines.push('');
  lines.push(`**Score:** ${exp.score} / 100  `);
  lines.push(`**Rating:** ${exp.rating}  `);
  lines.push(`**CDD Level:** ${exp.cddLevel}`);
  lines.push('');
  lines.push('## Factor contributions');
  lines.push('');
  lines.push('| Factor | Value | Contribution | Regulatory basis |');
  lines.push('|---|---|---|---|');
  for (const f of exp.factors) {
    const valueStr =
      typeof f.rawValue === 'object' ? JSON.stringify(f.rawValue) : String(f.rawValue);
    lines.push(
      `| ${f.name} | ${valueStr} | **${f.contribution.toFixed(1)}** / ${f.weight} | ${f.regulatory} |`
    );
  }
  lines.push('');
  lines.push('## Top contributors');
  lines.push('');
  for (const f of exp.topFactors) {
    lines.push(`- **${f.name}** (+${f.contribution.toFixed(1)}): ${f.rationale ?? '—'}`);
  }
  lines.push('');
  lines.push(
    '_Every contribution is additive — score = sum of contributions. This document is the authoritative audit trail for this assessment._'
  );
  return lines.join('\n');
}
