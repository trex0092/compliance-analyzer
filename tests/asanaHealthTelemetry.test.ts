/**
 * Tests for the Asana health telemetry reducer. Pure inputs → pure
 * outputs so we can lock the decision table down.
 */
import { describe, it, expect } from 'vitest';
import {
  reduceAsanaHealth,
  type AsanaHealthInputs,
} from '@/services/asanaHealthTelemetry';

function baseInputs(
  overrides: Partial<AsanaHealthInputs> = {}
): AsanaHealthInputs {
  return {
    configured: true,
    retryQueue: { pending: 0, failed: 0 },
    linkStats: { total: 12, completed: 8, active: 4 },
    nowIso: '2026-04-13T12:00:00.000Z',
    ...overrides,
  };
}

describe('reduceAsanaHealth', () => {
  it('reports unconfigured when Asana is not configured', () => {
    const snap = reduceAsanaHealth(baseInputs({ configured: false }));
    expect(snap.status).toBe('unconfigured');
    expect(snap.summary).toMatch(/not configured/i);
  });

  it('reports healthy when queue is empty and no recent errors', () => {
    const snap = reduceAsanaHealth(baseInputs());
    expect(snap.status).toBe('healthy');
    expect(snap.lastError).toBeUndefined();
    expect(snap.summary).toMatch(/healthy/i);
  });

  it('reports degraded when retry queue has pending entries', () => {
    const snap = reduceAsanaHealth(
      baseInputs({ retryQueue: { pending: 3, failed: 0 } })
    );
    expect(snap.status).toBe('degraded');
    expect(snap.retryQueuePending).toBe(3);
  });

  it('reports degraded when a rate limit hit occurred within 5 minutes', () => {
    const snap = reduceAsanaHealth(
      baseInputs({ lastRateLimitAtIso: '2026-04-13T11:58:00.000Z' })
    );
    expect(snap.status).toBe('degraded');
    expect(snap.lastRateLimitAtIso).toBeDefined();
  });

  it('reports critical when the retry queue has permanently failed entries', () => {
    const snap = reduceAsanaHealth(
      baseInputs({ retryQueue: { pending: 1, failed: 2 } })
    );
    expect(snap.status).toBe('critical');
    expect(snap.retryQueueFailed).toBe(2);
  });

  it('reports critical when a recent error is present', () => {
    const snap = reduceAsanaHealth(
      baseInputs({
        lastError: {
          error: 'Asana API 500: server error',
          atIso: '2026-04-13T11:55:00.000Z',
        },
      })
    );
    expect(snap.status).toBe('critical');
    expect(snap.lastError).toContain('500');
  });

  it('ignores errors older than 15 minutes', () => {
    const snap = reduceAsanaHealth(
      baseInputs({
        lastError: {
          error: 'Asana API 500: server error',
          atIso: '2026-04-13T11:00:00.000Z', // 60 minutes ago
        },
      })
    );
    expect(snap.status).toBe('healthy');
    expect(snap.lastError).toBeUndefined();
  });

  it('critical outranks degraded', () => {
    const snap = reduceAsanaHealth(
      baseInputs({
        retryQueue: { pending: 5, failed: 1 },
        lastError: {
          error: '429 rate limit',
          atIso: '2026-04-13T11:59:00.000Z',
        },
      })
    );
    expect(snap.status).toBe('critical');
  });
});
