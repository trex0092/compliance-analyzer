/**
 * Anomaly Detection Ensemble
 *
 * Weighted ensemble of all anomaly detection signals from the compliance
 * brain subsystems. Aggregates scores via Bayesian model averaging and
 * produces a single consolidated anomaly verdict with calibrated confidence.
 *
 * Integrates with: benfordAnalyzer, priceAnomaly, tradeBasedMLDetector,
 *                  hawalaDetector, buyBackRisk, transactionAnomalyDetector,
 *                  adversarialMlDetector, verdictDriftMonitor.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type AnomalySignalName =
  | 'benford'
  | 'price_anomaly'
  | 'tbml'
  | 'hawala'
  | 'buy_back'
  | 'transaction_pattern'
  | 'adversarial_ml'
  | 'verdict_drift'
  | 'volume_spike'
  | 'counterparty_clustering'
  | 'timing_pattern'
  | 'jurisdiction_risk';

export type AnomalyLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';
export type EnsembleMethod = 'weighted_average' | 'max' | 'bayesian_bma' | 'vote';

export interface AnomalySignal {
  name: AnomalySignalName;
  score: number;          // 0–100 raw anomaly score from source detector
  confidence: number;     // 0–1 calibration confidence from source detector
  weight: number;         // ensemble weight (sum need not equal 1; normalised internally)
  flagged: boolean;       // did source detector trigger on this signal?
  details?: string;
}

export interface EnsembleConfig {
  method: EnsembleMethod;
  criticalThreshold: number;    // default 75
  highThreshold: number;        // default 50
  mediumThreshold: number;      // default 25
}

export const DEFAULT_ENSEMBLE_CONFIG: EnsembleConfig = {
  method: 'bayesian_bma',
  criticalThreshold: 75,
  highThreshold: 50,
  mediumThreshold: 25,
};

/** Empirically derived base weights for DPMS gold-dealer risk signals */
export const BASE_SIGNAL_WEIGHTS: Record<AnomalySignalName, number> = {
  benford:                 0.08,
  price_anomaly:           0.14,
  tbml:                    0.15,
  hawala:                  0.14,
  buy_back:                0.08,
  transaction_pattern:     0.10,
  adversarial_ml:          0.07,
  verdict_drift:           0.05,
  volume_spike:            0.06,
  counterparty_clustering: 0.06,
  timing_pattern:          0.04,
  jurisdiction_risk:       0.03,
};

export interface EnsembleResult {
  entityId: string;
  transactionId?: string;
  generatedAt: string;
  method: EnsembleMethod;
  aggregatedScore: number;        // 0–100
  anomalyLevel: AnomalyLevel;
  confidence: number;             // 0–1 ensemble confidence
  activeSignals: AnomalySignal[];
  dominantSignal: AnomalySignalName | null;
  signalContributions: Record<AnomalySignalName, number>;
  requiresReview: boolean;
  requiresStr: boolean;
  narrativeSummary: string;
}

// ─── Ensemble Computation ─────────────────────────────────────────────────────

function normaliseWeights(signals: AnomalySignal[]): Map<AnomalySignalName, number> {
  const total = signals.reduce((s, sig) => s + sig.weight, 0);
  const norm = new Map<AnomalySignalName, number>();
  for (const sig of signals) {
    norm.set(sig.name, total > 0 ? sig.weight / total : 1 / signals.length);
  }
  return norm;
}

function weightedAverage(signals: AnomalySignal[], weights: Map<AnomalySignalName, number>): number {
  return signals.reduce((s, sig) => s + (weights.get(sig.name) ?? 0) * sig.score, 0);
}

function maxEnsemble(signals: AnomalySignal[]): number {
  return signals.length > 0 ? Math.max(...signals.map(s => s.score)) : 0;
}

function majorityVote(signals: AnomalySignal[], cfg: EnsembleConfig): number {
  const highCount = signals.filter(s => s.score >= cfg.highThreshold).length;
  const frac = signals.length > 0 ? highCount / signals.length : 0;
  return frac * 100;
}

/**
 * Bayesian Model Averaging:
 * Score = Σ (normalised_weight × score × confidence)
 * Posterior confidence = 1 − (variance across models)^0.5 / 100
 */
function bayesianBma(
  signals: AnomalySignal[],
  weights: Map<AnomalySignalName, number>,
): { score: number; confidence: number } {
  const weightedScores = signals.map(s => ({
    w: weights.get(s.name) ?? 0,
    s: s.score * s.confidence,
  }));

  const bmaScore = weightedScores.reduce((acc, { w, s }) => acc + w * s, 0);

  // Posterior variance
  const mean = bmaScore;
  const variance = weightedScores.reduce((acc, { w, s }) => acc + w * (s - mean) ** 2, 0);
  const confidence = Math.max(0.1, 1 - Math.sqrt(variance) / 100);

  return { score: bmaScore, confidence };
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function runAnomalyEnsemble(
  entityId: string,
  signals: AnomalySignal[],
  config: EnsembleConfig = DEFAULT_ENSEMBLE_CONFIG,
  transactionId?: string,
): EnsembleResult {
  if (signals.length === 0) {
    return {
      entityId,
      transactionId,
      generatedAt: new Date().toISOString(),
      method: config.method,
      aggregatedScore: 0,
      anomalyLevel: 'none',
      confidence: 1.0,
      activeSignals: [],
      dominantSignal: null,
      signalContributions: {} as Record<AnomalySignalName, number>,
      requiresReview: false,
      requiresStr: false,
      narrativeSummary: 'No anomaly signals provided.',
    };
  }

  const weights = normaliseWeights(signals);

  let aggregatedScore: number;
  let confidence: number;

  switch (config.method) {
    case 'weighted_average':
      aggregatedScore = weightedAverage(signals, weights);
      confidence = signals.reduce((s, sig) => s + sig.confidence * (weights.get(sig.name) ?? 0), 0);
      break;
    case 'max':
      aggregatedScore = maxEnsemble(signals);
      confidence = signals.find(s => s.score === aggregatedScore)?.confidence ?? 0.5;
      break;
    case 'vote':
      aggregatedScore = majorityVote(signals, config);
      confidence = 0.7;
      break;
    case 'bayesian_bma':
    default: {
      const bma = bayesianBma(signals, weights);
      aggregatedScore = bma.score;
      confidence = bma.confidence;
      break;
    }
  }

  const anomalyLevel: AnomalyLevel =
    aggregatedScore >= config.criticalThreshold ? 'critical' :
    aggregatedScore >= config.highThreshold ? 'high' :
    aggregatedScore >= config.mediumThreshold ? 'medium' :
    aggregatedScore > 0 ? 'low' : 'none';

  // Signal contributions (weighted)
  const signalContributions = {} as Record<AnomalySignalName, number>;
  for (const sig of signals) {
    signalContributions[sig.name] = (weights.get(sig.name) ?? 0) * sig.score;
  }

  const dominantSignal = signals.length > 0
    ? signals.reduce((a, b) => signalContributions[a.name] > signalContributions[b.name] ? a : b).name
    : null;

  const requiresReview = aggregatedScore >= config.mediumThreshold;
  const requiresStr = aggregatedScore >= config.highThreshold && signals.some(s => s.flagged);

  const activeSignals = signals.filter(s => s.flagged || s.score >= config.mediumThreshold);

  const narrativeSummary =
    `Entity ${entityId}: ensemble anomaly score ${aggregatedScore.toFixed(1)}/100 ` +
    `(${anomalyLevel.toUpperCase()}, confidence ${(confidence * 100).toFixed(0)}%). ` +
    `Method: ${config.method}. Active signals: ${activeSignals.length}/${signals.length}. ` +
    `Dominant: ${dominantSignal ?? 'none'}. STR required: ${requiresStr}.`;

  return {
    entityId,
    transactionId,
    generatedAt: new Date().toISOString(),
    method: config.method,
    aggregatedScore,
    anomalyLevel,
    confidence,
    activeSignals,
    dominantSignal,
    signalContributions,
    requiresReview,
    requiresStr,
    narrativeSummary,
  };
}

/**
 * Build AnomalySignal entries from raw brain subsystem outputs.
 * Convenience factory for wiring into weaponizedBrain.ts.
 */
export function buildSignal(
  name: AnomalySignalName,
  score: number,
  confidence: number,
  flagged: boolean,
  details?: string,
): AnomalySignal {
  return {
    name,
    score: Math.min(100, Math.max(0, score)),
    confidence: Math.min(1, Math.max(0, confidence)),
    weight: BASE_SIGNAL_WEIGHTS[name] ?? 0.05,
    flagged,
    details,
  };
}
