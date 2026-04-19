import { describe, it, expect } from 'vitest';
import {
  computeCorroboration,
  corroborationForSubject,
} from '../src/services/multiListCorroboration';

function fp(subjectId: string, list: string, ref = 'R1', change = 'NEW', day = '2026-04-19') {
  return [subjectId, list, ref, change, day].join('|');
}

describe('computeCorroboration', () => {
  it('returns boost=0 for a subject on a single list', () => {
    const map = computeCorroboration(new Set([fp('CUS-1', 'UN')]));
    const c = map.get('CUS-1');
    expect(c?.boost).toBe(0);
    expect(c?.lists).toEqual(['UN']);
    expect(c?.dispatchCount).toBe(1);
  });

  it('boosts climbing with list count (0 → 0.25 → 0.50 → 0.70 → 0.85)', () => {
    const oneList = computeCorroboration(new Set([fp('CUS-1', 'UN')])).get('CUS-1');
    const twoLists = computeCorroboration(
      new Set([fp('CUS-2', 'UN'), fp('CUS-2', 'OFAC_SDN')])
    ).get('CUS-2');
    const threeLists = computeCorroboration(
      new Set([fp('CUS-3', 'UN'), fp('CUS-3', 'OFAC_SDN'), fp('CUS-3', 'EU')])
    ).get('CUS-3');
    const fourLists = computeCorroboration(
      new Set([fp('CUS-4', 'UN'), fp('CUS-4', 'OFAC_SDN'), fp('CUS-4', 'EU'), fp('CUS-4', 'UK')])
    ).get('CUS-4');
    const fiveLists = computeCorroboration(
      new Set([
        fp('CUS-5', 'UN'),
        fp('CUS-5', 'OFAC_SDN'),
        fp('CUS-5', 'EU'),
        fp('CUS-5', 'UK'),
        fp('CUS-5', 'UAE_EOCN'),
      ])
    ).get('CUS-5');

    expect(oneList?.boost).toBe(0);
    expect(twoLists?.boost).toBe(0.25);
    expect(threeLists?.boost).toBe(0.5);
    expect(fourLists?.boost).toBe(0.7);
    expect(fiveLists?.boost).toBe(0.85);
  });

  it('sorts lists by the published priority (UN > OFAC_SDN > EU > UK > UAE_EOCN)', () => {
    const c = computeCorroboration(
      new Set([fp('CUS-X', 'UK'), fp('CUS-X', 'EU'), fp('CUS-X', 'UN'), fp('CUS-X', 'OFAC_SDN')])
    ).get('CUS-X');
    expect(c?.lists).toEqual(['UN', 'OFAC_SDN', 'EU', 'UK']);
  });

  it('counts total dispatches (not distinct lists) for dispatchCount', () => {
    const c = computeCorroboration(
      new Set([fp('CUS-9', 'UN', 'R1'), fp('CUS-9', 'UN', 'R2'), fp('CUS-9', 'OFAC_SDN', 'R3')])
    ).get('CUS-9');
    expect(c?.lists).toEqual(['UN', 'OFAC_SDN']);
    expect(c?.dispatchCount).toBe(3);
  });

  it('skips malformed fingerprints silently', () => {
    const map = computeCorroboration(
      new Set([
        'not|enough|parts',
        '|UN|R|NEW|2026-04-19', // empty subjectId
        'CUS-1||R|NEW|2026-04-19', // empty list
        fp('CUS-1', 'UN'),
      ])
    );
    expect(map.size).toBe(1);
    expect(map.get('CUS-1')?.lists).toEqual(['UN']);
  });
});

describe('corroborationForSubject', () => {
  it('returns a zero record when the subject is missing from the map', () => {
    const map = computeCorroboration(new Set([fp('OTHER', 'UN')]));
    const c = corroborationForSubject(map, 'CUS-1');
    expect(c.lists).toEqual([]);
    expect(c.dispatchCount).toBe(0);
    expect(c.boost).toBe(0);
  });

  it('returns the stored record when present', () => {
    const map = computeCorroboration(new Set([fp('CUS-1', 'UN'), fp('CUS-1', 'OFAC_SDN')]));
    const c = corroborationForSubject(map, 'CUS-1');
    expect(c.lists).toEqual(['UN', 'OFAC_SDN']);
    expect(c.boost).toBe(0.25);
  });
});
