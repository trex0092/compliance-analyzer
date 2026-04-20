/**
 * STR Drafter Agent endpoint — emits a goAML-shaped XML skeleton
 * from a disposition payload. First-cut: the skeleton validates at
 * the envelope + report-header + subject blocks; the suspicion
 * narrative is populated from the MLRO rationale. The output must
 * still be validated against the UAE FIU schema before the MLRO
 * signs.
 *
 * POST /api/agents/str-drafter
 * Body: {
 *   eventId, subjectName, subjectCode?, jurisdiction?,
 *   dispositionOutcome, rationale, keyFindings?,
 *   topClassification, topScore, listsScreened, adverseMediaHits,
 *   mlroName, secondApprover?
 * }
 *
 * Security: Bearer HAWKEYE_BRAIN_TOKEN + rate-limit 30/15min.
 * Regulatory: FDL No.10/2025 Art.26-27 · Cabinet Res 74/2020 Art.6
 *             · goAML Schema · FDL Art.29 (no tipping off)
 */

import type { Config, Context } from '@netlify/functions';
import { authenticate } from './middleware/auth.mts';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { getStore } from '@netlify/blobs';
import { resolveAsanaProjectGid } from '../../src/services/asanaModuleProjects';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':
    process.env.HAWKEYE_ALLOWED_ORIGIN ?? 'https://hawkeye-sterling-v2.netlify.app',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
} as const;

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function buildGoamlXml(d: Record<string, string | number | string[] | undefined>): string {
  const now = new Date().toISOString();
  const subjectLines = Array.isArray(d.listsScreened)
    ? (d.listsScreened as string[]).map((l) => `      <sanctions_list>${esc(l)}</sanctions_list>`).join('\n')
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<report xmlns="goaml-schema/v5" generated_at="${esc(now)}">
  <envelope>
    <report_code>STR</report_code>
    <report_reference>${esc(d.eventId)}</report_reference>
    <jurisdiction>${esc(d.jurisdiction || 'UAE')}</jurisdiction>
  </envelope>
  <header>
    <filing_mlro>${esc(d.mlroName)}</filing_mlro>
    <second_approver>${esc(d.secondApprover || '')}</second_approver>
    <disposition_outcome>${esc(d.dispositionOutcome)}</disposition_outcome>
    <disposition_at>${esc(now)}</disposition_at>
  </header>
  <subject>
    <name>${esc(d.subjectName)}</name>
    <customer_code>${esc(d.subjectCode || '')}</customer_code>
  </subject>
  <screening>
    <top_classification>${esc(d.topClassification)}</top_classification>
    <top_score>${esc(String(d.topScore ?? 0))}</top_score>
    <adverse_media_hits>${esc(String(d.adverseMediaHits ?? 0))}</adverse_media_hits>
    <lists_screened>
${subjectLines}
    </lists_screened>
  </screening>
  <suspicion_narrative><![CDATA[${String(d.rationale || '')}]]></suspicion_narrative>
  <key_findings><![CDATA[${String(d.keyFindings || '')}]]></key_findings>
  <regulatory_basis>FDL No.10/2025 Art.26-27 · Cabinet Res 74/2020 Art.6 · FATF Rec 20</regulatory_basis>
  <no_tipping_off confirmed="true" citation="FDL No.10/2025 Art.29"/>
</report>
`;
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return Response.json({ ok: false, error: 'method not allowed' }, { status: 405, headers: CORS_HEADERS });

  const rl = await checkRateLimit(req, { max: 30, clientIp: context.ip, namespace: 'agent-str-drafter' });
  if (rl) return rl;
  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; } catch { return Response.json({ ok: false, error: 'invalid JSON' }, { status: 400, headers: CORS_HEADERS }); }
  const required = ['eventId', 'subjectName', 'dispositionOutcome', 'rationale', 'mlroName'];
  for (const k of required) {
    if (!body[k] || typeof body[k] !== 'string') {
      return Response.json({ ok: false, error: `${k} required (string)` }, { status: 400, headers: CORS_HEADERS });
    }
  }

  const xml = buildGoamlXml(body as Record<string, string | number | string[]>);
  const ranAt = new Date().toISOString();
  try {
    const store = getStore({ name: 'str-drafts', consistency: 'strong' });
    await store.set(`${ranAt.slice(0, 10)}/${body.eventId}.xml`, xml);
  } catch { /* non-fatal */ }

  return Response.json(
    {
      ok: true,
      eventId: body.eventId,
      xmlLength: xml.length,
      xml,
      asanaBoard: resolveAsanaProjectGid('str_cases'),
      ranAt,
      note: 'Draft only — validate against UAE FIU schema before MLRO signs. Second approver required for partial / confirmed matches (FDL Art.20-21).',
    },
    { headers: CORS_HEADERS },
  );
};

export const config: Config = {
  path: '/api/agents/str-drafter',
  method: ['POST', 'OPTIONS'],
};
