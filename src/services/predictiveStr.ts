/**
 * Predictive STR Scoring.
 *
 * Given a feature vector for an entity + transaction history, estimate the
 * probability that the entity will trigger a Suspicious Transaction Report
 * within the next N days. The model is a transparent logistic-regression
 * style scorer with hand-calibrated coefficients — NO black-box. Every
 * factor contribution is exposed for explainability (FDL Art.20 — CO must
 * document reasoning).
 *
 * Design principles:
 *   1. Fully explainable — each prediction returns the contribution of
 *      every feature, ranked by absolute impact.
 *   2. Calibrated on FATF DPMS typology priors, not training data — this
 *      means no customer PII leaks, and the model is defensible in court.
 *   3. Conservative by default — when the model is uncertain, it biases
 *      toward ESCALATE, not PASS.
 *
 * Coefficients are published in `STR_COEFFICIENTS` below and can be
 * overridden per-tenant by supplying a coefficient map.
 *
 * Regulatory basis:
 *   - FDL Art.26-27 (STR filing)
 *   - Cabinet Res 134/2025 Art.19 (internal review)
 *   - FATF DPMS Typologies 2022 (indicator catalogue)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StrFeatures {
  /** Count of prior CDD alerts in the last 90 days. */
  priorAlerts90d: number;
  /** Aggregate transaction value over the last 30 days in AED. */
  txValue30dAED: number;
  /** Count of transactions at or just below AED 55K threshold (structuring risk). */
  nearThresholdCount30d: number;
  /** Ratio of cross-border transactions in the last 30 days. */
  crossBorderRatio30d: number;
  /** Is any UBO a PEP? */
  isPep: boolean;
  /** Is any counterparty in a high-risk jurisdiction? */
  highRiskJurisdiction: boolean;
  /** Does the entity have an unresolved adverse media hit? */
  hasAdverseMedia: boolean;
  /** Days since entity was onboarded. Newer = riskier. */
  daysSinceOnboarding: number;
  /** Name match score against sanctions lists in [0, 1]. */
  sanctionsMatchScore: number;
  /** Cash transaction ratio in the last 30 days. */
  cashRatio30d: number;
}

export interface FactorContribution {
  feature: keyof StrFeatures;
  value: number | boolean;
  coefficient: number;
  contribution: number; // logit contribution
  impact: 'increases-risk' | 'decreases-risk' | 'neutral';
}

export interface StrPrediction {
  /** Calibrated probability in [0, 1]. */
  probability: number;
  /** Band for UI + workflow routing. */
  band: 'low' | 'medium' | 'high' | 'critical';
  /** Suggested action based on band. */
  recommendation: 'monitor' | 'review' | 'escalate' | 'file-str';
  /** Feature contributions ranked by absolute impact. */
  factors: FactorContribution[];
  /** Logit score before sigmoid. */
  logit: number;
  /** Intercept used. */
  intercept: number;
}

// ---------------------------------------------------------------------------
// Coefficients (hand-calibrated against FATF DPMS priors)
// ---------------------------------------------------------------------------

export const STR_COEFFICIENTS: Record<keyof StrFeatures, number> = {
  priorAlerts90d: 0.4,
  txValue30dAED: 0.0000004, // ~AED 2.5M → +1 logit
  nearThresholdCount30d: 0.6,
  crossBorderRatio30d: 1.0,
  isPep: 1.8,
  highRiskJurisdiction: 1.4,
  hasAdverseMedia: 1.1,
  daysSinceOnboarding: -0.002, // older = lower risk, but small
  sanctionsMatchScore: 6.0,
  cashRatio30d: 1.8,
};

export const STR_INTERCEPT = -3.0; // baseline ~4.7% probability

// ---------------------------------------------------------------------------
// Scorer
// ---------------------------------------------------------------------------

function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

export function predictStr(
  features: StrFeatures,
  coefficients: Record<keyof StrFeatures, number> = STR_COEFFICIENTS,
  intercept: number = STR_INTERCEPT
): StrPrediction {
  const factors: FactorContribution[] = [];
  let logit = intercept;

  (Object.keys(coefficients) as (keyof StrFeatures)[]).forEach((key) => {
    const raw = features[key];
    const numericValue = typeof raw === 'boolean' ? (raw ? 1 : 0) : raw;
    const coeff = coefficients[key];
    const contribution = numericValue * coeff;
    logit += contribution;
    factors.push({
      feature: key,
      value: raw,
      coefficient: coeff,
      contribution: round4(contribution),
      impact:
        contribution > 0.01
          ? 'increases-risk'
          : contribution < -0.01
            ? 'decreases-risk'
            : 'neutral',
    });
  });

  // Rank by absolute contribution
  factors.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  const probability = sigmoid(logit);
  const band = probabilityBand(probability);
  const recommendation = recommendationForBand(band);

  return {
    probability: round4(probability),
    band,
    recommendation,
    factors,
    logit: round4(logit),
    intercept,
  };
}

function probabilityBand(p: number): StrPrediction['band'] {
  if (p >= 0.8) return 'critical';
  if (p >= 0.5) return 'high';
  if (p >= 0.2) return 'medium';
  return 'low';
}

function recommendationForBand(band: StrPrediction['band']): StrPrediction['recommendation'] {
  switch (band) {
    case 'critical':
      return 'file-str';
    case 'high':
      return 'escalate';
    case 'medium':
      return 'review';
    case 'low':
      return 'monitor';
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Batch scoring + explanation
// ---------------------------------------------------------------------------

export interface RankedEntity<T> {
  entity: T;
  features: StrFeatures;
  prediction: StrPrediction;
}

export function rankEntitiesByStrRisk<T>(
  entities: Array<{ entity: T; features: StrFeatures }>
): Array<RankedEntity<T>> {
  return entities
    .map(({ entity, features }) => ({
      entity,
      features,
      prediction: predictStr(features),
    }))
    .sort((a, b) => b.prediction.probability - a.prediction.probability);
}

/**
 * Human-readable one-line explanation suitable for the STR narrative
 * section. Picks the top 3 positive contributors.
 */
export function explainStrPrediction(prediction: StrPrediction): string {
  const top = prediction.factors
    .filter((f) => f.impact === 'increases-risk')
    .slice(0, 3)
    .map((f) => `${f.feature}=${f.value} (+${f.contribution})`)
    .join(', ');
  return `STR probability ${(prediction.probability * 100).toFixed(1)}% (${prediction.band}). Top drivers: ${top || 'none'}.`;
}
