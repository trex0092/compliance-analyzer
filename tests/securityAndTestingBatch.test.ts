/**
 * Security + privacy + testing/validation batch tests — GDPR SAR
 * export, consent store, TOTP 2FA, session manager, chaos injector,
 * replay-from-log, load test harness.
 */
import { describe, it, expect } from 'vitest';

import {
  buildSarBundle,
  verifySarBundle,
  type SarDataSource,
} from '../src/services/gdprSubjectAccessExport';

import {
  grantConsent,
  withdrawConsent,
  listActiveConsent,
  hasActiveConsent,
  DEFAULT_PURPOSES,
  type ConsentSnapshot,
} from '../src/services/consentStore';

import {
  generateTotp,
  validateTotp,
  decodeBase32,
  __test__ as totpInternals,
} from '../src/services/totp2faEnforcer';

import {
  createSession,
  revokeSession,
  revokeAllForUser,
  listActiveSessions,
  isSessionValid,
  pruneSessions,
  emptySessionSnapshot,
} from '../src/services/sessionManager';

import {
  buildChaosState,
  rollInjection,
  shouldInject,
  faultResponseFor,
  emptyChaosState,
  type ChaosRule,
} from '../src/services/chaosInjector';

import {
  parseLogLine,
  extractCaseInput,
  replayFromLogLine,
} from '../src/services/replayFromLog';

import {
  runLoadTest,
  percentile,
} from '../src/services/loadTestHarness';

// ===========================================================================
// gdprSubjectAccessExport
// ===========================================================================

describe('gdprSubjectAccessExport', () => {
  const baseSources: SarDataSource[] = [
    { storeId: 'customers', records: [{ id: 'c1', name: 'Alice' }] },
    {
      storeId: 'cases',
      records: [{ caseId: 'ca-1', verdict: 'pass' }],
      investigationExclusions: [{ caseId: 'ca-secret', verdict: 'freeze' }],
    },
  ];

  it('builds a sealed bundle', () => {
    const bundle = buildSarBundle(
      {
        subjectId: 'c1',
        tenantId: 'tenant-a',
        handledByUserId: 'mlro-1',
        receivedAtIso: '2026-04-15T00:00:00Z',
      },
      baseSources,
      () => new Date('2026-04-15T10:00:00Z')
    );
    expect(bundle.stores.length).toBe(2);
    expect(bundle.excludedRecordCount).toBe(1);
    expect(bundle.exclusionNotice).toMatch(/active investigation/);
    expect(bundle.integrity.hashHex.length).toBe(128);
    expect(bundle.regulatory).toContain('EU GDPR Art.15');
    expect(bundle.regulatory).toContain('FDL No.10/2025 Art.29');
  });

  it('verifies a clean bundle', () => {
    const bundle = buildSarBundle(
      {
        subjectId: 'c1',
        tenantId: 'tenant-a',
        handledByUserId: 'mlro-1',
        receivedAtIso: '2026-04-15T00:00:00Z',
      },
      baseSources
    );
    expect(verifySarBundle(bundle)).toBe(true);
  });

  it('detects tampering', () => {
    const bundle = buildSarBundle(
      {
        subjectId: 'c1',
        tenantId: 'tenant-a',
        handledByUserId: 'mlro-1',
        receivedAtIso: '2026-04-15T00:00:00Z',
      },
      baseSources
    );
    const tampered = { ...bundle, subjectId: 'EVIL' };
    expect(verifySarBundle(tampered)).toBe(false);
  });

  it('rejects missing required fields', () => {
    expect(() =>
      buildSarBundle(
        {
          subjectId: '',
          tenantId: 'tenant-a',
          handledByUserId: 'mlro-1',
          receivedAtIso: '2026-04-15T00:00:00Z',
        },
        []
      )
    ).toThrow();
  });
});

// ===========================================================================
// consentStore
// ===========================================================================

describe('consentStore', () => {
  const empty: ConsentSnapshot = { records: [] };
  const common = {
    tenantId: 'tenant-a',
    subjectId: 'subject-1',
    noticeVersion: 'v2026-Q1',
    reason: 'initial consent at onboarding',
  };

  it('grantConsent appends a record', () => {
    const s = grantConsent(empty, {
      ...common,
      purpose: 'marketing',
      now: () => new Date('2026-04-15T00:00:00Z'),
    });
    expect(s.records.length).toBe(1);
    expect(s.records[0]!.status).toBe('granted');
    expect(s.records[0]!.lawfulBasis).toBe('consent');
  });

  it('withdrawConsent flips status', () => {
    const s1 = grantConsent(empty, { ...common, purpose: 'marketing' });
    const s2 = withdrawConsent(s1, {
      tenantId: 'tenant-a',
      subjectId: 'subject-1',
      purpose: 'marketing',
      reason: 'customer requested withdrawal',
    });
    expect(s2.records.some((r) => r.status === 'withdrawn')).toBe(true);
  });

  it('grant supersedes prior grant on same (subject, purpose)', () => {
    const s1 = grantConsent(empty, { ...common, purpose: 'marketing' });
    const s2 = grantConsent(s1, {
      ...common,
      purpose: 'marketing',
      noticeVersion: 'v2026-Q2',
    });
    expect(s2.records.filter((r) => r.status === 'superseded').length).toBe(1);
    expect(s2.records.filter((r) => r.status === 'granted').length).toBe(1);
  });

  it('listActiveConsent filters by subject + tenant', () => {
    const s = grantConsent(empty, { ...common, purpose: 'marketing' });
    const active = listActiveConsent(s, 'subject-1', 'tenant-a');
    expect(active.length).toBe(1);
  });

  it('hasActiveConsent is true for granted purpose', () => {
    const s = grantConsent(empty, { ...common, purpose: 'analytics' });
    expect(hasActiveConsent(s, 'subject-1', 'tenant-a', 'analytics')).toBe(true);
    expect(hasActiveConsent(s, 'subject-1', 'tenant-a', 'marketing')).toBe(false);
  });

  it('default lawful basis is legal_obligation for aml_screening', () => {
    expect(DEFAULT_PURPOSES.aml_screening.lawfulBasisDefault).toBe('legal_obligation');
  });

  it('rejects short reason', () => {
    expect(() =>
      grantConsent(empty, { ...common, purpose: 'marketing', reason: 'xy' })
    ).toThrow();
  });
});

// ===========================================================================
// totp2faEnforcer
// ===========================================================================

describe('totp2faEnforcer', () => {
  const secret = 'JBSWY3DPEHPK3PXP'; // RFC 6238 test-vector-ish

  it('decodeBase32 decodes a known value', () => {
    const out = decodeBase32('JBSWY3DPEHPK3PXP');
    expect(out.length).toBeGreaterThan(0);
  });

  it('decodeBase32 rejects invalid characters', () => {
    expect(() => decodeBase32('JBSW!Y3DP')).toThrow();
  });

  it('generates a 6-digit code', async () => {
    const code = await generateTotp(secret, 1700000000);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('validateTotp accepts a self-generated code', async () => {
    const t = 1700000000;
    const code = await generateTotp(secret, t);
    const r = await validateTotp({ secretBase32: secret, code, nowSeconds: t });
    expect(r.ok).toBe(true);
    expect(r.matchedStepOffset).toBe(0);
  });

  it('validateTotp accepts a code within drift window', async () => {
    const t = 1700000000;
    const code = await generateTotp(secret, t);
    // Validate it at the next step (30s later) — should still match with drift=1
    const r = await validateTotp({ secretBase32: secret, code, nowSeconds: t + 30 });
    expect(r.ok).toBe(true);
    expect(r.matchedStepOffset).toBe(-1);
  });

  it('validateTotp rejects a wrong code', async () => {
    const r = await validateTotp({
      secretBase32: secret,
      code: '000000',
      nowSeconds: 1700000000,
    });
    expect(r.ok).toBe(false);
  });

  it('validateTotp rejects non-digit code', async () => {
    const r = await validateTotp({
      secretBase32: secret,
      code: 'abcdef',
      nowSeconds: 1700000000,
    });
    expect(r.ok).toBe(false);
  });

  it('timingSafeEqual returns false on length mismatch', () => {
    expect(totpInternals.timingSafeEqual('123456', '1234567')).toBe(false);
  });

  it('encodeCounter encodes big-endian 8-byte', () => {
    const b = totpInternals.encodeCounter(1);
    expect(b.length).toBe(8);
    expect(b[7]).toBe(1);
  });
});

// ===========================================================================
// sessionManager
// ===========================================================================

describe('sessionManager', () => {
  const common = {
    userId: 'user-1',
    tenantId: 'tenant-a',
    ipAddress: '10.0.0.1',
    userAgent: 'test',
    ttlSeconds: 3600,
    now: () => new Date('2026-04-15T12:00:00Z'),
  };

  it('createSession appends a new session', () => {
    const { snapshot, session } = createSession(emptySessionSnapshot(), common);
    expect(snapshot.sessions.length).toBe(1);
    expect(session.userId).toBe('user-1');
    expect(session.expiresAtIso).toBe('2026-04-15T13:00:00.000Z');
  });

  it('isSessionValid returns true for a fresh session', () => {
    const { snapshot, session } = createSession(emptySessionSnapshot(), common);
    expect(
      isSessionValid(snapshot, session.id, () => new Date('2026-04-15T12:30:00Z'))
    ).toBe(true);
  });

  it('isSessionValid returns false after expiry', () => {
    const { snapshot, session } = createSession(emptySessionSnapshot(), common);
    expect(
      isSessionValid(snapshot, session.id, () => new Date('2026-04-15T14:00:00Z'))
    ).toBe(false);
  });

  it('revokeSession blocks future validity', () => {
    const { snapshot: s1, session } = createSession(emptySessionSnapshot(), common);
    const s2 = revokeSession(s1, {
      sessionId: session.id,
      reason: 'lost laptop',
    });
    expect(isSessionValid(s2, session.id, () => new Date('2026-04-15T12:30:00Z'))).toBe(false);
  });

  it('revokeAllForUser kills every session for the user', () => {
    let s = emptySessionSnapshot();
    s = createSession(s, common).snapshot;
    s = createSession(s, common).snapshot;
    expect(listActiveSessions(s, { userId: 'user-1' }, () => new Date('2026-04-15T12:30:00Z'))).toHaveLength(2);
    s = revokeAllForUser(s, 'user-1', 'security rotation');
    expect(listActiveSessions(s, { userId: 'user-1' }, () => new Date('2026-04-15T12:30:00Z'))).toHaveLength(0);
  });

  it('revokeSession rejects short reason', () => {
    const { snapshot, session } = createSession(emptySessionSnapshot(), common);
    expect(() =>
      revokeSession(snapshot, { sessionId: session.id, reason: 'xy' })
    ).toThrow();
  });

  it('pruneSessions removes ancient expired records', () => {
    let s = emptySessionSnapshot();
    s = createSession(s, common).snapshot;
    const pruned = pruneSessions(s, 60, () => new Date('2027-04-15T12:00:00Z'));
    expect(pruned.sessions.length).toBe(0);
  });
});

// ===========================================================================
// chaosInjector
// ===========================================================================

describe('chaosInjector', () => {
  const sampleRules: ChaosRule[] = [
    {
      id: 'r1',
      subsystem: 'asana',
      fault: 'http_503',
      probability: 0.5,
      reason: 'simulate Asana outage',
    },
    {
      id: 'r2',
      subsystem: 'blob-store',
      fault: 'timeout',
      probability: 1.0,
      reason: 'simulate blob timeout',
    },
  ];

  it('disabled state returns fire=false always', () => {
    const state = emptyChaosState();
    const r = rollInjection(state, 'asana', 0);
    expect(r.fire).toBe(false);
    expect(r.reason).toMatch(/disabled/);
  });

  it('buildChaosState reads env var', () => {
    const on = buildChaosState({ enabledRaw: 'true', rules: sampleRules, seed: 42 });
    expect(on.enabled).toBe(true);
    const off = buildChaosState({ enabledRaw: undefined, rules: sampleRules, seed: 42 });
    expect(off.enabled).toBe(false);
  });

  it('probability=1 always fires', () => {
    const state = buildChaosState({ enabledRaw: 'true', rules: sampleRules, seed: 1 });
    const r = rollInjection(state, 'blob-store', 0);
    expect(r.fire).toBe(true);
    expect(r.rule?.id).toBe('r2');
  });

  it('shouldInject with deterministic rng is reproducible', () => {
    const state = buildChaosState({ enabledRaw: 'true', rules: sampleRules, seed: 1 });
    const rng1 = () => 0.1;
    const rng2 = () => 0.1;
    const a = shouldInject(state, 'asana', rng1);
    const b = shouldInject(state, 'asana', rng2);
    expect(a.fire).toBe(b.fire);
  });

  it('faultResponseFor maps fault → HTTP status', () => {
    expect(faultResponseFor(sampleRules[0]!).status).toBe(503);
    expect(faultResponseFor(sampleRules[1]!).status).toBe(504);
  });
});

// ===========================================================================
// replayFromLog
// ===========================================================================

describe('replayFromLog', () => {
  const sampleLine =
    '[2026-04-15T12:00:00Z] ' +
    JSON.stringify({
      tsIso: '2026-04-15T12:00:00Z',
      type: 'brain-analyze',
      tenantId: 'tenant-a',
      entityId: 'ent-1',
      features: { txValue30dAED: 70000, cashRatio30d: 0.8 },
      verdict: 'flag',
    });

  it('parseLogLine extracts the JSON payload', () => {
    const line = parseLogLine(sampleLine);
    expect(line.type).toBe('brain-analyze');
    expect(line.parsed).not.toBeNull();
  });

  it('extractCaseInput builds a typed case', () => {
    const line = parseLogLine(sampleLine);
    const c = extractCaseInput(line);
    expect(c).not.toBeNull();
    expect(c!.tenantId).toBe('tenant-a');
    expect(c!.expectedVerdict).toBe('flag');
    expect(c!.features.txValue30dAED).toBe(70000);
  });

  it('replayFromLogLine compares original vs replayed', async () => {
    const result = await replayFromLogLine(sampleLine, () => ({
      verdict: 'flag',
      confidence: 0.8,
    }));
    expect(result).not.toBeNull();
    expect(result!.match).toBe(true);
    expect(result!.drift).toBeNull();
  });

  it('replay flags drift when verdict changes', async () => {
    const result = await replayFromLogLine(sampleLine, () => ({
      verdict: 'freeze',
      confidence: 0.9,
    }));
    expect(result!.match).toBe(false);
    expect(result!.drift).toMatch(/flag.*freeze/);
  });

  it('parseLogLine rejects non-JSON lines', () => {
    const line = parseLogLine('plain old text');
    expect(line.parseError).toMatch(/no JSON/);
  });
});

// ===========================================================================
// loadTestHarness
// ===========================================================================

describe('loadTestHarness', () => {
  const cases = Array.from({ length: 20 }, (_, i) => ({
    id: `case-${i}`,
    features: { x: i },
  }));

  it('runs a clean load test', async () => {
    const r = await runLoadTest(cases, async () => ({ ok: true, latencyMs: 10 }));
    expect(r.completedCases).toBe(20);
    expect(r.successfulCases).toBe(20);
    expect(r.latency.p50).toBe(10);
  });

  it('captures failures', async () => {
    const r = await runLoadTest(cases, async (c) => ({
      ok: c.id !== 'case-5',
      latencyMs: 10,
      errorMessage: c.id === 'case-5' ? 'boom' : undefined,
    }));
    expect(r.failedCases).toBe(1);
    expect(r.errors.some((e) => e.caseId === 'case-5')).toBe(true);
  });

  it('handles thrown errors', async () => {
    const r = await runLoadTest(
      [cases[0]!],
      async () => {
        throw new Error('network reset');
      }
    );
    expect(r.failedCases).toBe(1);
    expect(r.errors[0]!.message).toMatch(/network reset/);
  });

  it('percentile helper returns correct p95', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 50)).toBe(5);
    expect(percentile(sorted, 95)).toBe(10);
  });

  it('percentile on empty returns 0', () => {
    expect(percentile([], 50)).toBe(0);
  });
});
