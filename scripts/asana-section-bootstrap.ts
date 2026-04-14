#!/usr/bin/env -S npx tsx
/**
 * asana-section-bootstrap.ts — Asana per-project section provisioner.
 *
 * The Kanban view + section write-back assume each customer compliance
 * project has 5 sections named:
 *
 *   - To Do
 *   - In Progress
 *   - Four-Eyes Review
 *   - Done
 *   - Blocked
 *
 * Without those sections, the brain dispatcher's "move task to
 * Blocked" calls fall back to the project's default section and the
 * Kanban view collapses everything into one column. This script walks
 * COMPANY_REGISTRY, fetches each project's existing sections, and
 * creates the missing canonical ones via:
 *
 *   POST /projects/{project_gid}/sections
 *
 * Idempotent: any section whose name (case-insensitive substring)
 * already maps to a canonical Kanban column via
 * `sectionNameToColumn()` is treated as already-present. Re-running
 * after a partial run is safe.
 *
 * Usage:
 *   ASANA_TOKEN=xxx npx tsx scripts/asana-section-bootstrap.ts
 *   ASANA_TOKEN=xxx npx tsx scripts/asana-section-bootstrap.ts --apply
 *
 * By default the script runs in dry-run mode and prints what WOULD
 * be created. Pass --apply to actually create the sections.
 *
 * Scope: by default, walks both `asanaComplianceProjectGid` and
 * `asanaWorkflowProjectGid` for every entry in COMPANY_REGISTRY.
 * Pass --compliance-only or --workflow-only to limit the scope.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (CO duty of care — visible queue)
 *   - Cabinet Res 134/2025 Art.19 (internal review — work in progress
 *     must be inspectable)
 */

import { COMPANY_REGISTRY } from '../src/domain/customers';
import {
  KANBAN_COLUMNS,
  KANBAN_COLUMN_LABEL,
  sectionNameToColumn,
  type KanbanColumn,
} from '../src/services/asanaKanbanView';

interface AsanaSection {
  gid: string;
  name: string;
}

/**
 * The five canonical sections we want on every customer project.
 * Order is preserved when we POST — Asana renders sections in
 * insertion order, so the operator sees the same column layout in
 * every project.
 */
const CANONICAL_SECTIONS: ReadonlyArray<{ name: string; column: KanbanColumn }> = [
  { name: 'To Do', column: 'todo' },
  { name: 'In Progress', column: 'doing' },
  { name: 'Four-Eyes Review', column: 'review' },
  { name: 'Done', column: 'done' },
  { name: 'Blocked', column: 'blocked' },
];

interface RunOptions {
  apply: boolean;
  scope: 'both' | 'compliance' | 'workflow';
}

function parseArgs(argv: readonly string[]): RunOptions {
  const apply = argv.includes('--apply');
  let scope: RunOptions['scope'] = 'both';
  if (argv.includes('--compliance-only')) scope = 'compliance';
  if (argv.includes('--workflow-only')) scope = 'workflow';
  return { apply, scope };
}

async function fetchProjectSections(
  token: string,
  projectGid: string
): Promise<AsanaSection[]> {
  const res = await fetch(
    `https://app.asana.com/api/1.0/projects/${encodeURIComponent(projectGid)}/sections?opt_fields=gid,name&limit=100`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    throw new Error(`GET /projects/${projectGid}/sections failed: HTTP ${res.status}`);
  }
  const json = (await res.json()) as { data?: AsanaSection[] };
  return json.data ?? [];
}

async function createSection(
  token: string,
  projectGid: string,
  name: string
): Promise<AsanaSection> {
  const res = await fetch(
    `https://app.asana.com/api/1.0/projects/${encodeURIComponent(projectGid)}/sections`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: { name } }),
    }
  );
  if (!res.ok) {
    throw new Error(
      `POST /projects/${projectGid}/sections failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`
    );
  }
  const json = (await res.json()) as { data?: AsanaSection };
  if (!json.data) throw new Error(`Asana returned empty section payload for "${name}"`);
  return json.data;
}

function summarizeProject(
  legalName: string,
  kind: 'compliance' | 'workflow',
  projectGid: string
): string {
  return `${legalName} [${kind} ${projectGid}]`;
}

interface ProjectResult {
  label: string;
  projectGid: string;
  created: string[];
  alreadyPresent: string[];
  errors: string[];
}

async function bootstrapProject(
  token: string,
  label: string,
  projectGid: string,
  apply: boolean
): Promise<ProjectResult> {
  const result: ProjectResult = {
    label,
    projectGid,
    created: [],
    alreadyPresent: [],
    errors: [],
  };

  let existing: AsanaSection[];
  try {
    existing = await fetchProjectSections(token, projectGid);
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
    return result;
  }

  // Build a column → existing section map using the same tolerant
  // matcher the Kanban view uses. If a project already has e.g.
  // "Backlog" we treat it as the To Do column and skip creating
  // a duplicate "To Do" section.
  const coveredColumns = new Set<KanbanColumn>();
  for (const section of existing) {
    const column = sectionNameToColumn(section.name);
    if (column) coveredColumns.add(column);
  }

  for (const canonical of CANONICAL_SECTIONS) {
    if (coveredColumns.has(canonical.column)) {
      result.alreadyPresent.push(`${canonical.name} (${KANBAN_COLUMN_LABEL[canonical.column]})`);
      continue;
    }
    if (!apply) {
      result.created.push(`${canonical.name} (DRY RUN)`);
      coveredColumns.add(canonical.column);
      continue;
    }
    try {
      const created = await createSection(token, projectGid, canonical.name);
      result.created.push(`${created.name} → ${created.gid}`);
      coveredColumns.add(canonical.column);
    } catch (err) {
      result.errors.push(
        `Create "${canonical.name}" failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Sanity check: every canonical Kanban column must now be covered.
  const stillMissing = KANBAN_COLUMNS.filter((c) => !coveredColumns.has(c));
  if (stillMissing.length > 0) {
    result.errors.push(
      `After bootstrap, columns still missing: ${stillMissing.map((c) => KANBAN_COLUMN_LABEL[c]).join(', ')}`
    );
  }

  return result;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const token = process.env.ASANA_TOKEN;

  if (!token) {
    console.error('ASANA_TOKEN must be set');
    process.exit(2);
  }

  console.log(`# Asana section bootstrap`);
  console.log(`# Mode: ${opts.apply ? 'APPLY' : 'DRY-RUN (use --apply to create)'}`);
  console.log(`# Scope: ${opts.scope}`);
  console.log(`# Customers: ${COMPANY_REGISTRY.length}`);
  console.log('');

  const results: ProjectResult[] = [];

  for (const customer of COMPANY_REGISTRY) {
    const targets: Array<{ kind: 'compliance' | 'workflow'; gid?: string }> = [];
    if (opts.scope === 'both' || opts.scope === 'compliance') {
      targets.push({ kind: 'compliance', gid: customer.asanaComplianceProjectGid });
    }
    if (opts.scope === 'both' || opts.scope === 'workflow') {
      targets.push({ kind: 'workflow', gid: customer.asanaWorkflowProjectGid });
    }

    for (const t of targets) {
      if (!t.gid) {
        console.log(`# SKIP ${customer.legalName} [${t.kind}]: no project GID configured`);
        continue;
      }
      const label = summarizeProject(customer.legalName, t.kind, t.gid);
      console.log(`# ${label}`);
      const result = await bootstrapProject(token, label, t.gid, opts.apply);
      results.push(result);
      for (const a of result.alreadyPresent) console.log(`#   ✓ ${a}`);
      for (const c of result.created) console.log(`#   + ${c}`);
      for (const e of result.errors) console.log(`#   ! ${e}`);
      console.log('');
    }
  }

  // Summary footer.
  const totalCreated = results.reduce((sum, r) => sum + r.created.length, 0);
  const totalCovered = results.reduce((sum, r) => sum + r.alreadyPresent.length, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
  console.log('# ─────────────────────────────────────────────');
  console.log(`# Summary:`);
  console.log(`#   Projects processed: ${results.length}`);
  console.log(`#   Sections already present: ${totalCovered}`);
  console.log(`#   Sections ${opts.apply ? 'created' : 'pending creation'}: ${totalCreated}`);
  console.log(`#   Errors: ${totalErrors}`);
  if (!opts.apply) {
    console.log('#');
    console.log('# Re-run with --apply to actually create the sections.');
  }

  if (totalErrors > 0) process.exit(1);
}

const isMain =
  typeof import.meta !== 'undefined' &&
  typeof process !== 'undefined' &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { CANONICAL_SECTIONS, bootstrapProject };
