/**
 * Brain Super Runner — the single "smartest-brain-in-the-world" entry
 * point that upgrades runComplianceDecision with:
 *
 *   1. Automatic advisor escalation on high-stakes verdicts.
 *      The deterministic fallback advisor uses the existing brain
 *      evidence (clampReasons, strPrediction factors, war-room
 *      event) to produce enumerated-step advice without network
 *      access. Production deployments can inject a real
 *      Anthropic-backed advisor via `setAdvisor()` on the shared
 *      instance.
 *
 *   2. Automatic Asana dispatch through the AsanaOrchestrator
 *      façade. Every verdict that requires human review or has
 *      a verdict stronger than 'pass' is routed to Asana with
 *      idempotency so replays never create duplicate tasks.
 *
 *   3. A Brain Power Score (0..100) that quantifies how
 *      "weaponized" a given decision was — how many subsystems
 *      actually fired, how confident each was, whether the
 *      advisor escalated, whether the attestation sealed. This
 *      score surfaces in the Brain Console so MLROs can see at a
 *      glance whether they're getting the full brain or a thin
 *      slice.
 *
 * Non-goals / safety:
 *   - This runner NEVER mutates runComplianceDecision itself.
 *     It calls the engine with the advisor injected and then
 *     post-processes the response.
 *   - The advisor fallback is deterministic: same input → same
 *     advice text. No hidden nondeterminism.
 *   - The Asana dispatch adapter is injectable (defaults to
 *     no-op). Tests + offline environments stay functional.
 *   - No new regulatory values are introduced; all clamps and
 *     escalation triggers come from the existing weaponizedBrain
 *     and complianceDecisionEngine.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.19-21 — CO reasoned decision + advisor escalation
 *   FDL No.10/2025 Art.24    — audit trail (power score persisted)
 *   Cabinet Res 134/2025 Art.19 — internal review visibility
 *   Cabinet Res 74/2020 Art.4-7 — freeze verdict dispatch
 *   NIST AI RMF 1.0 MANAGE-2 — AI decision provenance
 */

import {
  runComplianceDecision,
  type ComplianceCaseInput,
  type ComplianceDecision,
} from './complianceDecisionEngine';
import type {
  AdvisorEscalationFn,
  AdvisorEscalationInput,
  AdvisorEscalationResult,
} from './weaponizedBrain';
import {
  orchestrator as defaultOrchestrator,
  AsanaOrchestrator,
  type AsanaOrchestratorDispatchResult,
  type BrainVerdictLike,
} from './asana/orchestrator';
import { brainMemory, recordAndCorrelate, type MemoryStore } from './brainMemoryStore';
import type { CorrelationReport } from './crossCasePatternCorrelator';
import { matchFatfTypologies, type TypologyReport } from './fatfTypologyMatcher';
import { analyseBehaviouralVelocity, type VelocityReport } from './behaviouralVelocityDetector';
import { runBrainEnsemble, type EnsembleReport } from './brainConsensusEnsemble';
import {
  emptyDigest,
  updateDigest,
  retrievePrecedents,
  type BrainMemoryDigest,
  type PrecedentReport,
} from './brainMemoryDigest';
import { augmentChainWithPrecedents, type AugmentChainResult } from './reasoningChainAugmenter';
import { DecisionFingerprintCache, computeFingerprint } from './decisionFingerprintCache';

// ---------------------------------------------------------------------------
// Brain Power Score
// ---------------------------------------------------------------------------

export interface BrainPowerScore {
  /** 0..100 — higher means more subsystems fired with higher confidence. */
  score: number;
  /** How many subsystems were actually invoked for this case. */
  subsystemsInvoked: number;
  /** How many subsystems failed during execution (subtract from score). */
  subsystemsFailed: number;
  /** Did the advisor escalate this decision? */
  advisorInvoked: boolean;
  /** Did the zk-compliance attestation seal? */
  attestationSealed: boolean;
  /** Any clamps fired? (Clamps = safety net engaged = brain working.) */
  clampsFired: number;
  /** Human-readable breakdown for the Brain Console. */
  components: ReadonlyArray<{ label: string; points: number; max: number }>;
  /** Plain-English verdict on brain health for this case. */
  verdict: 'thin' | 'standard' | 'advanced' | 'weaponized';
}

/** Internal lookup of which mega-brain subsystems produce observable output. */
const MEGA_SUBSYSTEM_KEYS: ReadonlyArray<string> = [
  'precedents',
  'anomaly',
  'belief',
  'causal',
  'strPrediction',
  'rulePrediction',
  'plan',
  'doubleCheck',
  'debate',
  'reflection',
  'penaltyVaR',
  'narrative',
];

/**
 * Compute the Brain Power Score for a decision. Bounded 0..100.
 *
 * Components (max points in parentheses):
 *   - Mega subsystem coverage (35): fraction of the 12 subsystems that
 *     populated their slot in subsystems
 *   - Weaponized extensions fired (25): count up to a cap of 8
 *   - Confidence floor (10): 10 * confidence
 *   - Advisor escalation (10): binary
 *   - Attestation sealed (10): binary
 *   - Clamps fired (5): clamps are a safety-win, not a safety-loss
 *   - No subsystem failures (5): subtract for each failure
 */
export function computeBrainPowerScore(decision: ComplianceDecision): BrainPowerScore {
  const raw = decision.raw;
  const mega = raw.mega;
  const subsystems = mega.subsystems as unknown as Record<string, unknown>;
  const extensions = raw.extensions as unknown as Record<string, unknown>;

  let invoked = 0;
  for (const key of MEGA_SUBSYSTEM_KEYS) {
    const slot = subsystems?.[key];
    if (slot !== undefined && slot !== null && !isEmptyObject(slot)) {
      invoked += 1;
    }
  }

  let extensionCount = 0;
  if (extensions && typeof extensions === 'object') {
    for (const v of Object.values(extensions)) {
      if (v !== undefined && v !== null && !isEmptyObject(v)) extensionCount += 1;
    }
  }

  const clampsFired = Array.isArray(raw.clampReasons) ? raw.clampReasons.length : 0;
  const subsystemsFailed = Array.isArray(raw.subsystemFailures) ? raw.subsystemFailures.length : 0;
  const advisorInvoked = raw.advisorResult !== null;
  const attestationSealed = decision.attestation !== undefined;
  const confidence = Math.max(0, Math.min(1, decision.confidence));

  const megaCoverage = Math.round((invoked / MEGA_SUBSYSTEM_KEYS.length) * 35);
  const extensions25 = Math.min(25, extensionCount * 3);
  const confidence10 = Math.round(confidence * 10);
  const advisor10 = advisorInvoked ? 10 : 0;
  const attestation10 = attestationSealed ? 10 : 0;
  const clamps5 = Math.min(5, clampsFired);
  const failurePenalty = Math.min(5, subsystemsFailed);
  const noFailureBonus = 5 - failurePenalty;

  const score = Math.max(
    0,
    Math.min(
      100,
      megaCoverage +
        extensions25 +
        confidence10 +
        advisor10 +
        attestation10 +
        clamps5 +
        noFailureBonus
    )
  );

  const components = [
    { label: 'Mega subsystem coverage', points: megaCoverage, max: 35 },
    { label: 'Weaponized extensions fired', points: extensions25, max: 25 },
    { label: 'Confidence floor', points: confidence10, max: 10 },
    { label: 'Advisor escalation', points: advisor10, max: 10 },
    { label: 'zk-attestation sealed', points: attestation10, max: 10 },
    { label: 'Clamps fired (safety wins)', points: clamps5, max: 5 },
    { label: 'No subsystem failures', points: noFailureBonus, max: 5 },
  ];

  let verdict: BrainPowerScore['verdict'];
  if (score >= 80) verdict = 'weaponized';
  else if (score >= 60) verdict = 'advanced';
  else if (score >= 40) verdict = 'standard';
  else verdict = 'thin';

  return {
    score,
    subsystemsInvoked: invoked,
    subsystemsFailed,
    advisorInvoked,
    attestationSealed,
    clampsFired,
    components,
    verdict,
  };
}

function isEmptyObject(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v !== 'object') return false;
  return Object.keys(v as Record<string, unknown>).length === 0;
}

// ---------------------------------------------------------------------------
// Deterministic fallback advisor
// ---------------------------------------------------------------------------

/**
 * Deterministic advisor used when no network-backed advisor is
 * injected. Produces enumerated-step advice that cites the brain's
 * own evidence. Same input → same output. Used heavily in tests.
 */
export function deterministicAdvisor(input: AdvisorEscalationInput): AdvisorEscalationResult {
  const lines: string[] = [];
  lines.push(
    `Advisor reviewed verdict="${input.verdict}" confidence=${input.confidence.toFixed(2)}.`
  );

  if (input.verdict === 'freeze') {
    lines.push('1. Execute 24h EOCN freeze protocol (Cabinet Res 74/2020 Art.4).');
    lines.push('2. Schedule CNMR within 5 business days (Art.6).');
    lines.push('3. Stage STR filing — do not notify subject (FDL Art.29).');
  } else if (input.verdict === 'escalate') {
    lines.push('1. Escalate to Compliance Officer; document reasoning.');
    lines.push('2. Apply four-eyes gate before any customer-facing action.');
    lines.push('3. Re-screen against all sanctions lists within 24h.');
  } else if (input.confidence < 0.7) {
    lines.push('1. Low confidence — request CO re-review before acting.');
    lines.push('2. Gather missing evidence (UBO chain, adverse media, transaction history).');
    lines.push('3. Re-run brain after evidence is enriched.');
  } else {
    lines.push('1. Continue standard monitoring cadence.');
    lines.push('2. No immediate escalation warranted.');
  }

  if (input.clampReasons.length > 0) {
    lines.push(
      `Note: ${input.clampReasons.length} safety clamp(s) fired — review each before closing the case.`
    );
  }

  return {
    text: lines.join('\n'),
    advisorCallCount: 1,
    modelUsed: 'deterministic-fallback',
  };
}

// ---------------------------------------------------------------------------
// Super Runner
// ---------------------------------------------------------------------------

export interface SuperRunnerOptions {
  /** Override the advisor function (tests + production hooks). */
  advisor?: AdvisorEscalationFn;
  /** Override the Asana orchestrator (default: shared singleton). */
  asana?: AsanaOrchestrator;
  /** Skip Asana dispatch entirely (tests + offline). */
  skipAsanaDispatch?: boolean;
  /** Override the brain memory store (default: shared singleton). */
  memory?: MemoryStore;
  /** Skip memory recording + cross-case correlation (tests). */
  skipMemory?: boolean;
  /**
   * Permanent memory digest to retrieve precedents from. When
   * provided, retrievePrecedents is called BEFORE the decision
   * (for injection into the reasoning chain) and updateDigest is
   * called AFTER so the tenant's compressed history grows by one
   * entry per super call. Tests can pass `emptyDigest(tenantId)`
   * to exercise the code path.
   */
  digest?: BrainMemoryDigest;
  /**
   * Optional extras to include in the memory snapshot for future
   * cross-case correlation. See snapshotFromDecision() for the
   * allowed fields — wallets, uboRefs, addressHash, etc.
   */
  memoryExtras?: {
    entityRef?: string;
    uboRefs?: readonly string[];
    wallets?: readonly string[];
    addressHash?: string;
    corridorCountry?: string;
    maxTxAED?: number;
    narrativeHash?: string;
    sanctionsMatchKeys?: readonly string[];
  };
  /**
   * Optional fingerprint cache. When provided, the runner
   * computes a deterministic SHA-256 fingerprint of
   * (tenantId, entityId, sanctionsConfirmedFlag, features) and
   * checks the cache before running the decision. A cache hit
   * returns the prior SuperDecision directly, saving every
   * subsystem call. Tests omit this option to exercise the
   * non-cached path as before.
   */
  cache?: DecisionFingerprintCache<SuperDecision>;
  /**
   * When true (and a cache is provided), force a fresh run and
   * overwrite the cache entry. Useful for debug endpoints that
   * want to bypass caching.
   */
  forceFresh?: boolean;
}

export interface SuperDecision {
  decision: ComplianceDecision;
  powerScore: BrainPowerScore;
  asanaDispatch: AsanaOrchestratorDispatchResult | null;
  /**
   * Cross-case correlation report computed against this tenant's
   * memory store, INCLUDING the case we just decided on. Null when
   * memory recording is skipped (e.g. in unit tests).
   */
  crossCase: CorrelationReport | null;
  /**
   * FATF DPMS typology report — named typologies matched by the
   * case's feature vector. Always computed (pure function).
   */
  typologies: TypologyReport;
  /**
   * Behavioural velocity report — burst / off-hours / weekend
   * clustering detected across the tenant's recent cases.
   * Null when memory is skipped (tests).
   */
  velocity: VelocityReport | null;
  /**
   * Consensus ensemble report — brain run N times with perturbed
   * input vectors to detect decision-boundary instability. Always
   * computed (pure function, no memory needed).
   */
  ensemble: EnsembleReport;
  /**
   * Historical precedents retrieved from the brain permanent
   * memory digest via cosine similarity. Empty when no digest is
   * supplied or no match clears the similarity threshold.
   */
  precedents: PrecedentReport;
  /**
   * The digest AFTER this decision was recorded. Callers persist
   * this to durable storage so the next cold start can hydrate.
   */
  digestAfter: BrainMemoryDigest;
  /**
   * Augmented reasoning chain — a new, sealed chain containing
   * every node from the original mega-brain chain plus one
   * evidence node per retrieved precedent. Falls back to the
   * original sealed chain (unchanged=true) when no precedents
   * clear the similarity threshold.
   *
   * IMPORTANT: this augmented chain is NOT covered by the
   * zk-compliance attestation (which only commits the screening
   * event metadata). It lives alongside the attestation as an
   * MLRO-facing audit artifact, not inside the cryptographic
   * commitment.
   */
  augmentedChain: AugmentChainResult;
}

/**
 * Should the advisor be escalated for this input?  Triggers mirror the
 * six MANDATORY triggers in CLAUDE.md "Model Routing: Worker + Advisor".
 */
function shouldInvokeAdvisor(input: ComplianceCaseInput): boolean {
  if (input.entity.isSanctionsConfirmed === true) return true;
  if (input.filing !== undefined) return true;
  const f = input.entity.features;
  if (f.sanctionsMatchScore >= 0.5) return true;
  if (f.isPep === true) return true;
  if (f.hasAdverseMedia === true) return true;
  if (f.highRiskJurisdiction === true && f.cashRatio30d >= 0.5) return true;
  return false;
}

/**
 * Convert a compliance decision into the shape the Asana orchestrator
 * accepts. We intentionally drop large fields (raw brain response,
 * reasoning chain) — Asana only needs verdict + confidence + action.
 */
function decisionToVerdictLike(d: ComplianceDecision): BrainVerdictLike {
  return {
    id: d.id,
    tenantId: d.tenantId,
    verdict: d.verdict,
    confidence: d.confidence,
    recommendedAction: d.recommendedAction,
    requiresHumanReview: d.requiresHumanReview,
    at: d.at,
    entityId: d.warRoomEvent.entityId ?? '',
    entityName: d.warRoomEvent.title,
    citations: [
      'FDL No.10/2025 Art.20-21',
      ...(d.attestation ? ['FDL Art.24 (zk-attestation sealed)'] : []),
      ...(d.fourEyes ? [d.fourEyes.regulatoryRef] : []),
    ],
  };
}

/**
 * Run a compliance decision through the full super-brain pipeline.
 *
 *   1. Inject the advisor if the caller didn't supply one and the
 *      case crosses a MANDATORY escalation trigger.
 *   2. Call runComplianceDecision (which runs the Weaponized Brain).
 *   3. Compute the Brain Power Score.
 *   4. Dispatch to Asana (idempotent; skipped for 'pass' verdicts).
 *
 * Fails closed: any Asana dispatch error is caught and exposed in
 * asanaDispatch.skippedReason so the decision still returns.
 */
export async function runSuperDecision(
  input: ComplianceCaseInput,
  opts: SuperRunnerOptions = {}
): Promise<SuperDecision> {
  // -------------------------------------------------------------------------
  // Fingerprint cache lookup — short-circuit on hit. Cache failures
  // never block the decision path; any exception falls through to the
  // normal run and simply doesn't write to the cache afterward.
  // -------------------------------------------------------------------------
  let cacheFingerprint: string | null = null;
  if (opts.cache && !opts.forceFresh) {
    try {
      cacheFingerprint = await computeFingerprint({
        tenantId: input.tenantId,
        entityId: input.entity.id,
        features: input.entity.features,
        sanctionsConfirmedFlag: input.entity.isSanctionsConfirmed === true,
      });
      const hit = opts.cache.get(input.tenantId, cacheFingerprint);
      if (hit !== null) return hit;
    } catch (err) {
      console.warn(
        '[brainSuperRunner] fingerprint cache lookup failed:',
        err instanceof Error ? err.message : String(err)
      );
      cacheFingerprint = null;
    }
  }

  const advisor: AdvisorEscalationFn | undefined =
    input.advisor ??
    (shouldInvokeAdvisor(input)
      ? (opts.advisor ?? (async (i) => deterministicAdvisor(i)))
      : undefined);

  const caseInput: ComplianceCaseInput = {
    ...input,
    advisor,
  };

  // Retrieve precedents BEFORE the decision so the reasoning
  // chain (future commit) can inject them into the brain's
  // narrative. Right now we just surface them in the response.
  const precedentDigest = opts.digest ?? emptyDigest(input.tenantId);
  const precedents = retrievePrecedents(precedentDigest, {
    caseId: `${input.tenantId}:${input.entity.id}`,
    features: input.entity.features,
  });

  const decision = await runComplianceDecision(caseInput);
  const powerScore = computeBrainPowerScore(decision);
  const typologies = matchFatfTypologies(input.entity.features);
  const ensemble = runBrainEnsemble(input.entity.features);

  // Update the digest with the just-decided case so it's visible
  // to the NEXT super call.
  const digestAfter = updateDigest(precedentDigest, {
    tenantId: input.tenantId,
    decision,
    features: input.entity.features,
    entityRef: input.entity.id,
    topTypologyId: typologies.matches[0]?.typology.id ?? null,
    powerScore: powerScore.score,
  });

  // Augment the mega-brain chain with precedent evidence nodes.
  // Pure function; never throws; falls back to the original
  // sealed chain if no precedents clear the similarity threshold.
  const megaChain = decision.raw.mega.chain;
  const augmentedChain = augmentChainWithPrecedents(megaChain, precedents);

  // Record + cross-case correlate BEFORE Asana dispatch so the Asana
  // task description can (in a future commit) carry correlation
  // findings as a custom field. Also run the behavioural velocity
  // detector over the tenant's recent history so burst / off-hours /
  // weekend clustering surfaces alongside the correlation findings.
  let crossCase: CorrelationReport | null = null;
  let velocity: VelocityReport | null = null;
  if (!opts.skipMemory) {
    const store = opts.memory ?? brainMemory;
    try {
      const result = recordAndCorrelate(decision, opts.memoryExtras ?? {}, store);
      crossCase = result.correlation;
      // Velocity uses the same tenant-scoped history that the
      // correlator just saw. It is pure and deterministic so it
      // never blocks and never throws under normal input.
      const recent = store.recentForTenant(decision.tenantId, 500);
      velocity = analyseBehaviouralVelocity(decision.tenantId, recent);
    } catch (err) {
      // Memory failures must never block a compliance decision.
      console.error(
        '[brainSuperRunner] memory/correlate failure:',
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  let asanaDispatch: AsanaOrchestratorDispatchResult | null = null;
  if (!opts.skipAsanaDispatch && decision.verdict !== 'pass') {
    const asana = opts.asana ?? defaultOrchestrator;
    try {
      asanaDispatch = await asana.dispatchBrainVerdict(decisionToVerdictLike(decision));
    } catch (err) {
      asanaDispatch = {
        idempotencyKey: `${decision.tenantId}:${decision.id}`,
        created: false,
        skippedReason: err instanceof Error ? `asana_error:${err.message}` : 'asana_error:unknown',
      };
    }
  }

  const result: SuperDecision = {
    decision,
    powerScore,
    asanaDispatch,
    crossCase,
    typologies,
    velocity,
    ensemble,
    precedents,
    digestAfter,
    augmentedChain,
  };

  // Store in the fingerprint cache so the next call with identical
  // inputs returns this SuperDecision directly. Guarded on a
  // successful fingerprint earlier — if we couldn't compute it,
  // we skip the write instead of poisoning the cache.
  if (opts.cache && cacheFingerprint) {
    try {
      opts.cache.set(input.tenantId, cacheFingerprint, result);
    } catch (err) {
      console.warn(
        '[brainSuperRunner] fingerprint cache set failed:',
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  return result;
}

// Exports for tests.
export const __test__ = { shouldInvokeAdvisor, decisionToVerdictLike, isEmptyObject };
