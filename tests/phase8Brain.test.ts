/**
 * Tests for Phase 8 brain subsystems — Shapley, quantum seal,
 * temporal knowledge graph, game-theoretic adversary, cross-script.
 */
import { describe, it, expect } from 'vitest';

import { computeShapleyAttribution } from '@/services/shapleyExplainer';
import {
  sha3_512Hex,
  sealQuantumResistant,
  verifyQuantumSeal,
} from '@/services/quantumResistantSeal';
import { TemporalKnowledgeGraph } from '@/services/temporalKnowledgeGraph';
import { solveAdversaryGame } from '@/services/gameTheoryAdversary';
import {
  detectScript,
  normaliseToLatin,
  crossScriptCompare,
} from '@/services/crossScriptNameMatcher';

// ---------------------------------------------------------------------------
// #90 shapleyExplainer
// ---------------------------------------------------------------------------

describe('shapleyExplainer', () => {
  it('attributes 100% to the single important signal', () => {
    // Verdict only depends on 'sanctioned' presence.
    const report = computeShapleyAttribution({
      signals: ['sanctioned', 'low_activity', 'retail'],
      verdict: (coalition) => (coalition.has('sanctioned') ? 3 : 0),
    });
    const sanc = report.attributions.find((a) => a.signal === 'sanctioned');
    expect(sanc?.normalised).toBe(1);
  });

  it('exact mode for N <= 12', () => {
    const report = computeShapleyAttribution({
      signals: ['a', 'b', 'c'],
      verdict: () => 0,
    });
    expect(report.mode).toBe('exact');
  });

  it('monte-carlo mode for N > 12', () => {
    const signals = Array.from({ length: 13 }, (_, i) => `s${i}`);
    const report = computeShapleyAttribution({
      signals,
      verdict: (c) => c.size,
    });
    expect(report.mode).toBe('monte_carlo');
  });

  it('attributions sum to full minus baseline (efficiency axiom)', () => {
    const report = computeShapleyAttribution({
      signals: ['a', 'b', 'c'],
      verdict: (c) => c.size, // simple additive
    });
    const sum = report.attributions.reduce((acc, a) => acc + a.value, 0);
    expect(Math.abs(sum - (report.full - report.baseline))).toBeLessThan(1e-9);
  });

  it('empty signals returns zero report', () => {
    const report = computeShapleyAttribution({ signals: [], verdict: () => 0 });
    expect(report.attributions.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #91 quantumResistantSeal
// ---------------------------------------------------------------------------

describe('quantumResistantSeal', () => {
  it('SHA-3-512 of empty string matches known value', () => {
    // Known answer: SHA3-512("")
    const expected =
      'a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a6' +
      '15b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26';
    expect(sha3_512Hex('')).toBe(expected);
  });

  it('SHA-3-512 of "abc" matches the NIST test vector', () => {
    const expected =
      'b751850b1a57168a5693cd924b6b096e08f621827444f70d884f5d0240d2712e' +
      '10e116e9192af3c91a7ec57647e3934057340b4cf408d5a56592f8274eec53f0';
    expect(sha3_512Hex('abc')).toBe(expected);
  });

  it('seal produces deterministic root for same salt', () => {
    const records = [
      { id: 'r1', data: { verdict: 'freeze' } },
      { id: 'r2', data: { verdict: 'escalate' } },
    ];
    const a = sealQuantumResistant(records, 'fixed-salt');
    const b = sealQuantumResistant(records, 'fixed-salt');
    expect(a.rootHash).toBe(b.rootHash);
  });

  it('different salts produce different roots', () => {
    const records = [{ id: 'r1', data: { x: 1 } }];
    const a = sealQuantumResistant(records, 'salt-a');
    const b = sealQuantumResistant(records, 'salt-b');
    expect(a.rootHash).not.toBe(b.rootHash);
  });

  it('verifyQuantumSeal returns true for the original records', () => {
    const records = [{ id: 'r1', data: { x: 1 } }, { id: 'r2', data: { y: 2 } }];
    const bundle = sealQuantumResistant(records, 'test-salt');
    expect(verifyQuantumSeal(records, bundle)).toBe(true);
  });

  it('verifyQuantumSeal returns false when records are tampered', () => {
    const records = [{ id: 'r1', data: { x: 1 } }];
    const bundle = sealQuantumResistant(records, 'test-salt');
    const tampered = [{ id: 'r1', data: { x: 2 } }];
    expect(verifyQuantumSeal(tampered, bundle)).toBe(false);
  });

  it('seal uses sha3-512 domain-separated', () => {
    const bundle = sealQuantumResistant([], 'salt');
    expect(bundle.hashFunction).toBe('sha3-512');
    expect(bundle.domainSeparated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #92 temporalKnowledgeGraph
// ---------------------------------------------------------------------------

describe('temporalKnowledgeGraph', () => {
  it('returns directors at a specific instant', () => {
    const g = new TemporalKnowledgeGraph();
    g.addEntity({ id: 'acme', kind: 'legal_entity', displayName: 'Acme' });
    g.addEntity({ id: 'alice', kind: 'natural_person', displayName: 'Alice' });
    g.addEntity({ id: 'bob', kind: 'natural_person', displayName: 'Bob' });
    g.addEdge({ fromId: 'alice', toId: 'acme', kind: 'director_of', validFrom: '2020-01-01', validTo: '2023-12-31' });
    g.addEdge({ fromId: 'bob', toId: 'acme', kind: 'director_of', validFrom: '2024-01-01' });
    const in2022 = g.directorsOf('acme', '2022-06-01');
    expect(in2022.map((d) => d.id)).toEqual(['alice']);
    const in2025 = g.directorsOf('acme', '2025-06-01');
    expect(in2025.map((d) => d.id)).toEqual(['bob']);
  });

  it('throws when referenced entity is missing', () => {
    const g = new TemporalKnowledgeGraph();
    expect(() =>
      g.addEdge({ fromId: 'ghost', toId: 'acme', kind: 'x', validFrom: '2020-01-01' })
    ).toThrow(/Unknown/);
  });

  it('timeline is chronological', () => {
    const g = new TemporalKnowledgeGraph();
    g.addEntity({ id: 'e', kind: 'legal_entity', displayName: 'E' });
    g.addEntity({ id: 'a', kind: 'natural_person', displayName: 'A' });
    g.addEdge({ fromId: 'a', toId: 'e', kind: 'director_of', validFrom: '2022-01-01' });
    g.addEdge({ fromId: 'a', toId: 'e', kind: 'ubo_of', validFrom: '2020-01-01' });
    const timeline = g.timelineOf('e');
    expect(Date.parse(timeline[0].validFrom)).toBeLessThan(Date.parse(timeline[1].validFrom));
  });

  it('edgesOverlap detects concurrent validity windows', () => {
    const g = new TemporalKnowledgeGraph();
    g.addEntity({ id: 'e', kind: 'legal_entity', displayName: 'E' });
    g.addEntity({ id: 'a', kind: 'natural_person', displayName: 'A' });
    g.addEntity({ id: 'b', kind: 'natural_person', displayName: 'B' });
    g.addEdge({ fromId: 'a', toId: 'e', kind: 'director_of', validFrom: '2022-01-01', validTo: '2023-12-31' });
    g.addEdge({ fromId: 'b', toId: 'e', kind: 'ubo_of', validFrom: '2023-06-01' });
    const edges = g.timelineOf('e');
    expect(g.edgesOverlap(edges[0], edges[1])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #93 gameTheoryAdversary
// ---------------------------------------------------------------------------

describe('gameTheoryAdversary', () => {
  it('converges to equilibrium mix', () => {
    const detections = [
      { name: 'sanctions_list', cost: 1 },
      { name: 'transaction_anomaly', cost: 1 },
    ];
    const evasions = [
      { name: 'fake_name', cost: 1 },
      { name: 'structuring', cost: 1 },
    ];
    // Diagonal payoff: each detector catches its own evasion.
    const payoff = (d: { name: string }, e: { name: string }) => {
      if (d.name === 'sanctions_list' && e.name === 'fake_name') return 1;
      if (d.name === 'transaction_anomaly' && e.name === 'structuring') return 1;
      return 0;
    };
    const report = solveAdversaryGame(detections, evasions, payoff, 500);
    expect(report.defenderMix.length).toBe(2);
    expect(report.attackerMix.length).toBe(2);
    // In this symmetric game, expected payoff is ~0.5.
    expect(report.expectedPayoff).toBeGreaterThan(0.3);
    expect(report.expectedPayoff).toBeLessThan(0.7);
  });

  it('empty strategy set returns zero report', () => {
    const report = solveAdversaryGame([], [], () => 0);
    expect(report.iterations).toBe(0);
  });

  it('identifies top choices', () => {
    const report = solveAdversaryGame(
      [{ name: 'a', cost: 1 }, { name: 'b', cost: 1 }],
      [{ name: 'x', cost: 1 }],
      (d) => (d.name === 'a' ? 10 : 0),
      100
    );
    expect(report.topDefenderChoice).toBe('a');
  });
});

// ---------------------------------------------------------------------------
// #94 crossScriptNameMatcher
// ---------------------------------------------------------------------------

describe('crossScriptNameMatcher', () => {
  it('detects Arabic script', () => {
    expect(detectScript('محمد')).toBe('arabic');
  });

  it('detects Cyrillic script', () => {
    expect(detectScript('Владимир')).toBe('cyrillic');
  });

  it('detects Latin for plain ASCII', () => {
    expect(detectScript('John Smith')).toBe('latin');
  });

  it('detects Hanzi for CJK characters', () => {
    expect(detectScript('王')).toBe('hanzi');
  });

  it('transliterates Cyrillic to Latin', () => {
    const { normalised, script } = normaliseToLatin('Владимир');
    expect(script).toBe('cyrillic');
    expect(normalised).toContain('vladimir');
  });

  it('transliterates Arabic to Latin', () => {
    const { normalised, script } = normaliseToLatin('محمد');
    expect(script).toBe('arabic');
    expect(normalised.length).toBeGreaterThan(0);
  });

  it('crossScriptCompare matches Cyrillic to Latin transliteration', () => {
    const match = crossScriptCompare('Владимир', 'Vladimir', 0.7);
    expect(match.match).toBe(true);
    expect(match.similarity).toBeGreaterThan(0.7);
  });

  it('unrelated names do not match', () => {
    const match = crossScriptCompare('Alice', 'Bob');
    expect(match.match).toBe(false);
  });

  it('Latin-Latin identical match', () => {
    const match = crossScriptCompare('John Smith', 'john smith');
    expect(match.similarity).toBe(1);
    expect(match.match).toBe(true);
  });
});
