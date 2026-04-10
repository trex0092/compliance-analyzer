import { describe, it, expect } from 'vitest';
import { parseNlQuery, executeQuery } from '@/services/nlComplianceQuery';

const NOW = () => new Date('2026-04-10T12:00:00Z');

describe('nlComplianceQuery — parser', () => {
  it('parses "show me all high-risk customers"', () => {
    const r = parseNlQuery('show me all high-risk customers', NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ast.entity).toBe('customer');
    expect(r.ast.filters).toContainEqual({ field: 'riskBand', op: 'eq', value: 'high' });
  });

  it('parses "top 10 riskiest customers"', () => {
    const r = parseNlQuery('top 10 riskiest customers', NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ast.entity).toBe('customer');
    expect(r.ast.limit).toBe(10);
    expect(r.ast.sort).toEqual({ field: 'riskScore', direction: 'desc' });
  });

  it('parses "structured transactions below 55k last week"', () => {
    const r = parseNlQuery('structured transactions below 55k last week', NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ast.entity).toBe('transaction');
    expect(r.ast.filters).toContainEqual({ field: 'amount', op: 'lt', value: 55_000 });
    expect(r.ast.filters).toContainEqual({
      field: 'indicator',
      op: 'contains',
      value: 'structuring',
    });
    expect(r.ast.timeWindow?.field).toBe('createdAt');
  });

  it('parses "STRs filed in the last 30 days"', () => {
    const r = parseNlQuery('show STRs filed in the last 30 days', NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ast.entity).toBe('str');
    expect(r.ast.timeWindow).toBeDefined();
  });

  it('parses "customers from USA"', () => {
    const r = parseNlQuery('show customers from USA', NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ast.filters).toContainEqual({ field: 'country', op: 'eq', value: 'USA' });
  });

  it('parses "screenings with confidence over 0.8"', () => {
    const r = parseNlQuery('show screenings with confidence over 0.8', NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ast.filters).toContainEqual({ field: 'confidence', op: 'gt', value: 0.8 });
  });

  it('rejects empty query', () => {
    const r = parseNlQuery('   ', NOW);
    expect(r.ok).toBe(false);
  });

  it('rejects query without detectable entity', () => {
    const r = parseNlQuery('hello world', NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.suggestions.length).toBeGreaterThan(0);
  });
});

describe('nlComplianceQuery — executor', () => {
  const customers = [
    { id: 'C1', name: 'A', riskBand: 'high', riskScore: 18, createdAt: '2026-04-09T00:00:00Z' },
    { id: 'C2', name: 'B', riskBand: 'low', riskScore: 3, createdAt: '2026-04-01T00:00:00Z' },
    { id: 'C3', name: 'C', riskBand: 'high', riskScore: 22, createdAt: '2026-03-15T00:00:00Z' },
  ];

  it('filters by riskBand', () => {
    const r = parseNlQuery('show high-risk customers', NOW);
    if (!r.ok) throw new Error('parse failed');
    const out = executeQuery(r.ast, customers);
    expect(out.map((c) => c.id)).toEqual(['C1', 'C3']);
  });

  it('applies top N sort + limit', () => {
    const r = parseNlQuery('top 2 riskiest customers', NOW);
    if (!r.ok) throw new Error('parse failed');
    const out = executeQuery(r.ast, customers);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe('C3');
    expect(out[1].id).toBe('C1');
  });

  it('applies time window filter', () => {
    const r = parseNlQuery('customers in the last 7 days', NOW);
    if (!r.ok) throw new Error('parse failed');
    const out = executeQuery(r.ast, customers);
    // Only C1 (2026-04-09) is within 7 days of 2026-04-10.
    expect(out.map((c) => c.id)).toEqual(['C1']);
  });
});
