import { describe, expect, it } from 'vitest';
import {
  routeDecisionToCustomFields,
  type RouterDecisionInput,
} from '@/services/asanaCustomFieldRouter';

function input(overrides: Partial<RouterDecisionInput> = {}): RouterDecisionInput {
  return {
    id: 'd-1',
    verdict: 'pass',
    confidence: 0.9,
    clampReasons: [],
    ...overrides,
  };
}

describe('routeDecisionToCustomFields', () => {
  it('maps verdict pass → low risk', () => {
    const r = routeDecisionToCustomFields(input());
    expect(r.verdict).toBe('pass');
    expect(r.riskLevel).toBe('low');
  });

  it('maps verdict freeze → critical risk', () => {
    const r = routeDecisionToCustomFields(input({ verdict: 'freeze' }));
    expect(r.riskLevel).toBe('critical');
  });

  it('maps verdict escalate → high risk', () => {
    const r = routeDecisionToCustomFields(input({ verdict: 'escalate' }));
    expect(r.riskLevel).toBe('high');
  });

  it('extracts the regulatory citation from a clamp reason', () => {
    const r = routeDecisionToCustomFields(
      input({
        verdict: 'freeze',
        clampReasons: [
          'CLAMP: sanctioned beneficial owner detected (Cabinet Res 74/2020 Art.4-7)',
        ],
      })
    );
    expect(r.regulationCitation).toContain('Cabinet Res 74/2020');
  });

  it('honours a regulationOverride', () => {
    const r = routeDecisionToCustomFields(input(), {
      regulationOverride: 'FDL Art.26',
    });
    expect(r.regulationCitation).toBe('FDL Art.26');
  });

  it('passes through caseId + confidence + deadlineType + daysRemaining', () => {
    const r = routeDecisionToCustomFields(input({ id: 'CASE-42', confidence: 0.42 }), {
      deadlineType: 'STR',
      daysRemaining: 3,
    });
    expect(r.caseId).toBe('CASE-42');
    expect(r.confidence).toBe(0.42);
    expect(r.deadlineType).toBe('STR');
    expect(r.daysRemaining).toBe(3);
  });
});
