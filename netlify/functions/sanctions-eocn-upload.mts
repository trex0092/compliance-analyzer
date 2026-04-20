/**
 * EOCN / UAE Sanctions Manual Upload Endpoint.
 *
 * UAE EOCN distributes its sanctions list via PDF / XML circulars —
 * there is no stable public URL that can be polled by the ingest cron.
 * The MLRO is therefore expected to convert the latest EOCN circular
 * into a normalised JSON payload and POST it here on the EOCN
 * publication cadence.
 *
 * Once accepted, the snapshot is persisted under
 * `sanctions-snapshots/UAE_EOCN/<YYYY-MM-DD>/snapshot.json` — exactly
 * the path the ingest cron would use for an automated source — so
 * both the sanctions-delta-screen cron and the MLRO briefings pick
 * the upload up on their next run.
 *
 * Usage:
 *   POST /api/sanctions/eocn-upload
 *   Authorization: Bearer <SANCTIONS_UPLOAD_TOKEN>
 *   Content-Type: application/json
 *
 *   Body: {
 *     "circularDate": "2026-04-15",       // optional, defaults to today
 *     "circularReference": "EOCN/2026/07", // optional, audit only
 *     "entries": NormalisedSanction[]     // required
 *   }
 *
 *   Each entry must have: source = 'UAE_EOCN', sourceId, primaryName,
 *   aliases (array), type, programmes (array), hash.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (record retention — audit trail of every
 *     upload)
 *   - FDL No.10/2025 Art.35 (TFS sanctions completeness)
 *   - Cabinet Res 74/2020 Art.4-7 (UAE-specific designations — the
 *     domestic source this endpoint feeds)
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';

const SNAPSHOT_STORE = 'sanctions-snapshots';
const INGEST_AUDIT_STORE = 'sanctions-ingest-audit';

interface NormalisedSanctionLike {
  source: 'UAE_EOCN';
  sourceId: string;
  primaryName: string;
  aliases?: ReadonlyArray<string>;
  type?: 'individual' | 'entity' | 'vessel' | 'aircraft' | 'unknown';
  dateOfBirth?: string;
  nationality?: string;
  programmes?: ReadonlyArray<string>;
  remarks?: string;
  hash?: string;
}

interface UploadBody {
  circularDate?: string;
  circularReference?: string;
  entries: ReadonlyArray<NormalisedSanctionLike>;
}

function isAuthorised(req: Request): boolean {
  const expected = process.env.SANCTIONS_UPLOAD_TOKEN;
  if (!expected) return false; // writes always require a token
  const header = req.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] === expected;
}

function validateEntry(
  entry: unknown,
  index: number
): { ok: true; value: NormalisedSanctionLike } | { ok: false; error: string } {
  if (!entry || typeof entry !== 'object') {
    return { ok: false, error: `entries[${index}] is not an object` };
  }
  const e = entry as Record<string, unknown>;
  if (e.source !== 'UAE_EOCN') {
    return {
      ok: false,
      error: `entries[${index}].source must be "UAE_EOCN", got ${JSON.stringify(e.source)}`,
    };
  }
  if (typeof e.sourceId !== 'string' || !e.sourceId) {
    return {
      ok: false,
      error: `entries[${index}].sourceId is required and must be a non-empty string`,
    };
  }
  if (typeof e.primaryName !== 'string' || !e.primaryName) {
    return {
      ok: false,
      error: `entries[${index}].primaryName is required and must be a non-empty string`,
    };
  }
  if (e.aliases !== undefined && !Array.isArray(e.aliases)) {
    return { ok: false, error: `entries[${index}].aliases must be an array of strings` };
  }
  if (e.programmes !== undefined && !Array.isArray(e.programmes)) {
    return { ok: false, error: `entries[${index}].programmes must be an array of strings` };
  }
  return { ok: true, value: e as unknown as NormalisedSanctionLike };
}

async function writeAudit(payload: Record<string, unknown>): Promise<void> {
  try {
    const store = getStore(INGEST_AUDIT_STORE);
    const iso = new Date().toISOString();
    await store.setJSON(`${iso.slice(0, 10)}/${Date.now()}.json`, {
      ...payload,
      recordedAt: iso,
    });
  } catch {
    /* audit best-effort */
  }
}

export default async (req: Request, context: Context): Promise<Response> => {
  const startedAt = new Date().toISOString();

  // Sensitive tier: 10 requests per IP per 15 minutes. This is a write
  // endpoint that persists MLRO-uploaded UAE_EOCN sanctions snapshots
  // (Cabinet Res 74/2020 Art.4-7); must not be scrape-friendly.
  const rateLimited = await checkRateLimit(req, {
    clientIp: context.ip,
    namespace: 'sanctions-eocn-upload',
    max: 10,
  });
  if (rateLimited) return rateLimited;

  if (!isAuthorised(req)) {
    return Response.json(
      {
        ok: false,
        error:
          'unauthorised — set Authorization: Bearer <SANCTIONS_UPLOAD_TOKEN> (also requires SANCTIONS_UPLOAD_TOKEN env var set on the server)',
      },
      { status: 401 }
    );
  }

  let body: UploadBody;
  try {
    const raw = await req.json();
    body = raw as UploadBody;
  } catch (err) {
    return Response.json(
      { ok: false, error: `malformed JSON body: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  if (!Array.isArray(body.entries)) {
    return Response.json({ ok: false, error: 'entries[] is required' }, { status: 400 });
  }

  const normalised: NormalisedSanctionLike[] = [];
  for (let i = 0; i < body.entries.length; i++) {
    const res = validateEntry(body.entries[i], i);
    if (!res.ok) {
      return Response.json({ ok: false, error: res.error }, { status: 400 });
    }
    // Provide safe defaults for optional fields so downstream consumers
    // don't need to handle `undefined` for the array fields.
    normalised.push({
      ...res.value,
      aliases: res.value.aliases ?? [],
      programmes: res.value.programmes ?? [],
      type: res.value.type ?? 'unknown',
    });
  }

  // Persist to the snapshot store using the same key shape the ingest
  // cron uses (UAE_EOCN/<day>/snapshot.json) so the coverage probe
  // transitions from manual-pending → ok on the next briefing run.
  const day = (body.circularDate ?? startedAt).slice(0, 10);
  const key = `UAE_EOCN/${day}/snapshot.json`;
  try {
    const store = getStore(SNAPSHOT_STORE);
    await store.setJSON(key, normalised);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await writeAudit({
      event: 'eocn_manual_upload_failed',
      source: 'UAE_EOCN',
      error,
      entryCount: normalised.length,
    });
    return Response.json({ ok: false, error }, { status: 500 });
  }

  await writeAudit({
    event: 'eocn_manual_upload',
    source: 'UAE_EOCN',
    circularDate: day,
    circularReference: body.circularReference,
    entryCount: normalised.length,
    snapshotKey: key,
  });

  return Response.json({
    ok: true,
    startedAt,
    source: 'UAE_EOCN',
    snapshotKey: key,
    entryCount: normalised.length,
    circularDate: day,
    circularReference: body.circularReference,
  });
};

export const config: Config = {
  path: '/api/sanctions/eocn-upload',
  method: ['POST'],
};
