/**
 * Workflow ↔ Asana template integrity check.
 *
 * Every `create_asana_task` action in workflow-engine.js DEFAULT_RULES
 * must reference an Asana template that exists in
 * integrations-enhanced.js TASK_TEMPLATES.
 *
 * Failures here mean a workflow rule will fire with a generic task
 * name and missing notes — the exact failure mode the MLRO reported
 * in 2026-04 ("workflows are failing"). Keep this test green.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readRoot(file: string): string {
  return readFileSync(resolve(__dirname, '..', file), 'utf8');
}

function listReferencedTemplates(workflowSrc: string): string[] {
  const matches = workflowSrc.matchAll(/template:\s*'([a-z_]+)'/g);
  return Array.from(new Set(Array.from(matches, (m) => m[1])));
}

function listDefinedTemplates(integrationsSrc: string): Set<string> {
  // Match lines like "  edd_review: { name: 'EDD Review: ..."
  const matches = integrationsSrc.matchAll(/^\s+([a-z_]+):\s*\{ name:/gm);
  return new Set(Array.from(matches, (m) => m[1]));
}

describe('workflow rules ↔ Asana templates', () => {
  const wf = readRoot('workflow-engine.js');
  const intg = readRoot('integrations-enhanced.js');
  const referenced = listReferencedTemplates(wf);
  const defined = listDefinedTemplates(intg);

  it('every workflow rule references a defined Asana template', () => {
    const missing = referenced.filter((t) => !defined.has(t));
    expect(missing, 'These templates are referenced by workflow rules but not defined in integrations-enhanced.js TASK_TEMPLATES: ' + JSON.stringify(missing)).toEqual([]);
  });

  it('referenced template list is non-empty (sanity check)', () => {
    expect(referenced.length).toBeGreaterThan(20);
  });

  it('defined template list is non-empty (sanity check)', () => {
    expect(defined.size).toBeGreaterThan(20);
  });
});
