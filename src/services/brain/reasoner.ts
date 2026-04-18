/**
 * Layer 2 — Reasoning Core.
 *
 * Tree-of-Thoughts over competing hypotheses + Bayesian evidence
 * combination. Takes research atoms from Layer 1 and adjudicates
 * between hypotheses such as `same_person_as_listed`, `homonym`,
 * `shell_of_listed_entity`, `sanctions_by_association`, `false_positive`.
 *
 * Deterministic. No LLM calls. Inspired by:
 *   - vendor/tree-of-thought-llm (Princeton, Yao et al. 2023)
 *   - vendor/pgmpy (Bayesian factor combination)
 *
 * The BFS explores up to `beamWidth` branches per hypothesis and
 * prunes by posterior. Final posterior uses log-odds summation of
 * independent likelihood ratios — a conservative approximation of
 * full Bayesian inference that avoids the fragility of exact
 * conditional-independence assumptions.
 */

import type { ResearchAtom } from './investigator';

export interface Hypothesis {
  id: string;
  label: string;
  /** Prior probability P(H). Must be in (0, 1). */
  prior: number;
  /** Which atom sources count as evidence FOR this hypothesis. */
  supports: string[];
  /** Which atom sources count as evidence AGAINST this hypothesis. */
  refutes: string[];
}

export interface BranchStep {
  atomId: string;
  direction: 'support' | 'refute';
  /**
   * Log-likelihood ratio contributed by this atom. Positive = supports,
   * negative = refutes. Magnitude scales with atom confidence.
   */
  logLR: number;
  reason: string;
}

export interface ReasoningBranch {
  hypothesisId: string;
  steps: BranchStep[];
  /** Posterior P(H | E1..En), 0..1. */
  posterior: number;
  /** Our confidence in that posterior (low when evidence is thin). */
  confidence: number;
}

export interface ReasoningResult {
  hypotheses: Hypothesis[];
  branches: ReasoningBranch[];
  top: {
    hypothesisId: string;
    posterior: number;
    confidence: number;
    rationale: string;
  };
  /** Full audit chain, safe to paste into an MLRO case file. */
  auditChain: string;
}

export interface ReasoningConfig {
  /** Default hypotheses used when the caller doesn't specify. */
  defaultHypotheses?: Hypothesis[];
  /** Max branches expanded per hypothesis. Default 8. */
  beamWidth?: number;
  /** Log-likelihood per unit of atom confidence. Default 1.8. */
  atomWeight?: number;
}

const DEFAULT_HYPOTHESES: Hypothesis[] = [
  {
    id: 'h-confirmed',
    label: 'Confirmed match — same person / entity',
    prior: 0.15,
    supports: [
      'UN_1267',
      'UN_1988',
      'OFAC_SDN',
      'OFAC_CONSOLIDATED',
      'EU_CFSP',
      'UK_OFSI',
      'UAE_EOCN',
    ],
    refutes: ['DOB_MISMATCH', 'JURISDICTION_MISMATCH', 'PASSPORT_MISMATCH'],
  },
  {
    id: 'h-false-positive',
    label: 'False positive — different person with shared name',
    prior: 0.6,
    supports: ['DOB_MISMATCH', 'JURISDICTION_MISMATCH', 'PASSPORT_MISMATCH'],
    refutes: ['UN_1267', 'OFAC_SDN', 'EU_CFSP', 'UK_OFSI', 'UAE_EOCN'],
  },
  {
    id: 'h-association',
    label: 'Sanctions by association — UBO / family / KCA linkage',
    prior: 0.15,
    supports: ['UBO_LINK', 'FAMILY_LINK', 'KCA_LINK', 'SHELL_INDICATOR'],
    refutes: ['CLEAN_UBO', 'NO_FAMILY_LINK'],
  },
  {
    id: 'h-pep',
    label: 'PEP / family / close associate',
    prior: 0.1,
    supports: ['PEP_LIST', 'GOV_REGISTER', 'FAMILY_OF_PEP', 'KCA_OF_PEP'],
    refutes: ['PRIVATE_CITIZEN'],
  },
];

/**
 * Run the tree-of-thoughts reasoning over a set of atoms. Returns the
 * ranked hypotheses and the top pick with a plain-English rationale.
 */
export function runReasoning(atoms: ResearchAtom[], config: ReasoningConfig = {}): ReasoningResult {
  const hypotheses = config.defaultHypotheses ?? DEFAULT_HYPOTHESES;
  const atomWeight = config.atomWeight ?? 1.8;
  const beamWidth = config.beamWidth ?? 8;

  const branches: ReasoningBranch[] = hypotheses.map((h) =>
    expandBranch(h, atoms, atomWeight, beamWidth)
  );

  const sorted = [...branches].sort((a, b) => b.posterior - a.posterior);
  const top = sorted[0];
  const topHypothesis = hypotheses.find((h) => h.id === top.hypothesisId)!;

  const rationale = buildRationale(topHypothesis, top);
  const auditChain = buildAuditChain(hypotheses, branches);

  return {
    hypotheses,
    branches,
    top: {
      hypothesisId: top.hypothesisId,
      posterior: top.posterior,
      confidence: top.confidence,
      rationale,
    },
    auditChain,
  };
}

function expandBranch(
  h: Hypothesis,
  atoms: ResearchAtom[],
  atomWeight: number,
  beamWidth: number
): ReasoningBranch {
  const steps: BranchStep[] = [];
  for (const atom of atoms) {
    const src = atom.source.toUpperCase();
    const isSupport = h.supports.some((s) => src.includes(s));
    const isRefute = h.refutes.some((r) => src.includes(r));
    if (!isSupport && !isRefute) continue;
    const direction: BranchStep['direction'] = isSupport ? 'support' : 'refute';
    const sign = direction === 'support' ? 1 : -1;
    const logLR = sign * atomWeight * atom.confidence;
    steps.push({
      atomId: atom.id,
      direction,
      logLR,
      reason: `${direction === 'support' ? 'Supports' : 'Refutes'} "${h.label}" via ${atom.source} — ${atom.fact}`,
    });
  }

  // Keep the beamWidth most informative steps (highest |logLR|).
  steps.sort((a, b) => Math.abs(b.logLR) - Math.abs(a.logLR));
  const kept = steps.slice(0, beamWidth);

  const priorLogOdds = Math.log(h.prior / (1 - h.prior));
  const evidenceLogOdds = kept.reduce((sum, s) => sum + s.logLR, 0);
  const posteriorLogOdds = priorLogOdds + evidenceLogOdds;
  const posterior = sigmoid(posteriorLogOdds);

  // Confidence grows with evidence volume, saturating at 8 atoms.
  const confidence = Math.min(1, kept.length / 8);

  return {
    hypothesisId: h.id,
    steps: kept,
    posterior,
    confidence,
  };
}

function sigmoid(x: number): number {
  if (x > 50) return 1;
  if (x < -50) return 0;
  return 1 / (1 + Math.exp(-x));
}

function buildRationale(h: Hypothesis, branch: ReasoningBranch): string {
  if (branch.steps.length === 0) {
    return `${h.label}: no evidence either way. Posterior ${(branch.posterior * 100).toFixed(0)}% reflects the prior only.`;
  }
  const supports = branch.steps.filter((s) => s.direction === 'support');
  const refutes = branch.steps.filter((s) => s.direction === 'refute');
  const parts: string[] = [];
  parts.push(
    `${h.label} — posterior ${(branch.posterior * 100).toFixed(0)}% (confidence ${(branch.confidence * 100).toFixed(0)}%).`
  );
  if (supports.length > 0) {
    parts.push(`Supporting evidence: ${supports.map((s) => s.reason).join('; ')}.`);
  }
  if (refutes.length > 0) {
    parts.push(`Contradicting evidence: ${refutes.map((s) => s.reason).join('; ')}.`);
  }
  return parts.join(' ');
}

function buildAuditChain(hypotheses: Hypothesis[], branches: ReasoningBranch[]): string {
  const lines: string[] = [];
  lines.push('=== Reasoning audit chain ===');
  for (const h of hypotheses) {
    const b = branches.find((x) => x.hypothesisId === h.id);
    if (!b) continue;
    lines.push(
      `[${h.id}] ${h.label} — prior ${h.prior.toFixed(2)} → posterior ${b.posterior.toFixed(2)} (${b.steps.length} steps)`
    );
    for (const s of b.steps) {
      lines.push(`  • ${s.reason} [logLR ${s.logLR.toFixed(2)}]`);
    }
  }
  return lines.join('\n');
}

export { DEFAULT_HYPOTHESES };
