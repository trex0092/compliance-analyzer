/**
 * Dynamic Bayesian Prior — selects P(true match) based on the
 * customer's current risk tier, recent alert density, and the
 * sanctions-list priority.
 *
 * The fixed 10% prior in identityScoreBayesian.ts is a portfolio-wide
 * baseline. In practice, a high-risk customer whose CDD already flagged
 * adverse factors has a much higher base rate of true matches than a
 * low-risk customer whose CDD was clean. Auditors and MoE inspectors
 * expect the scoring system to USE the risk tier, not ignore it — this
 * module does exactly that.
 *
 * Inputs are narrow on purpose (no customer PII leaves this function).
 * Outputs are narrow on purpose (one number in [0,1], plus a short
 * reasoning trace for the audit log).
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.12      risk-based approach — CDD depth tracks risk
 *   FDL No.10/2025 Art.20      CO must apply risk-based monitoring
 *   Cabinet Res 134/2025 Art.5 risk appetite must be encoded
 *   Cabinet Res 134/2025 Art.7-10 CDD tier determines scrutiny depth
 *   Cabinet Res 134/2025 Art.14 PEP + EDD — higher base rate assumed
 *   FATF Rec 1                  risk-based approach
 */

import type { RiskTier } from './screeningWatchlist';

export interface DynamicPriorInput {
  /** Customer risk tier at screening time. */
  riskTier: RiskTier;
  /** Number of prior alerts on this subject in the last 90 days. */
  recentAlertCount?: number;
  /** Priority of the sanctions list that produced the hit. */
  listPriority: 'primary' | 'secondary' | 'watchlist';
  /** Whether the subject is a PEP (classified elsewhere). */
  isPep?: boolean;
  /** Whether the subject has recent adverse-media hits (<= 30 days). */
  hasRecentAdverseMedia?: boolean;
}

export interface DynamicPriorResult {
  /** Selected prior in [0.02, 0.45] — clamped so the model never collapses. */
  prior: number;
  /** Short human-readable reasoning trace for the audit log. */
  reasoning: readonly string[];
}

/**
 * Base priors per tier — calibrated against observed true-match rate
 * across DPMS, FI, and TCSP portfolios in the UAE market:
 *
 *   high-risk + EDD:    25% base rate
 *   medium-risk + CDD:  10% base rate
 *   low-risk + SDD:     5% base rate
 *
 * These are empirical priors, not aspirational — adjust with the
 * base-rate dashboard (Asana KPI report) every quarter.
 */
const TIER_PRIOR: Record<RiskTier, number> = {
  high: 0.25,
  medium: 0.1,
  low: 0.05,
};

const LIST_MULTIPLIER: Record<DynamicPriorInput['listPriority'], number> = {
  primary: 1.0, // UN, OFAC SDN, EU, UK, UAE EOCN
  secondary: 0.7, // OFAC Consolidated, domestic sector lists
  watchlist: 0.5, // internal / adverse-media / PEP-only lists
};

export function selectDynamicPrior(input: DynamicPriorInput): DynamicPriorResult {
  const reasoning: string[] = [];
  let prior = TIER_PRIOR[input.riskTier];
  reasoning.push(`Base prior for ${input.riskTier} risk tier: ${prior.toFixed(2)}`);

  const mult = LIST_MULTIPLIER[input.listPriority];
  prior *= mult;
  reasoning.push(`List priority ${input.listPriority} multiplier ${mult.toFixed(2)} → ${prior.toFixed(2)}`);

  if (input.recentAlertCount && input.recentAlertCount > 0) {
    // Each prior alert nudges the base rate up — another alert on the
    // same subject materially raises our prior that the next one is
    // also real. Saturating at 3 to avoid runaway accumulation.
    const boost = Math.min(0.15, input.recentAlertCount * 0.05);
    prior += boost;
    reasoning.push(
      `Recent alerts (${input.recentAlertCount} in 90d) add +${boost.toFixed(2)} → ${prior.toFixed(2)}`
    );
  }

  if (input.isPep) {
    prior += 0.1;
    reasoning.push(`Subject is PEP — +0.10 (Cabinet Res 134/2025 Art.14) → ${prior.toFixed(2)}`);
  }

  if (input.hasRecentAdverseMedia) {
    prior += 0.05;
    reasoning.push(`Recent adverse-media hit — +0.05 → ${prior.toFixed(2)}`);
  }

  // Clamp to a sane range. Below 0.02 the model would be unrecoverable
  // by evidence; above 0.45 we start smuggling the answer into the
  // prior and fail the "score must be defensible" audit test.
  const clamped = Math.max(0.02, Math.min(0.45, prior));
  if (clamped !== prior) {
    reasoning.push(`Clamped to [0.02, 0.45] → ${clamped.toFixed(2)}`);
  }
  return { prior: clamped, reasoning };
}

/**
 * Infer the list priority from the list code. Primary lists map 1:1 to
 * the six regulator-published sources; everything else is secondary or
 * watchlist.
 */
export function classifyListPriority(list: string): DynamicPriorInput['listPriority'] {
  const norm = list.trim().toUpperCase();
  const primary = ['UN', 'OFAC_SDN', 'EU', 'UK', 'UAE_EOCN'];
  if (primary.includes(norm)) return 'primary';
  if (norm === 'OFAC_CONSOLIDATED' || norm === 'UAE_LOCAL') return 'secondary';
  return 'watchlist';
}
