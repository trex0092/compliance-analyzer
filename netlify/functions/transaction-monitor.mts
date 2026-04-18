/**
 * Transaction Monitor — batch transaction monitoring endpoint.
 *
 * POST /api/transaction/monitor
 *   body = {
 *     customerId: string,
 *     customerName: string,
 *     profile?: CustomerProfile,         // optional baseline for behavioral rules
 *     transactions: TransactionInput[],  // 1..50 per call
 *     createAsanaOnCritical?: boolean,   // default true
 *   }
 *
 * Returns a per-transaction alert array plus a session summary. Alerts
 * exercise the full weaponized pipeline:
 *
 *   - Rule-based (structuring, profile-mismatch, third-party, offshore
 *     routing, cash threshold, round-number, price-gaming, etc. —
 *     src/risk/transactionMonitoring.ts)
 *   - Velocity (rolling 24h window, max N transactions)
 *   - Behavioral deviation (amount vs customer's rolling baseline)
 *   - Cumulative exposure (30-day rolling)
 *   - Cross-border threshold (AED 60K)
 *
 * The in-memory TransactionMonitoringEngine is reinstantiated per call
 * by design — tenant isolation, zero cross-tenant leak. State that
 * MUST persist across calls (customer baselines, 30-day cumulative
 * windows) is the caller's responsibility and is passed in via the
 * `profile` field. Scheduled rollups live in the dedicated
 * /api/customer-profile + /api/brain pipelines.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.15-16 (thresholds), Art.20-21 (CO monitoring),
 *     Art.26-27 (STR filing)
 *   - Cabinet Res 134/2025 Art.16 (cross-border cash AED 60K), Art.19
 *     (continuous monitoring)
 *   - MoE Circular 08/AML/2021 (DPMS AED 55K CTR threshold)
 *   - FATF Rec 10 (ongoing CDD), Rec 20 (STR obligations)
 */

import type { Config, Context } from '@netlify/functions';
import { authenticate } from './middleware/auth.mts';
import { checkRateLimit } from './middleware/rate-limit.mts';
import {
  TransactionMonitoringEngine,
  type CustomerProfile,
  type EnhancedTMAlert,
} from '../../src/services/transactionMonitoringEngine';
import type { TransactionInput } from '../../src/risk/transactionMonitoring';
import { createAsanaTask } from '../../src/services/asanaClient';

const MAX_BODY_SIZE = 128 * 1024;
const MAX_TRANSACTIONS_PER_CALL = 50;

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
// Input validation
// ---------------------------------------------------------------------------

export interface TransactionMonitorInput {
  customerId: string;
  customerName: string;
  profile?: CustomerProfile;
  transactions: TransactionInput[];
  createAsanaOnCritical?: boolean;
}

function isRiskRating(v: unknown): v is 'low' | 'medium' | 'high' {
  return v === 'low' || v === 'medium' || v === 'high';
}

function validateTransaction(
  raw: unknown,
  index: number
): { ok: true; tx: TransactionInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: `transactions[${index}] must be an object` };
  }
  const t = raw as Record<string, unknown>;
  if (typeof t.amount !== 'number' || !Number.isFinite(t.amount) || t.amount < 0) {
    return { ok: false, error: `transactions[${index}].amount must be a non-negative number` };
  }
  if (typeof t.currency !== 'string' || t.currency.length === 0 || t.currency.length > 8) {
    return {
      ok: false,
      error: `transactions[${index}].currency must be a non-empty string (max 8 chars)`,
    };
  }
  if (typeof t.customerName !== 'string' || t.customerName.length === 0) {
    return { ok: false, error: `transactions[${index}].customerName must be a non-empty string` };
  }
  if (!isRiskRating(t.customerRiskRating)) {
    return {
      ok: false,
      error: `transactions[${index}].customerRiskRating must be "low" | "medium" | "high"`,
    };
  }
  if (typeof t.payerMatchesCustomer !== 'boolean') {
    return { ok: false, error: `transactions[${index}].payerMatchesCustomer must be a boolean` };
  }
  return { ok: true, tx: t as unknown as TransactionInput };
}

function validateProfile(
  raw: unknown
): { ok: true; profile: CustomerProfile } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'profile must be an object' };
  const p = raw as Record<string, unknown>;
  if (typeof p.customerId !== 'string' || p.customerId.length === 0) {
    return { ok: false, error: 'profile.customerId is required' };
  }
  if (typeof p.customerName !== 'string' || p.customerName.length === 0) {
    return { ok: false, error: 'profile.customerName is required' };
  }
  if (!isRiskRating(p.riskRating)) {
    return { ok: false, error: 'profile.riskRating must be "low" | "medium" | "high"' };
  }
  if (typeof p.avgTransactionAmount !== 'number' || p.avgTransactionAmount < 0) {
    return { ok: false, error: 'profile.avgTransactionAmount must be non-negative' };
  }
  if (typeof p.avgTransactionsPerMonth !== 'number' || p.avgTransactionsPerMonth < 0) {
    return { ok: false, error: 'profile.avgTransactionsPerMonth must be non-negative' };
  }
  if (!Array.isArray(p.typicalPaymentMethods)) {
    return { ok: false, error: 'profile.typicalPaymentMethods must be an array' };
  }
  if (!Array.isArray(p.typicalCountries)) {
    return { ok: false, error: 'profile.typicalCountries must be an array' };
  }
  return {
    ok: true,
    profile: {
      customerId: p.customerId,
      customerName: p.customerName,
      riskRating: p.riskRating,
      avgTransactionAmount: p.avgTransactionAmount,
      avgTransactionsPerMonth: p.avgTransactionsPerMonth,
      typicalPaymentMethods: p.typicalPaymentMethods as string[],
      typicalCountries: p.typicalCountries as string[],
      lastTransactionDate: typeof p.lastTransactionDate === 'string' ? p.lastTransactionDate : null,
      profileUpdatedAt:
        typeof p.profileUpdatedAt === 'string' ? p.profileUpdatedAt : new Date().toISOString(),
    },
  };
}

function validateInput(
  raw: unknown
): { ok: true; input: TransactionMonitorInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'body must be a JSON object' };
  const o = raw as Record<string, unknown>;
  if (typeof o.customerId !== 'string' || o.customerId.trim().length === 0) {
    return { ok: false, error: 'customerId is required' };
  }
  if (o.customerId.length > 128) {
    return { ok: false, error: 'customerId too long (max 128 chars)' };
  }
  if (typeof o.customerName !== 'string' || o.customerName.trim().length === 0) {
    return { ok: false, error: 'customerName is required' };
  }
  if (!Array.isArray(o.transactions) || o.transactions.length === 0) {
    return { ok: false, error: 'transactions must be a non-empty array' };
  }
  if (o.transactions.length > MAX_TRANSACTIONS_PER_CALL) {
    return {
      ok: false,
      error: `transactions exceed maximum of ${MAX_TRANSACTIONS_PER_CALL} per call`,
    };
  }

  const txs: TransactionInput[] = [];
  for (let i = 0; i < o.transactions.length; i++) {
    const v = validateTransaction(o.transactions[i], i);
    if (!v.ok) return { ok: false, error: v.error };
    txs.push(v.tx);
  }

  let profile: CustomerProfile | undefined;
  if (o.profile !== undefined) {
    const p = validateProfile(o.profile);
    if (!p.ok) return { ok: false, error: p.error };
    profile = p.profile;
  }

  return {
    ok: true,
    input: {
      customerId: o.customerId.trim(),
      customerName: o.customerName.trim(),
      profile,
      transactions: txs,
      createAsanaOnCritical: o.createAsanaOnCritical !== false,
    },
  };
}

// ---------------------------------------------------------------------------
// Asana routing — one task per critical alert
// ---------------------------------------------------------------------------

async function postCriticalAlertAsana(
  customerName: string,
  alert: EnhancedTMAlert,
  tx: TransactionInput
): Promise<{ ok: boolean; gid?: string; error?: string }> {
  const projectId = process.env.ASANA_SCREENINGS_PROJECT_GID || '1213759768596515';
  if (!process.env.ASANA_TOKEN && !process.env.ASANA_ACCESS_TOKEN && !process.env.ASANA_API_TOKEN) {
    return { ok: false, error: 'ASANA_TOKEN not configured' };
  }
  const lines: string[] = [
    `Customer: ${customerName} (id: ${alert.customerId})`,
    `Alert: ${alert.ruleName}`,
    `Severity: ${alert.severity.toUpperCase()}`,
    `Generated: ${alert.generatedAt}`,
    `Regulatory basis: ${alert.regulatoryRef}`,
    '',
    `Amount: ${tx.amount} ${tx.currency}`,
    `Payment: ${tx.paymentMethod ?? 'n/a'}${tx.payerMatchesCustomer ? '' : ' (third-party payer)'}`,
    `Route: ${tx.originCountry ?? '??'} → ${tx.destinationCountry ?? '??'}`,
  ];
  if (tx.commodityType) lines.push(`Commodity: ${tx.commodityType}`);
  if (tx.notes && tx.notes.trim().length > 0) {
    lines.push('');
    lines.push('MLRO notes:');
    lines.push(tx.notes.trim());
  }
  lines.push('');
  lines.push(alert.message);
  if (alert.relatedAlertIds.length > 0) {
    lines.push('');
    lines.push(`Related alerts: ${alert.relatedAlertIds.join(', ')}`);
  }
  lines.push('');
  lines.push(
    'Source: /api/transaction/monitor (Screening Command page). Do NOT notify the subject — FDL Art.29.'
  );
  return createAsanaTask({
    name: `[TM:${alert.severity.toUpperCase()}] ${alert.ruleName} — ${customerName}`,
    notes: lines.join('\n'),
    projects: [projectId],
    tags: ['transaction-monitoring', alert.severity, alert.ruleId],
  });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method not allowed' }, { status: 405 });
  }

  // Rate limit — 30 req / 15 min per IP. Transaction monitoring is
  // run from the UI after a user submits a transaction batch. Enough
  // headroom for normal MLRO workflow, tight enough to fail closed
  // under abuse.
  const rl = await checkRateLimit(req, {
    max: 30,
    clientIp: context.ip,
    namespace: 'transaction-monitor',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  const contentLength = req.headers.get('content-length');
  if (contentLength) {
    const n = Number(contentLength);
    if (Number.isFinite(n) && n > MAX_BODY_SIZE) {
      return jsonResponse({ ok: false, error: 'request body too large' }, { status: 413 });
    }
  }
  let parsed: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_SIZE) {
      return jsonResponse({ ok: false, error: 'request body too large' }, { status: 413 });
    }
    parsed = JSON.parse(raw);
  } catch {
    return jsonResponse({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const validation = validateInput(parsed);
  if (!validation.ok) return jsonResponse({ ok: false, error: validation.error }, { status: 400 });
  const input = validation.input;

  const engine = new TransactionMonitoringEngine();
  if (input.profile) engine.loadProfile(input.profile);

  const perTransaction: Array<{ index: number; alerts: EnhancedTMAlert[] }> = [];
  const allAlerts: Array<{ alert: EnhancedTMAlert; tx: TransactionInput }> = [];
  for (let i = 0; i < input.transactions.length; i++) {
    const tx = input.transactions[i];
    const alerts = engine.processTransaction(tx, input.customerId);
    perTransaction.push({ index: i, alerts });
    for (const alert of alerts) allAlerts.push({ alert, tx });
  }

  const countBySeverity = {
    medium: allAlerts.filter((a) => a.alert.severity === 'medium').length,
    high: allAlerts.filter((a) => a.alert.severity === 'high').length,
    critical: allAlerts.filter((a) => a.alert.severity === 'critical').length,
  };

  // Asana tasks for every high+ anomaly — user directive: "if any
  // anomaly or event I need to notification to Asana". Highs page
  // the MLRO; criticals page the CO; mediums flow via dashboard.
  const asanaResults: Array<{ alertId: string; ok: boolean; gid?: string; error?: string }> = [];
  if (input.createAsanaOnCritical) {
    const pageable = allAlerts.filter(
      ({ alert }) => alert.severity === 'critical' || alert.severity === 'high'
    );
    for (const { alert, tx } of pageable) {
      const res = await postCriticalAlertAsana(input.customerName, alert, tx);
      asanaResults.push({ alertId: alert.alertId, ...res });
    }
  }

  return jsonResponse({
    ok: true,
    ranAt: new Date().toISOString(),
    customer: {
      id: input.customerId,
      name: input.customerName,
      profileLoaded: Boolean(input.profile),
    },
    summary: {
      transactionsProcessed: input.transactions.length,
      alertCount: allAlerts.length,
      countBySeverity,
      asanaConfigured: Boolean(
        process.env.ASANA_TOKEN || process.env.ASANA_ACCESS_TOKEN || process.env.ASANA_API_TOKEN
      ),
    },
    perTransaction,
    asana: asanaResults,
  });
};

// ---------------------------------------------------------------------------
// Test-only exports
// ---------------------------------------------------------------------------

export const __test__ = {
  validateInput,
  validateTransaction,
  validateProfile,
};

// ---------------------------------------------------------------------------
// Netlify Function config
// ---------------------------------------------------------------------------

export const config: Config = {
  path: '/api/transaction/monitor',
  method: ['POST', 'OPTIONS'],
};
