import { describe, it, expect } from 'vitest';
import { parsePolicy, evaluatePolicy } from '@/services/policyDsl';

const policySource = `
# Example UAE DPMS policy
IF sanctions_score >= 0.9 THEN freeze
IF pep == true and country in ["IR", "KP", "MM"] THEN escalate
IF amount_aed >= 55000 and cash_ratio > 0.5 THEN flag
IF amount_aed < 1000 THEN pass
`;

describe('policyDsl — parsing', () => {
  it('parses a multi-rule policy', () => {
    const policy = parsePolicy(policySource);
    expect(policy.rules).toHaveLength(4);
    expect(policy.rules[0].verdict).toBe('freeze');
    expect(policy.rules[1].verdict).toBe('escalate');
  });

  it('rejects invalid verdict', () => {
    expect(() => parsePolicy('IF pep == true THEN kaboom')).toThrow(/unknown verdict/);
  });

  it('rejects invalid syntax', () => {
    expect(() => parsePolicy('MAYBE pep == true THEN flag')).toThrow();
  });

  it('rejects unterminated string', () => {
    expect(() => parsePolicy('IF country == "IR THEN flag')).toThrow();
  });
});

describe('policyDsl — evaluation', () => {
  const policy = parsePolicy(policySource);

  it('returns freeze for high sanctions', () => {
    const result = evaluatePolicy(policy, { sanctions_score: 0.95 });
    expect(result.verdict).toBe('freeze');
  });

  it('returns escalate for PEP from high-risk jurisdiction', () => {
    const result = evaluatePolicy(policy, {
      sanctions_score: 0,
      pep: true,
      country: 'IR',
    });
    expect(result.verdict).toBe('escalate');
  });

  it('returns flag for large cash transaction', () => {
    const result = evaluatePolicy(policy, {
      sanctions_score: 0,
      pep: false,
      amount_aed: 70_000,
      cash_ratio: 0.8,
    });
    expect(result.verdict).toBe('flag');
  });

  it('returns pass for tiny transaction', () => {
    const result = evaluatePolicy(policy, {
      sanctions_score: 0,
      pep: false,
      amount_aed: 500,
    });
    expect(result.verdict).toBe('pass');
  });

  it('default verdict is pass when no rule matches', () => {
    const result = evaluatePolicy(policy, { sanctions_score: 0, pep: false, amount_aed: 25_000 });
    expect(result.verdict).toBe('pass');
    expect(result.matchedRule).toBeNull();
  });

  it('trace reports matched rule', () => {
    const result = evaluatePolicy(policy, { sanctions_score: 0.99 });
    expect(result.matchedRule?.verdict).toBe('freeze');
    expect(result.evaluatedRules).toBe(1);
  });
});

describe('policyDsl — operators', () => {
  it('handles not + or', () => {
    const p = parsePolicy('IF not pep or country == "US" THEN pass');
    expect(evaluatePolicy(p, { pep: false, country: 'IR' }).verdict).toBe('pass');
    expect(evaluatePolicy(p, { pep: true, country: 'US' }).verdict).toBe('pass');
    expect(evaluatePolicy(p, { pep: true, country: 'IR' }).verdict).toBe('pass');
  });

  it('handles grouping with parens', () => {
    const p = parsePolicy('IF (pep == true or country == "IR") and cash > 10000 THEN flag');
    expect(evaluatePolicy(p, { pep: true, country: 'UAE', cash: 20000 }).verdict).toBe('flag');
    expect(evaluatePolicy(p, { pep: false, country: 'UAE', cash: 20000 }).verdict).toBe('pass');
  });
});
