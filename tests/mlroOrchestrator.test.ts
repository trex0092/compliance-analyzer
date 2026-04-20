import { describe, expect, it, vi } from 'vitest';
import { plan, evaluate, __test__ } from '@/services/mlroOrchestrator';
import type { ComplianceCaseInput, ComplianceDecision } from '@/services/complianceDecisionEngine';
import type { StrFeatures } from '@/services/predictiveStr';

function minimalFeatures(): StrFeatures {
  return {
    priorAlerts90d: 0,
    txValue30dAED: 10_000,
    nearThresholdCount30d: 0,
    crossBorderRatio30d: 0,
    isPep: false,
    highRiskJurisdiction: false,
    hasAdverseMedia: false,
    daysSinceOnboarding: 400,
    sanctionsMatchScore: 0,
    cashRatio30d: 0.1,
  };
}

function minimalCase(): ComplianceCaseInput {
  return {
    tenantId: 'acme',
    topic: 'routine screening',
    entity: {
      id: 'E-001',
      name: 'Clean Corp Ltd',
      features: minimalFeatures(),
      actorUserId: 'mlro-1',
    },
  };
}

function minimalDecision(overrides: Partial<ComplianceDecision> = {}): ComplianceDecision {
  const base: ComplianceDecision = {
    id: 'd-1',
    tenantId: 'acme',
    verdict: 'pass',
    confidence: 0.9,
    recommendedAction: 'proceed',
    requiresHumanReview: false,
    strPrediction: {
      probability: 0.05,
      factors: [],
      logit: -3,
      explanation: 'low',
      topRiskFactors: [],
      topProtectiveFactors: [],
    } as unknown as ComplianceDecision['strPrediction'],
    warRoomEvent: {
      id: 'w-1',
      at: new Date().toISOString(),
      kind: 'screening',
      severity: 'info',
      title: 'ok',
    },
    raw: {
      verdict: 'pass',
      confidence: 0.9,
      recommendedAction: 'proceed',
      requiresHumanReview: false,
      extensions: {},
      clampReasons: [],
      subsystemFailures: [],
      auditNarrative: 'routine',
    } as unknown as ComplianceDecision['raw'],
    at: new Date().toISOString(),
    auditNarrative: 'routine',
  };
  return { ...base, ...overrides };
}

describe('plan()', () => {
  it('always includes MegaBrain + explainable scoring steps', () => {
    const out = plan(minimalCase());
    expect(out.steps.some((s) => s.includes('MegaBrain'))).toBe(true);
    expect(out.steps.some((s) => s.includes('Explainable factor scoring'))).toBe(true);
  });

  it('omits optional steps when the corresponding input is missing', () => {
    const out = plan(minimalCase());
    expect(out.steps.some((s) => s.includes('UBO graph'))).toBe(false);
    expect(out.steps.some((s) => s.includes('VASP wallet'))).toBe(false);
    expect(out.steps.some((s) => s.includes('adverse-media'))).toBe(false);
    expect(out.steps.some((s) => s.includes('transaction anomaly'))).toBe(false);
    expect(out.steps.some((s) => s.includes('four-eyes'))).toBe(false);
  });

  it('includes the zk attestation step unless the caller opts out', () => {
    expect(plan(minimalCase()).steps.some((s) => s.includes('zk-compliance'))).toBe(true);
    const skipSealed = { ...minimalCase(), sealAttestation: false };
    expect(plan(skipSealed).steps.some((s) => s.includes('zk-compliance'))).toBe(false);
  });

  it('adds the filing-step label when a filing is staged', () => {
    const withFiling: ComplianceCaseInput = {
      ...minimalCase(),
      filing: {
        decisionType: 'str_filing',
        approvals: [],
      },
    };
    const out = plan(withFiling);
    expect(out.steps.some((s) => s.includes('four-eyes'))).toBe(true);
  });
});

describe('evaluate()', () => {
  it('raises no concerns on a clean pass decision', () => {
    const decision = minimalDecision();
    const evl = evaluate(decision, minimalCase());
    expect(evl.concerns).toEqual([]);
    expect(evl.shouldConsultAdvisor).toBe(false);
    expect(evl.recommendedVerdict).toBeUndefined();
  });

  it('triggers advisor consultation for a freeze verdict', () => {
    const decision = minimalDecision({ verdict: 'freeze' });
    const evl = evaluate(decision, minimalCase());
    expect(evl.shouldConsultAdvisor).toBe(true);
    expect(evl.concerns.some((c) => c.toLowerCase().includes('freeze'))).toBe(true);
  });

  it('triggers advisor consultation when confidence < 0.7', () => {
    const decision = minimalDecision({ confidence: 0.5 });
    const evl = evaluate(decision, minimalCase());
    expect(evl.shouldConsultAdvisor).toBe(true);
  });

  it('over-rides pass to escalate when STR probability > 0.5', () => {
    const decision = minimalDecision({
      verdict: 'pass',
      strPrediction: {
        probability: 0.8,
        factors: [],
        logit: 1,
        explanation: 'high',
        topRiskFactors: [],
        topProtectiveFactors: [],
      } as unknown as ComplianceDecision['strPrediction'],
    });
    const evl = evaluate(decision, minimalCase());
    expect(evl.recommendedVerdict).toBe('escalate');
  });

  it('flags subsystem failures as advisor triggers', () => {
    const decision = minimalDecision({
      raw: {
        verdict: 'pass',
        confidence: 0.9,
        recommendedAction: 'proceed',
        requiresHumanReview: false,
        extensions: {},
        clampReasons: [],
        subsystemFailures: ['vaspWalletScoring'],
        auditNarrative: 'routine',
      } as unknown as ComplianceDecision['raw'],
    });
    const evl = evaluate(decision, minimalCase());
    expect(evl.shouldConsultAdvisor).toBe(true);
    expect(evl.concerns.some((c) => c.includes('vaspWalletScoring'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// review() — advisor-tool call path.
//
// Regression coverage for the "Stream idle timeout - partial response
// received" failure mode: the orchestrator's reviewer must route the
// Opus advisor sub-inference through the SSE streaming code path of
// `/api/ai-proxy`, otherwise the proxy's 22s non-streaming ceiling
// fires mid-Opus-call (Opus advisor sub-inferences routinely run
// 20-40s) and the MLRO sees a truncated-socket error instead of an
// advisor rationale. Same bug shape as the one fixed for
// anthropicAdvisor in PR #359 (d176944); this pins the matching
// contract for the orchestrator reviewer.
//
// Regulatory basis: FDL No.10/2025 Art.20-21 (CO duty — advisor
// escalation must actually reach the advisor), Cabinet Res 134/2025
// Art.19 (internal review before decision).
// ---------------------------------------------------------------------------

function sseResponseBody(): ReadableStream<Uint8Array> {
  // Minimum SSE transcript the advisor parser will accept: a proxy
  // ready frame, message_start (with input token usage), one text
  // block, message_delta (with output tokens), message_stop.
  const enc = new TextEncoder();
  const frames = [
    `event: proxy_ready\ndata: ${JSON.stringify({ serverTime: new Date().toISOString() })}\n\n`,
    `event: message_start\ndata: ${JSON.stringify({
      type: 'message_start',
      message: { usage: { input_tokens: 10, output_tokens: 0 } },
    })}\n\n`,
    `event: content_block_start\ndata: ${JSON.stringify({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: '1. Cite Art.20. 2. File STR. 3. Apply four-eyes.' },
    })}\n\n`,
    `event: content_block_stop\ndata: ${JSON.stringify({
      type: 'content_block_stop',
      index: 0,
    })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({
      type: 'message_delta',
      usage: { input_tokens: 10, output_tokens: 20 },
    })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
  ];
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
}

describe('review() — advisor streaming contract', () => {
  it('posts stream:true at both the proxy envelope and the Anthropic payload when consulted', async () => {
    let capturedBody: string | null = null;
    const fakeFetch = vi.fn(async (_url: string, init: { body: string }) => {
      capturedBody = init.body;
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        body: sseResponseBody(),
      };
    });

    const decision = minimalDecision({ verdict: 'freeze' }); // triggers advisor
    const evaluation = evaluate(decision, minimalCase());
    expect(evaluation.shouldConsultAdvisor).toBe(true);

    const report = await __test__.review(decision, evaluation, {
      advisorDeps: { fetch: fakeFetch, authToken: 'test-token' },
    });

    expect(report.consulted).toBe(true);
    expect(capturedBody).not.toBeNull();
    const parsed = JSON.parse(capturedBody!);

    // Proxy envelope — the /api/ai-proxy streaming code path only
    // activates when it sees this flag at the top level.
    expect(parsed.stream).toBe(true);
    // Anthropic payload — /v1/messages only emits SSE when its own
    // payload requests streaming. Both must match; one without the
    // other leaves the proxy holding a silent socket.
    expect(parsed.payload.stream).toBe(true);

    // Sanity: it's the advisor tool, not some other call.
    expect(parsed.provider).toBe('anthropic');
    expect(parsed.path).toBe('/v1/messages');
    expect(parsed.betas).toContain('advisor-tool-2026-03-01');
    expect(
      parsed.payload.tools.some(
        (t: { type?: string; name?: string }) =>
          t.type === 'advisor_20260301' && t.name === 'advisor'
      )
    ).toBe(true);
  });

  it('skips the advisor call without error when advisorDeps is omitted', async () => {
    const decision = minimalDecision({ verdict: 'freeze' });
    const evaluation = evaluate(decision, minimalCase());
    const report = await __test__.review(decision, evaluation, {});
    expect(report.consulted).toBe(false);
    expect(report.skipReason).toMatch(/advisorDeps not provided/);
  });
});
