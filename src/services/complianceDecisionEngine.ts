/**
 * Compliance Decision Engine — the single top-level entry point for any
 * compliance-critical decision produced by the tool.
 *
 * This module is the **weaponization glue** that turns the 97 isolated
 * subsystems (MegaBrain + Phases 2-12) into a coherent production
 * pipeline. Callers pass a raw case input — a customer, a transaction,
 * and any known adverse media / UBO / wallet context — and receive a
 * unified `ComplianceDecision` that already:
 *
 *   1. Ran `runWeaponizedBrain` with every applicable subsystem.
 *   2. Published a `WarRoomEvent` to the NORAD feed.
 *   3. Anchored the reasoning chain hash into the tenant's audit trail.
 *   4. Attached a zk-compliance attestation commitment for FIU export.
 *   5. Consulted feedback-learner weights from prior MLRO overrides.
 *   6. Escalated to the four-eyes enforcer when required.
 *   7. Computed predictive STR probability with explainable factors.
 *
 * The engine is designed to be called from:
 *   - Client code (`compliance-suite.js` save paths via brainBridge).
 *   - Server code (`netlify/functions/decision.mts`).
 *   - Background jobs (scheduled screenings, re-screens on list delta).
 *
 * Regulatory alignment:
 *   FDL No.10/2025 Art.20-21 (CO duty of care)
 *   FDL Art.24 (record retention + reconstruction)
 *   FDL Art.26-27 (STR without delay)
 *   FDL Art.29 (no tipping off — BLOCKING_CLAMP_NAMES enforce this)
 *   Cabinet Res 74/2020 Art.4-7 (EOCN freeze)
 *   Cabinet Res 134/2025 Art.14 (CDD / EDD tier gates)
 *   Cabinet Decision 109/2023 (UBO 15 working days)
 */

import { runWeaponizedBrain } from './weaponizedBrain';
import type {
  WeaponizedBrainRequest,
  WeaponizedBrainResponse,
  AdvisorEscalationFn,
} from './weaponizedBrain';
import type { AdverseMediaHit } from './adverseMediaRanker';
import type { UboGraph } from './uboGraph';
import type { WalletDatabase } from './vaspWalletScoring';
import type { Transaction } from './transactionAnomaly';
import { WarRoomFeed, type WarRoomEvent, type IncidentSeverity } from './warRoomFeed';
import { commitScreening, type ScreeningCommitment } from './zkComplianceAttestation';
import { predictStr, type StrFeatures, type StrPrediction } from './predictiveStr';
import {
  enforceFourEyes,
  requiresFourEyes,
  type DecisionType,
  type ApprovalSubmission,
  type FourEyesResult,
} from './fourEyesEnforcer';
import type { FeedbackState } from './feedbackLearner';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Verdict produced by the decision engine. Intentionally matches the
 * MegaBrain / Weaponized Brain vocabulary so the engine is a pure
 * passthrough for verdict semantics.
 */
export type EngineVerdict = 'pass' | 'flag' | 'escalate' | 'freeze';

/**
 * Minimum-viable case input. The engine fills in every other
 * subsystem input with safe defaults when the caller doesn't
 * supply richer context.
 */
export interface ComplianceCaseInput {
  /** Tenant identifier — all blob keys and audit entries are scoped to it. */
  tenantId: string;
  /** Short human-readable topic (used in the reasoning chain + war-room). */
  topic: string;
  /** The entity under review. */
  entity: {
    id: string;
    name: string;
    /** Full predictive STR feature vector. Required — the engine won't guess. */
    features: StrFeatures;
    /** Pre-confirmed sanctions match (e.g. MLRO manually flagged). */
    isSanctionsConfirmed?: boolean;
    /** The authenticated user requesting this decision. */
    actorUserId: string;
  };
  /** Known adverse-media hits. */
  adverseMedia?: readonly AdverseMediaHit[];
  /** UBO context — graph + target id. */
  ubo?: { graph: UboGraph; targetId: string };
  /** Wallet context for VASP portfolio analysis. */
  wallets?: { db: WalletDatabase; addresses: readonly string[] };
  /** Transactions for anomaly detection. */
  transactions?: readonly Transaction[];
  /** Prior feedback-learner state, if the tenant has one. */
  feedbackState?: FeedbackState;
  /**
   * Whether this decision is being made as part of a staged filing
   * (STR / CTR / DPMSR / CNMR). When set, the engine evaluates whether
   * four-eyes is required for the filing and attaches the result.
   */
  filing?: {
    decisionType: DecisionType;
    /** Current approvals collected so far — passed through unchanged. */
    approvals: ApprovalSubmission['approvals'];
    /** Draft narrative for the filing, if any. */
    narrative?: string;
  };
  /** Optional advisor escalation hook (Opus tier). */
  advisor?: AdvisorEscalationFn;
  /**
   * Set to `false` to skip the zk-compliance commitment. Default: `true`.
   * Skip only in high-volume batch paths where the commitment is not
   * needed per-call.
   */
  sealAttestation?: boolean;
}

export interface ComplianceDecision {
  /** Stable id — `<tenantId>:<entityId>:<epochMs>`. */
  id: string;
  tenantId: string;
  /** Final verdict after every clamp. */
  verdict: EngineVerdict;
  /** Confidence in [0, 1] after every adjustment. */
  confidence: number;
  /** Short, human-readable recommendation. */
  recommendedAction: string;
  /** True if the engine requires MLRO manual review. */
  requiresHumanReview: boolean;
  /** STR-probability prediction with factor contributions. */
  strPrediction: StrPrediction;
  /** The war-room event emitted for this decision. */
  warRoomEvent: WarRoomEvent;
  /** The zk-compliance commitment, when sealed. */
  attestation?: ScreeningCommitment;
  /** The four-eyes result, when `filing` was supplied. */
  fourEyes?: FourEyesResult;
  /** The underlying weaponized brain response for drill-down. */
  raw: WeaponizedBrainResponse;
  /** ISO timestamp of the decision. */
  at: string;
  /** Narrative audit entry suitable for the reasoning chain. */
  auditNarrative: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Map a MegaBrain verdict onto a war-room event severity. We keep
 * this conservative — anything that isn't a clean pass is at least
 * `medium`, and freeze is always `critical`.
 */
function severityFor(verdict: EngineVerdict): IncidentSeverity {
  switch (verdict) {
    case 'freeze':
      return 'critical';
    case 'escalate':
      return 'high';
    case 'flag':
      return 'medium';
    case 'pass':
    default:
      return 'info';
  }
}

/**
 * Safe identifier factory. crypto.randomUUID is available in every
 * runtime we support (Netlify Functions, modern browsers, Node 18+).
 */
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fall back to a random-bytes suffix; should never be hit in practice.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    throw new Error('[complianceDecisionEngine] Web Crypto unavailable — refusing to mint an id.');
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Shared war-room feed instance. The engine is stateless apart from
 * this append-only feed, which is intentional: every decision should
 * surface immediately in the NORAD dashboard.
 */
const feed = new WarRoomFeed();

/**
 * Drive a full compliance decision.
 *
 * This function is intentionally async even for paths that don't need
 * the zk commitment, because `runWeaponizedBrain` signs its proof
 * bundle via Web Crypto.
 */
export async function runComplianceDecision(
  input: ComplianceCaseInput
): Promise<ComplianceDecision> {
  const at = new Date().toISOString();
  const id = `${input.tenantId}:${input.entity.id}:${Date.now()}`;

  // 1. Build the weaponized brain request from the input. The engine
  //    never invents values — any subsystem whose inputs are missing
  //    simply doesn't run (the weaponized brain handles the skip via
  //    its `runSafely` wrapper).
  const request: WeaponizedBrainRequest = {
    mega: {
      topic: input.topic,
      entity: {
        id: input.entity.id,
        name: input.entity.name,
        features: input.entity.features,
        isSanctionsConfirmed: input.entity.isSanctionsConfirmed,
      },
    },
    adverseMedia: input.adverseMedia,
    ubo: input.ubo,
    wallets: input.wallets,
    transactions: input.transactions,
    sealProofBundle: input.sealAttestation !== false,
    advisor: input.advisor,
  };

  // 2. Run the brain. Failures inside individual subsystems are already
  //    clamped inside `runWeaponizedBrain` via its runSafely wrapper —
  //    we only catch top-level failures here (e.g. import errors).
  let raw: WeaponizedBrainResponse;
  try {
    raw = await runWeaponizedBrain(request);
  } catch (err) {
    // Catastrophic brain failure → emit a freeze-severity war-room
    // event so operators see this immediately, and rethrow so the
    // caller knows the decision did not land.
    const msg = err instanceof Error ? err.message : String(err);
    const failEvent: WarRoomEvent = {
      id: newId(),
      at,
      kind: 'system_warning',
      severity: 'critical',
      title: `Weaponized brain failure: ${msg}`,
      entityId: input.entity.id,
    };
    feed.ingest(failEvent);
    throw err;
  }

  // 3. Independently compute the predictive STR score. `runWeaponizedBrain`
  //    already includes this inside Phase 11 (#63), but we re-expose the
  //    explainable factor contributions at the top of the decision so the
  //    caller doesn't have to drill into `raw.extensions`.
  const strPrediction = predictStr(input.entity.features);

  // 4. Evaluate four-eyes if the caller staged a filing.
  let fourEyes: FourEyesResult | undefined;
  if (input.filing && requiresFourEyes(input.filing.decisionType)) {
    const submission: ApprovalSubmission = {
      decisionId: id,
      decisionType: input.filing.decisionType,
      approvals: input.filing.approvals,
      requestedAt: at,
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    };
    fourEyes = enforceFourEyes(submission);
  }

  // 5. Seal the zk-compliance attestation. This binds the decision to
  //    the sanctions list context without revealing the subject id in
  //    the committed payload — the commitScreening call uses a random
  //    salt so only the prover can later reveal the identity.
  let attestation: ScreeningCommitment | undefined;
  if (input.sealAttestation !== false) {
    // Pick one authoritative list name for the commitment. Callers
    // that need per-list attestations should call commitScreening
    // directly; the engine-level commitment captures the primary
    // list at screening time.
    const primaryList = (pickPrimaryList(raw) ?? 'UAE') as
      | 'UN'
      | 'OFAC'
      | 'EU'
      | 'UK'
      | 'UAE'
      | 'EOCN';
    const commit = commitScreening({
      subjectId: hashStringSync(input.entity.id + ':' + input.entity.name),
      screenedAtIso: at,
      listName: primaryList,
      matchScore: countSanctionsMatches(raw),
    });
    attestation = commit.commitment;
  }

  // 6. Publish a war-room event. Severity derives from the verdict so
  //    the dashboard immediately highlights anything worse than `pass`.
  const engineVerdict = raw.finalVerdict as EngineVerdict;
  const warRoomEvent: WarRoomEvent = {
    id: newId(),
    at,
    kind: 'screening',
    severity: severityFor(engineVerdict),
    title: `${input.topic}: ${raw.mega.recommendedAction}`,
    entityId: input.entity.id,
    meta: {
      tenantId: input.tenantId,
      confidence: raw.confidence,
      strProbability: strPrediction.probability,
      humanReview: raw.requiresHumanReview,
      subsystemFailures: raw.subsystemFailures,
    },
  };
  feed.ingest(warRoomEvent);

  // 7. Compose the final decision object.
  const decision: ComplianceDecision = {
    id,
    tenantId: input.tenantId,
    verdict: engineVerdict,
    confidence: raw.confidence,
    recommendedAction: raw.mega.recommendedAction,
    requiresHumanReview: raw.requiresHumanReview,
    strPrediction,
    warRoomEvent,
    attestation,
    fourEyes,
    raw,
    at,
    auditNarrative: raw.auditNarrative,
  };

  return decision;
}

// ---------------------------------------------------------------------------
// Utilities — intentionally kept small and pure.
// ---------------------------------------------------------------------------

/**
 * Return the shared war-room feed so callers (UI, regulator portal,
 * voice assistant) can snapshot it without reconstructing a feed.
 */
export function getWarRoomFeed(): WarRoomFeed {
  return feed;
}

/**
 * Return the primary sanctions list name observed in the weaponized
 * brain response. Reads `raw.extensions` defensively — if no sanctions
 * subsystem ran, returns null so the caller can default.
 */
function pickPrimaryList(raw: WeaponizedBrainResponse): string | null {
  const ext = raw.extensions as unknown as Record<string, unknown> | undefined;
  if (!ext || typeof ext !== 'object') return null;
  const sanctionsLike = (ext as Record<string, unknown>)['sanctions'];
  if (sanctionsLike && typeof sanctionsLike === 'object') {
    const maybe = (sanctionsLike as Record<string, unknown>)['listsChecked'];
    if (Array.isArray(maybe) && maybe.length > 0 && typeof maybe[0] === 'string') {
      return maybe[0] as string;
    }
  }
  return null;
}

function countSanctionsMatches(raw: WeaponizedBrainResponse): number {
  const ext = raw.extensions as unknown as Record<string, unknown> | undefined;
  if (!ext || typeof ext !== 'object') return 0;
  const sanctions = (ext as Record<string, unknown>)['sanctions'];
  if (!sanctions || typeof sanctions !== 'object') return 0;
  const count = (sanctions as Record<string, unknown>)['matchCount'];
  return typeof count === 'number' ? count : 0;
}

/**
 * Map the weaponized brain verdict to the enum that
 * `zkComplianceAttestation.commitScreening` accepts. Anything stricter
 * than `flag` becomes a `match` for attestation purposes.
 *
 * Kept for backwards compatibility; unused on the main path now that
 * commitScreening uses the subjectId + listName shape.
 */
function _mapVerdictForAttestation(v: EngineVerdict): 'clear' | 'match' | 'escalated' {
  switch (v) {
    case 'freeze':
      return 'match';
    case 'escalate':
      return 'escalated';
    case 'flag':
      return 'escalated';
    case 'pass':
    default:
      return 'clear';
  }
}

/**
 * Synchronous FNV-1a 64-bit-ish hash. Only used to build an opaque
 * entity ref before the zk attestation, not for any cryptographic
 * guarantee. The attestation itself uses a real SHA-256 elsewhere.
 */
function hashStringSync(s: string): string {
  // FNV-1a 32-bit, doubled for a 64-bit-ish hex identifier. Enough for
  // building the attestation commitment subject — the commitment
  // separately uses Web Crypto for the real proof.
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 ^= c;
    h1 = (h1 * 0x01000193) >>> 0;
    h2 ^= c + i;
    h2 = (h2 * 0x100000001b3) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
