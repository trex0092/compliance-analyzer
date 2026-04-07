import { describe, it, expect } from 'vitest';
import {
  detectSharedCustomers,
  detectSharedUBOs,
  runCrossEntityScan,
} from '../src/services/crossEntityScreening';
import type { CustomerProfile, UBORecord } from '../src/domain/customers';

function makeCustomer(id: string, name: string): CustomerProfile {
  return {
    id,
    legalName: name,
    type: 'customer',
    riskRating: 'medium',
    pepStatus: 'clear',
    sanctionsStatus: 'clear',
    sourceOfFundsStatus: 'verified',
    sourceOfWealthStatus: 'verified',
    beneficialOwners: [],
    reviewHistory: [],
  };
}

describe('detectSharedCustomers', () => {
  it('detects exact name match across entities', () => {
    const map = new Map([
      ['c1', { companyName: 'Company A', customers: [makeCustomer('1', 'GOLD TRADING LLC')] }],
      ['c2', { companyName: 'Company B', customers: [makeCustomer('2', 'GOLD TRADING LLC')] }],
    ]);
    const matches = detectSharedCustomers(map);
    expect(matches.length).toBe(1);
    expect(matches[0].type).toBe('shared-customer');
    expect(matches[0].confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('detects fuzzy name match (LLC vs L.L.C)', () => {
    const map = new Map([
      ['c1', { companyName: 'A', customers: [makeCustomer('1', 'MADISON JEWELLERY TRADING LLC')] }],
      ['c2', { companyName: 'B', customers: [makeCustomer('2', 'MADISON JEWELLERY TRADING L.L.C')] }],
    ]);
    const matches = detectSharedCustomers(map);
    expect(matches.length).toBe(1);
  });

  it('does not match unrelated names', () => {
    const map = new Map([
      ['c1', { companyName: 'A', customers: [makeCustomer('1', 'FINE GOLD LLC')] }],
      ['c2', { companyName: 'B', customers: [makeCustomer('2', 'NAPLES JEWELLERY TRADING')] }],
    ]);
    const matches = detectSharedCustomers(map);
    expect(matches.length).toBe(0);
  });
});

describe('detectSharedUBOs', () => {
  it('detects same UBO across entities', () => {
    const ubo1: UBORecord = {
      id: 'u1',
      fullName: 'Ahmed Al Maktoum',
      ownershipPercent: 30,
      pepStatus: 'clear',
      sanctionsStatus: 'clear',
    };
    const ubo2: UBORecord = {
      id: 'u2',
      fullName: 'Ahmed Al Maktoum',
      ownershipPercent: 25,
      pepStatus: 'clear',
      sanctionsStatus: 'clear',
    };
    const map = new Map([
      ['c1', { companyName: 'A', ubos: [ubo1] }],
      ['c2', { companyName: 'B', ubos: [ubo2] }],
    ]);
    const matches = detectSharedUBOs(map);
    expect(matches.length).toBe(1);
    expect(matches[0].type).toBe('shared-ubo');
  });
});

describe('runCrossEntityScan', () => {
  it('returns low risk when no matches', () => {
    const custMap = new Map([
      ['c1', { companyName: 'A', customers: [makeCustomer('1', 'Alpha Corp')] }],
      ['c2', { companyName: 'B', customers: [makeCustomer('2', 'Beta Corp')] }],
    ]);
    const uboMap = new Map([
      ['c1', { companyName: 'A', ubos: [] }],
      ['c2', { companyName: 'B', ubos: [] }],
    ]);
    const result = runCrossEntityScan(custMap, uboMap);
    expect(result.riskLevel).toBe('low');
    expect(result.matches.length).toBe(0);
  });
});
