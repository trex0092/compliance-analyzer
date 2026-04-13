/**
 * Tests for the pure planner in asanaBulkOperations.
 * Dispatcher paths depend on isAsanaConfigured() + fetch and are
 * covered by the broader asanaClient test surface.
 */
import { describe, it, expect } from 'vitest';
import { buildBulkPlan } from '@/services/asanaBulkOperations';

describe('buildBulkPlan', () => {
  it('deduplicates repeated gids', () => {
    const plan = buildBulkPlan(['a', 'b', 'a', 'c', 'b']);
    expect(plan.deduped).toEqual(['a', 'b', 'c']);
    expect(plan.skipped).toEqual(['a', 'b']);
    expect(plan.total).toBe(5);
  });

  it('drops empty and whitespace-only entries', () => {
    const plan = buildBulkPlan(['a', '', '  ', 'b']);
    expect(plan.deduped).toEqual(['a', 'b']);
    expect(plan.skipped).toHaveLength(2);
  });

  it('trims surrounding whitespace before dedup', () => {
    const plan = buildBulkPlan(['a', ' a ', 'a\n']);
    expect(plan.deduped).toEqual(['a']);
  });

  it('handles an empty input', () => {
    const plan = buildBulkPlan([]);
    expect(plan.deduped).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.total).toBe(0);
  });
});
