import { describe, it, expect } from 'vitest';
import { createChain, addNode, addEdge, seal } from '@/services/reasoningChain';
import { reviewReasoningChain, formatIssues } from '@/services/reflectionCritic';

function completeChain() {
  const c = createChain('sanctions hit on Acme');
  addNode(c, { id: 'evt', type: 'event', label: 'hit', weight: 1, regulatory: 'FDL Art.22' });
  addNode(c, { id: 'ev', type: 'evidence', label: 'ofac row', weight: 1 });
  addNode(c, { id: 'dec', type: 'decision', label: 'freeze', weight: 1 });
  addNode(c, { id: 'act', type: 'action', label: 'freeze action', weight: 1 });
  addEdge(c, { fromId: 'evt', toId: 'ev', relation: 'triggers', weight: 1 });
  addEdge(c, { fromId: 'ev', toId: 'act', relation: 'supports', weight: 1 });
  addEdge(c, { fromId: 'act', toId: 'dec', relation: 'implies', weight: 1 });
  seal(c);
  return c;
}

describe('reflectionCritic — happy path', () => {
  it('complete chain scores high confidence', () => {
    const chain = completeChain();
    const report = reviewReasoningChain(chain);
    expect(report.coverage.hasRegulatoryCitation).toBe(true);
    expect(report.coverage.hasEvidence).toBe(true);
    expect(report.coverage.hasAction).toBe(true);
    expect(report.coverage.hasDecision).toBe(true);
    expect(report.confidence).toBeGreaterThan(0.9);
    expect(report.shouldEscalateToHuman).toBe(false);
  });
});

describe('reflectionCritic — missing coverage', () => {
  it('flags missing regulatory citation', () => {
    const c = createChain('x');
    addNode(c, { id: 'e', type: 'event', label: 'e', weight: 1 });
    addNode(c, { id: 'ev', type: 'evidence', label: 'ev', weight: 1 });
    addNode(c, { id: 'act', type: 'action', label: 'a', weight: 1 });
    addNode(c, { id: 'dec', type: 'decision', label: 'd', weight: 1 });
    addEdge(c, { fromId: 'e', toId: 'ev', relation: 'triggers', weight: 1 });
    addEdge(c, { fromId: 'ev', toId: 'act', relation: 'supports', weight: 1 });
    addEdge(c, { fromId: 'act', toId: 'dec', relation: 'implies', weight: 1 });
    seal(c);
    const report = reviewReasoningChain(c);
    expect(report.issues.some((i) => i.code === 'NO_REGULATORY_CITATION')).toBe(true);
    expect(report.coverage.hasRegulatoryCitation).toBe(false);
  });

  it('flags missing required node type', () => {
    const c = createChain('x');
    addNode(c, { id: 'e', type: 'event', label: 'e', weight: 1, regulatory: 'FDL Art.22' });
    addNode(c, { id: 'dec', type: 'decision', label: 'd', weight: 1 });
    addEdge(c, { fromId: 'e', toId: 'dec', relation: 'implies', weight: 1 });
    seal(c);
    const report = reviewReasoningChain(c);
    expect(report.issues.some((i) => i.code === 'MISSING_NODE_TYPE')).toBe(true);
    expect(report.confidence).toBeLessThan(0.9);
  });
});

describe('reflectionCritic — structural flaws', () => {
  it('flags unsupported decisions', () => {
    const c = createChain('x');
    addNode(c, { id: 'e', type: 'event', label: 'e', weight: 1, regulatory: 'FDL Art.22' });
    addNode(c, { id: 'dec', type: 'decision', label: 'freeze', weight: 1 });
    addNode(c, { id: 'act', type: 'action', label: 'a', weight: 1 });
    addEdge(c, { fromId: 'e', toId: 'dec', relation: 'implies', weight: 1 });
    seal(c);
    const report = reviewReasoningChain(c, { requiredNodeTypes: ['event', 'decision'] });
    expect(report.issues.some((i) => i.code === 'UNSUPPORTED_DECISION')).toBe(true);
  });

  it('flags unsealed chain as warning', () => {
    const chain = completeChain();
    chain.sealed = false;
    const report = reviewReasoningChain(chain);
    expect(report.issues.some((i) => i.code === 'CHAIN_NOT_SEALED')).toBe(true);
  });

  it('escalates to human when confidence drops', () => {
    const c = createChain('broken');
    addNode(c, { id: 'e', type: 'event', label: 'e', weight: 1 });
    seal(c);
    const report = reviewReasoningChain(c, { escalationThreshold: 0.8 });
    expect(report.shouldEscalateToHuman).toBe(true);
    expect(report.recommendations).toContain('Escalate to human review — confidence below threshold.');
  });
});

describe('reflectionCritic — formatting', () => {
  it('formatIssues returns one string per issue', () => {
    const c = createChain('x');
    addNode(c, { id: 'e', type: 'event', label: 'e', weight: 1 });
    seal(c);
    const report = reviewReasoningChain(c);
    const lines = formatIssues(report);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toMatch(/^\[(INFO|WARNING|ERROR)\]/);
  });
});
