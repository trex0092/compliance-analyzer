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
import {
  summariseUboRisk,
  type UboGraph,
  type UboRiskSummary,
} from './uboGraph';
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
import {
  runAllDetectors,
  type Transaction,
  type DetectorSuiteResult,
} from './transactionAnomaly';
import {
  explainableScore,
  type ScoringInput,
  type Explanation,
} from './explainableScoring';
import {
  sealComplianceBundle,
  type ComplianceProofBundle,
  type ComplianceRecord,
} from './zkComplianceProof';
import { DEFAULT_CLAMP_POLICY, type ClampPolicy } from './clampPolicy';
import { redTeamCritique, type RedTeamChallenge } from './redTeamCritic';
import {
  queryPrecedents,
  type PrecedentRecord,
  type PrecedentReport,
} from './precedentRetriever';
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
import {
  calibrateConfidence,
  type CalibrationParams,
} from './confidenceCalibrator';
import {
  computeCounterfactuals,
  type CounterfactualReport,
} from './counterfactualFlipper';
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
import {
  detectNarrativeDrift,
  type PriorFiling,
  type DriftReport,
} from './narrativeDriftDetector';
import {
  correlateAcrossCustomers,
  type CustomerSnapshot,
  type CorrelationReport,
} from './crossCustomerCorrelator';
import {
  reviewExtensions,
  type TeacherExtensionReport,
} from './teacherExtensionReviewer';

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
  const runSafely = <T,>(name: string, fn: () => T): T | undefined => {
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
    const report = runSafely('adverseMediaRanker', () =>
      rankAdverseMedia(req.adverseMedia!)
    );
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
    structuringSeverity: extensions.transactionAnomalies?.findings
      .find((f) => f.kind === 'structuring')
      ?.severity as 'low' | 'medium' | 'high' | undefined,
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
      extensions.explanation.cddLevel === 'EDD' ? 1 : extensions.explanation.cddLevel === 'CDD' ? 0.5 : 0,
      extensions.adverseMedia ? extensions.adverseMedia.ranked.length / 10 : 0,
      extensions.ubo?.summary.undisclosedPercentage ? extensions.ubo.summary.undisclosedPercentage / 100 : 0,
      extensions.wallets?.confirmedHits ? 1 : 0,
      extensions.transactionAnomalies?.findings.length ? extensions.transactionAnomalies.findings.length / 10 : 0,
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
        clampReasons.push(
          `CLAMP: typology ${top.id} ${top.name} forces freeze (${top.citation})`
        );
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

  // 9. Augmented human-review flag.
  const requiresHumanReview =
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
      finalVerdict === 'escalate' ||
      finalVerdict === 'freeze' ||
      clampReasons.length > 0;
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

  return lines.join('\n');
}
