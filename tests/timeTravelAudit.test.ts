import { describe, it, expect } from 'vitest';
import {
  replayUntil,
  currentState,
  diffSnapshots,
  historyFor,
  criticalPath,
  formatAuditReport,
  type EvidenceEntry,
} from '@/services/timeTravelAudit';

const entries: EvidenceEntry[] = [
  {
    at: '2026-01-01T10:00:00Z',
    action: 'cra_created',
    actor: 'co',
    subject: 'CRA-001',
    detail: 'Initial CRA',
    data: { status: 'draft', riskScore: 30 },
  },
  {
    at: '2026-01-05T14:00:00Z',
    action: 'cra_updated',
    actor: 'co',
    subject: 'CRA-001',
    detail: 'Risk score revised',
    data: { riskScore: 45 },
  },
  {
    at: '2026-01-10T09:00:00Z',
    action: 'cra_approved',
    actor: 'mlro',
    subject: 'CRA-001',
    detail: 'Board approval',
    data: { status: 'approved', approvedBy: 'mlro' },
  },
  {
    at: '2026-01-15T12:00:00Z',
    action: 'note_added',
    actor: 'co',
    subject: 'CRA-001',
    detail: 'Added internal note',
    // No data payload
  },
  {
    at: '2026-01-20T08:00:00Z',
    action: 'cra_created',
    actor: 'co',
    subject: 'CRA-002',
    detail: 'Different case',
    data: { status: 'draft', riskScore: 10 },
  },
];

describe('replayUntil', () => {
  it('returns empty state for a ref with no entries', () => {
    const snap = replayUntil(entries, 'CRA-999', '2026-12-31');
    expect(snap.contributingEntries).toBe(0);
    expect(snap.state).toEqual({});
  });

  it('replays one entry correctly', () => {
    const snap = replayUntil(entries, 'CRA-001', '2026-01-01T12:00:00Z');
    expect(snap.state.status).toBe('draft');
    expect(snap.state.riskScore).toBe(30);
    expect(snap.contributingEntries).toBe(1);
  });

  it('folds multiple entries chronologically', () => {
    const snap = replayUntil(entries, 'CRA-001', '2026-01-05T15:00:00Z');
    expect(snap.state.riskScore).toBe(45); // updated
    expect(snap.state.status).toBe('draft'); // unchanged
  });

  it('shows approved status after the approval entry', () => {
    const snap = replayUntil(entries, 'CRA-001', '2026-01-10T10:00:00Z');
    expect(snap.state.status).toBe('approved');
    expect(snap.state.approvedBy).toBe('mlro');
    expect(snap.state.riskScore).toBe(45);
  });

  it('excludes entries past the asOf date', () => {
    const snap = replayUntil(entries, 'CRA-001', '2026-01-03T00:00:00Z');
    // Only the initial creation entry is in scope
    expect(snap.state.riskScore).toBe(30);
    expect(snap.state.status).toBe('draft');
    expect(snap.state.approvedBy).toBeUndefined();
  });

  it('handles entries without data (action log only)', () => {
    const snap = replayUntil(entries, 'CRA-001', '2026-02-01');
    expect(snap.actions).toContain('note_added');
    // note_added did not change state
    expect(snap.state.approvedBy).toBe('mlro');
  });
});

describe('currentState', () => {
  it('replays all entries up to now', () => {
    const snap = currentState(entries, 'CRA-001');
    expect(snap.state.status).toBe('approved');
  });
});

describe('diffSnapshots', () => {
  it('detects added fields', () => {
    const before = replayUntil(entries, 'CRA-001', '2026-01-02');
    const after = replayUntil(entries, 'CRA-001', '2026-01-11');
    const diff = diffSnapshots(before, after);
    expect(diff.added.approvedBy).toBe('mlro');
  });

  it('detects changed fields', () => {
    const before = replayUntil(entries, 'CRA-001', '2026-01-02');
    const after = replayUntil(entries, 'CRA-001', '2026-01-06');
    const diff = diffSnapshots(before, after);
    const riskChange = diff.changed.find((c) => c.field === 'riskScore');
    expect(riskChange).toBeDefined();
    expect(riskChange?.before).toBe(30);
    expect(riskChange?.after).toBe(45);
  });

  it('detects nothing changed for identical snapshots', () => {
    const a = replayUntil(entries, 'CRA-001', '2026-01-12');
    const b = replayUntil(entries, 'CRA-001', '2026-01-13');
    const diff = diffSnapshots(a, b);
    expect(Object.keys(diff.added)).toHaveLength(0);
    expect(Object.keys(diff.removed)).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });
});

describe('historyFor', () => {
  it('returns only entries for the requested ref', () => {
    const hist = historyFor(entries, 'CRA-001');
    expect(hist.every((e) => e.subject === 'CRA-001')).toBe(true);
    expect(hist).toHaveLength(4);
  });

  it('returns entries in chronological order', () => {
    const hist = historyFor(entries, 'CRA-001');
    for (let i = 1; i < hist.length; i++) {
      expect(hist[i - 1].at.localeCompare(hist[i].at)).toBeLessThanOrEqual(0);
    }
  });
});

describe('criticalPath', () => {
  it('excludes entries without a data payload', () => {
    const path = criticalPath(entries, 'CRA-001');
    expect(path.every((e) => e.data !== undefined)).toBe(true);
    expect(path).toHaveLength(3); // excluding note_added
  });
});

describe('formatAuditReport', () => {
  it('produces a markdown document with timeline and state', () => {
    const md = formatAuditReport(entries, 'CRA-001', '2026-02-01');
    expect(md).toContain('# Time-Travel Audit Report — CRA-001');
    expect(md).toContain('## State at this point');
    expect(md).toContain('## Timeline');
    expect(md).toContain('cra_created');
    expect(md).toContain('cra_approved');
  });
});
