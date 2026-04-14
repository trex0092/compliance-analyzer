/**
 * Tests for the Asana audit-log mirror. Focused on the pure builder
 * (buildAuditMirrorTaskPayload) and the configuration gating
 * (isAuditMirrorConfigured). The async dispatchers
 * (mirrorAuditEntry, flushAuditLogToAsana) call createAsanaTask
 * which is exercised end-to-end in the asanaClient test suite —
 * we don't re-test the network layer here.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildAuditMirrorTaskPayload,
  getAuditMirrorProjectGid,
  isAuditMirrorConfigured,
  __resetAuditMirrorState,
} from '@/services/asanaAuditLogMirror';
import type { DispatchAuditEntry } from '@/services/dispatchAuditLog';

// Polyfill localStorage for node test runs (matches the pattern
// used in dispatchAuditLog.test.ts).
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
  __resetAuditMirrorState();
  // Wipe any env vars a previous test set.
  delete process.env.ASANA_AUDIT_LOG_PROJECT_GID;
  delete process.env.ASANA_TOKEN;
  delete process.env.ASANA_CF_VERDICT_GID;
  delete process.env.ASANA_CF_VERDICT_FREEZE;
  delete process.env.ASANA_CF_CASE_ID_GID;
});

const SAMPLE_ENTRY: DispatchAuditEntry = {
  id: 'audit_case-42_2026-04-14T08:30:00.000Z',
  dispatchedAtIso: '2026-04-14T08:30:00.000Z',
  caseId: 'case-42',
  verdict: 'freeze',
  confidence: 0.92,
  suggestedColumn: 'blocked',
  parentGid: '99999',
  strSubtaskCount: 3,
  fourEyesCount: 2,
  kanbanMoveOk: true,
  annotatedCount: 5,
  errors: [],
  warnings: ['ubo data stale by 18 days'],
  trigger: 'listener',
  dispatcherVersion: '1.0.0',
};

describe('buildAuditMirrorTaskPayload', () => {
  it('builds a deterministic task name', () => {
    const payload = buildAuditMirrorTaskPayload({
      entry: SAMPLE_ENTRY,
      projectGid: 'PROJ_GID',
    });
    expect(payload.name).toBe('audit-case-42-freeze-2026-04-14');
  });

  it('targets the configured audit project', () => {
    const payload = buildAuditMirrorTaskPayload({
      entry: SAMPLE_ENTRY,
      projectGid: 'PROJ_GID',
    });
    expect(payload.projects).toEqual(['PROJ_GID']);
  });

  it('embeds the full audit entry as JSON in notes for /audit-pack', () => {
    const payload = buildAuditMirrorTaskPayload({
      entry: SAMPLE_ENTRY,
      projectGid: 'PROJ_GID',
    });
    expect(payload.notes).toContain('Machine-readable payload (JSON)');
    expect(payload.notes).toContain('"caseId": "case-42"');
    expect(payload.notes).toContain('"verdict": "freeze"');
    // Human-readable header is also present.
    expect(payload.notes).toContain('Case ID:           case-42');
    expect(payload.notes).toContain('Confidence:        92.0%');
    // Warnings from the entry are surfaced in the human header.
    expect(payload.notes).toContain('ubo data stale');
  });

  it('cites FDL Art.24 in the notes header (regulatory traceability)', () => {
    const payload = buildAuditMirrorTaskPayload({
      entry: SAMPLE_ENTRY,
      projectGid: 'PROJ_GID',
    });
    expect(payload.notes).toContain('FDL No.10/2025 Art.24');
  });

  it('tags the task for downstream filtering', () => {
    const payload = buildAuditMirrorTaskPayload({
      entry: SAMPLE_ENTRY,
      projectGid: 'PROJ_GID',
    });
    expect(payload.tags).toContain('audit-log-mirror');
    expect(payload.tags).toContain('verdict:freeze');
    expect(payload.tags).toContain('trigger:listener');
  });

  it('sanitizes case ids with unsafe characters', () => {
    const entry: DispatchAuditEntry = {
      ...SAMPLE_ENTRY,
      caseId: 'CASE/42 [pep]',
    };
    const payload = buildAuditMirrorTaskPayload({ entry, projectGid: 'PROJ_GID' });
    // Slashes/brackets/spaces collapse to underscores.
    expect(payload.name).not.toMatch(/[/\[\] ]/);
    expect(payload.name).toContain('CASE_42__pep_');
  });

  it('drops custom fields when env GIDs are unset (degradation contract)', () => {
    const payload = buildAuditMirrorTaskPayload({
      entry: SAMPLE_ENTRY,
      projectGid: 'PROJ_GID',
    });
    // No ASANA_CF_* env vars set in beforeEach → empty map.
    expect(payload.custom_fields).toEqual({});
  });

  it('populates verdict + caseId custom fields when env GIDs are set', () => {
    process.env.ASANA_CF_VERDICT_GID = 'VERDICT_FIELD';
    process.env.ASANA_CF_VERDICT_FREEZE = 'VERDICT_OPT_FREEZE';
    process.env.ASANA_CF_CASE_ID_GID = 'CASE_ID_FIELD';
    const payload = buildAuditMirrorTaskPayload({
      entry: SAMPLE_ENTRY,
      projectGid: 'PROJ_GID',
    });
    expect(payload.custom_fields?.VERDICT_FIELD).toBe('VERDICT_OPT_FREEZE');
    expect(payload.custom_fields?.CASE_ID_FIELD).toBe('case-42');
  });

  it('formats errors and warnings as bullet lists in notes', () => {
    const entry: DispatchAuditEntry = {
      ...SAMPLE_ENTRY,
      errors: ['kanban move failed: section not found', 'four-eyes assignee unresolved'],
      warnings: ['confidence below 0.95 threshold'],
    };
    const payload = buildAuditMirrorTaskPayload({ entry, projectGid: 'PROJ_GID' });
    expect(payload.notes).toContain('  - kanban move failed: section not found');
    expect(payload.notes).toContain('  - four-eyes assignee unresolved');
    expect(payload.notes).toContain('  - confidence below 0.95 threshold');
  });
});

describe('isAuditMirrorConfigured', () => {
  it('returns false when ASANA_AUDIT_LOG_PROJECT_GID is unset', () => {
    process.env.ASANA_TOKEN = 'tok';
    expect(isAuditMirrorConfigured()).toBe(false);
  });

  it('returns false when Asana token is unset', () => {
    process.env.ASANA_AUDIT_LOG_PROJECT_GID = 'PROJ';
    // No ASANA_TOKEN — isAsanaConfigured() returns false.
    expect(isAuditMirrorConfigured()).toBe(false);
  });

  it('returns the project gid via getAuditMirrorProjectGid', () => {
    process.env.ASANA_AUDIT_LOG_PROJECT_GID = 'PROJ_GID_ABC';
    expect(getAuditMirrorProjectGid()).toBe('PROJ_GID_ABC');
  });
});
