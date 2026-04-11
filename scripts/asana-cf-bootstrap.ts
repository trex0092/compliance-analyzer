#!/usr/bin/env -S npx tsx
/**
 * asana-cf-bootstrap.ts — Asana custom-field auto-provisioning.
 *
 * Phase 4 wired `buildComplianceCustomFields()` to map compliance
 * enums → Asana custom-field GIDs read from env vars. This script
 * is the one-time (or one-per-workspace) bootstrap that creates
 * those custom fields in the Asana workspace and writes the GIDs
 * back to stdout as shell-export lines the operator can paste into
 * `.env` or a GitHub Actions secret.
 *
 * Usage:
 *   ASANA_TOKEN=xxx ASANA_WORKSPACE_GID=xxx npx tsx scripts/asana-cf-bootstrap.ts
 *
 * Dry-run mode (default): prints what WOULD be created.
 *   npx tsx scripts/asana-cf-bootstrap.ts --dry-run
 *
 * Apply mode: actually creates the fields.
 *   npx tsx scripts/asana-cf-bootstrap.ts --apply
 *
 * The script is idempotent: re-running after fields already exist
 * is a no-op. If a field with the same name already exists, the
 * existing GID is emitted instead of creating a duplicate.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (5-year retention — rollup visibility)
 *   - Cabinet Res 134/2025 Art.19 (internal review via SLA tracking)
 *   - MoE Circular 08/AML/2021 (DPMS quarterly reporting)
 */

interface FieldDefinition {
  envKey: string;
  name: string;
  type: 'enum' | 'number' | 'text';
  description: string;
  options?: ReadonlyArray<{ envKey: string; name: string; color: string }>;
}

const FIELDS: readonly FieldDefinition[] = [
  {
    envKey: 'ASANA_CF_RISK_LEVEL_GID',
    name: 'Risk level',
    type: 'enum',
    description: 'Compliance risk rating for the task subject.',
    options: [
      { envKey: 'ASANA_CF_RISK_LEVEL_CRITICAL', name: 'Critical', color: 'red' },
      { envKey: 'ASANA_CF_RISK_LEVEL_HIGH', name: 'High', color: 'orange' },
      { envKey: 'ASANA_CF_RISK_LEVEL_MEDIUM', name: 'Medium', color: 'yellow' },
      { envKey: 'ASANA_CF_RISK_LEVEL_LOW', name: 'Low', color: 'green' },
    ],
  },
  {
    envKey: 'ASANA_CF_VERDICT_GID',
    name: 'Brain verdict',
    type: 'enum',
    description: 'Weaponized Brain verdict (pass/flag/escalate/freeze).',
    options: [
      { envKey: 'ASANA_CF_VERDICT_PASS', name: 'Pass', color: 'green' },
      { envKey: 'ASANA_CF_VERDICT_FLAG', name: 'Flag', color: 'yellow' },
      { envKey: 'ASANA_CF_VERDICT_ESCALATE', name: 'Escalate', color: 'orange' },
      { envKey: 'ASANA_CF_VERDICT_FREEZE', name: 'Freeze', color: 'red' },
    ],
  },
  {
    envKey: 'ASANA_CF_CASE_ID_GID',
    name: 'Case / filing ID',
    type: 'text',
    description: 'Local identifier for the compliance case or filing.',
  },
  {
    envKey: 'ASANA_CF_DEADLINE_TYPE_GID',
    name: 'Deadline type',
    type: 'enum',
    description: 'Regulatory filing deadline type.',
    options: [
      { envKey: 'ASANA_CF_DEADLINE_TYPE_STR', name: 'STR', color: 'purple' },
      { envKey: 'ASANA_CF_DEADLINE_TYPE_SAR', name: 'SAR', color: 'purple' },
      { envKey: 'ASANA_CF_DEADLINE_TYPE_CTR', name: 'CTR', color: 'blue' },
      { envKey: 'ASANA_CF_DEADLINE_TYPE_DPMSR', name: 'DPMSR', color: 'blue' },
      { envKey: 'ASANA_CF_DEADLINE_TYPE_CNMR', name: 'CNMR', color: 'orange' },
      { envKey: 'ASANA_CF_DEADLINE_TYPE_EOCN', name: 'EOCN (24h freeze)', color: 'red' },
    ],
  },
  {
    envKey: 'ASANA_CF_DAYS_REMAINING_GID',
    name: 'Days remaining',
    type: 'number',
    description: 'Business days remaining until the regulatory deadline.',
  },
  {
    envKey: 'ASANA_CF_CONFIDENCE_GID',
    name: 'Brain confidence (%)',
    type: 'number',
    description: 'Weaponized Brain confidence in the verdict, 0-100.',
  },
  {
    envKey: 'ASANA_CF_REGULATION_GID',
    name: 'Regulation citation',
    type: 'text',
    description: 'Article / Circular that justifies the task.',
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const token = process.env.ASANA_TOKEN;
  const workspaceGid = process.env.ASANA_WORKSPACE_GID;

  if (!token || !workspaceGid) {
    console.error('ASANA_TOKEN and ASANA_WORKSPACE_GID must be set');
    process.exit(2);
  }

  console.log(`# Asana custom-field bootstrap`);
  console.log(`# Workspace: ${workspaceGid}`);
  console.log(`# Mode: ${apply ? 'APPLY' : 'DRY-RUN (use --apply to create)'}`);
  console.log('');

  // List existing custom fields to support idempotency.
  const existingRes = await fetch(
    `https://app.asana.com/api/1.0/workspaces/${encodeURIComponent(workspaceGid)}/custom_fields?opt_fields=gid,name,enum_options.gid,enum_options.name&limit=100`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!existingRes.ok) {
    console.error(`Failed to list existing custom fields: HTTP ${existingRes.status}`);
    process.exit(1);
  }
  const existingData = (await existingRes.json()) as {
    data?: Array<{ gid: string; name: string; enum_options?: Array<{ gid: string; name: string }> }>;
  };
  const existingByName = new Map(existingData.data?.map((f) => [f.name, f]) ?? []);

  for (const field of FIELDS) {
    const existing = existingByName.get(field.name);
    if (existing) {
      console.log(`# ${field.name}: already exists`);
      console.log(`export ${field.envKey}=${existing.gid}`);
      if (field.options && existing.enum_options) {
        const byName = new Map(existing.enum_options.map((o) => [o.name, o.gid]));
        for (const opt of field.options) {
          const gid = byName.get(opt.name);
          if (gid) console.log(`export ${opt.envKey}=${gid}`);
        }
      }
      console.log('');
      continue;
    }

    if (!apply) {
      console.log(`# ${field.name}: WOULD create (${field.type})`);
      console.log(`# export ${field.envKey}=<new-gid>`);
      if (field.options) {
        for (const opt of field.options) {
          console.log(`# export ${opt.envKey}=<new-option-gid>`);
        }
      }
      console.log('');
      continue;
    }

    const payload: Record<string, unknown> = {
      workspace: workspaceGid,
      name: field.name,
      resource_subtype: field.type,
      description: field.description,
    };
    if (field.type === 'enum' && field.options) {
      payload.enum_options = field.options.map((o) => ({
        name: o.name,
        color: o.color,
      }));
    }

    const res = await fetch(`https://app.asana.com/api/1.0/custom_fields`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: payload }),
    });
    if (!res.ok) {
      console.error(`# ${field.name}: failed HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      continue;
    }
    const json = (await res.json()) as {
      data?: { gid: string; enum_options?: Array<{ gid: string; name: string }> };
    };
    const newField = json.data;
    if (!newField) continue;

    console.log(`# ${field.name}: created`);
    console.log(`export ${field.envKey}=${newField.gid}`);
    if (field.options && newField.enum_options) {
      const byName = new Map(newField.enum_options.map((o) => [o.name, o.gid]));
      for (const opt of field.options) {
        const gid = byName.get(opt.name);
        if (gid) console.log(`export ${opt.envKey}=${gid}`);
      }
    }
    console.log('');
  }

  console.log('# Done. Paste the export lines into .env or your secrets manager.');
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

export { FIELDS };
