import { describe, it, expect } from 'vitest';
import {
  createChain,
  addNode,
  addEdge,
  seal,
  descendants,
  ancestors,
  rootCauses,
  leafConclusions,
  toJSON,
  fromJSON,
  toMermaid,
  pathWeight,
} from '@/services/reasoningChain';

describe('reasoningChain — construction', () => {
  it('creates empty chain with id + topic', () => {
    const c = createChain('STR for John Doe');
    expect(c.topic).toBe('STR for John Doe');
    expect(c.nodes).toHaveLength(0);
    expect(c.edges).toHaveLength(0);
    expect(c.sealed).toBe(false);
    expect(c.id).toMatch(/^rc-/);
  });

  it('uses explicit id when supplied', () => {
    const c = createChain('x', 'rc-test');
    expect(c.id).toBe('rc-test');
  });

  it('addNode rejects duplicates', () => {
    const c = createChain('x');
    addNode(c, { id: 'n1', type: 'event', label: 'e', weight: 1 });
    expect(() =>
      addNode(c, { id: 'n1', type: 'event', label: 'e', weight: 1 }),
    ).toThrow(/duplicate/);
  });

  it('addEdge rejects unknown nodes', () => {
    const c = createChain('x');
    addNode(c, { id: 'n1', type: 'event', label: 'e', weight: 1 });
    expect(() =>
      addEdge(c, { fromId: 'n1', toId: 'missing', relation: 'triggers', weight: 1 }),
    ).toThrow(/unknown to-node/);
  });

  it('seal blocks further modifications', () => {
    const c = createChain('x');
    addNode(c, { id: 'n1', type: 'event', label: 'e', weight: 1 });
    seal(c);
    expect(() =>
      addNode(c, { id: 'n2', type: 'event', label: 'e', weight: 1 }),
    ).toThrow(/sealed/);
    expect(() =>
      addEdge(c, { fromId: 'n1', toId: 'n1', relation: 'triggers', weight: 1 }),
    ).toThrow(/sealed/);
  });
});

describe('reasoningChain — traversal', () => {
  const chain = (() => {
    const c = createChain('sanctions hit → STR');
    addNode(c, { id: 'evt', type: 'event', label: 'hit', weight: 1 });
    addNode(c, { id: 'reg', type: 'regulation', label: 'FDL 26', weight: 1, regulatory: 'FDL Art.26' });
    addNode(c, { id: 'rule', type: 'rule', label: 'file STR', weight: 1 });
    addNode(c, { id: 'ev', type: 'evidence', label: 'ofac row', weight: 1 });
    addNode(c, { id: 'act', type: 'action', label: 'freeze', weight: 1 });
    addEdge(c, { fromId: 'evt', toId: 'reg', relation: 'triggers', weight: 0.8 });
    addEdge(c, { fromId: 'reg', toId: 'rule', relation: 'implies', weight: 0.9 });
    addEdge(c, { fromId: 'ev', toId: 'rule', relation: 'supports', weight: 0.6 });
    addEdge(c, { fromId: 'rule', toId: 'act', relation: 'triggers', weight: 1 });
    return c;
  })();

  it('descendants from evt reaches act', () => {
    const d = descendants(chain, 'evt').map((n) => n.id);
    expect(d).toContain('reg');
    expect(d).toContain('rule');
    expect(d).toContain('act');
  });

  it('ancestors of act includes rule, reg, evt, ev', () => {
    const a = ancestors(chain, 'act').map((n) => n.id);
    expect(a.sort()).toEqual(['ev', 'evt', 'reg', 'rule']);
  });

  it('rootCauses returns evt and ev', () => {
    const roots = rootCauses(chain).map((n) => n.id).sort();
    expect(roots).toEqual(['ev', 'evt']);
  });

  it('leafConclusions returns act', () => {
    const leaves = leafConclusions(chain).map((n) => n.id);
    expect(leaves).toEqual(['act']);
  });
});

describe('reasoningChain — serialisation + rendering', () => {
  it('JSON round-trips', () => {
    const c = createChain('x', 'rc-test');
    addNode(c, { id: 'n1', type: 'event', label: 'e', weight: 1 });
    const json = toJSON(c);
    const back = fromJSON(json);
    expect(back.id).toBe('rc-test');
    expect(back.nodes).toHaveLength(1);
  });

  it('toMermaid emits flowchart with nodes + edges', () => {
    const c = createChain('x');
    addNode(c, { id: 'n1', type: 'event', label: 'hit', weight: 1 });
    addNode(c, { id: 'n2', type: 'action', label: 'freeze', weight: 1 });
    addEdge(c, { fromId: 'n1', toId: 'n2', relation: 'triggers', weight: 1 });
    const m = toMermaid(c);
    expect(m).toContain('flowchart TD');
    expect(m).toContain('n1');
    expect(m).toContain('n2');
    expect(m).toContain('triggers');
  });

  it('pathWeight returns sum of edge weights on path', () => {
    const c = createChain('x');
    addNode(c, { id: 'a', type: 'event', label: 'a', weight: 1 });
    addNode(c, { id: 'b', type: 'rule', label: 'b', weight: 1 });
    addNode(c, { id: 'c', type: 'action', label: 'c', weight: 1 });
    addEdge(c, { fromId: 'a', toId: 'b', relation: 'triggers', weight: 0.5 });
    addEdge(c, { fromId: 'b', toId: 'c', relation: 'triggers', weight: 0.5 });
    expect(pathWeight(c, 'a', 'c')).toBeCloseTo(1.0);
  });

  it('pathWeight returns 0 when no path', () => {
    const c = createChain('x');
    addNode(c, { id: 'a', type: 'event', label: 'a', weight: 1 });
    addNode(c, { id: 'b', type: 'event', label: 'b', weight: 1 });
    expect(pathWeight(c, 'a', 'b')).toBe(0);
  });
});
