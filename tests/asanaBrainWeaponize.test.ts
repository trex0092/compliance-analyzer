/**
 * Unit tests for the Asana Brain Weaponization layer.
 * Tests the pure functions directly — no Asana API mock needed.
 */
import { describe, it, expect } from 'vitest';
import {
  forecastSlaBreach,
  lintAsanaComment,
  triageIncomingTask,
  type AsanaTaskSnapshot,
  type AsanaCommentSnapshot,
  type BrainTriageInvoker,
} from '@/services/asanaBrainWeaponize';

// ---------------------------------------------------------------------------
// 1. forecastSlaBreach
// ---------------------------------------------------------------------------

describe('forecastSlaBreach', () => {
  const now = new Date('2026-04-16T12:00:00Z');

  it('marks an overdue task with probability 1.0', () => {
    const tasks: AsanaTaskSnapshot[] = [
      {
        gid: 'A',
        name: 'Overdue STR',
        dueOn: '2026-04-10T00:00:00Z',
        kind: 'STR',
        hasAssignee: true,
        commentCount: 3,
        openDependencies: 0,
      },
    ];
    const out = forecastSlaBreach({ tasks, asOf: now });
    expect(out.alreadyBreached).toBe(1);
    expect(out.atRisk[0].breachProbability).toBe(1);
    expect(out.atRisk[0].citation).toBe('FDL No.10/2025 Art.26-27');
    expect(out.atRisk[0].rationale).toMatch(/Already breached/);
  });

  it('scores unassigned tasks higher than assigned peers', () => {
    const tasks: AsanaTaskSnapshot[] = [
      {
        gid: 'assigned',
        name: 'Assigned CDD',
        dueOn: '2026-05-16T12:00:00Z',
        kind: 'CDD-review',
        hasAssignee: true,
        commentCount: 0,
        openDependencies: 0,
      },
      {
        gid: 'orphan',
        name: 'Orphan CDD',
        dueOn: '2026-05-16T12:00:00Z',
        kind: 'CDD-review',
        hasAssignee: false,
        commentCount: 0,
        openDependencies: 0,
      },
    ];
    const out = forecastSlaBreach({ tasks, asOf: now });
    const assigned = out.atRisk.find((r) => r.gid === 'assigned');
    const orphan = out.atRisk.find((r) => r.gid === 'orphan');
    expect(orphan!.breachProbability).toBeGreaterThan(assigned!.breachProbability);
    expect(orphan!.rationale).toMatch(/no assignee/);
  });

  it('applies the 24h SLA budget to EOCN freeze tasks', () => {
    const tasks: AsanaTaskSnapshot[] = [
      {
        gid: 'eocn',
        name: 'EOCN freeze',
        dueOn: '2026-04-17T00:00:00Z', // 12h away
        kind: 'EOCN-freeze',
        hasAssignee: true,
        commentCount: 1,
        openDependencies: 0,
      },
    ];
    const out = forecastSlaBreach({ tasks, asOf: now });
    // 12h of a 24h budget = 50% elapsed → ~0.5 probability.
    expect(out.atRisk[0].breachProbability).toBeGreaterThan(0.4);
    expect(out.atRisk[0].breachProbability).toBeLessThan(0.6);
    expect(out.atRisk[0].citation).toBe('Cabinet Res 74/2020 Art.4-7');
  });

  it('respects topN clamp', () => {
    const tasks: AsanaTaskSnapshot[] = Array.from({ length: 20 }, (_, i) => ({
      gid: `t${i}`,
      name: `task ${i}`,
      dueOn: '2026-05-01T00:00:00Z',
      kind: 'generic',
      hasAssignee: true,
      commentCount: 0,
      openDependencies: 0,
    }));
    const out = forecastSlaBreach({ tasks, asOf: now, topN: 5 });
    expect(out.atRisk).toHaveLength(5);
    expect(out.inspected).toBe(20);
  });

  it('counts already-breached and sorts highest-risk first', () => {
    const tasks: AsanaTaskSnapshot[] = [
      {
        gid: 'later',
        name: 'later',
        dueOn: '2026-06-01T00:00:00Z',
        kind: 'CDD-review',
        hasAssignee: true,
        commentCount: 0,
        openDependencies: 0,
      },
      {
        gid: 'overdue',
        name: 'overdue',
        dueOn: '2026-04-10T00:00:00Z',
        kind: 'STR',
        hasAssignee: true,
        commentCount: 0,
        openDependencies: 0,
      },
    ];
    const out = forecastSlaBreach({ tasks, asOf: now });
    expect(out.atRisk[0].gid).toBe('overdue');
    expect(out.alreadyBreached).toBe(1);
    expect(out.narrative).toMatch(/pre-escalate/i);
  });
});

// ---------------------------------------------------------------------------
// 2. lintAsanaComment
// ---------------------------------------------------------------------------

describe('lintAsanaComment', () => {
  it('passes a decision comment that cites a regulation', () => {
    const comment: AsanaCommentSnapshot = {
      gid: 'c1',
      taskGid: 't1',
      authorGid: 'u1',
      text: 'Escalating verdict to freeze per Cabinet Res 74/2020 Art.4-7.',
      createdAt: '2026-04-16T12:00:00Z',
    };
    const out = lintAsanaComment(comment);
    expect(out.needsRetrofit).toBe(false);
    expect(out.suggestedFollowup).toBeUndefined();
    expect(out.report.defects).toHaveLength(0);
  });

  it('flags a decision comment that lacks a citation and produces a follow-up', () => {
    const comment: AsanaCommentSnapshot = {
      gid: 'c2',
      taskGid: 't2',
      authorGid: 'u1',
      text: 'Decided to escalate — file STR asap.',
      createdAt: '2026-04-16T12:00:00Z',
    };
    const out = lintAsanaComment(comment);
    expect(out.needsRetrofit).toBe(true);
    expect(out.report.defects.length).toBeGreaterThan(0);
    expect(out.suggestedFollowup).toMatch(/CLAUDE\.md §8/);
    expect(out.suggestedFollowup).toMatch(/FDL No\.10\/2025 Art\.24/);
  });

  it('ignores chit-chat that does not bear on a verdict', () => {
    const comment: AsanaCommentSnapshot = {
      gid: 'c3',
      taskGid: 't3',
      authorGid: 'u1',
      text: 'Thanks team, good work on this one.',
      createdAt: '2026-04-16T12:00:00Z',
    };
    const out = lintAsanaComment(comment);
    expect(out.needsRetrofit).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. triageIncomingTask
// ---------------------------------------------------------------------------

describe('triageIncomingTask', () => {
  it('heuristically flags a sanctions-keyword task as P0-CRITICAL', async () => {
    const out = await triageIncomingTask({
      task: {
        gid: 't1',
        name: 'Review OFAC list hit on counterparty',
        kind: 'generic',
      },
    });
    expect(out.priority).toBe('P0-CRITICAL');
    expect(out.riskTier).toBe('sanctioned');
    expect(out.heuristicOnly).toBe(true);
    expect(out.nextAction).toMatch(/EOCN countdown/);
    expect(out.narrative).toMatch(/Cabinet Res 74\/2020/);
  });

  it('heuristically flags a PEP task as P0', async () => {
    const out = await triageIncomingTask({
      task: {
        gid: 't2',
        name: 'New customer flagged PEP',
        description: 'politically exposed person, needs EDD',
        kind: 'CDD-review',
      },
    });
    expect(['P0', 'P0-CRITICAL']).toContain(out.priority);
    expect(out.riskTier).toBe('PEP');
    expect(out.signals).toContain('pep-keyword');
  });

  it('falls back to P3 / SDD when no signals match', async () => {
    const out = await triageIncomingTask({
      task: {
        gid: 't3',
        name: 'Update office plants',
        kind: 'generic',
      },
    });
    expect(out.priority).toBe('P3');
    expect(out.riskTier).toBe('SDD');
    expect(out.signals).toEqual(['no-signal-match']);
  });

  it('uses the brain invoker when provided', async () => {
    const brain: BrainTriageInvoker = async () => ({
      priority: 'P0',
      riskTier: 'EDD',
      nextAction: 'Brain-recommended action',
      signals: ['brain-signal-a', 'brain-signal-b'],
    });
    const out = await triageIncomingTask({
      task: { gid: 't4', name: 'anything', kind: 'EDD-review' },
      brain,
    });
    expect(out.heuristicOnly).toBe(false);
    expect(out.nextAction).toBe('Brain-recommended action');
    expect(out.signals).toEqual(['brain-signal-a', 'brain-signal-b']);
  });

  it('falls back to heuristics when the brain invoker throws', async () => {
    const brain: BrainTriageInvoker = async () => {
      throw new Error('advisor unreachable');
    };
    const out = await triageIncomingTask({
      task: {
        gid: 't5',
        name: 'Suspicious transaction — draft STR',
        kind: 'STR',
      },
      brain,
    });
    expect(out.heuristicOnly).toBe(true);
    expect(out.priority).toBe('P0');
    expect(out.signals).toContain('str-keyword');
  });

  it('selects the highest-priority rule when multiple match', async () => {
    const out = await triageIncomingTask({
      task: {
        gid: 't6',
        name: 'High-risk PEP with OFAC match',
        kind: 'generic',
      },
    });
    // sanctions-keyword (P0-CRITICAL) must win over PEP (P0) and high-risk (P1).
    expect(out.priority).toBe('P0-CRITICAL');
  });
});
