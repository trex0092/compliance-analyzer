/**
 * Tests for the dispatch audit log. Exercises the pure readers
 * + the summarizer. Writes go through localStorage, which
 * vitest polyfills via the jsdom-style shim in node (or we
 * accept they're no-ops).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordDispatch,
  readAuditLog,
  clearAuditLog,
  summarizeAuditLog,
  exportAuditLog,
} from '@/services/dispatchAuditLog';

// Polyfill localStorage for node test runs.
beforeEach(() => {
  const storage = new Map<string, string>();
  const shim = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
    key: (i: number) => Array.from(storage.keys())[i] ?? null,
    get length() {
      return storage.size;
    },
  };
  (globalThis as { localStorage?: Storage }).localStorage = shim as unknown as Storage;
  clearAuditLog();
});

describe('recordDispatch + readAuditLog', () => {
  it('records an entry and reads it back', () => {
    const entry = recordDispatch({
      caseId: 'case-1',
      verdict: 'freeze',
      confidence: 0.9,
      suggestedColumn: 'blocked',
      trigger: 'manual',
      atIso: '2026-04-13T12:00:00.000Z',
    });
    expect(entry.id).toContain('case-1');
    const log = readAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0].verdict).toBe('freeze');
  });

  it('filters by caseId', () => {
    recordDispatch({
      caseId: 'case-1',
      verdict: 'freeze',
      confidence: 0.9,
      suggestedColumn: 'blocked',
      atIso: '2026-04-13T12:00:00.000Z',
    });
    recordDispatch({
      caseId: 'case-2',
      verdict: 'pass',
      confidence: 0.8,
      suggestedColumn: 'done',
      atIso: '2026-04-13T13:00:00.000Z',
    });
    const filtered = readAuditLog({ caseId: 'case-1' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].caseId).toBe('case-1');
  });

  it('filters by verdict', () => {
    recordDispatch({
      caseId: 'c1',
      verdict: 'freeze',
      confidence: 0.9,
      suggestedColumn: 'blocked',
      atIso: '2026-04-13T12:00:00.000Z',
    });
    recordDispatch({
      caseId: 'c2',
      verdict: 'pass',
      confidence: 0.8,
      suggestedColumn: 'done',
      atIso: '2026-04-13T13:00:00.000Z',
    });
    expect(readAuditLog({ verdict: 'freeze' })).toHaveLength(1);
  });

  it('limits result count', () => {
    for (let i = 0; i < 5; i++) {
      recordDispatch({
        caseId: `c${i}`,
        verdict: 'pass',
        confidence: 0.8,
        suggestedColumn: 'done',
        atIso: `2026-04-13T${String(i).padStart(2, '0')}:00:00.000Z`,
      });
    }
    expect(readAuditLog({ limit: 3 })).toHaveLength(3);
  });

  it('dedupes by id on re-record', () => {
    recordDispatch({
      caseId: 'c1',
      verdict: 'pass',
      confidence: 0.8,
      suggestedColumn: 'done',
      atIso: '2026-04-13T12:00:00.000Z',
    });
    recordDispatch({
      caseId: 'c1',
      verdict: 'flag',
      confidence: 0.7,
      suggestedColumn: 'doing',
      atIso: '2026-04-13T12:00:00.000Z',
    });
    const log = readAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0].verdict).toBe('flag');
  });
});

describe('summarizeAuditLog', () => {
  it('counts by verdict and recency', () => {
    const nowIso = '2026-04-13T12:00:00.000Z';
    recordDispatch({
      caseId: 'c1',
      verdict: 'freeze',
      confidence: 0.9,
      suggestedColumn: 'blocked',
      atIso: nowIso,
    });
    recordDispatch({
      caseId: 'c2',
      verdict: 'pass',
      confidence: 0.8,
      suggestedColumn: 'done',
      atIso: nowIso,
    });
    const summary = summarizeAuditLog(nowIso);
    expect(summary.total).toBe(2);
    expect(summary.byVerdict.freeze).toBe(1);
    expect(summary.byVerdict.pass).toBe(1);
    expect(summary.last24h).toBe(2);
  });

  it('reports errorsLast24h based on entries with non-empty errors', () => {
    const nowIso = '2026-04-13T12:00:00.000Z';
    recordDispatch({
      caseId: 'c1',
      verdict: 'freeze',
      confidence: 0.9,
      suggestedColumn: 'blocked',
      atIso: nowIso,
      errors: ['Asana rejected'],
    });
    expect(summarizeAuditLog(nowIso).errorsLast24h).toBe(1);
  });
});

describe('exportAuditLog', () => {
  it('returns a structured export', () => {
    recordDispatch({
      caseId: 'c1',
      verdict: 'pass',
      confidence: 0.8,
      suggestedColumn: 'done',
      atIso: '2026-04-13T12:00:00.000Z',
    });
    const exported = exportAuditLog();
    expect(exported.entries).toHaveLength(1);
    expect(exported.exportedAtIso).toBeDefined();
  });
});
