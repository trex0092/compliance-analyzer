/**
 * Inductive Rule Learner.
 *
 * Learns simple IF-THEN rules from labelled compliance case outcomes.
 * Unlike a black-box classifier, each rule is human-readable and maps
 * cleanly onto a compliance policy paragraph.
 *
 * Algorithm: ID3-style greedy decision tree, binary features only.
 * At each node we pick the feature that maximises information gain on
 * the remaining data, split, and recurse until:
 *   - node is pure (all labels agree), or
 *   - depth limit reached, or
 *   - minimum samples reached.
 *
 * The tree is then flattened into a list of IF-THEN rules:
 *
 *   IF (pep = 1) AND (crossBorder = 1) THEN edd
 *   IF (pep = 1) AND (crossBorder = 0) THEN monitor
 *   IF (pep = 0) AND (sanctionsHit = 1) THEN freeze
 *
 * These rules can be reviewed by the MLRO, tweaked, and deployed as
 * deterministic policy checks. No neural network, no hyperparameter
 * tuning — only explainable splits.
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.5 (documented risk methodology)
 *   - FATF Rec 1 (risk-based approach transparency)
 *   - FDL Art.20 (CO must document reasoning)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LabeledSample {
  features: Record<string, 0 | 1>;
  label: string;
}

export type TreeNode =
  | {
      kind: 'leaf';
      label: string;
      support: number;
      purity: number;
    }
  | {
      kind: 'split';
      feature: string;
      informationGain: number;
      whenTrue: TreeNode;
      whenFalse: TreeNode;
    };

export interface LearnedRule {
  conditions: Array<{ feature: string; value: 0 | 1 }>;
  label: string;
  support: number;
  purity: number;
}

export interface InductionConfig {
  maxDepth?: number;
  minSamples?: number;
}

// ---------------------------------------------------------------------------
// Entropy helpers
// ---------------------------------------------------------------------------

function entropy(samples: readonly LabeledSample[]): number {
  if (samples.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const s of samples) counts.set(s.label, (counts.get(s.label) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / samples.length;
    if (p > 0) h -= p * Math.log2(p);
  }
  return h;
}

function majorityLabel(samples: readonly LabeledSample[]): {
  label: string;
  purity: number;
} {
  if (samples.length === 0) return { label: 'unknown', purity: 0 };
  const counts = new Map<string, number>();
  for (const s of samples) counts.set(s.label, (counts.get(s.label) ?? 0) + 1);
  let best = '';
  let bestCount = -1;
  for (const [label, count] of counts.entries()) {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  return { label: best, purity: bestCount / samples.length };
}

// ---------------------------------------------------------------------------
// Tree builder
// ---------------------------------------------------------------------------

export function learnDecisionTree(
  samples: readonly LabeledSample[],
  config: InductionConfig = {},
): TreeNode {
  const maxDepth = config.maxDepth ?? 5;
  const minSamples = config.minSamples ?? 2;
  return build(samples, 0, maxDepth, minSamples);
}

function build(
  samples: readonly LabeledSample[],
  depth: number,
  maxDepth: number,
  minSamples: number,
): TreeNode {
  const majority = majorityLabel(samples);
  if (
    samples.length <= minSamples ||
    depth >= maxDepth ||
    majority.purity === 1 ||
    samples.length === 0
  ) {
    return {
      kind: 'leaf',
      label: majority.label,
      support: samples.length,
      purity: majority.purity,
    };
  }

  // Try each feature; pick the one with the highest information gain.
  const features = Array.from(
    new Set(samples.flatMap((s) => Object.keys(s.features))),
  );
  const baseEntropy = entropy(samples);
  let bestFeature: string | null = null;
  let bestGain = 0;
  let bestSplit: { whenTrue: LabeledSample[]; whenFalse: LabeledSample[] } | null = null;

  for (const feature of features) {
    const whenTrue = samples.filter((s) => s.features[feature] === 1);
    const whenFalse = samples.filter((s) => s.features[feature] !== 1);
    if (whenTrue.length === 0 || whenFalse.length === 0) continue;
    const gain =
      baseEntropy -
      (whenTrue.length / samples.length) * entropy(whenTrue) -
      (whenFalse.length / samples.length) * entropy(whenFalse);
    if (gain > bestGain) {
      bestGain = gain;
      bestFeature = feature;
      bestSplit = { whenTrue, whenFalse };
    }
  }

  if (!bestFeature || !bestSplit || bestGain <= 0) {
    return {
      kind: 'leaf',
      label: majority.label,
      support: samples.length,
      purity: majority.purity,
    };
  }

  return {
    kind: 'split',
    feature: bestFeature,
    informationGain: bestGain,
    whenTrue: build(bestSplit.whenTrue, depth + 1, maxDepth, minSamples),
    whenFalse: build(bestSplit.whenFalse, depth + 1, maxDepth, minSamples),
  };
}

// ---------------------------------------------------------------------------
// Rule extraction
// ---------------------------------------------------------------------------

export function extractRules(tree: TreeNode): LearnedRule[] {
  const rules: LearnedRule[] = [];
  const walk = (node: TreeNode, path: LearnedRule['conditions']): void => {
    if (node.kind === 'leaf') {
      rules.push({
        conditions: [...path],
        label: node.label,
        support: node.support,
        purity: node.purity,
      });
      return;
    }
    walk(node.whenTrue, [...path, { feature: node.feature, value: 1 }]);
    walk(node.whenFalse, [...path, { feature: node.feature, value: 0 }]);
  };
  walk(tree, []);
  return rules;
}

// ---------------------------------------------------------------------------
// Prediction
// ---------------------------------------------------------------------------

export function predict(tree: TreeNode, features: Record<string, 0 | 1>): string {
  let node = tree;
  while (node.kind === 'split') {
    if (features[node.feature] === 1) {
      node = node.whenTrue;
    } else {
      node = node.whenFalse;
    }
  }
  return node.label;
}

// ---------------------------------------------------------------------------
// Rule formatting
// ---------------------------------------------------------------------------

export function formatRule(rule: LearnedRule): string {
  if (rule.conditions.length === 0) {
    return `ALWAYS → ${rule.label} (support=${rule.support}, purity=${(rule.purity * 100).toFixed(0)}%)`;
  }
  const conds = rule.conditions
    .map((c) => `${c.feature}=${c.value}`)
    .join(' AND ');
  return `IF ${conds} THEN ${rule.label} (support=${rule.support}, purity=${(rule.purity * 100).toFixed(0)}%)`;
}
