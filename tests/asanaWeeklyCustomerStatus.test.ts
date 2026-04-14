/**
 * Tests for the weekly per-customer status summarizer + payload
 * builder. Exercises the pure functions in isolation — the cron
 * function (asana-weekly-customer-status-cron.mts) is a thin
 * wrapper around these so it doesn't need its own test surface.
 */
import { describe, it, expect } from 'vitest';
import {
  summarizeCustomerWeek,
  pickStatusColor,
  buildStatusUpdatePayload,
  type WeeklyStatusTaskInput,
} from '@/services/asanaWeeklyCustomerStatus';

const FROM = '2026-04-07T00:00:00.000Z';
const TO = '2026-04-14T00:00:00.000Z';
const IN_WINDOW = '2026-04-10T12:00:00.000Z';
const BEFORE_WINDOW = '2026-03-15T12:00:00.000Z';

function task(overrides: Partial<WeeklyStatusTaskInput> = {}): WeeklyStatusTaskInput {
  return {
    gid: 'g1',
    name: 'sample',
    completed: false,
    created_at: IN_WINDOW,
    modified_at: IN_WINDOW,
    tags: [],
    memberships: [],
    ...overrides,
  };
}

describe('pickStatusColor', () => {
  it('returns on_track for a clean week', () => {
    expect(pickStatusColor({ freezeCount: 0, escalateCount: 0, errorCount: 0 })).toBe('on_track');
  });

  it('returns at_risk for a single escalate', () => {
    expect(pickStatusColor({ freezeCount: 0, escalateCount: 1, errorCount: 0 })).toBe('at_risk');
  });

  it('returns off_track for any freeze', () => {
    expect(pickStatusColor({ freezeCount: 1, escalateCount: 0, errorCount: 0 })).toBe('off_track');
  });

  it('returns off_track when errors hit 5+ even without verdict events', () => {
    expect(pickStatusColor({ freezeCount: 0, escalateCount: 0, errorCount: 5 })).toBe('off_track');
  });

  it('returns at_risk for 3 errors but no verdict events', () => {
    expect(pickStatusColor({ freezeCount: 0, escalateCount: 0, errorCount: 3 })).toBe('at_risk');
  });

  it('prioritises freeze over error count (always off_track on freeze)', () => {
    expect(pickStatusColor({ freezeCount: 1, escalateCount: 0, errorCount: 99 })).toBe(
      'off_track'
    );
  });
});

describe('summarizeCustomerWeek', () => {
  it('counts verdict tags by category', () => {
    const summary = summarizeCustomerWeek({
      customerId: 'c-1',
      customerLegalName: 'TEST LLC',
      windowFromIso: FROM,
      windowToIso: TO,
      tasks: [
        task({ tags: [{ name: 'verdict:freeze' }] }),
        task({ tags: [{ name: 'verdict:escalate' }] }),
        task({ tags: [{ name: 'verdict:flag' }] }),
        task({ tags: [{ name: 'verdict:flag' }] }),
        task({ tags: [{ name: 'verdict:pass' }] }),
      ],
    });
    expect(summary.freezeCount).toBe(1);
    expect(summary.escalateCount).toBe(1);
    expect(summary.flagCount).toBe(2);
    expect(summary.passCount).toBe(1);
  });

  it('sets the colour to off_track when at least one freeze exists', () => {
    const summary = summarizeCustomerWeek({
      customerId: 'c-1',
      customerLegalName: 'TEST LLC',
      windowFromIso: FROM,
      windowToIso: TO,
      tasks: [task({ tags: [{ name: 'verdict:freeze' }] })],
    });
    expect(summary.color).toBe('off_track');
  });

  it('counts blocked-section tasks separately from verdicts', () => {
    const summary = summarizeCustomerWeek({
      customerId: 'c-1',
      customerLegalName: 'TEST LLC',
      windowFromIso: FROM,
      windowToIso: TO,
      tasks: [
        task({ memberships: [{ section: { name: 'Blocked' } }] }),
        task({ memberships: [{ section: { name: 'In Progress' } }] }),
      ],
    });
    expect(summary.blockedCount).toBe(1);
  });

  it('does not count completed tasks as still-blocked', () => {
    const summary = summarizeCustomerWeek({
      customerId: 'c-1',
      customerLegalName: 'TEST LLC',
      windowFromIso: FROM,
      windowToIso: TO,
      tasks: [
        task({
          completed: true,
          memberships: [{ section: { name: 'Blocked' } }],
        }),
      ],
    });
    expect(summary.blockedCount).toBe(0);
  });

  it('counts active tasks (created or modified) inside the window only', () => {
    const summary = summarizeCustomerWeek({
      customerId: 'c-1',
      customerLegalName: 'TEST LLC',
      windowFromIso: FROM,
      windowToIso: TO,
      tasks: [
        task({ created_at: IN_WINDOW, modified_at: IN_WINDOW }),
        task({ created_at: BEFORE_WINDOW, modified_at: IN_WINDOW }),
        task({ created_at: BEFORE_WINDOW, modified_at: BEFORE_WINDOW }),
      ],
    });
    expect(summary.activeInWindow).toBe(2);
  });

  it('counts completed-in-window separately', () => {
    const summary = summarizeCustomerWeek({
      customerId: 'c-1',
      customerLegalName: 'TEST LLC',
      windowFromIso: FROM,
      windowToIso: TO,
      tasks: [
        task({ completed: true, modified_at: IN_WINDOW }),
        task({ completed: true, modified_at: BEFORE_WINDOW }),
      ],
    });
    expect(summary.completedInWindow).toBe(1);
  });

  it('caps the spotlight at 5 freeze/escalate cases', () => {
    const tasks: WeeklyStatusTaskInput[] = [];
    for (let i = 0; i < 8; i++) {
      tasks.push(task({ name: `case-${i}`, tags: [{ name: 'verdict:freeze' }] }));
    }
    const summary = summarizeCustomerWeek({
      customerId: 'c-1',
      customerLegalName: 'TEST LLC',
      windowFromIso: FROM,
      windowToIso: TO,
      tasks,
    });
    expect(summary.spotlightCases).toHaveLength(5);
    expect(summary.spotlightCases[0]).toBe('case-0');
  });

  it('counts dispatch-error tags', () => {
    const summary = summarizeCustomerWeek({
      customerId: 'c-1',
      customerLegalName: 'TEST LLC',
      windowFromIso: FROM,
      windowToIso: TO,
      tasks: [
        task({ tags: [{ name: 'dispatch-error' }] }),
        task({ tags: [{ name: 'error' }] }),
        task({ tags: [{ name: 'verdict:pass' }] }),
      ],
    });
    expect(summary.errorCount).toBe(2);
  });

  it('returns on_track for a clean customer week', () => {
    const summary = summarizeCustomerWeek({
      customerId: 'c-1',
      customerLegalName: 'TEST LLC',
      windowFromIso: FROM,
      windowToIso: TO,
      tasks: [
        task({ tags: [{ name: 'verdict:pass' }], completed: true }),
        task({ tags: [{ name: 'verdict:pass' }] }),
      ],
    });
    expect(summary.color).toBe('on_track');
  });
});

describe('buildStatusUpdatePayload', () => {
  it('targets the right project as parent', () => {
    const summary = summarizeCustomerWeek({
      customerId: 'c-1',
      customerLegalName: 'TEST LLC',
      windowFromIso: FROM,
      windowToIso: TO,
      tasks: [],
    });
    const payload = buildStatusUpdatePayload(summary, 'PROJ_GID');
    expect(payload.data.parent).toBe('PROJ_GID');
  });

  it('uses the summary colour as status_type', () => {
    const summary = summarizeCustomerWeek({
      customerId: 'c-1',
      customerLegalName: 'TEST LLC',
      windowFromIso: FROM,
      windowToIso: TO,
      tasks: [task({ tags: [{ name: 'verdict:freeze' }] })],
    });
    const payload = buildStatusUpdatePayload(summary, 'PROJ_GID');
    expect(payload.data.status_type).toBe('off_track');
  });

  it('formats the title with the human-readable date window', () => {
    const summary = summarizeCustomerWeek({
      customerId: 'c-1',
      customerLegalName: 'TEST LLC',
      windowFromIso: FROM,
      windowToIso: TO,
      tasks: [],
    });
    const payload = buildStatusUpdatePayload(summary, 'PROJ_GID');
    expect(payload.data.title).toContain('2026-04-07');
    expect(payload.data.title).toContain('2026-04-14');
  });

  it('embeds verdict counts as bullet lines in the body', () => {
    const summary = summarizeCustomerWeek({
      customerId: 'c-1',
      customerLegalName: 'TEST LLC',
      windowFromIso: FROM,
      windowToIso: TO,
      tasks: [
        task({ tags: [{ name: 'verdict:freeze' }] }),
        task({ tags: [{ name: 'verdict:escalate' }] }),
      ],
    });
    const payload = buildStatusUpdatePayload(summary, 'PROJ_GID');
    expect(payload.data.text).toContain('freeze:   1');
    expect(payload.data.text).toContain('escalate: 1');
  });

  it('embeds spotlight cases when present', () => {
    const summary = summarizeCustomerWeek({
      customerId: 'c-1',
      customerLegalName: 'TEST LLC',
      windowFromIso: FROM,
      windowToIso: TO,
      tasks: [task({ name: 'case-spotlight-1', tags: [{ name: 'verdict:freeze' }] })],
    });
    const payload = buildStatusUpdatePayload(summary, 'PROJ_GID');
    expect(payload.data.text).toContain('Cases needing MLRO attention');
    expect(payload.data.text).toContain('case-spotlight-1');
  });

  it('omits the spotlight section when there are no escalate/freeze cases', () => {
    const summary = summarizeCustomerWeek({
      customerId: 'c-1',
      customerLegalName: 'TEST LLC',
      windowFromIso: FROM,
      windowToIso: TO,
      tasks: [task({ tags: [{ name: 'verdict:pass' }] })],
    });
    const payload = buildStatusUpdatePayload(summary, 'PROJ_GID');
    expect(payload.data.text).not.toContain('Cases needing MLRO attention');
  });

  it('cites the regulatory basis in the footer', () => {
    const summary = summarizeCustomerWeek({
      customerId: 'c-1',
      customerLegalName: 'TEST LLC',
      windowFromIso: FROM,
      windowToIso: TO,
      tasks: [],
    });
    const payload = buildStatusUpdatePayload(summary, 'PROJ_GID');
    expect(payload.data.text).toContain('FDL No.10/2025 Art.20-21');
    expect(payload.data.text).toContain('Cabinet Res 134/2025 Art.19');
  });
});
