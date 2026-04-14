/**
 * Cross-mirror integration test for the post-dispatch hook.
 *
 * The autoDispatchListener post-dispatch hook fans the same
 * DispatchAuditEntry into THREE mirrors:
 *
 *   1. asanaAuditLogMirror  → durable FDL Art.24 retention copy
 *   2. asanaCentralMlroMirror → MLRO triage queue (filtered)
 *   3. asanaInspectorMirror  → regulator-facing audit trail (filtered + sanitised)
 *
 * Every mirror has its own unit tests covering its own filter,
 * builder, and degradation contract. This file tests the
 * INTERSECTION — what happens when the same audit entry threads
 * through all three at once. It catches:
 *
 *   - Sanitisation drift (e.g. accidentally leaking the parent
 *     gid into the inspector view via a copy-paste from the
 *     central mirror)
 *   - Filter inconsistency (e.g. the central MLRO mirror catching
 *     a freeze but the inspector mirror missing it)
 *   - Custom-field bleed (e.g. the manual-action chip leaking
 *     into the inspector view because all three mirrors share
 *     buildComplianceCustomFields)
 *   - Tag taxonomy drift (each mirror should land in a distinct
 *     saved-search namespace)
 *
 * No mocks. Pure builders + pure filters.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (CO duty of care — every mirror
 *     must agree on what the dispatcher decided)
 *   - FDL No.10/2025 Art.24 (10-year retention via mirrors)
 *   - Cabinet Res 134/2025 Art.19 (auditable internal review)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildAuditMirrorTaskPayload,
} from '@/services/asanaAuditLogMirror';
import {
  buildCentralMlroTaskPayload,
  needsMlroTriage,
} from '@/services/asanaCentralMlroMirror';
import {
  buildInspectorTaskPayload,
  needsInspectorEvidence,
} from '@/services/asanaInspectorMirror';
import type { DispatchAuditEntry } from '@/services/dispatchAuditLog';

// Wipe every CF env between tests so degradation paths are exercised
// by default and individual specs opt in by setting the GIDs they
// need.
const CF_KEYS = [
  'ASANA_CF_VERDICT_GID',
  'ASANA_CF_VERDICT_FREEZE',
  'ASANA_CF_VERDICT_ESCALATE',
  'ASANA_CF_VERDICT_PASS',
  'ASANA_CF_VERDICT_FLAG',
  'ASANA_CF_CASE_ID_GID',
  'ASANA_CF_CONFIDENCE_GID',
  'ASANA_CF_REGULATION_GID',
  'ASANA_CF_DEADLINE_TYPE_GID',
  'ASANA_CF_DEADLINE_TYPE_EOCN',
  'ASANA_CF_MANUAL_ACTION_GID',
  'ASANA_CF_MANUAL_ACTION_PENDING',
];

beforeEach(() => {
  for (const k of CF_KEYS) delete process.env[k];
});

function freezeEntry(): DispatchAuditEntry {
  return {
    id: 'audit_case-99_2026-04-14T10:00:00.000Z',
    dispatchedAtIso: '2026-04-14T10:00:00.000Z',
    caseId: 'case-99',
    verdict: 'freeze',
    confidence: 0.96,
    suggestedColumn: 'blocked',
    parentGid: 'CUSTOMER_TASK_99887766',
    strSubtaskCount: 3,
    fourEyesCount: 2,
    kanbanMoveOk: true,
    annotatedCount: 5,
    errors: [],
    warnings: ['internal MLRO drafting note: TBD'],
    trigger: 'listener',
    dispatcherVersion: '1.0.0',
  };
}

function passEntry(): DispatchAuditEntry {
  return {
    id: 'audit_case-77_2026-04-14T10:00:00.000Z',
    dispatchedAtIso: '2026-04-14T10:00:00.000Z',
    caseId: 'case-77',
    verdict: 'pass',
    confidence: 0.98,
    suggestedColumn: 'done',
    parentGid: 'CUSTOMER_TASK_55443322',
    strSubtaskCount: 0,
    fourEyesCount: 0,
    kanbanMoveOk: true,
    annotatedCount: 0,
    errors: [],
    warnings: [],
    trigger: 'listener',
    dispatcherVersion: '1.0.0',
  };
}

// ---------------------------------------------------------------------------
// FREEZE — fans into all 3 mirrors, with distinct sanitisation guarantees
// ---------------------------------------------------------------------------

describe('integration: freeze entry threads through all 3 mirrors', () => {
  it('all 3 filters accept the freeze', () => {
    const entry = freezeEntry();
    expect(needsMlroTriage(entry)).toBe(true);
    expect(needsInspectorEvidence(entry)).toBe(true);
    // The audit log mirror has no filter — every entry is durable.
  });

  it('produces 3 distinct task names', () => {
    const entry = freezeEntry();
    const audit = buildAuditMirrorTaskPayload({ entry, projectGid: 'AUDIT' });
    const central = buildCentralMlroTaskPayload({ entry, projectGid: 'CENTRAL' });
    const inspector = buildInspectorTaskPayload({ entry, projectGid: 'INSPECTOR' });

    expect(audit.name).not.toBe(central.name);
    expect(central.name).not.toBe(inspector.name);
    expect(audit.name).not.toBe(inspector.name);

    // Each mirror has its own naming convention — assert they
    // correspond to the visual prefixes the MLRO sees.
    expect(audit.name).toMatch(/^audit-/);
    expect(central.name).toMatch(/^\[FREEZE\]/);
    expect(inspector.name).toMatch(/^\[INSPECTOR\]/);
  });

  it('all 3 reference the same audit-log entry id (cross-reference chain)', () => {
    const entry = freezeEntry();
    const audit = buildAuditMirrorTaskPayload({ entry, projectGid: 'AUDIT' });
    const central = buildCentralMlroTaskPayload({ entry, projectGid: 'CENTRAL' });
    const inspector = buildInspectorTaskPayload({ entry, projectGid: 'INSPECTOR' });

    // The same audit-log entry id appears in all 3 mirrors so an
    // inspector / MLRO can pivot from any view back to the source
    // record in the 10-year retention store.
    expect(audit.notes).toContain(entry.id);
    expect(central.notes).toContain(entry.id);
    expect(inspector.notes).toContain(entry.id);
  });

  it('parent gid leak boundary: present in audit + central, ABSENT in inspector', () => {
    const entry = freezeEntry();
    const audit = buildAuditMirrorTaskPayload({ entry, projectGid: 'AUDIT' });
    const central = buildCentralMlroTaskPayload({ entry, projectGid: 'CENTRAL' });
    const inspector = buildInspectorTaskPayload({ entry, projectGid: 'INSPECTOR' });

    // Audit log dumps the full entry (machine-readable retention).
    expect(audit.notes).toContain('CUSTOMER_TASK_99887766');
    // Central MLRO links back to the source task for one-click context jump.
    expect(central.notes).toContain('CUSTOMER_TASK_99887766');
    // Inspector view MUST NOT leak the operational task gid.
    expect(inspector.notes).not.toContain('CUSTOMER_TASK_99887766');
    // Belt-and-braces: no Asana deep link to the customer project.
    expect(inspector.notes).not.toContain('app.asana.com/0/0/');
  });

  it('drafting-note leak boundary: warnings in audit, NOT in inspector', () => {
    const entry = freezeEntry();
    const audit = buildAuditMirrorTaskPayload({ entry, projectGid: 'AUDIT' });
    const inspector = buildInspectorTaskPayload({ entry, projectGid: 'INSPECTOR' });

    // Audit log preserves warnings for full reconstruction.
    expect(audit.notes).toContain('TBD');
    // Inspector view drops warnings to avoid leaking internal MLRO
    // drafting content. The literal 'TBD' (which only appears in
    // the warning string) is the canary — its absence proves the
    // warning was stripped. Note: the inspector access-notes
    // footer DOES use the word "drafting" in an explanatory
    // sentence ("PII, internal MLRO drafting notes ... omitted")
    // so we test for the leaked PAYLOAD, not the explanatory word.
    expect(inspector.notes).not.toContain('TBD');
  });

  it('manual-action chip boundary: set on central ONLY, not on audit or inspector', () => {
    process.env.ASANA_CF_MANUAL_ACTION_GID = 'MANUAL_FIELD';
    process.env.ASANA_CF_MANUAL_ACTION_PENDING = 'MANUAL_PENDING_OPT';
    const entry = freezeEntry();

    const audit = buildAuditMirrorTaskPayload({ entry, projectGid: 'AUDIT' });
    const central = buildCentralMlroTaskPayload({ entry, projectGid: 'CENTRAL' });
    const inspector = buildInspectorTaskPayload({ entry, projectGid: 'INSPECTOR' });

    // Central MLRO mirror sets the chip on freeze (operational signal).
    expect(central.custom_fields?.MANUAL_FIELD).toBe('MANUAL_PENDING_OPT');
    // Audit log mirror does NOT set the chip — it's not an
    // operational view, it's the durable record.
    expect(audit.custom_fields?.MANUAL_FIELD).toBeUndefined();
    // Inspector mirror MUST NOT set the chip — inspectors should
    // see what the analyzer DECIDED, not the operational state of
    // the MLRO's bank-portal workflow.
    expect(inspector.custom_fields?.MANUAL_FIELD).toBeUndefined();
  });

  it('EOCN deadline chip boundary: set on central ONLY for freeze', () => {
    process.env.ASANA_CF_DEADLINE_TYPE_GID = 'DEADLINE_FIELD';
    process.env.ASANA_CF_DEADLINE_TYPE_EOCN = 'EOCN_OPT';
    const entry = freezeEntry();

    const audit = buildAuditMirrorTaskPayload({ entry, projectGid: 'AUDIT' });
    const central = buildCentralMlroTaskPayload({ entry, projectGid: 'CENTRAL' });
    const inspector = buildInspectorTaskPayload({ entry, projectGid: 'INSPECTOR' });

    // Central MLRO mirror auto-attaches EOCN for the 24h rollup.
    expect(central.custom_fields?.DEADLINE_FIELD).toBe('EOCN_OPT');
    // Audit log mirror doesn't attach a deadline type — it's not a
    // deadline tracker.
    expect(audit.custom_fields?.DEADLINE_FIELD).toBeUndefined();
    // Inspector mirror doesn't attach a deadline type — same reason.
    expect(inspector.custom_fields?.DEADLINE_FIELD).toBeUndefined();
  });

  it('regulatory citation differs by mirror (FDL Art.24 vs Cabinet Res 74/2020)', () => {
    process.env.ASANA_CF_REGULATION_GID = 'REG_FIELD';
    const entry = freezeEntry();

    const audit = buildAuditMirrorTaskPayload({ entry, projectGid: 'AUDIT' });
    const central = buildCentralMlroTaskPayload({ entry, projectGid: 'CENTRAL' });
    const inspector = buildInspectorTaskPayload({ entry, projectGid: 'INSPECTOR' });

    // Audit log = retention citation.
    expect(audit.custom_fields?.REG_FIELD).toBe('FDL No.10/2025 Art.24');
    // Central MLRO mirror cites the freeze-action article on freeze.
    expect(central.custom_fields?.REG_FIELD).toBe('Cabinet Res 74/2020 Art.4-7');
    // Inspector cites retention.
    expect(inspector.custom_fields?.REG_FIELD).toBe('FDL No.10/2025 Art.24');
  });

  it('tag taxonomy is fully disjoint across the 3 mirrors', () => {
    const entry = freezeEntry();
    const audit = buildAuditMirrorTaskPayload({ entry, projectGid: 'AUDIT' });
    const central = buildCentralMlroTaskPayload({ entry, projectGid: 'CENTRAL' });
    const inspector = buildInspectorTaskPayload({ entry, projectGid: 'INSPECTOR' });

    // Each mirror lands in its own saved-search namespace.
    expect(audit.tags).toContain('audit-log-mirror');
    expect(central.tags).toContain('central-mlro-triage');
    expect(inspector.tags).toContain('inspector-evidence');

    // No mirror should accidentally inherit another mirror's tag.
    expect(audit.tags).not.toContain('central-mlro-triage');
    expect(audit.tags).not.toContain('inspector-evidence');
    expect(central.tags).not.toContain('audit-log-mirror');
    expect(central.tags).not.toContain('inspector-evidence');
    expect(inspector.tags).not.toContain('audit-log-mirror');
    expect(inspector.tags).not.toContain('central-mlro-triage');
  });

  it('all 3 mirrors agree on the verdict tag', () => {
    const entry = freezeEntry();
    const audit = buildAuditMirrorTaskPayload({ entry, projectGid: 'AUDIT' });
    const central = buildCentralMlroTaskPayload({ entry, projectGid: 'CENTRAL' });
    const inspector = buildInspectorTaskPayload({ entry, projectGid: 'INSPECTOR' });

    expect(audit.tags).toContain('verdict:freeze');
    expect(central.tags).toContain('verdict:freeze');
    expect(inspector.tags).toContain('verdict:freeze');
  });

  it('all 3 mirrors target their configured project (no cross-routing)', () => {
    const entry = freezeEntry();
    const audit = buildAuditMirrorTaskPayload({ entry, projectGid: 'AUDIT_PROJ' });
    const central = buildCentralMlroTaskPayload({ entry, projectGid: 'CENTRAL_PROJ' });
    const inspector = buildInspectorTaskPayload({ entry, projectGid: 'INSPECTOR_PROJ' });

    expect(audit.projects).toEqual(['AUDIT_PROJ']);
    expect(central.projects).toEqual(['CENTRAL_PROJ']);
    expect(inspector.projects).toEqual(['INSPECTOR_PROJ']);
  });
});

// ---------------------------------------------------------------------------
// CLEAN PASS — only audit log mirrors, central + inspector skip
// ---------------------------------------------------------------------------

describe('integration: clean pass entry skips operational + inspector mirrors', () => {
  it('central MLRO filter rejects the clean pass', () => {
    expect(needsMlroTriage(passEntry())).toBe(false);
  });

  it('inspector filter rejects the clean pass', () => {
    expect(needsInspectorEvidence(passEntry())).toBe(false);
  });

  it('audit log mirror still processes the clean pass (durable retention is unconditional)', () => {
    const entry = passEntry();
    const audit = buildAuditMirrorTaskPayload({ entry, projectGid: 'AUDIT' });
    expect(audit.notes).toContain('case-77');
    expect(audit.tags).toContain('verdict:pass');
  });
});

// ---------------------------------------------------------------------------
// EDGE CASES — pass with side effects forces inspector mirror only
// ---------------------------------------------------------------------------

describe('integration: pass with side effects routes to inspector but not central', () => {
  it('pass with STR subtasks: central skips, inspector accepts', () => {
    const entry = passEntry();
    entry.strSubtaskCount = 2;
    expect(needsMlroTriage(entry)).toBe(false);
    expect(needsInspectorEvidence(entry)).toBe(true);
  });

  it('pass with four-eyes subtasks: central skips, inspector accepts', () => {
    const entry = passEntry();
    entry.fourEyesCount = 1;
    expect(needsMlroTriage(entry)).toBe(false);
    expect(needsInspectorEvidence(entry)).toBe(true);
  });

  it('pass with dispatch errors: central skips, inspector accepts', () => {
    const entry = passEntry();
    (entry as { errors: string[] }).errors = ['kanban move failed'];
    expect(needsMlroTriage(entry)).toBe(false);
    expect(needsInspectorEvidence(entry)).toBe(true);
  });

  it('pass that lands in blocked column: central accepts, inspector skips', () => {
    // Column-only blocked (without verdict freeze/escalate, without
    // STR/four-eyes/errors) is an operational signal — central MLRO
    // wants to see it; inspector evidence does NOT, because nothing
    // regulatory was decided.
    const entry = passEntry();
    entry.suggestedColumn = 'blocked';
    expect(needsMlroTriage(entry)).toBe(true);
    expect(needsInspectorEvidence(entry)).toBe(false);
  });
});
