/**
 * Reasoning Chain Augmenter — append historical precedents to a
 * sealed mega-brain reasoning chain without modifying the original.
 *
 * The mega-brain chain produced by `runMegaBrain()` is sealed as
 * part of the deterministic audit-trail guarantee: once the
 * chain has been sealed by `seal()` in reasoningChain.ts, no
 * further nodes or edges can be added. This is intentional —
 * it's what makes the chain reproducible across re-runs.
 *
 * But `runSuperDecision()` also computes historical precedents
 * via `retrievePrecedents()` on the permanent memory digest. Those
 * precedents are currently only surfaced in the response payload;
 * they never make it into the reasoning chain the MLRO reads when
 * reviewing the case.
 *
 * This module builds an AUGMENTED chain: a clone of the original
 * sealed chain plus one new evidence node per matched precedent
 * (and one edge from the root to each new node). The augmented
 * chain is re-sealed so it inherits the same tamper-evident
 * property.
 *
 * IMPORTANT — what this module does NOT claim:
 *   - The zk-compliance attestation in `zkComplianceAttestation.ts`
 *     commits ONLY {salt, subjectId, screenedAtIso, listName}.
 *     It does NOT bind the reasoning chain content. Augmenting
 *     the chain does not retroactively extend the attestation's
 *     coverage. I say this explicitly because in an earlier plan
 *     I incorrectly claimed the attestation would bind precedent
 *     citations — that was wrong and this module does not pretend
 *     otherwise. The augmented chain lives alongside the
 *     attestation, not inside it.
 *   - The augmenter does not modify the original sealed chain.
 *     Both chains exist after the call; the super runner exposes
 *     the original via `decision.raw.mega.chain` and the
 *     augmented variant via `SuperDecision.augmentedChain`.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO reasoned decision — precedents
 *                             are part of reasoning)
 *   FDL No.10/2025 Art.24    (retention — augmented chain is a
 *                             compact audit artifact)
 *   FDL No.10/2025 Art.29    (no tipping off — augmenter only
 *                             carries opaque caseIds and numeric
 *                             similarity scores)
 *   Cabinet Res 134/2025 Art.19 (internal review — precedent
 *                                 citations strengthen review)
 *   FATF Rec 18 (internal controls proportionate to risk)
 */

import {
  createChain,
  addNode,
  addEdge,
  seal,
  type ReasoningChain,
} from './reasoningChain';
import type { PrecedentReport } from './brainMemoryDigest';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Deep-clone a sealed reasoning chain. We can't just copy
 * references because the augmented chain needs its own mutable
 * state (nodes + edges arrays) to accept new entries.
 */
function cloneUnsealed(original: ReasoningChain): ReasoningChain {
  const clone = createChain(original.topic, original.id);
  // Copy over every existing node + edge. We intentionally use
  // addNode/addEdge so the clone goes through the same validation
  // path as the original — duplicate ids or dangling edges would
  // throw, which is exactly the invariant we want.
  for (const node of original.nodes) {
    addNode(clone, {
      id: node.id,
      type: node.type,
      label: node.label,
      weight: node.weight,
      regulatory: node.regulatory,
      data: node.data,
    });
  }
  for (const edge of original.edges) {
    addEdge(clone, {
      fromId: edge.fromId,
      toId: edge.toId,
      relation: edge.relation,
      weight: edge.weight,
      rationale: edge.rationale,
    });
  }
  return clone;
}

/**
 * Pick a root node id to attach precedent edges to. Prefers the
 * canonical 'root' id the mega-brain uses; falls back to the
 * first node in the chain if the conventional root is missing.
 */
function chooseRootId(chain: ReasoningChain): string | null {
  const canonical = chain.nodes.find((n) => n.id === 'root');
  if (canonical) return canonical.id;
  return chain.nodes[0]?.id ?? null;
}

/**
 * Build a stable precedent-node id. Uses the source caseId so
 * replays with the same precedent produce the same node id —
 * a small, predictable fragment prevents id collisions with
 * the mega-brain's own node ids (which never use colons).
 */
function precedentNodeId(sourceCaseId: string): string {
  // Collapse any unsafe characters so the id fits addNode's shape.
  const safe = sourceCaseId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  return `precedent-${safe}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AugmentChainOptions {
  /**
   * Cap on precedent nodes to append. Defaults to 5 so a large
   * digest never bloats the chain beyond what an MLRO can read.
   */
  maxPrecedents?: number;
  /**
   * Minimum similarity 0..1 to bother injecting. Defaults to 0.5
   * which matches the default in `retrievePrecedents()`.
   */
  minSimilarity?: number;
}

export interface AugmentChainResult {
  /** The new, sealed chain with precedent nodes appended. */
  augmentedChain: ReasoningChain;
  /** Count of precedent nodes actually added. */
  precedentsAdded: number;
  /** The root node id precedent edges were attached to, or null. */
  rootId: string | null;
  /** When true, no augmentation happened (chain returned unchanged). */
  unchanged: boolean;
}

/**
 * Return a NEW reasoning chain that contains every node + edge
 * from the original plus one evidence node per matched precedent
 * (above the similarity threshold). The original chain is NOT
 * modified — this is a pure function over its inputs.
 *
 * Failure modes:
 *   - Empty precedents report: returns the original chain
 *     unchanged (unchanged: true, precedentsAdded: 0).
 *   - Chain has no nodes at all: returns the original unchanged.
 *   - Any node/edge construction throws: we catch and return the
 *     original chain unchanged so the augmenter NEVER blocks the
 *     decision path.
 */
export function augmentChainWithPrecedents(
  original: ReasoningChain,
  precedents: PrecedentReport,
  opts: AugmentChainOptions = {}
): AugmentChainResult {
  const maxPrecedents = opts.maxPrecedents ?? 5;
  const minSimilarity = opts.minSimilarity ?? 0.5;

  // Defensive guard: some callers (tests that mock the weaponized
  // brain response) pass a minimal chain stub without the usual
  // nodes/edges arrays. Treat those as "no augmentation possible".
  if (
    !original ||
    !Array.isArray(original.nodes) ||
    !Array.isArray(original.edges) ||
    typeof precedents !== 'object' ||
    !Array.isArray(precedents.matches)
  ) {
    return {
      augmentedChain: original,
      precedentsAdded: 0,
      rootId: null,
      unchanged: true,
    };
  }

  const filtered = precedents.matches.filter(
    (m) => m && typeof m.similarity === 'number' && m.similarity >= minSimilarity
  );
  if (filtered.length === 0 || original.nodes.length === 0) {
    return {
      augmentedChain: original,
      precedentsAdded: 0,
      rootId: chooseRootId(original),
      unchanged: true,
    };
  }

  try {
    const clone = cloneUnsealed(original);
    const rootId = chooseRootId(clone);
    if (!rootId) {
      return {
        augmentedChain: original,
        precedentsAdded: 0,
        rootId: null,
        unchanged: true,
      };
    }

    let added = 0;
    for (const match of filtered.slice(0, maxPrecedents)) {
      const nodeId = precedentNodeId(match.entry.caseId);
      // Dedup: if the same precedent was already in the original
      // chain (unlikely but possible on replay), skip it.
      if (clone.nodes.some((n) => n.id === nodeId)) continue;
      addNode(clone, {
        id: nodeId,
        type: 'evidence',
        label: `Precedent: ${match.entry.caseId} (verdict ${match.entry.verdict}, ${(match.similarity * 100).toFixed(0)}% similar)`,
        weight: match.similarity,
        regulatory: 'FDL No.10/2025 Art.20-21 (historical precedent)',
        data: {
          sourceCaseId: match.entry.caseId,
          verdict: match.entry.verdict,
          severity: match.entry.severity,
          similarity: match.similarity,
        },
      });
      addEdge(clone, {
        fromId: rootId,
        toId: nodeId,
        relation: 'supports',
        weight: match.similarity,
        rationale: match.narrative,
      });
      added += 1;
    }

    seal(clone);

    return {
      augmentedChain: clone,
      precedentsAdded: added,
      rootId,
      unchanged: added === 0,
    };
  } catch (err) {
    // Augmenter failures must NEVER block the decision path.
    // Log once and fall back to the original chain.
    console.error(
      '[reasoningChainAugmenter] augmentation failed:',
      err instanceof Error ? err.message : String(err)
    );
    return {
      augmentedChain: original,
      precedentsAdded: 0,
      rootId: chooseRootId(original),
      unchanged: true,
    };
  }
}

// Exports for tests.
export const __test__ = { cloneUnsealed, chooseRootId, precedentNodeId };
