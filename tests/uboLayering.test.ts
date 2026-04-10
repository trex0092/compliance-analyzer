import { describe, it, expect } from 'vitest';
import { addEdge, addNode, createGraph } from '@/services/uboGraph';
import {
  analyseLayering,
  analyseShellCompany,
  analyseControlPyramid,
} from '@/services/uboLayering';

function mkGraph() {
  const g = createGraph();
  // Natural person at the top
  addNode(g, { id: 'P1', type: 'natural_person', name: 'Alice', country: 'AE' });
  addNode(g, { id: 'L1', type: 'legal_entity', name: 'Alpha LLC', country: 'AE' });
  addNode(g, { id: 'L2', type: 'legal_entity', name: 'Beta FZE', country: 'AE' });
  addNode(g, { id: 'L3', type: 'legal_entity', name: 'Gamma JSC', country: 'BVI' });
  addNode(g, { id: 'L4', type: 'legal_entity', name: 'Delta Trust', country: 'GG' });
  addNode(g, { id: 'TARGET', type: 'legal_entity', name: 'Acme Metals LLC' });
  // Chain: P1 → L1 → L2 → L3 → L4 → TARGET
  addEdge(g, { from: 'P1', to: 'L1', kind: 'owns', percentage: 100 });
  addEdge(g, { from: 'L1', to: 'L2', kind: 'owns', percentage: 100 });
  addEdge(g, { from: 'L2', to: 'L3', kind: 'owns', percentage: 100 });
  addEdge(g, { from: 'L3', to: 'L4', kind: 'owns', percentage: 100 });
  addEdge(g, { from: 'L4', to: 'TARGET', kind: 'owns', percentage: 100 });
  return g;
}

describe('uboLayering — depth', () => {
  it('deep chain exceeds FATF 4-layer threshold', () => {
    const g = mkGraph();
    const report = analyseLayering(g, 'TARGET');
    expect(report.maxDepth).toBeGreaterThanOrEqual(5);
    expect(report.exceedsFatfThreshold).toBe(true);
    expect(report.longestPath[0].name).toBe('Alice');
    expect(report.longestPath[report.longestPath.length - 1].name).toBe('Acme Metals LLC');
  });

  it('returns zero depth for unknown target', () => {
    const g = mkGraph();
    const report = analyseLayering(g, 'NOPE');
    expect(report.maxDepth).toBe(0);
    expect(report.exceedsFatfThreshold).toBe(false);
  });
});

describe('uboLayering — shell company score', () => {
  it('deep chain + no activity + no top natural person → probable-shell', () => {
    const g = createGraph();
    addNode(g, { id: 'L1', type: 'legal_entity', name: 'Shell-1' });
    addNode(g, { id: 'L2', type: 'legal_entity', name: 'Shell-2' });
    addNode(g, { id: 'L3', type: 'legal_entity', name: 'Shell-3' });
    addNode(g, { id: 'L4', type: 'legal_entity', name: 'Target' });
    addEdge(g, { from: 'L1', to: 'L2', kind: 'owns', percentage: 100 });
    addEdge(g, { from: 'L2', to: 'L3', kind: 'owns', percentage: 100 });
    addEdge(g, { from: 'L3', to: 'L4', kind: 'owns', percentage: 100 });
    const report = analyseShellCompany(g, 'L4', { hasDeclaredActivity: false });
    expect(report.verdict).toBe('probable-shell');
    expect(report.shellScore).toBeGreaterThanOrEqual(0.7);
  });

  it('shallow chain with natural person on top → likely-operating', () => {
    const g = createGraph();
    addNode(g, { id: 'P1', type: 'natural_person', name: 'Bob' });
    addNode(g, { id: 'L1', type: 'legal_entity', name: 'Real Business LLC' });
    addEdge(g, { from: 'P1', to: 'L1', kind: 'owns', percentage: 100 });
    const report = analyseShellCompany(g, 'L1', { hasDeclaredActivity: true });
    expect(report.verdict).toBe('likely-operating');
  });
});

describe('uboLayering — control pyramid', () => {
  it('detects a 3-chain pyramid', () => {
    const g = createGraph();
    addNode(g, { id: 'P1', type: 'natural_person', name: 'Alice' });
    addNode(g, { id: 'A', type: 'legal_entity', name: 'A' });
    addNode(g, { id: 'B', type: 'legal_entity', name: 'B' });
    addNode(g, { id: 'C', type: 'legal_entity', name: 'C' });
    addNode(g, { id: 'TARGET', type: 'legal_entity', name: 'Target' });
    // Three distinct paths from Alice to TARGET via A, B, C.
    addEdge(g, { from: 'P1', to: 'A', kind: 'owns', percentage: 100 });
    addEdge(g, { from: 'P1', to: 'B', kind: 'owns', percentage: 100 });
    addEdge(g, { from: 'P1', to: 'C', kind: 'owns', percentage: 100 });
    addEdge(g, { from: 'A', to: 'TARGET', kind: 'owns', percentage: 33 });
    addEdge(g, { from: 'B', to: 'TARGET', kind: 'owns', percentage: 33 });
    addEdge(g, { from: 'C', to: 'TARGET', kind: 'owns', percentage: 34 });
    const report = analyseControlPyramid(g, 'TARGET');
    expect(report.isPyramid).toBe(true);
    expect(report.apexes[0].distinctChains).toBe(3);
    expect(report.apexes[0].name).toBe('Alice');
  });

  it('single chain is not a pyramid', () => {
    const g = mkGraph();
    const report = analyseControlPyramid(g, 'TARGET');
    expect(report.isPyramid).toBe(false);
  });
});
