/**
 * Tests for the regulator-facing inspector evidence mirror.
 * Focused on:
 *   - The needsInspectorEvidence filter — what qualifies, what
 *     doesn't.
 *   - The pure builder (buildInspectorTaskPayload) — sanitised
 *     notes (no parent gid leak, no manual-action chip leak),
 *     custom-field mapping, tag labels.
 *   - The configuration gate.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildInspectorTaskPayload,
  needsInspectorEvidence,
  isInspectorMirrorConfigured,
  getInspectorProjectGid,
  __resetInspectorMirrorState,
} from '@/services/asanaInspectorMirror';
import type { DispatchAuditEntry } from '@/services/dispatchAuditLog';

beforeEach(() => {
  const storage = new Map<string, string>();
  const shim = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
    key: (i: number) => Array.from(storage.keys())[i] ?? null,
    get length() {
      return storage.size;
    },
  };
  (globalThis as { localStorage?: Storage }).localStorage = shim as unknown as Storage;
  __resetInspectorMirrorState();
  delete process.env.ASANA_INSPECTOR_PROJECT_GID;
  delete process.env.ASANA_TOKEN;
  delete process.env.ASANA_CF_VERDICT_GID;
  delete process.env.ASANA_CF_VERDICT_FREEZE;
  delete process.env.ASANA_CF_REGULATION_GID;
  delete process.env.ASANA_CF_MANUAL_ACTION_GID;
  delete process.env.ASANA_CF_MANUAL_ACTION_PENDING;
});

const baseEntry: DispatchAuditEntry = {
  id: 'audit_case-7_2026-04-14T10:00:00.000Z',
  dispatchedAtIso: '2026-04-14T10:00:00.000Z',
  caseId: 'case-7',
  verdict: 'pass',
  confidence: 0.95,
  suggestedColumn: 'done',
  parentGid: '12345',
  strSubtaskCount: 0,
  fourEyesCount: 0,
  kanbanMoveOk: true,
  annotatedCount: 0,
  errors: [],
  warnings: [],
  trigger: 'listener',
  dispatcherVersion: '1.0.0',
};

describe('needsInspectorEvidence', () => {
  it('mirrors freeze verdicts unconditionally', () => {
    expect(needsInspectorEvidence({ ...baseEntry, verdict: 'freeze' })).toBe(true);
  });

  it('mirrors escalate verdicts unconditionally', () => {
    expect(needsInspectorEvidence({ ...baseEntry, verdict: 'escalate' })).toBe(true);
  });

  it('mirrors any entry that produced STR/SAR subtasks', () => {
    expect(needsInspectorEvidence({ ...baseEntry, verdict: 'pass', strSubtaskCount: 1 })).toBe(
      true
    );
  });

  it('mirrors any entry that invoked four-eyes', () => {
    expect(needsInspectorEvidence({ ...baseEntry, verdict: 'flag', fourEyesCount: 2 })).toBe(true);
  });

  it('mirrors any entry with dispatch errors', () => {
    expect(
      needsInspectorEvidence({ ...baseEntry, verdict: 'pass', errors: ['kanban move failed'] })
    ).toBe(true);
  });

  it('skips clean pass verdicts with no side effects', () => {
    expect(needsInspectorEvidence(baseEntry)).toBe(false);
  });

  it('skips clean flag verdicts with no side effects', () => {
    expect(needsInspectorEvidence({ ...baseEntry, verdict: 'flag' })).toBe(false);
  });
});

describe('buildInspectorTaskPayload', () => {
  it('uses an [INSPECTOR]-prefixed neutral title', () => {
    const payload = buildInspectorTaskPayload({
      entry: { ...baseEntry, verdict: 'freeze' },
      projectGid: 'INSPECTOR',
    });
    expect(payload.name).toBe('[INSPECTOR] case-7 — freeze');
  });

  it('targets the configured inspector project', () => {
    const payload = buildInspectorTaskPayload({
      entry: { ...baseEntry, verdict: 'freeze' },
      projectGid: 'INSPECTOR_GID_XYZ',
    });
    expect(payload.projects).toEqual(['INSPECTOR_GID_XYZ']);
  });

  it('omits the parent task deep link from inspector notes (PII boundary)', () => {
    const payload = buildInspectorTaskPayload({
      entry: { ...baseEntry, verdict: 'freeze', parentGid: 'OPS_TASK_99887766' },
      projectGid: 'INSPECTOR',
    });
    // Inspectors must not get a link to the operational customer task.
    expect(payload.notes).not.toContain('OPS_TASK_99887766');
    expect(payload.notes).not.toContain('app.asana.com/0/0/');
  });

  it('omits dispatcher warnings from inspector notes (TBD canary stripped)', () => {
    const payload = buildInspectorTaskPayload({
      entry: {
        ...baseEntry,
        verdict: 'freeze',
        warnings: ['internal MLRO drafting note: TBD'],
      },
      projectGid: 'INSPECTOR',
    });
    // The literal 'TBD' (which only appears in the warning string)
    // is the canary — its absence proves the warning was stripped.
    // Note: the inspector access-notes footer DOES use the word
    // "drafting" in an explanatory sentence ("PII, internal MLRO
    // drafting notes ... omitted") so we test for the leaked
    // PAYLOAD content, not the explanatory footer word.
    expect(payload.notes).not.toContain('TBD');
  });

  it('omits the full machine-readable JSON dump (sanitised view)', () => {
    const payload = buildInspectorTaskPayload({
      entry: { ...baseEntry, verdict: 'freeze' },
      projectGid: 'INSPECTOR',
    });
    expect(payload.notes).not.toContain('Machine-readable payload');
    expect(payload.notes).not.toContain('"caseId"');
  });

  it('includes the audit-log entry id for cross-reference', () => {
    const payload = buildInspectorTaskPayload({
      entry: { ...baseEntry, verdict: 'freeze' },
      projectGid: 'INSPECTOR',
    });
    expect(payload.notes).toContain(baseEntry.id);
  });

  it('cites FDL Art.24 in the inspector notes', () => {
    const payload = buildInspectorTaskPayload({
      entry: { ...baseEntry, verdict: 'freeze' },
      projectGid: 'INSPECTOR',
    });
    expect(payload.notes).toContain('FDL No.10/2025 Art.24');
  });

  it('surfaces regulatory side effect counts (STR + four-eyes)', () => {
    const payload = buildInspectorTaskPayload({
      entry: { ...baseEntry, verdict: 'freeze', strSubtaskCount: 3, fourEyesCount: 2 },
      projectGid: 'INSPECTOR',
    });
    expect(payload.notes).toContain('STR/SAR subtasks created: 3');
    expect(payload.notes).toContain('Four-eyes subtasks:       2');
  });

  it('tags the task as inspector-evidence + verdict + trigger', () => {
    const payload = buildInspectorTaskPayload({
      entry: { ...baseEntry, verdict: 'freeze' },
      projectGid: 'INSPECTOR',
    });
    expect(payload.tags).toContain('inspector-evidence');
    expect(payload.tags).toContain('verdict:freeze');
    expect(payload.tags).toContain('trigger:listener');
  });

  it('does NOT attach the manual-action chip (operational state hidden)', () => {
    process.env.ASANA_CF_MANUAL_ACTION_GID = 'MANUAL_FIELD';
    process.env.ASANA_CF_MANUAL_ACTION_PENDING = 'MANUAL_PENDING';
    const payload = buildInspectorTaskPayload({
      entry: { ...baseEntry, verdict: 'freeze' },
      projectGid: 'INSPECTOR',
    });
    // Inspector should see what was DECIDED, not whether the MLRO
    // has manually executed in the bank portal yet.
    expect(payload.custom_fields?.MANUAL_FIELD).toBeUndefined();
  });

  it('attaches verdict and regulation citation custom fields when configured', () => {
    process.env.ASANA_CF_VERDICT_GID = 'VERDICT_FIELD';
    process.env.ASANA_CF_VERDICT_FREEZE = 'VERDICT_FREEZE_OPT';
    process.env.ASANA_CF_REGULATION_GID = 'REG_FIELD';
    const payload = buildInspectorTaskPayload({
      entry: { ...baseEntry, verdict: 'freeze' },
      projectGid: 'INSPECTOR',
    });
    expect(payload.custom_fields?.VERDICT_FIELD).toBe('VERDICT_FREEZE_OPT');
    expect(payload.custom_fields?.REG_FIELD).toBe('FDL No.10/2025 Art.24');
  });

  it('drops custom fields when env GIDs are unset (degradation contract)', () => {
    const payload = buildInspectorTaskPayload({
      entry: { ...baseEntry, verdict: 'freeze' },
      projectGid: 'INSPECTOR',
    });
    expect(payload.custom_fields).toEqual({});
  });

  it('sanitizes case ids with unsafe characters', () => {
    const payload = buildInspectorTaskPayload({
      entry: { ...baseEntry, caseId: 'CASE/7 [pep]', verdict: 'freeze' },
      projectGid: 'INSPECTOR',
    });
    // The literal unsafe input must NOT appear in the rendered
    // name — slashes, embedded brackets, and spaces are sanitized.
    // (We can't blanket-reject brackets because the [INSPECTOR]
    // prefix legitimately contains them.)
    expect(payload.name).not.toContain('CASE/7 [pep]');
    expect(payload.name).not.toContain('CASE/7');
    // The sanitized value (slashes/brackets/spaces → underscores)
    // is what should appear instead.
    expect(payload.name).toContain('CASE_7__pep_');
  });

  it('formats errors as a bullet list when present', () => {
    const payload = buildInspectorTaskPayload({
      entry: {
        ...baseEntry,
        verdict: 'pass',
        errors: ['kanban move failed', 'four-eyes assignee unresolved'],
      },
      projectGid: 'INSPECTOR',
    });
    expect(payload.notes).toContain('  - kanban move failed');
    expect(payload.notes).toContain('  - four-eyes assignee unresolved');
  });
});

describe('isInspectorMirrorConfigured', () => {
  it('returns false when ASANA_INSPECTOR_PROJECT_GID is unset', () => {
    process.env.ASANA_TOKEN = 'tok';
    expect(isInspectorMirrorConfigured()).toBe(false);
  });

  it('returns false when Asana token is unset', () => {
    process.env.ASANA_INSPECTOR_PROJECT_GID = 'INSPECTOR';
    expect(isInspectorMirrorConfigured()).toBe(false);
  });

  it('exposes the project gid via getInspectorProjectGid', () => {
    process.env.ASANA_INSPECTOR_PROJECT_GID = 'INSPECTOR_ABC';
    expect(getInspectorProjectGid()).toBe('INSPECTOR_ABC');
  });
});
