/**
 * Tests for Asana Phase 2 weaponization helpers.
 *
 * Covers the pure-function surfaces of:
 *   #A1  asana-cf-bootstrap field definitions
 *   #A4  slaTracker (businessDaysBetween, addBusinessDays, computeSlaState,
 *        rollupSlaStates)
 *   #A7  fourEyesSubtasks (buildFourEyesSubtaskPayloads independence check)
 *   #A11 filingAsanaSync :: bulkCloseOnSubmission (guard paths only)
 *   #A17/A18 asanaBidirectionalSync (resolveBidirectional, reconcileFields)
 *   #A24 euAiActReadinessProject (buildReadinessPayloads)
 *
 * Helpers that need a live Asana API (createFourEyesSubtasks,
 * scaffoldReadinessProject, dispatchSubsystemRepair,
 * dispatchGovernanceRemediation, bulkCloseOnSubmission) are covered at
 * the pure-payload / guard-path level only — live API tests belong in
 * a separate integration suite.
 */
import { describe, it, expect } from 'vitest';

import { FIELDS } from '../scripts/asana-cf-bootstrap';
import {
  businessDaysBetween,
  addBusinessDays,
  computeSlaState,
  rollupSlaStates,
} from '@/services/slaTracker';
import { buildFourEyesSubtaskPayloads, createFourEyesSubtasks } from '@/services/fourEyesSubtasks';
import { bulkCloseOnSubmission } from '@/services/filingAsanaSync';
import {
  resolveBidirectional,
  reconcileFields,
  type SyncState,
} from '@/services/asanaBidirectionalSync';
import { buildReadinessPayloads, EU_AI_ACT_DEADLINE } from '@/services/euAiActReadinessProject';

// ---------------------------------------------------------------------------
// #A1 Bootstrap field definitions
// ---------------------------------------------------------------------------

describe('asana-cf-bootstrap field definitions', () => {
  it('defines 12 canonical fields (7 core + 4 CDD push + manual action chip)', () => {
    expect(FIELDS.length).toBe(12);
  });

  it('every enum field has at least 2 options (no degenerate single-option enums)', () => {
    for (const f of FIELDS) {
      if (f.type === 'enum') {
        expect(f.options).toBeDefined();
        expect(f.options!.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('every field has a unique envKey', () => {
    const keys = FIELDS.map((f) => f.envKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------
// #A4 SLA Tracker
// ---------------------------------------------------------------------------

describe('slaTracker — business-day arithmetic', () => {
  it('counts 0 business days for same-day range', () => {
    expect(businessDaysBetween('2026-04-13T00:00:00Z', '2026-04-13T00:00:00Z')).toBe(0);
  });

  it('skips weekends (Mon to Mon = 5 business days)', () => {
    // 2026-04-13 is a Monday
    expect(businessDaysBetween('2026-04-13T00:00:00Z', '2026-04-20T00:00:00Z')).toBe(5);
  });

  it('adding 5 business days to Monday lands on the next Monday', () => {
    const out = addBusinessDays('2026-04-13T00:00:00Z', 5);
    expect(out.slice(0, 10)).toBe('2026-04-20');
  });

  it('adding 10 business days (STR deadline) from Monday', () => {
    const out = addBusinessDays('2026-04-13T00:00:00Z', 10);
    expect(out.slice(0, 10)).toBe('2026-04-27');
  });
});

describe('slaTracker — computeSlaState', () => {
  it('STR triggered today gives ~10bd remaining green bucket', () => {
    const state = computeSlaState(
      {
        caseId: 'C1',
        deadlineType: 'STR',
        triggeredAt: '2026-04-13T08:00:00Z',
        taskGid: 'T1',
      },
      new Date('2026-04-13T09:00:00Z')
    );
    expect(state.businessDaysRemaining).toBeGreaterThanOrEqual(9);
    expect(state.bucket).toBe('green');
    expect(state.deadlineType).toBe('STR');
  });

  it('CNMR triggered 4 business days ago is red', () => {
    const state = computeSlaState(
      {
        caseId: 'C2',
        deadlineType: 'CNMR',
        triggeredAt: '2026-04-13T00:00:00Z',
        taskGid: 'T2',
      },
      new Date('2026-04-17T00:00:00Z')
    );
    expect(state.bucket).toBe('red');
  });

  it('breached when now > deadline', () => {
    const state = computeSlaState(
      {
        caseId: 'C3',
        deadlineType: 'CNMR',
        triggeredAt: '2026-04-01T00:00:00Z',
        taskGid: 'T3',
      },
      new Date('2026-05-01T00:00:00Z')
    );
    expect(state.bucket).toBe('breached');
    expect(state.businessDaysRemaining).toBeLessThan(0);
  });

  it('rollup counts states correctly', () => {
    const rollup = rollupSlaStates(
      [
        { caseId: 'A', deadlineType: 'STR', triggeredAt: '2026-04-13T00:00:00Z', taskGid: 'T1' },
        { caseId: 'B', deadlineType: 'CNMR', triggeredAt: '2026-04-01T00:00:00Z', taskGid: 'T2' },
      ],
      new Date('2026-04-14T00:00:00Z')
    );
    expect(rollup.checked).toBe(2);
    expect(rollup.green + rollup.amber + rollup.red + rollup.breached).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// #A7 Four-Eyes Subtasks
// ---------------------------------------------------------------------------

describe('fourEyesSubtasks', () => {
  const approvers: readonly [
    { gid: string; name: string },
    { gid: string; name: string }
  ] = [
    { gid: 'user-alice', name: 'Alice' },
    { gid: 'user-bob', name: 'Bob' },
  ];
  const context = {
    caseId: 'CASE-42',
    caseType: 'STR approval',
    entityName: 'Acme LLC',
    riskLevel: 'high' as const,
    regulatoryBasis: 'FDL Art.26-27',
  };

  it('builds exactly two payloads (primary + independent)', () => {
    const payloads = buildFourEyesSubtaskPayloads(approvers, context);
    expect(payloads).toHaveLength(2);
    expect(payloads[0].name).toContain('PRIMARY');
    expect(payloads[1].name).toContain('INDEPENDENT');
  });

  it('assigns each payload to a different approver', () => {
    const payloads = buildFourEyesSubtaskPayloads(approvers, context);
    expect(payloads[0].assignee).toBe('user-alice');
    expect(payloads[1].assignee).toBe('user-bob');
  });

  it('payload notes warn against coordination', () => {
    const payloads = buildFourEyesSubtaskPayloads(approvers, context);
    for (const p of payloads) {
      expect(p.notes).toContain('Do not coordinate');
      expect(p.notes).toContain('Cabinet Res 134/2025 Art.19');
    }
  });

  it('createFourEyesSubtasks rejects same-user approvers', async () => {
    const same: readonly [
      { gid: string; name: string },
      { gid: string; name: string }
    ] = [
      { gid: 'user-alice', name: 'Alice' },
      { gid: 'user-alice', name: 'Alice' },
    ];
    const result = await createFourEyesSubtasks('parent-gid', same, context);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('DIFFERENT');
  });

  it('critical risk level shortens the SLA to 1 day', () => {
    const [primary] = buildFourEyesSubtaskPayloads(approvers, {
      ...context,
      riskLevel: 'critical',
    });
    // due_on is tomorrow (1 business day / 1 calendar day approximation)
    const due = Date.parse(primary.due_on);
    const now = Date.now();
    const diffDays = (due - now) / 86_400_000;
    expect(diffDays).toBeLessThan(1.5);
  });
});

// ---------------------------------------------------------------------------
// #A11 Bulk close on submission (guard path)
// ---------------------------------------------------------------------------

describe('bulkCloseOnSubmission', () => {
  it('returns not-configured error when Asana is unconfigured', async () => {
    const result = await bulkCloseOnSubmission(['t1', 't2']);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('not configured');
  });
});

// ---------------------------------------------------------------------------
// #A17/A18 Bidirectional sync resolver
// ---------------------------------------------------------------------------

describe('asanaBidirectionalSync', () => {
  const local: SyncState<string> = {
    value: 'local-value',
    updatedBy: 'analyst',
    updatedAt: '2026-04-13T08:00:00Z',
  };
  const remoteNewer: SyncState<string> = {
    value: 'remote-value',
    updatedBy: 'mlro',
    updatedAt: '2026-04-13T09:00:00Z',
  };
  const remoteOlder: SyncState<string> = {
    value: 'remote-value',
    updatedBy: 'mlro',
    updatedAt: '2026-04-13T07:00:00Z',
  };

  it('newer remote wins', () => {
    const r = resolveBidirectional(local, remoteNewer);
    expect(r.winner).toBe('remote');
    expect(r.value).toBe('remote-value');
    expect(r.losingValue).toBe('local-value');
  });

  it('newer local wins', () => {
    const r = resolveBidirectional(local, remoteOlder);
    expect(r.winner).toBe('local');
    expect(r.value).toBe('local-value');
  });

  it('identical timestamps tie → local default', () => {
    const tie: SyncState<string> = { ...remoteNewer, updatedAt: local.updatedAt };
    const r = resolveBidirectional(local, tie);
    expect(r.winner).toBe('tie');
    expect(r.value).toBe('local-value');
  });

  it('invalid local timestamp → remote wins', () => {
    const bad: SyncState<string> = { ...local, updatedAt: 'not-a-date' };
    const r = resolveBidirectional(bad, remoteNewer);
    expect(r.winner).toBe('remote');
  });

  it('reconcileFields tallies wins across a record', () => {
    const result = reconcileFields({
      local: {
        a: { value: 'A1', updatedBy: 'x', updatedAt: '2026-04-13T08:00:00Z' },
        b: { value: 'B1', updatedBy: 'x', updatedAt: '2026-04-13T10:00:00Z' },
      },
      remote: {
        a: { value: 'A2', updatedBy: 'y', updatedAt: '2026-04-13T09:00:00Z' },
        b: { value: 'B2', updatedBy: 'y', updatedAt: '2026-04-13T09:00:00Z' },
      },
    });
    // a: remote wins (newer), b: local wins (newer)
    expect(result.merged.a).toBe('A2');
    expect(result.merged.b).toBe('B1');
    expect(result.localWins).toBe(1);
    expect(result.remoteWins).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// #A24 EU AI Act Readiness project scaffolder
// ---------------------------------------------------------------------------

describe('euAiActReadinessProject', () => {
  it('builds one payload per EU AI Act control', () => {
    const payloads = buildReadinessPayloads('proj-1');
    expect(payloads.length).toBeGreaterThanOrEqual(15);
  });

  it('every payload uses the August 2026 enforcement deadline', () => {
    const payloads = buildReadinessPayloads('proj-1');
    for (const p of payloads) {
      expect(p.due_on).toBe(EU_AI_ACT_DEADLINE);
    }
  });

  it('payload names contain the EU-AIA prefix and severity', () => {
    const payloads = buildReadinessPayloads('proj-1');
    for (const p of payloads) {
      expect(p.name).toMatch(/\[EU-AIA\]\[[A-Z]+\] EU-AIA-\d+/);
    }
  });

  it('payload notes cite the EU Regulation', () => {
    const payloads = buildReadinessPayloads('proj-1');
    expect(payloads[0].notes).toContain('EU Reg 2024/1689');
  });
});
