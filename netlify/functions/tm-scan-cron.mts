/**
 * TM Scan Cron -- daily transaction monitoring job that walks every
 * customer's recent transactions in the Netlify Blob store, runs the
 * TM Brain (rule engine + typology matcher + statistical layer), and
 * returns verdict records per customer.
 *
 * POST /api/tm-scan   (manual / setup.html button)
 *
 * Scheduled: daily Netlify scheduled function via
 * `config.schedule = '0 6 * * *'` (06:00 UTC = 10:00 Dubai time).
 *
 * Why it's read-only by default:
 *   Same pattern as expiry-scan-cron -- the first run is always
 *   dry-run so the operator can review verdicts before STR deadlines
 *   start ticking. Pass `{ dispatch: true }` to create Asana tasks
 *   for flagged/escalated/auto-str customers.
 *
 * Security:
 *   POST + OPTIONS
 *   Bearer HAWKEYE_BRAIN_TOKEN
 *   Rate limited 10 / 15 min
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.15     (suspicious transaction monitoring)
 *   FDL No.10/2025 Art.26-27  (STR filing within 10 business days)
 *   Cabinet Res 134/2025 Art.14 (ongoing monitoring of EDD customers)
 *   MoE Circular 08/AML/2021  (DPMS AED 55K CTR threshold)
 *   FATF Rec 10, 11, 20, 21   (ongoing CDD + STR)
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';
import type { Transaction, TmVerdictRecord } from '../../src/domain/transaction';
import { runTmBrainAllCustomers, type TmBrainOptions } from '../../src/services/txMonitoringBrain';
import { fetchWithTimeout } from '../../src/utils/fetchWithTimeout';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':
    process.env.HAWKEYE_ALLOWED_ORIGIN ?? 'https://hawkeye-sterling-v2.netlify.app',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '600',
  Vary: 'Origin',
} as const;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init.headers ?? {}) },
  });
}

// ---------------------------------------------------------------------------
// Blob-store loader for transactions
// ---------------------------------------------------------------------------

async function loadRecentTransactions(): Promise<readonly Transaction[]> {
  const store = getStore('customer-transactions');
  const listed = await store.list({ prefix: 'tx/' });
  const transactions: Transaction[] = [];
  for (const entry of listed.blobs) {
    try {
      const raw = (await store.get(entry.key, { type: 'json' })) as Transaction | Transaction[] | null;
      if (!raw) continue;
      // Support both single-tx and batch-tx blobs.
      if (Array.isArray(raw)) {
        for (const t of raw) {
          if (t && typeof t === 'object' && t.id && t.customerId) transactions.push(t);
        }
      } else if (raw.id && raw.customerId) {
        transactions.push(raw);
      }
    } catch {
      // skip corrupt entries
    }
  }
  return transactions;
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

interface ScanRequest {
  /** If true, create Asana tasks for flagged customers. Default: dry-run. */
  readonly dispatch?: boolean;
  /** ISO 8601 "as of" date override for tests. Default: now. */
  readonly asOfIso?: string;
  /** Optional customer ID filter -- scan only this customer. */
  readonly customerId?: string;
}

function validateRequest(
  raw: unknown
): { ok: true; req: ScanRequest } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: true, req: {} };
  const r = raw as Record<string, unknown>;
  const req: ScanRequest = {};
  if (r.dispatch !== undefined) {
    if (typeof r.dispatch !== 'boolean') {
      return { ok: false, error: 'dispatch must be boolean' };
    }
    (req as { dispatch: boolean }).dispatch = r.dispatch;
  }
  if (r.asOfIso !== undefined) {
    if (typeof r.asOfIso !== 'string' || Number.isNaN(Date.parse(r.asOfIso))) {
      return { ok: false, error: 'asOfIso must be a valid ISO 8601 string' };
    }
    (req as { asOfIso: string }).asOfIso = r.asOfIso;
  }
  if (r.customerId !== undefined) {
    if (typeof r.customerId !== 'string' || r.customerId.length === 0) {
      return { ok: false, error: 'customerId must be a non-empty string' };
    }
    (req as { customerId: string }).customerId = r.customerId;
  }
  return { ok: true, req };
}

// ---------------------------------------------------------------------------
// Verdict summary builder
// ---------------------------------------------------------------------------

interface TmScanSummary {
  readonly asOfIso: string;
  readonly scannedCustomers: number;
  readonly scannedTransactions: number;
  readonly verdicts: readonly TmVerdictRecord[];
  readonly byVerdict: Readonly<Record<string, number>>;
  readonly totalFindings: number;
  readonly summary: string;
  readonly regulatory: readonly string[];
}

function buildScanSummary(
  records: readonly TmVerdictRecord[],
  totalTxCount: number,
  asOf: Date
): TmScanSummary {
  const byVerdict: Record<string, number> = {};
  let totalFindings = 0;
  for (const r of records) {
    byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
    totalFindings += r.findings.length;
  }
  const flagged = records.filter((r) => r.verdict !== 'pass');
  const summary =
    flagged.length === 0
      ? `TM SCAN CLEAN: ${records.length} customer(s), ${totalTxCount} transaction(s) scanned. No findings.`
      : `TM SCAN: ${flagged.length} of ${records.length} customer(s) flagged across ${totalTxCount} transaction(s). ` +
        `${totalFindings} finding(s). Verdicts: ${Object.entries(byVerdict).map(([k, v]) => `${k}=${v}`).join(', ')}.`;
  return {
    asOfIso: asOf.toISOString(),
    scannedCustomers: records.length,
    scannedTransactions: totalTxCount,
    verdicts: records,
    byVerdict,
    totalFindings,
    summary,
    regulatory: [
      'FDL No.10/2025 Art.15',
      'FDL No.10/2025 Art.26-27',
      'Cabinet Res 134/2025 Art.14',
      'MoE Circular 08/AML/2021',
      'FATF Rec 10',
      'FATF Rec 20',
      'FATF Rec 21',
    ],
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
  }

  const rl = await checkRateLimit(req, {
    max: 10,
    clientIp: context.ip,
    namespace: 'tm-scan',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  // Accept empty body for the scheduled-function path.
  let body: unknown = {};
  try {
    const text = await req.text();
    if (text.length > 0) body = JSON.parse(text);
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const v = validateRequest(body);
  if (!v.ok) return jsonResponse({ error: v.error }, { status: 400 });

  const asOf = v.req.asOfIso ? new Date(v.req.asOfIso) : new Date();

  // Load transactions from blob store.
  let transactions: readonly Transaction[];
  try {
    transactions = await loadRecentTransactions();
  } catch (err) {
    return jsonResponse(
      {
        error: 'load_transactions_failed',
        reason: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }

  // Filter by customerId if provided.
  if (v.req.customerId) {
    transactions = transactions.filter((t) => t.customerId === v.req.customerId);
  }

  if (transactions.length === 0) {
    return jsonResponse({
      ok: true,
      ...buildScanSummary([], 0, asOf),
      dispatchNote: 'No transactions to scan.',
    });
  }

  // Run the TM brain across all customers.
  const brainOptions: TmBrainOptions = { asOf };
  const records = runTmBrainAllCustomers(transactions, brainOptions);
  const scanSummary = buildScanSummary(records, transactions.length, asOf);

  // Audit trail -- always written.
  try {
    const audit = getStore('tm-scan-audit');
    await audit.setJSON(`scan/${Date.now()}.json`, {
      tsIso: asOf.toISOString(),
      userId: auth.userId ?? null,
      dispatch: v.req.dispatch === true,
      customerId: v.req.customerId ?? null,
      scannedCustomers: scanSummary.scannedCustomers,
      scannedTransactions: scanSummary.scannedTransactions,
      totalFindings: scanSummary.totalFindings,
      byVerdict: scanSummary.byVerdict,
      summary: scanSummary.summary,
    });
  } catch {
    // non-fatal
  }

  // ---------------------------------------------------------------------------
  // Asana dispatch for flagged customers (when dispatch=true)
  // ---------------------------------------------------------------------------
  let dispatched = 0;
  let skipped = 0;
  let dispatchErrors = 0;
  let dispatchNote = '';

  const tmProjectGid = process.env.ASANA_KYC_CDD_TRACKER_PROJECT_GID;
  const asanaToken = process.env.ASANA_ACCESS_TOKEN;
  const dispatch = v.req.dispatch === true;

  const flaggedRecords = records.filter((r) => r.verdict !== 'pass');

  if (dispatch && tmProjectGid && asanaToken && asanaToken.length >= 16 && flaggedRecords.length > 0) {
    // List existing task names for idempotency (paginated).
    let existingTaskNames: Set<string>;
    try {
      existingTaskNames = new Set<string>();
      let nextUrl: string | null =
        `https://app.asana.com/api/1.0/projects/${encodeURIComponent(tmProjectGid)}/tasks?opt_fields=name&limit=100`;
      while (nextUrl) {
        const tasksRes = await fetchWithTimeout(nextUrl, {
          headers: { Authorization: `Bearer ${asanaToken}`, Accept: 'application/json' },
          timeoutMs: 20_000,
        });
        if (!tasksRes.ok) throw new Error(`HTTP ${tasksRes.status}`);
        const tasksJson = (await tasksRes.json()) as {
          data: Array<{ name: string }>;
          next_page: { uri: string } | null;
        };
        for (const t of tasksJson.data) existingTaskNames.add(t.name);
        nextUrl = tasksJson.next_page?.uri ?? null;
      }
    } catch {
      existingTaskNames = new Set();
    }

    // Create one task per flagged customer.
    for (const record of flaggedRecords) {
      const taskName = `TM ${record.verdict.toUpperCase()} -- ${record.customerId} -- ${record.findings.length} finding(s)`;

      if (existingTaskNames.has(taskName)) {
        skipped++;
        continue;
      }

      const findingsList = record.findings
        .map((f) => `- [${f.severity}] ${f.kind}: ${f.message}`)
        .join('\n');
      const taskBody = [
        `**Customer:** ${record.customerId}`,
        `**Verdict:** ${record.verdict}`,
        `**Findings:** ${record.findings.length}`,
        `**Top severity:** ${record.topSeverity}`,
        record.strFilingDeadlineDdMmYyyy
          ? `**STR filing deadline:** ${record.strFilingDeadlineDdMmYyyy} (FDL Art.26-27, 10 business days)`
          : '',
        `**Window:** ${record.windowStartIso} to ${record.windowEndIso}`,
        `**Scanned:** ${record.scannedTxCount} transaction(s)`,
        '',
        '**Findings detail:**',
        findingsList,
        '',
        '---',
        `*Auto-generated by TM scan cron at ${asOf.toISOString()}.*`,
      ]
        .filter(Boolean)
        .join('\n');

      // Compute due date: STR deadline if auto-str, else 3 business days for review.
      const dueOn = record.strFilingDeadlineDdMmYyyy
        ? (() => {
            const parts = record.strFilingDeadlineDdMmYyyy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
            return parts ? `${parts[3]}-${parts[2]}-${parts[1]}` : undefined;
          })()
        : undefined;

      try {
        const createRes = await fetchWithTimeout('https://app.asana.com/api/1.0/tasks', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${asanaToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            data: {
              name: taskName,
              notes: taskBody,
              projects: [tmProjectGid],
              ...(dueOn ? { due_on: dueOn } : {}),
              tags: [],
            },
          }),
          timeoutMs: 15_000,
        });
        if (!createRes.ok) {
          dispatchErrors++;
        } else {
          dispatched++;
          existingTaskNames.add(taskName);
        }
      } catch {
        dispatchErrors++;
      }
    }

    dispatchNote =
      `Dispatched ${dispatched} task(s) to Asana project ${tmProjectGid}. ` +
      `${skipped} skipped (already exist). ${dispatchErrors} error(s).`;
  } else if (dispatch && !tmProjectGid) {
    dispatchNote =
      'dispatch=true but ASANA_KYC_CDD_TRACKER_PROJECT_GID is not set. Drafts returned for manual review.';
  } else if (dispatch && (!asanaToken || asanaToken.length < 16)) {
    dispatchNote =
      'dispatch=true but ASANA_ACCESS_TOKEN is missing or too short. Drafts returned for manual review.';
  } else if (dispatch && flaggedRecords.length === 0) {
    dispatchNote = 'dispatch=true but no customers were flagged. Nothing to dispatch.';
  } else {
    dispatchNote =
      'Dry-run: verdict records returned for operator review. Pass { "dispatch": true } to create Asana tasks for flagged customers.';
  }

  return jsonResponse({
    ok: true,
    ...scanSummary,
    flaggedCustomers: flaggedRecords.length,
    dispatched,
    skipped,
    dispatchErrors,
    dispatchNote,
  });
};

export const config: Config = {
  // Daily at 06:00 UTC (10:00 Dubai). Runs after expiry-scan (05:00)
  // so both reports are ready by mid-morning.
  // Manual trigger: POST /.netlify/functions/tm-scan-cron
  schedule: '0 6 * * *',
};

// Exported for unit tests.
export const __test__ = {
  validateRequest,
  buildScanSummary,
};
