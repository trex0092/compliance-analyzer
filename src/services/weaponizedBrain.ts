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
  let finalVerdict: Verdict = mega.verdict;

  // 2. Subsystem 14: Adverse media ranking
  if (req.adverseMedia && req.adverseMedia.length > 0) {
    const report = rankAdverseMedia(req.adverseMedia);
    extensions.adverseMedia = report;

    // Clamp: one or more critical-impact hits force escalate.
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

  // 3. Subsystem 15: UBO risk + layering + shell-company analysis
  if (req.ubo) {
    const summary = summariseUboRisk(req.ubo.graph, req.ubo.targetId);
    const layering = analyseLayering(req.ubo.graph, req.ubo.targetId);
    const shellCompany = analyseShellCompany(req.ubo.graph, req.ubo.targetId);
    extensions.ubo = { summary, layering, shellCompany };

    // Clamp: sanctioned beneficial owner → forced freeze. Cannot downgrade.
    if (summary.hasSanctionedUbo) {
      finalVerdict = 'freeze';
      clampReasons.push(
        'CLAMP: sanctioned beneficial owner detected — verdict forced to freeze ' +
          '(Cabinet Res 74/2020 Art.4-7 + Cabinet Decision 109/2023)'
      );
    } else if (summary.hasUndisclosedPortion && summary.undisclosedPercentage > 25) {
      // Clamp: > 25% undisclosed ownership → escalate (Art.6 Cabinet 109).
      const next = escalateTo(finalVerdict, 'escalate');
      if (next !== finalVerdict) {
        finalVerdict = next;
        clampReasons.push(
          `CLAMP: ${summary.undisclosedPercentage.toFixed(1)}% undisclosed ownership — ` +
            `escalated (Cabinet Decision 109/2023)`
        );
      }
    }
  }

  // 4. Subsystem 16: VASP wallet portfolio risk
  if (req.wallets && req.wallets.addresses.length > 0) {
    const walletRisk = summarisePortfolioWallets(req.wallets.db, req.wallets.addresses);
    extensions.wallets = walletRisk;

    // Clamp: confirmed_hit on any wallet → forced freeze.
    if (walletRisk.confirmedHits > 0) {
      finalVerdict = 'freeze';
      clampReasons.push(
        `CLAMP: ${walletRisk.confirmedHits} confirmed sanctioned/illicit wallet(s) — ` +
          `verdict forced to freeze (Cabinet Res 74/2020 + FATF Rec 15 VASP)`
      );
    }
  }

  // 5. Subsystem 17: Transaction anomaly detectors
  if (req.transactions && req.transactions.length > 0) {
    const detectorResult = runAllDetectors(req.transactions);
    extensions.transactionAnomalies = detectorResult;

    // Clamp: high-severity structuring detected → escalate.
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
  extensions.explanation = explainableScore(explainInput);

  // 7. Subsystem 19: zk-proof audit seal (default on, opt-out via sealProofBundle: false)
  //
  // The zk-seal uses Web Crypto SubtleDigest. If the runtime lacks
  // crypto.subtle (very old browsers, some Node ESM contexts) or the digest
  // call fails, we must NOT lose the compliance verdict — the decision is
  // more important than the audit seal. Log the failure and continue with
  // proofBundle undefined, then force human review so an MLRO manually
  // anchors the decision. FDL Art.24 requires the decision record to be
  // retained even if the cryptographic attestation is unavailable.
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
      clampReasons.push(
        `CLAMP: zk-proof audit seal failed (${message}) — manual audit anchor required (FDL Art.24)`
      );
      // Degrade gracefully: leave extensions.proofBundle undefined. The
      // augmented human-review flag below will flip to true because
      // clampReasons is non-empty, so an MLRO will see this case.
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

  // 9. Augmented human-review flag.
  const requiresHumanReview =
    mega.requiresHumanReview ||
    clampReasons.length > 0 ||
    finalVerdict === 'freeze' ||
    confidence < 0.7;

  // 10. Audit narrative.
  const auditNarrative = buildAuditNarrative(mega, finalVerdict, clampReasons, extensions);

  return {
    mega,
    extensions,
    finalVerdict,
    clampReasons,
    requiresHumanReview,
    confidence: Math.round(confidence * 10000) / 10000,
    auditNarrative,
  };
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
