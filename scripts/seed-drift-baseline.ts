/**
 * Drift baseline seeder.
 *
 * One-shot script that uploads a portfolio sample to the
 * `drift-baseline` Netlify Blob store so the daily
 * `regulatory-drift-cron.mts` has something to compare against.
 *
 * Usage:
 *   tsx scripts/seed-drift-baseline.ts < portfolio-sample.json
 *
 * The input should be a JSON array of `DriftSample` objects:
 *   [
 *     {
 *       "txValue30dAED": 12000,
 *       "isPep": false,
 *       "highRiskJurisdiction": "UAE",
 *       ...
 *     },
 *     ...
 *   ]
 *
 * Without a baseline the cron silently no-ops with
 * `event: drift_cron_skipped, reason: baseline missing`.
 *
 * Run this script once at MLRO onboarding, then re-run after every
 * risk-model recalibration so drift is measured against the new
 * baseline rather than a stale one.
 */

import { getStore } from '@netlify/blobs';
import { readFileSync } from 'node:fs';
import type { DriftSample } from '../src/services/regulatoryDrift';

const STORE = 'drift-baseline';

async function main(): Promise<void> {
  // Read from stdin or first CLI arg.
  const fileArg = process.argv[2];
  let raw: string;
  if (fileArg && fileArg !== '-') {
    raw = readFileSync(fileArg, 'utf8');
  } else {
    raw = readFileSync(0, 'utf8'); // stdin
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error('Invalid JSON:', (err as Error).message);
    process.exit(1);
  }

  if (!Array.isArray(parsed)) {
    console.error('Baseline must be a JSON array of sample objects.');
    process.exit(1);
  }
  if (parsed.length < 30) {
    console.error(
      `Baseline is too small (${parsed.length} samples). Need at least 30 for stable PSI bucketing.`
    );
    process.exit(1);
  }

  // Validate each sample is a flat object with primitive values.
  for (let i = 0; i < parsed.length; i++) {
    const row = parsed[i];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      console.error(`Sample ${i} is not a flat object.`);
      process.exit(1);
    }
    for (const [k, v] of Object.entries(row)) {
      const t = typeof v;
      if (t !== 'number' && t !== 'string' && t !== 'boolean') {
        console.error(`Sample ${i} field ${k}: unsupported type ${t}`);
        process.exit(1);
      }
    }
  }

  const samples = parsed as DriftSample[];
  const store = getStore(STORE);
  await store.setJSON('baseline.json', samples);

  console.log(
    `[seed-drift-baseline] Persisted ${samples.length} samples to blob store ${STORE}/baseline.json`
  );
}

main().catch((err) => {
  console.error('[seed-drift-baseline] failed:', err);
  process.exit(1);
});
