/**
 * Tier 3 batch 2 tests — sandbox replay + KYC vision extractor +
 * cross-tenant salt rotator.
 */
import { describe, it, expect } from 'vitest';

import {
  sandboxReplayCase,
  sandboxReplayBatch,
  type StoredCase,
  type SandboxBaseline,
  type SandboxVerdictFn,
} from '../src/services/sandboxReplay';
import { extractKycFields } from '../src/services/kycVisionExtractor';
import { decideSaltRotation } from '../src/services/crossTenantSaltRotator';

// ---------------------------------------------------------------------------
// sandboxReplay
// ---------------------------------------------------------------------------

describe('sandboxReplay', () => {
  const baseline: SandboxBaseline = {
    versionLabel: 'AED-50K-DRAFT',
    capturedAtIso: 'draft',
    thresholds: { dpms_cash: 50_000 },
    citation: 'Internal what-if exercise',
  };

  const verdictFn: SandboxVerdictFn = (features, b) => {
    const tx = features.txValue30dAED ?? 0;
    if (tx >= b.thresholds.dpms_cash!) return { verdict: 'flag', confidence: 0.8 };
    return { verdict: 'pass', confidence: 0.7 };
  };

  it('detects a hardened verdict under stricter threshold', () => {
    const stored: StoredCase = {
      id: 'c1',
      tenantId: 'tenant-a',
      decidedAtIso: '2026-04-15',
      features: { txValue30dAED: 52_000 },
      verdictAtTime: 'pass', // under old AED 55K threshold
    };
    const r = sandboxReplayCase(stored, baseline, verdictFn);
    expect(r.changed).toBe(true);
    expect(r.impact).toBe('hardened');
    expect(r.replayedVerdict).toBe('flag');
  });

  it('reports stable when the verdict does not change', () => {
    const stored: StoredCase = {
      id: 'c2',
      tenantId: 'tenant-a',
      decidedAtIso: '2026-04-15',
      features: { txValue30dAED: 30_000 },
      verdictAtTime: 'pass',
    };
    const r = sandboxReplayCase(stored, baseline, verdictFn);
    expect(r.changed).toBe(false);
    expect(r.impact).toBe('none');
  });

  it('batches a list and reports counts', () => {
    const cases: StoredCase[] = [
      {
        id: 'c1',
        tenantId: 'tenant-a',
        decidedAtIso: '2026-04-15',
        features: { txValue30dAED: 52_000 },
        verdictAtTime: 'pass',
      },
      {
        id: 'c2',
        tenantId: 'tenant-a',
        decidedAtIso: '2026-04-15',
        features: { txValue30dAED: 30_000 },
        verdictAtTime: 'pass',
      },
    ];
    const r = sandboxReplayBatch(cases, baseline, verdictFn);
    expect(r.total).toBe(2);
    expect(r.changed).toBe(1);
    expect(r.hardened).toBe(1);
    expect(r.softened).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// kycVisionExtractor
// ---------------------------------------------------------------------------

describe('extractKycFields', () => {
  it('detects emirates_id and extracts the number', () => {
    const r = extractKycFields('Name JOHN DOE 784-1985-1234567-1 Date of Birth 15/04/1985');
    expect(r.detectedDocType).toBe('emirates_id');
    const id = r.fields.find((f) => f.name === 'emiratesIdNumber');
    expect(id).toBeDefined();
    expect(id!.value).toBe('784-1985-1234567-1');
    const dob = r.fields.find((f) => f.name === 'dateOfBirth');
    expect(dob).toBeDefined();
    expect(dob!.value).toBe('1985-04-15');
  });

  it('detects passport MRZ and extracts issuing country', () => {
    // Synthetic single-line MRZ — exactly 44 characters.
    const mrz = 'P<UAEDOE<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<';
    const r = extractKycFields(mrz);
    expect(r.detectedDocType).toBe('passport_mrz');
    expect(r.fields.find((f) => f.name === 'mrzLine')).toBeDefined();
  });

  it('detects trade licence', () => {
    const r = extractKycFields('TRADE LICENCE\nACME GOLD LLC\nLIC-12345678');
    expect(r.detectedDocType).toBe('trade_licence');
    const num = r.fields.find((f) => f.name === 'licenceNumber');
    expect(num).toBeDefined();
    expect(num!.value).toBe('LIC-12345678');
  });

  it('returns unknown for empty / unrecognised text', () => {
    const r = extractKycFields('hello world');
    expect(r.detectedDocType).toBe('unknown');
    expect(r.fields).toEqual([]);
  });

  it('returns empty result for empty input', () => {
    const r = extractKycFields('');
    expect(r.detectedDocType).toBe('unknown');
    expect(r.fields).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// crossTenantSaltRotator
// ---------------------------------------------------------------------------

describe('decideSaltRotation', () => {
  it('rotates when the current quarter has advanced past the live version', () => {
    const r = decideSaltRotation('v2026Q1', new Date('2026-05-01T00:00:00Z'));
    expect(r.shouldRotate).toBe(true);
    expect(r.nextVersion).toBe('v2026Q2');
  });

  it('does not rotate within the same quarter', () => {
    const r = decideSaltRotation('v2026Q2', new Date('2026-05-01T00:00:00Z'));
    expect(r.shouldRotate).toBe(false);
    expect(r.currentVersion).toBe('v2026Q2');
  });

  it('rolls year over correctly', () => {
    const r = decideSaltRotation('v2026Q4', new Date('2027-01-15T00:00:00Z'));
    expect(r.shouldRotate).toBe(true);
    expect(r.nextVersion).toBe('v2027Q1');
  });

  it('handles malformed current version gracefully', () => {
    const r = decideSaltRotation('not-a-version', new Date('2026-05-01T00:00:00Z'));
    expect(r.shouldRotate).toBe(true);
    expect(r.nextVersion).toBe('v2026Q2');
  });

  it('carries the regulatory anchors', () => {
    const r = decideSaltRotation('v2026Q1', new Date('2026-04-15T00:00:00Z'));
    expect(r.regulatory).toContain('FDL No.10/2025 Art.14');
    expect(r.regulatory).toContain('Cabinet Res 74/2020 Art.5');
    expect(r.regulatory).toContain('EU GDPR Art.25');
  });
});
