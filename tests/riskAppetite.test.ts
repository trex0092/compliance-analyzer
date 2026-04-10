import { describe, it, expect } from 'vitest';
import {
  DEFAULT_POLICY,
  evaluateOnboarding,
  evaluateTransaction,
  type RiskAppetitePolicy,
} from '@/services/riskAppetite';

describe('DEFAULT_POLICY', () => {
  it('blocks Iran, DPRK, Syria, Myanmar for customers', () => {
    expect(DEFAULT_POLICY.customer.blockedNationalities).toContain('IR');
    expect(DEFAULT_POLICY.customer.blockedNationalities).toContain('KP');
    expect(DEFAULT_POLICY.customer.blockedNationalities).toContain('SY');
    expect(DEFAULT_POLICY.customer.blockedNationalities).toContain('MM');
  });

  it('rejects any sanctions match by default', () => {
    expect(DEFAULT_POLICY.customer.sanctionsMatchPolicy).toBe('always_reject');
  });

  it('requires PEP review', () => {
    expect(DEFAULT_POLICY.customer.pepPolicy).toBe('review');
  });
});

describe('evaluateOnboarding — customer rules', () => {
  it('accepts a clean customer', () => {
    const result = evaluateOnboarding({
      riskScore: 10,
      nationality: 'AE',
      businessType: 'jewellery',
      isPep: false,
      sanctionsMatchScore: 0,
    });
    expect(result.decision).toBe('accept');
  });

  it('rejects a sanctions match', () => {
    const result = evaluateOnboarding({
      riskScore: 10,
      sanctionsMatchScore: 0.95,
    });
    expect(result.decision).toBe('reject');
    expect(result.reasons.some((r) => r.clause.includes('sanctionsMatchPolicy'))).toBe(true);
  });

  it('rejects a blocked nationality', () => {
    const result = evaluateOnboarding({
      riskScore: 5,
      nationality: 'IR',
    });
    expect(result.decision).toBe('reject');
    expect(result.reasons.some((r) => r.clause.includes('blockedNationalities'))).toBe(true);
  });

  it('reviews a PEP', () => {
    const result = evaluateOnboarding({
      riskScore: 20,
      isPep: true,
    });
    expect(result.decision).toBe('review');
  });

  it('rejects when risk score exceeds the policy max', () => {
    const result = evaluateOnboarding({
      riskScore: 70, // > default max of 50
    });
    expect(result.decision).toBe('reject');
    expect(result.reasons.some((r) => r.clause.includes('maxRiskScore'))).toBe(true);
  });

  it('reviews when risk score is near the policy max', () => {
    const result = evaluateOnboarding({
      riskScore: 40, // 80% of max 50
    });
    expect(result.decision).toBe('review');
  });

  it('rejects undisclosed UBO', () => {
    const result = evaluateOnboarding({
      riskScore: 5,
      hasUndisclosedUbo: true,
    });
    expect(result.decision).toBe('reject');
    expect(result.reasons.some((r) => r.clause.includes('uboThreshold'))).toBe(true);
  });

  it('reject is "sticky" — a later review cannot undo a reject', () => {
    const result = evaluateOnboarding({
      riskScore: 80, // triggers reject
      isPep: true, // would only trigger review
    });
    expect(result.decision).toBe('reject');
  });

  it('honours a custom policy', () => {
    const custom: RiskAppetitePolicy = {
      ...DEFAULT_POLICY,
      customer: { ...DEFAULT_POLICY.customer, pepPolicy: 'reject' },
    };
    const result = evaluateOnboarding({ riskScore: 5, isPep: true }, custom);
    expect(result.decision).toBe('reject');
  });
});

describe('evaluateTransaction', () => {
  it('accepts a normal transaction', () => {
    const result = evaluateTransaction({
      amountAED: 10_000,
      counterpartyJurisdiction: 'AE',
      isCash: false,
    });
    expect(result.decision).toBe('accept');
  });

  it('rejects a transaction exceeding single-tx cap', () => {
    const result = evaluateTransaction({
      amountAED: 10_000_000, // > default 5M cap
    });
    expect(result.decision).toBe('reject');
  });

  it('reviews a transaction pushing the daily volume cap', () => {
    const result = evaluateTransaction({
      amountAED: 1_000_000,
      dailyVolumeAED: 25_000_000, // > default 20M cap
    });
    expect(result.decision).toBe('review');
  });

  it('rejects a counterparty in a blocked jurisdiction', () => {
    const result = evaluateTransaction({
      amountAED: 1_000_000,
      counterpartyJurisdiction: 'IR',
    });
    expect(result.decision).toBe('reject');
  });

  it('reviews high cash intensity', () => {
    const result = evaluateTransaction({
      amountAED: 1_000,
      customerCashIntensity: 0.9, // > default 0.8
    });
    expect(result.decision).toBe('review');
  });

  it('rejects virtual asset when policy disallows', () => {
    const noVa: RiskAppetitePolicy = { ...DEFAULT_POLICY, virtualAssetsAllowed: false };
    const result = evaluateTransaction({ amountAED: 1_000, involvesVirtualAsset: true }, noVa);
    expect(result.decision).toBe('reject');
  });
});
