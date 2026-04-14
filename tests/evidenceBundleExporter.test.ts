/**
 * Evidence bundle exporter tests.
 */
import { describe, it, expect } from 'vitest';
import {
  exportEvidenceBundle,
  verifyEvidenceBundleIntegrity,
  __test__,
  type EvidenceBundleLoaders,
  type EvidenceBundle,
} from '../src/services/evidenceBundleExporter';
import type { ReplayCase } from '../src/services/caseReplayStore';
import type { BrainTelemetryEntry } from '../src/services/brainTelemetryStore';
import { captureRegulatoryBaseline } from '../src/services/regulatoryDriftWatchdog';

const { canonicalStringify, pickTelemetry, dayOf } = __test__;

// ---------------------------------------------------------------------------
// canonicalStringify
// ---------------------------------------------------------------------------

describe('canonicalStringify', () => {
  it('sorts object keys deterministically', () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalStringify({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });
  it('serialises arrays in order', () => {
    expect(canonicalStringify([3, 1, 2])).toBe('[3,1,2]');
  });
  it('nested objects sort per level', () => {
    const a = canonicalStringify({ x: { b: 1, a: 2 }, y: 3 });
    const b = canonicalStringify({ y: 3, x: { a: 2, b: 1 } });
    expect(a).toBe(b);
  });
  it('drops NaN + Infinity to null', () => {
    expect(canonicalStringify(NaN)).toBe('null');
    expect(canonicalStringify(Infinity)).toBe('null');
  });
  it('serialises strings with JSON.stringify escaping', () => {
    expect(canonicalStringify('a"b')).toBe('"a\\"b"');
  });
  it('serialises null/undefined as null', () => {
    expect(canonicalStringify(null)).toBe('null');
    expect(canonicalStringify(undefined)).toBe('null');
  });
});

// ---------------------------------------------------------------------------
// dayOf
// ---------------------------------------------------------------------------

describe('dayOf', () => {
  it('extracts YYYY-MM-DD from full iso', () => {
    expect(dayOf('2026-04-14T12:34:56.000Z')).toBe('2026-04-14');
  });
  it('passes through already-truncated day strings', () => {
    expect(dayOf('2026-04-14')).toBe('2026-04-14');
  });
  it('returns empty for non-strings', () => {
    expect(dayOf(null as unknown as string)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function sampleReplay(overrides: Partial<ReplayCase> = {}): ReplayCase {
  return {
    schemaVersion: 1,
    tenantId: 'tA',
    caseId: 'case-1',
    snapshot: {
      caseId: 'case-1',
      tenantId: 'tA',
      openedAt: '2026-04-14T12:00:00.000Z',
      entityRef: 'opaque-1',
      maxTxAED: 50_000,
    },
    // Use captureRegulatoryBaseline to pick up every tracked
    // constant — otherwise checkRegulatoryDrift reports the missing
    // keys as "new tracked constant" findings, which would make the
    // "stable" assertions flap whenever a new constant is added.
    baselineAtTime: captureRegulatoryBaseline(new Date('2026-04-14T12:00:00.000Z')),
    verdictAtTime: 'flag',
    confidenceAtTime: 0.8,
    powerScoreAtTime: 55,
    decidedAtIso: '2026-04-14T12:00:00.000Z',
    ...overrides,
  };
}

function sampleTelemetry(overrides: Partial<BrainTelemetryEntry> = {}): BrainTelemetryEntry {
  return {
    tsIso: '2026-04-14T12:00:00.000Z',
    tenantId: 'tA',
    entityRef: 'opaque-1',
    verdict: 'flag',
    confidence: 0.8,
    powerScore: 55,
    brainVerdict: 'flag',
    ensembleUnstable: false,
    typologyIds: [],
    crossCaseFindingCount: 0,
    velocitySeverity: null,
    driftSeverity: 'none',
    requiresHumanReview: false,
    ...overrides,
  };
}

function fakeLoaders(
  replay: ReplayCase | null,
  telemetry: BrainTelemetryEntry[]
): EvidenceBundleLoaders {
  return {
    loadReplayCase: async () => replay,
    loadTelemetryForDay: async () => telemetry,
  };
}

// ---------------------------------------------------------------------------
// pickTelemetry
// ---------------------------------------------------------------------------

describe('pickTelemetry', () => {
  it('returns the exact (tsIso, entityRef) match when present', () => {
    const replay = sampleReplay();
    const entries = [
      sampleTelemetry({ tsIso: '2026-04-14T11:00:00.000Z', entityRef: 'opaque-1' }),
      sampleTelemetry(),
      sampleTelemetry({ tsIso: '2026-04-14T13:00:00.000Z', entityRef: 'opaque-1' }),
    ];
    const picked = pickTelemetry(entries, replay);
    expect(picked?.tsIso).toBe('2026-04-14T12:00:00.000Z');
  });

  it('falls back to closest tsIso for same entityRef when no exact match', () => {
    const replay = sampleReplay({ decidedAtIso: '2026-04-14T12:00:00.000Z' });
    const entries = [
      sampleTelemetry({ tsIso: '2026-04-14T10:00:00.000Z' }),
      sampleTelemetry({ tsIso: '2026-04-14T11:30:00.000Z' }),
      sampleTelemetry({ tsIso: '2026-04-14T13:00:00.000Z' }),
    ];
    const picked = pickTelemetry(entries, replay);
    expect(picked?.tsIso).toBe('2026-04-14T11:30:00.000Z');
  });

  it('returns null when no entry shares the entityRef', () => {
    const replay = sampleReplay();
    const entries = [sampleTelemetry({ entityRef: 'other' })];
    expect(pickTelemetry(entries, replay)).toBeNull();
  });

  it('returns null on empty array', () => {
    expect(pickTelemetry([], sampleReplay())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// exportEvidenceBundle
// ---------------------------------------------------------------------------

describe('exportEvidenceBundle', () => {
  const fixedNow = () => new Date('2026-04-14T13:00:00.000Z');

  it('returns not_found when no replay tuple exists', async () => {
    const loaders = fakeLoaders(null, []);
    const bundle = await exportEvidenceBundle('tA', 'missing', loaders, fixedNow);
    expect(bundle.conclusion).toBe('not_found');
    expect(bundle.replay).toBeNull();
    expect(bundle.telemetry).toBeNull();
    expect(bundle.drift).toBeNull();
    expect(bundle.integrity.algorithm).toBe('sha3-512');
    expect(bundle.integrity.hashHex.length).toBe(128); // sha3-512 hex
  });

  it('returns incomplete when replay exists but telemetry does not', async () => {
    const replay = sampleReplay();
    const loaders = fakeLoaders(replay, []);
    const bundle = await exportEvidenceBundle('tA', 'case-1', loaders, fixedNow);
    expect(bundle.conclusion).toBe('incomplete');
    expect(bundle.replay).not.toBeNull();
    expect(bundle.telemetry).toBeNull();
    expect(bundle.drift).not.toBeNull();
    expect(bundle.drift?.clean).toBe(true);
  });

  it('returns stable when replay + telemetry present and drift clean', async () => {
    const replay = sampleReplay();
    const telemetry = [sampleTelemetry()];
    const loaders = fakeLoaders(replay, telemetry);
    const bundle = await exportEvidenceBundle('tA', 'case-1', loaders, fixedNow);
    expect(bundle.conclusion).toBe('stable');
    expect(bundle.telemetry).not.toBeNull();
    expect(bundle.drift?.clean).toBe(true);
    expect(bundle.summary).toMatch(/still holds/);
  });

  it('returns review_recommended when drift has high-severity findings', async () => {
    // Construct an old baseline so checkRegulatoryDrift detects real
    // drift without having to mutate constants.ts in the test.
    const replay = sampleReplay({
      baselineAtTime: {
        version: 'v0-old',
        capturedAtIso: '2025-01-01T00:00:00.000Z',
        values: {
          DPMS_CASH_THRESHOLD_AED: 70_000,
          CROSS_BORDER_CASH_THRESHOLD_AED: 90_000,
        },
      },
    });
    const telemetry = [sampleTelemetry()];
    const loaders = fakeLoaders(replay, telemetry);
    const bundle = await exportEvidenceBundle('tA', 'case-1', loaders, fixedNow);
    expect(bundle.conclusion).toBe('review_recommended');
    expect(bundle.drift?.findings.length).toBeGreaterThan(0);
  });

  it('embeds the canonical regulatory citations', async () => {
    const loaders = fakeLoaders(sampleReplay(), [sampleTelemetry()]);
    const bundle = await exportEvidenceBundle('tA', 'case-1', loaders, fixedNow);
    expect(bundle.citations).toContain('FDL No.10/2025 Art.24');
    expect(bundle.citations).toContain('FDL No.10/2025 Art.29');
    expect(bundle.citations).toContain('Cabinet Res 134/2025 Art.19');
    expect(bundle.citations).toContain('NIST AI RMF 1.0 MANAGE-2');
    expect(bundle.citations).toContain('FATF Rec 11');
  });

  it('swallows loader failures and returns a not_found bundle', async () => {
    const loaders: EvidenceBundleLoaders = {
      loadReplayCase: async () => {
        throw new Error('boom');
      },
      loadTelemetryForDay: async () => [],
    };
    const bundle = await exportEvidenceBundle('tA', 'case-1', loaders, fixedNow);
    expect(bundle.conclusion).toBe('not_found');
  });

  it('telemetry loader failure degrades to incomplete', async () => {
    const replay = sampleReplay();
    const loaders: EvidenceBundleLoaders = {
      loadReplayCase: async () => replay,
      loadTelemetryForDay: async () => {
        throw new Error('telemetry-boom');
      },
    };
    const bundle = await exportEvidenceBundle('tA', 'case-1', loaders, fixedNow);
    expect(bundle.conclusion).toBe('incomplete');
    expect(bundle.drift).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integrity hash round-trip
// ---------------------------------------------------------------------------

describe('verifyEvidenceBundleIntegrity', () => {
  const fixedNow = () => new Date('2026-04-14T13:00:00.000Z');

  it('verifies a freshly-produced bundle', async () => {
    const loaders = fakeLoaders(sampleReplay(), [sampleTelemetry()]);
    const bundle = await exportEvidenceBundle('tA', 'case-1', loaders, fixedNow);
    expect(verifyEvidenceBundleIntegrity(bundle)).toBe(true);
  });

  it('detects tampering in any field', async () => {
    const loaders = fakeLoaders(sampleReplay(), [sampleTelemetry()]);
    const bundle = await exportEvidenceBundle('tA', 'case-1', loaders, fixedNow);
    const tampered: EvidenceBundle = {
      ...bundle,
      summary: 'totally different summary',
    };
    expect(verifyEvidenceBundleIntegrity(tampered)).toBe(false);
  });

  it('detects tampering in the conclusion field', async () => {
    const loaders = fakeLoaders(sampleReplay(), [sampleTelemetry()]);
    const bundle = await exportEvidenceBundle('tA', 'case-1', loaders, fixedNow);
    const tampered: EvidenceBundle = { ...bundle, conclusion: 'stable' };
    // Changing conclusion from 'stable' back to 'stable' (no change)
    // should STILL verify. Pick a real mutation.
    if (tampered.conclusion === bundle.conclusion) {
      tampered.conclusion = 'verdict_may_change';
    }
    expect(verifyEvidenceBundleIntegrity(tampered)).toBe(false);
  });

  it('rejects bundles with the wrong algorithm', async () => {
    const loaders = fakeLoaders(sampleReplay(), [sampleTelemetry()]);
    const bundle = await exportEvidenceBundle('tA', 'case-1', loaders, fixedNow);
    const wrongAlgo = {
      ...bundle,
      integrity: { ...bundle.integrity, algorithm: 'md5' as 'sha3-512' },
    };
    expect(verifyEvidenceBundleIntegrity(wrongAlgo as EvidenceBundle)).toBe(false);
  });

  it('rejects bundles with the wrong preimage prefix', async () => {
    const loaders = fakeLoaders(sampleReplay(), [sampleTelemetry()]);
    const bundle = await exportEvidenceBundle('tA', 'case-1', loaders, fixedNow);
    const wrongPrefix = {
      ...bundle,
      integrity: {
        ...bundle.integrity,
        preimagePrefix: 'other-prefix' as 'evidence-bundle-v1',
      },
    };
    expect(verifyEvidenceBundleIntegrity(wrongPrefix as EvidenceBundle)).toBe(false);
  });

  it('produces deterministic hashes for identical inputs', async () => {
    const loaders = fakeLoaders(sampleReplay(), [sampleTelemetry()]);
    const a = await exportEvidenceBundle('tA', 'case-1', loaders, fixedNow);
    const b = await exportEvidenceBundle('tA', 'case-1', loaders, fixedNow);
    expect(a.integrity.hashHex).toBe(b.integrity.hashHex);
  });
});
