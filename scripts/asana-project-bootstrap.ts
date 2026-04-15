#!/usr/bin/env -S npx tsx
/**
 * asana-project-bootstrap.ts — One-shot Asana workspace bootstrap.
 *
 * Runs the three idempotent Asana setup steps in the correct order
 * for a fresh workspace (or a re-sync after env changes):
 *
 *   1. Custom fields  → scripts/asana-cf-bootstrap.ts
 *      Creates the 11 compliance custom fields (risk_level, verdict,
 *      case_id, deadline_type, days_remaining, confidence,
 *      regulation_citation, customer_name, jurisdiction, ubo_count,
 *      pep_flag) on the workspace and prints export-line GIDs.
 *
 *   2. Sections       → scripts/asana-section-bootstrap.ts
 *      Walks COMPANY_REGISTRY and creates the 5 canonical Kanban
 *      sections (To Do / In Progress / Four-Eyes Review / Done /
 *      Blocked) on every customer compliance + workflow project.
 *
 *   3. Webhooks       → scripts/asana-webhook-bootstrap.ts
 *      Subscribes one Asana webhook per customer project pointing
 *      at /api/asana/webhook?workspaceGid=<gid>, with filters that
 *      pass through task adds, completion changes, custom-field
 *      changes, and comment_added stories.
 *
 * Usage:
 *   ASANA_TOKEN=xxx \
 *   ASANA_WORKSPACE_GID=xxx \
 *   PUBLIC_BASE_URL=https://hawkeye-sterling-v2.netlify.app \
 *   npx tsx scripts/asana-project-bootstrap.ts                 # dry-run
 *
 *   ASANA_TOKEN=xxx \
 *   ASANA_WORKSPACE_GID=xxx \
 *   PUBLIC_BASE_URL=https://hawkeye-sterling-v2.netlify.app \
 *   npx tsx scripts/asana-project-bootstrap.ts --apply         # write
 *
 * Each step is idempotent — re-running after a partial run is safe
 * and only creates what is missing.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (CO duty of care)
 *   - FDL No.10/2025 Art.24 (10yr retention)
 *   - Cabinet Res 134/2025 Art.19 (internal review)
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface Step {
  name: string;
  script: string;
  requires: string[];
}

const STEPS: readonly Step[] = [
  {
    name: 'Custom fields',
    script: 'asana-cf-bootstrap.ts',
    requires: ['ASANA_TOKEN', 'ASANA_WORKSPACE_GID'],
  },
  {
    name: 'Project sections',
    script: 'asana-section-bootstrap.ts',
    requires: ['ASANA_TOKEN'],
  },
  {
    name: 'Webhooks',
    script: 'asana-webhook-bootstrap.ts',
    requires: ['ASANA_TOKEN', 'ASANA_WORKSPACE_GID', 'PUBLIC_BASE_URL_OR_HAWKEYE_BRAIN_URL'],
  },
];

function checkRequirement(req: string): boolean {
  if (req === 'PUBLIC_BASE_URL_OR_HAWKEYE_BRAIN_URL') {
    return Boolean(process.env.PUBLIC_BASE_URL || process.env.HAWKEYE_BRAIN_URL);
  }
  return Boolean(process.env[req]);
}

function describeRequirement(req: string): string {
  if (req === 'PUBLIC_BASE_URL_OR_HAWKEYE_BRAIN_URL') {
    return 'PUBLIC_BASE_URL or HAWKEYE_BRAIN_URL';
  }
  return req;
}

function runStep(scriptName: string, extraArgs: readonly string[]): Promise<number> {
  return new Promise((resolve) => {
    const scriptPath = join(__dirname, scriptName);
    const child = spawn('npx', ['tsx', scriptPath, ...extraArgs], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (err) => {
      console.error(`Failed to spawn ${scriptName}:`, err);
      resolve(1);
    });
  });
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const extraArgs = apply ? ['--apply'] : [];

  console.log('# ═══════════════════════════════════════════════');
  console.log('# Asana project bootstrap — one-shot orchestrator');
  console.log(`# Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log('# ═══════════════════════════════════════════════');
  console.log('');

  // Pre-flight: validate every step's required env vars before
  // starting. Better to fail fast than create custom fields and
  // then bail at the webhook step because PUBLIC_BASE_URL was unset.
  let preflightOk = true;
  for (const step of STEPS) {
    for (const req of step.requires) {
      if (!checkRequirement(req)) {
        console.error(`# ✗ ${step.name}: missing ${describeRequirement(req)}`);
        preflightOk = false;
      }
    }
  }
  if (!preflightOk) {
    console.error('');
    console.error('# Aborting — set the required env vars and re-run.');
    process.exit(2);
  }

  console.log('# ✓ Pre-flight env check passed');
  console.log('');

  let failedSteps = 0;
  for (const step of STEPS) {
    console.log(`# ───── Step: ${step.name} (${step.script}) ─────`);
    const code = await runStep(step.script, extraArgs);
    if (code !== 0) {
      console.error(`# ! ${step.name} exited with code ${code}`);
      failedSteps++;
    }
    console.log('');
  }

  console.log('# ═══════════════════════════════════════════════');
  if (failedSteps === 0) {
    console.log(`# All ${STEPS.length} steps ${apply ? 'applied' : 'dry-ran'} successfully.`);
    if (!apply) {
      console.log('# Re-run with --apply to actually mutate the workspace.');
    } else {
      console.log('# Next: paste the export lines above into Netlify env vars.');
    }
    process.exit(0);
  } else {
    console.error(`# ${failedSteps}/${STEPS.length} steps failed. Review output above.`);
    process.exit(1);
  }
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

export { STEPS };
