/**
 * Risk Appetite Engine — policy-driven auto-accept / auto-reject.
 *
 * Cabinet Res 134/2025 Art.5 requires a Board-approved risk appetite
 * statement. This module codifies it as a declarative policy document
 * and evaluates transactions / onboardings against it.
 *
 * Design:
 *   - A `RiskAppetitePolicy` is a plain JSON document with thresholds.
 *   - `evaluateOnboarding()` checks a prospective customer against
 *     the policy and returns accept / review / reject.
 *   - `evaluateTransaction()` checks a single transaction.
 *   - Rejections cite the specific policy clause that was breached.
 *
 * Integration: the compliance UI loads the policy at startup and
 * calls evaluate* for every new customer / transaction. Any `reject`
 * outcome is auto-escalated to the brain as severity=high so the
 * four-eyes queue picks it up.
 */

// ---------------------------------------------------------------------------
// Policy types
// ---------------------------------------------------------------------------

export type Decision = 'accept' | 'review' | 'reject';

export interface RiskAppetitePolicy {
  version: string;
  approvedBy: string;
  approvedAt: string;
  customer: {
    maxRiskScore: number;
    minRiskScore: number;
    allowedNationalities?: string[];
    blockedNationalities: string[];
    allowedBusinessTypes?: string[];
    blockedBusinessTypes: string[];
    pepPolicy: 'accept' | 'review' | 'reject';
    sanctionsMatchPolicy: 'always_reject' | 'review_below_0.9';
  };
  transaction: {
    maxSingleTransactionAED: number;
    maxDailyVolumeAED: number;
    maxCashIntensity: number; // 0..1
    blockedCounterpartyJurisdictions: string[];
  };
  uboThreshold: number; // 25 by default
  virtualAssetsAllowed: boolean;
}

/** A sensible default policy aligned with CLAUDE.md and Cabinet Res 134/2025. */
export const DEFAULT_POLICY: RiskAppetitePolicy = {
  version: '1.0.0',
  approvedBy: 'Board (pending)',
  approvedAt: '2026-01-01',
  customer: {
    maxRiskScore: 50,
    minRiskScore: 0,
    blockedNationalities: ['IR', 'KP', 'SY', 'MM'],
    blockedBusinessTypes: ['casino', 'unlicensed_money_service'],
    pepPolicy: 'review',
    sanctionsMatchPolicy: 'always_reject',
  },
  transaction: {
    maxSingleTransactionAED: 5_000_000,
    maxDailyVolumeAED: 20_000_000,
    maxCashIntensity: 0.8,
    blockedCounterpartyJurisdictions: ['IR', 'KP', 'SY'],
  },
  uboThreshold: 25,
  virtualAssetsAllowed: true,
};

// ---------------------------------------------------------------------------
// Evaluation input shapes
// ---------------------------------------------------------------------------

export interface OnboardingInput {
  riskScore: number;
  nationality?: string;
  businessType?: string;
  isPep?: boolean;
  sanctionsMatchScore?: number;
  maxUboConcentration?: number;
  hasUndisclosedUbo?: boolean;
}

export interface TransactionInput {
  amountAED: number;
  counterpartyJurisdiction?: string;
  isCash?: boolean;
  customerCashIntensity?: number;
  /** Running daily total including this transaction. */
  dailyVolumeAED?: number;
  involvesVirtualAsset?: boolean;
}

export interface EvaluationResult {
  decision: Decision;
  reasons: Array<{ clause: string; detail: string }>;
}

// ---------------------------------------------------------------------------
// Onboarding evaluation
// ---------------------------------------------------------------------------

export function evaluateOnboarding(
  input: OnboardingInput,
  policy: RiskAppetitePolicy = DEFAULT_POLICY,
): EvaluationResult {
  const reasons: EvaluationResult['reasons'] = [];
  let decision: Decision = 'accept';

  const downgrade = (target: Decision): void => {
    if (target === 'reject') decision = 'reject';
    else if (target === 'review' && decision !== 'reject') decision = 'review';
  };

  // Sanctions — highest priority
  const score = input.sanctionsMatchScore ?? 0;
  if (policy.customer.sanctionsMatchPolicy === 'always_reject' && score > 0) {
    downgrade('reject');
    reasons.push({
      clause: 'customer.sanctionsMatchPolicy',
      detail: `Any sanctions match triggers reject (score=${score})`,
    });
  } else if (score >= 0.9) {
    downgrade('reject');
    reasons.push({
      clause: 'customer.sanctionsMatchPolicy',
      detail: 'Confirmed sanctions match (>=0.9)',
    });
  } else if (score >= 0.5) {
    downgrade('review');
    reasons.push({
      clause: 'customer.sanctionsMatchPolicy',
      detail: `Potential sanctions match (${score.toFixed(2)}) requires review`,
    });
  }

  // Risk score
  if (input.riskScore > policy.customer.maxRiskScore) {
    downgrade('reject');
    reasons.push({
      clause: 'customer.maxRiskScore',
      detail: `Risk score ${input.riskScore} exceeds policy maximum ${policy.customer.maxRiskScore}`,
    });
  } else if (input.riskScore >= policy.customer.maxRiskScore * 0.7) {
    downgrade('review');
    reasons.push({
      clause: 'customer.maxRiskScore',
      detail: `Risk score ${input.riskScore} is within 30% of the policy maximum`,
    });
  }

  // Blocked nationalities
  if (
    input.nationality &&
    policy.customer.blockedNationalities.includes(input.nationality)
  ) {
    downgrade('reject');
    reasons.push({
      clause: 'customer.blockedNationalities',
      detail: `Nationality ${input.nationality} is on the block list`,
    });
  }

  // Allowed-only nationalities (if specified)
  if (
    policy.customer.allowedNationalities &&
    input.nationality &&
    !policy.customer.allowedNationalities.includes(input.nationality)
  ) {
    downgrade('review');
    reasons.push({
      clause: 'customer.allowedNationalities',
      detail: `Nationality ${input.nationality} is not on the allow list`,
    });
  }

  // Business type
  if (
    input.businessType &&
    policy.customer.blockedBusinessTypes.includes(input.businessType)
  ) {
    downgrade('reject');
    reasons.push({
      clause: 'customer.blockedBusinessTypes',
      detail: `Business type ${input.businessType} is blocked`,
    });
  }

  // PEP
  if (input.isPep) {
    if (policy.customer.pepPolicy === 'reject') {
      downgrade('reject');
      reasons.push({ clause: 'customer.pepPolicy', detail: 'PEP not accepted' });
    } else if (policy.customer.pepPolicy === 'review') {
      downgrade('review');
      reasons.push({ clause: 'customer.pepPolicy', detail: 'PEP requires review' });
    }
  }

  // UBO transparency
  if (input.hasUndisclosedUbo) {
    downgrade('reject');
    reasons.push({
      clause: 'uboThreshold',
      detail: 'Undisclosed UBO portion — ownership chain cannot be fully verified',
    });
  }

  return { decision, reasons };
}

// ---------------------------------------------------------------------------
// Transaction evaluation
// ---------------------------------------------------------------------------

export function evaluateTransaction(
  input: TransactionInput,
  policy: RiskAppetitePolicy = DEFAULT_POLICY,
): EvaluationResult {
  const reasons: EvaluationResult['reasons'] = [];
  let decision: Decision = 'accept';
  const downgrade = (target: Decision): void => {
    if (target === 'reject') decision = 'reject';
    else if (target === 'review' && decision !== 'reject') decision = 'review';
  };

  // Single transaction size
  if (Math.abs(input.amountAED) > policy.transaction.maxSingleTransactionAED) {
    downgrade('reject');
    reasons.push({
      clause: 'transaction.maxSingleTransactionAED',
      detail: `Amount ${Math.abs(input.amountAED)} AED exceeds single-tx cap`,
    });
  }

  // Daily volume
  if (
    input.dailyVolumeAED !== undefined &&
    input.dailyVolumeAED > policy.transaction.maxDailyVolumeAED
  ) {
    downgrade('review');
    reasons.push({
      clause: 'transaction.maxDailyVolumeAED',
      detail: `Running daily volume ${input.dailyVolumeAED} AED exceeds cap`,
    });
  }

  // Cash intensity
  if (
    input.customerCashIntensity !== undefined &&
    input.customerCashIntensity > policy.transaction.maxCashIntensity
  ) {
    downgrade('review');
    reasons.push({
      clause: 'transaction.maxCashIntensity',
      detail: `Customer cash intensity ${input.customerCashIntensity.toFixed(2)} exceeds ${policy.transaction.maxCashIntensity}`,
    });
  }

  // Blocked counterparty jurisdiction
  if (
    input.counterpartyJurisdiction &&
    policy.transaction.blockedCounterpartyJurisdictions.includes(
      input.counterpartyJurisdiction,
    )
  ) {
    downgrade('reject');
    reasons.push({
      clause: 'transaction.blockedCounterpartyJurisdictions',
      detail: `Counterparty jurisdiction ${input.counterpartyJurisdiction} is blocked`,
    });
  }

  // Virtual assets
  if (input.involvesVirtualAsset && !policy.virtualAssetsAllowed) {
    downgrade('reject');
    reasons.push({
      clause: 'virtualAssetsAllowed',
      detail: 'Virtual asset transactions are not permitted by policy',
    });
  }

  return { decision, reasons };
}
