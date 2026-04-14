/**
 * Break-glass override tests.
 */
import { describe, it, expect } from 'vitest';
import { BreakGlassStore } from '../src/services/breakGlassOverride';

const fixedNow = () => new Date('2026-04-14T12:00:00.000Z');

function cleanRequest(store: BreakGlassStore) {
  return store.request({
    tenantId: 'tA',
    caseId: 'case-1',
    fromVerdict: 'freeze',
    toVerdict: 'escalate',
    justification:
      'Manual review established false-positive freeze on high-value legitimate customer.',
    regulatoryCitation: 'FDL Art.20',
    requestedBy: 'mlro-1',
    now: fixedNow,
  });
}

describe('BreakGlassStore', () => {
  it('request with clean justification lands in pending_second_approval', () => {
    const s = new BreakGlassStore();
    const r = cleanRequest(s);
    expect(r.status).toBe('pending_second_approval');
  });

  it('request with tipping-off text is cancelled', () => {
    const s = new BreakGlassStore();
    const r = s.request({
      tenantId: 'tA',
      caseId: 'case-1',
      fromVerdict: 'flag',
      toVerdict: 'pass',
      justification: 'We filed an STR on the subject already.',
      regulatoryCitation: 'FDL Art.20',
      requestedBy: 'mlro-1',
      now: fixedNow,
    });
    expect(r.status).toBe('cancelled_tipping_off');
  });

  it('self-approval prohibited', () => {
    const s = new BreakGlassStore();
    const r = cleanRequest(s);
    const res = s.approve(r.id, 'mlro-1', fixedNow);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('self_approval_prohibited');
  });

  it('different approver moves to approved', () => {
    const s = new BreakGlassStore();
    const r = cleanRequest(s);
    const res = s.approve(r.id, 'mlro-2', fixedNow);
    expect(res.ok).toBe(true);
    expect(s.get(r.id)!.status).toBe('approved');
  });

  it('cannot approve an unknown id', () => {
    const s = new BreakGlassStore();
    expect(s.approve('missing', 'mlro-2', fixedNow).reason).toBe('unknown_id');
  });

  it('reject path', () => {
    const s = new BreakGlassStore();
    const r = cleanRequest(s);
    const res = s.reject(r.id, 'mlro-2');
    expect(res.ok).toBe(true);
    expect(s.get(r.id)!.status).toBe('rejected');
  });

  it('mark executed only after approval', () => {
    const s = new BreakGlassStore();
    const r = cleanRequest(s);
    const pre = s.markExecuted(r.id, fixedNow);
    expect(pre.ok).toBe(false);
    s.approve(r.id, 'mlro-2', fixedNow);
    const post = s.markExecuted(r.id, fixedNow);
    expect(post.ok).toBe(true);
    expect(s.get(r.id)!.status).toBe('executed');
    expect(s.get(r.id)!.executedAtIso).not.toBeNull();
  });

  it('pending() filters by status', () => {
    const s = new BreakGlassStore();
    cleanRequest(s);
    cleanRequest(s);
    const r3 = cleanRequest(s);
    s.approve(r3.id, 'mlro-2', fixedNow);
    expect(s.pending()).toHaveLength(2);
  });
});
