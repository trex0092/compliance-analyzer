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
import {
  detectTbml,
  type TbmlTransaction,
  type TbmlAssessment,
} from './tradeBasedMLDetector';
import {
  enforceFourEyes,
  type ApprovalSubmission,
  type FourEyesResult,
} from './fourEyesEnforcer';
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
import {
  detectHawala,
  type HawalaTransaction,
  type HawalaDetectionResult,
} from './hawalaDetector';
import {
  runAnomalyEnsemble,
  buildSignal,
  type EnsembleResult,
} from './anomalyEnsemble';
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
import {
  generateMlroAlerts,
  type MlroAlertBundle,
} from './mlroAlertGenerator';
import {
  buildKpiReport,
  type KpiReport,
} from './complianceMetricsDashboard';

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
            req.buyBackTransactions!.map((tx) =>
              assessBuyBackRisk(tx, req.buyBackTransactions!)
            )
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
            value:
              extensions.teacherExtension.verdict === 'contested' ? 'escalate' : finalVerdict,
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
      (node) =>
        req.taintGraph!.entityWallets.includes(node.wallet) && node.taint >= taintThreshold
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
      ? Promise.resolve(runSafely('carbonFootprintEstimator', () => estimateCarbonFootprint(req.carbonInput!)))
      : Promise.resolve(undefined),

    // #43 TCFD alignment
    req.tcfdInput
      ? Promise.resolve(runSafely('tcfdAlignmentChecker', () => checkTcfdAlignment(req.tcfdInput!)))
      : Promise.resolve(undefined),

    // #44 UN SDG alignment
    req.sdgEvidence
      ? Promise.resolve(runSafely('unSdgAlignmentScorer', () =>
          scoreUnSdgAlignment(req.sdgEvidence!.entityId, req.sdgEvidence!.reportingYear, req.sdgEvidence!.evidence)
        ))
      : Promise.resolve(undefined),

    // #45 Conflict minerals
    req.conflictMineralSuppliers && req.conflictMineralSuppliers.length > 0
      ? Promise.resolve(runSafely('conflictMineralsScreener', () => screenConflictMinerals(req.conflictMineralSuppliers!)))
      : Promise.resolve(undefined),

    // #46 Greenwashing
    req.esgDisclosure
      ? Promise.resolve(runSafely('greenwashingDetector', () => detectGreenwashing(req.esgDisclosure!)))
      : Promise.resolve(undefined),

    // #47 ESG adverse media
    req.esgAdverseMediaHits && req.esgAdverseMediaHits.length > 0
      ? Promise.resolve(runSafely('esgAdverseMediaClassifier', () => classifyEsgAdverseMedia(req.esgAdverseMediaHits!)))
      : Promise.resolve(undefined),

    // #48 Modern slavery
    req.workforceProfile
      ? Promise.resolve(runSafely('modernSlaveryDetector', () => assessModernSlaveryRisk(req.workforceProfile!)))
      : Promise.resolve(undefined),

    // #49 TBML
    req.tbmlTransaction
      ? Promise.resolve(runSafely('tradeBasedMLDetector', () => detectTbml(req.tbmlTransaction!)))
      : Promise.resolve(undefined),

    // #50 Four-eyes enforcer
    req.fourEyesSubmission
      ? Promise.resolve(runSafely('fourEyesEnforcer', () => enforceFourEyes(req.fourEyesSubmission!)))
      : Promise.resolve(undefined),

    // #51 STR/SAR/CTR auto-classifier
    req.filingClassificationInput
      ? Promise.resolve(runSafely('strAutoClassifier', () => classifyFiling(req.filingClassificationInput!)))
      : Promise.resolve(undefined),

    // #52 PEP proximity scorer
    req.pepProximityInput
      ? Promise.resolve(runSafely('pepProximityScorer', () => scorePepProximity(req.pepProximityInput!)))
      : Promise.resolve(undefined),

    // #53 Hawala detector
    req.hawalaTransaction
      ? Promise.resolve(runSafely('hawalaDetector', () => detectHawala(req.hawalaTransaction!)))
      : Promise.resolve(undefined),

    // #54 Cross-border cash monitor
    req.crossBorderMovement
      ? Promise.resolve(runSafely('crossBorderCashMonitor', () => monitorCrossBorderCash(req.crossBorderMovement!)))
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
  extensions.anomalyEnsemble = runSafely('anomalyEnsemble', () => {
    const signals = [
      extensions.benford && buildSignal('benford',
        extensions.benford.verdict === 'non-conformity' ? 80 : 20,
        0.85, extensions.benford.verdict === 'non-conformity'),
      extensions.priceAnomalies && buildSignal('price_anomaly',
        extensions.priceAnomalies.filter(p => p.severity === 'critical').length > 0 ? 85 : 30,
        0.9, extensions.priceAnomalies.some(p => p.severity === 'critical')),
      extensions.tbml && buildSignal('tbml',
        extensions.tbml.compositeScore,
        0.88, extensions.tbml.overallRisk === 'high' || extensions.tbml.overallRisk === 'critical'),
      extensions.hawala && buildSignal('hawala',
        extensions.hawala.score,
        0.82, extensions.hawala.riskLevel === 'high' || extensions.hawala.riskLevel === 'critical'),
      extensions.buyBackRisks && buildSignal('buy_back',
        extensions.buyBackRisks.reduce((m, r) => Math.max(m, r.score), 0),
        0.85, extensions.buyBackRisks.some(r => r.level === 'critical')),
      extensions.adversarialInput && buildSignal('adversarial_ml',
        extensions.adversarialInput.topSeverity === 'critical' ? 90 : 20,
        0.9, !extensions.adversarialInput.clean),
      extensions.verdictDrift && buildSignal('verdict_drift',
        extensions.verdictDrift.hasDrift ? 70 : 10,
        0.75, extensions.verdictDrift.hasDrift),
    ].filter((s): s is NonNullable<typeof s> => s !== undefined && s !== null);

    if (signals.length === 0) return undefined;
    return runAnomalyEnsemble(req.mega.entity.id, signals);
  }) ?? undefined;

  // ---------------------------------------------------------------------------
  // Phase 4-10 safety clamps — monotone escalation only.
  // ---------------------------------------------------------------------------

  // #41 ESG critical risk → escalate (LBMA RGG v9 §6 / ISSB S1 materiality).
  if (extensions.esgScore?.riskLevel === 'critical') {
    finalVerdict = escalateTo(finalVerdict, 'escalate');
    clampReasons.push(
      `CLAMP: ESG composite score ${extensions.esgScore.composite.toFixed(0)}/100 (${extensions.esgScore.grade}) ` +
      `— critical ESG risk level; escalate per LBMA RGG v9 §6 / ISSB IFRS S1`
    );
  }

  // #45 Conflict minerals critical supplier → escalate (OECD DDG / Dodd-Frank §1502).
  if (extensions.conflictMinerals?.overallRisk === 'critical') {
    finalVerdict = escalateTo(finalVerdict, 'escalate');
    clampReasons.push(
      `CLAMP: conflict minerals critical risk — ${extensions.conflictMinerals.criticalSupplierCount} critical supplier(s) ` +
      `in CAHRA zones (OECD DDG 2016 Step 3 / Dodd-Frank §1502 / EU CMR 2017/821)`
    );
  }

  // #46 Greenwashing critical → escalate (ISSB S1 / EU SFDR — material misrepresentation).
  if (extensions.greenwashing?.overallRisk === 'critical') {
    finalVerdict = escalateTo(finalVerdict, 'escalate');
    clampReasons.push(
      `CLAMP: critical greenwashing detected — ${extensions.greenwashing.criticalFindings} critical finding(s); ` +
      `material ESG misrepresentation (ISSB IFRS S1 / EU SFDR Art.4)`
    );
  }

  // #48 Modern slavery critical → escalate (UAE Federal Law 51/2006 / ILO Conv. 29/105).
  if (extensions.modernSlavery?.overallRisk === 'critical') {
    finalVerdict = escalateTo(finalVerdict, 'escalate');
    clampReasons.push(
      `CLAMP: modern slavery critical risk — ${extensions.modernSlavery.indicatorsTriggered} ILO indicator(s) ` +
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
  if (extensions.fourEyes && !extensions.fourEyes.meetsRequirements &&
      extensions.fourEyes.decisionType === 'sanctions_freeze') {
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
  let confidence = mega.confidence;
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
  if (extensions.bftConsensus !== undefined && extensions.bftConsensus !== null &&
      !extensions.bftConsensus.sufficientConsensus) {
    confidence = Math.min(confidence, 0.65);
  }

  // Phase 4-10 confidence adjustments.
  if (extensions.tbml?.overallRisk === 'critical') confidence = Math.min(confidence, 0.55);
  if (extensions.hawala?.riskLevel === 'critical') confidence = Math.min(confidence, 0.55);
  if (extensions.crossBorderCash?.structuringDetected) confidence = Math.min(confidence, 0.5);
  if (extensions.modernSlavery?.overallRisk === 'critical') confidence = Math.min(confidence, 0.6);
  if (extensions.pepProximity?.overallRisk === 'critical') confidence = Math.min(confidence, 0.6);
  if (extensions.esgScore?.riskLevel === 'critical') confidence = Math.min(confidence, 0.65);
  if (extensions.conflictMinerals?.overallRisk === 'critical') confidence = Math.min(confidence, 0.6);

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
      const critHallucinations = extensions.advisorHallucinations.findings.filter(
        (f) => f.severity === 'critical'
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
    const worstBuyBack = extensions.buyBackRisks.reduce(
      (prev, curr) => (curr.score > prev.score ? curr : prev)
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
  if (extensions.esgScore) {
    lines.push(
      `  - ESG composite (#41): score=${extensions.esgScore.composite.toFixed(1)}/100 ` +
      `grade=${extensions.esgScore.grade}, risk=${extensions.esgScore.riskLevel}, ` +
      `E=${extensions.esgScore.environmental.score.toFixed(0)} ` +
      `S=${extensions.esgScore.social.score.toFixed(0)} ` +
      `G=${extensions.esgScore.governance.score.toFixed(0)}`
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
  if (extensions.conflictMinerals) {
    lines.push(
      `  - Conflict minerals (#45): overall=${extensions.conflictMinerals.overallRisk}, ` +
      `suppliers=${extensions.conflictMinerals.totalSuppliers}, ` +
      `critical=${extensions.conflictMinerals.criticalSupplierCount}, ` +
      `CAHRA=${extensions.conflictMinerals.cahraSupplierCount}`
    );
  }
  if (extensions.greenwashing) {
    lines.push(
      `  - Greenwashing (#46): risk=${extensions.greenwashing.overallRisk}, ` +
      `findings=${extensions.greenwashing.totalFindings}, ` +
      `critical=${extensions.greenwashing.criticalFindings}`
    );
  }
  if (extensions.esgAdverseMedia) {
    lines.push(
      `  - ESG adverse media (#47): hits=${extensions.esgAdverseMedia.totalHits}, ` +
      `dominant=${extensions.esgAdverseMedia.dominantCategory ?? 'none'}, ` +
      `overallRisk=${extensions.esgAdverseMedia.overallEsgRisk}`
    );
  }
  if (extensions.modernSlavery) {
    lines.push(
      `  - Modern slavery (#48): risk=${extensions.modernSlavery.overallRisk}, ` +
      `ILO indicators=${extensions.modernSlavery.indicatorsTriggered}/${extensions.modernSlavery.totalIndicatorsChecked}, ` +
      `score=${extensions.modernSlavery.riskScore}/100`
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
  if (extensions.asanaSync) {
    lines.push(
      `  - Asana sync: ${extensions.asanaSync.status} — ` +
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

  return lines.join('\n');
}
