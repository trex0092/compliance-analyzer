/**
 * Tests for netlify/functions/brain.mts routing + validation.
 *
 * Pure-logic tests — no fetch, no Netlify runtime. We import the internal
 * `__test__` helpers directly so the test is hermetic.
 */
import { describe, it, expect } from 'vitest';

// The brain endpoint is a .mts file. Vitest can transform it.
// @ts-expect-error — no type declarations for the .mts at test time
import { __test__ } from '../netlify/functions/brain.mts';

const { route, validate } = __test__;

describe('brain endpoint: validate()', () => {
  it('rejects non-object body', () => {
    expect(validate(null).ok).toBe(false);
    expect(validate('string').ok).toBe(false);
    expect(validate(42).ok).toBe(false);
  });

  it('rejects unknown kind', () => {
    const r = validate({ kind: 'nuke_everything', severity: 'high', summary: 'x' });
    expect(r.ok).toBe(false);
  });

  it('rejects unknown severity', () => {
    const r = validate({ kind: 'str_saved', severity: 'apocalyptic', summary: 'x' });
    expect(r.ok).toBe(false);
  });

  it('rejects empty or oversize summary', () => {
    expect(validate({ kind: 'manual', severity: 'info', summary: '' }).ok).toBe(false);
    expect(validate({ kind: 'manual', severity: 'info', summary: 'x'.repeat(600) }).ok).toBe(false);
  });

  it('rejects out-of-range matchScore', () => {
    const bad = validate({
      kind: 'sanctions_match',
      severity: 'high',
      summary: 'hit',
      matchScore: 1.5,
    });
    expect(bad.ok).toBe(false);
  });

  it('strips newlines from free-text fields (log-injection defense)', () => {
    const r = validate({
      kind: 'manual',
      severity: 'info',
      summary: 'line1\nline2\rline3',
      subject: 'bad\nactor',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.event.summary).not.toContain('\n');
      expect(r.event.summary).not.toContain('\r');
      expect(r.event.subject).not.toContain('\n');
    }
  });

  it('accepts a well-formed event', () => {
    const r = validate({
      kind: 'sanctions_match',
      severity: 'critical',
      summary: 'OFAC hit on counterparty',
      subject: 'Acme Corp',
      matchScore: 0.95,
      refId: 'CRA-123',
    });
    expect(r.ok).toBe(true);
  });
});

describe('brain endpoint: route()', () => {
  it('confirmed sanctions match → 24h freeze protocol', () => {
    const d = route({
      kind: 'sanctions_match',
      severity: 'critical',
      summary: 'hit',
      matchScore: 0.95,
    });
    expect(d.tool).toBe('screening');
    expect(d.escalate).toBe(true);
    expect(d.autoActions).toContain('freeze_assets:immediate');
    expect(d.autoActions).toContain('start_eocn_countdown:24h');
    expect(d.autoActions).toContain('schedule_cnmr_filing:5bd');
    // No tipping off — FDL Art.29
    expect(d.autoActions).toContain('suppress_subject_notification:FDL_Art29');
  });

  it('potential sanctions match → four-eyes review', () => {
    const d = route({
      kind: 'sanctions_match',
      severity: 'high',
      summary: 'partial hit',
      matchScore: 0.7,
    });
    expect(d.autoActions).toContain('escalate_to_co');
    expect(d.autoActions).toContain('require_four_eyes_review');
    // Must not auto-freeze on a potential match
    expect(d.autoActions).not.toContain('freeze_assets:immediate');
  });

  it('low-confidence hit → log and dismiss', () => {
    const d = route({
      kind: 'sanctions_match',
      severity: 'low',
      summary: 'weak hit',
      matchScore: 0.2,
    });
    expect(d.autoActions).toContain('log_dismissal_with_rationale');
    expect(d.autoActions).not.toContain('freeze_assets:immediate');
  });

  it('STR saved → applies FDL Art.29 confidentiality lock', () => {
    const d = route({ kind: 'str_saved', severity: 'high', summary: 'STR draft' });
    expect(d.autoActions).toContain('apply_confidentiality_lock:FDL_Art29');
    expect(d.autoActions).toContain('start_deadline_tracker:str');
  });

  it('threshold breach → escalates and holds transaction', () => {
    const d = route({ kind: 'threshold_breach', severity: 'high', summary: 'AED 55K' });
    expect(d.escalate).toBe(true);
    expect(d.autoActions).toContain('freeze_transaction_pending_review');
  });

  it('evidence chain break → forensic freeze + Cachet publish', () => {
    const d = route({ kind: 'evidence_break', severity: 'critical', summary: 'broken' });
    expect(d.autoActions).toContain('freeze_all_new_records');
    expect(d.autoActions).toContain('publish_cachet_incident');
    expect(d.escalate).toBe(true);
  });

  it('never auto-notifies the subject on any route', () => {
    const kinds = [
      'str_saved',
      'sanctions_match',
      'threshold_breach',
      'deadline_missed',
      'cdd_overdue',
      'evidence_break',
      'manual',
    ] as const;
    for (const kind of kinds) {
      const d = route({
        kind,
        severity: 'high',
        summary: 's',
        matchScore: kind === 'sanctions_match' ? 0.95 : undefined,
      });
      for (const action of d.autoActions) {
        expect(action).not.toMatch(/notify.?subject|tip.?off|email.?customer/i);
      }
    }
  });
});
