/**
 * Brain Analyze — end-to-end compliance decision endpoint.
 *
 * POST /api/brain/analyze
 *
 * Accepts a minimum-viable compliance case payload and dispatches it
 * to `runComplianceDecision()` in src/services/complianceDecisionEngine.ts,
 * which in turn runs the full Weaponized Brain (MegaBrain + 30+
 * subsystems + advisor escalation + zk-attestation + four-eyes).
 *
 * This is the FIRST production endpoint that actually executes the
 * brain in a deployed environment. Prior to this, brain.mts only
 * routed events — it never ran any subsystem. The Brain Console UI
 * in brain-console.js (commit 3) calls this endpoint to render a
 * live verdict, reasoning chain, clamps, and recommended action.
 *
 * Security:
 *   - POST only (CORS preflight allowed).
 *   - authenticate() against HAWKEYE_BRAIN_TOKEN (fails closed).
 *   - checkRateLimit() sensitive bucket: 10 req / 15 min per IP
 *     (brain analysis is expensive — one decision per minute is
 *     the realistic workload per user).
 *   - Strict input validation: any field outside the allowed schema
 *     causes a 400, logged with the authenticated userId (not the
 *     token) so replay attempts are auditable.
 *   - Response NEVER contains raw subsystem errors — those are
 *     mapped to a generic "brain_failure" reason so we do not leak
 *     which subsystem import broke.
 *   - Tipping-off linter runs on the recommendedAction BEFORE the
 *     response is returned, to guard against subtle prompt-injection
 *     cases where a subsystem produced language that could tip off
 *     the subject (FDL Art.29).
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.19-21 (CO duty of care + reasoned decision)
 *   - FDL No.10/2025 Art.24 (audit trail — persisted via war-room)
 *   - FDL No.10/2025 Art.29 (no tipping off — linted before return)
 *   - Cabinet Res 74/2020 Art.4-7 (freeze verdict = 24h countdown)
 *   - Cabinet Res 134/2025 Art.14, Art.19 (EDD + internal review)
 *   - FATF Rec 1, 10, 15, 18, 22, 23 (risk-based + UBO + DPMS)
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';
import {
  type ComplianceCaseInput,
  type ComplianceDecision,
} from '../../src/services/complianceDecisionEngine';
import type { StrFeatures } from '../../src/services/predictiveStr';
import { lintForTippingOff } from '../../src/services/tippingOffLinter';
import { runSuperDecision, type BrainPowerScore } from '../../src/services/brainSuperRunner';
import { createAnthropicAdvisor } from '../../src/services/anthropicAdvisor';
import {
  captureRegulatoryBaseline,
  checkRegulatoryDrift,
} from '../../src/services/regulatoryDriftWatchdog';
import {
  BlobBrainMemoryStore,
  createNetlifyBlobHandle,
} from '../../src/services/brainMemoryBlobStore';
import { BrainMemoryDigestBlobStore } from '../../src/services/brainMemoryDigestBlobStore';
import { emptyDigest } from '../../src/services/brainMemoryDigest';
import {
  BrainTelemetryStore,
  type BrainTelemetryEntry,
} from '../../src/services/brainTelemetryStore';
import { CaseReplayStore } from '../../src/services/caseReplayStore';

// ---------------------------------------------------------------------------
// Lazy advisor — built once per function instance so we don't
// re-create fetch / URL objects on every request. The advisor
// itself falls back to deterministic if the proxy is unreachable.
// ---------------------------------------------------------------------------
const anthropicAdvisor = createAnthropicAdvisor({
  proxyUrl:
    (typeof process !== 'undefined' && process.env?.HAWKEYE_AI_PROXY_URL) ||
    'https://hawkeye-sterling-v2.netlify.app/api/ai-proxy',
  bearerToken: typeof process !== 'undefined' ? process.env?.HAWKEYE_BRAIN_TOKEN : undefined,
});

// Baseline captured at function boot. Every request diffs against
// this so an MLRO can see drift immediately after a deploy that
// bumped constants.ts without a re-baseline.
const bootBaseline = captureRegulatoryBaseline();

// ---------------------------------------------------------------------------
// Blob-backed brain memory — singleton per function instance.
//
// The store is lazily hydrated per tenantId on first contact so a cold
// function start does not pay the full tenant history up front for
// every tenant. Subsequent requests from the same tenant on the same
// warm instance reuse the in-process cache.
//
// Failures are swallowed with a console.warn and the super-runner
// falls back to cache-only behaviour for the duration of the request.
// Cross-case correlation on a brand-new instance will be thin until
// the hydrate completes; this is acceptable because the decision path
// must never block on storage.
// ---------------------------------------------------------------------------

const brainMemoryBlob: BlobBrainMemoryStore | null = (() => {
  try {
    const store = getStore('brain-memory');
    const handle = createNetlifyBlobHandle({
      get: (key, opts) => store.get(key, opts),
      setJSON: (key, value) => store.setJSON(key, value),
      delete: (key) => store.delete(key),
    });
    return new BlobBrainMemoryStore(handle);
  } catch (err) {
    console.warn(
      '[brain-analyze] Netlify Blob store unavailable; using in-memory fallback:',
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
})();

// Digest store reuses the same Netlify Blob store ("brain-memory")
// but writes to a distinct key prefix (`digest/<tenantId>.json`) so
// it cannot collide with snapshot blobs. Same degradation as the
// snapshot store: if the blob backend is unreachable, fall back to
// an empty per-request digest so the decision path never blocks.
const brainDigestBlob: BrainMemoryDigestBlobStore | null = (() => {
  try {
    const store = getStore('brain-memory');
    const handle = createNetlifyBlobHandle({
      get: (key, opts) => store.get(key, opts),
      setJSON: (key, value) => store.setJSON(key, value),
      delete: (key) => store.delete(key),
    });
    return new BrainMemoryDigestBlobStore(handle);
  } catch {
    return null;
  }
})();

// Telemetry store — same Netlify Blob backend, dedicated key prefix
// `telemetry/<tenantId>/<YYYY-MM-DD>.jsonl`. Every /api/brain/analyze
// call writes one entry for the trend view rendered by
// /api/brain/telemetry and the Brain Console.
const brainTelemetry: BrainTelemetryStore | null = (() => {
  try {
    const store = getStore('brain-memory');
    const handle = createNetlifyBlobHandle({
      get: (key, opts) => store.get(key, opts),
      setJSON: (key, value) => store.setJSON(key, value),
      delete: (key) => store.delete(key),
    });
    return new BrainTelemetryStore(handle);
  } catch {
    return null;
  }
})();

// Case replay store — persists the CaseSnapshot + frozen regulatory
// baseline per decided case under `replay/<tenantId>/<caseId>.json`.
// Survives eviction for the full 10-year retention window (FDL Art.24),
// so /api/brain/replay can re-validate historical decisions.
const caseReplay: CaseReplayStore | null = (() => {
  try {
    const store = getStore('brain-memory');
    const handle = createNetlifyBlobHandle({
      get: (key, opts) => store.get(key, opts),
      setJSON: (key, value) => store.setJSON(key, value),
      delete: (key) => store.delete(key),
    });
    return new CaseReplayStore(handle);
  } catch {
    return null;
  }
})();

const hydratedTenants = new Set<string>();

async function ensureTenantHydrated(tenantId: string): Promise<void> {
  if (!brainMemoryBlob) return;
  if (hydratedTenants.has(tenantId)) return;
  try {
    await brainMemoryBlob.hydrate(tenantId);
    hydratedTenants.add(tenantId);
  } catch (err) {
    console.warn(
      `[brain-analyze] hydrate failed for tenant ${tenantId}:`,
      err instanceof Error ? err.message : String(err)
    );
    // Mark hydrated anyway so we don't spam retries on every request.
    hydratedTenants.add(tenantId);
  }
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':
    process.env.HAWKEYE_ALLOWED_ORIGIN ?? 'https://hawkeye-sterling-v2.netlify.app',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '600',
  Vary: 'Origin',
} as const;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init.headers ?? {}) },
  });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface AnalyzeRequest {
  tenantId: string;
  topic: string;
  entity: {
    id: string;
    name: string;
    features: StrFeatures;
    isSanctionsConfirmed?: boolean;
  };
  /** Skip attestation for high-volume batch use. Default: true (seal). */
  sealAttestation?: boolean;
}

const STRING_LIMITS = {
  tenantId: 64,
  topic: 200,
  entityId: 128,
  entityName: 256,
} as const;

const FEATURE_KEYS = [
  'priorAlerts90d',
  'txValue30dAED',
  'nearThresholdCount30d',
  'crossBorderRatio30d',
  'isPep',
  'highRiskJurisdiction',
  'hasAdverseMedia',
  'daysSinceOnboarding',
  'sanctionsMatchScore',
  'cashRatio30d',
] as const;

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function validate(
  input: unknown
): { ok: true; request: AnalyzeRequest } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'body must be an object' };
  }
  const raw = input as Record<string, unknown>;

  // --- tenantId
  if (
    typeof raw.tenantId !== 'string' ||
    raw.tenantId.length === 0 ||
    raw.tenantId.length > STRING_LIMITS.tenantId
  ) {
    return { ok: false, error: 'tenantId must be a non-empty string (<=64)' };
  }
  // --- topic
  if (
    typeof raw.topic !== 'string' ||
    raw.topic.length === 0 ||
    raw.topic.length > STRING_LIMITS.topic
  ) {
    return { ok: false, error: 'topic must be a non-empty string (<=200)' };
  }
  // --- entity
  if (!raw.entity || typeof raw.entity !== 'object') {
    return { ok: false, error: 'entity must be an object' };
  }
  const ent = raw.entity as Record<string, unknown>;
  if (typeof ent.id !== 'string' || ent.id.length === 0 || ent.id.length > STRING_LIMITS.entityId) {
    return { ok: false, error: 'entity.id must be a non-empty string (<=128)' };
  }
  if (
    typeof ent.name !== 'string' ||
    ent.name.length === 0 ||
    ent.name.length > STRING_LIMITS.entityName
  ) {
    return {
      ok: false,
      error: 'entity.name must be a non-empty string (<=256)',
    };
  }
  if (!ent.features || typeof ent.features !== 'object') {
    return { ok: false, error: 'entity.features must be an object' };
  }
  const features = ent.features as Record<string, unknown>;

  // Validate each StrFeatures field strictly.
  const validated: Partial<StrFeatures> = {};
  for (const k of FEATURE_KEYS) {
    const v = features[k];
    if (k === 'isPep' || k === 'highRiskJurisdiction' || k === 'hasAdverseMedia') {
      if (typeof v !== 'boolean') {
        return { ok: false, error: `entity.features.${k} must be boolean` };
      }
      validated[k] = v;
    } else {
      if (!isFiniteNumber(v) || v < 0) {
        return {
          ok: false,
          error: `entity.features.${k} must be a non-negative finite number`,
        };
      }
      if (k === 'crossBorderRatio30d' || k === 'cashRatio30d' || k === 'sanctionsMatchScore') {
        if (v > 1) {
          return { ok: false, error: `entity.features.${k} must be in [0,1]` };
        }
      }
      validated[k] = v as never;
    }
  }

  // Optional confirmed-sanctions flag.
  let isSanctionsConfirmed: boolean | undefined;
  if (ent.isSanctionsConfirmed !== undefined) {
    if (typeof ent.isSanctionsConfirmed !== 'boolean') {
      return {
        ok: false,
        error: 'entity.isSanctionsConfirmed must be boolean if present',
      };
    }
    isSanctionsConfirmed = ent.isSanctionsConfirmed;
  }

  // Optional sealAttestation flag.
  let sealAttestation: boolean | undefined;
  if (raw.sealAttestation !== undefined) {
    if (typeof raw.sealAttestation !== 'boolean') {
      return { ok: false, error: 'sealAttestation must be boolean if present' };
    }
    sealAttestation = raw.sealAttestation;
  }

  return {
    ok: true,
    request: {
      tenantId: raw.tenantId,
      topic: raw.topic,
      entity: {
        id: ent.id,
        name: ent.name,
        features: validated as StrFeatures,
        ...(isSanctionsConfirmed !== undefined ? { isSanctionsConfirmed } : {}),
      },
      ...(sealAttestation !== undefined ? { sealAttestation } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Serialisation — trim large nested objects to keep the response <64 KB.
// ---------------------------------------------------------------------------

function serialisePowerScore(p: BrainPowerScore) {
  return {
    score: p.score,
    verdict: p.verdict,
    subsystemsInvoked: p.subsystemsInvoked,
    subsystemsFailed: p.subsystemsFailed,
    advisorInvoked: p.advisorInvoked,
    attestationSealed: p.attestationSealed,
    clampsFired: p.clampsFired,
    components: p.components.map((c) => ({
      label: c.label,
      points: c.points,
      max: c.max,
    })),
  };
}

function serialiseDecision(decision: ComplianceDecision, userId: string) {
  const raw = decision.raw;
  return {
    id: decision.id,
    tenantId: decision.tenantId,
    actorUserId: userId,
    at: decision.at,
    verdict: decision.verdict,
    confidence: decision.confidence,
    requiresHumanReview: decision.requiresHumanReview,
    recommendedAction: decision.recommendedAction,
    auditNarrative: decision.auditNarrative,
    strPrediction: {
      probability: decision.strPrediction.probability,
      band: decision.strPrediction.band,
      recommendation: decision.strPrediction.recommendation,
      topFactors: decision.strPrediction.factors.slice(0, 5).map((f) => ({
        feature: f.feature,
        value: f.value,
        contribution: f.contribution,
        impact: f.impact,
      })),
    },
    warRoomEvent: {
      id: decision.warRoomEvent.id,
      severity: decision.warRoomEvent.severity,
      kind: decision.warRoomEvent.kind,
      title: decision.warRoomEvent.title,
      at: decision.warRoomEvent.at,
    },
    attestation: decision.attestation
      ? {
          commitHash: decision.attestation.commitHash,
          listName: decision.attestation.listName,
          attestationPublishedAtIso: decision.attestation.attestationPublishedAtIso,
        }
      : null,
    fourEyes: decision.fourEyes
      ? {
          status: decision.fourEyes.status,
          decisionType: decision.fourEyes.decisionType,
          approvalCount: decision.fourEyes.approvalCount,
          requiredCount: decision.fourEyes.requiredCount,
          meetsRequirements: decision.fourEyes.meetsRequirements,
          missingRoles: decision.fourEyes.missingRoles,
          isExpired: decision.fourEyes.isExpired,
          hoursRemaining: decision.fourEyes.hoursRemaining,
          violations: decision.fourEyes.violations,
          regulatoryRef: decision.fourEyes.regulatoryRef,
        }
      : null,
    brain: {
      finalVerdict: raw.finalVerdict,
      clampReasons: raw.clampReasons,
      subsystemFailures: raw.subsystemFailures,
      megaVerdict: raw.mega.verdict,
      megaRecommendedAction: raw.mega.recommendedAction,
      megaConfidence: raw.mega.confidence,
      megaNotes: raw.mega.notes,
      reasoningChainNodeCount: Array.isArray((raw.mega.chain as { nodes?: unknown[] }).nodes)
        ? (raw.mega.chain as { nodes: unknown[] }).nodes.length
        : 0,
      reasoningChainEdgeCount: Array.isArray((raw.mega.chain as { edges?: unknown[] }).edges)
        ? (raw.mega.chain as { edges: unknown[] }).edges.length
        : 0,
      advisorInvoked: raw.advisorResult !== null,
      advisorModel: raw.advisorResult?.modelUsed ?? null,
      managedAgentPlan: raw.managedAgentPlan.map((a) => ({
        agentType: (a as { agentType?: string }).agentType ?? 'unknown',
        reason: (a as { reason?: string }).reason ?? '',
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async (req: Request, context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
  }

  // Rate limit — sensitive bucket (10 / 15min).
  const rl = await checkRateLimit(req, {
    max: 10,
    clientIp: context.ip,
    namespace: 'brain-analyze',
  });
  if (rl) return rl;

  // Auth — fails closed.
  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const v = validate(body);
  if (!v.ok) {
    console.warn(`[BRAIN-ANALYZE] Rejected input from ${auth.userId}: ${v.error}`);
    return jsonResponse({ error: v.error }, { status: 400 });
  }
  const request = v.request;

  const caseInput: ComplianceCaseInput = {
    tenantId: request.tenantId,
    topic: request.topic,
    entity: {
      id: request.entity.id,
      name: request.entity.name,
      features: request.entity.features,
      isSanctionsConfirmed: request.entity.isSanctionsConfirmed,
      actorUserId: auth.userId!,
    },
    sealAttestation: request.sealAttestation,
  };

  let decision: ComplianceDecision;
  let powerScore: BrainPowerScore | null = null;
  let asanaDispatchSummary: {
    created: boolean;
    taskGid?: string;
    skippedReason?: string;
  } | null = null;
  let crossCaseSummary: {
    caseCount: number;
    topSeverity: string;
    findings: ReadonlyArray<{
      kind: string;
      id: string;
      caseIds: readonly string[];
      confidence: number;
      severity: string;
      description: string;
      regulatory: string;
    }>;
  } | null = null;
  let typologiesSummary: {
    topSeverity: string;
    summary: string;
    matches: ReadonlyArray<{
      id: string;
      name: string;
      description: string;
      severity: string;
      score: number;
      regulatory: string;
      recommendedAction: string;
      firedSignals: readonly string[];
    }>;
  } | null = null;
  let precedentSummary: {
    matchCount: number;
    hasCriticalPrecedent: boolean;
    summary: string;
    matches: ReadonlyArray<{
      caseId: string;
      similarity: number;
      verdict: string;
      severity: string;
      narrative: string;
    }>;
  } | null = null;
  let velocitySummary: {
    tenantId: string;
    caseCount: number;
    compositeScore: number;
    severity: string;
    summary: string;
    regulatory: string;
    burst: { score: number; description: string };
    offHours: { score: number; description: string };
    weekend: { score: number; description: string };
  } | null = null;
  let ensembleSummary: {
    runs: number;
    agreement: number;
    unstable: boolean;
    majorityTypologyId: string | null;
    majorityVoteCount: number;
    majoritySeverity: string;
    meanMatchCount: number;
    summary: string;
    regulatory: string;
  } | null = null;
  let uncertaintySummary: {
    kind: 'variance_interval';
    pointEstimate: number;
    lower: number;
    upper: number;
    width: number;
    stddev: number;
    sampleSize: number;
    agreement: number;
    coverage: 'point' | 'narrow' | 'moderate' | 'wide' | 'critical';
    summary: string;
    regulatory: string;
  } | null = null;
  let conformalSummary: {
    kind: 'conformal_split';
    alpha: number;
    calibrationSize: number;
    qHat: number;
    pointEstimate: number;
    lower: number;
    upper: number;
    width: number;
    coverage: 'exact' | 'narrow' | 'moderate' | 'wide' | 'critical';
    summary: string;
    regulatory: string;
  } | null = null;
  let debateSummary: {
    outcome: 'prosecution_wins' | 'defence_wins' | 'undetermined';
    gap: number;
    threshold: number;
    prosecutionScore: number;
    defenceScore: number;
    prosecutionPosition: string;
    defencePosition: string;
    judgeSynthesis: string;
    regulatory: readonly string[];
  } | null = null;
  try {
    // Lazy hydrate this tenant's blob-backed memory before the
    // decision so the cross-case correlator sees the full history.
    await ensureTenantHydrated(request.tenantId);

    // Load the persistent memory digest for this tenant so the
    // super runner can inject historical precedents via cosine
    // similarity. Cold start returns an empty digest; the
    // digestAfter field of the super result is written back to
    // the blob after the decision so the next request sees it.
    const loadedDigest = brainDigestBlob
      ? await brainDigestBlob.load(request.tenantId)
      : emptyDigest(request.tenantId);

    // Load the conformal-prediction calibration set: the most
    // recent ~30 days of telemetry for the tenant. The conformal
    // module needs at least MIN_CALIBRATION (20) entries to
    // produce a meaningful interval; cold tenants get a degenerate
    // point interval marked "uncalibrated" instead of a false
    // claim. Read failure → empty set → uncalibrated. Never blocks
    // the decision path.
    let conformalCalibration: readonly BrainTelemetryEntry[] = [];
    if (brainTelemetry) {
      try {
        const endIso = new Date().toISOString();
        const startIso = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
        conformalCalibration = await brainTelemetry.readRange(
          request.tenantId,
          startIso,
          endIso
        );
      } catch (err) {
        console.warn(
          '[brain-analyze] conformal calibration read failed:',
          err instanceof Error ? err.message : String(err)
        );
        conformalCalibration = [];
      }
    }

    // Run the full super-brain pipeline:
    //   - Weaponized brain (MegaBrain + 30+ subsystems)
    //   - Auto-wired Anthropic advisor (falls back to deterministic)
    //   - zk-compliance attestation
    //   - Durable brain memory store record + cross-case correlation
    //   - FATF DPMS typology matcher
    //   - Permanent digest precedent retrieval (cosine similarity)
    //   - Asana dispatch (idempotent; skipped on 'pass' verdicts)
    //   - Brain Power Score
    const superResult = await runSuperDecision(caseInput, {
      advisor: anthropicAdvisor,
      memory: brainMemoryBlob ?? undefined,
      digest: loadedDigest,
      conformalCalibration,
    });

    // Persist the updated digest. Fire-and-forget — the save
    // pending-writes queue flushes on the next request or function
    // shutdown; failures are logged server-side only.
    if (brainDigestBlob && superResult.digestAfter) {
      brainDigestBlob.save(superResult.digestAfter);
    }

    // Append a telemetry entry for the trend view. Opaque refs only
    // (FDL Art.29 safe) — never entity legal names. Fire-and-forget.
    if (brainTelemetry) {
      try {
        const megaVerdictRaw = (superResult.decision.raw as { mega?: { verdict?: string } })?.mega
          ?.verdict;
        const brainVerdict =
          megaVerdictRaw === 'pass' ||
          megaVerdictRaw === 'flag' ||
          megaVerdictRaw === 'escalate' ||
          megaVerdictRaw === 'freeze'
            ? megaVerdictRaw
            : null;
        brainTelemetry.record({
          tsIso: superResult.decision.at,
          tenantId: superResult.decision.tenantId,
          entityRef: request.entity.id,
          verdict: superResult.decision.verdict,
          confidence: superResult.decision.confidence,
          powerScore: superResult.powerScore?.score ?? null,
          brainVerdict,
          ensembleUnstable: superResult.ensemble?.unstable ?? false,
          typologyIds: (superResult.typologies?.matches ?? [])
            .slice(0, 5)
            .map((m) => m.typology.id),
          crossCaseFindingCount: superResult.crossCase?.correlations?.length ?? 0,
          velocitySeverity: superResult.velocity?.severity ?? null,
          driftSeverity: 'none',
          requiresHumanReview: superResult.decision.requiresHumanReview,
        });
      } catch (err) {
        console.warn(
          '[brain-analyze] telemetry write failed:',
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    // Persist the case replay tuple (snapshot + frozen regulatory
    // baseline + verdict at decision time) under
    // `replay/<tenantId>/<caseId>.json`. Fire-and-forget. This is what
    // /api/brain/replay reads to answer "would this case decide
    // differently today?" — see src/services/caseReplayStore.ts.
    if (caseReplay && superResult.recordedSnapshot) {
      try {
        caseReplay.record({
          tenantId: superResult.decision.tenantId,
          caseId: superResult.decision.id,
          snapshot: superResult.recordedSnapshot,
          verdictAtTime: superResult.decision.verdict,
          confidenceAtTime: superResult.decision.confidence,
          powerScoreAtTime: superResult.powerScore?.score ?? null,
        });
      } catch (err) {
        console.warn(
          '[brain-analyze] case replay write failed:',
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    decision = superResult.decision;
    powerScore = superResult.powerScore;
    if (superResult.asanaDispatch) {
      asanaDispatchSummary = {
        created: superResult.asanaDispatch.created,
        taskGid: superResult.asanaDispatch.taskGid,
        skippedReason: superResult.asanaDispatch.skippedReason,
      };
    }
    if (superResult.crossCase) {
      crossCaseSummary = {
        caseCount: superResult.crossCase.caseCount,
        topSeverity: superResult.crossCase.topSeverity,
        findings: superResult.crossCase.correlations.slice(0, 20).map((c) => ({
          kind: c.kind,
          id: c.id,
          caseIds: c.caseIds,
          confidence: c.confidence,
          severity: c.severity,
          description: c.description,
          regulatory: c.regulatory,
        })),
      };
    }
    typologiesSummary = {
      topSeverity: superResult.typologies.topSeverity,
      summary: superResult.typologies.summary,
      matches: superResult.typologies.matches.slice(0, 20).map((m) => ({
        id: m.typology.id,
        name: m.typology.name,
        description: m.typology.description,
        severity: m.typology.severity,
        score: m.score,
        regulatory: m.typology.regulatory,
        recommendedAction: m.typology.recommendedAction,
        firedSignals: m.firedSignals,
      })),
    };
    if (superResult.velocity) {
      velocitySummary = {
        tenantId: superResult.velocity.tenantId,
        caseCount: superResult.velocity.caseCount,
        compositeScore: superResult.velocity.compositeScore,
        severity: superResult.velocity.severity,
        summary: superResult.velocity.summary,
        regulatory: superResult.velocity.regulatory,
        burst: {
          score: superResult.velocity.burst.score,
          description: superResult.velocity.burst.description,
        },
        offHours: {
          score: superResult.velocity.offHours.score,
          description: superResult.velocity.offHours.description,
        },
        weekend: {
          score: superResult.velocity.weekend.score,
          description: superResult.velocity.weekend.description,
        },
      };
    }
    ensembleSummary = {
      runs: superResult.ensemble.runs,
      agreement: superResult.ensemble.agreement,
      unstable: superResult.ensemble.unstable,
      majorityTypologyId: superResult.ensemble.majorityTypologyId,
      majorityVoteCount: superResult.ensemble.majorityVoteCount,
      majoritySeverity: superResult.ensemble.majoritySeverity,
      meanMatchCount: superResult.ensemble.meanMatchCount,
      summary: superResult.ensemble.summary,
      regulatory: superResult.ensemble.regulatory,
    };
    uncertaintySummary = {
      kind: superResult.uncertainty.kind,
      pointEstimate: superResult.uncertainty.pointEstimate,
      lower: superResult.uncertainty.lower,
      upper: superResult.uncertainty.upper,
      width: superResult.uncertainty.width,
      stddev: superResult.uncertainty.stddev,
      sampleSize: superResult.uncertainty.sampleSize,
      agreement: superResult.uncertainty.agreement,
      coverage: superResult.uncertainty.coverage,
      summary: superResult.uncertainty.summary,
      regulatory: superResult.uncertainty.regulatory,
    };
    conformalSummary = {
      kind: superResult.conformal.kind,
      alpha: superResult.conformal.alpha,
      calibrationSize: superResult.conformal.calibrationSize,
      qHat: superResult.conformal.qHat,
      pointEstimate: superResult.conformal.pointEstimate,
      lower: superResult.conformal.lower,
      upper: superResult.conformal.upper,
      width: superResult.conformal.width,
      coverage: superResult.conformal.coverage,
      summary: superResult.conformal.summary,
      regulatory: superResult.conformal.regulatory,
    };
    if (superResult.debate) {
      debateSummary = {
        outcome: superResult.debate.outcome,
        gap: superResult.debate.gap,
        threshold: superResult.debate.threshold,
        prosecutionScore: superResult.debate.prosecution.score,
        defenceScore: superResult.debate.defence.score,
        prosecutionPosition: superResult.debate.prosecution.position,
        defencePosition: superResult.debate.defence.position,
        judgeSynthesis: superResult.debate.judgeSynthesis,
        regulatory: superResult.debate.regulatory,
      };
    }
    precedentSummary = {
      matchCount: superResult.precedents.matches.length,
      hasCriticalPrecedent: superResult.precedents.hasCriticalPrecedent,
      summary: superResult.precedents.summary,
      matches: superResult.precedents.matches.slice(0, 5).map((m) => ({
        caseId: m.entry.caseId,
        similarity: m.similarity,
        verdict: m.entry.verdict,
        severity: m.entry.severity,
        narrative: m.narrative,
      })),
    };
  } catch (err) {
    // Never leak subsystem internals — log server-side, return generic.
    console.error(
      `[BRAIN-ANALYZE] brain failure for ${auth.userId}:`,
      err instanceof Error ? err.message : String(err)
    );
    return jsonResponse(
      { error: 'brain_failure', reason: 'subsystem execution failed' },
      { status: 500 }
    );
  }

  // FDL Art.29 guard: lint the outbound recommendedAction for tipping-off
  // language. Even though our own subsystems should not produce it, the
  // advisor escalation can return free-text that must be filtered.
  const lint = lintForTippingOff(decision.recommendedAction);
  if (!lint.clean && (lint.topSeverity === 'critical' || lint.topSeverity === 'high')) {
    console.warn(
      `[BRAIN-ANALYZE] Tipping-off guard blocked response for ${auth.userId}: ${lint.findings.map((f) => f.patternId).join(',')}`
    );
    return jsonResponse(
      {
        error: 'tipping_off_blocked',
        reason: 'response contained language that would tip off subject (FDL Art.29)',
        findings: lint.findings.map((f) => ({
          patternId: f.patternId,
          severity: f.severity,
        })),
      },
      { status: 451 }
    );
  }

  const payload = serialiseDecision(decision, auth.userId!);

  console.log(
    `[BRAIN-ANALYZE] ${auth.userId} tenant=${request.tenantId} entity=${request.entity.id} verdict=${decision.verdict} confidence=${decision.confidence.toFixed(3)} power=${powerScore?.score ?? 'n/a'}/${powerScore?.verdict ?? '?'} humanReview=${decision.requiresHumanReview}`
  );

  // Diff current constants against the boot baseline so the SPA
  // shows drift immediately even when no one manually ran the
  // watchdog.
  const drift = checkRegulatoryDrift(bootBaseline);

  return jsonResponse({
    ok: true,
    decision: payload,
    powerScore: powerScore ? serialisePowerScore(powerScore) : null,
    asanaDispatch: asanaDispatchSummary,
    crossCase: crossCaseSummary,
    typologies: typologiesSummary,
    velocity: velocitySummary,
    ensemble: ensembleSummary,
    uncertainty: uncertaintySummary,
    conformal: conformalSummary,
    debate: debateSummary,
    precedents: precedentSummary,
    regulatoryDrift: {
      clean: drift.clean,
      versionDrifted: drift.versionDrifted,
      baselineVersion: drift.baselineVersion,
      currentVersion: drift.currentVersion,
      topSeverity: drift.topSeverity,
      findings: drift.findings.slice(0, 20).map((f) => ({
        key: f.key,
        previous: f.previous,
        current: f.current,
        delta: f.delta,
        severity: f.severity,
        description: f.description,
        regulatory: f.regulatory,
      })),
      summary: drift.summary,
    },
  });
};

export const config: Config = {
  path: '/api/brain/analyze',
  method: ['POST', 'OPTIONS'],
};

// Exported for unit tests.
export const __test__ = { validate, serialiseDecision };
