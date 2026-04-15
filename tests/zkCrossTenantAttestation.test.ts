/**
 * zk cross-tenant attestation tests.
 */
import { describe, it, expect } from 'vitest';
import {
  commitCrossTenantObservation,
  aggregateCrossTenantCommitments,
  __test__,
  type CrossTenantObservation,
} from '../src/services/zkCrossTenantAttestation';

const { preimage } = __test__;

const sharedSalt = 'fiu-circular-salt-2026';
const saltVersion = 'v1';
const fixedNow = () => new Date('2026-04-14T12:00:00.000Z');

function obs(overrides: Partial<CrossTenantObservation> = {}): CrossTenantObservation {
  return {
    subjectKey: 'hash-abcdef',
    tsDay: '2026-04-14',
    listName: 'UN',
    ...overrides,
  };
}

describe('preimage', () => {
  it('is domain-separated', () => {
    expect(preimage(obs(), saltVersion, sharedSalt)).toMatch(/^zk-cross-tenant-v1\|/);
  });
  it('quotes subjectKey to guard against injection', () => {
    expect(preimage(obs({ subjectKey: 'a|b' }), saltVersion, sharedSalt)).toMatch(/"a\|b"/);
  });
});

describe('commitCrossTenantObservation', () => {
  it('produces identical hashes for identical observations under the same salt', () => {
    const a = commitCrossTenantObservation(obs(), {
      tenantId: 'tenant-a',
      saltVersion,
      sharedSalt,
      now: fixedNow,
    });
    const b = commitCrossTenantObservation(obs(), {
      tenantId: 'tenant-b',
      saltVersion,
      sharedSalt,
      now: fixedNow,
    });
    expect(a.commitHash).toBe(b.commitHash);
  });

  it('produces different hashes for different subjects', () => {
    const a = commitCrossTenantObservation(obs({ subjectKey: 'A' }), {
      tenantId: 'tenant-a',
      saltVersion,
      sharedSalt,
    });
    const b = commitCrossTenantObservation(obs({ subjectKey: 'B' }), {
      tenantId: 'tenant-b',
      saltVersion,
      sharedSalt,
    });
    expect(a.commitHash).not.toBe(b.commitHash);
  });

  it('salt version flip breaks the collision', () => {
    const a = commitCrossTenantObservation(obs(), {
      tenantId: 'tenant-a',
      saltVersion: 'v1',
      sharedSalt,
    });
    const b = commitCrossTenantObservation(obs(), {
      tenantId: 'tenant-b',
      saltVersion: 'v2',
      sharedSalt,
    });
    expect(a.commitHash).not.toBe(b.commitHash);
  });

  it('hash length is 128 hex chars (sha3-512)', () => {
    const c = commitCrossTenantObservation(obs(), {
      tenantId: 'tenant-a',
      saltVersion,
      sharedSalt,
    });
    expect(c.commitHash.length).toBe(128);
  });
});

describe('aggregateCrossTenantCommitments', () => {
  it('empty input yields zero collisions', () => {
    const r = aggregateCrossTenantCommitments([]);
    expect(r.totalCommitments).toBe(0);
    expect(r.collisions).toHaveLength(0);
  });

  it('detects a 2-tenant collision when k=2 is explicitly requested', () => {
    const a = commitCrossTenantObservation(obs(), {
      tenantId: 'tenant-a',
      saltVersion,
      sharedSalt,
    });
    const b = commitCrossTenantObservation(obs(), {
      tenantId: 'tenant-b',
      saltVersion,
      sharedSalt,
    });
    const r = aggregateCrossTenantCommitments([a, b], { kAnonymity: 2 });
    expect(r.collisions).toHaveLength(1);
    expect(r.collisions[0]!.tenantIds).toEqual(['tenant-a', 'tenant-b']);
    expect(r.collisions[0]!.tenantCount).toBe(2);
    expect(r.kAnonymity).toBe(2);
    expect(r.suppressedBelowK).toBe(0);
  });

  it('suppresses 2-tenant collisions at default k=3 (re-identification safety)', () => {
    const a = commitCrossTenantObservation(obs(), {
      tenantId: 'tenant-a',
      saltVersion,
      sharedSalt,
    });
    const b = commitCrossTenantObservation(obs(), {
      tenantId: 'tenant-b',
      saltVersion,
      sharedSalt,
    });
    const r = aggregateCrossTenantCommitments([a, b]);
    // Default k=3 means a 2-tenant overlap is below threshold and
    // is reported only as a suppressed-bucket count, never with
    // tenant identities.
    expect(r.collisions).toHaveLength(0);
    expect(r.suppressedBelowK).toBe(1);
    expect(r.kAnonymity).toBe(3);
  });

  it('reveals a 3-tenant collision at default k=3', () => {
    const a = commitCrossTenantObservation(obs(), {
      tenantId: 'tenant-a',
      saltVersion,
      sharedSalt,
    });
    const b = commitCrossTenantObservation(obs(), {
      tenantId: 'tenant-b',
      saltVersion,
      sharedSalt,
    });
    const c = commitCrossTenantObservation(obs(), {
      tenantId: 'tenant-c',
      saltVersion,
      sharedSalt,
    });
    const r = aggregateCrossTenantCommitments([a, b, c]);
    expect(r.collisions).toHaveLength(1);
    expect(r.collisions[0]!.tenantCount).toBe(3);
    expect(r.suppressedBelowK).toBe(0);
  });

  it('clamps requested k below the safety floor up to MIN_K_ANONYMITY (=2)', () => {
    const a = commitCrossTenantObservation(obs(), {
      tenantId: 'tenant-a',
      saltVersion,
      sharedSalt,
    });
    const b = commitCrossTenantObservation(obs(), {
      tenantId: 'tenant-b',
      saltVersion,
      sharedSalt,
    });
    // Caller asks for k=1 — the aggregator silently raises it to 2.
    const r = aggregateCrossTenantCommitments([a, b], { kAnonymity: 1 });
    expect(r.kAnonymity).toBe(2);
    expect(r.collisions).toHaveLength(1);
  });

  it('does not flag single-tenant duplicates as cross-tenant', () => {
    const a = commitCrossTenantObservation(obs(), {
      tenantId: 'tenant-a',
      saltVersion,
      sharedSalt,
    });
    const b = commitCrossTenantObservation(obs(), {
      tenantId: 'tenant-a',
      saltVersion,
      sharedSalt,
    });
    const r = aggregateCrossTenantCommitments([a, b], { kAnonymity: 2 });
    expect(r.collisions).toHaveLength(0);
    expect(r.suppressedBelowK).toBe(0);
  });

  it('carries the regulatory citations', () => {
    const r = aggregateCrossTenantCommitments([]);
    expect(r.regulatory).toContain('FDL No.10/2025 Art.14');
    expect(r.regulatory).toContain('FDL No.10/2025 Art.29');
    expect(r.regulatory).toContain('FATF Rec 2');
    expect(r.regulatory).toContain('EU GDPR Art.25');
  });
});
