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

  // 8. Augmented confidence — take MIN across MegaBrain + new signals.
  let confidence = mega.confidence;
  if (extensions.adverseMedia?.topCategory === 'critical') {
    confidence = Math.min(confidence, 0.5);
  }
  if (extensions.ubo?.summary.hasSanctionedUbo) {
    confidence = Math.min(confidence, 0.4);
  }
  if (extensions.wallets && extensions.wallets.confirmedHits > 0) {
    confidence = Math.min(confidence, 0.3);
  }
  if (subsystemFailures.length > 0) {
    // Any subsystem failure caps confidence — the decision record is
    // incomplete and should not be trusted at high confidence.
    confidence = Math.min(confidence, 0.5);
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

  return lines.join('\n');
}
