/**
 * Sanctions Feed Debug — on-demand diagnostic endpoint.
 *
 * Fetches a canonical sanctions-list URL with the same User-Agent the
 * ingest cron uses and returns the HTTP status, content-type, byte
 * length, and the first 2000 characters of the response body.
 *
 * Purpose: lets the MLRO / operator see the raw upstream payload so
 * we can diagnose parser drift when the ingest cron reports
 * `ok: true, fetched: 0` (feed reachable but parser yields no rows).
 *
 * Usage:
 *   GET /.netlify/functions/sanctions-feed-debug?source=OFAC_CONS
 *   (optionally with header `Authorization: Bearer <SANCTIONS_UPLOAD_TOKEN>`)
 *
 * Safety:
 *   - Read-only. Never writes to any blob store. Never triggers the
 *     ingest cron.
 *   - Gated by SANCTIONS_UPLOAD_TOKEN when the env var is set. If the
 *     env var is unset, the endpoint is available without auth, which
 *     is appropriate for dev deploys but should be set in production.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.35 (TFS sanctions completeness — the MLRO
 *     needs a way to verify upstream feed health)
 */

import type { Config } from '@netlify/functions';

const INGEST_USER_AGENT =
  'Mozilla/5.0 (compatible; HawkeyeSterlingComplianceBot/1.0; +https://github.com/trex0092/compliance-analyzer)';

const FETCH_TIMEOUT_MS = 30_000;

const SOURCE_URLS: Record<string, string> = {
  OFAC_SDN: 'https://www.treasury.gov/ofac/downloads/sdn.csv',
  OFAC_CONS: 'https://www.treasury.gov/ofac/downloads/consolidated/cons_prim.csv',
  UN: 'https://scsanctions.un.org/resources/xml/en/consolidated.xml',
  EU: 'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw',
  UK_OFSI: 'https://ofsistorage.blob.core.windows.net/publishlive/2022format/ConList.csv',
};

function isAuthorised(req: Request): boolean {
  const expected = process.env.SANCTIONS_UPLOAD_TOKEN;
  if (!expected) return true; // auth disabled when env var absent
  const header = req.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] === expected;
}

export default async (req: Request): Promise<Response> => {
  if (!isAuthorised(req)) {
    return Response.json(
      { ok: false, error: 'unauthorised — set Authorization: Bearer <SANCTIONS_UPLOAD_TOKEN>' },
      { status: 401 }
    );
  }

  const url = new URL(req.url);
  const source = url.searchParams.get('source');
  if (!source || !(source in SOURCE_URLS)) {
    return Response.json(
      {
        ok: false,
        error: 'query parameter `source` required',
        validSources: Object.keys(SOURCE_URLS),
      },
      { status: 400 }
    );
  }

  const targetUrl = SOURCE_URLS[source]!;
  const startedAt = new Date().toISOString();

  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': INGEST_USER_AGENT,
        Accept: 'text/csv, application/xml, text/xml, */*',
      },
    });
    const body = await res.text();
    return Response.json({
      ok: true,
      startedAt,
      source,
      url: targetUrl,
      httpStatus: res.status,
      httpStatusText: res.statusText,
      contentType: res.headers.get('content-type'),
      byteLength: body.length,
      firstLines: body.split(/\r?\n/).slice(0, 20),
      first2000Chars: body.slice(0, 2000),
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        startedAt,
        source,
        url: targetUrl,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
};

export const config: Config = {
  path: '/api/sanctions/feed-debug',
  method: ['GET'],
};
