/**
 * Unit tests for Weaponized Phase 16 operational hardening weapons.
 */
import { describe, it, expect } from 'vitest';
import {
  scoreBehavioralTrust,
  detectFourEyesDefection,
  runRegulatorVoiceWarGame,
  buildMlroWarRoomView,
  WAR_GAME_QUESTIONS,
  type BehavioralBaseline,
  type BehavioralSignals,
  type ApprovalPairEvent,
  type MlroOpenItem,
} from '@/services/weaponizedPhase16';

// ---------------------------------------------------------------------------
// 1. scoreBehavioralTrust
// ---------------------------------------------------------------------------

describe('scoreBehavioralTrust', () => {
  const baseline: BehavioralBaseline = {
    userId: 'mlro-1',
    medianApprovalsPerHour: 4,
    medianSessionMinutes: 60,
    expectedGeos: ['AE'],
  };

  it('gives standard tier when session matches baseline', () => {
    const signals: BehavioralSignals = {
      userId: 'mlro-1',
      sessionApprovalsPerHour: 4,
      sessionMinutes: 60,
      observedGeo: 'AE',
      newDevice: false,
      outOfHours: false,
    };
    const out = scoreBehavioralTrust({ baseline, signals });
    expect(out.trust).toBe(1);
    expect(out.effectiveApprovalTier).toBe('standard');
    expect(out.flags).toEqual([]);
  });

  it('suspends the tier when multiple anomalies compound', () => {
    const signals: BehavioralSignals = {
      userId: 'mlro-1',
      sessionApprovalsPerHour: 40, // 10× baseline
      sessionMinutes: 400, // ~7× baseline
      observedGeo: 'RU',
      newDevice: true,
      outOfHours: true,
    };
    const out = scoreBehavioralTrust({ baseline, signals });
    expect(out.trust).toBeLessThan(0.25);
    expect(out.effectiveApprovalTier).toBe('suspended');
    expect(out.flags).toContain('velocity-3x-over-baseline');
    expect(out.flags).toContain('geo-mismatch-RU');
    expect(out.flags).toContain('new-device');
    expect(out.flags).toContain('out-of-hours');
  });

  it('downgrades at moderate anomaly levels', () => {
    const signals: BehavioralSignals = {
      userId: 'mlro-1',
      sessionApprovalsPerHour: 20, // 5× baseline → velocity flag
      sessionMinutes: 60,
      observedGeo: 'DE', // not in baseline → geo flag
      newDevice: false,
      outOfHours: false,
    };
    const out = scoreBehavioralTrust({ baseline, signals });
    expect(out.effectiveApprovalTier).toBe('downgraded');
    expect(out.trust).toBeGreaterThanOrEqual(0.25);
    expect(out.trust).toBeLessThan(0.5);
  });

  it('cites FDL Art.20-21 in the narrative when flagged', () => {
    const signals: BehavioralSignals = {
      userId: 'mlro-1',
      sessionApprovalsPerHour: 4,
      sessionMinutes: 60,
      observedGeo: 'KP',
      newDevice: false,
      outOfHours: false,
    };
    const out = scoreBehavioralTrust({ baseline, signals });
    expect(out.narrative).toMatch(/FDL Art\.20-21/);
  });
});

// ---------------------------------------------------------------------------
// 2. detectFourEyesDefection
// ---------------------------------------------------------------------------

describe('detectFourEyesDefection', () => {
  const day = (n: number) => `2026-05-${String(n).padStart(2, '0')}T12:00:00Z`;

  it('reports no defection when pairs are evenly spread', () => {
    const events: ApprovalPairEvent[] = [
      { approverA: 'u1', approverB: 'u2', atIso: day(1) },
      { approverA: 'u3', approverB: 'u4', atIso: day(2) },
      { approverA: 'u5', approverB: 'u6', atIso: day(3) },
    ];
    const out = detectFourEyesDefection({ events });
    expect(out.defectingPairs).toEqual([]);
    expect(out.narrative).toMatch(/within tolerance/);
  });

  it('flags a pair concentrated above threshold', () => {
    const events: ApprovalPairEvent[] = [
      { approverA: 'u1', approverB: 'u2', atIso: day(1) },
      { approverA: 'u1', approverB: 'u2', atIso: day(2) },
      { approverA: 'u1', approverB: 'u2', atIso: day(3) },
      { approverA: 'u3', approverB: 'u4', atIso: day(4) },
    ];
    const out = detectFourEyesDefection({ events });
    expect(out.defectingPairs).toHaveLength(1);
    expect(out.defectingPairs[0].approverA).toBe('u1');
    expect(out.defectingPairs[0].approverB).toBe('u2');
    expect(out.defectingPairs[0].share).toBeCloseTo(0.75, 2);
    expect(out.narrative).toMatch(/Cabinet Res 134\/2025 Art\.19/);
  });

  it('canonicalises pair order so (A,B) and (B,A) aggregate', () => {
    const events: ApprovalPairEvent[] = [
      { approverA: 'u1', approverB: 'u2', atIso: day(1) },
      { approverA: 'u2', approverB: 'u1', atIso: day(2) }, // reversed
    ];
    const out = detectFourEyesDefection({ events, thresholdShare: 0.3 });
    expect(out.pairs).toHaveLength(1);
    expect(out.pairs[0].count).toBe(2);
  });

  it('handles empty events without divide-by-zero', () => {
    const out = detectFourEyesDefection({ events: [] });
    expect(out.pairs).toEqual([]);
    expect(out.defectingPairs).toEqual([]);
  });

  it('accepts a custom threshold share', () => {
    const events: ApprovalPairEvent[] = [
      { approverA: 'u1', approverB: 'u2', atIso: day(1) },
      { approverA: 'u1', approverB: 'u2', atIso: day(2) },
      { approverA: 'u3', approverB: 'u4', atIso: day(3) },
      { approverA: 'u3', approverB: 'u4', atIso: day(4) },
    ];
    // Each pair = 0.5. With 0.4 threshold both flag; with 0.6 neither flags.
    const strict = detectFourEyesDefection({ events, thresholdShare: 0.4 });
    expect(strict.defectingPairs).toHaveLength(2);
    const loose = detectFourEyesDefection({ events, thresholdShare: 0.6 });
    expect(loose.defectingPairs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. runRegulatorVoiceWarGame
// ---------------------------------------------------------------------------

describe('runRegulatorVoiceWarGame', () => {
  it('includes exactly 10 canonical questions each with a citation', () => {
    expect(WAR_GAME_QUESTIONS).toHaveLength(10);
    for (const q of WAR_GAME_QUESTIONS) {
      expect(q.citation.length).toBeGreaterThan(10);
      expect(q.id).toMatch(/^q\d+$/);
    }
  });

  it('returns "ready" verdict when every answer passes', () => {
    const allPass = Object.fromEntries(WAR_GAME_QUESTIONS.map((q) => [q.id, true]));
    const out = runRegulatorVoiceWarGame({ answers: allPass });
    expect(out.score).toBe(1);
    expect(out.verdict).toBe('ready');
    expect(out.redItems).toEqual([]);
  });

  it('returns "not-ready" when under 70% pass', () => {
    const mostlyFail = Object.fromEntries(
      WAR_GAME_QUESTIONS.map((q, i) => [q.id, i < 3]) // 3/10 pass
    );
    const out = runRegulatorVoiceWarGame({ answers: mostlyFail });
    expect(out.verdict).toBe('not-ready');
    expect(out.redItems).toHaveLength(7);
    expect(out.redItems[0].citation.length).toBeGreaterThan(0);
  });

  it('returns "mostly-ready" in the 70-89% band', () => {
    const mostlyPass = Object.fromEntries(
      WAR_GAME_QUESTIONS.map((q, i) => [q.id, i < 8]) // 8/10
    );
    const out = runRegulatorVoiceWarGame({ answers: mostlyPass });
    expect(out.verdict).toBe('mostly-ready');
  });

  it('treats a missing answer as a fail', () => {
    const out = runRegulatorVoiceWarGame({ answers: {} });
    expect(out.passed).toBe(0);
    expect(out.verdict).toBe('not-ready');
  });
});

// ---------------------------------------------------------------------------
// 4. buildMlroWarRoomView
// ---------------------------------------------------------------------------

describe('buildMlroWarRoomView', () => {
  const now = new Date('2026-04-16T12:00:00Z');

  it('buckets items by urgency vs the asOf clock', () => {
    const items: MlroOpenItem[] = [
      { kind: 'open-str', id: 's1', title: 'STR overdue', dueIso: '2026-04-10T00:00:00Z' },
      {
        kind: 'active-eocn-freeze',
        id: 'f1',
        title: 'freeze 12h',
        dueIso: '2026-04-17T00:00:00Z',
        meta: { freezeStartIso: '2026-04-16T00:00:00Z' },
      },
      {
        kind: 'four-eyes-pending',
        id: 'e1',
        title: '4eyes 3d',
        dueIso: '2026-04-19T00:00:00Z',
        meta: { approverA: 'u1' },
      },
      { kind: 'filing-deadline', id: 'fd1', title: 'distant', dueIso: '2026-06-30T00:00:00Z' },
    ];
    const out = buildMlroWarRoomView({ items, asOf: now });
    expect(out.buckets.overdue.map((i) => i.id)).toEqual(['s1']);
    expect(out.buckets.within24h.map((i) => i.id)).toEqual(['f1']);
    expect(out.buckets.within5d.map((i) => i.id)).toEqual(['e1']);
    expect(out.buckets.distant.map((i) => i.id)).toEqual(['fd1']);
  });

  it('flags an STR marked closed without a goAML receipt as invariant violation', () => {
    const items: MlroOpenItem[] = [
      {
        kind: 'open-str',
        id: 's2',
        title: 'closed STR',
        meta: { status: 'closed' },
      },
    ];
    const out = buildMlroWarRoomView({ items, asOf: now });
    expect(out.invariantViolations.some((v) => /goAML receipt/.test(v))).toBe(true);
  });

  it('flags an active freeze that lacks freezeStartIso meta', () => {
    const items: MlroOpenItem[] = [{ kind: 'active-eocn-freeze', id: 'f2', title: 'freeze no ts' }];
    const out = buildMlroWarRoomView({ items, asOf: now });
    expect(out.invariantViolations.some((v) => /freezeStartIso/.test(v))).toBe(true);
  });

  it('flags a four-eyes-pending item with no approver meta', () => {
    const items: MlroOpenItem[] = [{ kind: 'four-eyes-pending', id: 'e2', title: 'pending' }];
    const out = buildMlroWarRoomView({ items, asOf: now });
    expect(out.invariantViolations.some((v) => /Cabinet Res 134\/2025 Art\.19/.test(v))).toBe(true);
  });

  it('treats items without a due date as distant and reports invariants clean', () => {
    const items: MlroOpenItem[] = [{ kind: 'filing-deadline', id: 'fd2', title: 'no-due' }];
    const out = buildMlroWarRoomView({ items, asOf: now });
    expect(out.buckets.distant).toHaveLength(1);
    expect(out.invariantViolations).toEqual([]);
    expect(out.narrative).toMatch(/All invariants green/);
  });
});
