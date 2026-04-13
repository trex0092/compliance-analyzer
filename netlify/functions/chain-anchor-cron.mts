/**
 * Reasoning chain anchor (cron).
 *
 * Every hour, collects all sealed reasoning chains from the previous
 * hour's brain-events store, computes the Merkle root via
 * `createAnchor`, and persists the anchor artefact. The artefact
 * contains a `signingPayload` that the MLRO can paste into a signed
 * git commit, a public Twitter/Signal post, a Bitcoin OP_RETURN, or
 * any other write-once public channel.
 *
 * This gives regulators tamper-evidence that survives a full
 * compromise of our own infrastructure — even if an attacker rewrites
 * the blob store, they cannot rewrite an already-published root.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.24 — tamper-evident records
 *   EOCN Inspection Manual §9 — immutable audit trail
 */

import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { createAnchor, type AnchorInput } from '../../src/services/chainAnchor';
import { fromJSON, type ReasoningChain } from '../../src/services/reasoningChain';

const BRAIN_STORE = 'brain-events';
const ANCHOR_STORE = 'chain-anchors';
const ANCHOR_AUDIT_STORE = 'chain-anchors-audit';

/**
 * Pull every serialised reasoning chain whose key falls inside the
 * one-hour window ending at `endIso`. The brain events store keys
 * blobs by yyyy-mm-dd prefix, so we only need to scan today (and
 * yesterday if the window crosses midnight).
 */
async function collectChains(startIso: string, endIso: string): Promise<ReasoningChain[]> {
  const store = getStore(BRAIN_STORE);
  const chains: ReasoningChain[] = [];
  const startDay = startIso.slice(0, 10);
  const endDay = endIso.slice(0, 10);
  const prefixes = startDay === endDay ? [startDay] : [startDay, endDay];

  for (const prefix of prefixes) {
    let listing;
    try {
      listing = await store.list({ prefix });
    } catch (err) {
      console.warn('[chain-anchor-cron] list failed for prefix', prefix, err);
      continue;
    }
    for (const entry of listing.blobs || []) {
      try {
        const blob = await store.get(entry.key, { type: 'json' });
        if (!blob || typeof blob !== 'object') continue;
        const stored = blob as { at?: string; chain?: unknown };
        if (!stored.at || stored.at < startIso || stored.at >= endIso) continue;
        if (!stored.chain) continue;
        // Chain can be serialised as JSON string or object. Normalise.
        const raw =
          typeof stored.chain === 'string' ? stored.chain : JSON.stringify(stored.chain);
        chains.push(fromJSON(raw));
      } catch (err) {
        console.warn('[chain-anchor-cron] skipping malformed blob', entry.key, err);
      }
    }
  }
  return chains;
}

async function writeAudit(payload: Record<string, unknown>): Promise<void> {
  const store = getStore(ANCHOR_AUDIT_STORE);
  const iso = new Date().toISOString();
  await store.setJSON(`${iso.slice(0, 10)}/${Date.now()}.json`, {
    ...payload,
    recordedAt: iso,
  });
}

export default async (): Promise<Response> => {
  const endIso = new Date().toISOString();
  const startIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const chains = await collectChains(startIso, endIso);

  if (chains.length === 0) {
    await writeAudit({ event: 'chain_anchor_skipped', reason: 'no chains in window', startIso, endIso });
    return Response.json({ ok: true, anchored: 0 });
  }

  const input: AnchorInput = {
    chains,
    policyVersion: '2026-04',
    windowStartIso: startIso,
    windowEndIso: endIso,
  };

  try {
    const { anchor } = await createAnchor(input);
    const store = getStore(ANCHOR_STORE);
    const day = endIso.slice(0, 10);
    const ms = Date.now();
    await store.setJSON(`${day}/${ms}.json`, anchor);

    await writeAudit({
      event: 'chain_anchor_sealed',
      chainCount: anchor.chainCount,
      rootHash: anchor.rootHash,
      windowStartIso: startIso,
      windowEndIso: endIso,
      anchoredAtIso: anchor.anchoredAtIso,
    });

    return Response.json({
      ok: true,
      anchored: anchor.chainCount,
      rootHash: anchor.rootHash,
      signingPayload: anchor.signingPayload,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeAudit({ event: 'chain_anchor_failed', error: message });
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
};

export const config: Config = {
  // Every hour on the hour. Balance: tighter cadence means more
  // frequent public anchors; looser cadence means smaller Merkle
  // trees per anchor but more events to traverse inside each run.
  schedule: '0 * * * *',
};
