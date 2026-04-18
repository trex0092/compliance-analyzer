/**
 * Tests for src/services/pepGraph.ts — PEP graph traversal with
 * family / KCA / UBO edges.
 */
import { describe, it, expect } from 'vitest';
import {
  buildPepGraph,
  matchAgainstPepGraph,
  SEED_PEP_GRAPH,
  type PepNode,
  type PepEdge,
} from '@/services/pepGraph';

describe('pepGraph.matchAgainstPepGraph', () => {
  it('matches a direct PEP by exact name and returns confidence-weighted exposure', () => {
    const matches = matchAgainstPepGraph(
      { name: 'Amina Al Mansouri', jurisdiction: 'AE' },
      SEED_PEP_GRAPH
    );
    expect(matches.length).toBeGreaterThan(0);
    const top = matches[0];
    expect(top.seed.id).toBe('pep-001');
    expect(top.attributedRole).toBe('pep_domestic');
    expect(top.pepExposure).toBeGreaterThanOrEqual(0.9);
  });

  it('attributes role=family when the match is a spouse and traverses to the PEP', () => {
    const matches = matchAgainstPepGraph(
      { name: 'Omar Al Mansouri', jurisdiction: 'AE' },
      SEED_PEP_GRAPH
    );
    expect(matches.length).toBeGreaterThan(0);
    const omar = matches.find((m) => m.seed.id === 'pep-002');
    expect(omar).toBeDefined();
    expect(omar!.attributedRole).toBe('family');
    expect(omar!.pepPaths.length).toBeGreaterThan(0);
    expect(omar!.pepPaths[0].edgeTypes[0]).toBe('spouse');
  });

  it('finds a UBO chain for an entity that owns a family member of a PEP', () => {
    const matches = matchAgainstPepGraph(
      { name: 'BlueGold Trading FZE', jurisdiction: 'AE' },
      SEED_PEP_GRAPH
    );
    expect(matches.length).toBeGreaterThan(0);
    const entity = matches.find((m) => m.seed.id === 'pep-003');
    expect(entity).toBeDefined();
    expect(entity!.uboChains.length).toBeGreaterThan(0);
  });

  it('respects the nameThreshold — trash names do not match', () => {
    const matches = matchAgainstPepGraph(
      { name: 'Zzyzx Unrelated Person', jurisdiction: 'AE' },
      SEED_PEP_GRAPH,
      { nameThreshold: 0.85 }
    );
    expect(matches.length).toBe(0);
  });

  it('returns an empty array when the graph has no nodes', () => {
    const empty = buildPepGraph([], []);
    const matches = matchAgainstPepGraph({ name: 'Anyone' }, empty);
    expect(matches).toEqual([]);
  });

  it('is cycle-safe: a graph with cyclic edges does not loop forever', () => {
    const nodes: PepNode[] = [
      { id: 'a', name: 'Alpha', role: 'pep_domestic', source: 's', confidence: 0.9 },
      { id: 'b', name: 'Beta', role: 'family', source: 's', confidence: 0.8 },
    ];
    const edges: PepEdge[] = [
      { from: 'a', to: 'b', type: 'spouse', weight: 0.8 },
      { from: 'b', to: 'a', type: 'spouse', weight: 0.8 },
    ];
    const graph = buildPepGraph(nodes, edges);
    const start = Date.now();
    const matches = matchAgainstPepGraph({ name: 'Alpha' }, graph, { maxHops: 10 });
    expect(Date.now() - start).toBeLessThan(500);
    expect(matches.length).toBeGreaterThan(0);
  });
});
