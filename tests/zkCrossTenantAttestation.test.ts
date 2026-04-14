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

  it('detects a cross-tenant collision', () => {
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
    expect(r.collisions).toHaveLength(1);
    expect(r.collisions[0]!.tenantIds).toEqual(['tenant-a', 'tenant-b']);
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
    const r = aggregateCrossTenantCommitments([a, b]);
    expect(r.collisions).toHaveLength(0);
  });

  it('carries the regulatory citations', () => {
    const r = aggregateCrossTenantCommitments([]);
    expect(r.regulatory).toContain('FDL No.10/2025 Art.14');
    expect(r.regulatory).toContain('FDL No.10/2025 Art.29');
    expect(r.regulatory).toContain('FATF Rec 2');
    expect(r.regulatory).toContain('EU GDPR Art.25');
  });
});
