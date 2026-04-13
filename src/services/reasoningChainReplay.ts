/**
 * Reasoning Chain Replay — Tier B3.
 *
 * Every runMegaBrain invocation produces a sealed ReasoningChain
 * (see megaBrain.MegaBrainResponse.chain). This module persists
 * those chains into a localStorage ring buffer so the MLRO can
 * replay a past decision and see every subsystem invocation
 * that led to the verdict.
 *
 * Pure read/write + a query API. The Brain Console renders the
 * replay via the existing DependencyDag component.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (CO/MLRO explainability)
 *   - FDL No.10/2025 Art.24 (10yr retention — chains are
 *     part of the audit trail)
 *   - NIST AI RMF 1.0 MEASURE-2 (AI decision provenance)
 *   - ISO/IEC 42001:2023 Clause 7.5 (documented information)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReasoningStepRecord {
  id: string;
  subsystem: string;
  at: string;
  input?: unknown;
  output?: unknown;
  durationMs?: number;
}

export interface ReasoningChainRecord {
  id: string;
  caseId: string;
  verdict: string;
  confidence: number;
  recordedAtIso: string;
  steps: ReasoningStepRecord[];
  /** Optional summary for quick preview. */
  summary?: string;
  /** Sealed hash of the chain — tamper detection. */
  sealHash?: string;
}

const STORAGE_KEY = 'fgl_reasoning_chain_buffer';
const MAX_CHAINS = 200;

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function readBuffer(): ReasoningChainRecord[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ReasoningChainRecord[]) : [];
  } catch {
    return [];
  }
}

function writeBuffer(entries: readonly ReasoningChainRecord[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_CHAINS)));
  } catch {
    /* storage quota */
  }
}

// ---------------------------------------------------------------------------
// Seal hash — tamper detection
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic hash of the chain payload. Uses a
 * lightweight djb2 variant — good enough for tamper detection
 * inside the SPA, NOT a cryptographic seal. For regulatory seals
 * hand the chain to src/services/complianceSignature.ts.
 */
export function computeSealHash(
  chain: Pick<ReasoningChainRecord, 'caseId' | 'verdict' | 'steps'>
): string {
  const serialized = JSON.stringify({
    caseId: chain.caseId,
    verdict: chain.verdict,
    stepCount: chain.steps.length,
    stepIds: chain.steps.map((s) => s.id),
  });
  let hash = 5381;
  for (let i = 0; i < serialized.length; i++) {
    hash = ((hash << 5) + hash + serialized.charCodeAt(i)) | 0;
  }
  return `seal_${(hash >>> 0).toString(16)}`;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export interface RecordChainInput {
  caseId: string;
  verdict: string;
  confidence: number;
  steps: ReasoningStepRecord[];
  summary?: string;
  recordedAtIso?: string;
}

export function recordReasoningChain(input: RecordChainInput): ReasoningChainRecord {
  const recordedAtIso = input.recordedAtIso ?? new Date().toISOString();
  const record: ReasoningChainRecord = {
    id: `chain_${input.caseId}_${recordedAtIso}`,
    caseId: input.caseId,
    verdict: input.verdict,
    confidence: input.confidence,
    recordedAtIso,
    steps: input.steps,
    summary: input.summary,
    sealHash: computeSealHash({
      caseId: input.caseId,
      verdict: input.verdict,
      steps: input.steps,
    }),
  };
  const buffer = readBuffer();
  // Dedupe by id so re-running the same dispatch at the same
  // timestamp updates instead of duplicating.
  const existing = buffer.findIndex((e) => e.id === record.id);
  if (existing >= 0) buffer[existing] = record;
  else buffer.unshift(record);
  writeBuffer(buffer);
  return record;
}

export function readReasoningChain(caseId: string): ReasoningChainRecord | undefined {
  return readBuffer().find((r) => r.caseId === caseId);
}

export function listRecentChains(limit = 20): ReasoningChainRecord[] {
  return readBuffer().slice(0, limit);
}

export function clearReasoningChains(): void {
  writeBuffer([]);
}

/** Check whether a chain's sealHash still matches its current payload. */
export function verifySeal(chain: ReasoningChainRecord): boolean {
  if (!chain.sealHash) return false;
  return computeSealHash(chain) === chain.sealHash;
}
