/**
 * Tests for CDD → Asana custom field push. Exercises the pure
 * builder and the derivation helpers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildCddCustomFieldPayload,
  deriveCddLevel,
} from '@/services/cddAsanaCustomFieldPush';
import type { CustomerProfile } from '@/domain/customers';

function mkCustomer(overrides: Partial<CustomerProfile> = {}): CustomerProfile {
  return {
    id: 'company-x',
    legalName: 'Test Co LLC',
    type: 'customer',
    entityType: 'standalone',
    activity: 'Jewellery Trading',
    location: 'Dubai, UAE',
    countryOfRegistration: 'UAE',
    sector: 'precious-metals',
    riskRating: 'medium',
    pepStatus: 'clear',
    sanctionsStatus: 'clear',
    sourceOfFundsStatus: 'verified',
    sourceOfWealthStatus: 'verified',
    beneficialOwners: [],
    reviewHistory: [],
    ...overrides,
  };
}

// Stash + restore env vars so one test doesn't pollute another.
const savedEnv: Record<string, string | undefined> = {};
const envKeys = [
  'ASANA_CF_CUSTOMER_NAME_GID',
  'ASANA_CF_JURISDICTION_GID',
  'ASANA_CF_UBO_COUNT_GID',
  'ASANA_CF_PEP_FLAG_GID',
  'ASANA_CF_RISK_LEVEL_GID',
  'ASANA_CF_RISK_LEVEL_HIGH',
  'ASANA_CF_RISK_LEVEL_MEDIUM',
  'ASANA_CF_RISK_LEVEL_LOW',
  'ASANA_CF_RISK_LEVEL_CRITICAL',
];

beforeEach(() => {
  for (const k of envKeys) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of envKeys) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('deriveCddLevel', () => {
  it('returns SDD for a clean low-risk customer', () => {
    expect(deriveCddLevel(mkCustomer({ riskRating: 'low' }))).toBe('SDD');
  });

  it('returns CDD for medium risk', () => {
    expect(deriveCddLevel(mkCustomer({ riskRating: 'medium' }))).toBe('CDD');
  });

  it('returns EDD for high risk', () => {
    expect(deriveCddLevel(mkCustomer({ riskRating: 'high' }))).toBe('EDD');
  });

  it('returns EDD for any PEP match regardless of risk', () => {
    expect(
      deriveCddLevel(
        mkCustomer({ riskRating: 'low', pepStatus: 'potential-match' })
      )
    ).toBe('EDD');
  });

  it('returns EDD for sanctions match', () => {
    expect(
      deriveCddLevel(mkCustomer({ riskRating: 'low', sanctionsStatus: 'match' }))
    ).toBe('EDD');
  });
});

describe('buildCddCustomFieldPayload', () => {
  it('returns empty payload when no GIDs are configured (degradation path)', () => {
    const result = buildCddCustomFieldPayload({
      customer: mkCustomer(),
      taskGid: '123',
    });
    expect(result.payload).toEqual({});
    expect(result.derivedCddLevel).toBe('CDD');
  });

  it('emits risk level enum when GIDs are configured', () => {
    process.env.ASANA_CF_RISK_LEVEL_GID = 'risk-gid';
    process.env.ASANA_CF_RISK_LEVEL_MEDIUM = 'medium-opt';
    const result = buildCddCustomFieldPayload({
      customer: mkCustomer(),
      taskGid: '123',
    });
    expect(result.payload['risk-gid']).toBe('medium-opt');
  });

  it('emits customer name, jurisdiction, UBO count, and PEP flag when those env GIDs are set', () => {
    process.env.ASANA_CF_CUSTOMER_NAME_GID = 'name-gid';
    process.env.ASANA_CF_JURISDICTION_GID = 'juris-gid';
    process.env.ASANA_CF_UBO_COUNT_GID = 'ubo-gid';
    process.env.ASANA_CF_PEP_FLAG_GID = 'pep-gid';

    const customer = mkCustomer({
      legalName: 'Test Co LLC',
      countryOfRegistration: 'AE',
      beneficialOwners: [
        {
          id: 'u1',
          fullName: 'A',
          ownershipPercent: 30,
          pepStatus: 'clear',
          sanctionsStatus: 'clear',
        },
        {
          id: 'u2',
          fullName: 'B',
          ownershipPercent: 10, // under 25% — does not count
          pepStatus: 'clear',
          sanctionsStatus: 'clear',
        },
      ],
    });

    const result = buildCddCustomFieldPayload({ customer, taskGid: '123' });
    expect(result.payload['name-gid']).toBe('Test Co LLC');
    expect(result.payload['juris-gid']).toBe('AE');
    expect(result.payload['ubo-gid']).toBe(1); // only the ≥25% owner
    expect(result.payload['pep-gid']).toBe('NO');
  });

  it('flags PEP=YES when PEP status is not clear', () => {
    process.env.ASANA_CF_PEP_FLAG_GID = 'pep-gid';
    const result = buildCddCustomFieldPayload({
      customer: mkCustomer({ pepStatus: 'match' }),
      taskGid: '123',
    });
    expect(result.payload['pep-gid']).toBe('YES');
    expect(result.derivedCddLevel).toBe('EDD');
  });

  it('honours an explicit CDD level override', () => {
    const result = buildCddCustomFieldPayload({
      customer: mkCustomer({ riskRating: 'low' }),
      taskGid: '123',
      cddLevelOverride: 'EDD',
    });
    expect(result.derivedCddLevel).toBe('EDD');
  });
});
