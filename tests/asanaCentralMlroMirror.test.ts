/**
 * Tests for the central MLRO triage mirror. Focused on:
 *   - The triage filter (needsMlroTriage) — what qualifies, what
 *     doesn't.
 *   - The pure builder (buildCentralMlroTaskPayload) — verdict
 *     prefix, action header by verdict, source link, custom-field
 *     mapping (freeze → EOCN deadline tag, escalate → FDL
 *     citation), tag labels, sanitisation.
 *   - The configuration gate.
 *
 * Async dispatch (mirrorDispatchToCentralMlro) is a thin wrapper
 * around createAsanaTask which is exhaustively tested elsewhere.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildCentralMlroTaskPayload,
  needsMlroTriage,
  isCentralMlroMirrorConfigured,
  getCentralMlroProjectGid,
  __resetCentralMlroMirrorState,
} from '@/services/asanaCentralMlroMirror';
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
  __resetCentralMlroMirrorState();
  delete process.env.ASANA_CENTRAL_MLRO_PROJECT_GID;
  delete process.env.ASANA_TOKEN;
  delete process.env.ASANA_CF_VERDICT_GID;
  delete process.env.ASANA_CF_VERDICT_FREEZE;
  delete process.env.ASANA_CF_VERDICT_ESCALATE;
  delete process.env.ASANA_CF_DEADLINE_TYPE_GID;
  delete process.env.ASANA_CF_DEADLINE_TYPE_EOCN;
});

const baseEntry: DispatchAuditEntry = {
  id: 'audit_case-7_2026-04-14T10:00:00.000Z',
  dispatchedAtIso: '2026-04-14T10:00:00.000Z',
  caseId: 'case-7',
  verdict: 'flag',
  confidence: 0.78,
  suggestedColumn: 'doing',
  parentGid: '12345',
  strSubtaskCount: 0,
  fourEyesCount: 0,
  kanbanMoveOk: true,
  annotatedCount: 1,
  errors: [],
  warnings: [],
  trigger: 'listener',
  dispatcherVersion: '1.0.0',
};

describe('needsMlroTriage', () => {
  it('mirrors freeze verdicts', () => {
    expect(needsMlroTriage({ ...baseEntry, verdict: 'freeze' })).toBe(true);
  });

  it('mirrors escalate verdicts', () => {
    expect(needsMlroTriage({ ...baseEntry, verdict: 'escalate' })).toBe(true);
  });

  it('mirrors anything landing in the blocked column', () => {
    expect(needsMlroTriage({ ...baseEntry, verdict: 'flag', suggestedColumn: 'blocked' })).toBe(
      true
    );
  });

  it('skips pass verdicts in non-blocked columns', () => {
    expect(needsMlroTriage({ ...baseEntry, verdict: 'pass', suggestedColumn: 'done' })).toBe(false);
  });

  it('skips flag verdicts in non-blocked columns', () => {
    expect(needsMlroTriage({ ...baseEntry, verdict: 'flag', suggestedColumn: 'review' })).toBe(
      false
    );
  });
});

describe('buildCentralMlroTaskPayload', () => {
  it('prefixes freeze tasks with [FREEZE] for visual triage sorting', () => {
    const payload = buildCentralMlroTaskPayload({
      entry: { ...baseEntry, verdict: 'freeze', suggestedColumn: 'blocked' },
      projectGid: 'CENTRAL',
    });
    expect(payload.name.startsWith('[FREEZE]')).toBe(true);
    expect(payload.name).toContain('case-7');
  });

  it('prefixes escalate tasks with [ESCALATE]', () => {
    const payload = buildCentralMlroTaskPayload({
      entry: { ...baseEntry, verdict: 'escalate', suggestedColumn: 'review' },
      projectGid: 'CENTRAL',
    });
    expect(payload.name.startsWith('[ESCALATE]')).toBe(true);
  });

  it('prefixes blocked-column tasks with [BLOCKED] when verdict is not freeze/escalate', () => {
    const payload = buildCentralMlroTaskPayload({
      entry: { ...baseEntry, verdict: 'flag', suggestedColumn: 'blocked' },
      projectGid: 'CENTRAL',
    });
    expect(payload.name.startsWith('[BLOCKED]')).toBe(true);
  });

  it('cites Cabinet Res 74/2020 in freeze action header (24h clock)', () => {
    const payload = buildCentralMlroTaskPayload({
      entry: { ...baseEntry, verdict: 'freeze' },
      projectGid: 'CENTRAL',
    });
    expect(payload.notes).toContain('24h MLRO action window starts NOW');
    expect(payload.notes).toContain('Cabinet Res 74/2020 Art.4-7');
  });

  it('cites FDL Art.20-21 in escalate action header (CO duty of care)', () => {
    const payload = buildCentralMlroTaskPayload({
      entry: { ...baseEntry, verdict: 'escalate' },
      projectGid: 'CENTRAL',
    });
    expect(payload.notes).toContain('CO duty of care');
    expect(payload.notes).toContain('FDL No.10/2025 Art.20-21');
  });

  it('embeds a deep link back to the source customer task', () => {
    const payload = buildCentralMlroTaskPayload({
      entry: { ...baseEntry, parentGid: '99887766', verdict: 'freeze' },
      projectGid: 'CENTRAL',
    });
    expect(payload.notes).toContain('https://app.asana.com/0/0/99887766/f');
  });

  it('handles missing parent gid gracefully', () => {
    const entry = { ...baseEntry, verdict: 'freeze' as const };
    delete (entry as { parentGid?: string }).parentGid;
    const payload = buildCentralMlroTaskPayload({ entry, projectGid: 'CENTRAL' });
    expect(payload.notes).toContain('(no parent task gid recorded)');
  });

  it('targets the configured central MLRO project', () => {
    const payload = buildCentralMlroTaskPayload({
      entry: { ...baseEntry, verdict: 'freeze' },
      projectGid: 'CENTRAL_PROJ_ABC',
    });
    expect(payload.projects).toEqual(['CENTRAL_PROJ_ABC']);
  });

  it('tags the task for triage filtering', () => {
    const payload = buildCentralMlroTaskPayload({
      entry: { ...baseEntry, verdict: 'freeze', suggestedColumn: 'blocked' },
      projectGid: 'CENTRAL',
    });
    expect(payload.tags).toContain('central-mlro-triage');
    expect(payload.tags).toContain('verdict:freeze');
    expect(payload.tags).toContain('column:blocked');
    expect(payload.tags).toContain('trigger:listener');
  });

  it('attaches EOCN deadline custom field for freeze verdicts when env GIDs are set', () => {
    process.env.ASANA_CF_DEADLINE_TYPE_GID = 'DEADLINE_FIELD';
    process.env.ASANA_CF_DEADLINE_TYPE_EOCN = 'EOCN_OPT';
    const payload = buildCentralMlroTaskPayload({
      entry: { ...baseEntry, verdict: 'freeze' },
      projectGid: 'CENTRAL',
    });
    expect(payload.custom_fields?.DEADLINE_FIELD).toBe('EOCN_OPT');
  });

  it('does not attach EOCN deadline for escalate verdicts', () => {
    process.env.ASANA_CF_DEADLINE_TYPE_GID = 'DEADLINE_FIELD';
    process.env.ASANA_CF_DEADLINE_TYPE_EOCN = 'EOCN_OPT';
    const payload = buildCentralMlroTaskPayload({
      entry: { ...baseEntry, verdict: 'escalate' },
      projectGid: 'CENTRAL',
    });
    expect(payload.custom_fields?.DEADLINE_FIELD).toBeUndefined();
  });

  it('drops custom fields when env GIDs are unset (degradation contract)', () => {
    const payload = buildCentralMlroTaskPayload({
      entry: { ...baseEntry, verdict: 'freeze' },
      projectGid: 'CENTRAL',
    });
    expect(payload.custom_fields).toEqual({});
  });

  it('sanitizes case ids with unsafe characters', () => {
    const payload = buildCentralMlroTaskPayload({
      entry: { ...baseEntry, caseId: 'CASE/7 [pep]', verdict: 'freeze' },
      projectGid: 'CENTRAL',
    });
    expect(payload.name).not.toMatch(/[/\[\]]/);
  });

  it('formats errors and warnings as bullet lists in notes', () => {
    const payload = buildCentralMlroTaskPayload({
      entry: {
        ...baseEntry,
        verdict: 'freeze',
        errors: ['banking-rail unreachable'],
        warnings: ['confidence below 0.95'],
      },
      projectGid: 'CENTRAL',
    });
    expect(payload.notes).toContain('  - banking-rail unreachable');
    expect(payload.notes).toContain('  - confidence below 0.95');
  });
});

describe('isCentralMlroMirrorConfigured', () => {
  it('returns false when ASANA_CENTRAL_MLRO_PROJECT_GID is unset', () => {
    process.env.ASANA_TOKEN = 'tok';
    expect(isCentralMlroMirrorConfigured()).toBe(false);
  });

  it('returns false when Asana token is unset', () => {
    process.env.ASANA_CENTRAL_MLRO_PROJECT_GID = 'CENTRAL';
    expect(isCentralMlroMirrorConfigured()).toBe(false);
  });

  it('exposes the project gid via getCentralMlroProjectGid', () => {
    process.env.ASANA_CENTRAL_MLRO_PROJECT_GID = 'CENTRAL_ABC';
    expect(getCentralMlroProjectGid()).toBe('CENTRAL_ABC');
  });
});
