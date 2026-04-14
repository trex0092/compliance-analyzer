/**
 * Deferred outbound queue tests.
 */
import { describe, it, expect } from 'vitest';
import { DeferredOutboundQueue } from '../src/services/deferredOutboundQueue';

const fixedNow = () => new Date('2026-04-14T12:00:00.000Z');

describe('DeferredOutboundQueue', () => {
  it('enqueues a clean message in pending_mlro_release status', () => {
    const q = new DeferredOutboundQueue();
    const e = q.enqueue({
      tenantId: 'tA',
      recipientRef: 'cust-1',
      channel: 'email',
      subject: 'Updated invoice',
      body: 'Your updated invoice is ready for review.',
      now: fixedNow,
    });
    expect(e.status).toBe('pending_mlro_release');
    expect(e.lintReport.clean).toBe(true);
  });

  it('rejects messages that leak STR status at enqueue time', () => {
    const q = new DeferredOutboundQueue();
    const e = q.enqueue({
      tenantId: 'tA',
      recipientRef: 'cust-1',
      channel: 'email',
      subject: 'Account notice',
      body: 'We have filed a suspicious transaction report on your account.',
      now: fixedNow,
    });
    expect(e.status).toBe('rejected_tipping_off');
    expect(e.lintReport.clean).toBe(false);
  });

  it('rejected messages never move to released', () => {
    const q = new DeferredOutboundQueue();
    const e = q.enqueue({
      tenantId: 'tA',
      recipientRef: 'cust-1',
      channel: 'email',
      subject: 'Notice',
      body: 'We have filed a suspicious transaction report on your account.',
      now: fixedNow,
    });
    expect(e.status).toBe('rejected_tipping_off');
    expect(q.release(e.id, fixedNow)).toBe(false);
  });

  it('release flips clean pending messages', () => {
    const q = new DeferredOutboundQueue();
    const e = q.enqueue({
      tenantId: 'tA',
      recipientRef: 'cust-1',
      channel: 'email',
      subject: 'Welcome',
      body: 'Welcome to our service.',
      now: fixedNow,
    });
    expect(q.release(e.id, fixedNow)).toBe(true);
    const again = q.release(e.id, fixedNow);
    expect(again).toBe(false); // already released
  });

  it('cancel only works on pending', () => {
    const q = new DeferredOutboundQueue();
    const e = q.enqueue({
      tenantId: 'tA',
      recipientRef: 'cust-1',
      channel: 'email',
      subject: 'Welcome',
      body: 'Welcome to our service.',
      now: fixedNow,
    });
    expect(q.cancel(e.id)).toBe(true);
    expect(q.cancel(e.id)).toBe(false);
  });

  it('pending scoped by tenant', () => {
    const q = new DeferredOutboundQueue();
    q.enqueue({
      tenantId: 'tA',
      recipientRef: 'c1',
      channel: 'email',
      subject: 'Hi',
      body: 'Hello',
      now: fixedNow,
    });
    q.enqueue({
      tenantId: 'tB',
      recipientRef: 'c2',
      channel: 'email',
      subject: 'Hi',
      body: 'Hello',
      now: fixedNow,
    });
    expect(q.pending('tA')).toHaveLength(1);
    expect(q.pending('tB')).toHaveLength(1);
    expect(q.pending('tC')).toHaveLength(0);
  });
});
