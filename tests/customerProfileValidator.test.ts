/**
 * Tests for src/services/customerProfileValidator.ts.
 */
import { describe, expect, it } from 'vitest';
import type {
  CustomerProfileV2,
  ManagerRecord,
  ShareholderRecord,
} from '../src/domain/customerProfile';
import {
  isExpired,
  isInFuture,
  isValidCountryCode,
  isValidEmiratesId,
  validateCustomerProfile,
} from '../src/services/customerProfileValidator';

const TODAY = new Date(Date.UTC(2026, 3, 15)); // 15 April 2026

function makeValidProfile(): CustomerProfileV2 {
  const manager: ManagerRecord = {
    id: 'mgr-1',
    fullName: 'Ahmed Al Falasi',
    role: 'mlro',
    dateOfBirth: '01/01/1980',
    nationality: 'AE',
    emiratesIdNumber: '784-1980-1234567-1',
    emiratesIdExpiry: '01/01/2030',
    passportNumber: 'A12345678',
    passportCountry: 'AE',
    passportExpiry: '01/01/2030',
    appointmentDate: '01/01/2024',
    isSanctionsAuthority: true,
    isStrFilingAuthority: true,
    pepCheckStatus: 'clear',
    sanctionsCheckStatus: 'clear',
    adverseMediaCheckStatus: 'clear',
  };
  const co: ManagerRecord = {
    ...manager,
    id: 'mgr-2',
    role: 'co',
    fullName: 'Fatima Al Mansoori',
    emiratesIdNumber: '784-1985-7654321-2',
  };
  const shareholder: ShareholderRecord = {
    id: 'sh-1',
    type: 'natural',
    fullName: 'Sheikh Holder',
    ownershipPercent: 60,
    dateOfBirth: '01/01/1970',
    nationality: 'AE',
    emiratesIdNumber: '784-1970-1111111-1',
    emiratesIdExpiry: '01/01/2030',
    uboVerifiedAt: '01/01/2026',
    pepCheckStatus: 'clear',
    sanctionsCheckStatus: 'clear',
    adverseMediaCheckStatus: 'clear',
    evidenceAttachments: [
      {
        blobKey: 'evidence/sh-1-eid.pdf',
        filename: 'eid.pdf',
        mimeType: 'application/pdf',
        uploadedAt: '2026-01-01T00:00:00Z',
        uploadedBy: 'mlro',
        sha256: 'a'.repeat(64),
      },
    ],
  };
  return {
    schemaVersion: 2,
    id: 'cust-1',
    legalName: 'MADISON JEWELLERY TRADING L.L.C',
    customerType: 'legal',
    country: 'AE',
    jurisdiction: 'Dubai',
    licenseNumber: 'DET-123456',
    licenseIssuer: 'Dubai DET',
    licenseIssueDate: '01/01/2024',
    licenseExpiryDate: '01/01/2027',
    licenseStatus: 'active',
    businessModel: 'Wholesale jewellery trading to UAE retailers',
    activity: 'Jewellery Trading',
    sector: 'jewellery-retail',
    expectedMonthlyVolumeAed: 500_000,
    expectedTransactionCountPerMonth: 20,
    riskRating: 'medium',
    riskRatingAssignedAt: '01/01/2026',
    riskRatingExpiresAt: '01/07/2026',
    pepStatus: 'clear',
    sanctionsStatus: 'clear',
    sourceOfFundsStatus: 'verified',
    sourceOfFundsEvidence: [
      {
        blobKey: 'evidence/sof.pdf',
        filename: 'sof.pdf',
        mimeType: 'application/pdf',
        uploadedAt: '2026-01-01T00:00:00Z',
        uploadedBy: 'mlro',
        sha256: 'b'.repeat(64),
      },
    ],
    sourceOfWealthStatus: 'not_applicable',
    shareholders: [shareholder],
    managers: [manager, co],
    entityType: 'standalone',
    createdAt: '2026-01-01T00:00:00Z',
    nextReviewDueAt: '01/07/2026',
    recordRetentionUntil: '01/01/2036',
  };
}

describe('isValidEmiratesId', () => {
  it('accepts valid format', () => {
    expect(isValidEmiratesId('784-1980-1234567-1')).toBe(true);
  });
  it('rejects missing 784 prefix', () => {
    expect(isValidEmiratesId('123-1980-1234567-1')).toBe(false);
  });
  it('rejects missing hyphens', () => {
    expect(isValidEmiratesId('784198012345671')).toBe(false);
  });
  it('rejects wrong segment lengths', () => {
    expect(isValidEmiratesId('784-19-1234567-1')).toBe(false);
    expect(isValidEmiratesId('784-1980-123456-1')).toBe(false);
    expect(isValidEmiratesId('784-1980-1234567-12')).toBe(false);
  });
  it('rejects undefined/null/empty', () => {
    expect(isValidEmiratesId(undefined)).toBe(false);
    expect(isValidEmiratesId(null)).toBe(false);
    expect(isValidEmiratesId('')).toBe(false);
  });
});

describe('isValidCountryCode', () => {
  it.each(['AE', 'GB', 'US', 'FR'])('accepts %s', (code) => {
    expect(isValidCountryCode(code)).toBe(true);
  });
  it('rejects lowercase', () => {
    expect(isValidCountryCode('ae')).toBe(false);
  });
  it('rejects 3-letter alpha-3', () => {
    expect(isValidCountryCode('ARE')).toBe(false);
  });
  it('rejects full country name', () => {
    expect(isValidCountryCode('United Arab Emirates')).toBe(false);
  });
});

describe('isExpired / isInFuture', () => {
  it('detects an expired date', () => {
    expect(isExpired('01/01/2025', TODAY)).toBe(true);
    expect(isInFuture('01/01/2025', TODAY)).toBe(false);
  });
  it('detects a future date', () => {
    expect(isInFuture('01/01/2027', TODAY)).toBe(true);
    expect(isExpired('01/01/2027', TODAY)).toBe(false);
  });
  it('returns false for null inputs', () => {
    expect(isExpired(null, TODAY)).toBe(false);
    expect(isInFuture(undefined, TODAY)).toBe(false);
  });
});

describe('validateCustomerProfile — valid profile', () => {
  it('produces no blockers for a fully valid profile', () => {
    const profile = makeValidProfile();
    const report = validateCustomerProfile(profile, TODAY);
    expect(report.ok).toBe(true);
    expect(report.blockerCount).toBe(0);
  });
});

describe('validateCustomerProfile — identity', () => {
  it('blocks when id is missing', () => {
    const profile = { ...makeValidProfile(), id: '' };
    const report = validateCustomerProfile(profile, TODAY);
    expect(report.findings.some((f) => f.path === 'id' && f.severity === 'blocker')).toBe(true);
  });
  it('blocks when legalName is missing', () => {
    const profile = { ...makeValidProfile(), legalName: '' };
    const report = validateCustomerProfile(profile, TODAY);
    expect(report.findings.some((f) => f.path === 'legalName' && f.severity === 'blocker')).toBe(
      true
    );
  });
});

describe('validateCustomerProfile — registration', () => {
  it('blocks invalid country code', () => {
    const profile = { ...makeValidProfile(), country: 'United Arab Emirates' };
    const report = validateCustomerProfile(profile, TODAY);
    expect(report.findings.some((f) => f.path === 'country')).toBe(true);
  });
  it('blocks invalid licenseIssueDate format', () => {
    const profile = { ...makeValidProfile(), licenseIssueDate: '2024-01-01' };
    const report = validateCustomerProfile(profile, TODAY);
    expect(report.findings.some((f) => f.path === 'licenseIssueDate')).toBe(true);
  });
  it('blocks when licenseStatus is "active" but expiry is past', () => {
    const profile = {
      ...makeValidProfile(),
      licenseExpiryDate: '01/01/2025',
      licenseStatus: 'active' as const,
    };
    const report = validateCustomerProfile(profile, TODAY);
    expect(report.findings.some((f) => f.path === 'licenseStatus')).toBe(true);
  });
  it('blocks when issue date is after expiry date', () => {
    const profile = {
      ...makeValidProfile(),
      licenseIssueDate: '01/01/2028',
      licenseExpiryDate: '01/01/2027',
    };
    const report = validateCustomerProfile(profile, TODAY);
    expect(report.findings.some((f) => f.path === 'licenseExpiryDate')).toBe(true);
  });
});

describe('validateCustomerProfile — shareholders', () => {
  it('blocks when total ownership exceeds 100%', () => {
    const profile = makeValidProfile();
    const shareholders: ShareholderRecord[] = [
      {
        id: 'a',
        type: 'natural',
        fullName: 'A',
        ownershipPercent: 60,
        nationality: 'AE',
        dateOfBirth: '01/01/1980',
        emiratesIdNumber: '784-1980-1111111-1',
        emiratesIdExpiry: '01/01/2030',
        uboVerifiedAt: '01/01/2026',
        pepCheckStatus: 'clear',
        sanctionsCheckStatus: 'clear',
        adverseMediaCheckStatus: 'clear',
      },
      {
        id: 'b',
        type: 'natural',
        fullName: 'B',
        ownershipPercent: 50,
        nationality: 'AE',
        dateOfBirth: '01/01/1985',
        emiratesIdNumber: '784-1985-2222222-2',
        emiratesIdExpiry: '01/01/2030',
        uboVerifiedAt: '01/01/2026',
        pepCheckStatus: 'clear',
        sanctionsCheckStatus: 'clear',
        adverseMediaCheckStatus: 'clear',
      },
    ];
    const p = { ...profile, shareholders };
    const report = validateCustomerProfile(p, TODAY);
    expect(report.findings.some((f) => f.path === 'shareholders' && f.severity === 'blocker')).toBe(
      true
    );
  });
  it('blocks when a UBO has no verification date', () => {
    const profile = makeValidProfile();
    const bad: ShareholderRecord = {
      ...profile.shareholders[0]!,
      uboVerifiedAt: undefined,
    };
    const p = { ...profile, shareholders: [bad] };
    const report = validateCustomerProfile(p, TODAY);
    expect(report.findings.some((f) => f.path.includes('uboVerifiedAt'))).toBe(true);
  });
  it('blocks when a UAE-national shareholder has invalid EID', () => {
    const profile = makeValidProfile();
    const bad: ShareholderRecord = {
      ...profile.shareholders[0]!,
      emiratesIdNumber: 'not-an-eid',
    };
    const p = { ...profile, shareholders: [bad] };
    const report = validateCustomerProfile(p, TODAY);
    expect(report.findings.some((f) => f.path.includes('emiratesIdNumber'))).toBe(true);
  });
});

describe('validateCustomerProfile — managers', () => {
  it('warns when no MLRO is present', () => {
    const profile = makeValidProfile();
    // Keep only the CO — remove MLRO
    const managersWithoutMlro = profile.managers.filter((m) => m.role !== 'mlro');
    const p = { ...profile, managers: managersWithoutMlro };
    const report = validateCustomerProfile(p, TODAY);
    expect(
      report.findings.some((f) => f.path === 'managers' && f.message.toLowerCase().includes('mlro'))
    ).toBe(true);
  });
  it('blocks when a manager passport is expired', () => {
    const profile = makeValidProfile();
    const expiredManager: ManagerRecord = {
      ...profile.managers[0]!,
      passportExpiry: '01/01/2025',
    };
    const p = { ...profile, managers: [expiredManager, profile.managers[1]!] };
    const report = validateCustomerProfile(p, TODAY);
    expect(
      report.findings.some((f) => f.path.includes('passportExpiry') && f.severity === 'blocker')
    ).toBe(true);
  });
});

describe('validateCustomerProfile — source of funds / wealth', () => {
  it('blocks when SoF status is verified but no evidence attached', () => {
    const profile = { ...makeValidProfile(), sourceOfFundsEvidence: [] };
    const report = validateCustomerProfile(profile, TODAY);
    expect(report.findings.some((f) => f.path === 'sourceOfFundsEvidence')).toBe(true);
  });
  it('warns when high-risk customer has SoW pending', () => {
    const profile = {
      ...makeValidProfile(),
      riskRating: 'high' as const,
      sourceOfWealthStatus: 'pending' as const,
    };
    const report = validateCustomerProfile(profile, TODAY);
    expect(report.findings.some((f) => f.path === 'sourceOfWealthStatus')).toBe(true);
  });
});
