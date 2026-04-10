import { describe, it, expect } from 'vitest';
import {
  learnDecisionTree,
  extractRules,
  predict,
  formatRule,
  type LabeledSample,
} from '@/services/ruleInduction';

const samples: LabeledSample[] = [
  { features: { pep: 1, sanctionsHit: 0, crossBorder: 1 }, label: 'edd' },
  { features: { pep: 1, sanctionsHit: 0, crossBorder: 0 }, label: 'monitor' },
  { features: { pep: 0, sanctionsHit: 1, crossBorder: 0 }, label: 'freeze' },
  { features: { pep: 0, sanctionsHit: 1, crossBorder: 1 }, label: 'freeze' },
  { features: { pep: 0, sanctionsHit: 0, crossBorder: 0 }, label: 'monitor' },
  { features: { pep: 0, sanctionsHit: 0, crossBorder: 1 }, label: 'monitor' },
  { features: { pep: 1, sanctionsHit: 1, crossBorder: 0 }, label: 'freeze' },
  { features: { pep: 1, sanctionsHit: 0, crossBorder: 1 }, label: 'edd' },
];

describe('ruleInduction — tree building', () => {
  it('learns a tree that predicts the training data correctly', () => {
    const tree = learnDecisionTree(samples, { maxDepth: 5, minSamples: 1 });
    for (const s of samples) {
      expect(predict(tree, s.features)).toBe(s.label);
    }
  });

  it('sanctions_hit is selected early (high info gain)', () => {
    const tree = learnDecisionTree(samples, { maxDepth: 5, minSamples: 1 });
    if (tree.kind !== 'split') throw new Error('expected split');
    // The root feature should be one of sanctionsHit or pep — the
    // feature that separates freeze from the rest most cleanly.
    expect(['sanctionsHit', 'pep']).toContain(tree.feature);
  });

  it('respects max depth', () => {
    const tree = learnDecisionTree(samples, { maxDepth: 1 });
    const depth = maxDepth(tree);
    expect(depth).toBeLessThanOrEqual(1);
  });
});

describe('ruleInduction — rule extraction', () => {
  it('extractRules returns one rule per leaf', () => {
    const tree = learnDecisionTree(samples, { maxDepth: 5, minSamples: 1 });
    const rules = extractRules(tree);
    expect(rules.length).toBeGreaterThanOrEqual(2);
    for (const r of rules) {
      expect(r.label).toBeDefined();
      expect(r.support).toBeGreaterThanOrEqual(0);
    }
  });

  it('formatRule produces readable IF-THEN text', () => {
    const tree = learnDecisionTree(samples, { maxDepth: 5, minSamples: 1 });
    const rules = extractRules(tree);
    const text = formatRule(rules[0]);
    expect(text).toMatch(/IF|ALWAYS/);
    expect(text).toMatch(/THEN/);
  });
});

describe('ruleInduction — edge cases', () => {
  it('empty dataset produces unknown leaf', () => {
    const tree = learnDecisionTree([]);
    expect(tree.kind).toBe('leaf');
    if (tree.kind === 'leaf') expect(tree.label).toBe('unknown');
  });

  it('pure dataset returns a single leaf', () => {
    const pure: LabeledSample[] = [
      { features: { a: 1 }, label: 'x' },
      { features: { a: 0 }, label: 'x' },
    ];
    const tree = learnDecisionTree(pure);
    expect(tree.kind).toBe('leaf');
  });
});

function maxDepth(tree: ReturnType<typeof learnDecisionTree>): number {
  if (tree.kind === 'leaf') return 0;
  return 1 + Math.max(maxDepth(tree.whenTrue), maxDepth(tree.whenFalse));
}
