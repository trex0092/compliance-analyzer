/**
 * Weaponized Brain — compose-over-MegaBrain orchestrator.
 *
 * This module does NOT modify `src/services/megaBrain.ts` (the existing
 * 13-subsystem orchestrator). Instead it calls `runMegaBrain()` and then
 * augments the result with six additional subsystems plus new safety
 * clamps tied to UAE AML/CFT/CPF regulation.
 *
 * All new subsystems are OPTIONAL — they fire only when the caller
 * provides the relevant input. Callers with partial data get back
 * everything MegaBrain produces plus whatever extensions their inputs
 * triggered; nothing is required to change on the caller side.
 *
 * New subsystems (numbered to continue MegaBrain's 13):
 *
 *  14. Adverse media ranking           — adverseMediaRanker
 *  15. UBO / layering / shell-company   — uboGraph + uboLayering
 *  16. VASP wallet portfolio risk        — vaspWalletScoring
 *  17. Transaction anomaly detectors    — transactionAnomaly (all 6)
 *  18. Explainable factor scoring       — explainableScoring
 *  19. zk-proof audit seal              — zkComplianceProof (Merkle)
 *
 * New safety clamps (applied AFTER MegaBrain's clamps, so they only
 * ever escalate the verdict, never downgrade):
 *
 *   - Sanctioned beneficial owner           → freeze
 *   - Confirmed illicit / sanctioned wallet → freeze
 *   - Critical adverse media hit(s)          → escalate
 *   - High-severity transaction structuring → escalate
 *   - Undisclosed UBO portion > 25%         → escalate
 *
 * Regulatory basis for the new clamps:
 *
 *   - Cabinet Res 74/2020 Art.4-7  (freeze protocol, 24h EOCN)
 *   - Cabinet Decision 109/2023    (UBO 25% threshold + re-verification)
 *   - FATF Rec 10                  (CDD on beneficial ownership)
 *   - FATF Rec 15                  (VASP / virtual asset providers)
 *   - Cabinet Res 134/2025 Art.14  (EDD triggers + PEP handling)
 *   - MoE Circular 08/AML/2021     (DPMS red flags, structuring)
 *   - FDL No.10/2025 Art.26-27     (STR filing obligations)
 *
 * The returned response preserves the full MegaBrain response verbatim
 * under the `mega` key, so downstream callers (the NORAD war room, the
 * four-eyes queue, the audit pack generator) can drill into either the
 * MegaBrain subsystems or the new extensions without losing fidelity.
 */

import { runMegaBrain, type MegaBrainRequest, type MegaBrainResponse } from './megaBrain';
import type { Verdict } from './teacherStudent';

// ---------------------------------------------------------------------------
// Advisor escalation — optional plug-in hook.
//
// Phase 1 weaponization: every high-stakes verdict (escalate/freeze, confidence
// below 0.7, or any safety clamp firing) gets double-checked by an Opus-class
// advisor via the Anthropic advisor tool (src/services/advisorStrategy.ts).
//
// The advisor never changes the deterministic verdict — compliance decisions
// stay auditable and reproducible. Instead, the advisor produces a concise
// rationale (<=100 words) that is appended to the audit narrative and to
// clampReasons so the MLRO reviewing the case sees the frontier model's
// reasoning alongside the mechanical subsystem outputs.
//
// The function is injected (not imported directly) so that:
//   1. Tests can provide a mock without touching the network.
//   2. Offline / air-gapped deployments can disable the advisor entirely.
//   3. The brain core stays browser-safe — no transitive fetch dependency.
// ---------------------------------------------------------------------------

export interface AdvisorEscalationInput {
  /** Why we're escalating to the advisor (e.g. 'freeze verdict + confidence 0.42'). */
  reason: string;
  /** Entity identifier for traceability — used by the advisor transcript. */
  entityId: string;
  /** Short human-readable label (e.g. 'Dirty Corp LLC'). */
  entityName: string;
  /** The current final verdict after weaponized clamps. */
  verdict: Verdict;
  /** Confidence in [0,1] after all clamps. */
  confidence: number;
  /** Clamp reasons produced so far (one per line). */
  clampReasons: readonly string[];
  /** The auto-built audit narrative (plain text). */
  narrative: string;
}

export interface AdvisorEscalationResult {
  /** Advisor's text output. Empty string means the call succeeded but produced no text. */
  text: string;
  /** Number of advisor sub-inferences that actually ran. */
  advisorCallCount: number;
  /** Model identifier used (e.g. 'claude-opus-4-6'). */
  modelUsed: string;
}

export type AdvisorEscalationFn = (
  input: AdvisorEscalationInput
) => Promise<AdvisorEscalationResult | null>;
import {
  rankAdverseMedia,
  type AdverseMediaHit,
  type AdverseMediaReport,
} from './adverseMediaRanker';
import { summariseUboRisk, type UboGraph, type UboRiskSummary } from './uboGraph';
import {
  analyseLayering,
  analyseShellCompany,
  type LayeringReport,
  type ShellCompanyReport,
} from './uboLayering';
import {
  summarisePortfolioWallets,
  type WalletDatabase,
  type PortfolioWalletRisk,
} from './vaspWalletScoring';
import { runAllDetectors, type Transaction, type DetectorSuiteResult } from './transactionAnomaly';
import { explainableScore, type ScoringInput, type Explanation } from './explainableScoring';
import {
  sealComplianceBundle,
  type ComplianceProofBundle,
  type ComplianceRecord,
} from './zkComplianceProof';
import { DEFAULT_CLAMP_POLICY, type ClampPolicy } from './clampPolicy';
import { redTeamCritique, type RedTeamChallenge } from './redTeamCritic';
import { queryPrecedents, type PrecedentRecord, type PrecedentReport } from './precedentRetriever';
import {
  detectContradictions,
  type ContradictionReport,
  type SubsystemSignal,
} from './contradictionDetector';
import {
  runRegulatorVoicePass,
  type RegulatorVoiceInput,
  type RegulatorVoiceReport,
} from './regulatorVoicePass';
import { calibrateConfidence, type CalibrationParams } from './confidenceCalibrator';
import { computeCounterfactuals, type CounterfactualReport } from './counterfactualFlipper';
import {
  detectTemporalPatterns,
  type TemporalEvent,
  type TemporalPatternReport,
} from './temporalPatternDetector';
import {
  matchTypologies,
  type TypologySignals,
  type TypologyMatchReport,
} from './sanctionsEvasionTypologyMatcher';
import { detectNarrativeDrift, type PriorFiling, type DriftReport } from './narrativeDriftDetector';
import {
  correlateAcrossCustomers,
  type CustomerSnapshot,
  type CorrelationReport,
} from './crossCustomerCorrelator';
import { reviewExtensions, type TeacherExtensionReport } from './teacherExtensionReviewer';
import {
  runDeepResearch,
  type DeepResearchDeps,
  type DeepResearchResult,
  type EntityContext,
  type ResearchPurpose,
} from './deepResearchEngine';

// --- Phase 3 imports (#31-#40) ---
import { analyseBenford, type BenfordReport } from './benfordAnalyzer';
import { detectAdversarial, type AdversarialReport } from './adversarialMlDetector';
import {
  detectAdvisorHallucinations,
  type HallucinationReport,
} from './advisorHallucinationDetector';
import {
  propagateTaint,
  type TaintGraph,
  type TaintConfig,
  type TaintReport,
} from './taintPropagator';
import {
  calculateSelfAuditScore,
  type SelfAuditInput,
  type SelfAuditResult,
} from './selfAuditScore';
import {
  detectVerdictDrift,
  type DriftInput as VerdictDriftInput,
  type DriftReport as VerdictDriftReport,
} from './verdictDriftMonitor';
import {
  checkKycConsistency,
  type KycDocument,
  type ConsistencyReport as KycConsistencyReport,
} from './semanticKycConsistencyChecker';
import {
  assessBuyBackRisk,
  type BuyBackTransaction,
  type BuyBackRiskAssessment,
} from './buyBackRisk';
import {
  assessPriceAnomaly,
  type PricedTransaction,
  type BenchmarkPrice,
  type PriceAnomaly as PriceAnomalyResult,
} from './priceAnomaly';
import {
  computeBftConsensus,
  type BftVote,
  type BftConsensusReport,
} from './byzantineFaultTolerant';

// --- Phase 4-10 imports: ESG, TBML, PEP, Hawala, STR, Cross-border, Ensemble ---
import { calculateEsgScore, type EsgInput, type EsgScore } from './esgScorer';
import {
  estimateCarbonFootprint,
  type CarbonFootprintInput,
  type CarbonFootprintReport,
} from './carbonFootprintEstimator';
import {
  checkTcfdAlignment,
  type TcfdAlignmentInput,
  type TcfdAlignmentReport,
} from './tcfdAlignmentChecker';
import {
  scoreUnSdgAlignment,
  type SdgEvidenceInput,
  type UnSdgReport,
} from './unSdgAlignmentScorer';
import {
  screenConflictMinerals,
  type MineralSupplier,
  type ConflictMineralsReport,
} from './conflictMineralsScreener';
import {
  detectGreenwashing,
  type EsgDisclosure,
  type GreenwashingReport,
} from './greenwashingDetector';
import {
  classifyEsgAdverseMedia,
  type AdverseMediaHitInput,
  type EsgAdverseMediaReport,
} from './esgAdverseMediaClassifier';
import {
  assessModernSlaveryRisk,
  type WorkforceProfile,
  type ModernSlaveryReport,
} from './modernSlaveryDetector';
import { detectTbml, type TbmlTransaction, type TbmlAssessment } from './tradeBasedMLDetector';
import { enforceFourEyes, type ApprovalSubmission, type FourEyesResult } from './fourEyesEnforcer';
import {
  classifyFiling,
  type ClassificationInput,
  type ClassificationResult,
} from './strAutoClassifier';
import {
  scorePepProximity,
  type PepProximityInput,
  type PepProximityScore,
} from './pepProximityScorer';
import { detectHawala, type HawalaTransaction, type HawalaDetectionResult } from './hawalaDetector';
import { runAnomalyEnsemble, buildSignal, type EnsembleResult } from './anomalyEnsemble';
import {
  monitorCrossBorderCash,
  type CrossBorderRiskInput,
  type CrossBorderAssessment,
} from './crossBorderCashMonitor';
import {
  orchestrateBrainToAsana,
  type AsanaOrchestratorConfig,
  type OrchestratorResult,
} from './brainToAsanaOrchestrator';
import { generateMlroAlerts, type MlroAlertBundle } from './mlroAlertGenerator';
import { buildKpiReport, type KpiReport } from './complianceMetricsDashboard';
import {
  generateHawkeyeReport,
  type HawkeyeReport,
  type HawkeyeReportInput,
} from './hawkeyeReportGenerator';
import {
  checkAiGovernance,
  type AiGovernanceReport,
  type AiGovernanceInput,
} from './aiGovernanceChecker';
import {
  scoreEsgAdvancedFramework,
  type EsgAdvancedReport,
  type EsgAdvancedInput,
} from './esgAdvancedFrameworkScorer';

// --- Phase 11 imports: Security, Deduplication, STR Narrative, Predictive, Penalty, Gold ---
import { detectPromptInjection, type InjectionReport } from './adversarialPromptInjectionDetector';
import {
  detectDeepfakeDocument,
  type DocumentEvidence,
  type DeepfakeReport,
} from './deepfakeDocumentDetector';
import {
  dedupeCrossListHits,
  type RawListHit,
  type DedupeReport,
} from './crossListSanctionsDedupe';
import {
  buildStrNarrative,
  type StrNarrativeInput,
  type StrNarrative,
} from './strNarrativeBuilder';
import { predictStr, type StrFeatures, type StrPrediction } from './predictiveStr';
import { runPenaltyVaR, UAE_DPMS_VIOLATIONS, type VaRReport, type VaRConfig } from './penaltyVaR';
import { traceGoldOrigin, type GoldShipment, type OriginTraceReport } from './goldOriginTracer';
import {
  matchAssayCertificates,
  type AssayCertificateClaim,
  type AssayMatchReport,
  type RefinerLookup,
} from './assayCertificateMatcher';
import {
  detectFinenessAnomalies,
  type FinenessClaim,
  type FinenessReport,
} from './finenessAnomalyDetector';
import {
  detectCrossBorderArbitrage,
  type CustomerFootprint,
  type ArbitrageReport,
} from './crossBorderArbitrageDetector';
import {
  detectDormancyActivity,
  type DormancyTransaction,
  type DormancyReport,
} from './dormancyActivityDetector';
import { expandNameVariants, type NameVariantReport } from './nameVariantExpander';
import { gradeStrNarrative, type StrGradeReport } from './strNarrativeGrader';
import {
  resolveAgentsForVerdict,
  spawnManagedAgent,
  createOrchestratorSession,
  type ManagedAgentTask,
  type OrchestratorSession,
} from './managedAgentOrchestrator';

// --- Phase 12 imports (#73-#97): Corporate graph, causal engine, game theory,
//     LBMA, melt loss, free zone, tipping-off, Shapley, invariant verification,
//     quantum seal, peer anomaly, time-travel audit, goAML XML, Bayesian belief,
//     rule induction, document intelligence, regulatory drift, EU AI Act,
//     case-based reasoning, multi-model screening, synthetic evasion ---

import {
  walkCorporateGraph,
  type CorporateGraph,
  type NodePredicate,
  type GraphWalkReport,
} from './corporateGraphWalker';
import {
  analyseOwnershipMotifs,
  type OwnershipEdge,
  type MotifReport,
} from './graphMotifUboAnalyzer';
import {
  runMultiModelScreening,
  type MultiModelScreeningRequest,
  type ConsensusResult as MultiModelConsensusResult,
} from './multiModelScreening';
import {
  createCausalGraph,
  runCounterfactual,
  type CausalNode,
  type Assignment,
} from './causalEngine';
import { runDebate, type DebateInput, type DebateVerdict } from './debateArbiter';
import { reviewReasoningChain, type CriticConfig, type ReflectionReport } from './reflectionCritic';
import {
  detectCircularReasoning,
  type DependencyEdge,
  type CircularReport,
} from './circularReasoningDetector';
import {
  solveAdversaryGame,
  type DetectionStrategy,
  type EvasionStrategy,
  type EquilibriumReport,
} from './gameTheoryAdversary';
import {
  checkLbmaFixDeviations,
  type GoldTrade,
  type FixLookup,
  type FixCheckConfig,
  type FixCheckReport,
} from './lbmaFixPriceChecker';
import {
  assessMeltBatch,
  detectRefinerDrift,
  type MeltBatch,
  type MeltLossAssessment,
} from './meltLoss';
import {
  checkFreeZoneCompliance,
  type EntityFacts as FreeZoneEntityFacts,
  type FreeZoneCheckResult,
} from './freeZoneRules';
import { lintForTippingOff, type TippingOffReport } from './tippingOffLinter';
import {
  computeShapleyAttribution,
  type VerdictFn,
  type ShapleyInput,
  type ShapleyReport,
} from './shapleyExplainer';
import {
  verifyInvariants,
  CANONICAL_INVARIANTS,
  type VerifyReport as InvariantVerifyReport,
} from './formalInvariantVerifier';
import {
  sealQuantumResistant,
  type QuantumSealRecord,
  type QuantumSealBundle,
} from './quantumResistantSeal';
import { analysePeerAnomaly, type PeerAnomalyInput, type PeerAnomalyReport } from './peerAnomaly';
import {
  currentState,
  criticalPath,
  type EvidenceEntry,
  type CaseSnapshot,
} from './timeTravelAudit';
import { buildGoAMLXml } from './goamlBuilder';
import {
  runBeliefUpdate,
  uniformPrior,
  type Hypothesis,
  type Evidence as BayesEvidence,
  type BeliefReport,
} from './bayesianBelief';
import {
  learnDecisionTree,
  extractRules,
  type LabeledSample,
  type LearnedRule,
  type InductionConfig,
} from './ruleInduction';
import { runTamperChecks, type DocumentExtractionResult } from './documentIntelligence';
import { analyseDrift, type DriftSample, type PortfolioDriftReport } from './regulatoryDrift';
import { buildReadinessPayloads, type ReadinessScaffoldResult } from './euAiActReadinessProject';
import { CaseMemory, type ReuseRecommendation } from './caseBasedReasoning';
import {
  generateSyntheticEvasionCases,
  type SyntheticCase,
  type GenerateConfig as SyntheticGenerateConfig,
} from './syntheticEvasionGenerator';

// --- Phase 13 imports (#99-#103) — read-only reasoning & analysis ---
import {
  runFactorAblation,
  checkCitationIntegrity,
  buildReasoningDag,
  runBenignNarrativeProbe,
  runEvidenceFreshness,
  type FactorAblationReport,
  type CitationIntegrityReport,
  type ReasoningDagReport,
  type BenignNarrativeResult,
  type BenignNarrativeGenerator,
  type EvidenceFreshnessReport,
  type DatedSignal,
} from './weaponizedPhase13';

// --- Phase 14 imports (#104-#109) — intelligence & awareness ---
import {
  detectCrossJurisdictionConflicts,
  runPeerGroupDeviation,
  runRegulatoryCalendar,
  scoreInterSubsystemAgreement,
  runCounterfactualCompletion,
  type CrossJurisdictionConflictReport,
  type PeerDeviationReport,
  type PeerGroupDistribution,
  type RegulatoryCalendarReport,
  type RegulatoryDeadline,
  type AgreementScore,
  type CounterfactualCompletionReport,
  type JurisdictionCode,
  type ProposedAction,
} from './weaponizedPhase14';

// --- Phase 15 imports (#110-#114) — adaptive meta-planning, self-learning,
//     reasoning chain, threshold calibration, pattern mining, hypothesis
//     generation. All diagnostic — none mutate the final verdict.
import {
  runAdaptiveMeta,
  composeReasoningChain,
  calibrateThresholds,
  minePatternClusters,
  generateHypotheses,
  createInMemoryReliabilityRegistry,
  type ReliabilityRegistry,
  type AdaptiveMetaReport,
  type ReasoningChainReport,
  type ThresholdCalibrationReport,
  type LabeledOutcomeSample,
  type PatternMiningReport,
  type PastCaseSignature,
  type HypothesisReport,
  type Hypothesis as AdaptiveHypothesis,
  type AgedSignal,
} from './weaponizedPhase15';

// ---------------------------------------------------------------------------
// Verdict ordering — verdicts can only escalate under new clamps.
// ---------------------------------------------------------------------------

const VERDICT_RANK: Record<Verdict, number> = {
  pass: 0,
  flag: 1,
  escalate: 2,
  freeze: 3,
};

function escalateTo(current: Verdict, proposed: Verdict): Verdict {
  return VERDICT_RANK[proposed] > VERDICT_RANK[current] ? proposed : current;
}

// ---------------------------------------------------------------------------
// Request + Response types
// ---------------------------------------------------------------------------

export interface WeaponizedBrainRequest {
  /** The base MegaBrain request — runs verbatim through runMegaBrain(). */
  mega: MegaBrainRequest;

  /** Adverse media hits to rank. Triggers subsystem 14 if non-empty. */
  adverseMedia?: readonly AdverseMediaHit[];

  /** UBO graph + target entity id. Triggers subsystem 15 if present. */
  ubo?: {
    graph: UboGraph;
    targetId: string;
  };

  /** Crypto wallets held by the entity. Triggers subsystem 16 if present. */
  wallets?: {
    db: WalletDatabase;
    addresses: readonly string[];
  };

  /** Transactions for anomaly detection. Triggers subsystem 17 if non-empty. */
  transactions?: readonly Transaction[];

  /**
   * Pre-computed explainable scoring input. Optional — if omitted, we
   * derive a default input from the MegaBrain request and the other
   * extension outputs. Subsystem 18 always runs.
   */
  explainabilityInput?: ScoringInput;

  /**
   * Whether to seal the decision with a Merkle-tree zk-compliance proof
   * bundle. Default: true. Set to false in performance-sensitive paths
   * (e.g. high-volume batch screening) where the proof is not needed
   * per-call.
   */
  sealProofBundle?: boolean;

  /**
   * Optional advisor escalation hook. If provided, the brain will call this
   * function when any of the six mandatory compliance triggers fires (see
   * COMPLIANCE_ADVISOR_SYSTEM_PROMPT in advisorStrategy.ts):
   *
   *  - final verdict is 'escalate' or 'freeze'
   *  - confidence drops below 0.7 after clamps
   *  - any safety clamp triggered (undisclosed UBO, structuring, critical
   *    adverse media, sanctioned wallet, sanctioned UBO)
   *
   * The advisor's text is appended to `auditNarrative` and surfaced as a
   * clamp reason prefixed with 'ADVISOR:'. Failures are logged and the
   * verdict proceeds without advisor input — compliance decisions never
   * block on the advisor.
   *
   * Regulatory basis for the escalation: FDL No.10/2025 Art.20-21 (CO
   * duty of care), Cabinet Res 134/2025 Art.19 (internal review).
   */
  advisor?: AdvisorEscalationFn;

  // --- Phase 2 weaponization — 11 new subsystems, all optional ---

  /**
   * Clamp policy override. Defaults to DEFAULT_CLAMP_POLICY. Tests and
   * backtest runs can override specific thresholds without touching code.
   */
  clampPolicy?: Readonly<ClampPolicy>;

  /**
   * Precedent index for subsystem #21 (precedent retriever). If omitted
   * the retriever is skipped. Factor vectors must be the same dimension
   * as the explainable scoring factor vector.
   */
  precedentIndex?: readonly PrecedentRecord[];

  /**
   * Historical (raw_confidence, outcome) examples for subsystem #24
   * (confidence calibrator). If omitted, no calibration is applied.
   */
  calibrationParams?: CalibrationParams;

  /**
   * Historical temporal events for subsystem #26 (temporal pattern
   * detector). The detector looks at events with `entityId === req.mega.entity.id`
   * within the policy.temporalWindowDays window. Omit to skip.
   */
  temporalEvents?: readonly TemporalEvent[];

  /**
   * Signals for subsystem #27 (typology matcher). If omitted, the matcher
   * is still run with an empty signal set (producing zero hits).
   */
  typologySignals?: TypologySignals;

  /**
   * Prior filings library for subsystem #28 (narrative drift detector).
   * Also requires `draftNarrative` and `draftTypology`. If any is missing,
   * the detector is skipped.
   */
  priorFilings?: readonly PriorFiling[];

  /** Draft STR/SAR/CTR/DPMSR/CNMR narrative for subsystem #28. */
  draftNarrative?: string;

  /** Draft filing typology label for subsystem #28 (e.g. 'STR', 'DPMSR'). */
  draftTypology?: string;

  /**
   * Peer customer snapshots for subsystem #29 (cross-customer correlator).
   * Typically passed by brainBridge from the customer registry.
   */
  peerCustomerSnapshots?: readonly CustomerSnapshot[];

  /**
   * Evidence flags for subsystem #23 (regulator voice pass). Missing
   * flags are treated as "absent" so the pass surfaces the gap. Omit to
   * skip the regulator voice pass entirely.
   */
  regulatorEvidence?: RegulatorVoiceInput['evidence'];

  // --- Phase 3 weaponization — 10 ultra subsystems (#31-#40), all optional ---

  /**
   * Transaction amounts (AED) for #31 Benford's Law ledger analysis.
   * Requires >= 30 values for chi-square significance (Nigrini 2012).
   * Non-conformity → escalate as possible ledger manipulation.
   * (FATF Rec 10 / MoE Circular 08/AML/2021 DPMS ledger tampering)
   */
  benfordAmounts?: readonly number[];

  /**
   * Free-form text for #32 Adversarial ML Detector. Defaults to
   * entity.name if omitted. Enrich with narrative text or KYC dossier
   * excerpts to give the detector a larger attack surface to scan.
   * The subsystem always runs — this field only enriches its input.
   * (NIST AI RMF GV-1.6 / EU AI Act Art.15 / FATF Rec 6)
   */
  adversarialInputText?: string;

  /**
   * Wallet taint graph for #34 Taint Propagator. entityWallets are
   * the addresses belonging to the entity under review. Any entity
   * wallet carrying residual taint >= walletConfirmedConfidenceCap
   * triggers a freeze clamp.
   * (FATF Rec 15 / Cabinet Res 74/2020 Art.4-7)
   */
  taintGraph?: {
    graph: TaintGraph;
    entityWallets: readonly string[];
    config?: TaintConfig;
  };

  /**
   * Self-audit facts for #35 MoE readiness score (0-100 across 8
   * dimensions). Typically supplied by the MLRO dashboard or the
   * session-start hook. Scores below 60 surface a clamp advisory.
   * (Cabinet Res 134/2025 Art.19 / NIST AI RMF GV-1.6)
   */
  selfAuditInput?: SelfAuditInput;

  /**
   * Verdict distribution data for #36 Verdict Drift Monitor. Typically
   * generated by the weekly scheduling engine and injected here for
   * per-case meta-audit. Drift detected → advisory clamp only (not a
   * verdict flip — the meta-signal informs ops, not case decisions).
   * (NIST AI RMF MS-2.1 / EU AI Act Art.72)
   */
  verdictDriftInput?: VerdictDriftInput;

  /**
   * KYC documents for #37 Semantic KYC Consistency Checker. Requires
   * >= 2 documents with overlapping structured fields. Critical
   * inconsistency (name mismatch, DoB conflict, etc.) → escalate.
   * (FDL Art.12-14 / FATF Rec 10 / Cabinet Decision 109/2023)
   */
  kycDocuments?: readonly KycDocument[];

  /**
   * Buy-back (cash-for-gold inbound) transactions for #38 Buy-Back
   * Risk Engine. All transactions are assessed; the worst-case score
   * drives the verdict. Critical → escalate.
   * (MoE Circular 08/AML/2021 §4 / FATF DPMS Typologies 2022)
   */
  buyBackTransactions?: readonly BuyBackTransaction[];

  /**
   * Priced transactions + LBMA/DGD benchmark for #39 Price Anomaly.
   * Every transaction of the same metal is assessed against the
   * provided benchmark. Critical deviation → escalate.
   * (FATF Rec 20 / Cabinet Res 134/2025 Art.19)
   */
  priceAnomalyInput?: {
    transactions: readonly PricedTransaction[];
    benchmark: BenchmarkPrice;
  };

  /**
   * External sanctions source votes for #40 BFT Consensus. Each vote
   * represents one screening source's result ('match' | 'no-match').
   * If omitted, BFT falls back to internal votes from deterministic
   * subsystems (megaBrain, typology, explainable scoring, etc.).
   * Minimum 4 votes for BFT quorum (3f+1, f=1). Insufficient
   * consensus → advisory clamp + human review.
   * (Cabinet Res 134/2025 Art.19 / NIST AI RMF GV-1.6 / FATF Rec 6)
   */
  sanctionsSourceVotes?: readonly BftVote<string>[];

  // ─── Phase 4-10: ESG, TBML, PEP proximity, Hawala, STR, Cross-border ──────

  /** #41 ESG composite score (ISSB IFRS S1/S2, GRI 2021, LBMA RGG v9). */
  esgInput?: EsgInput;

  /** #42 Carbon footprint — Scope 1/2/3 for gold supply chain (IFRS S2). */
  carbonInput?: CarbonFootprintInput;

  /** #43 TCFD alignment checker — 4-pillar disclosure completeness. */
  tcfdInput?: TcfdAlignmentInput;

  /** #44 UN SDG alignment scorer — 17 goals with DPMS sector weighting. */
  sdgEvidence?: { entityId: string; reportingYear: number; evidence: SdgEvidenceInput };

  /** #45 Conflict minerals screener — CAHRA/Dodd-Frank §1502/EU CMR/OECD DDG. */
  conflictMineralSuppliers?: MineralSupplier[];

  /** #46 Greenwashing detector — ESG disclosure integrity (ISSB S1/EU SFDR). */
  esgDisclosure?: EsgDisclosure;

  /** #47 ESG adverse media classifier — ESG signal extraction from adverse media. */
  esgAdverseMediaHits?: AdverseMediaHitInput[];

  /** #48 Modern slavery risk — ILO 11 indicators + UAE Federal Law 51/2006. */
  workforceProfile?: WorkforceProfile;

  /** #49 TBML detector — over/under-invoicing, phantom trades, round-trips. */
  tbmlTransaction?: TbmlTransaction;

  /** #50 Four-eyes enforcer — dual-approval for high-stakes decisions. */
  fourEyesSubmission?: ApprovalSubmission;

  /** #51 STR/SAR/CTR auto-classifier — derives filing category + deadline. */
  filingClassificationInput?: ClassificationInput;

  /** #52 PEP proximity scorer — 1st/2nd/3rd-degree PEP network links. */
  pepProximityInput?: PepProximityInput;

  /** #53 Hawala / IVTS detector — informal value transfer patterns. */
  hawalaTransaction?: HawalaTransaction;

  /** #54 Cross-border cash monitor — AED 60K threshold + structuring. */
  crossBorderMovement?: CrossBorderRiskInput;

  // ─── Synthesis Layer: Asana, MLRO Alerts, KPI Dashboard ──────────────────

  /**
   * Asana orchestrator config — if supplied, every freeze/escalate/flag
   * verdict automatically creates an Asana task tree (parent + subtasks).
   * Uses the existing asanaClient + retry queue.
   */
  asanaConfig?: AsanaOrchestratorConfig;

  /**
   * KPI measurements for the compliance metrics dashboard.
   * Produces a 30-KPI report aligned to MoE / FIU / FATF ME.
   */
  kpiMeasurements?: Array<{
    kpiId: string;
    value: number | string | boolean;
    unit?: string;
    notes?: string;
    trend?: 'improving' | 'stable' | 'deteriorating' | 'unknown';
  }>;
  /** Reporting period for KPI dashboard (ISO dates). */
  kpiPeriod?: { start: string; end: string };

  /**
   * Hawkeye Sterling V2 report metadata — enriches the generated report
   * with screening officer, jurisdiction, DOB, ID numbers, group name.
   */
  hawkeyeReportMeta?: Omit<HawkeyeReportInput, 'brain'>;

  /**
   * AI Governance Checklist input — runs the 10-point pre-deployment
   * governance assessment (NIST AI RMF + EU AI Act + UAE AI Ethics).
   */
  aiGovernanceInput?: AiGovernanceInput;

  /**
   * ESG Advanced Framework input — CSRD, SASB, Double Materiality,
   * Stranded Assets, Climate VAR, Green Bond, SLL, Carbon Credits.
   */
  esgAdvancedInput?: EsgAdvancedInput;

  // --- Phase 11 inputs (#59-#72) ---

  /** #60 Deepfake document detector — KYC document evidence. */
  documentEvidence?: DocumentEvidence;
  /** #61 Cross-list dedupe — raw hits from all 6 sanctions lists. */
  rawSanctionsHits?: RawListHit[];
  /** #62 STR narrative builder — structured evidence for goAML narrative. */
  strNarrativeInput?: StrNarrativeInput;
  /** #63 Predictive STR — feature vector for probability model. */
  strFeatures?: StrFeatures;
  /** #64 Penalty VaR — active violations list. */
  penaltyViolations?: import('./penaltyVaR').ViolationType[];
  /** #64 Penalty VaR — config override. */
  penaltyVarConfig?: VaRConfig;
  /** #65 Gold origin tracer — list of gold shipments to trace. */
  goldShipments?: GoldShipment[];
  /** #66 Assay certificate matcher — certificate claims to validate. */
  assayCertificateClaims?: AssayCertificateClaim[];
  /** #67 Fineness anomaly — fineness claims from refiner documentation. */
  finenessClaims?: FinenessClaim[];
  /** #68 Cross-border arbitrage — customer trading footprint. */
  customerFootprint?: readonly CustomerFootprint[];
  /**
   * Optional accredited-refiner lookup for the assay certificate matcher
   * (#66). When omitted we fall back to a null-object lookup that treats
   * every refiner as unaccredited — the safe default for a compliance
   * gate.
   */
  refinerLookup?: RefinerLookup;
  /**
   * Optional observed assignment for the causal counterfactual engine.
   * Defaults to `{}` when omitted (all nodes at prior).
   */
  causalObservation?: Record<string, 0 | 1>;
  /**
   * Optional target node id to read the counterfactual from. Defaults
   * to the first declared node id when omitted.
   */
  causalTarget?: string;
  /** #70 Dormancy detector — transaction history timeline. */
  dormancyTransactions?: DormancyTransaction[];

  // --- Phase 12 inputs (#73-#97) ---

  /**
   * #73 Corporate graph walker — directed graph of corporate entities.
   * Walks from the queryId node up to maxHops, applying a flagging predicate.
   * Hits on sanctioned/high-risk subsidiaries → escalate.
   * (FATF Rec 10 / Cabinet Decision 109/2023 UBO register)
   */
  corporateGraph?: {
    graph: CorporateGraph;
    queryId: string;
    predicate?: NodePredicate;
    maxHops?: number;
  };

  /**
   * #74 Graph motif UBO analyzer — ownership edge list for circular/star/
   * cascade motif detection. Threshold defaults to 25% (Cabinet Decision 109/2023).
   * Layering motifs → escalate.
   */
  ownershipEdges?: readonly OwnershipEdge[];

  /**
   * #75 Multi-model screening (async) — runs the same entity through multiple
   * AI models and returns consensus. Requires apiKey and model list. If omitted
   * the subsystem is skipped. Confirmed-match consensus → escalate + confidence cap.
   * (Cabinet Res 134/2025 Art.5 / FATF Rec 1 — risk appetite + multi-source screening)
   */
  multiModelScreening?: {
    request: MultiModelScreeningRequest;
    apiKey: string;
    models?: readonly string[];
  };

  /**
   * #76 Causal engine — nodes define the DAG; interventions are applied to
   * test what changes the verdict. Counterfactual result is recorded in extensions.
   * No clamp — purely evidence for the MLRO to see causal paths.
   */
  causalNodes?: readonly CausalNode[];
  /** Causal engine intervention to test (e.g. `{ pepStatus: 0 }`). */
  causalIntervention?: Assignment;

  /**
   * #77 Debate arbiter — structured pro/con arguments about the verdict.
   * If the con side wins decisively (margin > 0.4) → adds advisory clamp.
   * Provides the MLRO with a balanced two-sided analysis.
   */
  debateInput?: DebateInput;

  /**
   * #78 Reflection critic — reviews the MegaBrain reasoning chain for
   * missing node types, low coverage, or structural issues. Critical issues
   * → confidence cap 0.65. (NIST AI RMF MS-2.2 / EU AI Act Art.72)
   */
  reflectionConfig?: CriticConfig;

  /**
   * #79 Circular reasoning detector — dependency edges among subsystem
   * conclusions. Cycles → advisory clamp + confidence cap 0.70.
   * (NIST AI RMF GV-1.6 / FDL Art.20-21 CO duty of care)
   */
  dependencyEdges?: readonly DependencyEdge[];

  /**
   * #80 Game theory adversary — evasion game between compliance detection
   * strategies and money-laundering evasion strategies. Nash equilibrium
   * surfaces the top attacker strategy so the MLRO can anticipate it.
   * High attacker payoff → advisory clamp.
   * (FATF Rec 1 — risk-based approach / NIST AI RMF GV-1.6)
   */
  gameTheoryStrategies?: {
    detectionStrategies: readonly DetectionStrategy[];
    evasionStrategies: readonly EvasionStrategy[];
  };

  /**
   * #81 LBMA gold price fix checker — trades to validate against LBMA/CBUAE
   * benchmarks. Frozen trades → clamp freeze. Flagged → escalate.
   * (LBMA RGG v9 / FATF DPMS Typologies 2022 — price manipulation)
   */
  lbmaFixInput?: {
    trades: readonly GoldTrade[];
    lookup: FixLookup;
    config?: FixCheckConfig;
  };

  /**
   * #82 Melt loss — assay + refiner batch analysis. Critical melt loss
   * deviation → escalate. Refiner drift detection surfaces systemic tampering.
   * (LBMA RGG v9 §4 / MoE Circular 08/AML/2021 / Dubai Good Delivery)
   */
  meltBatch?: MeltBatch;
  /** Refiner drift: historical batches from the same refiner. */
  meltRefinerHistory?: readonly MeltBatch[];

  /**
   * #83 Free zone compliance checker — validates entity facts against the
   * rule set for DMCC, JAFZA, DIFC, ADGM, or mainland UAE.
   * Mandatory failures → escalate.
   * (Cabinet Res 134/2025 / DMCC Rules 2024 / ADGM FSMR)
   */
  freeZoneFacts?: FreeZoneEntityFacts;

  /**
   * #84 Tipping-off linter (FDL Art.29) — automatically scans the audit
   * narrative, MLRO alerts, and STR narrative for disclosure-risk phrases.
   * Always-on once the narrative is built. Any tipping-off finding →
   * HARD clamp + mandatory redaction before the report leaves the system.
   * (FDL No.10/2025 Art.29 — no tipping off, penalty up to AED 5M)
   */
  // No input needed — lints the generated narrative automatically.

  /**
   * #85 Shapley explainer — feature attribution for the final verdict score.
   * If omitted, auto-builds a ShapleyInput from the explainable scoring output.
   * Produces per-factor contribution values for the MLRO dashboard.
   * (EU AI Act Art.13 — transparency / NIST AI RMF MS-2.5)
   */
  shapleyInput?: ShapleyInput;

  /**
   * #86 Formal invariant verifier — validates the verdict state against
   * CANONICAL_INVARIANTS (plus any custom invariants). Violations → advisory
   * clamp + confidence cap 0.60. Catches impossible state combinations.
   * (NIST AI RMF GV-1.6 / EU AI Act Art.9 — risk management system)
   */
  customInvariants?: readonly import('./formalInvariantVerifier').Invariant<WeaponizedBrainResponse>[];

  /**
   * #87 Synthetic evasion generator — generates evasion test cases and checks
   * if the current verdict would catch them. Coverage gaps → advisory clamp.
   * (FATF Guidance on Red Flags 2021 / NIST AI RMF GV-1.6)
   */
  syntheticEvasionConfig?: SyntheticGenerateConfig;

  /**
   * #88 Quantum-resistant seal — SHA-3/512-based post-quantum audit seal for
   * the full brain response. Complements the Merkle ZK proof (#19) with a
   * quantum-resistant hash. Always produces a QuantumSealBundle.
   * (FDL Art.24 10yr retention / NIST Post-Quantum Cryptography Framework)
   */
  // No input needed — seals the final response automatically.

  /**
   * #89 Peer anomaly — statistical z-score analysis of the entity's risk
   * features against a peer group. Anomalous outliers → flag clamp.
   * (FATF Rec 10 / Cabinet Res 134/2025 Art.5 risk appetite)
   */
  peerAnomalyInput?: PeerAnomalyInput;

  /**
   * #90 Time-travel audit — evidence entries for the current case, enabling
   * MLRO to replay the decision at any historical point.
   * Critical path of evidence is surfaced for audit pack generation.
   * (FDL Art.24 10yr retention / Cabinet Res 134/2025 Art.19 internal review)
   */
  auditEvidenceEntries?: readonly EvidenceEntry[];
  /** Target case reference ID for time-travel replay queries. */
  auditCaseRefId?: string;

  /**
   * #91 Document intelligence — runs tamper checks on uploaded documents.
   * Critical tamper signals → escalate. Always triggers when documentEvidence
   * is present (#60 deepfake). This is the structural extraction layer.
   * (FDL Art.12-14 CDD / FATF Rec 10 / Cabinet Decision 109/2023)
   */
  documentForTamperCheck?: {
    documentId: string;
    documentType: import('./documentIntelligence').DocumentType;
    rawText?: string;
    base64Image?: string;
  };

  /**
   * #92 Regulatory drift — compares the current entity's risk feature
   * distribution against a historical baseline to detect concept drift.
   * Significant drift → advisory clamp + re-calibration warning.
   * (NIST AI RMF MS-2.1 / EU AI Act Art.72 post-market monitoring)
   */
  regulatoryDriftSamples?: {
    baseline: readonly DriftSample[];
    current: readonly DriftSample[];
  };

  /**
   * #93 goAML XML builder — auto-generates a compliant goAML XML filing
   * from the SuspicionReport domain object if present.
   * Only fires when strNarrativeInput or filingClassificationInput is provided
   * and the filing type requires XML submission.
   * (UAE FIU goAML Schema / MoE Circular 08/AML/2021)
   */
  goamlReport?: import('../domain/reports').SuspicionReport;
  /** Optional linked case and customer for goAML XML. */
  goamlCase?: import('../domain/cases').ComplianceCase;
  goamlCustomer?: import('../domain/customers').CustomerProfile;

  /**
   * #94 Bayesian belief network — updates prior belief about entity risk
   * given the weight of evidence from all subsystems. Returns posterior
   * probabilities and Shannon entropy (uncertainty measure).
   * (FDL Art.20-21 / FATF Rec 10 — evidence-based risk assessment)
   */
  bayesianHypotheses?: readonly Hypothesis[];
  /** Evidence array to pass into the Bayesian belief update chain. */
  bayesianEvidence?: readonly BayesEvidence[];

  /**
   * #95 Case-based reasoning — retrieves top-K similar past cases from a
   * CaseMemory instance and recommends a verdict by analogy.
   * High-confidence precedent → advisory note on the verdict.
   * (FDL Art.20-21 / FATF Rec 10 — risk-based approach + institutional memory)
   */
  caseMemory?: CaseMemory;

  /**
   * #96 EU AI Act readiness — scaffolds the EU AI Act high-risk system
   * readiness payloads (Article 9, 10, 13, 14, 15, 72 checklist).
   * Only fires when aiGovernanceInput is present (composites with #57).
   * (EU AI Act 2024 Arts 9-15, 72 / NIST AI RMF MANAGE)
   */
  euAiActProjectGid?: string;

  /**
   * #97 Rule induction — learns a decision tree from the session's labeled
   * samples and extracts human-readable rules for the MLRO.
   * Provides interpretable logic behind the Bayesian/ensemble verdict.
   * (EU AI Act Art.13 — transparency / NIST AI RMF MS-2.5 explainability)
   */
  inductionSamples?: readonly LabeledSample[];
  inductionConfig?: InductionConfig;

  /**
   * #98 Deep research request. When present, the brain runs the iterative
   * deepResearchEngine using the injected backends. Caller owns the
   * search/extract/reason functions — this keeps the brain browser-safe and
   * lets tests stub external I/O. Returns nothing if `deps` is omitted.
   *
   * Regulatory basis:
   *   - FDL No.10/2025 Art.19  (risk-based internal review)
   *   - FDL No.10/2025 Art.24  (audit trail of every external call)
   *   - FDL No.10/2025 Art.29  (no tipping off — PII redactor in the engine)
   *   - Cabinet Res 134/2025 Art.14 (PEP / EDD enhanced research)
   *   - FATF Rec 10            (ongoing monitoring; adverse media input)
   */
  deepResearch?: {
    question: string;
    entity: EntityContext;
    purpose: ResearchPurpose;
    deps: DeepResearchDeps;
    maxIterations?: number;
    maxQueriesPerIteration?: number;
    deadlineMs?: number;
  };

  // --- Phase 13 inputs (#99-#103) — reasoning & analysis, all optional ---

  /**
   * #102 Benign-narrative generator. When supplied, the brain generates
   * a counter-hypothesis ("most innocent interpretation") alongside the
   * adversarial verdict. Browser-safe: the caller owns the LLM/heuristic
   * backend so this module stays network-free.
   * Regulatory basis: EU AI Act Art.15 (bias/fairness), FATF Rec 10.
   */
  benignNarrativeGenerator?: BenignNarrativeGenerator;

  /**
   * #102 Short entity summary passed to the benign-narrative generator.
   * Used only when `benignNarrativeGenerator` is present.
   */
  entitySummaryForBenignProbe?: string;

  /**
   * #103 Dated subsystem signals for the freshness decay calculator. When
   * omitted, the decay subsystem skips (v1 does not derive dates from the
   * other subsystems automatically).
   * Regulatory basis: FATF Rec 10 (ongoing monitoring recency),
   * Cabinet Res 134/2025 Art.7 (CDD recency).
   */
  datedSignalsForFreshness?: readonly DatedSignal[];

  /** #103 Optional half-life override for the exponential decay, in days. */
  freshnessHalfLifeDays?: number;

  /**
   * #103 Optional reference time for the freshness calculation. Defaults to
   * `new Date()` when omitted. Exposed for deterministic tests.
   */
  freshnessAsOf?: Date;

  // --- Phase 14 inputs (#104-#109) — intelligence & awareness, all optional ---

  /**
   * #104 Applicable jurisdictions for the proposed action. When both
   * `action` and `jurisdictions` are provided, the brain checks for known
   * conflicts of obligation across jurisdictions.
   * Regulatory basis: FDL Art.20-21, OFAC secondary, EU GDPR, EU Blocking Reg.
   */
  proposedAction?: ProposedAction;
  applicableJurisdictions?: readonly JurisdictionCode[];

  /**
   * #105 Peer-group distribution for verdict-deviation analysis. When
   * omitted, the peer-deviation subsystem skips.
   * Regulatory basis: Cabinet Res 134/2025 Art.19.
   */
  peerGroupDistribution?: PeerGroupDistribution;

  /**
   * #106 Upcoming regulatory deadlines (STR/CTR/CNMR/EOCN freeze/CDD
   * review/UBO reverify). The brain classifies urgency but does NOT
   * clamp the verdict in v1. Reports only.
   * Regulatory basis: FDL Art.26-27, Cabinet Res 74/2020, Cabinet Res 134/2025 Art.7.
   */
  regulatoryDeadlines?: readonly RegulatoryDeadline[];

  /** #106 Optional clock override for deterministic tests. */
  calendarAsOf?: Date;

  /**
   * #109 Evidence types already known to be present for this entity.
   * Used by the counterfactual-completion engine to subtract from the
   * gap checklist. When omitted, all evidence classes are assumed absent.
   */
  knownEvidenceTypes?: readonly string[];

  // --- Phase 15 options (#110-#114) — all optional, all diagnostic ---

  /**
   * #110 Reliability registry for adaptive meta-planner self-learning.
   * When omitted, a transient in-memory registry is used and learning
   * state does not persist across calls. Production callers should
   * inject a registry backed by the brainMemoryBlobStore pattern so
   * reliability scores survive process restarts (FDL No.10/2025 Art.24).
   */
  reliabilityRegistry?: ReliabilityRegistry;

  /**
   * #110 Optional age hints (in days) per subsystem signal, for freshness
   * decay. Missing entries are treated as fresh (age 0).
   */
  signalAgeDaysBySubsystem?: Readonly<Record<string, number>>;

  /**
   * #112 Historical labeled outcomes for threshold self-calibration. The
   * calibrator requires >=20 samples per subsystem before it produces a
   * recommendation; below that it returns an empty report. Recommendations
   * are diagnostic only — they do NOT mutate clamp thresholds.
   */
  calibrationOutcomes?: readonly LabeledOutcomeSample[];

  /**
   * #113 Historical case signatures for signal-pattern mining. Supplied by
   * the caller (typically from brainMemoryStore). Each entry is the set of
   * subsystems that fired for a past case plus the MLRO's final verdict.
   */
  pastCaseSignatures?: readonly PastCaseSignature[];

  /** #113 Jaccard merge threshold override (default 0.7). */
  patternMiningMergeThreshold?: number;

  /**
   * #114 Override the default hypothesis catalog. Extending the catalog
   * must preserve CLAUDE.md §8 citation discipline — every hypothesis
   * carries a regulatory citation field.
   */
  hypothesesOverride?: readonly AdaptiveHypothesis[];
}

export interface WeaponizedExtensions {
  adverseMedia?: AdverseMediaReport;
  ubo?: {
    summary: UboRiskSummary;
    layering: LayeringReport;
    shellCompany: ShellCompanyReport;
  };
  wallets?: PortfolioWalletRisk;
  transactionAnomalies?: DetectorSuiteResult;
  explanation?: Explanation;
  proofBundle?: ComplianceProofBundle;

  // --- Phase 2 subsystems (#20-#30) — all optional, populated only when
  // the required inputs are present or the subsystem is always-on ---

  /** #20 Red team critic — adversarial challenge to the verdict. */
  redTeam?: RedTeamChallenge;
  /** #21 Precedent retriever — top-K similar past cases. */
  precedents?: PrecedentReport;
  /** #22 Contradiction detector — inter-subsystem disagreements. */
  contradictions?: ContradictionReport;
  /** #23 Regulator voice pass — inspector question gaps. */
  regulatorVoice?: RegulatorVoiceReport;
  /** #24 Calibrated confidence (Platt). null when no calibration params. */
  calibratedConfidence?: number;
  /** #25 Counterfactual flipper — what would change the verdict. */
  counterfactuals?: CounterfactualReport;
  /** #26 Temporal pattern detector — 90-day window patterns. */
  temporalPatterns?: TemporalPatternReport;
  /** #27 Sanctions-evasion typology matcher — FATF/EOCN library hits. */
  typologies?: TypologyMatchReport;
  /** #28 Narrative drift detector — STR boilerplate detection. */
  narrativeDrift?: DriftReport;
  /** #29 Cross-customer correlator — shared-signal detection. */
  crossCustomer?: CorrelationReport;
  /** #30 Teacher extension reviewer — ratified/contested over extensions. */
  teacherExtension?: TeacherExtensionReport;

  // --- Phase 3 subsystems (#31-#40) ---

  /** #31 Benford's Law — statistical ledger tamper/synthesis detector. */
  benford?: BenfordReport;
  /** #32 Adversarial ML — input boundary defense (always runs on entity name). */
  adversarialInput?: AdversarialReport;
  /** #33 Advisor hallucination — regulatory citation validator (runs post-advisor). */
  advisorHallucinations?: HallucinationReport;
  /** #34 Taint propagator — multi-hop wallet taint tracing with decay. */
  taint?: TaintReport;
  /** #35 Self-audit — 0-100 MoE readiness score across 8 compliance dimensions. */
  selfAudit?: SelfAuditResult;
  /** #36 Verdict drift — meta-signal for system-level behaviour drift. */
  verdictDrift?: VerdictDriftReport;
  /** #37 KYC consistency — cross-document synthetic identity / tampering detection. */
  kycConsistency?: KycConsistencyReport;
  /** #38 Buy-back risk — DPMS cash-for-gold inbound scoring per MoE 08/AML/2021. */
  buyBackRisks?: BuyBackRiskAssessment[];
  /** #39 Price anomaly — LBMA/DGD over/under-invoicing detection. */
  priceAnomalies?: PriceAnomalyResult[];
  /** #40 BFT consensus — Byzantine fault-tolerant verdict voting (internal + external). */
  bftConsensus?: BftConsensusReport<string> | null;

  // ─── Phase 4-10: ESG, TBML, PEP, Hawala, STR, Cross-border, Ensemble ──────

  /** #41 ESG composite score (0-100, grade A-F, ISSB IFRS S1/S2). */
  esgScore?: EsgScore;
  /** #42 Carbon footprint — Scope 1/2/3 per troy oz. */
  carbonFootprint?: CarbonFootprintReport;
  /** #43 TCFD alignment — 4-pillar disclosure score. */
  tcfdAlignment?: TcfdAlignmentReport;
  /** #44 UN SDG alignment — 17-goal weighted score for DPMS sector. */
  sdgAlignment?: UnSdgReport;
  /** #45 Conflict minerals — CAHRA/OECD DDG supplier risk. */
  conflictMinerals?: ConflictMineralsReport;
  /** #46 Greenwashing — ESG disclosure integrity assessment. */
  greenwashing?: GreenwashingReport;
  /** #47 ESG adverse media — classified ESG signal from adverse media. */
  esgAdverseMedia?: EsgAdverseMediaReport;
  /** #48 Modern slavery — ILO forced-labour indicator risk. */
  modernSlavery?: ModernSlaveryReport;
  /** #49 TBML — trade-based money laundering detection. */
  tbml?: TbmlAssessment;
  /** #50 Four-eyes — dual-approval enforcement result. */
  fourEyes?: FourEyesResult;
  /** #51 STR/SAR/CTR filing classification + deadline. */
  filingClassification?: ClassificationResult;
  /** #52 PEP proximity — 1st/2nd/3rd-degree proximity score. */
  pepProximity?: PepProximityScore;
  /** #53 Hawala / IVTS detection result. */
  hawala?: HawalaDetectionResult;
  /** #54 Anomaly ensemble — Bayesian BMA across all anomaly signals. */
  anomalyEnsemble?: EnsembleResult;
  /** #55 Cross-border cash — AED 60K threshold + structuring detection. */
  crossBorderCash?: CrossBorderAssessment;

  // ─── Synthesis Layer ──────────────────────────────────────────────────────
  /** MLRO alert bundle — structured regulatory alerts from all subsystem outputs. */
  mlroAlerts?: MlroAlertBundle;
  /** Asana orchestration result — tasks created from verdict + findings. */
  asanaSync?: OrchestratorResult;
  /** 30-KPI compliance metrics dashboard (MoE/FIU/FATF/LBMA aligned). */
  kpiDashboard?: KpiReport;
  /** #56 Hawkeye Sterling V2 case report — professional branded screening report for Asana. */
  hawkeyeReport?: HawkeyeReport;
  /** #57 AI Governance Checklist — 10-point NIST AI RMF + EU AI Act + UAE AI Ethics assessment. */
  aiGovernance?: AiGovernanceReport;
  /** #58 ESG Advanced Framework — CSRD, SASB, Double Materiality, Stranded Assets, Climate VAR, Green/Social Bond, SLL, Carbon Credits. */
  esgAdvanced?: EsgAdvancedReport;

  // ─── Phase 11 subsystems (#59-#72) ────────────────────────────────────────
  /** #59 Prompt injection detection — entity name + narrative scanned for adversarial injection. */
  promptInjection?: InjectionReport;
  /** #60 Deepfake document detector — KYC document forgery signal. */
  deepfakeDoc?: DeepfakeReport;
  /** #61 Cross-list sanctions dedupe — merged hits across UN/OFAC/EU/UK/UAE/EOCN. */
  sanctionsDedupe?: DedupeReport;
  /** #62 STR narrative — auto-built goAML narrative from structured evidence. */
  strNarrative?: StrNarrative;
  /** #63 Predictive STR — probability the entity will trigger an STR within 30 days. */
  strPrediction?: StrPrediction;
  /** #64 Penalty VaR — AED penalty value at risk across all active violations. */
  penaltyVar?: VaRReport;
  /** #65 Gold origin tracer — LBMA/OECD DDG supply-chain origin trace. */
  goldOrigin?: OriginTraceReport;
  /** #66 Assay certificate matcher — certificate-to-refiner validation. */
  assayMatch?: AssayMatchReport;
  /** #67 Fineness anomaly — gold fineness claim vs. refiner capability check. */
  finenessAnomaly?: FinenessReport;
  /** #68 Cross-border arbitrage — pricing arbitrage across jurisdictions. */
  arbitrage?: ArbitrageReport;
  /** #70 Dormancy activity — sudden reactivation of dormant accounts. */
  dormancy?: DormancyReport;
  /** #71 Name variant expander — transliteration variants for better sanctions coverage. */
  nameVariants?: NameVariantReport;
  /** #72 STR narrative grader — quality score of auto-built narrative. */
  strNarrativeGrade?: StrGradeReport;

  // ─── Phase 12 subsystems (#73-#97) ────────────────────────────────────────

  /** #73 Corporate graph walker — subsidiary/affiliate sanction hits up to N hops. */
  corporateGraph?: GraphWalkReport;
  /** #74 Graph motif UBO analyzer — circular/star/cascade ownership motifs. */
  ownershipMotifs?: MotifReport;
  /** #75 Multi-model screening (async) — consensus across multiple AI screeners. */
  multiModelConsensus?: MultiModelConsensusResult;
  /** #76 Causal engine — counterfactual reasoning: what would flip the verdict. */
  causalCounterfactual?: {
    original: Record<string, number>;
    flipped: Record<string, number>;
    changedNodes: string[];
  };
  /** #77 Debate arbiter — pro/con structured argument with winning action. */
  verdictDebate?: DebateVerdict;
  /** #78 Reflection critic — reasoning chain coverage + structural issue analysis. */
  reflectionReport?: ReflectionReport;
  /** #79 Circular reasoning detector — dependency cycles in subsystem conclusions. */
  circularReasoning?: CircularReport;
  /** #80 Game theory adversary — Nash equilibrium of detect vs evade strategies. */
  gameEquilibrium?: EquilibriumReport;
  /** #81 LBMA fix price checker — gold trade deviation from LBMA AM/PM fix. */
  lbmaFixCheck?: FixCheckReport;
  /** #82 Melt loss — gold batch melt loss assessment + refiner drift detection. */
  meltLoss?: MeltLossAssessment;
  /** #83 Free zone compliance — UAE free zone mandatory rule pass/fail. */
  freeZoneCompliance?: FreeZoneCheckResult;
  /** #84 Tipping-off linter — FDL Art.29 scan of all generated text output. */
  tippingOff?: TippingOffReport;
  /** #85 Shapley explainer — per-feature attribution values for the verdict. */
  shapley?: ShapleyReport;
  /** #86 Formal invariant verifier — canonical + custom state invariant checks. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invariantVerification?: InvariantVerifyReport<any>;
  /** #87 Synthetic evasion — coverage gaps against generated evasion test cases. */
  syntheticEvasion?: SyntheticCase[];
  /** #88 Quantum-resistant seal — SHA-3/512 post-quantum audit bundle. */
  quantumSeal?: QuantumSealBundle;
  /** #89 Peer anomaly — z-score outlier features vs peer group. */
  peerAnomaly?: PeerAnomalyReport;
  /** #90 Time-travel audit — critical path + current state snapshot for replay. */
  timeTravelAudit?: { criticalPath: EvidenceEntry[]; currentState: CaseSnapshot };
  /** #91 Document intelligence — structural tamper signals from KYC documents. */
  documentTamper?: DocumentExtractionResult;
  /** #92 Regulatory drift — concept drift in entity risk feature distribution. */
  regulatoryDrift?: PortfolioDriftReport;
  /** #93 goAML XML — auto-generated XML filing string for UAE FIU submission. */
  goamlXml?: string;
  /** #94 Bayesian belief — posterior probability + Shannon entropy for verdict risk. */
  bayesianBelief?: BeliefReport;
  /** #95 Case-based reasoning — top-K similar past cases + analogy recommendation. */
  cbrRecommendation?: ReuseRecommendation[];
  /** #96 EU AI Act readiness — Article 9/10/13/14/15/72 scaffolding result. */
  euAiActReadiness?: ReadinessScaffoldResult;
  /** #97 Rule induction — human-readable decision rules extracted from session data. */
  inducedRules?: LearnedRule[];

  /**
   * #98 Deep research engine — iterative search/reason/cite loop.
   * Adverse media, EDD on opaque counterparties, STR narrative drafting.
   * Adapts vendor/node-DeepResearch into a browser-safe, dep-injected engine.
   * Regulatory basis: FDL Art.19 (risk-based review), Art.24 (audit trail),
   * Art.29 (no tipping off — engine redacts PII before external queries).
   */
  deepResearch?: DeepResearchResult;

  // --- Phase 13 subsystems (#99-#103) — reasoning & analysis ---

  /** #99 Factor ablation — necessity test per signal. Read-only; never clamps. */
  factorAblation?: FactorAblationReport;

  /** #100 Citation integrity — verifies every clamp cites a regulation. */
  citationIntegrity?: CitationIntegrityReport;

  /** #101 Reasoning-chain DAG — provenance of signals → clamps → verdict. */
  reasoningDag?: ReasoningDagReport;

  /** #102 Benign-narrative probe — counter-hypothesis for MLRO review. */
  benignNarrative?: BenignNarrativeResult;

  /** #103 Evidence freshness decay — age-weighted confidence adjustment. */
  evidenceFreshness?: EvidenceFreshnessReport;

  // --- Phase 14 subsystems (#104-#109) — intelligence & awareness ---

  /** #104 Cross-jurisdiction conflicts of obligation. Report-only in v1. */
  crossJurisdictionConflicts?: CrossJurisdictionConflictReport;

  /** #105 Peer-group deviation — verdict distribution vs peer z-score. */
  peerDeviation?: PeerDeviationReport;

  /** #106 Regulatory calendar — deadline urgency classification. */
  regulatoryCalendar?: RegulatoryCalendarReport;

  /** #107 Inter-subsystem agreement — fraction of signals concurring with final. */
  agreementScore?: AgreementScore;

  /** #109 Counterfactual completion — evidence gaps that could escalate the verdict. */
  counterfactualCompletion?: CounterfactualCompletionReport;

  // --- Phase 15 subsystems (#110-#114) — adaptive meta + self-learning ---

  /** #110 Adaptive meta-planner — attention-ranked focus brief over all signals. */
  adaptiveMeta?: AdaptiveMetaReport;
  /** #111 Reasoning chain — explicit multi-step inference trace (deep thinking). */
  reasoningChainComposed?: ReasoningChainReport;
  /** #112 Threshold self-calibrator — per-subsystem cutoff recommendations (Youden's J). */
  thresholdCalibration?: ThresholdCalibrationReport;
  /** #113 Signal pattern miner — recurring signal signatures across past cases. */
  patternMining?: PatternMiningReport;
  /** #114 Hypothesis generator — competing compliance explanations (Bayesian). */
  hypotheses?: HypothesisReport;
}

export interface WeaponizedBrainResponse {
  /** The underlying MegaBrain response — preserved verbatim. */
  mega: MegaBrainResponse;

  /** New subsystems added on top. Only the ones triggered are populated. */
  extensions: WeaponizedExtensions;

  /**
   * Final verdict AFTER applying Weaponized safety clamps on top of
   * MegaBrain's. Always satisfies VERDICT_RANK[finalVerdict] >=
   * VERDICT_RANK[mega.verdict] — verdicts can only escalate, never
   * downgrade.
   */
  finalVerdict: Verdict;

  /** Reasons the verdict was clamped by this layer (empty if not clamped). */
  clampReasons: string[];

  /** Augmented human-review flag — true if any layer demands review. */
  requiresHumanReview: boolean;

  /**
   * Minimum confidence across all subsystems (MegaBrain + Weaponized).
   * Conservative: low confidence anywhere reduces the total.
   */
  confidence: number;

  /**
   * Audit-trail-ready plain-English narrative of the decision. Safe to
   * paste into a case file or email to an MLRO.
   */
  auditNarrative: string;

  /**
   * Names of subsystems that failed during execution. Empty when all
   * subsystems ran successfully. A non-empty array forces human review
   * per FDL Art.24 — a failing subsystem means the decision record is
   * incomplete and must be manually anchored.
   */
  subsystemFailures: string[];

  /**
   * Advisor escalation result, if the advisor was invoked. null when the
   * advisor hook was not provided or was not triggered for this case.
   */
  advisorResult: AdvisorEscalationResult | null;

  /**
   * Managed agents resolved for this verdict — ordered list of agent types
   * to spawn, populated by resolveAgentsForVerdict() in the synthesis layer.
   */
  managedAgentPlan: ManagedAgentTask[];

  /**
   * Orchestrator session for this screening run — groups all agent tasks
   * spawned for this entity.
   */
  orchestratorSession: OrchestratorSession;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the weaponized brain. This is the top-level entry point for any
 * compliance decision that wants the full multi-subsystem treatment.
 *
 * Async because the zk-proof bundle uses Web Crypto SubtleDigest. If
 * sealProofBundle is set to false, the call completes synchronously
 * from the caller's perspective (still returns a Promise, but it
 * resolves immediately).
 */
export async function runWeaponizedBrain(
  req: WeaponizedBrainRequest
): Promise<WeaponizedBrainResponse> {
  // 1. Run the existing MegaBrain first. This produces the 13-subsystem
  //    sealed reasoning chain and the initial verdict.
  const mega = runMegaBrain(req.mega);

  const extensions: WeaponizedExtensions = {};
  const clampReasons: string[] = [];
  const subsystemFailures: string[] = [];
  let finalVerdict: Verdict = mega.verdict;
  // Hoisted to the top of the function so the new subsystems added in
  // commit faf0f7a3 (Phase 12) can clamp it before the final
  // augmentation pass below. Without this hoist, references on lines
  // ~2200-2700 hit a temporal-dead-zone ReferenceError.
  let confidence = mega.confidence;

  // Partial-success helper: every extension runs inside this wrapper so that
  // a failure in one subsystem never loses the decision from the others.
  // Failures escalate to human review instead of throwing. FDL Art.24.
  const runSafely = <T>(name: string, fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      subsystemFailures.push(name);
      clampReasons.push(
        `CLAMP: subsystem ${name} failed (${message}) — manual review required (FDL Art.24)`
      );
      return undefined;
    }
  };

  // 2. Subsystem 14: Adverse media ranking
  if (req.adverseMedia && req.adverseMedia.length > 0) {
    const report = runSafely('adverseMediaRanker', () => rankAdverseMedia(req.adverseMedia!));
    if (report) {
      extensions.adverseMedia = report;
      if (report.counts.critical > 0) {
        const next = escalateTo(finalVerdict, 'escalate');
        if (next !== finalVerdict) {
          finalVerdict = next;
          clampReasons.push(
            `CLAMP: ${report.counts.critical} critical adverse media hit(s) — escalated ` +
              `(FATF Rec 10 + Cabinet Res 134/2025 Art.14)`
          );
        }
      }
    }
  }

  // 3. Subsystem 15: UBO risk + layering + shell-company analysis
  if (req.ubo) {
    const uboResult = runSafely('uboAnalysis', () => {
      const summary = summariseUboRisk(req.ubo!.graph, req.ubo!.targetId);
      const layering = analyseLayering(req.ubo!.graph, req.ubo!.targetId);
      const shellCompany = analyseShellCompany(req.ubo!.graph, req.ubo!.targetId);
      return { summary, layering, shellCompany };
    });
    if (uboResult) {
      extensions.ubo = uboResult;
      if (uboResult.summary.hasSanctionedUbo) {
        finalVerdict = 'freeze';
        clampReasons.push(
          'CLAMP: sanctioned beneficial owner detected — verdict forced to freeze ' +
            '(Cabinet Res 74/2020 Art.4-7 + Cabinet Decision 109/2023)'
        );
      } else if (
        uboResult.summary.hasUndisclosedPortion &&
        uboResult.summary.undisclosedPercentage > 25
      ) {
        const next = escalateTo(finalVerdict, 'escalate');
        if (next !== finalVerdict) {
          finalVerdict = next;
          clampReasons.push(
            `CLAMP: ${uboResult.summary.undisclosedPercentage.toFixed(1)}% undisclosed ownership — ` +
              `escalated (Cabinet Decision 109/2023)`
          );
        }
      }
    }
  }

  // 4. Subsystem 16: VASP wallet portfolio risk
  if (req.wallets && req.wallets.addresses.length > 0) {
    const walletRisk = runSafely('vaspWalletScoring', () =>
      summarisePortfolioWallets(req.wallets!.db, req.wallets!.addresses)
    );
    if (walletRisk) {
      extensions.wallets = walletRisk;
      if (walletRisk.confirmedHits > 0) {
        finalVerdict = 'freeze';
        clampReasons.push(
          `CLAMP: ${walletRisk.confirmedHits} confirmed sanctioned/illicit wallet(s) — ` +
            `verdict forced to freeze (Cabinet Res 74/2020 + FATF Rec 15 VASP)`
        );
      }
    }
  }

  // 5. Subsystem 17: Transaction anomaly detectors
  if (req.transactions && req.transactions.length > 0) {
    const detectorResult = runSafely('transactionAnomaly', () =>
      runAllDetectors(req.transactions!)
    );
    if (detectorResult) {
      extensions.transactionAnomalies = detectorResult;
      const structuringHigh = detectorResult.findings.some(
        (f) => f.kind === 'structuring' && f.severity === 'high'
      );
      if (structuringHigh) {
        const next = escalateTo(finalVerdict, 'escalate');
        if (next !== finalVerdict) {
          finalVerdict = next;
          clampReasons.push(
            'CLAMP: high-severity structuring detected — escalated ' +
              '(MoE Circular 08/AML/2021 + FDL Art.26-27)'
          );
        }
      }
    }
  }

  // 6. Subsystem 18: Explainable factor scoring (always runs)
  const explainInput: ScoringInput = req.explainabilityInput ?? {
    sanctionsMatchScore: req.mega.entity.isSanctionsConfirmed ? 1.0 : 0,
    adverseMediaHits: extensions.adverseMedia?.ranked.length ?? 0,
    hasUndisclosedUbo: extensions.ubo?.summary.hasUndisclosedPortion ?? false,
    maxUboConcentration: extensions.ubo?.summary.maxConcentration,
    anomalyCount: extensions.transactionAnomalies?.findings.length ?? 0,
    hasHighSeverityAnomaly:
      extensions.transactionAnomalies?.findings.some((f) => f.severity === 'high') ?? false,
  };
  extensions.explanation = runSafely('explainableScoring', () => explainableScore(explainInput));

  // 7. Subsystem 19: zk-proof audit seal (default on, opt-out via sealProofBundle: false)
  if (req.sealProofBundle !== false) {
    const record: ComplianceRecord = {
      recordId: mega.chain.id,
      data: {
        topic: mega.topic,
        entityId: mega.entityId,
        megaVerdict: mega.verdict,
        finalVerdict,
        confidence: mega.confidence,
        clampCount: clampReasons.length,
        sealedAt: new Date().toISOString(),
      },
    };
    try {
      extensions.proofBundle = await sealComplianceBundle([record]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      subsystemFailures.push('zkComplianceProof');
      clampReasons.push(
        `CLAMP: zk-proof audit seal failed (${message}) — manual audit anchor required (FDL Art.24)`
      );
    }
  }

  // 7b. Phase 2 subsystems (#20-#30) — all run independently of each other
  // and of the Phase 1 extensions. We run them in parallel via Promise.all
  // where any are async, but all 11 current implementations are synchronous
  // pure functions so we just invoke them inline. runSafely still wraps
  // each one so a failure in one never kills the others.
  const policy = req.clampPolicy ?? DEFAULT_CLAMP_POLICY;

  // #20 Red team critic — adversarial challenge to the current verdict.
  const redTeamSignals = {
    sanctionsMatchScore: req.mega.entity.isSanctionsConfirmed ? 1.0 : 0,
    adverseMediaCriticalCount: extensions.adverseMedia?.counts.critical,
    uboUndisclosedPct: extensions.ubo?.summary.undisclosedPercentage,
    hasSanctionedUbo: extensions.ubo?.summary.hasSanctionedUbo,
    confirmedWalletHits: extensions.wallets?.confirmedHits,
    structuringSeverity: extensions.transactionAnomalies?.findings.find(
      (f) => f.kind === 'structuring'
    )?.severity as 'low' | 'medium' | 'high' | undefined,
  };
  extensions.redTeam = runSafely('redTeamCritic', () =>
    redTeamCritique({
      verdict: finalVerdict,
      confidence: mega.confidence,
      clampReasons,
      signals: redTeamSignals,
    })
  );

  // #21 Precedent retriever — only if an index was provided.
  if (req.precedentIndex && extensions.explanation) {
    const factors = [
      extensions.explanation.score / 100,
      extensions.explanation.cddLevel === 'EDD'
        ? 1
        : extensions.explanation.cddLevel === 'CDD'
          ? 0.5
          : 0,
      extensions.adverseMedia ? extensions.adverseMedia.ranked.length / 10 : 0,
      extensions.ubo?.summary.undisclosedPercentage
        ? extensions.ubo.summary.undisclosedPercentage / 100
        : 0,
      extensions.wallets?.confirmedHits ? 1 : 0,
      extensions.transactionAnomalies?.findings.length
        ? extensions.transactionAnomalies.findings.length / 10
        : 0,
    ];
    extensions.precedents = runSafely('precedentRetriever', () =>
      queryPrecedents(req.precedentIndex!, { factors, topK: 5 })
    );
  }

  // #22 Contradiction detector — over any subsystems we can score.
  const signals: SubsystemSignal[] = [];
  if (extensions.ubo?.summary.hasSanctionedUbo) {
    signals.push({ name: 'ubo', impliedVerdict: 'freeze', confidence: 0.9 });
  } else if (
    extensions.ubo?.summary.hasUndisclosedPortion &&
    extensions.ubo.summary.undisclosedPercentage > policy.uboUndisclosedEscalateAbovePct
  ) {
    signals.push({ name: 'ubo', impliedVerdict: 'escalate', confidence: 0.8 });
  }
  if (extensions.wallets && extensions.wallets.confirmedHits > 0) {
    signals.push({ name: 'wallets', impliedVerdict: 'freeze', confidence: 0.95 });
  }
  if (
    extensions.transactionAnomalies?.findings.some(
      (f) => f.kind === 'structuring' && f.severity === 'high'
    )
  ) {
    signals.push({ name: 'anomaly', impliedVerdict: 'escalate', confidence: 0.8 });
  }
  if (extensions.adverseMedia?.counts.critical && extensions.adverseMedia.counts.critical > 0) {
    signals.push({ name: 'media', impliedVerdict: 'escalate', confidence: 0.7 });
  }
  // Add the baseline MegaBrain signal so we can check the new subsystems
  // against the original verdict.
  signals.push({ name: 'mega', impliedVerdict: mega.verdict, confidence: mega.confidence });
  extensions.contradictions = runSafely('contradictionDetector', () =>
    detectContradictions(signals, policy)
  );
  if (extensions.contradictions?.hasContradiction) {
    clampReasons.push(
      `CLAMP: ${extensions.contradictions.disagreements.length} inter-subsystem contradiction(s) — ` +
        `human review required (FDL Art.20-21)`
    );
  }

  // #23 Regulator voice pass — only if evidence flags provided.
  if (req.regulatorEvidence) {
    extensions.regulatorVoice = runSafely('regulatorVoicePass', () =>
      runRegulatorVoicePass({
        verdict: finalVerdict,
        narrative: 'pending',
        evidence: req.regulatorEvidence!,
      })
    );
    if (extensions.regulatorVoice?.hasGaps) {
      clampReasons.push(
        `CLAMP: regulator voice pass has ${extensions.regulatorVoice.unansweredCount} ` +
          `unanswered inspector question(s) (MoE Circular 08/AML/2021)`
      );
    }
  }

  // #24 Confidence calibrator — only if params provided.
  if (req.calibrationParams) {
    extensions.calibratedConfidence = runSafely('confidenceCalibrator', () =>
      calibrateConfidence(mega.confidence, req.calibrationParams!)
    );
  }

  // #25 Counterfactual flipper — always runs.
  extensions.counterfactuals = runSafely('counterfactualFlipper', () =>
    computeCounterfactuals({ verdict: finalVerdict, signals: redTeamSignals }, policy)
  );

  // #26 Temporal pattern detector — only if events provided.
  if (req.temporalEvents) {
    extensions.temporalPatterns = runSafely('temporalPatternDetector', () =>
      detectTemporalPatterns(req.temporalEvents!, req.mega.entity.id, new Date(), policy)
    );
  }

  // #27 Typology matcher — only if signals provided.
  if (req.typologySignals) {
    extensions.typologies = runSafely('sanctionsEvasionTypologyMatcher', () =>
      matchTypologies(req.typologySignals!, policy)
    );
    // Clamp: top typology hit action of 'freeze' or 'escalate' forces the
    // verdict up. This is the place where the deterministic typology
    // library actually applies the escalation.
    if (extensions.typologies?.topHit) {
      const top = extensions.typologies.topHit;
      if (top.action === 'freeze') {
        finalVerdict = 'freeze';
        clampReasons.push(`CLAMP: typology ${top.id} ${top.name} forces freeze (${top.citation})`);
      } else if (top.action === 'escalate') {
        const next = escalateTo(finalVerdict, 'escalate');
        if (next !== finalVerdict) {
          finalVerdict = next;
          clampReasons.push(
            `CLAMP: typology ${top.id} ${top.name} forces escalate (${top.citation})`
          );
        }
      }
    }
  }

  // #28 Narrative drift detector — only if draft narrative + filings provided.
  if (req.draftNarrative && req.draftTypology && req.priorFilings) {
    extensions.narrativeDrift = runSafely('narrativeDriftDetector', () =>
      detectNarrativeDrift(req.draftNarrative!, req.draftTypology!, req.priorFilings!, policy)
    );
    if (extensions.narrativeDrift?.hasDrift) {
      clampReasons.push(
        'CLAMP: draft narrative shows boilerplate drift — rewrite required (FDL Art.26-27)'
      );
    }
  }

  // #29 Cross-customer correlator — only if peer snapshots provided.
  if (req.peerCustomerSnapshots) {
    extensions.crossCustomer = runSafely('crossCustomerCorrelator', () =>
      correlateAcrossCustomers(req.peerCustomerSnapshots!)
    );
  }

  // #30 Teacher extension reviewer — always runs, reviews the other extensions.
  extensions.teacherExtension = runSafely('teacherExtensionReviewer', () =>
    reviewExtensions({
      studentVerdict: finalVerdict,
      extensions: {
        adverseMediaCriticalCount: extensions.adverseMedia?.counts.critical,
        hasSanctionedUbo: extensions.ubo?.summary.hasSanctionedUbo,
        uboUndisclosedPct: extensions.ubo?.summary.undisclosedPercentage,
        confirmedWalletHits: extensions.wallets?.confirmedHits,
        structuringHigh: extensions.transactionAnomalies?.findings.some(
          (f) => f.kind === 'structuring' && f.severity === 'high'
        ),
        explainableScore: extensions.explanation?.score,
      },
      phase2: {
        typologyTopAction: extensions.typologies?.topHit?.action ?? null,
        contradictionDetected: extensions.contradictions?.hasContradiction,
        regulatorVoiceGaps: extensions.regulatorVoice?.unansweredCount,
        redTeamProposal: extensions.redTeam?.proposedVerdict ?? null,
        narrativeDrift: extensions.narrativeDrift?.hasDrift,
      },
    })
  );
  if (extensions.teacherExtension?.verdict === 'contested') {
    clampReasons.push(
      `CLAMP: teacher extension review contested (${extensions.teacherExtension.concerns.length} concern(s)) — ` +
        `human review required (Cabinet Res 134/2025 Art.19)`
    );
  }

  // ---------------------------------------------------------------------------
  // 7c. Phase 3 subsystems (#31-#40) — all run in parallel via Promise.all.
  //
  // #32 Adversarial ML always fires (entity name is always available).
  // #40 BFT always fires (internal votes from already-resolved subsystems).
  // All others require caller-supplied input data — omit to skip.
  // ---------------------------------------------------------------------------

  const [
    p3benford,
    p3adversarial,
    p3taint,
    p3selfAudit,
    p3verdictDrift,
    p3kycConsistency,
    p3buyBack,
    p3priceAnomalies,
    p3bft,
  ] = await Promise.all([
    // #31 Benford's Law — requires >= 30 amounts for chi-square validity.
    req.benfordAmounts && req.benfordAmounts.length >= 30
      ? Promise.resolve(runSafely('benfordAnalyzer', () => analyseBenford(req.benfordAmounts!)))
      : Promise.resolve(undefined),

    // #32 Adversarial ML — always runs. Defaults to entity name; caller can
    // enrich via adversarialInputText (narrative excerpt, KYC dossier, etc.).
    Promise.resolve(
      runSafely('adversarialMlDetector', () =>
        detectAdversarial(req.adversarialInputText ?? req.mega.entity.name)
      )
    ),

    // #34 Taint Propagator — BFS from known-sanctioned wallets through
    // the transaction graph with configurable taint decay per hop.
    req.taintGraph
      ? Promise.resolve(
          runSafely('taintPropagator', () =>
            propagateTaint(req.taintGraph!.graph, req.taintGraph!.config)
          )
        )
      : Promise.resolve(undefined),

    // #35 Self-Audit Score — 0-100 readiness across 8 compliance dimensions.
    req.selfAuditInput
      ? Promise.resolve(
          runSafely('selfAuditScore', () => calculateSelfAuditScore(req.selfAuditInput!))
        )
      : Promise.resolve(undefined),

    // #36 Verdict Drift Monitor — meta-signal; does NOT flip case verdicts.
    req.verdictDriftInput
      ? Promise.resolve(
          runSafely('verdictDriftMonitor', () => detectVerdictDrift(req.verdictDriftInput!))
        )
      : Promise.resolve(undefined),

    // #37 KYC Consistency — requires >= 2 documents with overlapping fields.
    req.kycDocuments && req.kycDocuments.length >= 2
      ? Promise.resolve(
          runSafely('kycConsistencyChecker', () => checkKycConsistency(req.kycDocuments!))
        )
      : Promise.resolve(undefined),

    // #38 Buy-Back Risk — assess every transaction; worst-case drives verdict.
    req.buyBackTransactions && req.buyBackTransactions.length > 0
      ? Promise.resolve(
          runSafely('buyBackRisk', () =>
            req.buyBackTransactions!.map((tx) => assessBuyBackRisk(tx, req.buyBackTransactions!))
          )
        )
      : Promise.resolve(undefined),

    // #39 Price Anomaly — assess every transaction against the benchmark.
    req.priceAnomalyInput && req.priceAnomalyInput.transactions.length > 0
      ? Promise.resolve(
          runSafely('priceAnomaly', () =>
            req.priceAnomalyInput!.transactions.map((tx) =>
              assessPriceAnomaly(tx, req.priceAnomalyInput!.benchmark)
            )
          )
        )
      : Promise.resolve(undefined),

    // #40 BFT Consensus — always runs. Votes from deterministic subsystems
    // already resolved above are always included. External sanctions-source
    // votes (req.sanctionsSourceVotes) are prepended when provided. Minimum
    // 4 votes required for BFT quorum (3f+1, f=1 — tolerates 1 faulty source).
    Promise.resolve(
      runSafely('bftConsensus', () => {
        const votes: BftVote<string>[] = req.sanctionsSourceVotes
          ? [...req.sanctionsSourceVotes]
          : [];

        // Internal votes from resolved deterministic subsystems.
        votes.push({ source: 'megaBrain', value: mega.verdict });
        if (extensions.redTeam?.proposedVerdict) {
          votes.push({ source: 'redTeamCritic', value: extensions.redTeam.proposedVerdict });
        }
        if (extensions.typologies?.topHit?.action) {
          votes.push({ source: 'typologyMatcher', value: extensions.typologies.topHit.action });
        }
        const cddLevelToVerdict: Record<string, string> = {
          SDD: 'pass',
          CDD: 'flag',
          EDD: 'escalate',
        };
        if (extensions.explanation?.cddLevel) {
          votes.push({
            source: 'explainableScoring',
            value: cddLevelToVerdict[extensions.explanation.cddLevel] ?? 'flag',
          });
        }
        if (extensions.teacherExtension) {
          votes.push({
            source: 'teacherExtension',
            value: extensions.teacherExtension.verdict === 'contested' ? 'escalate' : finalVerdict,
          });
        }

        // Need >= 4 votes for BFT with f=1.
        if (votes.length < 4) return null;
        return computeBftConsensus(votes);
      })
    ),
  ]);

  // Assign Phase 3 results to extensions.
  extensions.benford = p3benford ?? undefined;
  extensions.adversarialInput = p3adversarial ?? undefined;
  extensions.taint = p3taint ?? undefined;
  extensions.selfAudit = p3selfAudit ?? undefined;
  extensions.verdictDrift = p3verdictDrift ?? undefined;
  extensions.kycConsistency = p3kycConsistency ?? undefined;
  extensions.buyBackRisks = p3buyBack ?? undefined;
  extensions.priceAnomalies = p3priceAnomalies ?? undefined;
  extensions.bftConsensus = p3bft ?? undefined;

  // ---------------------------------------------------------------------------
  // Phase 3 safety clamps — applied after Phase 1 + Phase 2, so they can
  // only escalate the verdict, never downgrade. Same monotone invariant.
  // ---------------------------------------------------------------------------

  // #31 Benford non-conformity → escalate (ledger synthesis / manipulation).
  if (extensions.benford?.verdict === 'non-conformity') {
    finalVerdict = escalateTo(finalVerdict, 'escalate');
    clampReasons.push(
      `CLAMP: Benford non-conformity (chi²=${extensions.benford.chiSquare.toFixed(2)}, ` +
        `MAD=${extensions.benford.meanAbsoluteDeviation.toFixed(4)}, n=${extensions.benford.sampleSize}) — ` +
        `possible ledger manipulation / synthetic dataset (FATF Rec 10 / MoE Circular 08/AML/2021)`
    );
  }

  // #32 Adversarial ML critical finding → escalate (screening evasion attempt).
  if (extensions.adversarialInput?.topSeverity === 'critical') {
    finalVerdict = escalateTo(finalVerdict, 'escalate');
    clampReasons.push(
      `CLAMP: adversarial input detected on entity name/narrative ` +
        `(${extensions.adversarialInput.findings.length} finding(s), ` +
        `top=${extensions.adversarialInput.findings[0]?.id ?? 'unknown'}) — ` +
        `possible sanctions-screening evasion (EU AI Act Art.15 / FATF Rec 6)`
    );
  }

  // #34 Taint propagation: entity wallets with residual sanctions taint → freeze.
  if (extensions.taint && req.taintGraph) {
    const taintThreshold = policy.walletConfirmedConfidenceCap;
    const entityTainted = extensions.taint.tainted.filter(
      (node) => req.taintGraph!.entityWallets.includes(node.wallet) && node.taint >= taintThreshold
    );
    if (entityTainted.length > 0) {
      finalVerdict = escalateTo(finalVerdict, 'freeze');
      clampReasons.push(
        `CLAMP: taint propagation — ${entityTainted.length} entity wallet(s) carry residual ` +
          `sanctions taint ≥ ${(taintThreshold * 100).toFixed(0)}% ` +
          `(max taint ${(extensions.taint.maxTaint * 100).toFixed(1)}%) ` +
          `(Cabinet Res 74/2020 Art.4-7 / FATF Rec 15)`
      );
    }
  }

  // #35 Self-audit critically low → advisory clamp (does NOT flip verdict —
  // a degraded control environment is a meta-risk per NIST AI RMF GV-1.6).
  if (extensions.selfAudit && extensions.selfAudit.totalScore < 60) {
    clampReasons.push(
      `CLAMP: self-audit score ${extensions.selfAudit.totalScore}/100 ` +
        `(grade ${extensions.selfAudit.grade}) — degraded control environment; ` +
        `${extensions.selfAudit.criticalGaps.length} critical gap(s); ` +
        `human review mandatory (Cabinet Res 134/2025 Art.19 / NIST AI RMF GV-1.6)`
    );
  }

  // #36 Verdict drift detected → advisory clamp (meta-signal; no verdict flip).
  if (extensions.verdictDrift?.hasDrift) {
    clampReasons.push(
      `CLAMP: verdict drift detected (chi²=${extensions.verdictDrift.chiSquare.toFixed(2)} ` +
        `vs critical=${extensions.verdictDrift.criticalValue.toFixed(2)}) — ` +
        `brain distribution has shifted; MLRO should review model calibration ` +
        `(NIST AI RMF MS-2.1 / EU AI Act Art.72)`
    );
  }

  // #37 KYC critical inconsistency → escalate (synthetic identity / tampering).
  if (extensions.kycConsistency?.topSeverity === 'critical') {
    finalVerdict = escalateTo(finalVerdict, 'escalate');
    const critCount = extensions.kycConsistency.findings.filter(
      (f) => f.severity === 'critical'
    ).length;
    clampReasons.push(
      `CLAMP: KYC documents have ${critCount} critical inconsistency/ies — ` +
        `possible synthetic identity or document tampering ` +
        `(FDL Art.12-14 / FATF Rec 10 / Cabinet Decision 109/2023)`
    );
  }

  // #38 Buy-back critical risk → escalate (DPMS cash-for-gold typology).
  if (extensions.buyBackRisks) {
    const criticalBuyBack = extensions.buyBackRisks.filter((r) => r.level === 'critical');
    if (criticalBuyBack.length > 0) {
      finalVerdict = escalateTo(finalVerdict, 'escalate');
      clampReasons.push(
        `CLAMP: ${criticalBuyBack.length} buy-back transaction(s) at critical risk ` +
          `(MoE Circular 08/AML/2021 §4 / FATF DPMS Typologies 2022)`
      );
    }
  }

  // #39 Price anomaly critical → escalate (over/under-invoicing for value transfer).
  if (extensions.priceAnomalies) {
    const criticalPrices = extensions.priceAnomalies.filter((p) => p.severity === 'critical');
    if (criticalPrices.length > 0) {
      finalVerdict = escalateTo(finalVerdict, 'escalate');
      clampReasons.push(
        `CLAMP: ${criticalPrices.length} transaction(s) with critical LBMA/DGD price ` +
          `deviation — possible over/under-invoicing (FATF Rec 20 / Cabinet Res 134/2025 Art.19)`
      );
    }
  }

  // #40 BFT insufficient consensus → advisory clamp (multi-source disagreement).
  if (extensions.bftConsensus && !extensions.bftConsensus.sufficientConsensus) {
    clampReasons.push(
      `CLAMP: BFT consensus insufficient ` +
        `(${extensions.bftConsensus.votes}/${extensions.bftConsensus.totalVotes} votes, ` +
        `quorum=${extensions.bftConsensus.quorum}) — subsystem disagreement; ` +
        `human review required (Cabinet Res 134/2025 Art.19 / NIST AI RMF GV-1.6)`
    );
  }

  // ---------------------------------------------------------------------------
  // Phase 4-10 subsystems (#41-#55) — ESG, TBML, PEP, Hawala, STR, Cross-border,
  // Anomaly Ensemble. All run in parallel. All optional (require caller input).
  // ---------------------------------------------------------------------------

  const [
    p4esg,
    p4carbon,
    p4tcfd,
    p4sdg,
    p4conflict,
    p4greenwash,
    p4esgMedia,
    p4slavery,
    p4tbml,
    p4fourEyes,
    p4filing,
    p4pep,
    p4hawala,
    p4crossBorder,
  ] = await Promise.all([
    // #41 ESG composite score
    req.esgInput
      ? Promise.resolve(runSafely('esgScorer', () => calculateEsgScore(req.esgInput!)))
      : Promise.resolve(undefined),

    // #42 Carbon footprint
    req.carbonInput
      ? Promise.resolve(
          runSafely('carbonFootprintEstimator', () => estimateCarbonFootprint(req.carbonInput!))
        )
      : Promise.resolve(undefined),

    // #43 TCFD alignment
    req.tcfdInput
      ? Promise.resolve(runSafely('tcfdAlignmentChecker', () => checkTcfdAlignment(req.tcfdInput!)))
      : Promise.resolve(undefined),

    // #44 UN SDG alignment
    req.sdgEvidence
      ? Promise.resolve(
          runSafely('unSdgAlignmentScorer', () =>
            scoreUnSdgAlignment(
              req.sdgEvidence!.entityId,
              req.sdgEvidence!.reportingYear,
              req.sdgEvidence!.evidence
            )
          )
        )
      : Promise.resolve(undefined),

    // #45 Conflict minerals
    req.conflictMineralSuppliers && req.conflictMineralSuppliers.length > 0
      ? Promise.resolve(
          runSafely('conflictMineralsScreener', () =>
            screenConflictMinerals(req.conflictMineralSuppliers!)
          )
        )
      : Promise.resolve(undefined),

    // #46 Greenwashing
    req.esgDisclosure
      ? Promise.resolve(
          runSafely('greenwashingDetector', () => detectGreenwashing(req.esgDisclosure!))
        )
      : Promise.resolve(undefined),

    // #47 ESG adverse media
    req.esgAdverseMediaHits && req.esgAdverseMediaHits.length > 0
      ? Promise.resolve(
          runSafely('esgAdverseMediaClassifier', () =>
            classifyEsgAdverseMedia(req.esgAdverseMediaHits!)
          )
        )
      : Promise.resolve(undefined),

    // #48 Modern slavery
    req.workforceProfile
      ? Promise.resolve(
          runSafely('modernSlaveryDetector', () => assessModernSlaveryRisk(req.workforceProfile!))
        )
      : Promise.resolve(undefined),

    // #49 TBML
    req.tbmlTransaction
      ? Promise.resolve(runSafely('tradeBasedMLDetector', () => detectTbml(req.tbmlTransaction!)))
      : Promise.resolve(undefined),

    // #50 Four-eyes enforcer
    req.fourEyesSubmission
      ? Promise.resolve(
          runSafely('fourEyesEnforcer', () => enforceFourEyes(req.fourEyesSubmission!))
        )
      : Promise.resolve(undefined),

    // #51 STR/SAR/CTR auto-classifier
    req.filingClassificationInput
      ? Promise.resolve(
          runSafely('strAutoClassifier', () => classifyFiling(req.filingClassificationInput!))
        )
      : Promise.resolve(undefined),

    // #52 PEP proximity scorer
    req.pepProximityInput
      ? Promise.resolve(
          runSafely('pepProximityScorer', () => scorePepProximity(req.pepProximityInput!))
        )
      : Promise.resolve(undefined),

    // #53 Hawala detector
    req.hawalaTransaction
      ? Promise.resolve(runSafely('hawalaDetector', () => detectHawala(req.hawalaTransaction!)))
      : Promise.resolve(undefined),

    // #54 Cross-border cash monitor
    req.crossBorderMovement
      ? Promise.resolve(
          runSafely('crossBorderCashMonitor', () =>
            monitorCrossBorderCash(req.crossBorderMovement!)
          )
        )
      : Promise.resolve(undefined),
  ]);

  // Assign Phase 4-10 results.
  extensions.esgScore = p4esg ?? undefined;
  extensions.carbonFootprint = p4carbon ?? undefined;
  extensions.tcfdAlignment = p4tcfd ?? undefined;
  extensions.sdgAlignment = p4sdg ?? undefined;
  extensions.conflictMinerals = p4conflict ?? undefined;
  extensions.greenwashing = p4greenwash ?? undefined;
  extensions.esgAdverseMedia = p4esgMedia ?? undefined;
  extensions.modernSlavery = p4slavery ?? undefined;
  extensions.tbml = p4tbml ?? undefined;
  extensions.fourEyes = p4fourEyes ?? undefined;
  extensions.filingClassification = p4filing ?? undefined;
  extensions.pepProximity = p4pep ?? undefined;
  extensions.hawala = p4hawala ?? undefined;
  extensions.crossBorderCash = p4crossBorder ?? undefined;

  // #55 Anomaly Ensemble — runs AFTER all other subsystems resolve (needs their outputs).
  extensions.anomalyEnsemble =
    runSafely('anomalyEnsemble', () => {
      const signals = [
        extensions.benford &&
          buildSignal(
            'benford',
            extensions.benford.verdict === 'non-conformity' ? 80 : 20,
            0.85,
            extensions.benford.verdict === 'non-conformity'
          ),
        extensions.priceAnomalies &&
          buildSignal(
            'price_anomaly',
            extensions.priceAnomalies.filter((p) => p.severity === 'critical').length > 0 ? 85 : 30,
            0.9,
            extensions.priceAnomalies.some((p) => p.severity === 'critical')
          ),
        extensions.tbml &&
          buildSignal(
            'tbml',
            extensions.tbml.compositeScore,
            0.88,
            extensions.tbml.overallRisk === 'high' || extensions.tbml.overallRisk === 'critical'
          ),
        extensions.hawala &&
          buildSignal(
            'hawala',
            extensions.hawala.score,
            0.82,
            extensions.hawala.riskLevel === 'high' || extensions.hawala.riskLevel === 'critical'
          ),
        extensions.buyBackRisks &&
          buildSignal(
            'buy_back',
            extensions.buyBackRisks.reduce((m, r) => Math.max(m, r.score), 0),
            0.85,
            extensions.buyBackRisks.some((r) => r.level === 'critical')
          ),
        extensions.adversarialInput &&
          buildSignal(
            'adversarial_ml',
            extensions.adversarialInput.topSeverity === 'critical' ? 90 : 20,
            0.9,
            !extensions.adversarialInput.clean
          ),
        extensions.verdictDrift &&
          buildSignal(
            'verdict_drift',
            extensions.verdictDrift.hasDrift ? 70 : 10,
            0.75,
            extensions.verdictDrift.hasDrift
          ),
      ].filter((s): s is NonNullable<typeof s> => s !== undefined && s !== null);

      if (signals.length === 0) return undefined;
      return runAnomalyEnsemble(req.mega.entity.id, signals);
    }) ?? undefined;

  // ---------------------------------------------------------------------------
  // Phase 11 — Security, Deduplication, STR Narrative, Predictive, Gold (#59-#72)
  // All run in parallel. Always-on subsystems derive inputs from existing data.
  // ---------------------------------------------------------------------------

  const [
    p11nameVariants,
    p11promptInjection,
    p11deepfake,
    p11dedupe,
    p11strNarrative,
    p11strPredict,
    p11penaltyVar,
    p11goldOrigin,
    p11assay,
    p11fineness,
    p11arbitrage,
    p11dormancy,
  ] = await Promise.all([
    // #71 Name variant expander — always-on; entity name is always available
    Promise.resolve(
      runSafely('nameVariantExpander', () =>
        expandNameVariants(req.mega.entity?.name ?? mega.entityId)
      )
    ),
    // #59 Prompt injection — always-on; scan entity name + mega notes.
    // mega.notes (string[]) is the post-refactor home of what used to be
    // mega.auditNarrative on MegaBrainResponse.
    Promise.resolve(
      runSafely('promptInjection', () =>
        detectPromptInjection(`${req.mega.entity?.name ?? ''} ${(mega.notes ?? []).join(' ')}`)
      )
    ),
    // #60 Deepfake document detector — conditional
    req.documentEvidence
      ? Promise.resolve(
          runSafely('deepfakeDoc', () => detectDeepfakeDocument(req.documentEvidence!))
        )
      : Promise.resolve(undefined),
    // #61 Cross-list sanctions dedupe — conditional on raw hits
    req.rawSanctionsHits && req.rawSanctionsHits.length > 0
      ? Promise.resolve(
          runSafely('sanctionsDedupe', () => dedupeCrossListHits(req.rawSanctionsHits!))
        )
      : Promise.resolve(undefined),
    // #62 STR narrative builder — runs when filing is required AND input provided
    req.strNarrativeInput && extensions.filingClassification?.primaryCategory !== 'NONE'
      ? Promise.resolve(runSafely('strNarrative', () => buildStrNarrative(req.strNarrativeInput!)))
      : Promise.resolve(undefined),
    // #63 Predictive STR — conditional on feature vector; auto-derive from mega if not supplied
    Promise.resolve(
      runSafely('strPrediction', () => {
        // StrFeatures (src/services/predictiveStr.ts:32) was recalibrated
        // to: priorAlerts90d, txValue30dAED, nearThresholdCount30d,
        // crossBorderRatio30d, isPep, highRiskJurisdiction, hasAdverseMedia,
        // daysSinceOnboarding, sanctionsMatchScore, cashRatio30d.
        const features: StrFeatures = req.strFeatures ?? {
          priorAlerts90d: 0,
          txValue30dAED: 0,
          nearThresholdCount30d: 0,
          crossBorderRatio30d: extensions.crossBorderCash?.cumulativeAmountAED ? 0.5 : 0,
          isPep:
            extensions.pepProximity?.overallRisk === 'critical' ||
            extensions.pepProximity?.overallRisk === 'high',
          highRiskJurisdiction:
            extensions.hawala?.riskLevel === 'critical' ||
            extensions.tbml?.overallRisk === 'critical',
          hasAdverseMedia: extensions.adverseMedia?.topCategory === 'critical',
          daysSinceOnboarding: 365,
          sanctionsMatchScore: finalVerdict === 'freeze' ? 1 : 0,
          cashRatio30d: 0,
        };
        return predictStr(features);
      })
    ),
    // #64 Penalty VaR — always-on; uses standard UAE DPMS violation list
    Promise.resolve(
      runSafely('penaltyVar', () => {
        // VaRConfig (src/services/penaltyVaR.ts:56) = { trials, confidence,
        // seed? }. ViolationType has no `severity` — severity is encoded
        // in maxPenalty magnitude (>=10M = criminal-tier, >=1M = major).
        const config: VaRConfig = req.penaltyVarConfig ?? {
          trials: 10_000,
          confidence: 0.95,
        };
        const CRIMINAL_MIN_AED = 10_000_000;
        const MAJOR_MIN_AED = 1_000_000;
        const violations = req.penaltyViolations?.length
          ? req.penaltyViolations
          : UAE_DPMS_VIOLATIONS.filter(
              (v) =>
                (finalVerdict === 'freeze' && v.maxPenalty >= CRIMINAL_MIN_AED) ||
                (finalVerdict === 'escalate' && v.maxPenalty >= MAJOR_MIN_AED) ||
                (finalVerdict === 'flag' && v.maxPenalty >= MAJOR_MIN_AED)
            );
        return violations.length > 0 ? runPenaltyVaR(violations, config) : undefined;
      })
    ),
    // #65 Gold origin tracer — conditional on shipment data
    req.goldShipments && req.goldShipments.length > 0
      ? Promise.resolve(runSafely('goldOrigin', () => traceGoldOrigin(req.goldShipments!)))
      : Promise.resolve(undefined),
    // #66 Assay certificate matcher — conditional. Requires a
    // RefinerLookup; when the caller didn't supply one we use a
    // null-object lookup that treats every refiner as unaccredited
    // (the safe default for a compliance gate).
    req.assayCertificateClaims && req.assayCertificateClaims.length > 0
      ? Promise.resolve(
          runSafely('assayMatch', () => {
            const nullRefinerLookup: RefinerLookup = () => undefined;
            return matchAssayCertificates(
              req.assayCertificateClaims!,
              req.refinerLookup ?? nullRefinerLookup
            );
          })
        )
      : Promise.resolve(undefined),
    // #67 Fineness anomaly — conditional
    req.finenessClaims && req.finenessClaims.length > 0
      ? Promise.resolve(
          runSafely('finenessAnomaly', () => detectFinenessAnomalies(req.finenessClaims!, []))
        )
      : Promise.resolve(undefined),
    // #68 Cross-border arbitrage — conditional. detectCrossBorderArbitrage
    // now takes a single footprint-array argument.
    req.customerFootprint
      ? Promise.resolve(
          runSafely('arbitrage', () => detectCrossBorderArbitrage(req.customerFootprint!))
        )
      : Promise.resolve(undefined),
    // #70 Dormancy activity — conditional
    req.dormancyTransactions && req.dormancyTransactions.length > 0
      ? Promise.resolve(
          runSafely('dormancy', () => detectDormancyActivity(req.dormancyTransactions!, {}))
        )
      : Promise.resolve(undefined),
  ]);

  extensions.nameVariants = p11nameVariants ?? undefined;
  extensions.promptInjection = p11promptInjection ?? undefined;
  extensions.deepfakeDoc = p11deepfake ?? undefined;
  extensions.sanctionsDedupe = p11dedupe ?? undefined;
  extensions.strNarrative = p11strNarrative ?? undefined;
  extensions.strPrediction = p11strPredict ?? undefined;
  extensions.penaltyVar = p11penaltyVar ?? undefined;
  extensions.goldOrigin = p11goldOrigin ?? undefined;
  extensions.assayMatch = p11assay ?? undefined;
  extensions.finenessAnomaly = p11fineness ?? undefined;
  extensions.arbitrage = p11arbitrage ?? undefined;
  extensions.dormancy = p11dormancy ?? undefined;

  // #72 STR narrative grader — runs synchronously after narrative is built.
  // gradeStrNarrative wants the plain text which lives on StrNarrative.text.
  if (extensions.strNarrative) {
    extensions.strNarrativeGrade = runSafely('strNarrativeGrader', () =>
      gradeStrNarrative({ narrative: extensions.strNarrative!.text })
    );
  }

  // Phase 11 safety clamps — derive detection flags from real report shapes:
  //   InjectionReport  → !clean
  //   DeepfakeReport   → verdict === 'likely_deepfake'
  //   FinenessReport   → mismatches > 0
  //   ArbitrageReport  → hits.length > 0
  if (extensions.promptInjection && !extensions.promptInjection.clean) {
    finalVerdict = escalateTo(finalVerdict, 'escalate');
    clampReasons.push(
      `CLAMP: prompt injection detected in entity input — input integrity compromised; ` +
        `(NIST AI RMF MANAGE-4.2 / OWASP ML Top 10)`
    );
    confidence = Math.min(confidence, 0.45);
  }
  if (extensions.deepfakeDoc?.verdict === 'likely_deepfake') {
    finalVerdict = escalateTo(finalVerdict, 'escalate');
    clampReasons.push(
      `CLAMP: deepfake/forged document detected — KYC integrity compromised ` +
        `(FDL No.10/2025 Art.12-14; Cabinet Decision 109/2023)`
    );
    confidence = Math.min(confidence, 0.4);
  }
  if (extensions.finenessAnomaly && extensions.finenessAnomaly.mismatches > 0) {
    finalVerdict = escalateTo(finalVerdict, 'flag');
    clampReasons.push(
      `CLAMP: gold fineness anomaly — claimed purity exceeds refiner capability ` +
        `(LBMA RGG v9 §4; DGD hallmark requirements; MoE Circular 08/AML/2021)`
    );
  }
  if (extensions.arbitrage && extensions.arbitrage.hits.length > 0) {
    finalVerdict = escalateTo(finalVerdict, 'flag');
    clampReasons.push(
      `CLAMP: cross-border price arbitrage detected — TBML indicator ` +
        `(FATF TBML 2020; Cabinet Res 134/2025 Art.16)`
    );
  }
  if (extensions.dormancy?.hits && extensions.dormancy.hits.length > 0) {
    finalVerdict = escalateTo(finalVerdict, 'flag');
    clampReasons.push(
      `CLAMP: dormancy-to-activity pattern — ${extensions.dormancy.hits.length} customer(s) reactivated; ` +
        `layering indicator (FATF Rec 10; Cabinet Res 134/2025 Art.7-10)`
    );
  }
  if (extensions.strPrediction && extensions.strPrediction.probability > 0.7) {
    finalVerdict = escalateTo(finalVerdict, 'escalate');
    clampReasons.push(
      `CLAMP: predictive STR model — ${(extensions.strPrediction.probability * 100).toFixed(0)}% ` +
        `probability of STR trigger within 30 days (FDL No.10/2025 Art.26-27; FATF Rec 20)`
    );
  }

  // ---------------------------------------------------------------------------
  // Phase 12 execution block — 25 new subsystems (#73-#97), all optional.
  // Runs AFTER Phase 11 so Phase 12 clamps can see Phase 11 signals.
  // Async subsystem (#75 multi-model) runs via Promise.resolve() wrapper.
  // ---------------------------------------------------------------------------

  // #73 Corporate graph walker — always runs when corporateGraph provided
  if (req.corporateGraph) {
    const cgReport = runSafely('corporateGraphWalker', () =>
      walkCorporateGraph(
        req.corporateGraph!.graph,
        req.corporateGraph!.queryId,
        req.corporateGraph!.predicate ?? (() => ({ flagged: false })),
        req.corporateGraph!.maxHops ?? 3
      )
    );
    extensions.corporateGraph = cgReport;
    if (cgReport && cgReport.hits.length > 0) {
      finalVerdict = escalateTo(finalVerdict, 'escalate');
      clampReasons.push(
        `CLAMP: corporate graph walk found ${cgReport.hits.length} flagged node(s) ` +
          `within ${cgReport.hops} hops — subsidiary/affiliate risk ` +
          `(FATF Rec 10 / Cabinet Decision 109/2023 UBO register)`
      );
    }
  }

  // #74 Graph motif UBO analyzer — circular ownership, star structures, cascades
  if (req.ownershipEdges && req.ownershipEdges.length > 0) {
    const motifReport = runSafely('graphMotifUboAnalyzer', () =>
      analyseOwnershipMotifs(req.ownershipEdges!)
    );
    extensions.ownershipMotifs = motifReport;
    if (motifReport && motifReport.findings.length > 0) {
      finalVerdict = escalateTo(finalVerdict, 'escalate');
      clampReasons.push(
        `CLAMP: ${motifReport.findings.length} ownership motif(s) detected ` +
          `(circular/cascade layering) — UBO obfuscation indicator ` +
          `(Cabinet Decision 109/2023 / FATF Rec 10)`
      );
    }
  }

  // #75 Multi-model screening — async, runs only when request + apiKey provided
  if (req.multiModelScreening) {
    try {
      const mmResult = await runMultiModelScreening(
        req.multiModelScreening.request,
        req.multiModelScreening.apiKey,
        req.multiModelScreening.models
      );
      extensions.multiModelConsensus = mmResult;
      if (mmResult.consensus === 'confirmed-match') {
        finalVerdict = escalateTo(finalVerdict, 'escalate');
        confidence = Math.min(confidence, 1 - mmResult.consensusConfidence + 0.05);
        clampReasons.push(
          `CLAMP: multi-model consensus CONFIRMED MATCH — ${mmResult.modelsResponded}/${mmResult.modelsQueried} models agree ` +
            `(confidence ${(mmResult.consensusConfidence * 100).toFixed(0)}%) ` +
            `(Cabinet Res 134/2025 Art.5 / FATF Rec 1 risk appetite)`
        );
      } else if (mmResult.riskLevel === 'critical') {
        finalVerdict = escalateTo(finalVerdict, 'escalate');
        clampReasons.push(
          `CLAMP: multi-model screening critical risk score ${mmResult.riskScore}/100 ` +
            `(Cabinet Res 134/2025 Art.5)`
        );
      }
    } catch (err) {
      subsystemFailures.push('multiModelScreening');
      clampReasons.push(
        `CLAMP: multiModelScreening failed (${err instanceof Error ? err.message : String(err)}) — manual review (FDL Art.24)`
      );
    }
  }

  // #76 Causal engine — counterfactual analysis on provided DAG.
  // runCounterfactual now takes CounterfactualQuery = { observation,
  // intervention, target }. The result carries factual / counterfactual /
  // change / affectedNodes; we adapt through unknown because the
  // downstream extension type was shaped for the legacy API.
  if (req.causalNodes && req.causalNodes.length > 0) {
    const causalResult = runSafely('causalEngine', () => {
      const cg = createCausalGraph(req.causalNodes!);
      if (!req.causalIntervention) return undefined;
      const target = req.causalTarget ?? req.causalNodes![0]?.id ?? 'unknown';
      const observation: Record<string, 0 | 1> = req.causalObservation ?? {};
      const result = runCounterfactual(cg, {
        observation,
        intervention: req.causalIntervention,
        target,
      });
      return {
        factual: result.factual,
        counterfactual: result.counterfactual,
        change: result.change,
        affectedNodes: result.affectedNodes,
        target,
      };
    });
    if (causalResult) {
      extensions.causalCounterfactual =
        causalResult as unknown as typeof extensions.causalCounterfactual;
    }
  }

  // #77 Debate arbiter — structured two-sided argument analysis
  if (req.debateInput) {
    const debateResult = runSafely('debateArbiter', () => runDebate(req.debateInput!));
    extensions.verdictDebate = debateResult;
    if (debateResult && debateResult.winner === 'con' && debateResult.margin > 0.4) {
      clampReasons.push(
        `ADVISORY: debate arbiter — CON side wins with margin ${debateResult.margin.toFixed(2)}; ` +
          `MLRO should review counter-verdict "${debateResult.winningAction}" ` +
          `before finalising (FDL Art.20-21 / Cabinet Res 134/2025 Art.19)`
      );
    }
  }

  // #78 Reflection critic — reasoning chain coverage analysis.
  // Opt-in via req.reflectionConfig so routine clean-path verdicts don't
  // accumulate "structural error" clamps from the default mega.chain.
  // MegaBrainResponse carries the chain on `chain`, not `reasoningChain`.
  if (req.reflectionConfig && mega.chain) {
    const reflectResult = runSafely('reflectionCritic', () =>
      reviewReasoningChain(mega.chain!, req.reflectionConfig)
    );
    extensions.reflectionReport = reflectResult;
    if (reflectResult && reflectResult.issues.some((i) => i.severity === 'error')) {
      confidence = Math.min(confidence, 0.65);
      clampReasons.push(
        `CLAMP: reflection critic found ${reflectResult.issues.filter((i) => i.severity === 'error').length} ` +
          `structural error(s) in reasoning chain — confidence capped at 65% ` +
          `(NIST AI RMF MS-2.2 / EU AI Act Art.72)`
      );
    }
  }

  // #79 Circular reasoning detector — dependency cycle detection
  if (req.dependencyEdges && req.dependencyEdges.length > 0) {
    const circularResult = runSafely('circularReasoningDetector', () =>
      detectCircularReasoning(req.dependencyEdges!)
    );
    extensions.circularReasoning = circularResult;
    if (circularResult && circularResult.cycles.length > 0) {
      confidence = Math.min(confidence, 0.7);
      clampReasons.push(
        `CLAMP: ${circularResult.cycles.length} circular dependency cycle(s) in subsystem conclusions — ` +
          `confidence capped at 70% (NIST AI RMF GV-1.6 / FDL Art.20-21)`
      );
    }
  }

  // #80 Game theory adversary — Nash equilibrium for detect vs evade
  if (req.gameTheoryStrategies) {
    const gameResult = runSafely('gameTheoryAdversary', () =>
      solveAdversaryGame(
        req.gameTheoryStrategies!.detectionStrategies,
        req.gameTheoryStrategies!.evasionStrategies,
        (d, e) => d.cost - e.cost // default payoff: detection cost minus evasion cost
      )
    );
    extensions.gameEquilibrium = gameResult;
    if (gameResult && gameResult.expectedPayoff < 0) {
      clampReasons.push(
        `ADVISORY: game theory — adversary has expected payoff advantage (${gameResult.expectedPayoff.toFixed(2)}); ` +
          `top evasion tactic: "${gameResult.topAttackerChoice}"; ` +
          `recommend strengthening "${gameResult.topDefenderChoice}" detection ` +
          `(FATF Rec 1 risk-based approach)`
      );
    }
  }

  // #81 LBMA fix price checker — gold trade benchmark deviation
  if (req.lbmaFixInput) {
    const lbmaResult = runSafely('lbmaFixPriceChecker', () =>
      checkLbmaFixDeviations(
        req.lbmaFixInput!.trades,
        req.lbmaFixInput!.lookup,
        req.lbmaFixInput!.config
      )
    );
    extensions.lbmaFixCheck = lbmaResult;
    if (lbmaResult && lbmaResult.frozen > 0) {
      finalVerdict = escalateTo(finalVerdict, 'freeze');
      clampReasons.push(
        `CLAMP: ${lbmaResult.frozen} LBMA gold trade(s) frozen — price deviation exceeds ` +
          `tolerance threshold (LBMA RGG v9 / FATF DPMS Typologies 2022 §3.4)`
      );
    } else if (lbmaResult && lbmaResult.flagged > 0) {
      finalVerdict = escalateTo(finalVerdict, 'escalate');
      clampReasons.push(
        `CLAMP: ${lbmaResult.flagged} gold trade(s) deviate from LBMA fix — price manipulation indicator ` +
          `(LBMA RGG v9 / MoE Circular 08/AML/2021)`
      );
    }
  }

  // #82 Melt loss — gold batch + refiner drift
  if (req.meltBatch) {
    const meltResult = runSafely('meltLoss', () => {
      const batch = assessMeltBatch(req.meltBatch!);
      if (req.meltRefinerHistory && req.meltRefinerHistory.length > 0) {
        // Detect refiner drift with historical data
        return detectRefinerDrift(req.meltBatch!.refinerId, req.meltRefinerHistory, req.meltBatch!);
      }
      return batch;
    });
    extensions.meltLoss = meltResult;
    if (meltResult && meltResult.severity === 'critical') {
      finalVerdict = escalateTo(finalVerdict, 'escalate');
      clampReasons.push(
        `CLAMP: critical melt loss deviation — ${meltResult.lossPct.toFixed(2)}% vs ` +
          `expected ${meltResult.expectedMinPct.toFixed(2)}%–${meltResult.expectedMaxPct.toFixed(2)}% ` +
          `(LBMA RGG v9 §4 / Dubai Good Delivery / MoE Circular 08/AML/2021)`
      );
    }
  }

  // #83 Free zone compliance — mandatory rule pass/fail
  if (req.freeZoneFacts) {
    const fzResult = runSafely('freeZoneCompliance', () =>
      checkFreeZoneCompliance(req.freeZoneFacts!)
    );
    extensions.freeZoneCompliance = fzResult;
    if (fzResult && fzResult.mandatoryFailures.length > 0) {
      finalVerdict = escalateTo(finalVerdict, 'escalate');
      clampReasons.push(
        `CLAMP: ${fzResult.mandatoryFailures.length} mandatory free zone rule failure(s) ` +
          `in ${fzResult.freeZone} — regulatory breach ` +
          `(Cabinet Res 134/2025 / ${fzResult.freeZone} Rules 2024)`
      );
    }
  }

  // #85 Shapley explainer — per-factor attribution values
  {
    const shapInput: ShapleyInput | null =
      req.shapleyInput ??
      (() => {
        // Auto-build from explainable scoring output if available
        const factors = extensions.explanation?.topFactors?.map((f) => f.name) ?? [];
        if (factors.length < 2) return null;
        const verdictFn: VerdictFn = (coalition: ReadonlySet<string>) => {
          // Simple additive model: factors carry their numeric weight
          // on one of `score` / `weight` / `contribution` depending on
          // the upstream explainer; read all three via a loose shape.
          let s = 0;
          for (const f of coalition) {
            const found = extensions.explanation?.topFactors?.find((tf) => tf.name === f) as
              | { score?: number; weight?: number; contribution?: number }
              | undefined;
            const contribution =
              (typeof found?.score === 'number' && found.score) ||
              (typeof found?.weight === 'number' && found.weight) ||
              (typeof found?.contribution === 'number' && found.contribution) ||
              1;
            s += contribution;
          }
          return s;
        };
        return { signals: factors, verdict: verdictFn };
      })();

    if (shapInput) {
      extensions.shapley = runSafely('shapleyExplainer', () =>
        computeShapleyAttribution(shapInput!)
      );
    }
  }

  // #86 Formal invariant verifier — validates canonical + custom state invariants
  {
    // Build a partial state snapshot in the shape the canonical
    // invariants read (BrainStateForVerification), not the full
    // WeaponizedBrainResponse. The invariants check `verdict`,
    // `requiresHumanReview`, `auditLogLength`, and
    // `outboundMessageContainsTippingOff`; mapping `finalVerdict`
    // to `verdict` here keeps the verifier honest. Custom invariants
    // get the same shape plus `extensions` for richer checks.
    const partialSnap = {
      verdict: finalVerdict,
      finalVerdict,
      confidence,
      clampReasons,
      requiresHumanReview: clampReasons.length > 0 || finalVerdict === 'freeze',
      auditLogLength: 0,
      outboundMessageContainsTippingOff: false,
      extensions,
    } as unknown as WeaponizedBrainResponse;

    const customInvs = req.customInvariants ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allInvariants = [...(CANONICAL_INVARIANTS as any[]), ...customInvs];
    if (allInvariants.length > 0) {
      extensions.invariantVerification = runSafely('invariantVerifier', () =>
        verifyInvariants({
          invariants: allInvariants,
          initial: partialSnap as unknown as Record<string, unknown>,
          transitions: [],
        })
      );
      if (
        extensions.invariantVerification &&
        extensions.invariantVerification.violations.length > 0
      ) {
        confidence = Math.min(confidence, 0.6);
        clampReasons.push(
          `CLAMP: ${extensions.invariantVerification.violations.length} formal invariant violation(s) — ` +
            `impossible state detected; confidence capped at 60% ` +
            `(NIST AI RMF GV-1.6 / EU AI Act Art.9)`
        );
      }
    }
  }

  // #87 Synthetic evasion generator — coverage gap check.
  // Opt-in only: gated on syntheticEvasionConfig so a clean default
  // call does not get a spurious "ADVISORY" pushed onto clampReasons.
  // (Matches the gating pattern of peerAnomalyInput, shapleyInput,
  // etc. Previously this ran unconditionally but the upstream
  // formal-verifier TDZ bug meant the code never reached it on
  // clean paths, so the always-on behaviour was masked.)
  if (req.syntheticEvasionConfig) {
    const synCases = runSafely('syntheticEvasionGenerator', () =>
      generateSyntheticEvasionCases(req.syntheticEvasionConfig!)
    );
    extensions.syntheticEvasion = synCases;
    if (synCases) {
      const uncaught = synCases.filter((c) => {
        // Check if the current verdict would catch this evasion case
        return c.expectedVerdict === 'freeze' && finalVerdict === 'pass';
      });
      if (uncaught.length > 0) {
        clampReasons.push(
          `ADVISORY: synthetic evasion test — ${uncaught.length}/${synCases.length} ` +
            `generated evasion case(s) would NOT be caught by current verdict; ` +
            `review detection coverage (FATF Guidance Red Flags 2021 / NIST AI RMF GV-1.6)`
        );
      }
    }
  }

  // #89 Peer anomaly — z-score outlier detection vs peer group
  if (req.peerAnomalyInput) {
    const peerResult = runSafely('peerAnomaly', () => analysePeerAnomaly(req.peerAnomalyInput!));
    extensions.peerAnomaly = peerResult;
    const anomalyThreshold = req.peerAnomalyInput.anomalyThreshold ?? 2.0;
    if (peerResult && peerResult.anomalies.length > 0) {
      finalVerdict = escalateTo(finalVerdict, 'flag');
      clampReasons.push(
        `CLAMP: peer anomaly — ${peerResult.anomalies.length} feature(s) are statistical outliers ` +
          `vs peer group (z-score threshold ${anomalyThreshold.toFixed(1)}) ` +
          `(FATF Rec 10 / Cabinet Res 134/2025 Art.5 risk appetite)`
      );
    }
  }

  // #90 Time-travel audit — critical path + current state snapshot
  if (req.auditEvidenceEntries && req.auditCaseRefId) {
    const ttResult = runSafely('timeTravelAudit', () => {
      const cp = criticalPath(req.auditEvidenceEntries!, req.auditCaseRefId!);
      const cs = currentState(req.auditEvidenceEntries!, req.auditCaseRefId!);
      return { criticalPath: cp, currentState: cs };
    });
    if (ttResult) extensions.timeTravelAudit = ttResult;
  }

  // #91 Document intelligence — structural tamper checks
  if (req.documentForTamperCheck) {
    const tamperResult = runSafely('documentIntelligence', () =>
      runTamperChecks({
        documentType: req.documentForTamperCheck!.documentType,
        fields: [],
        identifiers: {
          documentNumber: req.documentForTamperCheck!.documentId,
        },
        tamperSignals: [],
        overallConfidence: 1,
      })
    );
    extensions.documentTamper = tamperResult;
    if (tamperResult && tamperResult.tamperSignals.some((s) => s.severity === 'high')) {
      finalVerdict = escalateTo(finalVerdict, 'escalate');
      clampReasons.push(
        `CLAMP: document intelligence — high-severity tamper signal(s) in ${req.documentForTamperCheck.documentType} ` +
          `document — KYC/CDD integrity compromised ` +
          `(FDL Art.12-14 / Cabinet Decision 109/2023 / FATF Rec 10)`
      );
    }
  }

  // #92 Regulatory drift — concept drift in risk feature distribution
  if (req.regulatoryDriftSamples) {
    const driftResult = runSafely('regulatoryDrift', () =>
      analyseDrift(req.regulatoryDriftSamples!.baseline, req.regulatoryDriftSamples!.current)
    );
    extensions.regulatoryDrift = driftResult;
    if (driftResult && driftResult.overallBand === 'significant') {
      confidence = Math.min(confidence, 0.65);
      clampReasons.push(
        `CLAMP: significant regulatory drift detected — ${driftResult.driftedFeatureCount} feature(s) drifted; ` +
          `model re-calibration required (NIST AI RMF MS-2.1 / EU AI Act Art.72)`
      );
    }
  }

  // #93 goAML XML builder — auto-generates XML filing when report provided
  if (req.goamlReport) {
    const xmlResult = runSafely('goamlBuilder', () =>
      buildGoAMLXml(req.goamlReport!, req.goamlCase, req.goamlCustomer)
    );
    if (xmlResult) extensions.goamlXml = xmlResult;
  }

  // #94 Bayesian belief network — posterior probability update
  if (req.bayesianHypotheses && req.bayesianEvidence && req.bayesianEvidence.length > 0) {
    const beliefResult = runSafely('bayesianBelief', () => {
      const prior = uniformPrior(req.bayesianHypotheses!);
      return runBeliefUpdate(req.bayesianHypotheses!, prior, req.bayesianEvidence!);
    });
    extensions.bayesianBelief = beliefResult;
    if (beliefResult) {
      // If the most likely hypothesis is 'high_risk' or 'freeze' → clamp
      const topHyp = beliefResult.mostLikely;
      if ((topHyp.id === 'high_risk' || topHyp.id === 'freeze') && topHyp.probability > 0.65) {
        finalVerdict = escalateTo(finalVerdict, 'escalate');
        clampReasons.push(
          `CLAMP: Bayesian belief — P(${topHyp.label})=${(topHyp.probability * 100).toFixed(0)}% ` +
            `posterior probability; high-risk hypothesis dominant ` +
            `(FDL Art.20-21 / FATF Rec 10)`
        );
      }
      // High entropy → low confidence (uncertainty)
      if (beliefResult.entropyBits > 2.5) {
        confidence = Math.min(confidence, 0.6);
        clampReasons.push(
          `CLAMP: Bayesian belief high entropy (${beliefResult.entropyBits.toFixed(2)} bits) — ` +
            `uncertain evidence; confidence capped at 60% (NIST AI RMF MS-2.1)`
        );
      }
    }
  }

  // #95 Case-based reasoning — analogical verdict recommendation from past cases
  if (req.caseMemory) {
    const cbrResult = runSafely('caseBasedReasoning', () => {
      const queryFeatures = {
        verdict: VERDICT_RANK[finalVerdict],
        confidence,
        riskScore: extensions.explanation?.score ?? 50,
        pepFlag: extensions.pepProximity?.overallRisk === 'critical' ? 1 : 0,
        sanctionsFlag: finalVerdict === 'freeze' ? 1 : 0,
      };
      return req.caseMemory!.reuse(queryFeatures, 5);
    });
    if (cbrResult) {
      extensions.cbrRecommendation = [cbrResult];
    }
  }

  // #96 EU AI Act readiness — Article checklist scaffolding.
  // buildReadinessPayloads() returns the task payloads that WOULD be
  // dispatched; ReadinessScaffoldResult is the dispatch-shaped outcome.
  // Wrap the payload list into a "planned only" scaffold result so the
  // extension carries a structurally valid object until the sync step.
  if (req.aiGovernanceInput && req.euAiActProjectGid) {
    const payloads = runSafely('euAiActReadiness', () =>
      buildReadinessPayloads(req.euAiActProjectGid!)
    );
    if (payloads) {
      extensions.euAiActReadiness = {
        dispatched: 0,
        skipped: payloads.length,
        failed: 0,
        taskGids: [],
        errors: [],
      } as unknown as typeof extensions.euAiActReadiness;
    }
  }

  // #97 Rule induction — learn decision tree from labeled samples
  if (req.inductionSamples && req.inductionSamples.length >= 5) {
    const rulesResult = runSafely('ruleInduction', () => {
      const tree = learnDecisionTree(req.inductionSamples!, req.inductionConfig);
      return extractRules(tree);
    });
    if (rulesResult) extensions.inducedRules = rulesResult;
  }

  // #98 Deep research engine — iterative search/reason/cite loop.
  // Async because the engine awaits injected search/extract/reason backends.
  // Failures escalate to manual review per FDL Art.24 — never silently swallowed.
  if (req.deepResearch) {
    const dr = req.deepResearch;
    try {
      extensions.deepResearch = await runDeepResearch(
        {
          question: dr.question,
          entity: dr.entity,
          purpose: dr.purpose,
          maxIterations: dr.maxIterations,
          maxQueriesPerIteration: dr.maxQueriesPerIteration,
          deadlineMs: dr.deadlineMs,
        },
        dr.deps
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      subsystemFailures.push('deepResearchEngine');
      clampReasons.push(
        `CLAMP: subsystem deepResearchEngine failed (${message}) — manual review required (FDL Art.24)`
      );
    }
  }

  // Phase 13 — Reasoning & Analysis subsystems (#99-#103).
  // All five are READ-ONLY: they observe the collected signals / clamps /
  // verdict but never modify finalVerdict. Any failure logs to
  // subsystemFailures (FDL Art.24) and continues — Phase 13 is diagnostic,
  // so a failure must not lose the rest of the decision record.
  // ---------------------------------------------------------------------------

  // #99 Factor ablation — necessity test per input signal.
  {
    const ablationResult = runSafely('factorAblation', () =>
      runFactorAblation({
        baselineVerdict: finalVerdict,
        signals,
      })
    );
    if (ablationResult) extensions.factorAblation = ablationResult;
  }

  // #100 Citation integrity — enforce CLAUDE.md §8 on the collected clamps.
  {
    const integrityResult = runSafely('citationIntegrity', () =>
      checkCitationIntegrity({ clampReasons })
    );
    if (integrityResult) extensions.citationIntegrity = integrityResult;
  }

  // #101 Reasoning-chain DAG — provenance for MLRO review + xyflow UI.
  {
    const dagResult = runSafely('reasoningDag', () =>
      buildReasoningDag({
        signals,
        clampReasons,
        megaVerdict: mega.verdict,
        finalVerdict,
      })
    );
    if (dagResult) extensions.reasoningDag = dagResult;
  }

  // #102 Benign-narrative probe — runs only when a generator is injected.
  if (req.benignNarrativeGenerator) {
    try {
      extensions.benignNarrative = await runBenignNarrativeProbe({
        entitySummary: req.entitySummaryForBenignProbe ?? mega.entityId,
        signals,
        generator: req.benignNarrativeGenerator,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      subsystemFailures.push('benignNarrativeProbe');
      clampReasons.push(
        `CLAMP: subsystem benignNarrativeProbe failed (${message}) — manual review required (FDL Art.24)`
      );
    }
  }

  // #103 Evidence freshness decay — runs only when dated signals are provided.
  if (req.datedSignalsForFreshness && req.datedSignalsForFreshness.length > 0) {
    const freshnessResult = runSafely('evidenceFreshness', () =>
      runEvidenceFreshness({
        signals: req.datedSignalsForFreshness!,
        asOf: req.freshnessAsOf,
        halfLifeDays: req.freshnessHalfLifeDays,
      })
    );
    if (freshnessResult) extensions.evidenceFreshness = freshnessResult;
  }

  // ---------------------------------------------------------------------------
  // Phase 14 — Intelligence & Awareness subsystems (#104-#109).
  // All five are READ-ONLY in v1 — they observe but never clamp
  // finalVerdict. Any failure logs to subsystemFailures (FDL Art.24).
  // ---------------------------------------------------------------------------

  // #104 Cross-jurisdiction conflict detector.
  if (
    req.proposedAction &&
    req.applicableJurisdictions &&
    req.applicableJurisdictions.length >= 2
  ) {
    const conflictsResult = runSafely('crossJurisdictionConflicts', () =>
      detectCrossJurisdictionConflicts({
        action: req.proposedAction!,
        jurisdictions: req.applicableJurisdictions!,
      })
    );
    if (conflictsResult) extensions.crossJurisdictionConflicts = conflictsResult;
  }

  // #105 Peer-group deviation detector.
  if (req.peerGroupDistribution) {
    const deviationResult = runSafely('peerGroupDeviation', () =>
      runPeerGroupDeviation({
        currentVerdict: finalVerdict,
        peer: req.peerGroupDistribution!,
      })
    );
    if (deviationResult) extensions.peerDeviation = deviationResult;
  }

  // #106 Regulatory calendar — urgency classification (report-only).
  if (req.regulatoryDeadlines && req.regulatoryDeadlines.length > 0) {
    const calendarResult = runSafely('regulatoryCalendar', () =>
      runRegulatoryCalendar({
        deadlines: req.regulatoryDeadlines!,
        asOf: req.calendarAsOf,
      })
    );
    if (calendarResult) extensions.regulatoryCalendar = calendarResult;
  }

  // #107 Inter-subsystem agreement scorer — always runs over collected signals.
  {
    const agreementResult = runSafely('interSubsystemAgreement', () =>
      scoreInterSubsystemAgreement({ finalVerdict, signals })
    );
    if (agreementResult) extensions.agreementScore = agreementResult;
  }

  // #109 Counterfactual completion — always runs (browser-safe, no external I/O).
  {
    const completionResult = runSafely('counterfactualCompletion', () =>
      runCounterfactualCompletion({
        currentVerdict: finalVerdict,
        knownEvidenceTypes: req.knownEvidenceTypes ?? [],
      })
    );
    if (completionResult) extensions.counterfactualCompletion = completionResult;
  }

  // ---------------------------------------------------------------------------
  // Phase 15 — adaptive meta-planner, reasoning chain, threshold calibration,
  // pattern mining, hypothesis generator. All diagnostic; verdict unchanged.
  // Runs after the verdict stabilises so the reports reflect the final state.
  // ---------------------------------------------------------------------------

  // Build aged signals from the existing `signals` list, decorated with any
  // age hints the caller provided.
  const agedSignals: AgedSignal[] = signals.map((s) => ({
    name: s.name,
    impliedVerdict: s.impliedVerdict,
    confidence: s.confidence,
    ageDays: req.signalAgeDaysBySubsystem?.[s.name],
  }));

  // #110 Adaptive meta-planner — attention / focus brief.
  const reliabilityRegistry =
    req.reliabilityRegistry ?? createInMemoryReliabilityRegistry();
  const adaptiveMetaResult = runSafely('adaptiveMeta', () =>
    runAdaptiveMeta({
      signals: agedSignals,
      registry: reliabilityRegistry,
    })
  );
  if (adaptiveMetaResult) extensions.adaptiveMeta = adaptiveMetaResult;

  // #111 Reasoning chain — deep thinking over the top-K focused signals.
  if (extensions.adaptiveMeta) {
    const chainResult = runSafely('reasoningChainComposed', () =>
      composeReasoningChain({
        focus: extensions.adaptiveMeta!.topFocus,
        finalVerdict,
      })
    );
    if (chainResult) extensions.reasoningChainComposed = chainResult;
  }

  // #112 Threshold self-calibrator — only when sufficient labeled history.
  if (req.calibrationOutcomes && req.calibrationOutcomes.length > 0) {
    const calibrationResult = runSafely('thresholdCalibration', () =>
      calibrateThresholds(req.calibrationOutcomes!)
    );
    if (calibrationResult) extensions.thresholdCalibration = calibrationResult;
  }

  // #113 Signal pattern miner — only when past-case signatures supplied.
  if (req.pastCaseSignatures && req.pastCaseSignatures.length > 0) {
    const patternResult = runSafely('patternMining', () =>
      minePatternClusters({
        cases: req.pastCaseSignatures!,
        mergeThreshold: req.patternMiningMergeThreshold,
      })
    );
    if (patternResult) extensions.patternMining = patternResult;
  }

  // #114 Hypothesis generator — always runs when we have a focus brief.
  if (extensions.adaptiveMeta) {
    const hypothesesResult = runSafely('hypotheses', () =>
      generateHypotheses({
        focus: extensions.adaptiveMeta!.topFocus,
        hypotheses: req.hypothesesOverride,
      })
    );
    if (hypothesesResult) extensions.hypotheses = hypothesesResult;
  }

  // #88 Quantum-resistant seal — always runs last (seals everything above)
  {
    const sealRecords: QuantumSealRecord[] = [
      { id: `${mega.entityId}:verdict`, data: `${finalVerdict}:${confidence.toFixed(4)}` },
      { id: `${mega.entityId}:clamps`, data: clampReasons.join('|') },
      { id: `${mega.entityId}:subsystems`, data: Object.keys(extensions).sort().join(',') },
    ];
    extensions.quantumSeal = runSafely('quantumResistantSeal', () =>
      sealQuantumResistant(sealRecords)
    );
  }

  // ---------------------------------------------------------------------------
  // Phase 4-10 safety clamps — monotone escalation only.
  // ---------------------------------------------------------------------------

  // #98 Deep research critical signal → escalate. Critical verdictHint
  // requires >=2 distinct hostnames corroborating a critical-severity claim
  // (corroboration floor in deepResearchEngine), so this clamp only fires
  // on real corroborated adverse signal — no single-source false positives.
  // FATF Rec 10 + Cabinet Res 134/2025 Art.14 (EDD on adverse media).
  if (extensions.deepResearch?.verdictHint === 'critical') {
    finalVerdict = escalateTo(finalVerdict, 'escalate');
    const claimCount = extensions.deepResearch.claims.filter(
      (c) => c.severity === 'critical' && c.distinctHostnames >= 2
    ).length;
    clampReasons.push(
      `CLAMP: deep research surfaced ${claimCount} corroborated critical claim(s) — ` +
        `escalate (FATF Rec 10 + Cabinet Res 134/2025 Art.14 + FDL Art.19)`
    );
  }

  // #41 ESG critical risk → escalate (LBMA RGG v9 §6 / ISSB S1 materiality).
  if (extensions.esgScore?.riskLevel === 'critical') {
    finalVerdict = escalateTo(finalVerdict, 'escalate');
    clampReasons.push(
      `CLAMP: ESG composite score ${extensions.esgScore.totalScore.toFixed(0)}/100 (${extensions.esgScore.grade}) ` +
        `— critical ESG risk level; escalate per LBMA RGG v9 §6 / ISSB IFRS S1`
    );
  }

  // #45 Conflict minerals critical supplier → escalate (OECD DDG / Dodd-Frank §1502).
  if (extensions.conflictMinerals?.overallRisk === 'critical') {
    finalVerdict = escalateTo(finalVerdict, 'escalate');
    clampReasons.push(
      `CLAMP: conflict minerals critical risk — ${extensions.conflictMinerals.criticalCount} critical supplier(s) ` +
        `in CAHRA zones (OECD DDG 2016 Step 3 / Dodd-Frank §1502 / EU CMR 2017/821)`
    );
  }

  // #46 Greenwashing critical → escalate. GreenwashingReport has no
  // scalar `criticalFindings`; derive from findings[].severity.
  if (extensions.greenwashing?.overallRisk === 'critical') {
    const gwCritical = extensions.greenwashing.findings.filter(
      (f) => f.severity === 'critical'
    ).length;
    finalVerdict = escalateTo(finalVerdict, 'escalate');
    clampReasons.push(
      `CLAMP: critical greenwashing detected — ${gwCritical} critical finding(s); ` +
        `material ESG misrepresentation (ISSB IFRS S1 / EU SFDR Art.4)`
    );
  }

  // #48 Modern slavery critical → escalate (UAE Federal Law 51/2006 / ILO Conv. 29/105).
  // ModernSlaveryReport risk label lives on `riskLevel`.
  if (extensions.modernSlavery?.riskLevel === 'critical') {
    finalVerdict = escalateTo(finalVerdict, 'escalate');
    clampReasons.push(
      `CLAMP: modern slavery critical risk — ${extensions.modernSlavery.iloIndicatorsTriggered} ILO indicator(s) ` +
        `(UAE Federal Law 51/2006 / ILO Conv. 29/105 / LBMA RGG v9 §5)`
    );
  }

  // #49 TBML critical → escalate (FATF TBML Guidance 2020 / FDL Art.12).
  if (extensions.tbml?.overallRisk === 'critical') {
    finalVerdict = escalateTo(finalVerdict, 'escalate');
    clampReasons.push(
      `CLAMP: TBML critical — ${extensions.tbml.patterns.length} pattern(s) detected ` +
        `(score ${extensions.tbml.compositeScore}/100); STR required ` +
        `(FATF TBML Guidance 2020 / FDL No.10/2025 Art.12)`
    );
  }

  // #50 Four-eyes violation → freeze (compliance decision without proper approval).
  if (
    extensions.fourEyes &&
    !extensions.fourEyes.meetsRequirements &&
    extensions.fourEyes.decisionType === 'sanctions_freeze'
  ) {
    finalVerdict = escalateTo(finalVerdict, 'freeze');
    clampReasons.push(
      `CLAMP: four-eyes violated for sanctions freeze decision — ` +
        `${extensions.fourEyes.violations.join('; ')} ` +
        `(Cabinet Res 74/2020 Art.4 / FDL No.10/2025 Art.20-21)`
    );
  }

  // #52 PEP proximity critical → escalate (board approval required).
  if (extensions.pepProximity?.overallRisk === 'critical') {
    finalVerdict = escalateTo(finalVerdict, 'escalate');
    clampReasons.push(
      `CLAMP: PEP proximity critical (score ${extensions.pepProximity.maxProximityScore.toFixed(0)}/100) — ` +
        `board approval required (Cabinet Res 134/2025 Art.14)`
    );
  }

  // #53 Hawala critical → escalate (UAE CBUAE Hawala / FATF Rec 14).
  if (extensions.hawala?.riskLevel === 'critical') {
    finalVerdict = escalateTo(finalVerdict, 'escalate');
    clampReasons.push(
      `CLAMP: Hawala/IVTS critical risk (score ${extensions.hawala.score}/100) — ` +
        `${extensions.hawala.indicators.length} indicator(s) ` +
        `(UAE CBUAE Hawala Registration Requirement 2022 / FATF Rec 14)`
    );
  }

  // #54 Cross-border structuring → freeze (Cabinet Res 134/2025 Art.16).
  if (extensions.crossBorderCash?.structuringDetected) {
    finalVerdict = escalateTo(finalVerdict, 'freeze');
    clampReasons.push(
      `CLAMP: cross-border cash structuring detected — cumulative AED ` +
        `${extensions.crossBorderCash.cumulativeAmountAED.toLocaleString()} ` +
        `across sub-threshold movements (Cabinet Res 134/2025 Art.16 / FATF Rec 32)`
    );
  } else if (extensions.crossBorderCash?.overallRisk === 'critical') {
    finalVerdict = escalateTo(finalVerdict, 'escalate');
    clampReasons.push(
      `CLAMP: cross-border cash critical risk (score ${extensions.crossBorderCash.riskScore}/100) ` +
        `(Cabinet Res 134/2025 Art.16)`
    );
  }

  // #55 Anomaly ensemble critical → escalate (composite anomaly signal).
  if (extensions.anomalyEnsemble?.anomalyLevel === 'critical') {
    finalVerdict = escalateTo(finalVerdict, 'escalate');
    clampReasons.push(
      `CLAMP: anomaly ensemble score ${extensions.anomalyEnsemble.aggregatedScore.toFixed(0)}/100 (critical) — ` +
        `dominant signal: ${extensions.anomalyEnsemble.dominantSignal ?? 'multi-source'}; ` +
        `Bayesian BMA confidence ${(extensions.anomalyEnsemble.confidence * 100).toFixed(0)}%`
    );
  }

  // 8. Augmented confidence — take MIN across MegaBrain + new signals.
  // (`confidence` is hoisted at the top of the function alongside
  // `finalVerdict` so the Phase 12 subsystems can clamp it earlier.)
  if (extensions.adverseMedia?.topCategory === 'critical') {
    confidence = Math.min(confidence, policy.adverseMediaCriticalConfidenceCap);
  }
  if (extensions.ubo?.summary.hasSanctionedUbo) {
    confidence = Math.min(confidence, policy.sanctionedUboConfidenceCap);
  }
  if (extensions.wallets && extensions.wallets.confirmedHits > 0) {
    confidence = Math.min(confidence, policy.walletConfirmedConfidenceCap);
  }
  if (subsystemFailures.length > 0) {
    confidence = Math.min(confidence, policy.subsystemFailureConfidenceCap);
  }
  if (extensions.contradictions?.hasContradiction) {
    // Contradiction detector: cap confidence by (1 - score) so a 0.67 score
    // drops confidence to 0.33.
    confidence = Math.min(confidence, 1 - extensions.contradictions.score);
  }

  // Phase 3 confidence adjustments.
  // Critical adversarial input: evasion attempt is severe — cap at 0.50.
  if (extensions.adversarialInput?.topSeverity === 'critical') {
    confidence = Math.min(confidence, 0.5);
  }
  // Benford non-conformity: ledger integrity uncertain — cap at 0.60.
  if (extensions.benford?.verdict === 'non-conformity') {
    confidence = Math.min(confidence, 0.6);
  }
  // KYC critical inconsistency: identity uncertain — cap at 0.55.
  if (extensions.kycConsistency?.topSeverity === 'critical') {
    confidence = Math.min(confidence, 0.55);
  }
  // BFT no consensus: sources disagree — cap at 0.65.
  if (
    extensions.bftConsensus !== undefined &&
    extensions.bftConsensus !== null &&
    !extensions.bftConsensus.sufficientConsensus
  ) {
    confidence = Math.min(confidence, 0.65);
  }

  // Phase 4-10 confidence adjustments.
  if (extensions.tbml?.overallRisk === 'critical') confidence = Math.min(confidence, 0.55);
  if (extensions.hawala?.riskLevel === 'critical') confidence = Math.min(confidence, 0.55);
  if (extensions.crossBorderCash?.structuringDetected) confidence = Math.min(confidence, 0.5);
  if (extensions.modernSlavery?.riskLevel === 'critical') confidence = Math.min(confidence, 0.6);
  if (extensions.pepProximity?.overallRisk === 'critical') confidence = Math.min(confidence, 0.6);
  if (extensions.esgScore?.riskLevel === 'critical') confidence = Math.min(confidence, 0.65);
  if (extensions.conflictMinerals?.overallRisk === 'critical')
    confidence = Math.min(confidence, 0.6);

  // 9. Augmented human-review flag.
  let requiresHumanReview =
    mega.requiresHumanReview ||
    clampReasons.length > 0 ||
    finalVerdict === 'freeze' ||
    confidence < 0.7 ||
    subsystemFailures.length > 0;

  // 10. Audit narrative (before advisor — the advisor sees the narrative).
  let auditNarrative = buildAuditNarrative(mega, finalVerdict, clampReasons, extensions);
  if (subsystemFailures.length > 0) {
    auditNarrative += `\n\nSubsystem failures: ${subsystemFailures.join(', ')}`;
  }

  // #84 Tipping-off linter — FDL Art.29 scan of ALL generated text before
  // the narrative leaves the system. This is a HARD gate: if tipping-off
  // phrases are detected, the narrative is redacted and a clamp fires.
  // No human may receive the unredacted narrative if this fires.
  {
    // Combine all text that might leave the system
    const allGeneratedText = [
      auditNarrative,
      extensions.strNarrative?.text ?? '',
      extensions.mlroAlerts?.alerts?.map((a) => a.narrative).join('\n') ?? '',
    ].join('\n\n---\n\n');

    const tippingReport = runSafely('tippingOffLinter', () => lintForTippingOff(allGeneratedText));
    extensions.tippingOff = tippingReport;

    if (tippingReport && !tippingReport.clean) {
      // HARD gate: replace the tipping-off phrases with [REDACTED] markers
      let redacted = auditNarrative;
      for (const finding of tippingReport.findings) {
        redacted = redacted.replace(
          new RegExp(finding.matchedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
          '[REDACTED — FDL Art.29]'
        );
      }
      auditNarrative = redacted;

      // Hard clamp: tipping-off is a criminal offence under FDL Art.29
      clampReasons.push(
        `HARD CLAMP: tipping-off linter detected ${tippingReport.findings.length} disclosure-risk phrase(s) ` +
          `in generated narrative — phrases REDACTED before output ` +
          `(FDL No.10/2025 Art.29 — criminal penalty up to AED 5M; NO tipping off)`
      );
      requiresHumanReview = true;
    }
  }

  // 11. Advisor escalation — called only when a compliance trigger fires.
  //
  // Trigger rules (match the mandatory triggers in
  // COMPLIANCE_ADVISOR_SYSTEM_PROMPT, advisorStrategy.ts):
  //   - verdict is 'escalate' or 'freeze'           (trigger #4)
  //   - any safety clamp fired                       (triggers #2, #5, #6)
  //
  // Confidence alone is NOT a trigger — MegaBrain is calibrated
  // conservative and routinely emits 0.3 confidence on clean passes. Using
  // confidence < 0.7 as a trigger would fire the advisor on every routine
  // request and burn Opus budget on nothing. Instead, low confidence
  // shows up in requiresHumanReview downstream.
  //
  // The advisor never changes the verdict (that's deterministic) — it only
  // produces a concise rationale appended to the narrative + clampReasons.
  // Failures are logged and swallowed; the decision proceeds without advice.
  let advisorResult: AdvisorEscalationResult | null = null;
  if (req.advisor) {
    const shouldEscalate =
      finalVerdict === 'escalate' || finalVerdict === 'freeze' || clampReasons.length > 0;
    if (shouldEscalate) {
      const reason = buildAdvisorReason(finalVerdict, confidence, clampReasons);
      try {
        advisorResult = await req.advisor({
          reason,
          entityId: mega.entityId,
          entityName: req.mega.entity.name,
          verdict: finalVerdict,
          confidence,
          clampReasons,
          narrative: auditNarrative,
        });
        if (advisorResult && advisorResult.text.trim().length > 0) {
          clampReasons.push(`ADVISOR: ${advisorResult.text.trim()}`);
          auditNarrative +=
            `\n\nAdvisor review (${advisorResult.modelUsed}, ` +
            `${advisorResult.advisorCallCount} sub-inference${advisorResult.advisorCallCount === 1 ? '' : 's'}):\n` +
            advisorResult.text.trim();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Advisor failures never block the decision. Log to narrative so
        // the MLRO sees that the advisor was attempted.
        auditNarrative += `\n\nAdvisor escalation attempted but failed: ${message}`;
      }
    }
  }

  // #33 Advisor Hallucination Detector — validates every regulatory citation
  // in advisor output against the known-good whitelist. Runs only when the
  // advisor produced text. Critical hallucinations cap confidence + warn MLRO.
  // (NIST AI RMF MS-2.2 / FDL Art.20-21)
  if (advisorResult && advisorResult.text.trim().length > 0) {
    extensions.advisorHallucinations = runSafely('advisorHallucinationDetector', () =>
      detectAdvisorHallucinations(advisorResult!.text)
    );
    if (extensions.advisorHallucinations && !extensions.advisorHallucinations.clean) {
      // HallucinationFinding has a `confidence` label ('high'|'medium'|'low')
      // — high = high-confidence hallucination, treated as critical.
      const critHallucinations = extensions.advisorHallucinations.findings.filter(
        (f) => f.confidence === 'high'
      );
      if (critHallucinations.length > 0) {
        clampReasons.push(
          `CLAMP: advisor output contains ${critHallucinations.length} hallucinated ` +
            `regulatory citation(s) — MLRO must verify before acting ` +
            `(NIST AI RMF MS-2.2 / FDL Art.20-21)`
        );
        // Degraded advisor reliability — cap confidence further.
        confidence = Math.min(confidence, 0.6);
        auditNarrative +=
          `\n\nAdvisor Hallucination Warning: citation(s) not in UAE AML/CFT/CPF whitelist: ` +
          critHallucinations.map((f) => f.citation).join(', ') +
          '. MLRO should independently verify these references.';
        // Update human-review flag since new clamp reasons were added.
        requiresHumanReview = true;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Synthesis Layer — runs LAST after all subsystems + advisor + clamps.
  // Produces MLRO alerts, Asana task tree, and KPI dashboard in parallel.
  // Never blocks the verdict — all failures are swallowed + logged.
  // ---------------------------------------------------------------------------

  // Managed Agent Plan — resolve which agents to spawn for this verdict.
  const orchestratorSession = createOrchestratorSession(mega.entityId);
  const agentTypes = resolveAgentsForVerdict(finalVerdict, {
    filingClassification: extensions.filingClassification
      ? { primaryCategory: extensions.filingClassification.primaryCategory }
      : undefined,
    pepProximity: extensions.pepProximity
      ? { requiresBoardApproval: extensions.pepProximity.requiresBoardApproval }
      : undefined,
    esgScore: extensions.esgScore ? { riskLevel: extensions.esgScore.riskLevel } : undefined,
    hawala: extensions.hawala
      ? { requiresCbuaeReport: extensions.hawala.requiresCbuaeReport }
      : undefined,
    crossBorderCash: extensions.crossBorderCash
      ? { structuringDetected: extensions.crossBorderCash.structuringDetected }
      : undefined,
  });
  const managedAgentPlan: ManagedAgentTask[] = agentTypes.map((agentType) =>
    spawnManagedAgent(
      orchestratorSession,
      agentType,
      req.mega.entity?.name ?? mega.entityId,
      finalVerdict
    )
  );

  // Build the partial response object for the synthesis layer to consume.
  const partialResponse: WeaponizedBrainResponse = {
    mega,
    extensions,
    finalVerdict,
    clampReasons,
    requiresHumanReview,
    confidence: Math.round(confidence * 10000) / 10000,
    auditNarrative,
    subsystemFailures,
    advisorResult,
    managedAgentPlan,
    orchestratorSession,
  };

  // MLRO Alert Generator — always runs; produces structured alert bundle.
  extensions.mlroAlerts = runSafely('mlroAlertGenerator', () =>
    generateMlroAlerts(partialResponse)
  );

  // Asana Orchestrator — runs only when asanaConfig is supplied.
  if (req.asanaConfig) {
    try {
      extensions.asanaSync = await orchestrateBrainToAsana(partialResponse, req.asanaConfig);
    } catch {
      subsystemFailures.push('brainToAsanaOrchestrator');
    }
  }

  // KPI Dashboard — runs when kpiMeasurements are supplied.
  if (req.kpiMeasurements && req.kpiMeasurements.length > 0) {
    const period = req.kpiPeriod ?? {
      start: new Date(Date.now() - 90 * 86_400_000).toISOString().split('T')[0],
      end: new Date().toISOString().split('T')[0],
    };
    extensions.kpiDashboard = runSafely('complianceMetricsDashboard', () =>
      buildKpiReport(mega.entityId, period.start, period.end, req.kpiMeasurements!)
    );
  }

  // #56 Hawkeye Sterling V2 Report — always generated; uses optional meta for enrichment.
  extensions.hawkeyeReport = runSafely('hawkeyeReportGenerator', () =>
    generateHawkeyeReport({
      brain: partialResponse,
      ...(req.hawkeyeReportMeta ?? {}),
    })
  );

  // #57 AI Governance Checklist — runs when aiGovernanceInput is supplied.
  if (req.aiGovernanceInput) {
    extensions.aiGovernance = runSafely('aiGovernanceChecker', () =>
      checkAiGovernance(req.aiGovernanceInput!)
    );
  }

  // #58 ESG Advanced Framework — CSRD/SASB/ClimateVAR/GreenBond/SLL/CarbonCredit.
  if (req.esgAdvancedInput) {
    extensions.esgAdvanced = runSafely('esgAdvancedFrameworkScorer', () =>
      scoreEsgAdvancedFramework(req.esgAdvancedInput!)
    );
  }

  return {
    mega,
    extensions,
    finalVerdict,
    clampReasons,
    requiresHumanReview,
    confidence: Math.round(confidence * 10000) / 10000,
    auditNarrative,
    subsystemFailures,
    advisorResult,
    managedAgentPlan,
    orchestratorSession,
  };
}

function buildAdvisorReason(
  verdict: Verdict,
  confidence: number,
  clampReasons: readonly string[]
): string {
  const parts: string[] = [];
  if (verdict === 'freeze' || verdict === 'escalate') {
    parts.push(`verdict=${verdict}`);
  }
  if (confidence < 0.7) {
    parts.push(`confidence=${confidence.toFixed(2)}`);
  }
  if (clampReasons.length > 0) {
    parts.push(`${clampReasons.length} clamp(s)`);
  }
  return parts.length > 0 ? parts.join(' + ') : 'routine review';
}

// ---------------------------------------------------------------------------
// Audit narrative builder
// ---------------------------------------------------------------------------

function buildAuditNarrative(
  mega: MegaBrainResponse,
  finalVerdict: Verdict,
  clampReasons: string[],
  extensions: WeaponizedExtensions
): string {
  const lines: string[] = [];

  lines.push(`Entity: ${mega.topic} (id: ${mega.entityId})`);
  lines.push(`MegaBrain verdict: ${mega.verdict}`);
  lines.push(`Final verdict: ${finalVerdict}`);
  lines.push(`MegaBrain confidence: ${(mega.confidence * 100).toFixed(1)}%`);
  lines.push(`Recommended action: ${mega.recommendedAction}`);

  if (clampReasons.length > 0) {
    lines.push('');
    lines.push('Weaponized safety clamps triggered:');
    for (const reason of clampReasons) {
      lines.push(`  - ${reason}`);
    }
  }

  lines.push('');
  lines.push('Subsystem outputs:');

  if (extensions.adverseMedia) {
    lines.push(
      `  - Adverse media: ${extensions.adverseMedia.ranked.length} hits, ` +
        `top category ${extensions.adverseMedia.topCategory}, ` +
        `critical=${extensions.adverseMedia.counts.critical}, ` +
        `material=${extensions.adverseMedia.counts.material}`
    );
  }

  if (extensions.ubo) {
    lines.push(
      `  - UBO: ${extensions.ubo.summary.ubos.length} UBOs, ` +
        `layering depth ${extensions.ubo.layering.maxDepth} ` +
        `(FATF threshold: ${extensions.ubo.layering.exceedsFatfThreshold ? 'exceeded' : 'ok'}), ` +
        `shell score ${extensions.ubo.shellCompany.shellScore.toFixed(2)} ` +
        `(${extensions.ubo.shellCompany.verdict})`
    );
    if (extensions.ubo.summary.hasUndisclosedPortion) {
      lines.push(
        `    undisclosed ownership: ${extensions.ubo.summary.undisclosedPercentage.toFixed(1)}%`
      );
    }
  }

  if (extensions.wallets) {
    lines.push(
      `  - Wallets: ${extensions.wallets.total} total, ` +
        `${extensions.wallets.confirmedHits} confirmed hits, ` +
        `${extensions.wallets.potential} potential, ` +
        `highest score ${extensions.wallets.highestScore}`
    );
  }

  if (extensions.transactionAnomalies) {
    const byKind = extensions.transactionAnomalies.detectorStats;
    lines.push(
      `  - Transaction anomalies: ${extensions.transactionAnomalies.findings.length} findings ` +
        `(structuring=${byKind.structuring}, fan_in=${byKind.fan_in}, ` +
        `fan_out=${byKind.fan_out}, cycling=${byKind.cycling}, ` +
        `velocity=${byKind.velocity}, entropy=${byKind.amount_entropy})`
    );
  }

  if (extensions.explanation) {
    lines.push(
      `  - Explainable score: ${extensions.explanation.score}/100 ` +
        `(${extensions.explanation.rating}, CDD level ${extensions.explanation.cddLevel}), ` +
        `top factor: ${extensions.explanation.topFactors[0]?.name ?? 'none'}`
    );
  }

  if (extensions.proofBundle) {
    lines.push(
      `  - ZK audit seal: Merkle root ${extensions.proofBundle.rootHash.slice(0, 16)}... ` +
        `(${extensions.proofBundle.recordCount} records, sealed ${extensions.proofBundle.sealedAt})`
    );
  }

  // Phase 2 subsystems (#20-#30)
  if (extensions.redTeam?.hasChallenge) {
    lines.push(
      `  - Red team critic: ${extensions.redTeam.reasons.length} challenge(s)` +
        (extensions.redTeam.proposedVerdict
          ? `, proposed counter-verdict ${extensions.redTeam.proposedVerdict}`
          : '')
    );
  }
  if (extensions.precedents) {
    lines.push(
      `  - Precedents: ${extensions.precedents.matches.length} similar past case(s)` +
        (extensions.precedents.dominantOutcome
          ? `, dominant outcome ${extensions.precedents.dominantOutcome}`
          : '')
    );
  }
  if (extensions.contradictions?.hasContradiction) {
    lines.push(
      `  - Contradictions: ${extensions.contradictions.disagreements.length} material ` +
        `disagreement(s), score ${(extensions.contradictions.score * 100).toFixed(0)}%`
    );
  }
  if (extensions.regulatorVoice?.hasGaps) {
    lines.push(
      `  - Regulator voice pass: ${extensions.regulatorVoice.unansweredCount}/` +
        `${extensions.regulatorVoice.questions.length} inspector question(s) unanswered`
    );
  }
  if (typeof extensions.calibratedConfidence === 'number') {
    lines.push(
      `  - Calibrated confidence (Platt): ${(extensions.calibratedConfidence * 100).toFixed(1)}%`
    );
  }
  if (extensions.counterfactuals && extensions.counterfactuals.counterfactuals.length > 0) {
    lines.push(
      `  - Counterfactuals: ${extensions.counterfactuals.counterfactuals.length} single-signal flip(s) possible`
    );
  }
  if (extensions.temporalPatterns) {
    const parts: string[] = [];
    if (extensions.temporalPatterns.hasRepeatPattern) parts.push('repeat');
    if (extensions.temporalPatterns.hasEscalatingPattern) parts.push('escalating');
    if (extensions.temporalPatterns.hasBurstPattern) parts.push('burst');
    lines.push(
      `  - Temporal patterns (${extensions.temporalPatterns.windowDays}d): ` +
        (parts.length > 0 ? parts.join(', ') : 'none') +
        `, strength ${(extensions.temporalPatterns.strength * 100).toFixed(0)}%`
    );
  }
  if (extensions.typologies && extensions.typologies.hits.length > 0) {
    lines.push(
      `  - Typology matches: ${extensions.typologies.hits.length} hit(s)` +
        (extensions.typologies.topHit
          ? `, top ${extensions.typologies.topHit.id} ${extensions.typologies.topHit.name}`
          : '')
    );
  }
  if (extensions.narrativeDrift?.hasDrift) {
    lines.push(
      `  - Narrative drift: boilerplate detected (closest match ` +
        `${extensions.narrativeDrift.closestMatch?.filingId})`
    );
  }
  if (extensions.crossCustomer && extensions.crossCustomer.hits.length > 0) {
    lines.push(
      `  - Cross-customer: ${extensions.crossCustomer.hits.length} shared-signal match(es)`
    );
  }
  if (extensions.teacherExtension) {
    lines.push(
      `  - Teacher extension review: ${extensions.teacherExtension.verdict}` +
        (extensions.teacherExtension.verdict === 'contested'
          ? ` (${extensions.teacherExtension.concerns.length} concern(s))`
          : '')
    );
  }

  // Phase 3 subsystems (#31-#40)
  if (extensions.benford) {
    lines.push(
      `  - Benford's Law (#31): verdict=${extensions.benford.verdict}, ` +
        `chi²=${extensions.benford.chiSquare.toFixed(2)}, ` +
        `MAD=${extensions.benford.meanAbsoluteDeviation.toFixed(4)}, ` +
        `n=${extensions.benford.sampleSize}` +
        (extensions.benford.suspiciousDigits.length > 0
          ? `, suspicious digits: ${extensions.benford.suspiciousDigits.map((d) => d.digit).join(',')}`
          : '')
    );
  }
  if (extensions.adversarialInput) {
    lines.push(
      `  - Adversarial ML (#32): ${extensions.adversarialInput.clean ? 'clean' : 'ADVERSARIAL'}, ` +
        `topSeverity=${extensions.adversarialInput.topSeverity}, ` +
        `findings=${extensions.adversarialInput.findings.length}, ` +
        `homoglyphs=${extensions.adversarialInput.stats.homoglyphCount}, ` +
        `zeroWidth=${extensions.adversarialInput.stats.zeroWidthCount}`
    );
  }
  if (extensions.advisorHallucinations) {
    lines.push(
      `  - Advisor hallucination (#33): ${extensions.advisorHallucinations.clean ? 'clean' : 'HALLUCINATIONS FOUND'}, ` +
        `citations checked=${extensions.advisorHallucinations.totalCitationsFound}, ` +
        `validated=${extensions.advisorHallucinations.totalCitationsValidated}`
    );
  }
  if (extensions.taint) {
    lines.push(
      `  - Taint propagator (#34): ${extensions.taint.tainted.length} tainted wallet(s), ` +
        `maxTaint=${(extensions.taint.maxTaint * 100).toFixed(1)}%`
    );
  }
  if (extensions.selfAudit) {
    lines.push(
      `  - Self-audit score (#35): ${extensions.selfAudit.totalScore}/100 ` +
        `(grade ${extensions.selfAudit.grade}, ` +
        `inspection-ready=${extensions.selfAudit.inspectionReady}), ` +
        `critical gaps=${extensions.selfAudit.criticalGaps.length}`
    );
  }
  if (extensions.verdictDrift) {
    lines.push(
      `  - Verdict drift (#36): drift=${extensions.verdictDrift.hasDrift}, ` +
        `chi²=${extensions.verdictDrift.chiSquare.toFixed(2)} ` +
        `(critical=${extensions.verdictDrift.criticalValue.toFixed(2)})`
    );
  }
  if (extensions.kycConsistency) {
    lines.push(
      `  - KYC consistency (#37): ${extensions.kycConsistency.clean ? 'consistent' : 'INCONSISTENCIES'}, ` +
        `findings=${extensions.kycConsistency.findings.length}, ` +
        `topSeverity=${extensions.kycConsistency.topSeverity}`
    );
  }
  if (extensions.buyBackRisks && extensions.buyBackRisks.length > 0) {
    const worstBuyBack = extensions.buyBackRisks.reduce((prev, curr) =>
      curr.score > prev.score ? curr : prev
    );
    lines.push(
      `  - Buy-back risk (#38): ${extensions.buyBackRisks.length} transaction(s), ` +
        `worst score=${worstBuyBack.score} (${worstBuyBack.level}), ` +
        `critical=${extensions.buyBackRisks.filter((r) => r.level === 'critical').length}`
    );
  }
  if (extensions.priceAnomalies && extensions.priceAnomalies.length > 0) {
    const critPrices = extensions.priceAnomalies.filter((p) => p.severity === 'critical');
    lines.push(
      `  - Price anomaly (#39): ${extensions.priceAnomalies.length} transaction(s), ` +
        `critical=${critPrices.length}` +
        (critPrices[0]
          ? `, worst deviation=${critPrices[0].deviationPct.toFixed(1)}% on ${critPrices[0].transactionId}`
          : '')
    );
  }
  if (extensions.bftConsensus !== undefined && extensions.bftConsensus !== null) {
    lines.push(
      `  - BFT consensus (#40): ` +
        `${extensions.bftConsensus.sufficientConsensus ? 'CONSENSUS' : 'NO CONSENSUS'}, ` +
        `winner=${extensions.bftConsensus.winner ?? 'none'}, ` +
        `votes=${extensions.bftConsensus.votes}/${extensions.bftConsensus.totalVotes} ` +
        `(quorum=${extensions.bftConsensus.quorum})`
    );
  }

  // Phase 4-10 subsystems (#41-#55)
  // EsgScore pillar sub-scores live on pillars.{E,S,G}.score.
  if (extensions.esgScore) {
    lines.push(
      `  - ESG composite (#41): score=${extensions.esgScore.totalScore.toFixed(1)}/100 ` +
        `grade=${extensions.esgScore.grade}, risk=${extensions.esgScore.riskLevel}, ` +
        `E=${extensions.esgScore.pillars.E.score.toFixed(0)} ` +
        `S=${extensions.esgScore.pillars.S.score.toFixed(0)} ` +
        `G=${extensions.esgScore.pillars.G.score.toFixed(0)}`
    );
  }
  if (extensions.carbonFootprint) {
    lines.push(
      `  - Carbon footprint (#42): ${extensions.carbonFootprint.scopeBreakdown.total_tCO2e.toFixed(2)} tCO2e total, ` +
        `intensity=${extensions.carbonFootprint.portfolioIntensityKgPerOz.toFixed(1)} kgCO2e/oz, ` +
        `risk=${extensions.carbonFootprint.carbonRisk}, NZ2050 gap=${extensions.carbonFootprint.netZeroGap_tCO2e.toFixed(2)} tCO2e`
    );
  }
  if (extensions.tcfdAlignment) {
    lines.push(
      `  - TCFD alignment (#43): score=${extensions.tcfdAlignment.overallScore.toFixed(0)}/100, ` +
        `level=${extensions.tcfdAlignment.complianceLevel}, IFRS S2=${extensions.tcfdAlignment.ifrss2Compliant}, ` +
        `NZ2050=${extensions.tcfdAlignment.uaeNZ2050Aligned}`
    );
  }
  if (extensions.sdgAlignment) {
    lines.push(
      `  - UN SDG alignment (#44): score=${extensions.sdgAlignment.overallScore.toFixed(0)}/100, ` +
        `core DPMS goals=${extensions.sdgAlignment.coreGoalsScore.toFixed(0)}/100, ` +
        `OECD 5-step level=${extensions.sdgAlignment.oecd5StepLevel}/5, ` +
        `critical gap SDGs: ${extensions.sdgAlignment.criticalGapSdgs.join(',') || 'none'}`
    );
  }
  // ConflictMineralsReport has no cahraSupplierCount — show highRiskCount.
  if (extensions.conflictMinerals) {
    lines.push(
      `  - Conflict minerals (#45): overall=${extensions.conflictMinerals.overallRisk}, ` +
        `suppliers=${extensions.conflictMinerals.totalSuppliers}, ` +
        `critical=${extensions.conflictMinerals.criticalCount}, ` +
        `highRisk=${extensions.conflictMinerals.highRiskCount}`
    );
  }
  // GreenwashingReport has no scalar counts — derive from findings[].
  if (extensions.greenwashing) {
    const gwFindings = extensions.greenwashing.findings;
    const gwCritical = gwFindings.filter((f) => f.severity === 'critical').length;
    lines.push(
      `  - Greenwashing (#46): risk=${extensions.greenwashing.overallRisk}, ` +
        `findings=${gwFindings.length}, ` +
        `critical=${gwCritical}`
    );
  }
  // EsgAdverseMediaReport field names drifted to topCategory/topEsgRisk —
  // read via bracket access to stay resilient to further renames.
  if (extensions.esgAdverseMedia) {
    const ema = extensions.esgAdverseMedia as unknown as Record<string, unknown>;
    lines.push(
      `  - ESG adverse media (#47): hits=${extensions.esgAdverseMedia.totalHits}, ` +
        `dominant=${(ema.topCategory ?? ema.dominantCategory ?? 'none') as string}, ` +
        `overallRisk=${(ema.topEsgRisk ?? ema.overallEsgRisk ?? 'low') as string}`
    );
  }
  // ModernSlaveryReport — riskLevel + iloIndicatorsTriggered (of 11).
  if (extensions.modernSlavery) {
    lines.push(
      `  - Modern slavery (#48): risk=${extensions.modernSlavery.riskLevel}, ` +
        `ILO indicators=${extensions.modernSlavery.iloIndicatorsTriggered}/11, ` +
        `EDD required=${extensions.modernSlavery.requiresEnhancedDueDiligence}`
    );
  }
  if (extensions.tbml) {
    lines.push(
      `  - TBML (#49): risk=${extensions.tbml.overallRisk}, score=${extensions.tbml.compositeScore}/100, ` +
        `patterns=${extensions.tbml.patterns.length}, STR=${extensions.tbml.requiresStr}, ` +
        `price deviation=${extensions.tbml.priceDeviationPct.toFixed(1)}%`
    );
  }
  if (extensions.fourEyes) {
    lines.push(
      `  - Four-eyes (#50): status=${extensions.fourEyes.status}, ` +
        `meetsRequirements=${extensions.fourEyes.meetsRequirements}, ` +
        `approvals=${extensions.fourEyes.approvalCount}/${extensions.fourEyes.requiredCount}, ` +
        `decisionType=${extensions.fourEyes.decisionType}`
    );
  }
  if (extensions.filingClassification) {
    lines.push(
      `  - STR classifier (#51): category=${extensions.filingClassification.primaryCategory}, ` +
        `urgency=${extensions.filingClassification.urgency}, ` +
        `due=${extensions.filingClassification.deadlineDueDate ?? 'N/A'}, ` +
        `tipOffProhibited=${extensions.filingClassification.tipOffProhibited}`
    );
  }
  if (extensions.pepProximity) {
    lines.push(
      `  - PEP proximity (#52): risk=${extensions.pepProximity.overallRisk}, ` +
        `maxScore=${extensions.pepProximity.maxProximityScore.toFixed(0)}/100, ` +
        `links=${extensions.pepProximity.pepLinks.length}, CDD=${extensions.pepProximity.cddLevel}, ` +
        `boardApproval=${extensions.pepProximity.requiresBoardApproval}`
    );
  }
  if (extensions.hawala) {
    lines.push(
      `  - Hawala (#53): risk=${extensions.hawala.riskLevel}, score=${extensions.hawala.score}/100, ` +
        `indicators=${extensions.hawala.indicators.length}, STR=${extensions.hawala.requiresStr}, ` +
        `CBUAE report=${extensions.hawala.requiresCbuaeReport}`
    );
  }
  if (extensions.anomalyEnsemble) {
    lines.push(
      `  - Anomaly ensemble (#54): level=${extensions.anomalyEnsemble.anomalyLevel}, ` +
        `score=${extensions.anomalyEnsemble.aggregatedScore.toFixed(0)}/100, ` +
        `confidence=${(extensions.anomalyEnsemble.confidence * 100).toFixed(0)}%, ` +
        `dominant=${extensions.anomalyEnsemble.dominantSignal ?? 'none'}, ` +
        `active signals=${extensions.anomalyEnsemble.activeSignals.length}`
    );
  }
  if (extensions.crossBorderCash) {
    lines.push(
      `  - Cross-border cash (#55): risk=${extensions.crossBorderCash.overallRisk}, ` +
        `score=${extensions.crossBorderCash.riskScore}/100, ` +
        `structuring=${extensions.crossBorderCash.structuringDetected}, ` +
        `cumulative AED ${extensions.crossBorderCash.cumulativeAmountAED.toLocaleString()}, ` +
        `STR=${extensions.crossBorderCash.requiresStr}`
    );
  }

  // Synthesis layer
  if (extensions.mlroAlerts) {
    lines.push(
      `  - MLRO alerts: ${extensions.mlroAlerts.criticalCount} CRITICAL, ` +
        `${extensions.mlroAlerts.highCount} HIGH — ` +
        `${extensions.mlroAlerts.alerts.length} total alert(s) generated`
    );
  }
  // OrchestratorResult exposes `verdict`, not `status`.
  if (extensions.asanaSync) {
    lines.push(
      `  - Asana sync: verdict=${extensions.asanaSync.verdict} — ` +
        `parent=${extensions.asanaSync.parentTaskGid ?? 'queued'}, ` +
        `${extensions.asanaSync.subtasksCreated} subtask(s), ` +
        `${extensions.asanaSync.tasksQueued} queued`
    );
  }
  if (extensions.kpiDashboard) {
    lines.push(
      `  - KPI dashboard: score=${extensions.kpiDashboard.overallScore}/100, ` +
        `green=${extensions.kpiDashboard.greenCount}, ` +
        `amber=${extensions.kpiDashboard.amberCount}, ` +
        `red=${extensions.kpiDashboard.redCount}, ` +
        `regulatory risk=${extensions.kpiDashboard.regulatoryRisk}`
    );
  }
  if (extensions.hawkeyeReport) {
    lines.push(
      `  - Hawkeye Sterling V2 (#56): reportId=${extensions.hawkeyeReport.reportId}, ` +
        `badge=${extensions.hawkeyeReport.riskBadge}, ` +
        `lists=6/6 screened, ` +
        `matches=${extensions.hawkeyeReport.totalMatches} ` +
        `(confirmed=${extensions.hawkeyeReport.confirmedMatches}, unresolved=${extensions.hawkeyeReport.unresolvedMatches})`
    );
  }
  if (extensions.aiGovernance) {
    lines.push(
      `  - AI governance (#57): score=${extensions.aiGovernance.overallScore}/100, ` +
        `readiness=${extensions.aiGovernance.readiness}, ` +
        `deploymentApproved=${extensions.aiGovernance.deploymentApproved}, ` +
        `criticalFailures=${extensions.aiGovernance.criticalFailures.length}, ` +
        `regulatoryRisk=${extensions.aiGovernance.regulatoryRisk}`
    );
  }
  if (extensions.esgAdvanced) {
    lines.push(
      `  - ESG advanced framework (#58): score=${extensions.esgAdvanced.overallAdvancedEsgScore}/100, ` +
        `risk=${extensions.esgAdvanced.overallRisk}, ` +
        `CSRD=${extensions.esgAdvanced.csrd.status}, ` +
        `climateVAR=${extensions.esgAdvanced.climateVar.combinedVarPct.toFixed(1)}%, ` +
        `strandedAssets=${extensions.esgAdvanced.strandedAssets.strandingRiskScore}/100, ` +
        `greenBond=${extensions.esgAdvanced.greenBond.status}, ` +
        `carbonCredit=${extensions.esgAdvanced.carbonCredit.qualityScore}/100`
    );
  }
  // Phase 11 narrative entries — every detector below exposes its real
  // field names rather than the pre-refactor `…Detected` boolean flags.
  if (extensions.nameVariants) {
    const nv = extensions.nameVariants as unknown as Record<string, unknown>;
    const originalName = (nv.query ?? nv.original ?? nv.name ?? 'unknown') as string;
    lines.push(
      `  - Name variants (#71): ${extensions.nameVariants.variants.length} variant(s) expanded ` +
        `from "${originalName}" for enhanced sanctions coverage`
    );
  }
  if (extensions.promptInjection && !extensions.promptInjection.clean) {
    lines.push(
      `  - Prompt injection (#59): DETECTED — ` +
        `${extensions.promptInjection.findings.length} finding(s), ` +
        `severity=${extensions.promptInjection.topSeverity ?? 'unknown'}`
    );
  }
  if (extensions.deepfakeDoc) {
    const dfDetected = extensions.deepfakeDoc.verdict === 'likely_deepfake';
    lines.push(
      `  - Deepfake doc (#60): detected=${dfDetected}, ` +
        `score=${extensions.deepfakeDoc.score.toFixed(0)}/100, ` +
        `verdict=${extensions.deepfakeDoc.verdict}`
    );
  }
  if (extensions.sanctionsDedupe) {
    const dd = extensions.sanctionsDedupe as unknown as Record<string, unknown>;
    const inputCount = (dd.inputHits ?? dd.inputCount ?? 0) as number;
    const deduped = (dd.deduped ?? dd.deduplicatedCount ?? 0) as number;
    const removed = (dd.removedDuplicates ?? dd.duplicatesRemoved ?? 0) as number;
    lines.push(
      `  - Sanctions dedupe (#61): ${inputCount} raw hits → ` +
        `${deduped} unique (removed ${removed} duplicates)`
    );
  }
  if (extensions.strNarrative) {
    const ready = extensions.strNarrative.warnings.length === 0;
    lines.push(
      `  - STR narrative (#62): ready=${ready}, ` +
        `length=${extensions.strNarrative.characterCount} chars, ` +
        `filingType=${extensions.strNarrative.filingType}`
    );
  }
  if (extensions.strPrediction) {
    lines.push(
      `  - Predictive STR (#63): probability=${(extensions.strPrediction.probability * 100).toFixed(1)}%, ` +
        `band=${extensions.strPrediction.band}, ` +
        `topFactor=${extensions.strPrediction.factors?.[0]?.feature ?? 'none'}`
    );
  }
  if (extensions.penaltyVar) {
    lines.push(
      `  - Penalty VaR (#64): expected AED ${extensions.penaltyVar.expectedLoss.toLocaleString()}, ` +
        `VaR-${(extensions.penaltyVar.confidence * 100).toFixed(0)} AED ${extensions.penaltyVar.valueAtRisk.toLocaleString()}, ` +
        `violations=${extensions.penaltyVar.byViolation.length}`
    );
  }
  if (extensions.goldOrigin) {
    const goRisk =
      extensions.goldOrigin.refuseCount > 0
        ? 'REFUSE'
        : extensions.goldOrigin.eddCount > 0
          ? 'EDD'
          : 'CLEAN';
    lines.push(
      `  - Gold origin (#65): ${extensions.goldOrigin.results.length} shipment(s), ` +
        `refuse=${extensions.goldOrigin.refuseCount}, ` +
        `riskLevel=${goRisk}`
    );
  }
  if (extensions.assayMatch) {
    const total = extensions.assayMatch.results.length;
    const passed = extensions.assayMatch.results.filter((r) => r.ok).length;
    const failed = total - passed;
    lines.push(
      `  - Assay certificates (#66): ${total} cert(s), ` + `passed=${passed}, ` + `failed=${failed}`
    );
  }
  if (extensions.finenessAnomaly) {
    const fineAnomaly = extensions.finenessAnomaly.mismatches > 0;
    lines.push(
      `  - Fineness anomaly (#67): detected=${fineAnomaly}, ` +
        `findings=${extensions.finenessAnomaly.findings.length}`
    );
  }
  if (extensions.arbitrage) {
    const arbDetected = extensions.arbitrage.hits.length > 0;
    const maxSpread = extensions.arbitrage.hits.reduce((max, h) => {
      const rec = h as unknown as Record<string, number | undefined>;
      return Math.max(max, rec.spreadPct ?? 0);
    }, 0);
    lines.push(
      `  - Cross-border arbitrage (#68): detected=${arbDetected}, ` +
        `hits=${extensions.arbitrage.hits.length}, ` +
        `maxSpreadPct=${maxSpread > 0 ? maxSpread.toFixed(1) : 'N/A'}%`
    );
  }
  if (extensions.dormancy) {
    const maxGap = extensions.dormancy.hits.reduce((max, h) => {
      const rec = h as unknown as Record<string, number | undefined>;
      return Math.max(max, rec.gapDays ?? 0);
    }, 0);
    lines.push(
      `  - Dormancy activity (#70): hits=${extensions.dormancy.hits.length}, ` +
        `maxGapDays=${maxGap}`
    );
  }
  if (extensions.strNarrativeGrade) {
    lines.push(
      `  - STR narrative grade (#72): score=${extensions.strNarrativeGrade.totalScore}/100, ` +
        `verdict=${extensions.strNarrativeGrade.verdict}, ` +
        `readyToFile=${extensions.strNarrativeGrade.verdict === 'filing_ready'}`
    );
  }

  // Phase 12 narrative entries
  if (extensions.corporateGraph) {
    const flaggedCount = extensions.corporateGraph.hits.length;
    lines.push(
      `  - Corporate graph (#73): visited=${extensions.corporateGraph.visited} node(s) ` +
        `in ${extensions.corporateGraph.hops} hop(s), flagged=${flaggedCount}`
    );
  }
  if (extensions.ownershipMotifs) {
    lines.push(
      `  - Ownership motifs (#74): ${extensions.ownershipMotifs.findings.length} motif(s) detected ` +
        `(circular/star/cascade layering)`
    );
  }
  if (extensions.multiModelConsensus) {
    lines.push(
      `  - Multi-model screening (#75): consensus=${extensions.multiModelConsensus.consensus}, ` +
        `riskLevel=${extensions.multiModelConsensus.riskLevel}, ` +
        `score=${extensions.multiModelConsensus.riskScore}/100, ` +
        `models=${extensions.multiModelConsensus.modelsResponded}/${extensions.multiModelConsensus.modelsQueried} responded`
    );
  }
  if (extensions.causalCounterfactual) {
    lines.push(
      `  - Causal engine (#76): counterfactual changed ${extensions.causalCounterfactual.changedNodes.length} node(s): ` +
        `[${extensions.causalCounterfactual.changedNodes.join(', ')}]`
    );
  }
  if (extensions.verdictDebate) {
    lines.push(
      `  - Verdict debate (#77): winner=${extensions.verdictDebate.winner} ` +
        `(${extensions.verdictDebate.winningAction}), ` +
        `margin=${extensions.verdictDebate.margin.toFixed(2)}, ` +
        `proScore=${extensions.verdictDebate.proScore.toFixed(0)} vs conScore=${extensions.verdictDebate.conScore.toFixed(0)}`
    );
  }
  if (extensions.reflectionReport) {
    const errorCount = extensions.reflectionReport.issues.filter(
      (i) => i.severity === 'error'
    ).length;
    lines.push(
      `  - Reflection critic (#78): ${extensions.reflectionReport.issues.length} issue(s) ` +
        `(${errorCount} error(s)), chain confidence=${(extensions.reflectionReport.confidence * 100).toFixed(0)}%`
    );
  }
  if (extensions.circularReasoning) {
    lines.push(
      `  - Circular reasoning (#79): ${extensions.circularReasoning.cycles.length} cycle(s) detected`
    );
  }
  if (extensions.gameEquilibrium) {
    lines.push(
      `  - Game theory (#80): expectedPayoff=${extensions.gameEquilibrium.expectedPayoff.toFixed(3)}, ` +
        `topAttackerChoice="${extensions.gameEquilibrium.topAttackerChoice}", ` +
        `topDefenderChoice="${extensions.gameEquilibrium.topDefenderChoice}"`
    );
  }
  if (extensions.lbmaFixCheck) {
    lines.push(
      `  - LBMA fix check (#81): ${extensions.lbmaFixCheck.checked} trade(s) checked, ` +
        `flagged=${extensions.lbmaFixCheck.flagged}, frozen=${extensions.lbmaFixCheck.frozen}`
    );
  }
  if (extensions.meltLoss) {
    lines.push(
      `  - Melt loss (#82): severity=${extensions.meltLoss.severity}, ` +
        `actual=${extensions.meltLoss.lossPct.toFixed(2)}%, ` +
        `expected ${extensions.meltLoss.expectedMinPct.toFixed(2)}%–${extensions.meltLoss.expectedMaxPct.toFixed(2)}%`
    );
  }
  if (extensions.freeZoneCompliance) {
    lines.push(
      `  - Free zone compliance (#83): zone=${extensions.freeZoneCompliance.freeZone}, ` +
        `passed=${extensions.freeZoneCompliance.passed}/${extensions.freeZoneCompliance.totalRules}, ` +
        `mandatory failures=${extensions.freeZoneCompliance.mandatoryFailures.length}`
    );
  }
  if (extensions.tippingOff) {
    lines.push(
      `  - Tipping-off linter (#84): clean=${extensions.tippingOff.clean}, ` +
        `findings=${extensions.tippingOff.findings.length} ` +
        `(FDL Art.29 — ${!extensions.tippingOff.clean ? 'REDACTED' : 'clean'})`
    );
  }
  if (extensions.shapley) {
    const topAttr = extensions.shapley.attributions[0];
    lines.push(
      `  - Shapley explainer (#85): top signal="${topAttr?.signal ?? 'none'}" ` +
        `φ=${topAttr?.value?.toFixed(3) ?? 'N/A'}, ` +
        `total signals=${extensions.shapley.attributions.length}`
    );
  }
  if (extensions.invariantVerification) {
    lines.push(
      `  - Invariant verifier (#86): violations=${extensions.invariantVerification.violations.length} ` +
        `(invariantsChecked=${extensions.invariantVerification.invariantsChecked}, passed=${extensions.invariantVerification.passed})`
    );
  }
  if (extensions.syntheticEvasion) {
    lines.push(
      `  - Synthetic evasion (#87): ${extensions.syntheticEvasion.length} test case(s) generated`
    );
  }
  if (extensions.quantumSeal) {
    lines.push(
      `  - Quantum-resistant seal (#88): leafCount=${extensions.quantumSeal.leafCount} record(s), ` +
        `algo=${extensions.quantumSeal.hashFunction}, ` +
        `root=${extensions.quantumSeal.rootHash.slice(0, 16)}...`
    );
  }
  if (extensions.peerAnomaly) {
    const maxZ =
      extensions.peerAnomaly.anomalies.length > 0
        ? Math.max(...extensions.peerAnomaly.anomalies.map((a) => Math.abs(a.zScore))).toFixed(2)
        : 'N/A';
    lines.push(
      `  - Peer anomaly (#89): ${extensions.peerAnomaly.anomalies.length} anomalous feature(s), ` +
        `maxZ=${maxZ}, score=${extensions.peerAnomaly.overallScore.toFixed(1)}`
    );
  }
  if (extensions.timeTravelAudit) {
    // CaseSnapshot carries the as-of date on `asOf`, not `timestamp`.
    lines.push(
      `  - Time-travel audit (#90): criticalPath=${extensions.timeTravelAudit.criticalPath.length} evidence step(s), ` +
        `currentState snapshot at ${extensions.timeTravelAudit.currentState.asOf}`
    );
  }
  if (extensions.documentTamper) {
    // DocumentExtractionResult exposes overallConfidence (0–1).
    const highTamper = extensions.documentTamper.tamperSignals.filter(
      (s) => s.severity === 'high'
    ).length;
    lines.push(
      `  - Document intelligence (#91): tamperSignals=${extensions.documentTamper.tamperSignals.length} ` +
        `(${highTamper} high-severity), confidence=${(extensions.documentTamper.overallConfidence * 100).toFixed(0)}%`
    );
  }
  if (extensions.regulatoryDrift) {
    lines.push(
      `  - Regulatory drift (#92): overallBand=${extensions.regulatoryDrift.overallBand}, ` +
        `driftedFeatures=${extensions.regulatoryDrift.driftedFeatureCount}, ` +
        `maxPSI=${extensions.regulatoryDrift.overallMaxPsi?.toFixed(3) ?? 'N/A'}`
    );
  }
  if (extensions.goamlXml) {
    lines.push(
      `  - goAML XML (#93): auto-generated UAE FIU XML filing ` +
        `(${extensions.goamlXml.length.toLocaleString()} chars) — ready for submission`
    );
  }
  if (extensions.bayesianBelief) {
    lines.push(
      `  - Bayesian belief (#94): P(${extensions.bayesianBelief.mostLikely.label})=` +
        `${(extensions.bayesianBelief.mostLikely.probability * 100).toFixed(0)}%, ` +
        `entropy=${extensions.bayesianBelief.entropyBits.toFixed(2)} bits`
    );
  }
  if (extensions.cbrRecommendation && extensions.cbrRecommendation.length > 0) {
    // ReuseRecommendation (src/services/caseBasedReasoning.ts) — there
    // is no scalar `similarity`; per-case similarity lives inside
    // supportingCases[0]. Fall back to the overall confidence.
    const topRec = extensions.cbrRecommendation[0];
    const topSimilarity = topRec?.supportingCases?.[0]?.similarity ?? topRec?.confidence;
    lines.push(
      `  - Case-based reasoning (#95): top precedent similarity=${topSimilarity?.toFixed(3) ?? 'N/A'}, ` +
        `recommendation=${topRec?.recommendedOutcome ?? 'none'}`
    );
  }
  if (extensions.euAiActReadiness) {
    lines.push(
      `  - EU AI Act readiness (#96): dispatched=${extensions.euAiActReadiness.dispatched} task(s), ` +
        `failed=${extensions.euAiActReadiness.failed}`
    );
  }
  if (extensions.inducedRules && extensions.inducedRules.length > 0) {
    lines.push(
      `  - Rule induction (#97): ${extensions.inducedRules.length} human-readable rule(s) extracted`
    );
  }
  if (extensions.deepResearch) {
    const dr = extensions.deepResearch;
    lines.push(
      `  - Deep research (#98): ${dr.claims.length} claim(s), verdictHint=${dr.verdictHint}, ` +
        `confidence=${dr.confidence}, queries=${dr.queriesUsed.length}` +
        (dr.piiRedactionApplied ? ', PII-redacted' : '') +
        (dr.truncated ? ` (truncated: ${dr.terminationReason})` : '')
    );
  }

  // Phase 15 narrative entries (#110-#114) — adaptive meta & self-learning.
  if (extensions.adaptiveMeta) {
    const am = extensions.adaptiveMeta;
    lines.push(
      `  - Adaptive meta (#110): dominant=${am.dominantSignal?.name ?? 'none'}, ` +
        `topK=${am.topFocus.length}, deprioritised=${am.deprioritised.length}, ` +
        `entropy=${am.attentionEntropyBits.toFixed(2)} bits`
    );
  }
  if (extensions.reasoningChainComposed) {
    const rc = extensions.reasoningChainComposed;
    lines.push(
      `  - Reasoning chain (#111): ${rc.steps.length} step(s), converges=${rc.convergedVerdict}, ` +
        `coherent=${rc.coherent}, chainConfidence=${rc.chainConfidence.toFixed(3)}`
    );
  }
  if (extensions.thresholdCalibration) {
    const tc = extensions.thresholdCalibration;
    lines.push(
      `  - Threshold calibration (#112): ${tc.recommendations.length} recommendation(s) ` +
        `(diagnostic only — requires MLRO sign-off)`
    );
  }
  if (extensions.patternMining) {
    const pm = extensions.patternMining;
    lines.push(
      `  - Pattern mining (#113): ${pm.clusters.length} cluster(s), ` +
        `${pm.unclustered.length} unclustered case(s)`
    );
  }
  if (extensions.hypotheses) {
    const h = extensions.hypotheses;
    lines.push(
      `  - Hypotheses (#114): mostLikely=${h.mostLikely?.id ?? 'none'}` +
        (h.mostLikely
          ? ` (P=${(h.mostLikely.posterior * 100).toFixed(0)}%)`
          : '')
    );
  }

  return lines.join('\n');
}
