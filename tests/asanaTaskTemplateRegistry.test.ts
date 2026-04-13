import { describe, expect, it } from 'vitest';
import {
  getTemplate,
  listTemplates,
  topoSort,
  type TemplateId,
} from '@/services/asanaTaskTemplateRegistry';

const ALL_IDS: TemplateId[] = [
  'str_filing',
  'sanctions_freeze',
  'edd_onboarding',
  'ubo_reverify',
  'drift_incident',
  'breach_response',
  'audit_findings',
  'red_team_miss',
  'policy_update',
  'weekly_digest',
  'breakglass',
];

describe('asanaTaskTemplateRegistry', () => {
  it('exposes a template for every TemplateId', () => {
    for (const id of ALL_IDS) {
      const t = getTemplate(id);
      expect(t.id).toBe(id);
      expect(t.nodes.length).toBeGreaterThan(0);
      expect(t.sections.length).toBeGreaterThan(0);
    }
  });

  it('listTemplates returns all 11 templates', () => {
    expect(listTemplates().length).toBe(ALL_IDS.length);
  });

  it('every template node references real template-internal ids in dependsOn', () => {
    for (const t of listTemplates()) {
      const ids = new Set(t.nodes.map((n) => n.id));
      for (const node of t.nodes) {
        for (const dep of node.dependsOn) {
          expect(ids.has(dep)).toBe(true);
        }
      }
    }
  });

  it('topoSort respects every dependency edge', () => {
    for (const t of listTemplates()) {
      const order = topoSort(t);
      expect(order.length).toBe(t.nodes.length);
      const position = new Map(order.map((id, i) => [id, i]));
      for (const node of t.nodes) {
        for (const dep of node.dependsOn) {
          expect(position.get(dep)!).toBeLessThan(position.get(node.id)!);
        }
      }
    }
  });

  it('the STR filing template requires both four-eyes subtasks before submission', () => {
    const t = getTemplate('str_filing');
    const submission = t.nodes.find((n) => n.id === 'fiu_submission')!;
    expect(submission.dependsOn).toContain('four_eyes_primary');
    expect(submission.dependsOn).toContain('four_eyes_secondary');
  });

  it('the sanctions_freeze template carries the regulatory citation on every node', () => {
    const t = getTemplate('sanctions_freeze');
    for (const node of t.nodes) {
      expect(node.regulatory).toBeDefined();
    }
  });
});
