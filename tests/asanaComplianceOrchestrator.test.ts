import { describe, expect, it } from 'vitest';
import {
  orchestrateAsanaForEvent,
  type OrchestrationEvent,
} from '@/services/asanaComplianceOrchestrator';

function evt(overrides: Partial<OrchestrationEvent>): OrchestrationEvent {
  return {
    kind: 'str_drafted',
    tenantId: 'acme',
    occurredAtIso: '2026-04-13T00:00:00.000Z',
    refId: 'STR-001',
    ...overrides,
  };
}

describe('orchestrateAsanaForEvent', () => {
  it('spawns the str_filing template for a str_drafted event', () => {
    const plan = orchestrateAsanaForEvent(evt({}));
    expect(plan.projectName).toBe('STR Filing');
    expect(plan.tasks.length).toBeGreaterThan(0);
    expect(plan.tasks[0].templateId).toBe('str_filing');
  });

  it('attaches an SLA plan to every task when the event has a regulatory deadline', () => {
    const plan = orchestrateAsanaForEvent(evt({}));
    for (const t of plan.tasks) {
      expect(t.sla).toBeDefined();
      expect(t.sla?.regulatory).toMatch(/FDL.*Art\.26-27/);
    }
  });

  it('returns a four-eyes plan for sanctions_freeze events', () => {
    const plan = orchestrateAsanaForEvent(
      evt({ kind: 'freeze_initiated', refId: 'FRZ-001' })
    );
    expect(plan.fourEyes).toBeDefined();
    expect(plan.fourEyes!.parent.isParent).toBe(true);
    expect(plan.fourEyes!.primary.parentId).toBe('parent');
  });

  it('returns a breakglass payload for sanctioned_ubo events', () => {
    const plan = orchestrateAsanaForEvent(
      evt({ kind: 'sanctioned_ubo', refId: 'UBO-001' })
    );
    expect(plan.breakglass).toBeDefined();
    expect(plan.breakglass!.severity).toBe('critical');
  });

  it('escalates a sanctions_match event with payload.confirmed=true to breakglass', () => {
    const plan = orchestrateAsanaForEvent(
      evt({
        kind: 'sanctions_match',
        refId: 'MATCH-001',
        payload: { confirmed: true },
      })
    );
    expect(plan.breakglass).toBeDefined();
  });

  it('does NOT escalate a sanctions_match event without payload.confirmed', () => {
    const plan = orchestrateAsanaForEvent(
      evt({
        kind: 'sanctions_match',
        refId: 'MATCH-002',
      })
    );
    // sanctions_match still spawns the freeze template but does NOT
    // hit the breakglass channel without explicit confirmation.
    expect(plan.breakglass).toBeUndefined();
    expect(plan.tasks[0].templateId).toBe('sanctions_freeze');
  });

  it('decision-bearing events get custom-fields populated on every task', () => {
    const plan = orchestrateAsanaForEvent(
      evt({
        kind: 'freeze_initiated',
        refId: 'FRZ-002',
        decision: {
          id: 'D-1',
          tenantId: 'acme',
          verdict: 'freeze',
          confidence: 0.95,
          recommendedAction: 'execute freeze',
          clampReasons: [
            'CLAMP: sanctioned beneficial owner detected (Cabinet Res 74/2020 Art.4-7)',
          ],
        },
      })
    );
    for (const t of plan.tasks) {
      expect(t.customFields).toBeDefined();
      expect(t.customFields!.verdict).toBe('freeze');
      expect(t.customFields!.riskLevel).toBe('critical');
      expect(t.customFields!.regulationCitation).toContain('Cabinet Res 74/2020');
    }
  });

  it('replaces the first task notes with the decision-replay narrative when a decision is supplied', () => {
    const plan = orchestrateAsanaForEvent(
      evt({
        kind: 'str_drafted',
        refId: 'STR-100',
        decision: {
          id: 'D-99',
          tenantId: 'acme',
          verdict: 'flag',
          confidence: 0.78,
          recommendedAction: 'review and file STR',
          auditNarrative: 'Multiple cash transactions just below AED 55K',
        },
      })
    );
    expect(plan.tasks[0].notes).toMatch(/Compliance decision D-99/);
    expect(plan.tasks[0].notes).toMatch(/Multiple cash transactions/);
  });

  it('throws on unknown event kinds', () => {
    expect(() =>
      orchestrateAsanaForEvent({
        kind: 'decision_landed',
        tenantId: 'acme',
        occurredAtIso: '2026-04-13T00:00:00.000Z',
        refId: 'unknown',
      })
    ).toThrow();
  });

  it('produces tasks in topological order', () => {
    const plan = orchestrateAsanaForEvent(evt({}));
    const indexById = new Map(plan.tasks.map((t, i) => [t.id, i]));
    for (const t of plan.tasks) {
      for (const dep of t.dependsOn) {
        expect(indexById.get(dep)!).toBeLessThan(indexById.get(t.id)!);
      }
    }
  });
});
