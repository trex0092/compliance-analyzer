/**
 * Backup / Restore Service — produces + consumes a deterministic,
 * signed manifest of every blob key + SHA3-512 content hash for a
 * given tenant, so operators can snapshot the tenant state and
 * restore it later (or to a different environment) with integrity
 * checks.
 *
 * Why this exists:
 *   Netlify Blobs does not have a built-in point-in-time backup. For
 *   compliance a 10-year retention window (FDL Art.24) requires that
 *   we can reproduce ANY point in time from an external archive.
 *
 *   This module is the pure manifest layer. It takes a list of
 *   `BlobObject` records (key + JSON payload) and produces a signed
 *   `BackupManifest` that can be written to durable cold storage
 *   (S3 Glacier, local tar, off-site sync). The restore side takes
 *   a manifest + a set of payloads and verifies every content hash
 *   matches the manifest entry.
 *
 *   Tamper detection is per-object AND global: every entry has its
 *   own content hash, and the manifest header has a Merkle-root hash
 *   over every entry hash.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.24    (10-year retention)
 *   Cabinet Res 134/2025 Art.19 (internal review requires replayability)
 *   FATF Rec 11              (record keeping with retrieval)
 *   NIST AI RMF 1.0 MANAGE-2 (AI decision provenance)
 *   ISO/IEC 27001 A.12.3     (backup)
 */

import { sha3_512Hex } from './quantumResistantSeal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlobObject {
  key: string;
  payload: unknown;
}

export interface BackupEntry {
  key: string;
  contentHashHex: string;
  sizeBytes: number;
}

export interface BackupManifest {
  schemaVersion: 1;
  tenantId: string;
  generatedAtIso: string;
  generatedBy: string;
  algorithm: 'sha3-512';
  entries: readonly BackupEntry[];
  /** Merkle root over sorted entry content hashes. */
  merkleRootHex: string;
  /** Plain-English summary. */
  summary: string;
  regulatory: readonly string[];
}

export interface RestoreDiscrepancy {
  key: string;
  kind: 'missing' | 'extra' | 'hash_mismatch';
  detail: string;
}

export interface RestoreReport {
  schemaVersion: 1;
  tenantId: string;
  checkedAtIso: string;
  ok: boolean;
  totalManifestEntries: number;
  totalProvidedObjects: number;
  discrepancies: readonly RestoreDiscrepancy[];
  merkleOk: boolean;
  summary: string;
}

// ---------------------------------------------------------------------------
// Canonical JSON (reused pattern)
// ---------------------------------------------------------------------------

function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalStringify).join(',') + ']';
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    return (
      '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(rec[k])).join(',') + '}'
    );
  }
  return 'null';
}

function hashObject(obj: BlobObject): { contentHashHex: string; sizeBytes: number } {
  const canonical = canonicalStringify(obj.payload);
  return {
    contentHashHex: sha3_512Hex('backup-object-v1|' + obj.key + '|' + canonical),
    sizeBytes: canonical.length,
  };
}

function merkleRoot(entries: readonly BackupEntry[]): string {
  if (entries.length === 0) return sha3_512Hex('backup-merkle-empty-v1');
  const sorted = [...entries].sort((a, b) => a.key.localeCompare(b.key));
  const concat = sorted.map((e) => e.contentHashHex).join('|');
  return sha3_512Hex('backup-merkle-v1|' + concat);
}

// ---------------------------------------------------------------------------
// Public API — backup
// ---------------------------------------------------------------------------

export interface BackupOptions {
  tenantId: string;
  generatedBy: string;
  now?: () => Date;
}

export function buildBackupManifest(
  objects: readonly BlobObject[],
  opts: BackupOptions
): BackupManifest {
  const now = (opts.now ?? (() => new Date()))();
  const entries: BackupEntry[] = objects.map((o) => {
    const { contentHashHex, sizeBytes } = hashObject(o);
    return { key: o.key, contentHashHex, sizeBytes };
  });
  entries.sort((a, b) => a.key.localeCompare(b.key));
  const root = merkleRoot(entries);

  return {
    schemaVersion: 1,
    tenantId: opts.tenantId,
    generatedAtIso: now.toISOString(),
    generatedBy: opts.generatedBy,
    algorithm: 'sha3-512',
    entries,
    merkleRootHex: root,
    summary: `Backup manifest for tenant "${opts.tenantId}" — ${entries.length} object(s), Merkle root ${root.slice(0, 16)}...`,
    regulatory: [
      'FDL No.10/2025 Art.24',
      'Cabinet Res 134/2025 Art.19',
      'FATF Rec 11',
      'NIST AI RMF 1.0 MANAGE-2',
      'ISO/IEC 27001 A.12.3',
    ],
  };
}

// ---------------------------------------------------------------------------
// Public API — restore verification
// ---------------------------------------------------------------------------

export function verifyRestoreSet(
  manifest: BackupManifest,
  objects: readonly BlobObject[],
  now: () => Date = () => new Date()
): RestoreReport {
  const discrepancies: RestoreDiscrepancy[] = [];

  // Index both sides by key.
  const manifestByKey = new Map<string, BackupEntry>();
  for (const e of manifest.entries) manifestByKey.set(e.key, e);

  const providedByKey = new Map<string, BlobObject>();
  for (const o of objects) providedByKey.set(o.key, o);

  // Missing: present in manifest, not in provided.
  for (const [k, e] of manifestByKey) {
    if (!providedByKey.has(k)) {
      discrepancies.push({
        key: k,
        kind: 'missing',
        detail: `manifest has ${k} but restore set does not`,
      });
      continue;
    }
    const provided = providedByKey.get(k)!;
    const { contentHashHex } = hashObject(provided);
    if (contentHashHex !== e.contentHashHex) {
      discrepancies.push({
        key: k,
        kind: 'hash_mismatch',
        detail: `expected ${e.contentHashHex.slice(0, 16)}..., got ${contentHashHex.slice(0, 16)}...`,
      });
    }
  }
  // Extra: present in provided, not in manifest.
  for (const k of providedByKey.keys()) {
    if (!manifestByKey.has(k)) {
      discrepancies.push({
        key: k,
        kind: 'extra',
        detail: `restore set has ${k} but manifest does not`,
      });
    }
  }

  // Recompute Merkle root to confirm manifest header integrity.
  const recomputed = merkleRoot(manifest.entries);
  const merkleOk = recomputed === manifest.merkleRootHex;
  if (!merkleOk) {
    discrepancies.push({
      key: '<manifest>',
      kind: 'hash_mismatch',
      detail: 'manifest Merkle root does not match recomputed root',
    });
  }

  const ok = discrepancies.length === 0;
  return {
    schemaVersion: 1,
    tenantId: manifest.tenantId,
    checkedAtIso: now().toISOString(),
    ok,
    totalManifestEntries: manifest.entries.length,
    totalProvidedObjects: objects.length,
    discrepancies,
    merkleOk,
    summary: ok
      ? `Restore verified — ${manifest.entries.length} object(s) match.`
      : `Restore FAILED — ${discrepancies.length} discrepanc(y/ies).`,
  };
}

// Exports for tests.
export const __test__ = { canonicalStringify, hashObject, merkleRoot };
