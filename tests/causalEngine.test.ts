import { describe, it, expect } from 'vitest';
import {
  createCausalGraph,
  simulate,
  runCounterfactual,
  averageTreatmentEffect,
  type CausalNode,
} from '@/services/causalEngine';

// Model:
//   pep ─┐
//        ├──→ highRisk ──→ edd ──→ strFiled
//   cash ┘                          ▲
//                                   │
//                      sanctionsHit ┘
const nodes: CausalNode[] = [
  { id: 'pep', equation: { kind: 'constant', value: 0 } },
  { id: 'cash', equation: { kind: 'constant', value: 0 } },
  { id: 'sanctionsHit', equation: { kind: 'constant', value: 0 } },
  { id: 'highRisk', equation: { kind: 'or', parents: ['pep', 'cash'] } },
  { id: 'edd', equation: { kind: 'copy', parent: 'highRisk' } },
  { id: 'strFiled', equation: { kind: 'or', parents: ['edd', 'sanctionsHit'] } },
];

describe('causalEngine — graph construction', () => {
  it('topologically sorts the nodes', () => {
    const g = createCausalGraph(nodes);
    expect(g.order.indexOf('highRisk')).toBeGreaterThan(g.order.indexOf('pep'));
    expect(g.order.indexOf('strFiled')).toBeGreaterThan(g.order.indexOf('edd'));
  });

  it('rejects cyclic graphs', () => {
    expect(() =>
      createCausalGraph([
        { id: 'a', equation: { kind: 'copy', parent: 'b' } },
        { id: 'b', equation: { kind: 'copy', parent: 'a' } },
      ]),
    ).toThrow(/cycle/);
  });
});

describe('causalEngine — simulation', () => {
  const graph = createCausalGraph(nodes);

  it('propagates root values forward', () => {
    const out = simulate(graph, { pep: 1, cash: 0, sanctionsHit: 0 });
    expect(out.highRisk).toBe(1);
    expect(out.edd).toBe(1);
    expect(out.strFiled).toBe(1);
  });

  it('intervention with do(edd=1) forces downstream', () => {
    const out = simulate(graph, { pep: 0, cash: 0, sanctionsHit: 0 }, { edd: 1 });
    expect(out.highRisk).toBe(0);
    expect(out.edd).toBe(1); // forced
    expect(out.strFiled).toBe(1);
  });
});

describe('causalEngine — counterfactual', () => {
  const graph = createCausalGraph(nodes);

  it('what if PEP had been 0 given factual world?', () => {
    const result = runCounterfactual(graph, {
      observation: { pep: 1, cash: 0, sanctionsHit: 0 },
      intervention: { pep: 0 },
      target: 'strFiled',
    });
    expect(result.factual).toBe(1);
    expect(result.counterfactual).toBe(0);
    expect(result.change).toBe(true);
    expect(result.affectedNodes).toContain('highRisk');
    expect(result.affectedNodes).toContain('strFiled');
  });

  it('intervention does not affect strFiled when sanctionsHit still true', () => {
    const result = runCounterfactual(graph, {
      observation: { pep: 1, cash: 0, sanctionsHit: 1 },
      intervention: { pep: 0 },
      target: 'strFiled',
    });
    expect(result.factual).toBe(1);
    expect(result.counterfactual).toBe(1);
    expect(result.change).toBe(false);
  });
});

describe('causalEngine — ATE', () => {
  const graph = createCausalGraph(nodes);

  it('estimates average treatment effect of EDD on STR filings', () => {
    const dataset = [
      { pep: 1, cash: 0, sanctionsHit: 0 },
      { pep: 0, cash: 1, sanctionsHit: 0 },
      { pep: 0, cash: 0, sanctionsHit: 0 },
      { pep: 0, cash: 0, sanctionsHit: 1 },
    ];
    const ate = averageTreatmentEffect(graph, dataset, 'edd', 'strFiled');
    // treatment: 4 files (100%) - untreated: pep row → STR via highRisk? No, edd=0 forces highRisk->edd->0.
    // Untreated STR filings = only sanctionsHit=1 row = 1/4 = 0.25
    // Treated STR filings = 4/4 = 1.0
    // ATE = 0.75
    expect(ate).toBeCloseTo(0.75);
  });
});
