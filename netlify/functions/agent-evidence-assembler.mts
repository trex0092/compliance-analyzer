/**
 * Evidence Assembler Agent endpoint — collects every artefact tied
 * to a customer code into a JSON manifest + a zip-ready blob list.
 * First-cut produces the manifest only (full zip assembly via jszip
 * lands when the /evidence-bundle skill is fully wired).
 *
 * POST /api/agents/evidence-assembler
 * Body: {
 *   customerCode: string,
 *   forInspection?: 'moe'|'lbma'|'cbuae'|'internal'|'legal',
 *   since?: string (ISO)
 * }
 *
 * Security: Bearer HAWKEYE_BRAIN_TOKEN + rate-limit 15/15min.
 * Regulatory: FDL Art.24 · LBMA RGG v9 Step 5 · Cabinet Res 71/2024
 *             · UAE PDPL Art.6(1)(c)
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { authenticate } from './middleware/auth.mts';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { resolveAsanaProjectGid } from '../../src/services/asanaModuleProjects';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':
    process.env.HAWKEYE_ALLOWED_ORIGIN ?? 'https://hawkeye-sterling-v2.netlify.app',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
} as const;

function sha(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return ('0000000' + (h >>> 0).toString(16)).slice(-8);
}

async function listBlobKeys(storeName: string, prefix = ''): Promise<string[]> {
  try {
    const store = getStore({ name: storeName });
    const { blobs } = await store.list({ prefix });
    return blobs.map((b) => b.key);
  } catch {
    return [];
  }
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST')
    return Response.json({ ok: false, error: 'method not allowed' }, { status: 405, headers: CORS_HEADERS });

  const rl = await checkRateLimit(req, { max: 15, clientIp: context.ip, namespace: 'agent-evidence-assembler' });
  if (rl) return rl;
  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return Response.json({ ok: false, error: 'invalid JSON' }, { status: 400, headers: CORS_HEADERS }); }

  const customerCode = typeof body.customerCode === 'string' ? body.customerCode.trim() : '';
  if (!customerCode) return Response.json({ ok: false, error: 'customerCode required' }, { status: 400, headers: CORS_HEADERS });
  const forInspection = typeof body.forInspection === 'string' ? body.forInspection : 'internal';
  const since = typeof body.since === 'string' ? body.since : '';

  // Scan every audit store that might hold records for this customer.
  const STORES = [
    'screening-snapshots', 'screening-events', 'str-drafts',
    'sanctions-delta-screen-audit', 'tm-scan-audit', 'four-eyes-sla-audit',
    'retention-sweep-audit', 'goaml-health-audit', 'am-hot-audit',
    'pep-rescreen-audit', 'eocn-retry-audit', 'cahra-audit',
    'modern-slavery-audit', 'asm-audit', 'mercury-audit', 'child-labour-audit',
    'carbon-audit', 'water-audit', 'grievance-audit',
    'refiner-accred-audit', 'dual-use-audit', 'coc-audit', 'assay-drift-audit',
    'customs-recon-audit', 'saq-rollover-audit', 'lbma-audit-countdown',
    'origin-audit', 'brain-lessons-audit', 'clamp-digest-audit',
    'advisor-budget-audit', 'ai-governance-audit', 'red-team-audit',
    'regulatory-drift-audit', 'regulatory-horizon-audit',
  ];
  const inventory: Array<{ store: string; keys: string[]; count: number }> = [];
  let totalArtefacts = 0;
  for (const name of STORES) {
    const keys = await listBlobKeys(name);
    if (keys.length > 0) {
      const filtered = since
        ? keys.filter((k) => k.localeCompare(since.slice(0, 10)) >= 0)
        : keys;
      if (filtered.length > 0) {
        inventory.push({ store: name, keys: filtered.slice(0, 100), count: filtered.length });
        totalArtefacts += filtered.length;
      }
    }
  }

  const generatedAt = new Date().toISOString();
  const fingerprint = sha(customerCode + generatedAt + JSON.stringify(inventory));
  const manifest = {
    version: 1,
    customerCode,
    forInspection,
    since: since || '(all history)',
    generatedAt,
    fingerprint,
    totalArtefacts,
    inventory,
    asanaBoard: resolveAsanaProjectGid('audit_inspection'),
    regulatoryBasis:
      'FDL No.10/2025 Art.24 · Cabinet Res 71/2024 · LBMA RGG v9 Step 5 · FATF Rec 22-23 · UAE PDPL Art.6(1)(c) · ISO/IEC 27001 A.12.4',
    retentionNotice:
      '10-year retention applies to every artefact in this manifest (FDL No.10/2025 Art.24).',
    signingInstructions:
      'MLRO signature required before release to external auditor. Re-run with refreshed "since" if additional artefacts arrive.',
  };

  try {
    const store = getStore({ name: 'evidence-bundles', consistency: 'strong' });
    await store.setJSON(
      `${customerCode}/${generatedAt}-manifest.json`,
      { ...manifest, ranBy: auth.username ?? auth.userId ?? null },
    );
  } catch { /* non-fatal */ }

  return Response.json({ ok: true, manifest }, { headers: CORS_HEADERS });
};

export const config: Config = {
  path: '/api/agents/evidence-assembler',
  method: ['POST', 'OPTIONS'],
};
