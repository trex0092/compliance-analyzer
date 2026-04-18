/**
 * Tests for dispatchImmediateAlerts — the dispatcher that fans out
 * sanctions/adverse-media/PEP/UBO events to Asana for every watched
 * subject impacted.
 *
 * Coverage:
 *   - Empty candidate list → no tasks, summary reports zero work.
 *   - Empty watchlist → no tasks even if candidates present.
 *   - Name-only coincidence (classification=suppress) is suppressed.
 *   - Pinned match to a new designation fires an ALERT task.
 *   - Unresolved match on a matching name fires a POSSIBLE task.
 *   - AMENDMENT event without a pin is NOT dispatched to that subject.
 *   - AMENDMENT event with a matching pin IS dispatched as CHANGE.
 *   - DELISTING event with a matching pin fires CHANGE.
 *   - Asana failure is recorded in summary but does not stop other
 *     tasks from being attempted.
 *   - candidatesFromSanctionsDelta maps NEW/AMENDMENT/DELISTING correctly.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  dispatchImmediateAlerts,
  candidatesFromSanctionsDelta,
  type CandidateEntry,
  type DispatchContext,
  type ImmediateRiskAlertsDeps,
} from '../src/services/immediateRiskAlerts';
import type { WatchlistEntry } from '../src/services/screeningWatchlist';
import type { NormalisedSanction } from '../src/services/sanctionsIngest';

const CTX: DispatchContext = {
  trigger: 'sanctions-ingest',
  runId: 'test-run',
  commitSha: 'deadbee',
};

const FIXED_NOW = new Date('2026-04-18T10:00:00.000Z');

function makeDeps(overrides: Partial<ImmediateRiskAlertsDeps>): ImmediateRiskAlertsDeps {
  return {
    loadWatchlist: vi.fn(async () => []),
    postTask: vi.fn(async () => ({ ok: true, gid: 'task-1' })),
    env: () => 'PROJ-GID',
    now: () => FIXED_NOW,
    ...overrides,
  };
}

const PINNED_UN_SUBJECT: WatchlistEntry = {
  id: 'CUS-42',
  subjectName: 'Mohamed Ahmed',
  riskTier: 'high',
  addedAtIso: '2026-04-01T00:00:00.000Z',
  seenHitFingerprints: [],
  alertCount: 0,
  resolvedIdentity: {
    dob: '12/03/1982',
    nationality: 'AE',
    idType: 'emirates_id',
    idNumber: '784-1982-1234567-1',
    listEntryRef: { list: 'UN', reference: 'QDi.123' },
    resolvedBy: 'MLRO',
    resolvedAtIso: '2026-04-10T08:00:00.000Z',
  },
};

const UNRESOLVED_SUBJECT: WatchlistEntry = {
  id: 'CUS-99',
  subjectName: 'Ahmad Al Marri',
  riskTier: 'medium',
  addedAtIso: '2026-04-15T00:00:00.000Z',
  seenHitFingerprints: [],
  alertCount: 0,
};

/**
 * Subject partially resolved (DoB only) — enough for a name+dob match
 * to cross the 0.50 "possible" threshold without crossing the 0.80
 * alert threshold. Models the common case where the MLRO captured a
 * DoB during onboarding but never pinned a specific designation.
 */
const DOB_ONLY_SUBJECT: WatchlistEntry = {
  id: 'CUS-77',
  subjectName: 'Ahmad Al Marri',
  riskTier: 'medium',
  addedAtIso: '2026-04-15T00:00:00.000Z',
  seenHitFingerprints: [],
  alertCount: 0,
  resolvedIdentity: {
    dob: '01/01/1990',
    resolvedBy: 'MLRO',
    resolvedAtIso: '2026-04-15T00:00:00.000Z',
  },
};

describe('dispatchImmediateAlerts', () => {
  it('does nothing when there are no candidates', async () => {
    const deps = makeDeps({});
    const res = await dispatchImmediateAlerts([], CTX, deps);
    expect(res.tasksAttempted).toBe(0);
    expect(res.watchlistSize).toBe(0);
    expect(deps.loadWatchlist).not.toHaveBeenCalled();
  });

  it('does nothing when the watchlist is empty', async () => {
    const deps = makeDeps({ loadWatchlist: vi.fn(async () => []) });
    const res = await dispatchImmediateAlerts(
      [
        {
          list: 'UN',
          reference: 'X',
          primaryName: 'Someone',
          changeType: 'NEW',
        },
      ],
      CTX,
      deps
    );
    expect(res.tasksAttempted).toBe(0);
    expect(deps.postTask).not.toHaveBeenCalled();
  });

  it('suppresses name-only coincidence', async () => {
    const deps = makeDeps({
      loadWatchlist: vi.fn(async () => [PINNED_UN_SUBJECT]),
    });
    // Same-reference different name — name is far off, pin only triggers
    // on ref match which won't promote a totally different name.
    const candidate: CandidateEntry = {
      list: 'UN',
      reference: 'QDi.999', // different from pinned QDi.123
      primaryName: 'Zelda Fitzgerald', // totally different name
      changeType: 'NEW',
    };
    const res = await dispatchImmediateAlerts([candidate], CTX, deps);
    expect(res.suppressed).toBe(1);
    expect(res.tasksAttempted).toBe(0);
  });

  it('fires ALERT for a pinned match with full identifiers', async () => {
    const postTask = vi.fn(async () => ({ ok: true, gid: 'G1' }));
    const deps = makeDeps({
      loadWatchlist: vi.fn(async () => [PINNED_UN_SUBJECT]),
      postTask,
    });
    const candidate: CandidateEntry = {
      list: 'UN',
      reference: 'QDi.123', // matches the pinned ref → treated as ID=1
      primaryName: 'Mohamed Ahmed',
      dateOfBirth: '12/03/1982',
      nationality: 'AE',
      changeType: 'NEW',
      reason: 'ISIL associate',
    };
    const res = await dispatchImmediateAlerts([candidate], CTX, deps);
    expect(res.tasksCreated).toBe(1);
    expect(res.tasks[0].severity).toBe('ALERT');
    expect(postTask).toHaveBeenCalledOnce();
    const call = postTask.mock.calls[0]![0];
    expect(call.projects).toEqual(['PROJ-GID']);
    expect(call.name).toContain('[SCREEN:ALERT]');
    expect(call.name).toContain('(PIN:UN/QDi.123)');
    expect(call.tags).toContain('pinned-match');
  });

  it('fires POSSIBLE for a partial-identity match (name + DoB, no pin)', async () => {
    const postTask = vi.fn(async () => ({ ok: true, gid: 'G2' }));
    const deps = makeDeps({
      loadWatchlist: vi.fn(async () => [DOB_ONLY_SUBJECT]),
      postTask,
    });
    const candidate: CandidateEntry = {
      list: 'OFAC_SDN',
      reference: 'SDN-9999',
      primaryName: 'Ahmad Al Marri',
      dateOfBirth: '01/01/1990',
      changeType: 'NEW',
    };
    const res = await dispatchImmediateAlerts([candidate], CTX, deps);
    expect(res.tasksCreated).toBe(1);
    expect(res.tasks[0].severity).toBe('POSSIBLE');
    expect(postTask).toHaveBeenCalledOnce();
    const call = postTask.mock.calls[0]![0];
    // DOB_ONLY_SUBJECT has a resolvedIdentity so it's tagged as pinned-match.
    expect(call.tags).toContain('pinned-match');
  });

  it('does NOT dispatch AMENDMENT to subjects without a matching pin', async () => {
    const postTask = vi.fn(async () => ({ ok: true, gid: 'G3' }));
    const deps = makeDeps({
      loadWatchlist: vi.fn(async () => [UNRESOLVED_SUBJECT, PINNED_UN_SUBJECT]),
      postTask,
    });
    const candidate: CandidateEntry = {
      list: 'UN',
      reference: 'QDi.777', // NOT the pinned ref (QDi.123)
      primaryName: 'Someone Else',
      changeType: 'AMENDMENT',
      amendmentSummary: 'passport number added',
    };
    const res = await dispatchImmediateAlerts([candidate], CTX, deps);
    expect(res.tasksCreated).toBe(0);
    expect(postTask).not.toHaveBeenCalled();
  });

  it('dispatches AMENDMENT to the pinned subject when the ref matches', async () => {
    const postTask = vi.fn(async () => ({ ok: true, gid: 'G4' }));
    const deps = makeDeps({
      loadWatchlist: vi.fn(async () => [PINNED_UN_SUBJECT]),
      postTask,
    });
    const candidate: CandidateEntry = {
      list: 'UN',
      reference: 'QDi.123',
      primaryName: 'Mohamed Ahmed',
      changeType: 'AMENDMENT',
      amendmentSummary: 'DoB 12/03/1982 → 12/03/1981',
    };
    const res = await dispatchImmediateAlerts([candidate], CTX, deps);
    expect(res.tasksCreated).toBe(1);
    expect(res.tasks[0].severity).toBe('CHANGE');
    const call = postTask.mock.calls[0]![0];
    expect(call.name).toContain('[SCREEN:CHANGE]');
  });

  it('dispatches DELISTING to the pinned subject as CHANGE', async () => {
    const postTask = vi.fn(async () => ({ ok: true, gid: 'G5' }));
    const deps = makeDeps({
      loadWatchlist: vi.fn(async () => [PINNED_UN_SUBJECT]),
      postTask,
    });
    const candidate: CandidateEntry = {
      list: 'UN',
      reference: 'QDi.123',
      primaryName: 'Mohamed Ahmed',
      changeType: 'DELISTING',
    };
    const res = await dispatchImmediateAlerts([candidate], CTX, deps);
    expect(res.tasksCreated).toBe(1);
    expect(res.tasks[0].severity).toBe('CHANGE');
  });

  it('records task failure without stopping the remaining tasks', async () => {
    let callCount = 0;
    const postTask = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) return { ok: false, error: 'Asana 503' };
      return { ok: true, gid: `G-${callCount}` };
    });
    // Two subjects that both score 'alert' on the same candidate — both
    // pinned on designation QDi.123 with matching DoB + nationality, so
    // a candidate carrying the same ref lands an ALERT for each.
    const TWIN_A: WatchlistEntry = { ...PINNED_UN_SUBJECT, id: 'CUS-A' };
    const TWIN_B: WatchlistEntry = { ...PINNED_UN_SUBJECT, id: 'CUS-B' };
    const deps = makeDeps({
      loadWatchlist: vi.fn(async () => [TWIN_A, TWIN_B]),
      postTask,
    });
    const candidate: CandidateEntry = {
      list: 'UN',
      reference: 'QDi.123',
      primaryName: 'Mohamed Ahmed',
      dateOfBirth: '12/03/1982',
      nationality: 'AE',
      changeType: 'NEW',
    };
    const res = await dispatchImmediateAlerts([candidate], CTX, deps);
    expect(res.tasksAttempted).toBe(2);
    expect(res.tasksCreated).toBe(1);
    expect(res.tasksFailed).toBe(1);
    expect(res.tasks[0].ok).toBe(false);
    expect(res.tasks[0].error).toBe('Asana 503');
    expect(res.tasks[1].ok).toBe(true);
  });

  it('uses the default screenings project GID when env is unset', async () => {
    const postTask = vi.fn(async () => ({ ok: true, gid: 'G6' }));
    const deps = makeDeps({
      loadWatchlist: vi.fn(async () => [DOB_ONLY_SUBJECT]),
      postTask,
      env: () => undefined,
    });
    const candidate: CandidateEntry = {
      list: 'OFAC_SDN',
      reference: 'SDN-1',
      primaryName: 'Ahmad Al Marri',
      dateOfBirth: '01/01/1990',
      changeType: 'NEW',
    };
    await dispatchImmediateAlerts([candidate], CTX, deps);
    expect(postTask.mock.calls[0]![0].projects).toEqual(['1213759768596515']);
  });
});

// ---------------------------------------------------------------------------
// candidatesFromSanctionsDelta
// ---------------------------------------------------------------------------

function makeSanction(overrides: Partial<NormalisedSanction> = {}): NormalisedSanction {
  return {
    source: 'UN',
    sourceId: 'QDi.1',
    primaryName: 'Some Person',
    aliases: [],
    type: 'individual',
    programmes: ['AQ'],
    hash: 'deadbeef',
    ...overrides,
  };
}

describe('candidatesFromSanctionsDelta', () => {
  it('maps added → NEW', () => {
    const out = candidatesFromSanctionsDelta([makeSanction({ sourceId: 'QDi.1' })], [], []);
    expect(out).toHaveLength(1);
    expect(out[0].changeType).toBe('NEW');
    expect(out[0].reference).toBe('QDi.1');
  });

  it('maps modified → AMENDMENT with a diff summary', () => {
    const before = makeSanction({ sourceId: 'QDi.2', dateOfBirth: '1970' });
    const after = makeSanction({ sourceId: 'QDi.2', dateOfBirth: '1971' });
    const out = candidatesFromSanctionsDelta([], [{ before, after }], []);
    expect(out).toHaveLength(1);
    expect(out[0].changeType).toBe('AMENDMENT');
    expect(out[0].amendmentSummary).toContain('DoB 1970 → 1971');
  });

  it('maps removed → DELISTING', () => {
    const out = candidatesFromSanctionsDelta([], [], [makeSanction({ sourceId: 'QDi.3' })]);
    expect(out).toHaveLength(1);
    expect(out[0].changeType).toBe('DELISTING');
  });

  it('maps mixed delta preserving order add → mod → del', () => {
    const out = candidatesFromSanctionsDelta(
      [makeSanction({ sourceId: 'A' })],
      [
        {
          before: makeSanction({ sourceId: 'B' }),
          after: makeSanction({ sourceId: 'B', primaryName: 'X' }),
        },
      ],
      [makeSanction({ sourceId: 'C' })]
    );
    expect(out.map((c) => c.changeType)).toEqual(['NEW', 'AMENDMENT', 'DELISTING']);
  });
});
