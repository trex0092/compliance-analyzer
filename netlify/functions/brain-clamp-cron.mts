/**
 * Brain Clamp Suggestion Cron.
 *
 * Scheduled function that walks the prior 7 days of telemetry for
 * every tenant configured via HAWKEYE_CLAMP_CRON_TENANTS
 * (comma-separated) and appends pending clamp-tuning suggestions
 * to the ClampSuggestionBlobStore. MLROs review them in the Brain
 * Console and flip status manually — the cron NEVER auto-applies.
 *
 * Schedule: hourly (`0 * * * *`). Tuning is slow — MLROs do not
 * need per-minute updates, and hourly runs stay well under the
 * Netlify scheduled function quota.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22  (CO continuous monitoring)
 *   Cabinet Res 134/2025 Art.19 (internal review input)
 *   FATF Rec 20               (ongoing monitoring)
 *   NIST AI RMF 1.0 MEASURE-2 + GOVERN-4
 */

import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { BrainTelemetryStore } from '../../src/services/brainTelemetryStore';
import { ClampSuggestionBlobStore } from '../../src/services/tierCBlobStores';
import { createNetlifyBlobHandle } from '../../src/services/brainMemoryBlobStore';
import { generateClampSuggestions } from '../../src/services/clampSuggestionGenerator';
import { createTierCAsanaDispatcher } from '../../src/services/asana/tierCAsanaDispatch';
import { orchestrator as defaultOrchestrator } from '../../src/services/asana/orchestrator';

const DEFAULT_LOOKBACK_DAYS = 7;

function parseTenants(csv: string | undefined): readonly string[] {
  if (!csv || typeof csv !== 'string') return [];
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 64);
}

function dayIsoOffset(from: Date, offsetDays: number): string {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export default async (): Promise<Response> => {
  const startedAt = new Date();

  const tenants = parseTenants(process.env.HAWKEYE_CLAMP_CRON_TENANTS);
  if (tenants.length === 0) {
    return Response.json({
      ok: true,
      skipped: 'HAWKEYE_CLAMP_CRON_TENANTS not configured',
      at: startedAt.toISOString(),
    });
  }

  let store: BrainTelemetryStore;
  let clampStore: ClampSuggestionBlobStore;
  try {
    const blob = getStore('brain-memory');
    const handle = createNetlifyBlobHandle({
      get: (key, opts) => blob.get(key, opts),
      setJSON: (key, value) => blob.setJSON(key, value),
      delete: (key) => blob.delete(key),
    });
    store = new BrainTelemetryStore(handle);
    clampStore = new ClampSuggestionBlobStore(handle);
  } catch (err) {
    console.error(
      '[BRAIN-CLAMP-CRON] Blob store unavailable:',
      err instanceof Error ? err.message : String(err)
    );
    return Response.json({
      ok: false,
      error: 'blob_store_unavailable',
    });
  }

  const endIso = dayIsoOffset(startedAt, 0);
  const startIso = dayIsoOffset(startedAt, -DEFAULT_LOOKBACK_DAYS);

  const perTenant: Array<{
    tenantId: string;
    cases: number;
    suggestionsEmitted: number;
  }> = [];

  const dispatcher = createTierCAsanaDispatcher(defaultOrchestrator);

  for (const tenantId of tenants) {
    try {
      const entries = await store.readRange(tenantId, startIso, endIso);
      const result = generateClampSuggestions(entries);
      for (const s of result.suggestions) {
        clampStore.append(s);
        // Mirror each suggestion into Asana so the MLRO queue is the
        // single review surface. Failures are logged but never roll
        // back the blob append — Asana is a mirror, not truth.
        try {
          await dispatcher.dispatchClampSuggestion(s, tenantId);
        } catch (err) {
          console.warn(
            `[BRAIN-CLAMP-CRON] tenant ${tenantId} asana dispatch failed:`,
            err instanceof Error ? err.message : String(err)
          );
        }
      }
      perTenant.push({
        tenantId,
        cases: result.evidence.totalCases,
        suggestionsEmitted: result.suggestions.length,
      });
    } catch (err) {
      console.warn(
        `[BRAIN-CLAMP-CRON] tenant ${tenantId} failed:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  await clampStore.flush();

  const finishedAt = new Date();
  console.log(
    `[BRAIN-CLAMP-CRON] start=${startedAt.toISOString()} finish=${finishedAt.toISOString()} ` +
      `tenants=${tenants.length} window=${startIso}..${endIso}`
  );

  return Response.json({
    ok: true,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    window: { startIso, endIso },
    tenants: perTenant,
  });
};

export const config: Config = {
  schedule: '0 * * * *',
};

export const __test__ = { parseTenants, dayIsoOffset, DEFAULT_LOOKBACK_DAYS };
