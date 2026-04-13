/**
 * Tests for the SLA breach auto-escalation tier selector + payload
 * builder. Pure functions — no fetch mocking required.
 */
import { describe, it, expect } from 'vitest';
import {
  chooseEscalationTier,
  buildEscalationTaskPayload,
  type EscalationContext,
} from '@/services/asanaSlaAutoEscalation';
import { computeSla } from '@/services/asanaSlaEnforcer';

function mkCtx(overrides: Partial<EscalationContext>): EscalationContext {
  const slaPlan = computeSla({
    startedAtIso: '2026-04-13T00:00:00.000Z',
    kind: 'eocn_freeze_24h',
  });
  return {
    breachedTaskGid: 'task-1',
    breachedTaskTitle: 'Freeze confirmed — case-42',
    projectGid: 'proj-1',
    minutesOverdue: 30,
    slaPlan,
    ...overrides,
  };
}

describe('chooseEscalationTier — EOCN freeze', () => {
  it('escalates to MLRO inside the first hour past due', () => {
    const decision = chooseEscalationTier(mkCtx({ minutesOverdue: 30 }));
    expect(decision.tier).toBe('MLRO');
    expect(decision.breakglass).toBe(true);
  });

  it('escalates to BOARD past 60 minutes overdue', () => {
    const decision = chooseEscalationTier(mkCtx({ minutesOverdue: 120 }));
    expect(decision.tier).toBe('BOARD');
    expect(decision.breakglass).toBe(true);
  });

  it('escalates to REGULATOR past 24 hours overdue', () => {
    const decision = chooseEscalationTier(
      mkCtx({ minutesOverdue: 25 * 60 })
    );
    expect(decision.tier).toBe('REGULATOR');
    expect(decision.breakglass).toBe(true);
  });
});

describe('chooseEscalationTier — STR/CNMR filings', () => {
  it('goes to MLRO on first breach', () => {
    const slaPlan = computeSla({
      startedAtIso: '2026-04-13T00:00:00.000Z',
      kind: 'str_without_delay',
    });
    const decision = chooseEscalationTier(
      mkCtx({ slaPlan, minutesOverdue: 60 })
    );
    expect(decision.tier).toBe('MLRO');
  });

  it('promotes to BOARD once previous tier was MLRO', () => {
    const slaPlan = computeSla({
      startedAtIso: '2026-04-13T00:00:00.000Z',
      kind: 'cnmr_5_business_days',
    });
    const decision = chooseEscalationTier(
      mkCtx({ slaPlan, minutesOverdue: 60, previousTier: 'MLRO' })
    );
    expect(decision.tier).toBe('BOARD');
    expect(decision.breakglass).toBe(true);
  });
});

describe('chooseEscalationTier — generic promotion', () => {
  it('promotes CO → MLRO', () => {
    const slaPlan = computeSla({
      startedAtIso: '2026-04-13T00:00:00.000Z',
      kind: 'cdd_periodic_review',
    });
    const decision = chooseEscalationTier(
      mkCtx({ slaPlan, previousTier: 'CO' })
    );
    expect(decision.tier).toBe('MLRO');
  });

  it('promotes MLRO → BOARD', () => {
    const slaPlan = computeSla({
      startedAtIso: '2026-04-13T00:00:00.000Z',
      kind: 'policy_update_30_days',
    });
    const decision = chooseEscalationTier(
      mkCtx({ slaPlan, previousTier: 'MLRO' })
    );
    expect(decision.tier).toBe('BOARD');
  });
});

describe('buildEscalationTaskPayload', () => {
  const ctx = mkCtx({ minutesOverdue: 30 });
  const decision = chooseEscalationTier(ctx);
  const payload = buildEscalationTaskPayload(ctx, decision);

  it('prefixes the task name with the tier tag', () => {
    expect(payload.name).toContain(`[ESCALATE-${decision.tier}]`);
    expect(payload.name).toContain('Freeze confirmed');
  });

  it('includes the SLA regulatory citation in notes', () => {
    expect(payload.notes).toContain('Cabinet Res 74/2020');
  });

  it('flags FDL Art.29 no-tipping-off in notes', () => {
    expect(payload.notes).toContain('Art.29');
  });

  it('targets the correct project', () => {
    expect(payload.projects).toEqual(['proj-1']);
  });

  it('tags with sla-breach and escalation tier', () => {
    expect(payload.tags).toContain('sla-breach');
    expect(payload.tags?.some((t) => t.startsWith('escalation:'))).toBe(true);
  });
});
