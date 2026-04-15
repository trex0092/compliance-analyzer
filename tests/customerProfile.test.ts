/**
 * Tests for src/domain/customerProfile.ts — pure helpers + constants.
 */
import { describe, expect, it } from 'vitest';
import {
  PERIODIC_REVIEW_MONTHS,
  RECORD_RETENTION_YEARS,
  UBO_OWNERSHIP_THRESHOLD_PERCENT,
  UBO_REVERIFICATION_WORKING_DAYS,
  addMonths,
  addYears,
  computeNextReviewDue,
  computeRetentionUntil,
  daysBetween,
  extractUbos,
  formatDdMmYyyy,
  isShareholderUbo,
  parseDdMmYyyy,
  type ShareholderRecord,
} from '../src/domain/customerProfile';

describe('regulatory constants', () => {
  it('UBO threshold matches Cabinet Decision 109/2023', () => {
    expect(UBO_OWNERSHIP_THRESHOLD_PERCENT).toBe(25);
  });
  it('UBO re-verification window matches Cabinet Decision 109/2023', () => {
    expect(UBO_REVERIFICATION_WORKING_DAYS).toBe(15);
  });
  it('record retention matches FDL Art.24', () => {
    expect(RECORD_RETENTION_YEARS).toBe(10);
  });
  it('periodic review cadence per tier', () => {
    expect(PERIODIC_REVIEW_MONTHS.low).toBe(12);
    expect(PERIODIC_REVIEW_MONTHS.medium).toBe(6);
    expect(PERIODIC_REVIEW_MONTHS.high).toBe(3);
  });
});

describe('parseDdMmYyyy', () => {
  it('parses a valid dd/mm/yyyy date', () => {
    const d = parseDdMmYyyy('15/04/2026');
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2026);
    expect(d!.getUTCMonth()).toBe(3); // April = index 3
    expect(d!.getUTCDate()).toBe(15);
  });
  it('parses a single-digit day/month', () => {
    const d = parseDdMmYyyy('5/4/2026');
    expect(d).not.toBeNull();
    expect(d!.getUTCDate()).toBe(5);
    expect(d!.getUTCMonth()).toBe(3);
  });
  it('rejects month > 12', () => {
    expect(parseDdMmYyyy('01/13/2026')).toBeNull();
  });
  it('rejects day > 31', () => {
    expect(parseDdMmYyyy('32/01/2026')).toBeNull();
  });
  it('rejects 31/02/2026 (February never has 31 days)', () => {
    expect(parseDdMmYyyy('31/02/2026')).toBeNull();
  });
  it('rejects 30/02/2026', () => {
    expect(parseDdMmYyyy('30/02/2026')).toBeNull();
  });
  it('accepts 29/02/2024 (leap year)', () => {
    const d = parseDdMmYyyy('29/02/2024');
    expect(d).not.toBeNull();
  });
  it('rejects 29/02/2026 (non-leap year)', () => {
    expect(parseDdMmYyyy('29/02/2026')).toBeNull();
  });
  it('rejects ISO format', () => {
    expect(parseDdMmYyyy('2026-04-15')).toBeNull();
  });
  it('rejects text', () => {
    expect(parseDdMmYyyy('tomorrow')).toBeNull();
  });
  it('rejects undefined/null/empty', () => {
    expect(parseDdMmYyyy(undefined)).toBeNull();
    expect(parseDdMmYyyy(null)).toBeNull();
    expect(parseDdMmYyyy('')).toBeNull();
  });
  it('rejects wrong separator', () => {
    expect(parseDdMmYyyy('15-04-2026')).toBeNull();
  });
  it('rejects 2-digit year', () => {
    expect(parseDdMmYyyy('15/04/26')).toBeNull();
  });
});

describe('formatDdMmYyyy', () => {
  it('formats with zero-padding', () => {
    const d = new Date(Date.UTC(2026, 3, 5)); // 5 April 2026
    expect(formatDdMmYyyy(d)).toBe('05/04/2026');
  });
  it('round-trips with parseDdMmYyyy', () => {
    const original = '15/04/2026';
    const parsed = parseDdMmYyyy(original);
    expect(parsed).not.toBeNull();
    expect(formatDdMmYyyy(parsed!)).toBe(original);
  });
});

describe('daysBetween', () => {
  it('returns 0 for the same instant', () => {
    const d = new Date(Date.UTC(2026, 0, 1));
    expect(daysBetween(d, d)).toBe(0);
  });
  it('returns positive for a future target', () => {
    const a = new Date(Date.UTC(2026, 0, 1));
    const b = new Date(Date.UTC(2026, 0, 11));
    expect(daysBetween(a, b)).toBe(10);
  });
  it('returns negative for a past target', () => {
    const a = new Date(Date.UTC(2026, 0, 11));
    const b = new Date(Date.UTC(2026, 0, 1));
    expect(daysBetween(a, b)).toBe(-10);
  });
});

describe('addYears', () => {
  it('adds 10 years correctly (retention)', () => {
    const d = new Date(Date.UTC(2026, 3, 15));
    const d2 = addYears(d, 10);
    expect(d2.getUTCFullYear()).toBe(2036);
    expect(d2.getUTCMonth()).toBe(3);
    expect(d2.getUTCDate()).toBe(15);
  });
});

describe('addMonths', () => {
  it('adds 6 months from April', () => {
    const d = new Date(Date.UTC(2026, 3, 15));
    const d2 = addMonths(d, 6);
    expect(d2.getUTCMonth()).toBe(9); // October
    expect(d2.getUTCDate()).toBe(15);
  });
  it('handles month-end clamp correctly (31 Jan + 1mo = 28 Feb)', () => {
    const d = new Date(Date.UTC(2026, 0, 31));
    const d2 = addMonths(d, 1);
    expect(d2.getUTCMonth()).toBe(1); // February
    expect(d2.getUTCDate()).toBe(28); // Feb 2026 has 28 days
  });
});

describe('isShareholderUbo', () => {
  function makeShareholder(percent: number): ShareholderRecord {
    return {
      id: 's1',
      type: 'natural',
      fullName: 'Test',
      ownershipPercent: percent,
      pepCheckStatus: 'clear',
      sanctionsCheckStatus: 'clear',
      adverseMediaCheckStatus: 'clear',
    };
  }
  it('classifies 25% exactly as UBO (boundary)', () => {
    expect(isShareholderUbo(makeShareholder(25))).toBe(true);
  });
  it('classifies 24.99% as non-UBO', () => {
    expect(isShareholderUbo(makeShareholder(24.99))).toBe(false);
  });
  it('classifies 50% as UBO', () => {
    expect(isShareholderUbo(makeShareholder(50))).toBe(true);
  });
  it('classifies 0% as non-UBO', () => {
    expect(isShareholderUbo(makeShareholder(0))).toBe(false);
  });
});

describe('extractUbos', () => {
  it('returns only UBOs from a mixed list', () => {
    const shareholders: ShareholderRecord[] = [
      {
        id: 'a',
        type: 'natural',
        fullName: 'Alice',
        ownershipPercent: 60,
        pepCheckStatus: 'clear',
        sanctionsCheckStatus: 'clear',
        adverseMediaCheckStatus: 'clear',
      },
      {
        id: 'b',
        type: 'natural',
        fullName: 'Bob',
        ownershipPercent: 20,
        pepCheckStatus: 'clear',
        sanctionsCheckStatus: 'clear',
        adverseMediaCheckStatus: 'clear',
      },
      {
        id: 'c',
        type: 'natural',
        fullName: 'Carol',
        ownershipPercent: 20,
        pepCheckStatus: 'clear',
        sanctionsCheckStatus: 'clear',
        adverseMediaCheckStatus: 'clear',
      },
    ];
    const ubos = extractUbos(shareholders);
    expect(ubos).toHaveLength(1);
    expect(ubos[0]!.id).toBe('a');
  });
});

describe('computeNextReviewDue', () => {
  it('high-risk → 3 months', () => {
    const base = new Date(Date.UTC(2026, 0, 15));
    const next = computeNextReviewDue(base, 'high');
    expect(next.getUTCMonth()).toBe(3); // April
  });
  it('medium → 6 months', () => {
    const base = new Date(Date.UTC(2026, 0, 15));
    const next = computeNextReviewDue(base, 'medium');
    expect(next.getUTCMonth()).toBe(6); // July
  });
  it('low → 12 months', () => {
    const base = new Date(Date.UTC(2026, 0, 15));
    const next = computeNextReviewDue(base, 'low');
    expect(next.getUTCFullYear()).toBe(2027);
    expect(next.getUTCMonth()).toBe(0);
  });
});

describe('computeRetentionUntil', () => {
  it('createdAt + 10 years', () => {
    const created = new Date(Date.UTC(2026, 3, 15));
    const retention = computeRetentionUntil(created);
    expect(retention.getUTCFullYear()).toBe(2036);
  });
});
