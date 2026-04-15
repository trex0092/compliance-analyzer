/**
 * Tests for src/services/customerExpiryAlerter.ts.
 */
import { describe, expect, it } from 'vitest';
import type {
  CustomerProfileV2,
  ManagerRecord,
  ShareholderRecord,
} from '../src/domain/customerProfile';
import {
  classifySeverity,
  classifyWindow,
  scanExpiries,
} from '../src/services/customerExpiryAlerter';

const TODAY = new Date(Date.UTC(2026, 3, 15)); // 15 April 2026

function addDays(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function toDdMmYyyy(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function inDaysFromToday(days: number): string {
  return toDdMmYyyy(addDays(TODAY, days));
}

function makeProfile(overrides: Partial<CustomerProfileV2> = {}): CustomerProfileV2 {
  const m: ManagerRecord = {
    id: 'mgr-1',
    fullName: 'Test Manager',
    role: 'mlro',
    dateOfBirth: '01/01/1980',
    nationality: 'AE',
    emiratesIdNumber: '784-1980-1234567-1',
    emiratesIdExpiry: inDaysFromToday(365),
    passportNumber: 'A1',
    passportCountry: 'AE',
    passportExpiry: inDaysFromToday(365),
    appointmentDate: '01/01/2024',
    isSanctionsAuthority: true,
    isStrFilingAuthority: true,
    pepCheckStatus: 'clear',
    sanctionsCheckStatus: 'clear',
    adverseMediaCheckStatus: 'clear',
  };
  return {
    schemaVersion: 2,
    id: 'cust-1',
    legalName: 'Test Customer L.L.C',
    customerType: 'legal',
    country: 'AE',
    jurisdiction: 'Dubai',
    licenseNumber: 'LIC-1',
    licenseIssuer: 'DET',
    licenseIssueDate: '01/01/2024',
    licenseExpiryDate: inDaysFromToday(365),
    licenseStatus: 'active',
    businessModel: 'Test business model',
    activity: 'Test',
    sector: 'jewellery-retail',
    expectedMonthlyVolumeAed: 100_000,
    expectedTransactionCountPerMonth: 10,
    riskRating: 'medium',
    riskRatingAssignedAt: '01/01/2026',
    riskRatingExpiresAt: inDaysFromToday(365),
    pepStatus: 'clear',
    sanctionsStatus: 'clear',
    sourceOfFundsStatus: 'verified',
    sourceOfWealthStatus: 'not_applicable',
    shareholders: [],
    managers: [m],
    entityType: 'standalone',
    createdAt: '2026-01-01T00:00:00Z',
    nextReviewDueAt: inDaysFromToday(365),
    recordRetentionUntil: inDaysFromToday(3650),
    ...overrides,
  };
}

describe('classifyWindow', () => {
  it('puts 5 days into the 7-day bucket', () => {
    expect(classifyWindow(5)).toBe(7);
  });
  it('puts 7 days exactly into the 7-day bucket', () => {
    expect(classifyWindow(7)).toBe(7);
  });
  it('puts 20 days into the 30-day bucket', () => {
    expect(classifyWindow(20)).toBe(30);
  });
  it('puts 45 days into the 60-day bucket', () => {
    expect(classifyWindow(45)).toBe(60);
  });
  it('puts 85 days into the 90-day bucket', () => {
    expect(classifyWindow(85)).toBe(90);
  });
  it('returns null for 100+ days (outside all windows)', () => {
    expect(classifyWindow(100)).toBeNull();
  });
  it('returns null for negative days (already expired)', () => {
    expect(classifyWindow(-5)).toBeNull();
  });
});

describe('classifySeverity', () => {
  it('negative days → expired', () => {
    expect(classifySeverity(-1)).toBe('expired');
    expect(classifySeverity(-100)).toBe('expired');
  });
  it('0-7 days → urgent', () => {
    expect(classifySeverity(0)).toBe('urgent');
    expect(classifySeverity(7)).toBe('urgent');
  });
  it('8-30 days → soon', () => {
    expect(classifySeverity(8)).toBe('soon');
    expect(classifySeverity(30)).toBe('soon');
  });
  it('31-90 days → upcoming', () => {
    expect(classifySeverity(45)).toBe('upcoming');
    expect(classifySeverity(90)).toBe('upcoming');
  });
  it('>90 days → null (outside window)', () => {
    expect(classifySeverity(91)).toBeNull();
  });
});

describe('scanExpiries — happy path', () => {
  it('returns no alerts when nothing is expiring within 90 days', () => {
    const profile = makeProfile({
      licenseExpiryDate: inDaysFromToday(180),
      riskRatingExpiresAt: inDaysFromToday(180),
      nextReviewDueAt: inDaysFromToday(180),
      recordRetentionUntil: inDaysFromToday(3650),
    });
    const report = scanExpiries([profile], TODAY);
    expect(report.alerts).toHaveLength(0);
    expect(report.counts.expired).toBe(0);
  });

  it('returns the customer licence when it expires in 60 days', () => {
    const profile = makeProfile({
      licenseExpiryDate: inDaysFromToday(60),
      riskRatingExpiresAt: inDaysFromToday(180),
      nextReviewDueAt: inDaysFromToday(180),
    });
    const report = scanExpiries([profile], TODAY);
    expect(report.alerts.length).toBeGreaterThan(0);
    const licence = report.alerts.find((a) => a.kind === 'licence');
    expect(licence).toBeDefined();
    expect(licence!.daysUntilExpiry).toBe(60);
    expect(licence!.severity).toBe('upcoming');
    expect(licence!.windowDays).toBe(60);
  });

  it('flags an expired document as severity=expired', () => {
    const profile = makeProfile({
      licenseExpiryDate: inDaysFromToday(-10),
    });
    const report = scanExpiries([profile], TODAY);
    const licence = report.alerts.find((a) => a.kind === 'licence');
    expect(licence).toBeDefined();
    expect(licence!.severity).toBe('expired');
    expect(licence!.daysUntilExpiry).toBe(-10);
    expect(licence!.message).toMatch(/expired 10 day/);
  });
});

describe('scanExpiries — urgency bucketing', () => {
  it.each([
    [5, 'urgent', 7],
    [15, 'soon', 30],
    [45, 'upcoming', 60],
    [85, 'upcoming', 90],
  ] as const)('%d days → severity=%s window=%d', (days, sev, win) => {
    const profile = makeProfile({
      licenseExpiryDate: inDaysFromToday(days),
      riskRatingExpiresAt: inDaysFromToday(365),
      nextReviewDueAt: inDaysFromToday(365),
    });
    const report = scanExpiries([profile], TODAY);
    const licence = report.alerts.find((a) => a.kind === 'licence');
    expect(licence).toBeDefined();
    expect(licence!.severity).toBe(sev);
    expect(licence!.windowDays).toBe(win);
  });
});

describe('scanExpiries — shareholder alerts', () => {
  it('emits alerts for shareholder Emirates ID + passport expiries', () => {
    const shareholder: ShareholderRecord = {
      id: 'sh-1',
      type: 'natural',
      fullName: 'UBO Person',
      ownershipPercent: 60,
      dateOfBirth: '01/01/1970',
      nationality: 'AE',
      emiratesIdNumber: '784-1970-1111111-1',
      emiratesIdExpiry: inDaysFromToday(20),
      passportExpiry: inDaysFromToday(60),
      uboVerifiedAt: '01/01/2026',
      uboReverificationDueAt: inDaysFromToday(10),
      pepCheckStatus: 'clear',
      sanctionsCheckStatus: 'clear',
      adverseMediaCheckStatus: 'clear',
    };
    const profile = makeProfile({
      shareholders: [shareholder],
      licenseExpiryDate: inDaysFromToday(365),
      riskRatingExpiresAt: inDaysFromToday(365),
      nextReviewDueAt: inDaysFromToday(365),
    });
    const report = scanExpiries([profile], TODAY);
    expect(report.alerts.find((a) => a.kind === 'shareholder-emirates-id')).toBeDefined();
    expect(report.alerts.find((a) => a.kind === 'shareholder-passport')).toBeDefined();
    expect(report.alerts.find((a) => a.kind === 'ubo-reverification')).toBeDefined();
  });
});

describe('scanExpiries — manager alerts', () => {
  it('emits a manager passport alert when it expires in 10 days', () => {
    const profile = makeProfile({
      managers: [
        {
          id: 'mgr-1',
          fullName: 'Test Manager',
          role: 'mlro',
          dateOfBirth: '01/01/1980',
          nationality: 'AE',
          emiratesIdNumber: '784-1980-1234567-1',
          emiratesIdExpiry: inDaysFromToday(365),
          passportNumber: 'A1',
          passportCountry: 'AE',
          passportExpiry: inDaysFromToday(10),
          appointmentDate: '01/01/2024',
          isSanctionsAuthority: true,
          isStrFilingAuthority: true,
          pepCheckStatus: 'clear',
          sanctionsCheckStatus: 'clear',
          adverseMediaCheckStatus: 'clear',
        },
      ],
      licenseExpiryDate: inDaysFromToday(365),
      riskRatingExpiresAt: inDaysFromToday(365),
      nextReviewDueAt: inDaysFromToday(365),
    });
    const report = scanExpiries([profile], TODAY);
    const mgrPassport = report.alerts.find((a) => a.kind === 'manager-passport');
    expect(mgrPassport).toBeDefined();
    expect(mgrPassport!.daysUntilExpiry).toBe(10);
    expect(mgrPassport!.severity).toBe('soon');
  });
});

describe('scanExpiries — sorting', () => {
  it('sorts alerts by daysUntilExpiry ascending', () => {
    const profile = makeProfile({
      licenseExpiryDate: inDaysFromToday(50),
      riskRatingExpiresAt: inDaysFromToday(10),
      nextReviewDueAt: inDaysFromToday(30),
      recordRetentionUntil: inDaysFromToday(3650),
    });
    const report = scanExpiries([profile], TODAY);
    const days = report.alerts.map((a) => a.daysUntilExpiry);
    for (let i = 0; i < days.length - 1; i++) {
      expect(days[i]!).toBeLessThanOrEqual(days[i + 1]!);
    }
  });
});

describe('scanExpiries — counts + summary', () => {
  it('counts per severity', () => {
    const profile = makeProfile({
      licenseExpiryDate: inDaysFromToday(-5), // expired
      riskRatingExpiresAt: inDaysFromToday(5), // urgent
      nextReviewDueAt: inDaysFromToday(25), // soon
      recordRetentionUntil: inDaysFromToday(60), // upcoming
    });
    const report = scanExpiries([profile], TODAY);
    expect(report.counts.expired).toBeGreaterThanOrEqual(1);
    expect(report.counts.urgent).toBeGreaterThanOrEqual(1);
    expect(report.counts.soon).toBeGreaterThanOrEqual(1);
    expect(report.counts.upcoming).toBeGreaterThanOrEqual(1);
  });
  it('emits a clean summary when nothing is expiring', () => {
    const profile = makeProfile({
      licenseExpiryDate: inDaysFromToday(365),
      riskRatingExpiresAt: inDaysFromToday(365),
      nextReviewDueAt: inDaysFromToday(365),
      recordRetentionUntil: inDaysFromToday(3650),
      managers: [
        {
          id: 'mgr-1',
          fullName: 'OK',
          role: 'mlro',
          dateOfBirth: '01/01/1980',
          nationality: 'AE',
          emiratesIdNumber: '784-1980-1234567-1',
          emiratesIdExpiry: inDaysFromToday(365),
          passportNumber: 'A1',
          passportCountry: 'AE',
          passportExpiry: inDaysFromToday(365),
          appointmentDate: '01/01/2024',
          isSanctionsAuthority: true,
          isStrFilingAuthority: true,
          pepCheckStatus: 'clear',
          sanctionsCheckStatus: 'clear',
          adverseMediaCheckStatus: 'clear',
        },
      ],
    });
    const report = scanExpiries([profile], TODAY);
    expect(report.summary).toMatch(/No expiring documents/);
  });
});
