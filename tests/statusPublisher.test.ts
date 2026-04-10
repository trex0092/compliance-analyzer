/**
 * Status publisher — normalisation + configuration tests.
 *
 * Live publish requires Netlify Blobs / Cachet endpoints that the
 * test runner doesn't have. These tests exercise the pure helpers:
 * normalizeIncident, isCachetConfigured, and severity→status mapping.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
// @ts-expect-error — .mjs import with no type declarations
import {
  publishIncident,
  isCachetConfigured,
  normalizeIncident,
  SEVERITY_TO_CACHET_STATUS,
} from '../scripts/lib/status-publisher.mjs';

describe('statusPublisher: normalizeIncident', () => {
  it('truncates name to 120 chars', () => {
    const long = 'x'.repeat(500);
    const n = normalizeIncident({ name: long, message: 'ok' });
    expect(n.name.length).toBe(120);
  });

  it('truncates message to 2000 chars', () => {
    const long = 'y'.repeat(9000);
    const n = normalizeIncident({ name: 'x', message: long });
    expect(n.message.length).toBe(2000);
  });

  it('defaults severity to investigating', () => {
    const n = normalizeIncident({ name: 'x', message: 'y' });
    expect(n.severity).toBe('investigating');
  });

  it('defaults visible to true', () => {
    const n = normalizeIncident({ name: 'x', message: 'y' });
    expect(n.visible).toBe(true);
  });

  it('honours explicit visible: false', () => {
    const n = normalizeIncident({ name: 'x', message: 'y', visible: false });
    expect(n.visible).toBe(false);
  });
});

describe('statusPublisher: isCachetConfigured', () => {
  const originalBase = process.env.CACHET_BASE_URL;
  const originalToken = process.env.CACHET_API_TOKEN;

  beforeEach(() => {
    delete process.env.CACHET_BASE_URL;
    delete process.env.CACHET_API_TOKEN;
  });

  afterEach(() => {
    if (originalBase) process.env.CACHET_BASE_URL = originalBase;
    else delete process.env.CACHET_BASE_URL;
    if (originalToken) process.env.CACHET_API_TOKEN = originalToken;
    else delete process.env.CACHET_API_TOKEN;
  });

  it('false when neither env var is set', () => {
    expect(isCachetConfigured()).toBe(false);
  });

  it('false when only BASE_URL is set', () => {
    process.env.CACHET_BASE_URL = 'https://status.example.com';
    expect(isCachetConfigured()).toBe(false);
  });

  it('false when only API_TOKEN is set', () => {
    process.env.CACHET_API_TOKEN = 'x';
    expect(isCachetConfigured()).toBe(false);
  });

  it('true when both are set', () => {
    process.env.CACHET_BASE_URL = 'https://status.example.com';
    process.env.CACHET_API_TOKEN = 'x';
    expect(isCachetConfigured()).toBe(true);
  });
});

describe('statusPublisher: SEVERITY_TO_CACHET_STATUS', () => {
  it('maps all four Cachet incident statuses', () => {
    expect(SEVERITY_TO_CACHET_STATUS.investigating).toBe(1);
    expect(SEVERITY_TO_CACHET_STATUS.identified).toBe(2);
    expect(SEVERITY_TO_CACHET_STATUS.watching).toBe(3);
    expect(SEVERITY_TO_CACHET_STATUS.fixed).toBe(4);
  });

  it('is frozen (cannot be mutated at runtime)', () => {
    expect(Object.isFrozen(SEVERITY_TO_CACHET_STATUS)).toBe(true);
  });
});

describe('statusPublisher: publishIncident validation', () => {
  it('throws on missing name', async () => {
    // @ts-expect-error — deliberate bad input
    await expect(publishIncident({ message: 'x' })).rejects.toThrow(/name is required/);
  });

  it('throws on missing message', async () => {
    // @ts-expect-error — deliberate bad input
    await expect(publishIncident({ name: 'x' })).rejects.toThrow(/message is required/);
  });

  it('throws on unknown severity', async () => {
    await expect(
      publishIncident({
        name: 'x',
        message: 'y',
        // @ts-expect-error — deliberate bad input
        severity: 'catastrophic',
      }),
    ).rejects.toThrow(/unknown severity/);
  });
});
