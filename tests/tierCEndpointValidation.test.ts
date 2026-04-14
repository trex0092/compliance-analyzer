/**
 * Tier C endpoint input-validation tests.
 *
 * Every endpoint exposes `__test__.validate` — pure function over
 * request bodies. We test validation without Netlify runtime.
 */
import { describe, it, expect } from 'vitest';
import { __test__ as clamp } from '../netlify/functions/brain-clamp-suggestion.mts';
import { __test__ as outbound } from '../netlify/functions/brain-outbound-queue.mts';
import { __test__ as breakGlass } from '../netlify/functions/brain-break-glass.mts';
import { __test__ as zkXt } from '../netlify/functions/brain-zk-cross-tenant.mts';

// ---------------------------------------------------------------------------
// Clamp suggestion
// ---------------------------------------------------------------------------

describe('brain-clamp-suggestion validate', () => {
  it('rejects non-object body', () => {
    expect(clamp.validate(null).ok).toBe(false);
    expect(clamp.validate('string').ok).toBe(false);
  });

  it('rejects unknown action', () => {
    expect(clamp.validate({ action: 'bogus' }).ok).toBe(false);
  });

  it('accepts list with no filter', () => {
    const r = clamp.validate({ action: 'list' });
    expect(r.ok).toBe(true);
  });

  it('accepts list with filter', () => {
    const r = clamp.validate({ action: 'list', statusFilter: 'accepted' });
    expect(r.ok).toBe(true);
  });

  it('rejects decide with bad status', () => {
    const r = clamp.validate({ action: 'decide', id: 'x', status: 'foo' });
    expect(r.ok).toBe(false);
  });

  it('accepts decide with good status', () => {
    const r = clamp.validate({ action: 'decide', id: 'x', status: 'accepted' });
    expect(r.ok).toBe(true);
  });

  it('rejects propose with bad clamp key', () => {
    const r = clamp.validate({
      action: 'propose',
      clampKey: 'nope',
      currentValue: 0.5,
      minValue: 0,
      maxValue: 1,
      step: 0.05,
      regulatory: 'FDL Art.20',
      evidence: { totalCases: 100, falsePositive: 30 },
    });
    expect(r.ok).toBe(false);
  });

  it('accepts propose with valid body', () => {
    const r = clamp.validate({
      action: 'propose',
      clampKey: 'sanctionsMatchMin',
      currentValue: 0.5,
      minValue: 0,
      maxValue: 1,
      step: 0.05,
      regulatory: 'FDL Art.20',
      evidence: { totalCases: 100, falsePositive: 30 },
    });
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Outbound queue
// ---------------------------------------------------------------------------

describe('brain-outbound-queue validate', () => {
  it('rejects missing tenantId', () => {
    expect(outbound.validate({ action: 'pending' }).ok).toBe(false);
  });

  it('accepts pending with tenantId', () => {
    expect(outbound.validate({ action: 'pending', tenantId: 'tA' }).ok).toBe(true);
  });

  it('rejects enqueue with bad channel', () => {
    const r = outbound.validate({
      action: 'enqueue',
      tenantId: 'tA',
      recipientRef: 'c1',
      channel: 'foo',
      subject: 'x',
      body: 'y',
    });
    expect(r.ok).toBe(false);
  });

  it('accepts valid enqueue', () => {
    const r = outbound.validate({
      action: 'enqueue',
      tenantId: 'tA',
      recipientRef: 'c1',
      channel: 'email',
      subject: 'Welcome',
      body: 'Welcome!',
    });
    expect(r.ok).toBe(true);
  });

  it('rejects release without id', () => {
    expect(outbound.validate({ action: 'release', tenantId: 'tA' }).ok).toBe(false);
  });

  it('accepts release with id', () => {
    expect(outbound.validate({ action: 'release', tenantId: 'tA', id: 'm1' }).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Break-glass
// ---------------------------------------------------------------------------

describe('brain-break-glass validate', () => {
  it('rejects missing tenantId', () => {
    expect(breakGlass.validate({ action: 'pending' }).ok).toBe(false);
  });

  it('rejects request with bad verdict', () => {
    const r = breakGlass.validate({
      action: 'request',
      tenantId: 'tA',
      caseId: 'c1',
      fromVerdict: 'nope',
      toVerdict: 'flag',
      justification: 'reason',
      regulatoryCitation: 'FDL',
      requestedBy: 'mlro-1',
    });
    expect(r.ok).toBe(false);
  });

  it('accepts valid request', () => {
    const r = breakGlass.validate({
      action: 'request',
      tenantId: 'tA',
      caseId: 'c1',
      fromVerdict: 'freeze',
      toVerdict: 'escalate',
      justification: 'legit review of false positive',
      regulatoryCitation: 'FDL Art.20',
      requestedBy: 'mlro-1',
    });
    expect(r.ok).toBe(true);
  });

  it('rejects approve without approverId', () => {
    const r = breakGlass.validate({
      action: 'approve',
      tenantId: 'tA',
      id: 'b1',
    });
    expect(r.ok).toBe(false);
  });

  it('accepts approve with approverId', () => {
    const r = breakGlass.validate({
      action: 'approve',
      tenantId: 'tA',
      id: 'b1',
      approverId: 'mlro-2',
    });
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// zk cross-tenant
// ---------------------------------------------------------------------------

describe('brain-zk-cross-tenant validate', () => {
  it('rejects missing saltVersion', () => {
    expect(zkXt.validate({ action: 'aggregate' }).ok).toBe(false);
  });

  it('accepts aggregate with saltVersion', () => {
    expect(zkXt.validate({ action: 'aggregate', saltVersion: 'v1' }).ok).toBe(true);
  });

  it('rejects commit with bad listName', () => {
    const r = zkXt.validate({
      action: 'commit',
      tenantId: 'tA',
      saltVersion: 'v1',
      observation: { subjectKey: 'k', tsDay: '2026-04-14', listName: 'FOO' },
    });
    expect(r.ok).toBe(false);
  });

  it('rejects commit with bad tsDay', () => {
    const r = zkXt.validate({
      action: 'commit',
      tenantId: 'tA',
      saltVersion: 'v1',
      observation: { subjectKey: 'k', tsDay: '04-14-2026', listName: 'UN' },
    });
    expect(r.ok).toBe(false);
  });

  it('accepts valid commit', () => {
    const r = zkXt.validate({
      action: 'commit',
      tenantId: 'tA',
      saltVersion: 'v1',
      observation: { subjectKey: 'k', tsDay: '2026-04-14', listName: 'UN' },
    });
    expect(r.ok).toBe(true);
  });
});
