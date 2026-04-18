/**
 * Tests for scripts/scheduled-screening.ts.
 *
 * Exercises the pure task-content builders (alert task name/notes,
 * heartbeat task name/notes) and the per-subject screen helper.
 *
 * The top-level runScheduledScreening() orchestration is NOT end-to-end
 * tested here because it makes live HTTP calls to /api/watchlist, /api/brain,
 * and Asana — covered instead by the SCHEDULED_SCREENING_DRY_RUN=1 CI
 * smoke test in the GitHub Actions workflow. The unit tests focus on the
 * pure functions whose output directly determines what Luisa sees in Asana.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — no type declarations at test time
import { __test__, screenOneSubject } from '../scripts/scheduled-screening.ts';
import type { WatchlistEntry } from '@/services/screeningWatchlist';
import type { AdverseMediaHit } from '@/services/adverseMediaSearch';

const {
  buildAlertTaskName,
  buildAlertTaskNotes,
  buildHeartbeatTaskName,
  buildHeartbeatTaskNotes,
  buildIdentityContext,
  classifyHit,
} = __test__ as {
  buildAlertTaskName: (entry: WatchlistEntry, n: number) => string;
  buildAlertTaskNotes: (
    entry: WatchlistEntry,
    hits: readonly AdverseMediaHit[],
    runAt: string
  ) => string;
  buildHeartbeatTaskName: (runAtIso: string, total: number, alerts: number) => string;
  buildHeartbeatTaskNotes: (summary: {
    runAtIso: string;
    totalChecked: number;
    totalNewHits: number;
    subjectsWithAlerts: Array<{
      id: string;
      subjectName: string;
      newHitCount: number;
      asanaGid?: string;
    }>;
    subjectsWithErrors: Array<{ id: string; subjectName: string; error: string }>;
    subjectsClean: Array<{ id: string; subjectName: string }>;
  }) => string;
  buildIdentityContext: (entry: WatchlistEntry) => string[];
  classifyHit: (
    entry: WatchlistEntry,
    hit: AdverseMediaHit
  ) => {
    classification: 'alert' | 'possible' | 'suppress';
    composite: number;
    hasResolvedIdentity: boolean;
  };
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const entry = (overrides: Partial<WatchlistEntry> = {}): WatchlistEntry => ({
  id: 'CUST-001',
  subjectName: 'Acme Trading LLC',
  riskTier: 'high',
  addedAtIso: '2026-04-01T00:00:00Z',
  lastScreenedAtIso: '2026-04-12T06:00:00Z',
  seenHitFingerprints: [],
  alertCount: 0,
  metadata: { jurisdiction: 'AE' },
  ...overrides,
});

const hit = (id: string, overrides: Partial<AdverseMediaHit> = {}): AdverseMediaHit => ({
  title: `Acme indicted — story ${id}`,
  url: `https://reuters.com/article/${id}`,
  snippet: `Federal prosecutors charged Acme with money laundering on ${id}`,
  publishedAt: '2026-04-13',
  source: 'reuters.com',
  ...overrides,
});

// ---------------------------------------------------------------------------
// buildAlertTaskName — severity tagging based on hit count
// ---------------------------------------------------------------------------

describe('scheduled-screening — buildAlertTaskName', () => {
  it('tags 1 hit as MEDIUM', () => {
    const name = buildAlertTaskName(entry(), 1);
    expect(name).toContain('[MEDIUM]');
    expect(name).toContain('Acme Trading LLC');
    expect(name).toContain('1 new hit'); // singular
    expect(name).not.toContain('hits'); // ensure no plural
  });

  it('tags 2 hits as HIGH and uses plural "hits"', () => {
    const name = buildAlertTaskName(entry(), 2);
    expect(name).toContain('[HIGH]');
    expect(name).toContain('2 new hits');
  });

  it('tags 3+ hits as CRITICAL', () => {
    expect(buildAlertTaskName(entry(), 3)).toContain('[CRITICAL]');
    expect(buildAlertTaskName(entry(), 10)).toContain('[CRITICAL]');
  });

  it('includes the subject name verbatim', () => {
    const name = buildAlertTaskName(entry({ subjectName: 'Mohammed Al Rashid' }), 1);
    expect(name).toContain('Mohammed Al Rashid');
  });
});

// ---------------------------------------------------------------------------
// buildAlertTaskNotes — the body of the Asana task
// ---------------------------------------------------------------------------

describe('scheduled-screening — buildAlertTaskNotes', () => {
  it('includes entity name, watchlist id, and risk tier', () => {
    const notes = buildAlertTaskNotes(entry(), [hit('a')], '2026-04-13T06:00:00Z');
    expect(notes).toContain('Entity: Acme Trading LLC');
    expect(notes).toContain('Watchlist id: CUST-001');
    expect(notes).toContain('Risk tier: HIGH');
  });

  it('shows previous screening date when available', () => {
    const notes = buildAlertTaskNotes(entry(), [hit('a')], '2026-04-13T06:00:00Z');
    expect(notes).toContain('Previous screening: 2026-04-12T06:00:00Z');
  });

  it('marks first run when lastScreenedAtIso is undefined', () => {
    const notes = buildAlertTaskNotes(
      entry({ lastScreenedAtIso: undefined }),
      [hit('a')],
      '2026-04-13T06:00:00Z'
    );
    expect(notes).toContain('first run');
  });

  it('lists each new hit with title, URL, source, and snippet', () => {
    const hits = [hit('a'), hit('b'), hit('c')];
    const notes = buildAlertTaskNotes(entry(), hits, '2026-04-13T06:00:00Z');
    for (const h of hits) {
      expect(notes).toContain(h.title);
      expect(notes).toContain(h.url);
      expect(notes).toContain(h.source);
    }
  });

  it('truncates very long snippets to 300 chars', () => {
    const long = 'x'.repeat(1000);
    const notes = buildAlertTaskNotes(
      entry(),
      [hit('a', { snippet: long })],
      '2026-04-13T06:00:00Z'
    );
    // Count how many 'x' chars appear in the notes — should be <= 300
    const xCount = (notes.match(/x/g) ?? []).length;
    expect(xCount).toBeLessThanOrEqual(300);
  });

  it('includes the total alert count from the entry', () => {
    const notes = buildAlertTaskNotes(entry({ alertCount: 7 }), [hit('a')], '2026-04-13T06:00:00Z');
    expect(notes).toContain('Total alerts for this subject: 7');
  });

  it('recommends EDD + four-eyes for 3+ new hits', () => {
    const notes = buildAlertTaskNotes(
      entry(),
      [hit('a'), hit('b'), hit('c')],
      '2026-04-13T06:00:00Z'
    );
    expect(notes).toContain('EDD');
    expect(notes).toContain('four-eyes');
    expect(notes).toContain('Cabinet Res 134/2025 Art.14');
    expect(notes).toContain('FDL Art.26-27');
  });

  it('recommends enhanced MLRO review for 2 hits', () => {
    const notes = buildAlertTaskNotes(entry(), [hit('a'), hit('b')], '2026-04-13T06:00:00Z');
    expect(notes).toContain('Enhanced review by MLRO');
  });

  it('recommends review + document for 1 hit', () => {
    const notes = buildAlertTaskNotes(entry(), [hit('a')], '2026-04-13T06:00:00Z');
    expect(notes).toContain('Review and document');
  });

  it('includes regulatory citations footer', () => {
    const notes = buildAlertTaskNotes(entry(), [hit('a')], '2026-04-13T06:00:00Z');
    expect(notes).toContain('FATF Rec 10');
    expect(notes).toContain('Cabinet Res 134/2025 Art.14');
  });

  it('includes metadata in the JSON tail', () => {
    const notes = buildAlertTaskNotes(
      entry({ metadata: { customerId: 'CUST-001', jurisdiction: 'AE' } }),
      [hit('a')],
      '2026-04-13T06:00:00Z'
    );
    expect(notes).toContain('CUST-001');
    expect(notes).toContain('AE');
  });
});

// ---------------------------------------------------------------------------
// buildHeartbeatTaskName
// ---------------------------------------------------------------------------

describe('scheduled-screening — buildHeartbeatTaskName', () => {
  it('shows date + time + totals', () => {
    const name = buildHeartbeatTaskName('2026-04-13T06:00:00Z', 47, 3);
    expect(name).toContain('2026-04-13');
    expect(name).toContain('06:00');
    expect(name).toContain('47 checked');
    expect(name).toContain('3 alerts');
  });

  it('uses singular "alert" when count is 1', () => {
    const name = buildHeartbeatTaskName('2026-04-13T14:00:00Z', 10, 1);
    expect(name).toContain('1 alert');
    expect(name).not.toContain('1 alerts');
  });

  it('uses "0 alerts" on clean days', () => {
    const name = buildHeartbeatTaskName('2026-04-13T14:00:00Z', 10, 0);
    expect(name).toContain('0 alerts');
  });
});

// ---------------------------------------------------------------------------
// buildHeartbeatTaskNotes — the summary body
// ---------------------------------------------------------------------------

describe('scheduled-screening — buildHeartbeatTaskNotes', () => {
  const summaryBase = {
    runAtIso: '2026-04-13T06:00:00Z',
    totalChecked: 47,
    totalNewHits: 0,
    subjectsWithAlerts: [],
    subjectsWithErrors: [],
    subjectsClean: [],
  };

  it('includes run header with totals', () => {
    const notes = buildHeartbeatTaskNotes(summaryBase);
    expect(notes).toContain('2026-04-13T06:00:00Z');
    expect(notes).toContain('Subjects checked: 47');
    expect(notes).toContain('New alerts fired: 0');
    expect(notes).toContain('Total new hits across all subjects: 0');
  });

  it('lists subjects with new hits and their Asana GIDs', () => {
    const notes = buildHeartbeatTaskNotes({
      ...summaryBase,
      totalNewHits: 4,
      subjectsWithAlerts: [
        { id: 'c1', subjectName: 'Acme', newHitCount: 2, asanaGid: 'gid-123' },
        { id: 'c2', subjectName: 'Beta Corp', newHitCount: 1, asanaGid: 'gid-456' },
      ],
    });
    expect(notes).toContain('SUBJECTS WITH NEW HITS');
    expect(notes).toContain('Acme — 2 new hits');
    expect(notes).toContain('gid-123');
    expect(notes).toContain('Beta Corp — 1 new hit');
    expect(notes).toContain('gid-456');
  });

  it('omits Asana GID label when gid is "dry-run"', () => {
    const notes = buildHeartbeatTaskNotes({
      ...summaryBase,
      subjectsWithAlerts: [{ id: 'c1', subjectName: 'Acme', newHitCount: 1, asanaGid: 'dry-run' }],
    });
    expect(notes).not.toContain('(task: dry-run)');
  });

  it('lists subjects with search errors separately', () => {
    const notes = buildHeartbeatTaskNotes({
      ...summaryBase,
      subjectsWithErrors: [
        { id: 'c1', subjectName: 'Acme', error: 'searchAdverseMedia failed: timeout' },
      ],
    });
    expect(notes).toContain('SUBJECTS WITH SEARCH ERRORS');
    expect(notes).toContain('Acme');
    expect(notes).toContain('timeout');
  });

  it('lists clean subjects (≤ 50) inline', () => {
    const notes = buildHeartbeatTaskNotes({
      ...summaryBase,
      subjectsClean: [
        { id: 'c1', subjectName: 'Clean Co A' },
        { id: 'c2', subjectName: 'Clean Co B' },
      ],
    });
    expect(notes).toContain('Clean subjects (no new hits): 2');
    expect(notes).toContain('Clean Co A');
    expect(notes).toContain('Clean Co B');
  });

  it('omits the per-subject list when clean count exceeds 50', () => {
    const subjectsClean = Array.from({ length: 60 }, (_, i) => ({
      id: `c${i}`,
      subjectName: `Clean ${i}`,
    }));
    const notes = buildHeartbeatTaskNotes({ ...summaryBase, subjectsClean });
    expect(notes).toContain('Clean subjects (no new hits): 60');
    expect(notes).toContain('list omitted');
    expect(notes).not.toContain('Clean 0');
  });

  it('always includes the regulatory basis footer', () => {
    const notes = buildHeartbeatTaskNotes(summaryBase);
    expect(notes).toContain('FATF Rec 10');
    expect(notes).toContain('Cabinet Res 134/2025 Art.19');
  });
});

// ---------------------------------------------------------------------------
// buildIdentityContext — pinned vs unresolved
// ---------------------------------------------------------------------------

describe('scheduled-screening — buildIdentityContext', () => {
  it('warns when the entry has no resolvedIdentity', () => {
    const block = buildIdentityContext(entry()).join('\n');
    expect(block).toContain('UNRESOLVED');
    expect(block).toContain('NAME only');
    expect(block).toContain('Pin the identity');
  });

  it('summarises pinned identity facets when resolved', () => {
    const block = buildIdentityContext(
      entry({
        subjectName: 'Mohamed Ahmed',
        resolvedIdentity: {
          dob: '12/03/1982',
          nationality: 'AE',
          idType: 'emirates_id',
          idNumber: '784-1982-1234567-1',
          aliases: ['Mohammed A. Al-Marri'],
          listEntryRef: { list: 'UN-1267', reference: 'QDi.123' },
          resolvedAtIso: '2026-04-10T08:00:00Z',
          resolvedBy: 'MLRO',
        },
      })
    ).join('\n');
    expect(block).toContain('pinned');
    expect(block).toContain('DoB 12/03/1982');
    expect(block).toContain('Nationality AE');
    expect(block).toContain('784-1982-1234567-1');
    expect(block).toContain('Aliases: Mohammed A. Al-Marri');
    expect(block).toContain('UN-1267');
    expect(block).toContain('QDi.123');
    expect(block).toContain('Resolved by MLRO');
  });
});

describe('scheduled-screening — classifyHit', () => {
  it('flags unresolved subjects so the MLRO knows to pin', () => {
    const result = classifyHit(entry(), hit('a'));
    expect(result.hasResolvedIdentity).toBe(false);
  });

  it('uses the pinned identity when available', () => {
    const result = classifyHit(
      entry({
        subjectName: 'Mohamed Ahmed',
        resolvedIdentity: { dob: '12/03/1982', nationality: 'AE' },
      }),
      hit('a', { title: 'Mohamed Ahmed arrested in Dubai' })
    );
    expect(result.hasResolvedIdentity).toBe(true);
    // Adverse-media hits have no DoB / nationality metadata, so the
    // composite is name-only and stays below the alert band.
    expect(result.classification).not.toBe('alert');
  });
});

describe('scheduled-screening — buildAlertTaskNotes identity integration', () => {
  it('emits the UNRESOLVED warning in the task body when identity is absent', () => {
    const notes = buildAlertTaskNotes(entry(), [hit('a')], '2026-04-13T06:00:00Z');
    expect(notes).toContain('SUBJECT IDENTITY');
    expect(notes).toContain('UNRESOLVED');
    expect(notes).toContain('relevance name-only');
  });

  it('emits a pinned identity summary when the subject is resolved', () => {
    const notes = buildAlertTaskNotes(
      entry({
        subjectName: 'Mohamed Ahmed',
        resolvedIdentity: { dob: '12/03/1982', nationality: 'AE' },
      }),
      [hit('a', { title: 'Mohamed Ahmed charged' })],
      '2026-04-13T06:00:00Z'
    );
    expect(notes).toContain('SUBJECT IDENTITY (pinned)');
    expect(notes).toContain('DoB 12/03/1982');
    expect(notes).toContain('Nationality AE');
    expect(notes).toMatch(/relevance (alert|possible|suppress)/);
  });
});

// ---------------------------------------------------------------------------
// screenOneSubject — in offline mode
// ---------------------------------------------------------------------------

describe('scheduled-screening — screenOneSubject (offline)', () => {
  it('returns empty new hits when offline mode is set', async () => {
    const result = await screenOneSubject(entry(), {
      brainUrl: 'https://example.com',
      brainToken: 'x',
      asanaToken: 'x',
      asanaProjectGid: 'x',
      asanaWorkspaceGid: 'x',
      asanaAssigneeName: 'Luisa',
      dryRun: false,
      offline: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.newHits).toHaveLength(0);
  });
});
