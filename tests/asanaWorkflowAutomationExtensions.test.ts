/**
 * Tests for the Asana weaponization pass additions to
 * asanaWorkflowAutomation.ts:
 *   - STR_LIFECYCLE_DEPENDENCIES DAG
 *   - buildKanbanCaseFolderTemplate
 *   - COMPLIANCE_WORKFLOW_RULES additions (RL-04, RL-05, RL-06)
 *   - SLA_ESCALATION_LADDER
 */
import { describe, it, expect } from 'vitest';
import {
  STR_LIFECYCLE_DEPENDENCIES,
  validateNoCycles,
  buildKanbanCaseFolderTemplate,
  COMPLIANCE_WORKFLOW_RULES,
  SLA_ESCALATION_LADDER,
} from '@/services/asanaWorkflowAutomation';
import {
  STR_SUBTASK_STAGES,
} from '@/services/strSubtaskLifecycle';
import { KANBAN_COLUMNS, sectionNameToColumn } from '@/services/asanaKanbanView';

describe('STR_LIFECYCLE_DEPENDENCIES', () => {
  it('has no cycles', () => {
    expect(validateNoCycles(STR_LIFECYCLE_DEPENDENCIES)).toBe(true);
  });

  it('every node matches a strSubtaskLifecycle stage', () => {
    const stages = new Set<string>(STR_SUBTASK_STAGES);
    for (const edge of STR_LIFECYCLE_DEPENDENCIES) {
      expect(stages.has(edge.parent)).toBe(true);
      expect(stages.has(edge.blockedBy)).toBe(true);
    }
  });

  it('close depends on both retain-10y and monitor-ack', () => {
    const closeEdges = STR_LIFECYCLE_DEPENDENCIES.filter((e) => e.parent === 'close');
    const blockedBy = closeEdges.map((e) => e.blockedBy);
    expect(blockedBy).toContain('retain-10y');
    expect(blockedBy).toContain('monitor-ack');
  });

  it('four-eyes is blocked by mlro-review (gate order)', () => {
    const fourEyes = STR_LIFECYCLE_DEPENDENCIES.find((e) => e.parent === 'four-eyes');
    expect(fourEyes?.blockedBy).toBe('mlro-review');
  });

  it('goaml-xml is blocked by four-eyes (no XML before approval)', () => {
    const goaml = STR_LIFECYCLE_DEPENDENCIES.find((e) => e.parent === 'goaml-xml');
    expect(goaml?.blockedBy).toBe('four-eyes');
  });
});

describe('buildKanbanCaseFolderTemplate', () => {
  it('section names map cleanly to all 5 Kanban columns', () => {
    const template = buildKanbanCaseFolderTemplate('Test Co');
    const columns = new Set<string>();
    for (const section of template.sections) {
      const col = sectionNameToColumn(section);
      expect(col).toBeDefined();
      if (col) columns.add(col);
    }
    // Every canonical Kanban column must be covered by a template section
    // — otherwise a new project rendered in the Kanban view would have
    // an empty column that the user can't drop into from a section move.
    for (const col of KANBAN_COLUMNS) {
      expect(columns.has(col)).toBe(true);
    }
  });

  it('prefixes the template name with the customer name', () => {
    expect(buildKanbanCaseFolderTemplate('Acme Gold').name).toContain('Acme Gold');
  });
});

describe('COMPLIANCE_WORKFLOW_RULES — weaponization additions', () => {
  it('includes the Blocked section notification rule (RL-04)', () => {
    const rule = COMPLIANCE_WORKFLOW_RULES.find((r) => r.id === 'RL-04');
    expect(rule).toBeDefined();
    expect(rule?.action).toBe('notify');
    expect(rule?.citation).toContain('Cabinet Res 134/2025');
  });

  it('includes the STR four-eyes routing rule (RL-05)', () => {
    const rule = COMPLIANCE_WORKFLOW_RULES.find((r) => r.id === 'RL-05');
    expect(rule).toBeDefined();
    expect(rule?.action).toBe('move_to_section');
    expect(rule?.target).toBe('Four-Eyes Review');
    expect(rule?.citation).toContain('FDL No.10/2025 Art.26-27');
  });

  it('includes the EOCN freeze MLRO assignment rule (RL-06)', () => {
    const rule = COMPLIANCE_WORKFLOW_RULES.find((r) => r.id === 'RL-06');
    expect(rule).toBeDefined();
    expect(rule?.action).toBe('assign');
    expect(rule?.target).toBe('MLRO');
    expect(rule?.citation).toContain('Cabinet Res 74/2020');
  });

  it('every rule still carries a citation after additions', () => {
    for (const rule of COMPLIANCE_WORKFLOW_RULES) {
      expect(rule.citation.length).toBeGreaterThan(0);
    }
  });
});

describe('SLA_ESCALATION_LADDER', () => {
  it('defines a monotonic ladder from CO up to REGULATOR', () => {
    const order = ['CO', 'MLRO', 'BOARD', 'REGULATOR'] as const;
    for (const rung of SLA_ESCALATION_LADDER) {
      const fromIdx = order.indexOf(rung.from);
      const toIdx = order.indexOf(rung.to);
      // `to` must be the same rung (terminal REGULATOR self-loop) or
      // higher; promotion must never demote.
      expect(toIdx).toBeGreaterThanOrEqual(fromIdx);
    }
  });

  it('breakglass triggers on MLRO and above', () => {
    const mlroUp = SLA_ESCALATION_LADDER.filter(
      (r) => r.from === 'MLRO' || r.from === 'BOARD' || r.from === 'REGULATOR'
    );
    for (const rung of mlroUp) {
      expect(rung.breakglass).toBe(true);
    }
  });

  it('every rung has a regulatory citation', () => {
    for (const rung of SLA_ESCALATION_LADDER) {
      expect(rung.citation.length).toBeGreaterThan(0);
    }
  });
});
