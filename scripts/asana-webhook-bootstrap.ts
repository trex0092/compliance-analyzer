#!/usr/bin/env -S npx tsx
/**
 * asana-webhook-bootstrap.ts — Asana webhook subscription provisioner.
 *
 * Asana does NOT push events anywhere unless you explicitly subscribe
 * each (resource, target) pair via the Asana REST API. Our receiver
 * function at netlify/functions/asana-webhook.mts is fully wired —
 * including the X-Hook-Secret two-phase handshake and HMAC-SHA256
 * signature verification — but it never fires because no webhook has
 * been registered against it.
 *
 * This script walks COMPANY_REGISTRY and creates one Asana webhook
 * per customer compliance project, pointing at:
 *
 *   <PUBLIC_BASE_URL>/api/asana/webhook?workspaceGid=<gid>
 *
 * The receiver scopes its handshake-secret blob by the workspaceGid
 * query param so we can re-bootstrap a workspace cleanly without
 * collisions with other workspaces that may share the same Netlify
 * site in the future.
 *
 * Asana webhooks support filters that limit which events fire. We
 * subscribe to the four event types the brain dispatcher + skill
 * router actually consume:
 *
 *   - Task added to project   → seeds new compliance cases
 *   - Task changed (completed/custom-field) → bidirectional resolution
 *   - Story added (comment_added)            → /audit, /screen, /goaml
 *                                              slash-command handler
 *
 * Usage:
 *   ASANA_TOKEN=xxx \
 *   PUBLIC_BASE_URL=https://hawkeye-sterling-v2.netlify.app \
 *   ASANA_WORKSPACE_GID=xxx \
 *   npx tsx scripts/asana-webhook-bootstrap.ts
 *
 *   ASANA_TOKEN=xxx \
 *   PUBLIC_BASE_URL=... \
 *   ASANA_WORKSPACE_GID=xxx \
 *   npx tsx scripts/asana-webhook-bootstrap.ts --apply
 *
 * Idempotent: lists existing webhooks first via
 * GET /webhooks?workspace=<gid> and skips any whose `target` already
 * matches the URL we would create.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (CO duty of care — every Asana action
 *     must reach the audit chain)
 *   - FDL No.10/2025 Art.24 (10yr retention — the receiver writes
 *     every verified delivery to the audit blob store)
 *   - Cabinet Res 134/2025 Art.19 (internal review must be reflected
 *     bidirectionally between Asana and the analyzer)
 */

import { COMPANY_REGISTRY } from '../src/domain/customers';
import { normalizeBrainUrl } from '../src/utils/normalizeBrainUrl';

interface AsanaWebhook {
  gid: string;
  resource: { gid: string; name?: string };
  target: string;
  active?: boolean;
}

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

/**
 * Filters: limit the events Asana actually delivers to our receiver.
 * Cuts noise + cost. Anything we don't list here is silently dropped
 * by Asana before it ever touches our function.
 *
 * Schema reference: https://developers.asana.com/docs/webhook-filters
 */
const WEBHOOK_FILTERS: ReadonlyArray<Record<string, string>> = [
  // New compliance case landing in the project.
  { action: 'added', resource_type: 'task' },
  // Task completed / re-opened — bidirectional resolution sync.
  { action: 'changed', resource_type: 'task', fields: 'completed' },
  // Custom field changes — risk_level / verdict / deadline_type.
  { action: 'changed', resource_type: 'task', fields: 'custom_fields' },
  // Comments — slash-command handler (/audit, /screen, /goaml).
  { action: 'added', resource_type: 'story', resource_subtype: 'comment_added' },
];

async function listExistingWebhooks(token: string, workspaceGid: string): Promise<AsanaWebhook[]> {
  const res = await fetch(
    `https://app.asana.com/api/1.0/webhooks?workspace=${encodeURIComponent(workspaceGid)}&opt_fields=gid,resource.gid,resource.name,target,active&limit=100`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    throw new Error(
      `GET /webhooks?workspace=${workspaceGid} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`
    );
  }
  const json = (await res.json()) as { data?: AsanaWebhook[] };
  return json.data ?? [];
}

async function createWebhook(
  token: string,
  resourceGid: string,
  target: string
): Promise<AsanaWebhook> {
  const res = await fetch(`https://app.asana.com/api/1.0/webhooks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        resource: resourceGid,
        target,
        filters: WEBHOOK_FILTERS,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(
      `POST /webhooks failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`
    );
  }
  const json = (await res.json()) as { data?: AsanaWebhook };
  if (!json.data) throw new Error('Asana returned empty webhook payload');
  return json.data;
}

interface ProjectResult {
  label: string;
  projectGid: string;
  alreadySubscribed: boolean;
  created?: string;
  errors: string[];
}

async function bootstrapProjectWebhook(
  token: string,
  publicBaseUrl: string,
  workspaceGid: string,
  legalName: string,
  kind: 'compliance' | 'workflow',
  projectGid: string,
  existing: AsanaWebhook[],
  apply: boolean
): Promise<ProjectResult> {
  const target = `${publicBaseUrl.replace(/\/$/, '')}/api/asana/webhook?workspaceGid=${encodeURIComponent(workspaceGid)}`;
  const result: ProjectResult = {
    label: `${legalName} [${kind} ${projectGid}]`,
    projectGid,
    alreadySubscribed: false,
    errors: [],
  };

  const match = existing.find((wh) => wh.resource?.gid === projectGid && wh.target === target);
  if (match) {
    result.alreadySubscribed = true;
    result.created = `existing webhook ${match.gid} (active=${match.active ?? 'unknown'})`;
    return result;
  }

  if (!apply) {
    result.created = `WOULD subscribe → ${target}`;
    return result;
  }

  try {
    const created = await createWebhook(token, projectGid, target);
    result.created = `created webhook ${created.gid} → ${target}`;
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
  }
  return result;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const token = process.env.ASANA_TOKEN;
  const workspaceGid = process.env.ASANA_WORKSPACE_GID;
  // Normalize the raw env value: strip trailing slashes/dots, trim
  // whitespace, prepend https:// if the operator pasted a bare host.
  // This defends against the mobile-dashboard typo classes (see
  // src/utils/normalizeBrainUrl.ts).
  const rawBaseUrl = process.env.PUBLIC_BASE_URL || process.env.HAWKEYE_BRAIN_URL;

  if (!token || !workspaceGid || !rawBaseUrl) {
    console.error(
      'ASANA_TOKEN, ASANA_WORKSPACE_GID, and PUBLIC_BASE_URL (or HAWKEYE_BRAIN_URL) must be set'
    );
    process.exit(2);
  }

  const publicBaseUrl = normalizeBrainUrl(rawBaseUrl);

  // Validate that the URL is HTTPS — Asana refuses HTTP webhook
  // targets, and it's also a CLAUDE.md security guarantee.
  if (!publicBaseUrl.startsWith('https://')) {
    console.error(`PUBLIC_BASE_URL must be HTTPS, got: ${publicBaseUrl}`);
    process.exit(2);
  }

  console.log(`# Asana webhook bootstrap`);
  console.log(`# Workspace: ${workspaceGid}`);
  console.log(`# Receiver:  ${publicBaseUrl.replace(/\/$/, '')}/api/asana/webhook`);
  console.log(`# Mode:      ${opts.apply ? 'APPLY' : 'DRY-RUN (use --apply to subscribe)'}`);
  console.log(`# Scope:     ${opts.scope}`);
  console.log('');

  let existing: AsanaWebhook[];
  try {
    existing = await listExistingWebhooks(token, workspaceGid);
    console.log(`# Existing webhooks in workspace: ${existing.length}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
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
      const result = await bootstrapProjectWebhook(
        token,
        publicBaseUrl,
        workspaceGid,
        customer.legalName,
        t.kind,
        t.gid,
        existing,
        opts.apply
      );
      results.push(result);
      console.log(`# ${result.label}`);
      if (result.alreadySubscribed) console.log(`#   ✓ ${result.created}`);
      else if (result.created) console.log(`#   + ${result.created}`);
      for (const e of result.errors) console.log(`#   ! ${e}`);
      console.log('');
    }
  }

  // Summary footer.
  const totalCreated = results.filter((r) => !r.alreadySubscribed && r.errors.length === 0).length;
  const totalExisting = results.filter((r) => r.alreadySubscribed).length;
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
  console.log('# ─────────────────────────────────────────────');
  console.log(`# Summary:`);
  console.log(`#   Projects processed: ${results.length}`);
  console.log(`#   Already subscribed: ${totalExisting}`);
  console.log(`#   ${opts.apply ? 'Subscribed' : 'Pending subscribe'}: ${totalCreated}`);
  console.log(`#   Errors: ${totalErrors}`);
  if (!opts.apply) {
    console.log('#');
    console.log('# Re-run with --apply to actually subscribe the webhooks.');
    console.log('# After --apply, the receiver completes the X-Hook-Secret');
    console.log('# handshake and stores the secret in the Netlify blob store.');
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

export { WEBHOOK_FILTERS, bootstrapProjectWebhook };
