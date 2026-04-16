/**
 * MLRO Asana dispatch — unit tests.
 *
 * Covers the pure helper (`deriveStatusColor`) and the skip paths on
 * `postMlroStatusUpdate` that do not perform a network call. The
 * network path is exercised by integration tests against a mock proxy;
 * unit tests should not depend on the Asana token presence.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { deriveStatusColor, postMlroStatusUpdate } from '../src/services/mlroAsanaDispatch';

describe('deriveStatusColor', () => {
  it('returns off_track when list coverage is broken', () => {
    expect(deriveStatusColor({ anyListMissing: true })).toBe('off_track');
  });

  it('returns off_track when confirmed hits or imminent breaches exist', () => {
    expect(deriveStatusColor({ confirmedHits: 1 })).toBe('off_track');
    expect(deriveStatusColor({ imminentBreaches: 2 })).toBe('off_track');
  });

  it('returns at_risk when only overdue filings exist', () => {
    expect(deriveStatusColor({ overdueFilings: 1 })).toBe('at_risk');
  });

  it('returns on_track when all signals are clean', () => {
    expect(
      deriveStatusColor({
        anyListMissing: false,
        confirmedHits: 0,
        imminentBreaches: 0,
        overdueFilings: 0,
      })
    ).toBe('on_track');
  });
});

describe('postMlroStatusUpdate — skip paths', () => {
  const originalProjectGid = process.env.ASANA_CENTRAL_MLRO_PROJECT_GID;
  const originalToken = process.env.ASANA_TOKEN;

  beforeEach(() => {
    delete process.env.ASANA_CENTRAL_MLRO_PROJECT_GID;
    delete process.env.ASANA_TOKEN;
  });

  afterEach(() => {
    if (originalProjectGid !== undefined) {
      process.env.ASANA_CENTRAL_MLRO_PROJECT_GID = originalProjectGid;
    } else {
      delete process.env.ASANA_CENTRAL_MLRO_PROJECT_GID;
    }
    if (originalToken !== undefined) {
      process.env.ASANA_TOKEN = originalToken;
    } else {
      delete process.env.ASANA_TOKEN;
    }
  });

  it('skips gracefully when no MLRO project GID is configured', async () => {
    const result = await postMlroStatusUpdate({
      title: 'Daily briefing',
      markdown: '# Hello',
    });
    expect(result).toEqual({ ok: true, skipped: 'no-project-gid' });
  });

  it('skips gracefully when ASANA_TOKEN is absent', async () => {
    const result = await postMlroStatusUpdate({
      title: 'Daily briefing',
      markdown: '# Hello',
      projectGidOverride: '1200000000000001',
    });
    expect(result).toEqual({ ok: true, skipped: 'no-asana-token' });
  });
});
