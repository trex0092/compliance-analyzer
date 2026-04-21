#!/usr/bin/env -S npx tsx
/**
 * asana-projects-create-19.ts — Create the 19 locked compliance projects.
 *
 * Creates (or reuses, if already present by name) the 19 projects
 * required by the Hawkeye Sterling V2 compliance dispatcher:
 *
 *   1.  Screening — Sanctions & Adverse Media
 *   2.  Central MLRO — Daily Digest
 *   3.  Audit Log — 10-Year Trail
 *   4.  Four-Eyes Approvals
 *   5.  STR/SAR/CTR/PMR — goAML Filings
 *   6.  FFR — Incidents & Asset Freezes
 *   7.  CDD/SDD/EDD/KYC — Customer Due Diligence
 *   8.  Transaction Monitoring
 *   9.  Compliance Ops — Daily & Weekly Tasks
 *   10. Shipments — Tracking
 *   11. Employees
 *   12. Training
 *   13. Compliance Governance
 *   14. Routines — Scheduled
 *   15. MLRO Workbench
 *   16. Supply Chain, ESG & LBMA Gold
 *   17. Export Control & Dual-Use
 *   18. Regulator Portal Handoff
 *   19. Incidents & Grievances
 *
 * Idempotent: re-running finds existing projects by name and reuses
 * their GIDs instead of duplicating.
 *
 * Usage (run locally — this sandbox cannot reach app.asana.com):
 *
 *   ASANA_TOKEN=<personal access token> \
 *   ASANA_WORKSPACE_GID=<workspace gid> \
 *   ASANA_TEAM_GID=<team gid, e.g. HAWKEYE STERLING V2> \
 *   npx tsx scripts/asana-projects-create-19.ts
 *
 * Add --apply to actually create. Without it, the script prints what
 * it WOULD create (dry run).
 *
 * Output: a block of `ASANA_*_PROJECT_GID=<gid>` lines ready to paste
 * into Netlify env vars and `.env.example`.
 *
 * Regulatory basis:
 *   - FDL No.(10)/2025 Art.20-21 (CO duty of care, reasoning trail)
 *   - FDL No.(10)/2025 Art.24 (10-year record retention)
 *   - Cabinet Res 134/2025 Art.19 (internal review)
 */

interface ProjectSpec {
  readonly name: string;
  readonly envVar: string;
  readonly notes: string;
  /** When multiple env vars must point at the same GID (the CDD / KYC merge). */
  readonly alsoAssignTo?: readonly string[];
}

const PROJECTS: readonly ProjectSpec[] = [
  {
    name: 'Screening — Sanctions & Adverse Media',
    envVar: 'ASANA_SCREENINGS_PROJECT_GID',
    notes:
      'Every sanctions / PEP / adverse-media screening hit across UN, OFAC, EU, UK, UAE, EOCN lists.',
  },
  {
    name: 'Central MLRO — Daily Digest',
    envVar: 'ASANA_CENTRAL_MLRO_PROJECT_GID',
    notes: 'Single pane of glass. Mirrored high-severity events across all modules.',
  },
  {
    name: 'Audit Log — 10-Year Trail',
    envVar: 'ASANA_AUDIT_LOG_PROJECT_GID',
    notes: 'Immutable append-only mirror of every compliance decision (FDL Art.24).',
  },
  {
    name: 'Four-Eyes Approvals',
    envVar: 'ASANA_FOUR_EYES_PROJECT_GID',
    notes: 'Queue for decisions requiring two independent approvers.',
  },
  {
    name: 'STR/SAR/CTR/PMR — goAML Filings',
    envVar: 'ASANA_STR_PROJECT_GID',
    notes: 'All goAML filings with deadline countdown (FDL Art.26-27).',
  },
  {
    name: 'FFR — Incidents & Asset Freezes',
    envVar: 'ASANA_INCIDENTS_PROJECT_GID',
    notes:
      'Confirmed sanctions matches. 24h EOCN freeze clock and 5-business-day CNMR (Cabinet Res 74/2020 Art.4-7).',
  },
  {
    name: 'CDD/SDD/EDD/KYC — Customer Due Diligence',
    envVar: 'ASANA_CDD_PROJECT_GID',
    alsoAssignTo: ['ASANA_KYC_CDD_TRACKER_PROJECT_GID'],
    notes:
      'Periodic CDD reviews, tier changes (SDD → CDD → EDD), PEP re-screening, KYC expiry alerts.',
  },
  {
    name: 'Transaction Monitoring',
    envVar: 'ASANA_TM_PROJECT_GID',
    notes: 'TM alerts, threshold breaches, Benford anomalies, peer outliers.',
  },
  {
    name: 'Compliance Ops — Daily & Weekly Tasks',
    envVar: 'ASANA_COMPLIANCE_TASKS_PROJECT_GID',
    notes: 'MLRO-owned recurring checklist (human-driven).',
  },
  {
    name: 'Shipments — Tracking',
    envVar: 'ASANA_SHIPMENTS_PROJECT_GID',
    notes: 'Physical shipment tracking and chain of custody.',
  },
  {
    name: 'Employees',
    envVar: 'ASANA_EMPLOYEES_PROJECT_GID',
    notes: 'Staff records, roles, access, certifications.',
  },
  {
    name: 'Training',
    envVar: 'ASANA_TRAINING_PROJECT_GID',
    notes: 'Course assignments, completion, attestations.',
  },
  {
    name: 'Compliance Governance',
    envVar: 'ASANA_GOVERNANCE_PROJECT_GID',
    notes: 'Policy, RACI, committee, AI Governance (EU AI Act / NIST / ISO 42001).',
  },
  {
    name: 'Routines — Scheduled',
    envVar: 'ASANA_ROUTINES_PROJECT_GID',
    notes: 'The 33 scheduled cron functions and their dry-run outputs (machine-driven).',
  },
  {
    name: 'MLRO Workbench',
    envVar: 'ASANA_WORKBENCH_PROJECT_GID',
    notes: 'Cross-module MLRO action surface.',
  },
  {
    name: 'Supply Chain, ESG & LBMA Gold',
    envVar: 'ASANA_ESG_LBMA_PROJECT_GID',
    notes: 'Responsible sourcing, LBMA RGG v9, CAHRA due diligence.',
  },
  {
    name: 'Export Control & Dual-Use',
    envVar: 'ASANA_EXPORT_CONTROL_PROJECT_GID',
    notes: 'Cabinet Res 156/2025 — proliferation financing, strategic goods screening.',
  },
  {
    name: 'Regulator Portal Handoff',
    envVar: 'ASANA_INSPECTOR_PROJECT_GID',
    notes: 'Evidence packets prepared for MoE / LBMA / EOCN inspection.',
  },
  {
    name: 'Incidents & Grievances',
    envVar: 'ASANA_GRIEVANCES_PROJECT_GID',
    notes:
      'Operational incidents, whistleblower reports, customer complaints (Fed Decree-Law 32/2021, FDL Art.29 confidentiality).',
  },
];

const ASANA_BASE = 'https://app.asana.com/api/1.0';

interface AsanaProject {
  gid: string;
  name: string;
}

async function asanaFetch<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${ASANA_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Asana ${init.method || 'GET'} ${path} -> ${res.status}: ${body}`);
  }
  const json = (await res.json()) as { data: T };
  return json.data;
}

async function listProjectsByTeam(
  teamGid: string,
  token: string,
): Promise<AsanaProject[]> {
  const all: AsanaProject[] = [];
  let offset: string | undefined;
  do {
    const qs = new URLSearchParams({ limit: '100', opt_fields: 'name' });
    if (offset) qs.set('offset', offset);
    const res = await fetch(`${ASANA_BASE}/teams/${teamGid}/projects?${qs}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(
        `Asana GET /teams/${teamGid}/projects -> ${res.status}: ${await res.text()}`,
      );
    }
    const json = (await res.json()) as {
      data: AsanaProject[];
      next_page?: { offset: string } | null;
    };
    all.push(...json.data);
    offset = json.next_page?.offset;
  } while (offset);
  return all;
}

async function createProject(
  name: string,
  notes: string,
  workspaceGid: string,
  teamGid: string,
  token: string,
): Promise<AsanaProject> {
  return asanaFetch<AsanaProject>('/projects', token, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        name,
        notes,
        workspace: workspaceGid,
        team: teamGid,
        default_view: 'board',
        color: 'light-purple',
      },
    }),
  });
}

async function main(): Promise<void> {
  const token = process.env.ASANA_TOKEN || process.env.ASANA_ACCESS_TOKEN;
  const workspaceGid = process.env.ASANA_WORKSPACE_GID;
  const teamGid = process.env.ASANA_TEAM_GID;
  const apply = process.argv.includes('--apply');

  const missing: string[] = [];
  if (!token) missing.push('ASANA_TOKEN');
  if (!workspaceGid) missing.push('ASANA_WORKSPACE_GID');
  if (!teamGid) missing.push('ASANA_TEAM_GID');
  if (missing.length > 0) {
    console.error(`Missing required env vars: ${missing.join(', ')}`);
    console.error(
      '\nUsage:\n  ASANA_TOKEN=xxx ASANA_WORKSPACE_GID=xxx ASANA_TEAM_GID=xxx \\\n  npx tsx scripts/asana-projects-create-19.ts [--apply]\n',
    );
    process.exit(1);
  }

  console.log(`[bootstrap] Workspace: ${workspaceGid}  Team: ${teamGid}`);
  console.log(`[bootstrap] Mode: ${apply ? 'APPLY (creating)' : 'DRY RUN (use --apply to create)'}`);
  console.log(`[bootstrap] Fetching existing projects in team...`);

  const existing = await listProjectsByTeam(teamGid!, token!);
  const byName = new Map(existing.map((p) => [p.name.trim(), p]));
  console.log(`[bootstrap] Found ${existing.length} existing projects in team.\n`);

  const envLines: string[] = [];
  const summary: Array<{ name: string; gid: string; action: 'created' | 'reused' | 'dry-run' }> =
    [];

  for (const spec of PROJECTS) {
    const hit = byName.get(spec.name);
    if (hit) {
      console.log(`[reuse]   ${spec.name}  (${hit.gid})`);
      summary.push({ name: spec.name, gid: hit.gid, action: 'reused' });
      envLines.push(`${spec.envVar}=${hit.gid}`);
      for (const alias of spec.alsoAssignTo || []) envLines.push(`${alias}=${hit.gid}`);
      continue;
    }
    if (!apply) {
      console.log(`[dry-run] ${spec.name}  (would create)`);
      summary.push({ name: spec.name, gid: '<dry-run>', action: 'dry-run' });
      envLines.push(`${spec.envVar}=<dry-run>`);
      for (const alias of spec.alsoAssignTo || []) envLines.push(`${alias}=<dry-run>`);
      continue;
    }
    const created = await createProject(
      spec.name,
      spec.notes,
      workspaceGid!,
      teamGid!,
      token!,
    );
    console.log(`[created] ${spec.name}  (${created.gid})`);
    summary.push({ name: spec.name, gid: created.gid, action: 'created' });
    envLines.push(`${spec.envVar}=${created.gid}`);
    for (const alias of spec.alsoAssignTo || []) envLines.push(`${alias}=${created.gid}`);
  }

  console.log('\n=== ENV BLOCK (paste into Netlify env vars + .env) ===');
  for (const line of envLines) console.log(line);
  console.log('=== END ===\n');

  const created = summary.filter((s) => s.action === 'created').length;
  const reused = summary.filter((s) => s.action === 'reused').length;
  const dry = summary.filter((s) => s.action === 'dry-run').length;
  console.log(
    `[bootstrap] Done. created=${created} reused=${reused} dry-run=${dry} total=${summary.length}`,
  );
  if (!apply) {
    console.log('\nRe-run with --apply to actually create the projects.');
  }
}

main().catch((err) => {
  console.error('[bootstrap] FATAL:', err?.message || err);
  process.exit(1);
});
