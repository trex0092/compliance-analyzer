/**
 * Tier C Asana dispatch adapter tests.
 */
import { describe, it, expect } from 'vitest';
import { createTierCAsanaDispatcher, __test__ } from '../src/services/asana/tierCAsanaDispatch';
import type {
  BrainVerdictLike,
  AsanaOrchestratorDispatchResult,
} from '../src/services/asana/orchestrator';
import type { BreakGlassRequest } from '../src/services/breakGlassOverride';
import type { ClampSuggestion } from '../src/services/clampSuggestionLog';

const { breakGlassToVerdict, clampSuggestionToVerdict } = __test__;

const fakeLint = { clean: true, findings: [], topSeverity: 'none' as const, narrative: '' };

function bg(overrides: Partial<BreakGlassRequest> = {}): BreakGlassRequest {
  return {
    id: 'bg-1',
    tenantId: 'tA',
    caseId: 'case-1',
    fromVerdict: 'freeze',
    toVerdict: 'escalate',
    justification: 'legit',
    regulatoryCitation: 'FDL Art.20',
    requestedBy: 'mlro-1',
    requestedAtIso: '2026-04-14T12:00:00.000Z',
    approvedBy: 'mlro-2',
    approvedAtIso: '2026-04-14T13:00:00.000Z',
    executedAtIso: null,
    status: 'approved',
    lintReport: fakeLint,
    ...overrides,
  };
}

function cs(overrides: Partial<ClampSuggestion> = {}): ClampSuggestion {
  return {
    id: 'cs-1',
    clampKey: 'sanctionsMatchMin',
    currentValue: 0.5,
    proposedValue: 0.55,
    delta: 0.05,
    evidenceCount: 100,
    rationale: 'FP rate high',
    status: 'pending_mlro_review',
    createdAtIso: '2026-04-14T12:00:00.000Z',
    regulatory: 'FDL Art.35',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// breakGlassToVerdict
// ---------------------------------------------------------------------------

describe('breakGlassToVerdict', () => {
  it('maps approved request to verdict', () => {
    const v = breakGlassToVerdict(bg());
    expect(v).not.toBeNull();
    expect(v!.verdict).toBe('escalate');
    expect(v!.confidence).toBe(1);
    expect(v!.requiresHumanReview).toBe(true);
    expect(v!.entityId).toBe('case-1');
  });

  it('returns null for pending', () => {
    expect(breakGlassToVerdict(bg({ status: 'pending_second_approval' }))).toBeNull();
  });

  it('returns null for rejected', () => {
    expect(breakGlassToVerdict(bg({ status: 'rejected' }))).toBeNull();
  });

  it('returns null for cancelled_tipping_off', () => {
    expect(breakGlassToVerdict(bg({ status: 'cancelled_tipping_off' }))).toBeNull();
  });

  it('accepts executed status (post-execute replays)', () => {
    expect(breakGlassToVerdict(bg({ status: 'executed' }))).not.toBeNull();
  });

  it('citations include Art.20-22 + Art.24 + four-eyes + requestor citation', () => {
    const v = breakGlassToVerdict(bg({ regulatoryCitation: 'FDL Art.27' }))!;
    expect(v.citations).toContain('FDL No.10/2025 Art.20-22');
    expect(v.citations).toContain('FDL No.10/2025 Art.24');
    expect(v.citations).toContain('Cabinet Res 134/2025 Art.12-14');
    expect(v.citations).toContain('FDL Art.27');
  });

  it('approvedAtIso becomes the verdict timestamp', () => {
    const v = breakGlassToVerdict(bg())!;
    expect(v.at).toBe('2026-04-14T13:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// clampSuggestionToVerdict
// ---------------------------------------------------------------------------

describe('clampSuggestionToVerdict', () => {
  it('maps suggestion to flag verdict', () => {
    const v = clampSuggestionToVerdict(cs(), 'tA');
    expect(v.verdict).toBe('flag');
    expect(v.tenantId).toBe('tA');
    expect(v.entityId).toBe('sanctionsMatchMin');
    expect(v.requiresHumanReview).toBe(true);
  });

  it('action text carries current -> proposed + rationale', () => {
    const v = clampSuggestionToVerdict(cs({ rationale: 'FP rate 40%' }), 'tA');
    expect(v.recommendedAction).toContain('0.5 -> 0.55');
    expect(v.recommendedAction).toContain('FP rate 40%');
  });

  it('citations include GOVERN-4 anchor', () => {
    const v = clampSuggestionToVerdict(cs(), 'tA');
    expect(v.citations).toContain('NIST AI RMF 1.0 GOVERN-4');
    expect(v.citations).toContain('Cabinet Res 134/2025 Art.19');
  });
});

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

describe('createTierCAsanaDispatcher', () => {
  function fakeOrchestrator() {
    const calls: BrainVerdictLike[] = [];
    const orchestrator = {
      dispatchBrainVerdict: async (
        v: BrainVerdictLike
      ): Promise<AsanaOrchestratorDispatchResult> => {
        calls.push(v);
        return {
          idempotencyKey: `${v.tenantId}:${v.id}`,
          created: true,
          taskGid: 'task-1',
        };
      },
    };
    return { orchestrator, calls };
  }

  it('dispatches an approved break-glass request', async () => {
    const { orchestrator, calls } = fakeOrchestrator();
    const dispatcher = createTierCAsanaDispatcher(orchestrator);
    const res = await dispatcher.dispatchBreakGlass(bg());
    expect(res).not.toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.verdict).toBe('escalate');
  });

  it('skips dispatch for pending break-glass', async () => {
    const { orchestrator, calls } = fakeOrchestrator();
    const dispatcher = createTierCAsanaDispatcher(orchestrator);
    const res = await dispatcher.dispatchBreakGlass(bg({ status: 'pending_second_approval' }));
    expect(res).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('dispatches a clamp suggestion every time', async () => {
    const { orchestrator, calls } = fakeOrchestrator();
    const dispatcher = createTierCAsanaDispatcher(orchestrator);
    const res = await dispatcher.dispatchClampSuggestion(cs(), 'tA');
    expect(res.created).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.entityId).toBe('sanctionsMatchMin');
  });
});
