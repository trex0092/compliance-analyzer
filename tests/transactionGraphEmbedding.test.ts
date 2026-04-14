/**
 * Transaction graph embedding tests.
 */
import { describe, it, expect } from 'vitest';
import {
  embedTransactionGraph,
  __test__,
  type TransactionEdge,
} from '../src/services/transactionGraphEmbedding';

const { cosine, logScale, EMBED_DIM } = __test__;

// ---------------------------------------------------------------------------
// Helpers under test
// ---------------------------------------------------------------------------

describe('cosine', () => {
  it('identical vectors yield 1', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });
  it('orthogonal vectors yield 0', () => {
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });
  it('zero vector safely returns 0', () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
  it('mismatched lengths return 0', () => {
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
  });
});

describe('logScale', () => {
  it('zero maps to zero', () => expect(logScale(0)).toBe(0));
  it('negative maps to zero', () => expect(logScale(-5)).toBe(0));
  it('is monotone positive', () => {
    expect(logScale(10)).toBeGreaterThan(logScale(1));
    expect(logScale(1000)).toBeGreaterThan(logScale(10));
  });
});

// ---------------------------------------------------------------------------
// embedTransactionGraph
// ---------------------------------------------------------------------------

describe('embedTransactionGraph', () => {
  it('empty edge list yields empty report', () => {
    const r = embedTransactionGraph([]);
    expect(r.nodeCount).toBe(0);
    expect(r.edgeCount).toBe(0);
    expect(r.embeddings).toHaveLength(0);
    expect(r.similarPairs).toHaveLength(0);
    expect(r.summary).toMatch(/Empty transaction graph/);
  });

  it('ignores malformed edges', () => {
    const edges: TransactionEdge[] = [
      { from: '', to: 'B', weightAED: 100 } as TransactionEdge,
      { from: 'A', to: '', weightAED: 100 } as TransactionEdge,
      { from: 'A', to: 'B', weightAED: Number.NaN } as TransactionEdge,
      { from: 'A', to: 'B', weightAED: -50 } as TransactionEdge,
    ];
    const r = embedTransactionGraph(edges);
    // Only the last two survive: NaN clamps to 0, negative clamps to 0.
    expect(r.edgeCount).toBe(2);
    expect(r.nodeCount).toBe(2);
  });

  it('every embedding has exactly EMBED_DIM dimensions', () => {
    const r = embedTransactionGraph([
      { from: 'A', to: 'B', weightAED: 100 },
      { from: 'B', to: 'C', weightAED: 200 },
      { from: 'C', to: 'A', weightAED: 50 },
    ]);
    for (const e of r.embeddings) {
      expect(e.vector).toHaveLength(EMBED_DIM);
    }
  });

  it('detects reciprocity between A<->B', () => {
    const r = embedTransactionGraph([
      { from: 'A', to: 'B', weightAED: 100 },
      { from: 'B', to: 'A', weightAED: 100 },
    ]);
    const a = r.embeddings.find((e) => e.node === 'A')!;
    // Vector[4] = reciprocity
    expect(a.vector[4]).toBe(1);
  });

  it('low clustering on a chain, high on a triangle', () => {
    const chain = embedTransactionGraph([
      { from: 'A', to: 'B', weightAED: 100 },
      { from: 'B', to: 'C', weightAED: 100 },
      { from: 'C', to: 'D', weightAED: 100 },
    ]);
    const triangle = embedTransactionGraph([
      { from: 'A', to: 'B', weightAED: 100 },
      { from: 'B', to: 'C', weightAED: 100 },
      { from: 'C', to: 'A', weightAED: 100 },
    ]);
    const chainB = chain.embeddings.find((e) => e.node === 'B')!;
    const triB = triangle.embeddings.find((e) => e.node === 'B')!;
    // Vector[5] = clustering proxy
    expect(triB.vector[5]).toBeGreaterThan(chainB.vector[5]);
  });

  it('finds high-similarity pair when two nodes share structural role', () => {
    // A and X both have the same shape: 1 in-edge + 1 out-edge + no clustering.
    const r = embedTransactionGraph(
      [
        { from: 'src', to: 'A', weightAED: 100 },
        { from: 'A', to: 'dst', weightAED: 100 },
        { from: 'src', to: 'X', weightAED: 100 },
        { from: 'X', to: 'dst', weightAED: 100 },
      ],
      { minSimilarity: 0.99 }
    );
    const pair = r.similarPairs.find(
      (p) => (p.a === 'A' && p.b === 'X') || (p.a === 'X' && p.b === 'A')
    );
    expect(pair).toBeDefined();
    expect(pair!.cosine).toBeGreaterThanOrEqual(0.99);
  });

  it('self loops flip the self-loop flag', () => {
    const r = embedTransactionGraph([
      { from: 'A', to: 'A', weightAED: 50 },
      { from: 'B', to: 'C', weightAED: 10 },
    ]);
    const a = r.embeddings.find((e) => e.node === 'A')!;
    const b = r.embeddings.find((e) => e.node === 'B')!;
    expect(a.vector[7]).toBe(1);
    expect(b.vector[7]).toBe(0);
  });

  it('topK caps the similar-pair list', () => {
    const edges: TransactionEdge[] = [];
    for (let i = 0; i < 8; i++) {
      edges.push({ from: 's', to: `n${i}`, weightAED: 100 });
      edges.push({ from: `n${i}`, to: 'd', weightAED: 100 });
    }
    const r = embedTransactionGraph(edges, { topK: 3, minSimilarity: 0.9 });
    expect(r.similarPairs.length).toBeLessThanOrEqual(3);
  });

  it('regulatory citations include Art.20-22 + FATF Rec 11 + FATF Rec 20', () => {
    const r = embedTransactionGraph([{ from: 'A', to: 'B', weightAED: 100 }]);
    expect(r.regulatory).toContain('FDL No.10/2025 Art.20-22');
    expect(r.regulatory).toContain('FATF Rec 11');
    expect(r.regulatory).toContain('FATF Rec 20');
  });

  it('is deterministic', () => {
    const edges: TransactionEdge[] = [
      { from: 'A', to: 'B', weightAED: 100 },
      { from: 'B', to: 'C', weightAED: 200 },
    ];
    const a = embedTransactionGraph(edges);
    const b = embedTransactionGraph(edges);
    expect(a).toEqual(b);
  });
});
