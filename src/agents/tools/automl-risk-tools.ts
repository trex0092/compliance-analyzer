/**
 * AutoML-Inspired Adaptive Risk Scoring Tools
 *
 * Applies automated model selection and ensemble learning concepts
 * (inspired by google/automl) to compliance risk scoring:
 *
 * 1. Feature extraction from customer/transaction data
 * 2. Multiple scoring models with automatic weight optimization
 * 3. Ensemble consensus for final risk determination
 * 4. Model performance tracking and feedback loop
 *
 * This provides an adaptive layer on top of the static rule-based
 * scoring in src/risk/scoring.ts, learning from historical decisions.
 */

import type { ToolResult } from '../mcp-server';
import type { ComplianceCase } from '../../domain/cases';
import type { CustomerProfile } from '../../domain/customers';
import { RISK_THRESHOLDS } from '../../domain/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RiskFeatures {
  /** Customer features */
  customerAge: number; // months since onboarding
  transactionCount30d: number;
  avgTransactionAmount: number;
  maxTransactionAmount: number;
  uniqueCounterparties: number;
  cashTransactionRatio: number;
  highRiskCountryExposure: number; // 0-1
  pepProximity: number; // 0-1
  sanctionsProximity: number; // 0-1
  ownershipComplexity: number; // 0-1
  cddOverdueDays: number;
  previousAlertCount: number;
  previousSTRCount: number;
  sectorRiskScore: number; // 0-1
}

export interface ModelPrediction {
  model: string;
  riskScore: number;
  confidence: number;
  topFeatures: Array<{ feature: string; weight: number; contribution: number }>;
}

export interface EnsembleResult {
  ensembleScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  predictions: ModelPrediction[];
  agreement: number; // 0-1 model agreement ratio
  featureImportance: Array<{ feature: string; importance: number }>;
  recommendedAction: string;
  adaptiveWeights: Record<string, number>;
}

export interface ModelPerformance {
  model: string;
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  falsePositiveRate: number;
  samplesEvaluated: number;
}

export interface FeedbackEntry {
  caseId: string;
  predictedRiskLevel: string;
  actualOutcome: string;
  features: RiskFeatures;
  wasCorrect: boolean;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Feature Extraction
// ---------------------------------------------------------------------------

export function extractFeatures(
  customer: CustomerProfile,
  transactions: Array<{ amount: number; timestamp: string; paymentMethod?: string; counterparty?: string; country?: string }>,
  cases: ComplianceCase[],
  highRiskCountries: string[] = [],
): RiskFeatures {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400_000);

  const recent = transactions.filter((tx) => new Date(tx.timestamp) >= thirtyDaysAgo);
  const amounts = recent.map((tx) => tx.amount);

  const cashTx = recent.filter((tx) => tx.paymentMethod === 'cash');
  const hrCountryTx = recent.filter((tx) => tx.country && highRiskCountries.includes(tx.country));
  const counterparties = new Set(recent.map((tx) => tx.counterparty).filter(Boolean));

  const customerCases = cases.filter((c) => c.linkedCustomerId === customer.id);
  const strCases = customerCases.filter((c) =>
    c.recommendation === 'str-review' || c.caseType === 'screening-hit',
  );

  const onboardDate = customer.lastCDDReviewDate
    ? new Date(customer.lastCDDReviewDate)
    : now;
  const customerAgeMonths = Math.floor(
    (now.getTime() - onboardDate.getTime()) / (30 * 86400_000),
  );

  const nextReview = customer.nextCDDReviewDate ? new Date(customer.nextCDDReviewDate) : null;
  const cddOverdueDays = nextReview && now > nextReview
    ? Math.floor((now.getTime() - nextReview.getTime()) / 86400_000)
    : 0;

  return {
    customerAge: customerAgeMonths,
    transactionCount30d: recent.length,
    avgTransactionAmount: amounts.length > 0 ? amounts.reduce((a, b) => a + b, 0) / amounts.length : 0,
    maxTransactionAmount: amounts.length > 0 ? Math.max(...amounts) : 0,
    uniqueCounterparties: counterparties.size,
    cashTransactionRatio: recent.length > 0 ? cashTx.length / recent.length : 0,
    highRiskCountryExposure: recent.length > 0 ? hrCountryTx.length / recent.length : 0,
    pepProximity: customer.pepStatus === 'match' ? 1 : customer.pepStatus === 'potential-match' ? 0.5 : 0,
    sanctionsProximity: customer.sanctionsStatus === 'match' ? 1 : customer.sanctionsStatus === 'potential-match' ? 0.5 : 0,
    ownershipComplexity: customer.ownershipComplexity ? 0.8 : 0,
    cddOverdueDays,
    previousAlertCount: customerCases.filter((c) => c.riskLevel === 'high' || c.riskLevel === 'critical').length,
    previousSTRCount: strCases.length,
    sectorRiskScore: getSectorRisk(customer.sector),
  };
}

// ---------------------------------------------------------------------------
// Scoring Models (Ensemble)
// ---------------------------------------------------------------------------

/** Linear weighted model — simple, interpretable baseline */
function linearModel(features: RiskFeatures): ModelPrediction {
  const weights: Record<keyof RiskFeatures, number> = {
    customerAge: -0.01, // older = lower risk
    transactionCount30d: 0.05,
    avgTransactionAmount: 0.00005,
    maxTransactionAmount: 0.00003,
    uniqueCounterparties: 0.03,
    cashTransactionRatio: 3.0,
    highRiskCountryExposure: 4.0,
    pepProximity: 5.0,
    sanctionsProximity: 8.0,
    ownershipComplexity: 2.0,
    cddOverdueDays: 0.1,
    previousAlertCount: 1.5,
    previousSTRCount: 3.0,
    sectorRiskScore: 3.0,
  };

  let score = 0;
  const contributions: ModelPrediction['topFeatures'] = [];

  for (const [key, weight] of Object.entries(weights)) {
    const value = features[key as keyof RiskFeatures];
    const contribution = value * weight;
    score += contribution;
    contributions.push({ feature: key, weight, contribution });
  }

  score = Math.max(0, Math.min(20, score));

  contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  return {
    model: 'linear-weighted',
    riskScore: score,
    confidence: 0.75,
    topFeatures: contributions.slice(0, 5),
  };
}

/** Threshold-based model — rule-driven, regulatory-aligned */
function thresholdModel(features: RiskFeatures): ModelPrediction {
  let score = 0;
  const topFeatures: ModelPrediction['topFeatures'] = [];

  if (features.sanctionsProximity >= 0.9) {
    score += 8;
    topFeatures.push({ feature: 'sanctionsProximity', weight: 8, contribution: 8 });
  }
  if (features.pepProximity >= 0.5) {
    score += 4;
    topFeatures.push({ feature: 'pepProximity', weight: 4, contribution: 4 });
  }
  if (features.cashTransactionRatio > 0.7) {
    score += 3;
    topFeatures.push({ feature: 'cashTransactionRatio', weight: 3, contribution: 3 });
  }
  if (features.highRiskCountryExposure > 0.3) {
    score += 3;
    topFeatures.push({ feature: 'highRiskCountryExposure', weight: 3, contribution: 3 });
  }
  if (features.previousSTRCount > 0) {
    score += 2 * features.previousSTRCount;
    topFeatures.push({ feature: 'previousSTRCount', weight: 2, contribution: 2 * features.previousSTRCount });
  }
  if (features.cddOverdueDays > 0) {
    score += Math.min(3, features.cddOverdueDays * 0.05);
    topFeatures.push({ feature: 'cddOverdueDays', weight: 0.05, contribution: Math.min(3, features.cddOverdueDays * 0.05) });
  }
  if (features.ownershipComplexity > 0.5) {
    score += 2;
    topFeatures.push({ feature: 'ownershipComplexity', weight: 2, contribution: 2 });
  }

  return {
    model: 'threshold-rules',
    riskScore: Math.min(20, score),
    confidence: 0.85,
    topFeatures: topFeatures.slice(0, 5),
  };
}

/** Behavioral deviation model — detects changes from baseline */
function behavioralModel(features: RiskFeatures): ModelPrediction {
  let score = 0;
  const topFeatures: ModelPrediction['topFeatures'] = [];

  // High transaction count for a young customer
  if (features.customerAge < 6 && features.transactionCount30d > 20) {
    score += 3;
    topFeatures.push({ feature: 'transactionCount30d:newCustomer', weight: 3, contribution: 3 });
  }

  // High average amount with many counterparties
  if (features.avgTransactionAmount > 30_000 && features.uniqueCounterparties > 10) {
    score += 3;
    topFeatures.push({ feature: 'avgAmount:counterparties', weight: 3, contribution: 3 });
  }

  // Cash dominant with high amounts
  if (features.cashTransactionRatio > 0.5 && features.maxTransactionAmount > 40_000) {
    score += 4;
    topFeatures.push({ feature: 'cashRatio:highAmount', weight: 4, contribution: 4 });
  }

  // Increasing alert frequency
  if (features.previousAlertCount > 2) {
    score += 2;
    topFeatures.push({ feature: 'alertFrequency', weight: 2, contribution: 2 });
  }

  // Sector + country risk combination
  if (features.sectorRiskScore > 0.6 && features.highRiskCountryExposure > 0.2) {
    score += 3;
    topFeatures.push({ feature: 'sector:countryRisk', weight: 3, contribution: 3 });
  }

  return {
    model: 'behavioral-deviation',
    riskScore: Math.min(20, score),
    confidence: 0.7,
    topFeatures: topFeatures.slice(0, 5),
  };
}

// ---------------------------------------------------------------------------
// Ensemble (AutoML-inspired model selection)
// ---------------------------------------------------------------------------

export function runEnsembleRiskScoring(
  features: RiskFeatures,
  adaptiveWeights?: Record<string, number>,
): EnsembleResult {
  // Run all models
  const predictions = [
    linearModel(features),
    thresholdModel(features),
    behavioralModel(features),
  ];

  // Default weights (can be adapted via feedback)
  const weights = adaptiveWeights ?? {
    'linear-weighted': 0.25,
    'threshold-rules': 0.45, // regulatory rules get highest weight
    'behavioral-deviation': 0.30,
  };

  // Weighted ensemble score
  let ensembleScore = 0;
  let totalWeight = 0;
  for (const pred of predictions) {
    const w = weights[pred.model] ?? 0.33;
    ensembleScore += pred.riskScore * w;
    totalWeight += w;
  }
  ensembleScore = ensembleScore / totalWeight;

  // Model agreement
  const scores = predictions.map((p) => p.riskScore);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length;
  const stdDev = Math.sqrt(variance);
  const agreement = Math.max(0, 1 - stdDev / (mean || 1));

  // Aggregate feature importance
  const featureMap = new Map<string, number>();
  for (const pred of predictions) {
    for (const feat of pred.topFeatures) {
      const current = featureMap.get(feat.feature) ?? 0;
      featureMap.set(feat.feature, current + Math.abs(feat.contribution));
    }
  }
  const featureImportance = Array.from(featureMap.entries())
    .map(([feature, importance]) => ({ feature, importance }))
    .sort((a, b) => b.importance - a.importance);

  // Risk level
  let riskLevel: EnsembleResult['riskLevel'] = 'low';
  if (ensembleScore >= RISK_THRESHOLDS.critical) riskLevel = 'critical';
  else if (ensembleScore >= RISK_THRESHOLDS.high) riskLevel = 'high';
  else if (ensembleScore >= RISK_THRESHOLDS.medium) riskLevel = 'medium';

  // Recommended action
  let recommendedAction: string;
  if (riskLevel === 'critical') {
    recommendedAction = 'Immediate EDD review. Escalate to MLRO. Consider STR filing.';
  } else if (riskLevel === 'high') {
    recommendedAction = 'Enhanced Due Diligence required. Senior Management approval needed.';
  } else if (riskLevel === 'medium') {
    recommendedAction = 'Standard CDD with increased monitoring. Review at 6 months.';
  } else {
    recommendedAction = 'Simplified Due Diligence acceptable. Standard 12-month review cycle.';
  }

  return {
    ensembleScore: Math.round(ensembleScore * 100) / 100,
    riskLevel,
    predictions,
    agreement: Math.round(agreement * 100) / 100,
    featureImportance,
    recommendedAction,
    adaptiveWeights: weights,
  };
}

// ---------------------------------------------------------------------------
// Feedback & Adaptive Weight Optimization
// ---------------------------------------------------------------------------

export function updateModelWeights(
  feedback: FeedbackEntry[],
  currentWeights: Record<string, number>,
): { weights: Record<string, number>; performance: ModelPerformance[] } {
  if (feedback.length === 0) {
    return { weights: currentWeights, performance: [] };
  }

  // Simplified weight adjustment based on accuracy
  // In production, this would use proper backpropagation / Bayesian optimization
  const modelNames = Object.keys(currentWeights);
  const performance: ModelPerformance[] = [];

  for (const model of modelNames) {
    const correct = feedback.filter((f) => f.wasCorrect).length;
    const total = feedback.length;
    const accuracy = correct / total;

    // Approximate precision/recall (simplified)
    const truePositives = feedback.filter((f) => f.wasCorrect && f.predictedRiskLevel !== 'low').length;
    const falsePositives = feedback.filter((f) => !f.wasCorrect && f.predictedRiskLevel !== 'low').length;
    const falseNegatives = feedback.filter((f) => !f.wasCorrect && f.predictedRiskLevel === 'low').length;

    const precision = truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 0;
    const recall = truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : 0;
    const f1Score = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

    performance.push({
      model,
      accuracy,
      precision,
      recall,
      f1Score,
      falsePositiveRate: falsePositives / (total || 1),
      samplesEvaluated: total,
    });
  }

  // Adjust weights based on F1 score
  const totalF1 = performance.reduce((s, p) => s + p.f1Score, 0);
  const newWeights: Record<string, number> = {};
  for (const p of performance) {
    newWeights[p.model] = totalF1 > 0
      ? p.f1Score / totalF1
      : currentWeights[p.model] ?? 1 / modelNames.length;
  }

  return { weights: newWeights, performance };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSectorRisk(sector?: string): number {
  const riskMap: Record<string, number> = {
    'precious-metals': 0.9,
    'precious-stones': 0.85,
    'money-exchange': 0.85,
    'real-estate': 0.7,
    'construction': 0.5,
    'trading': 0.6,
    'manufacturing': 0.3,
    'technology': 0.2,
    'retail': 0.2,
  };
  return riskMap[sector ?? ''] ?? 0.4;
}

// ---------------------------------------------------------------------------
// Schema exports for MCP registration
// ---------------------------------------------------------------------------

export const AUTOML_TOOL_SCHEMAS = [
  {
    name: 'extract_risk_features',
    description:
      'Extract machine-learning features from customer profile, transaction history, and case history. Returns normalized feature vector for risk scoring.',
    inputSchema: {
      type: 'object',
      properties: {
        customer: { type: 'object', description: 'CustomerProfile object' },
        transactions: { type: 'array', description: 'Transaction history array' },
        cases: { type: 'array', description: 'ComplianceCase array' },
        highRiskCountries: { type: 'array', items: { type: 'string' } },
      },
      required: ['customer', 'transactions', 'cases'],
    },
  },
  {
    name: 'ensemble_risk_score',
    description:
      'Run AutoML-inspired ensemble risk scoring. Combines 3 models (linear, threshold-rules, behavioral) with weighted consensus. Returns composite score, model agreement, and feature importance.',
    inputSchema: {
      type: 'object',
      properties: {
        features: { type: 'object', description: 'RiskFeatures object from extract_risk_features' },
        adaptiveWeights: { type: 'object', description: 'Optional model weight overrides' },
      },
      required: ['features'],
    },
  },
  {
    name: 'update_risk_model_weights',
    description:
      'Update ensemble model weights based on feedback from resolved compliance cases. Implements adaptive learning loop for risk scoring accuracy improvement.',
    inputSchema: {
      type: 'object',
      properties: {
        feedback: { type: 'array', description: 'Array of FeedbackEntry objects' },
        currentWeights: { type: 'object', description: 'Current model weights' },
      },
      required: ['feedback', 'currentWeights'],
    },
  },
] as const;
