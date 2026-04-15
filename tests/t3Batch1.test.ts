/**
 * Tier 3 batch 1 tests — case clusterer + SLA breach predictor +
 * goAML schema validator + synthetic case generator.
 */
import { describe, it, expect } from 'vitest';

import { clusterCases, type CaseSummary } from '../src/services/caseClusterer';
import {
  predictSlaBreaches,
  type OpenTaskSnapshot,
} from '../src/services/slaBreachPredictor';
import { validateGoamlXml } from '../src/services/goamlSchemaValidator';
import {
  generateCase,
  generateBatch,
  PERSONA_IDS,
} from '../src/services/syntheticCaseGenerator';

// ---------------------------------------------------------------------------
// caseClusterer
// ---------------------------------------------------------------------------

describe('clusterCases', () => {
  function makeCase(id: string, features: Record<string, number>): CaseSummary {
    return {
      id,
      tenantId: 'tenant-a',
      verdict: 'escalate',
      confidence: 0.8,
      features,
      topFactors: ['txValue30dAED', 'cashRatio30d'],
    };
  }

  it('groups identical cases into a cluster', () => {
    const cases = [
      makeCase('a', { txValue30dAED: 80_000, cashRatio30d: 0.8 }),
      makeCase('b', { txValue30dAED: 80_000, cashRatio30d: 0.8 }),
      makeCase('c', { txValue30dAED: 80_000, cashRatio30d: 0.8 }),
    ];
    const r = clusterCases(cases);
    expect(r.clusters.length).toBe(1);
    expect(r.clusters[0]!.caseIds.length).toBe(3);
  });

  it('does not cross-cluster different verdicts', () => {
    const cases: CaseSummary[] = [
      { ...makeCase('a', { x: 1 }), verdict: 'flag' },
      { ...makeCase('b', { x: 1 }), verdict: 'freeze' },
    ];
    const r = clusterCases(cases);
    expect(r.clusters.length).toBe(0);
    expect(r.singletons.length).toBe(2);
  });

  it('respects minSimilarity', () => {
    const cases = [
      makeCase('a', { x: 100, y: 0 }),
      makeCase('b', { x: 0, y: 100 }),
    ];
    const r = clusterCases(cases, { minSimilarity: 0.99 });
    expect(r.clusters.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// slaBreachPredictor
// ---------------------------------------------------------------------------

describe('predictSlaBreaches', () => {
  function makeTask(elapsedHours: number, slaHours: number): OpenTaskSnapshot {
    const now = new Date('2026-04-15T12:00:00Z').getTime();
    const entered = new Date(now - elapsedHours * 3_600_000).toISOString();
    return {
      taskGid: 'task-1',
      tenantId: 'tenant-a',
      section: 'EOCN Freeze Required',
      enteredSectionAtIso: entered,
      slaHours,
      slaKind: 'regulatory',
      citation: 'Cabinet Res 74/2020 Art.4',
    };
  }

  const now = () => new Date('2026-04-15T12:00:00Z');

  it('flags already_breached when elapsed > sla', () => {
    const r = predictSlaBreaches([makeTask(25, 24)], { now });
    expect(r.predictions[0]!.prediction).toBe('already_breached');
  });

  it('flags will_breach when projected > sla within horizon', () => {
    const r = predictSlaBreaches([makeTask(22, 24)], { horizonHours: 4, now });
    expect(r.predictions[0]!.prediction).toBe('will_breach');
  });

  it('flags at_risk when projected ≥ 75% but not breaching', () => {
    const r = predictSlaBreaches([makeTask(15, 24)], { horizonHours: 4, now });
    expect(r.predictions[0]!.prediction).toBe('at_risk');
  });

  it('flags safe when projected well below 75%', () => {
    const r = predictSlaBreaches([makeTask(2, 24)], { horizonHours: 4, now });
    expect(r.predictions[0]!.prediction).toBe('safe');
  });

  it('sorts already_breached first', () => {
    const r = predictSlaBreaches(
      [
        { ...makeTask(2, 24), taskGid: 'safe' },
        { ...makeTask(25, 24), taskGid: 'breached' },
      ],
      { now }
    );
    expect(r.predictions[0]!.taskGid).toBe('breached');
  });
});

// ---------------------------------------------------------------------------
// goamlSchemaValidator
// ---------------------------------------------------------------------------

describe('validateGoamlXml', () => {
  const validStr = `
    <report>
      <rentity_id>RE-1</rentity_id>
      <submission_code>STR-001</submission_code>
      <report_code>STR</report_code>
      <submission_date>15/04/2026</submission_date>
      <currency_code_local>AED</currency_code_local>
      <reporting_person>MLRO-1</reporting_person>
      <reason>Suspicion arose from feature analysis. Filing per FDL.</reason>
      <transaction>
        <amount_local>65000</amount_local>
        <country_code>AE</country_code>
      </transaction>
    </report>
  `;

  it('validates a complete STR payload', () => {
    const r = validateGoamlXml(validStr);
    expect(r.ok).toBe(true);
    expect(r.reportType).toBe('STR');
    expect(r.errorCount).toBe(0);
  });

  it('rejects empty payload', () => {
    const r = validateGoamlXml('');
    expect(r.ok).toBe(false);
  });

  it('rejects missing report_code', () => {
    const r = validateGoamlXml('<report></report>');
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.code === 'GOAML-002')).toBe(true);
  });

  it('rejects missing required element', () => {
    const broken = validStr.replace(/<rentity_id>.*?<\/rentity_id>/, '');
    const r = validateGoamlXml(broken);
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.code === 'GOAML-010')).toBe(true);
  });

  it('rejects malformed submission_date', () => {
    const broken = validStr.replace('15/04/2026', '2026-04-15');
    const r = validateGoamlXml(broken);
    expect(r.findings.some((f) => f.code === 'GOAML-020')).toBe(true);
  });

  it('warns on bad currency code', () => {
    const broken = validStr.replace('AED', 'aed1');
    const r = validateGoamlXml(broken);
    expect(r.findings.some((f) => f.code === 'GOAML-021')).toBe(true);
  });

  it('warns on bad country code', () => {
    const broken = validStr.replace('<country_code>AE</country_code>', '<country_code>XYZ</country_code>');
    const r = validateGoamlXml(broken);
    expect(r.findings.some((f) => f.code === 'GOAML-022')).toBe(true);
  });

  it('rejects negative amount', () => {
    const broken = validStr.replace('65000', '-1');
    const r = validateGoamlXml(broken);
    expect(r.findings.some((f) => f.code === 'GOAML-030')).toBe(true);
  });

  it('rejects subject-directed tipping-off in <reason>', () => {
    const broken = validStr.replace(
      '<reason>Suspicion arose from feature analysis. Filing per FDL.</reason>',
      '<reason>Your account has been frozen due to a sanctions match.</reason>'
    );
    const r = validateGoamlXml(broken);
    expect(r.findings.some((f) => f.code === 'GOAML-040')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// syntheticCaseGenerator
// ---------------------------------------------------------------------------

describe('syntheticCaseGenerator', () => {
  it('generateCase is deterministic on (persona, seed)', () => {
    const a = generateCase('clean_retail', 42);
    const b = generateCase('clean_retail', 42);
    expect(a).toEqual(b);
  });

  it('generateBatch covers every persona', () => {
    const batch = generateBatch({ perPersona: 1 });
    expect(batch.length).toBe(PERSONA_IDS.length);
    for (const id of PERSONA_IDS) {
      expect(batch.find((c) => c.personaId === id)).toBeDefined();
    }
  });

  it('every case is marked synthetic:true', () => {
    const batch = generateBatch({ perPersona: 1 });
    for (const c of batch) {
      expect(c.synthetic).toBe(true);
      expect(c.id.startsWith('synthetic:')).toBe(true);
    }
  });

  it('expected verdicts span every band', () => {
    const batch = generateBatch({ perPersona: 1 });
    const verdicts = new Set(batch.map((c) => c.expectedVerdict));
    expect(verdicts.has('pass')).toBe(true);
    expect(verdicts.has('flag')).toBe(true);
    expect(verdicts.has('escalate')).toBe(true);
    expect(verdicts.has('freeze')).toBe(true);
  });
});
