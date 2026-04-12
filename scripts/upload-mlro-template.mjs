#!/usr/bin/env node
/**
 * Upload the MLRO Monthly Report template as a file attachment to every
 * open "MLRO Monthly Report" task in Asana.
 *
 * This script exists because the Asana MCP server exposed in the Claude
 * Code sandbox only supports reading attachments, not creating them. To
 * attach the actual file to each task, the repo owner must run this
 * script locally with a valid Asana Personal Access Token.
 *
 * Prerequisites
 *   1. Node 18 or later (uses native fetch, FormData, Blob).
 *   2. An Asana Personal Access Token with access to the MLRO project.
 *   3. The template file at reports/mlro-monthly/TEMPLATE.md.
 *
 * Environment variables
 *   ASANA_TOKEN              Required. Personal Access Token.
 *   ASANA_MLRO_PROJECT_GID   Optional. Defaults to the known project GID.
 *   ASANA_TEMPLATE_PATH      Optional. Defaults to reports/mlro-monthly/TEMPLATE.md.
 *   ASANA_DRY_RUN            Optional. Set to "1" to list tasks without uploading.
 *
 * Usage
 *   export ASANA_TOKEN=1/1234...
 *   node scripts/upload-mlro-template.mjs
 *
 * Regulatory basis
 *   This script writes the group-wide MLRO Monthly Report template to
 *   each reporting task as a file attachment. The template is a blank
 *   form to be completed, signed and archived by the MLRO of each
 *   entity per FDL No.10/2025 Art.20-21 (Compliance Officer duties) and
 *   retained for ten years per FDL No.10/2025 Art.24.
 */

import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const ASANA_API = 'https://app.asana.com/api/1.0';

const MLRO_PROJECT_GID =
  process.env.ASANA_MLRO_PROJECT_GID || '1214048872008295';
const TEMPLATE_PATH =
  process.env.ASANA_TEMPLATE_PATH || 'reports/mlro-monthly/TEMPLATE.md';
const DRY_RUN = process.env.ASANA_DRY_RUN === '1';

const TOKEN = process.env.ASANA_TOKEN;
if (!TOKEN && !DRY_RUN) {
  console.error(
    'ASANA_TOKEN is not set. Export a Personal Access Token first:\n' +
      '  export ASANA_TOKEN=1/1234...\n' +
      'Or run with ASANA_DRY_RUN=1 to preview the task list.',
  );
  process.exit(1);
}

/**
 * Adaptive rate limiter. Asana permits 250 requests per minute for a
 * Personal Access Token, which works out to one request every 240ms.
 * A conservative 400ms gap keeps us well under the ceiling and leaves
 * headroom for Retry-After back-off if the server pushes back.
 */
let currentDelayMs = 400;
async function throttle() {
  await new Promise((r) => setTimeout(r, currentDelayMs));
}

async function asanaFetch(path, init = {}, attempt = 1) {
  const url = path.startsWith('http') ? path : `${ASANA_API}${path}`;
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    ...(init.headers || {}),
  };
  const res = await fetch(url, { ...init, headers });
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') || '5');
    const wait = Math.min(retryAfter, 60) * 1000;
    currentDelayMs = Math.min(currentDelayMs + 250, 2000);
    console.warn(`Rate limited. Waiting ${wait}ms before retry (attempt ${attempt}).`);
    await new Promise((r) => setTimeout(r, wait));
    if (attempt < 5) return asanaFetch(path, init, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Asana ${res.status} ${res.statusText}: ${body}`);
  }
  // Decay the adaptive delay back toward the baseline on success.
  currentDelayMs = Math.max(currentDelayMs - 25, 400);
  return res;
}

async function listOpenMlroTasks() {
  const tasks = [];
  let offset;
  for (;;) {
    const qs = new URLSearchParams({
      project: MLRO_PROJECT_GID,
      completed_since: 'now',
      limit: '100',
      opt_fields: 'gid,name,completed,due_on',
    });
    if (offset) qs.set('offset', offset);
    const res = await asanaFetch(`/tasks?${qs.toString()}`);
    const body = await res.json();
    for (const t of body.data || []) {
      if (!t.completed) tasks.push(t);
    }
    offset = body.next_page && body.next_page.offset;
    if (!offset) break;
    await throttle();
  }
  return tasks;
}

async function uploadTemplateToTask(taskGid, fileBytes, filename) {
  const form = new FormData();
  form.set('parent', taskGid);
  form.set(
    'file',
    new Blob([fileBytes], { type: 'text/markdown' }),
    filename,
  );
  const res = await asanaFetch('/attachments', {
    method: 'POST',
    body: form,
  });
  const body = await res.json();
  return body.data;
}

async function main() {
  const absPath = resolve(process.cwd(), TEMPLATE_PATH);
  const info = await stat(absPath).catch(() => null);
  if (!info || !info.isFile()) {
    console.error(`Template not found at ${absPath}.`);
    process.exit(1);
  }
  const fileBytes = await readFile(absPath);
  const filename = 'MLRO_Monthly_Report_TEMPLATE.md';

  console.log(`Template:  ${absPath} (${fileBytes.length} bytes)`);
  console.log(`Project:   ${MLRO_PROJECT_GID}`);
  console.log(`Dry run:   ${DRY_RUN ? 'yes' : 'no'}`);
  console.log('');

  console.log('Fetching open MLRO Monthly Report tasks...');
  const tasks = await listOpenMlroTasks();
  console.log(`Found ${tasks.length} open task(s).`);
  console.log('');

  if (DRY_RUN) {
    for (const t of tasks) console.log(`  [${t.gid}] ${t.name}`);
    console.log('');
    console.log('Dry run complete. No files uploaded.');
    return;
  }

  let success = 0;
  let failed = 0;
  const failures = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const label = `[${i + 1}/${tasks.length}] ${t.name}`;
    try {
      await throttle();
      const att = await uploadTemplateToTask(t.gid, fileBytes, filename);
      console.log(`OK   ${label}  (attachment ${att.gid})`);
      success++;
    } catch (err) {
      console.error(`FAIL ${label}  ${err.message}`);
      failures.push({ gid: t.gid, name: t.name, error: err.message });
      failed++;
    }
  }

  console.log('');
  console.log('Summary');
  console.log(`  Uploaded : ${success}`);
  console.log(`  Failed   : ${failed}`);
  if (failures.length) {
    console.log('');
    console.log('Failed tasks:');
    for (const f of failures) {
      console.log(`  - [${f.gid}] ${f.name}`);
      console.log(`      ${f.error}`);
    }
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
