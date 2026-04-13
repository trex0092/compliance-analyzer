/**
 * Tests for strSubtaskLifecycle — pure builder only. Dispatcher is
 * covered indirectly via type contract; exercising the Asana POST
 * path would require mocking fetch which asanaClient.test.ts already
 * does for the transport layer.
 */
import { describe, it, expect } from 'vitest';
import {
  buildStrParentTaskPayload,
  buildStrSubtaskPayloads,
  STR_SUBTASK_STAGES,
  type StrLifecycleContext,
} from '@/services/strSubtaskLifecycle';

const baseCtx: StrLifecycleContext = {
  strId: 'str-abc',
  caseId: 'case-123',
  entityRef: 'case-123',
  riskLevel: 'critical',
  reasonForSuspicion: 'unexplained third-party payment',
  regulatoryBasis: 'FDL No.10/2025 Art.26-27',
  projectGid: '1213759768596515',
  draftedAtIso: '2026-04-13T12:00:00.000Z', // Monday
};

describe('buildStrParentTaskPayload', () => {
  it('uses the case id in the title, not the entity name (FDL Art.29)', () => {
    const payload = buildStrParentTaskPayload(baseCtx);
    expect(payload.name).toContain('case-123');
    expect(payload.name).not.toContain('MADISON');
    expect(payload.projects).toEqual(['1213759768596515']);
  });

  it('writes regulatory basis into notes', () => {
    const payload = buildStrParentTaskPayload(baseCtx);
    expect(payload.notes).toContain('FDL No.10/2025 Art.26-27');
    expect(payload.notes).toContain('FDL Art.29 — NO TIPPING OFF');
  });

  it('defaults the regulatory basis when omitted', () => {
    const payload = buildStrParentTaskPayload({
      ...baseCtx,
      regulatoryBasis: undefined,
    });
    expect(payload.notes).toContain('FDL No.10/2025 Art.26-27');
  });

  it('sets a due date later than the drafted timestamp', () => {
    const payload = buildStrParentTaskPayload(baseCtx);
    expect(payload.due_on).toBeDefined();
    expect(Date.parse(payload.due_on ?? '')).toBeGreaterThan(
      Date.parse(baseCtx.draftedAtIso)
    );
  });
});

describe('buildStrSubtaskPayloads', () => {
  it('returns exactly 7 subtasks in canonical order', () => {
    const subtasks = buildStrSubtaskPayloads(baseCtx);
    expect(subtasks).toHaveLength(7);
    expect(subtasks.map((s) => s.stage)).toEqual([...STR_SUBTASK_STAGES]);
  });

  it('every subtask has a due date that skips weekends', () => {
    const subtasks = buildStrSubtaskPayloads(baseCtx);
    for (const s of subtasks) {
      const d = new Date(s.due_on);
      const dow = d.getUTCDay();
      expect(dow).not.toBe(0); // sunday
      expect(dow).not.toBe(6); // saturday
    }
  });

  it('subtask due dates are monotonically non-decreasing', () => {
    const subtasks = buildStrSubtaskPayloads(baseCtx);
    const dates = subtasks.map((s) => Date.parse(s.due_on));
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]).toBeGreaterThanOrEqual(dates[i - 1]);
    }
  });

  it('subtask names include the stage label', () => {
    const subtasks = buildStrSubtaskPayloads(baseCtx);
    expect(subtasks[0].name).toContain('MLRO-REVIEW');
    expect(subtasks[1].name).toContain('FOUR-EYES');
    expect(subtasks[2].name).toContain('GOAML-XML');
    expect(subtasks[3].name).toContain('SUBMIT-FIU');
    expect(subtasks[4].name).toContain('RETAIN-10Y');
    expect(subtasks[5].name).toContain('MONITOR-ACK');
    expect(subtasks[6].name).toContain('CLOSE');
  });

  it('never includes the entity legal name in subtask titles', () => {
    const subtasks = buildStrSubtaskPayloads({
      ...baseCtx,
      entityRef: 'MADISON JEWELLERY',
    });
    // The builder uses caseId in the title — entityRef only lands in
    // parent notes. This guards against a refactor that accidentally
    // starts echoing the entity name into subtask titles.
    for (const s of subtasks) {
      expect(s.name).not.toContain('MADISON');
    }
  });

  it('rejects malformed draftedAtIso', () => {
    expect(() =>
      buildStrSubtaskPayloads({ ...baseCtx, draftedAtIso: 'not-a-date' })
    ).toThrow();
  });
});
