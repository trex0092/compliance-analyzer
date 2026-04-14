#!/usr/bin/env -S npx tsx
/**
 * asana-inspector-project-bootstrap.ts — provisions the dedicated
 * regulator-facing read-only Asana project used by the inspector
 * mirror (Tier-4 #14 from the Asana setup gap audit).
 *
 * What it does (idempotent):
 *   1. Checks if a project named "🔍 MoE/LBMA Inspector — Read-Only"
 *      already exists in the workspace. If it does, prints the
 *      existing GID and exits.
 *   2. Otherwise creates the project via POST /projects with
 *      privacy='private_to_team' (the operator must add the
 *      inspector as a member with view-only access manually —
 *      Asana doesn't expose per-member view-only via the API).
 *   3. Creates 5 sections inside it, mirroring the canonical
 *      Kanban layout (To Do / In Progress / Four-Eyes Review /
 *      Done / Blocked) so the inspector view follows the same
 *      taxonomy as the operational projects.
 *   4. Prints the export line for ASANA_INSPECTOR_PROJECT_GID
 *      ready to paste into Netlify env vars.
 *
 * Usage:
 *   ASANA_TOKEN=xxx ASANA_WORKSPACE_GID=xxx \
 *     npx tsx scripts/asana-inspector-project-bootstrap.ts
 *
 *   ASANA_TOKEN=xxx ASANA_WORKSPACE_GID=xxx \
 *     npx tsx scripts/asana-inspector-project-bootstrap.ts --apply
 *
 * Optional:
 *   ASANA_INSPECTOR_TEAM_GID=xxx
 *     If set, the project is created under this team GID. If
 *     omitted, Asana places it in the workspace's default location.
 *
 * IMPORTANT — manual follow-up after running this script:
 *   The script creates the project as private. You must then
 *   1. Open the project in Asana
 *   2. Tap "Share" → add the inspector by email
 *   3. Set their permission to "View only"
 *   That's the only safe pattern — the Asana API cannot guarantee
 *   read-only access on a per-member basis from a script.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (10-year retention — inspector pack)
 *   - LBMA RGG v9 (annual audit pack)
 *   - MoE Circular 08/AML/2021 (DPMS quarterly reporting evidence)
 */

const PROJECT_NAME = '🔍 MoE/LBMA Inspector — Read-Only';
const PROJECT_NOTES = [
  'Regulator-facing read-only Asana project.',
  '',
  'This project receives a sanitised mirror of every compliance',
  'action that the analyzer takes (freeze, escalate, STR/SAR',
  'filing, four-eyes invocation, dispatch errors). PII, internal',
  'MLRO drafting notes, source-task deep links, and operational',
  'state are intentionally omitted from this view.',
  '',
  'Regulatory basis:',
  '  - FDL No.10/2025 Art.24 (10-year retention — inspector pack)',
  '  - LBMA RGG v9 (annual audit pack)',
  '  - MoE Circular 08/AML/2021 (DPMS quarterly reporting evidence)',
  '',
  'Created by scripts/asana-inspector-project-bootstrap.ts.',
].join('\n');

const SECTIONS: readonly string[] = [
  'To Do',
  'In Progress',
  'Four-Eyes Review',
  'Done',
  'Blocked',
];

interface AsanaProject {
  gid: string;
  name: string;
}

interface AsanaSection {
  gid: string;
  name: string;
}

async function findExistingProject(
  token: string,
  workspaceGid: string
): Promise<AsanaProject | undefined> {
  // Asana's project search endpoint is /workspaces/{gid}/projects
  // with limit + opt_fields. Pagination uses offset/next_page; we
  // walk up to 5 pages (500 projects) which is plenty for any
  // realistic compliance workspace.
  let url: string | null = `https://app.asana.com/api/1.0/workspaces/${encodeURIComponent(workspaceGid)}/projects?opt_fields=gid,name&limit=100`;
  for (let page = 0; page < 5 && url; page++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(
        `GET /workspaces/${workspaceGid}/projects failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`
      );
    }
    const json = (await res.json()) as {
      data?: AsanaProject[];
      next_page?: { uri?: string } | null;
    };
    const match = (json.data ?? []).find((p) => p.name === PROJECT_NAME);
    if (match) return match;
    url = json.next_page?.uri ?? null;
  }
  return undefined;
}

async function createProject(
  token: string,
  workspaceGid: string,
  teamGid?: string
): Promise<AsanaProject> {
  const payload: Record<string, unknown> = {
    workspace: workspaceGid,
    name: PROJECT_NAME,
    notes: PROJECT_NOTES,
    // 'private_to_team' means it's not visible to the whole
    // workspace — the operator must explicitly add inspector
    // members. This is the safe default for regulatory data.
    privacy_setting: 'private_to_team',
  };
  if (teamGid) payload.team = teamGid;

  const res = await fetch(`https://app.asana.com/api/1.0/projects`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data: payload }),
  });
  if (!res.ok) {
    throw new Error(
      `POST /projects failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`
    );
  }
  const json = (await res.json()) as { data?: AsanaProject };
  if (!json.data) throw new Error('Asana returned empty project payload');
  return json.data;
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
      `POST /projects/${projectGid}/sections failed for "${name}": HTTP ${res.status} ${(await res.text()).slice(0, 200)}`
    );
  }
  const json = (await res.json()) as { data?: AsanaSection };
  if (!json.data) throw new Error(`Asana returned empty section payload for "${name}"`);
  return json.data;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const token = process.env.ASANA_TOKEN;
  const workspaceGid = process.env.ASANA_WORKSPACE_GID;
  const teamGid = process.env.ASANA_INSPECTOR_TEAM_GID;

  if (!token || !workspaceGid) {
    console.error('ASANA_TOKEN and ASANA_WORKSPACE_GID must be set');
    process.exit(2);
  }

  console.log(`# Asana inspector project bootstrap`);
  console.log(`# Workspace: ${workspaceGid}`);
  console.log(`# Mode:      ${apply ? 'APPLY' : 'DRY-RUN (use --apply to create)'}`);
  console.log(`# Project:   ${PROJECT_NAME}`);
  if (teamGid) console.log(`# Team:      ${teamGid}`);
  console.log('');

  // Idempotency check.
  let existing: AsanaProject | undefined;
  try {
    existing = await findExistingProject(token, workspaceGid);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }

  if (existing) {
    console.log(`# Inspector project already exists: ${existing.gid}`);
    console.log(`export ASANA_INSPECTOR_PROJECT_GID=${existing.gid}`);
    console.log('');
    console.log('# To verify section coverage, run:');
    console.log('#   npm run asana:bootstrap:sections -- --apply');
    return;
  }

  if (!apply) {
    console.log(`# WOULD create project "${PROJECT_NAME}"`);
    console.log(`# WOULD create sections: ${SECTIONS.join(', ')}`);
    console.log('# Re-run with --apply to actually create.');
    return;
  }

  // Apply mode — create project + sections.
  let project: AsanaProject;
  try {
    project = await createProject(token, workspaceGid, teamGid);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }

  console.log(`# Created project: ${project.gid}`);
  console.log(`export ASANA_INSPECTOR_PROJECT_GID=${project.gid}`);
  console.log('');

  for (const sectionName of SECTIONS) {
    try {
      const section = await createSection(token, project.gid, sectionName);
      console.log(`# Created section: ${section.name} → ${section.gid}`);
    } catch (err) {
      console.error(`# ! Failed to create section "${sectionName}":`, err);
    }
  }

  console.log('');
  console.log('# ─────────────────────────────────────────────');
  console.log('# Next steps:');
  console.log('#   1. Open the project in Asana via the UI.');
  console.log('#   2. Tap "Share" → add inspector by email.');
  console.log('#   3. Set their permission to "View only".');
  console.log('#   4. Paste the export line above into Netlify env vars.');
  console.log('#   5. Re-deploy. The inspector mirror activates on the next');
  console.log('#      qualifying dispatch.');
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

export { PROJECT_NAME, SECTIONS };
