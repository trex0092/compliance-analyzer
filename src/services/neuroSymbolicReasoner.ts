/**
 * Neuro-Symbolic Reasoner — subsystem #97 (Phase 9).
 *
 * Pure-TypeScript Horn-clause backward-chaining engine for compliance
 * edge cases the 73 pattern-based subsystems don't cover. Combines
 * the determinism of symbolic logic with the flexibility of injected
 * "neural" facts (i.e. facts produced by ML-based subsystems like
 * the adverseMediaRanker or semanticNarrativeSearch).
 *
 * Features:
 *   - Horn clauses: `head :- body1, body2, ...`
 *   - Positive atoms only (no negation-as-failure — defensive
 *     reasoning requires monotonic logic)
 *   - Proof-chain reconstruction (the reasoner tells you WHY a
 *     conclusion was derived, with the list of clauses used)
 *   - Injected fact base (for "neural" signals from other subsystems)
 *
 * This is NOT Prolog. It's Datalog-ish: variables in clauses are not
 * supported — everything is ground (fully instantiated). This keeps
 * the engine small (~200 lines), deterministic, and decidable.
 *
 * Example program:
 *
 *   fact:  ubo_of("Alice", "AcmeCo")
 *   fact:  sanctioned("Alice")
 *   rule:  high_risk("AcmeCo") :- ubo_of("Alice", "AcmeCo"), sanctioned("Alice")
 *   rule:  escalate("AcmeCo") :- high_risk("AcmeCo")
 *
 *   query: escalate("AcmeCo") → proven via [rule 2, rule 1, fact 1, fact 2]
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20 (CO documents reasoning — proof chains)
 *   - Cabinet Res 134/2025 Art.19 (auditable decisions)
 *   - NIST AI RMF MS-2.2 (explainability via explicit derivations)
 *   - EU AI Act Art.13 (transparency — every conclusion traceable)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A ground atom: predicate name + tuple of string arguments.
 * Stored in canonical form `predicate(a1,a2,...)` for hashing.
 */
export interface Atom {
  predicate: string;
  args: readonly string[];
}

export function atomKey(atom: Atom): string {
  return `${atom.predicate}(${atom.args.join(',')})`;
}

export function atomEquals(a: Atom, b: Atom): boolean {
  return atomKey(a) === atomKey(b);
}

export interface Clause {
  id: string;
  head: Atom;
  body: readonly Atom[];
  citation?: string;
}

export interface Program {
  facts: readonly Atom[];
  clauses: readonly Clause[];
}

export interface Proof {
  goal: Atom;
  /** Clause IDs used, in the order they were applied. */
  clauseChain: readonly string[];
  /** Full derivation tree. */
  tree: ProofNode;
}

export interface ProofNode {
  goal: Atom;
  derivedBy: 'fact' | string; // clause id or 'fact'
  citation?: string;
  subgoals: ProofNode[];
}

export interface QueryResult {
  proven: boolean;
  proof?: Proof;
  failedBecause?: string;
}

// ---------------------------------------------------------------------------
// Backward-chaining engine
// ---------------------------------------------------------------------------

export class NeuroSymbolicReasoner {
  private readonly facts = new Map<string, Atom>();
  private readonly clauses: Clause[] = [];

  loadProgram(program: Program): void {
    for (const fact of program.facts) this.facts.set(atomKey(fact), fact);
    for (const clause of program.clauses) this.clauses.push(clause);
  }

  addFact(atom: Atom): void {
    this.facts.set(atomKey(atom), atom);
  }

  addClause(clause: Clause): void {
    this.clauses.push(clause);
  }

  query(goal: Atom, maxDepth = 32): QueryResult {
    const visited = new Set<string>();
    const result = this.prove(goal, 0, maxDepth, visited);
    if (!result) {
      return { proven: false, failedBecause: `no derivation for ${atomKey(goal)}` };
    }
    const chain: string[] = [];
    collectChain(result, chain);
    return {
      proven: true,
      proof: { goal, clauseChain: chain, tree: result },
    };
  }

  /**
   * Core backward-chaining recursion. Returns a ProofNode when the
   * goal is derivable, null otherwise. Cycles are detected via the
   * visited set (a goal that appears in its own derivation chain is
   * a loop and fails). Depth-limited to prevent infinite regress.
   */
  private prove(
    goal: Atom,
    depth: number,
    maxDepth: number,
    visited: Set<string>
  ): ProofNode | null {
    if (depth > maxDepth) return null;
    const key = atomKey(goal);
    if (visited.has(key)) return null;

    // Fact lookup
    if (this.facts.has(key)) {
      return { goal, derivedBy: 'fact', subgoals: [] };
    }

    // Try every clause whose head matches.
    for (const clause of this.clauses) {
      if (!atomEquals(clause.head, goal)) continue;
      visited.add(key);
      const subgoals: ProofNode[] = [];
      let allResolved = true;
      for (const bodyAtom of clause.body) {
        const sub = this.prove(bodyAtom, depth + 1, maxDepth, visited);
        if (!sub) {
          allResolved = false;
          break;
        }
        subgoals.push(sub);
      }
      visited.delete(key);
      if (allResolved) {
        return { goal, derivedBy: clause.id, citation: clause.citation, subgoals };
      }
    }
    return null;
  }
}

function collectChain(node: ProofNode, chain: string[]): void {
  if (node.derivedBy !== 'fact') chain.push(node.derivedBy);
  for (const sub of node.subgoals) collectChain(sub, chain);
}

// ---------------------------------------------------------------------------
// Canonical compliance clauses
// ---------------------------------------------------------------------------

export const CANONICAL_CLAUSES: readonly Clause[] = [
  {
    id: 'C1',
    head: { predicate: 'requires_freeze', args: ['ENTITY'] },
    body: [
      { predicate: 'has_sanctioned_ubo', args: ['ENTITY'] },
      { predicate: 'cannot_mitigate', args: ['ENTITY'] },
    ],
    citation: 'Cabinet Res 74/2020 Art.4-7 + Cabinet Decision 109/2023',
  },
  {
    id: 'C2',
    head: { predicate: 'requires_escalate', args: ['ENTITY'] },
    body: [
      { predicate: 'high_risk', args: ['ENTITY'] },
      { predicate: 'insufficient_evidence', args: ['ENTITY'] },
    ],
    citation: 'Cabinet Res 134/2025 Art.14',
  },
  {
    id: 'C3',
    head: { predicate: 'high_risk', args: ['ENTITY'] },
    body: [{ predicate: 'adverse_media_critical', args: ['ENTITY'] }],
    citation: 'FATF Rec 10 + Cabinet Res 134/2025 Art.14',
  },
];
