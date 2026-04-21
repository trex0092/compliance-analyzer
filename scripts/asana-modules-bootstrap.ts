#!/usr/bin/env -S npx tsx
/**
 * asana-modules-bootstrap.ts — provision sections + webhooks for the
 * 19-project module catalog defined in src/services/asanaModuleProjects.ts.
 *
 * The existing asana-section-bootstrap.ts / asana-webhook-bootstrap.ts
 * scripts iterate COMPANY_REGISTRY (per-customer projects). This
 * script iterates MODULE_PROJECTS (the 19 MLRO-locked boards in the
 * HAWKEYE STERLING V2 team) and is the companion bootstrap for the
 * workflow documented in docs/asana-workflow-spec.md.
 *
 * Each of the 19 module projects carries its own canonical section
 * list in MODULE_PROJECTS[i].sections — this script fetches what
 * already exists in each project and creates only the missing ones.
 * Idempotent — safe to re-run.
 *
 * For webhooks, one subscription per module project points at
 * `<PUBLIC_BASE_URL>/api/asana/webhook?workspaceGid=<gid>`, mirroring
 * the per-customer receiver's HMAC-SHA256 + X-Hook-Secret contract
 * implemented in netlify/functions/asana-webhook.mts.
 *
 * Usage:
 *
 *   # Dry run (default — prints what it would do)
 *   ASANA_TOKEN=<PAT> \
 *   ASANA_WORKSPACE_GID=1213645083721316 \
 *   PUBLIC_BASE_URL=https://hawkeye-sterling-v2.netlify.app \
 *   npx tsx scripts/asana-modules-bootstrap.ts
 *
 *   # Apply (actually creates sections + subscribes webhooks)
 *   ASANA_TOKEN=<PAT> \
 *   ASANA_WORKSPACE_GID=1213645083721316 \
 *   PUBLIC_BASE_URL=https://hawkeye-sterling-v2.netlify.app \
 *   npx tsx scripts/asana-modules-bootstrap.ts --apply
 *
 *   # Skip a phase (e.g. sections only)
 *   npx tsx scripts/asana-modules-bootstrap.ts --apply --no-webhooks
 *
 * Regulatory basis:
 *   - FDL No.(10)/2025 Art.20-21 (CO visibility — every board needs
 *     the canonical section layout so the MLRO sees a uniform Kanban)
 *   - Art.24 (10-year retention — webhooks are the bi-directional
 *     sync primitive that keeps the tool's audit chain in step with
 *     Asana task state)
 *   - Cabinet Res 134/2025 Art.19 (internal review cadence)
 */

import { MODULE_PROJECTS } from '../src/services/asanaModuleProjects';

const ASANA_BASE = 'https://app.asana.com/api/1.0';

interface AsanaSection {
  gid: string;
  name: string;
}

interface AsanaWebhook {
  gid: string;
  resource: { gid: string };
  target: string;
}

async function asanaGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${ASANA_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(
      `Asana GET ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  const json = (await res.json()) as { data: T };
  return json.data;
}

async function asanaPost<T>(
  path: string,
  token: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(`${ASANA_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `Asana POST ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  const json = (await res.json()) as { data: T };
  return json.data;
}

async function listSections(
  projectGid: string,
  token: string,
): Promise<readonly AsanaSection[]> {
  return asanaGet<AsanaSection[]>(
    `/projects/${projectGid}/sections?opt_fields=name`,
    token,
  );
}

async function createSection(
  projectGid: string,
  name: string,
  token: string,
): Promise<AsanaSection> {
  return asanaPost<AsanaSection>(
    `/projects/${projectGid}/sections`,
    token,
    { data: { name } },
  );
}

async function listWebhooks(
  workspaceGid: string,
  resourceGid: string,
  token: string,
): Promise<readonly AsanaWebhook[]> {
  return asanaGet<AsanaWebhook[]>(
    `/webhooks?workspace=${workspaceGid}&resource=${resourceGid}&opt_fields=target,resource.gid`,
    token,
  );
}

async function createWebhook(
  resourceGid: string,
  target: string,
  token: string,
): Promise<AsanaWebhook> {
  return asanaPost<AsanaWebhook>('/webhooks', token, {
    data: {
      resource: resourceGid,
      target,
      filters: [
        { resource_type: 'task', action: 'added' },
        { resource_type: 'task', action: 'changed', fields: ['completed'] },
        { resource_type: 'story', action: 'added', resource_subtype: 'comment_added' },
      ],
    },
  });
}

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

async function main(): Promise<void> {
  const token = readEnv('ASANA_TOKEN') || readEnv('ASANA_ACCESS_TOKEN');
  const workspaceGid = readEnv('ASANA_WORKSPACE_GID');
  const publicBase =
    readEnv('PUBLIC_BASE_URL') || readEnv('HAWKEYE_BRAIN_URL');
  const apply = process.argv.includes('--apply');
  const skipSections = process.argv.includes('--no-sections');
  const skipWebhooks = process.argv.includes('--no-webhooks');

  const missing: string[] = [];
  if (!token) missing.push('ASANA_TOKEN');
  if (!workspaceGid) missing.push('ASANA_WORKSPACE_GID');
  if (!skipWebhooks && !publicBase)
    missing.push('PUBLIC_BASE_URL (or pass --no-webhooks)');
  if (missing.length > 0) {
    console.error(`Missing required env: ${missing.join(', ')}`);
    process.exit(1);
  }

  console.log(`[modules-bootstrap] Workspace: ${workspaceGid}`);
  console.log(
    `[modules-bootstrap] Mode: ${apply ? 'APPLY (writing)' : 'DRY RUN'}`,
  );
  console.log(`[modules-bootstrap] Phases: sections=${!skipSections} webhooks=${!skipWebhooks}`);
  console.log();

  let sectionsCreated = 0;
  let sectionsReused = 0;
  let webhooksCreated = 0;
  let webhooksReused = 0;

  for (const spec of MODULE_PROJECTS) {
    const projectGid = readEnv(spec.envVar);
    if (!projectGid) {
      console.log(
        `[skip] ${spec.envVar} is empty — skipping ${spec.name}. Populate .env first.`,
      );
      continue;
    }
    console.log(`\n── ${spec.name}  (${projectGid}) ──`);

    if (!skipSections) {
      try {
        const existing = await listSections(projectGid, token!);
        const existingNames = new Set(existing.map((s) => s.name.trim()));
        for (const desired of spec.sections) {
          if (existingNames.has(desired)) {
            sectionsReused++;
            console.log(`  section [reuse] ${desired}`);
            continue;
          }
          if (!apply) {
            console.log(`  section [dry-run — would create] ${desired}`);
            continue;
          }
          const created = await createSection(projectGid, desired, token!);
          sectionsCreated++;
          console.log(`  section [created] ${desired}  (${created.gid})`);
        }
      } catch (err: unknown) {
        console.log(
          `  sections [ERROR] ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (!skipWebhooks) {
      const target = `${publicBase}/api/asana/webhook?workspaceGid=${workspaceGid}`;
      try {
        const existing = await listWebhooks(workspaceGid!, projectGid, token!);
        const already = existing.some((w) => w.target === target);
        if (already) {
          webhooksReused++;
          console.log(`  webhook [reuse] ${target}`);
        } else if (!apply) {
          console.log(`  webhook [dry-run — would subscribe] ${target}`);
        } else {
          // Asana requires the target to echo X-Hook-Secret in a
          // two-phase handshake — handled by netlify/functions/asana-webhook.mts.
          const w = await createWebhook(projectGid, target, token!);
          webhooksCreated++;
          console.log(`  webhook [created] ${target}  (${w.gid})`);
        }
      } catch (err: unknown) {
        console.log(
          `  webhook [ERROR] ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  console.log();
  console.log(
    `[modules-bootstrap] Sections: ${sectionsCreated} created, ${sectionsReused} reused`,
  );
  console.log(
    `[modules-bootstrap] Webhooks: ${webhooksCreated} created, ${webhooksReused} reused`,
  );
  if (!apply) {
    console.log(`\nRe-run with --apply to actually write.`);
  }
}

main().catch((err: unknown) => {
  console.error('[modules-bootstrap] FATAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
