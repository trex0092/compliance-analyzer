/**
 * Red-Team Adversarial Simulator.
 *
 * Synthesises compliance evasion scenarios and runs them through a
 * Detector to measure detection rate, false-negative patterns, and
 * time-to-flag. Think "pytest for the brain".
 *
 * Scenario catalogue (non-exhaustive, grows over time):
 *
 *  1. NAME_OBFUSCATION — Unicode homoglyphs, diacritic strip, transliteration
 *     variance, middle-name drop, reversed order.
 *  2. STRUCTURING      — Multiple sub-AED-55K transactions in 24h.
 *  3. CIRCULAR_TRADE   — A→B→C→A closing within N hops.
 *  4. ROUND_TRIPPING   — Re-import of own exports via free zone.
 *  5. NEW_ENTITY_HOP   — Newly formed shell entity inherits old sanctioned UBO.
 *  6. GOOD_DELIVERY_SWAP — LGD bar remelted into non-LGD to mask origin.
 *  7. VAULT_OVERDRAW   — Unallocated claim exceeds physical inventory.
 *  8. PEP_SHADOW       — Close associate of a PEP named in a trust document.
 *  9. CRYPTO_LAYER     — Fiat → stablecoin → mixer → fiat round-trip.
 * 10. DOCUMENT_FORGE   — Invoice dates inconsistent with metal assay.
 *
 * Each scenario is deterministic given a seed (RNG is internal), so the
 * simulator is reproducible — every red-team run can be re-executed
 * bit-for-bit for regulator review.
 *
 * Regulatory basis:
 *   - FATF DPMS Typologies 2022 (annex B)
 *   - FATF Trade-Based Money Laundering typology report 2020
 *   - UAE EOCN Public Advisory 02/2023 on DPMS evasion patterns
 */

import { createChain, addNode, addEdge, seal, type ReasoningChain } from './reasoningChain';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScenarioKind =
  | 'name_obfuscation'
  | 'structuring'
  | 'circular_trade'
  | 'round_tripping'
  | 'new_entity_hop'
  | 'good_delivery_swap'
  | 'vault_overdraw'
  | 'pep_shadow'
  | 'crypto_layer'
  | 'document_forge';

export interface RedTeamScenario {
  id: string;
  kind: ScenarioKind;
  description: string;
  /** Payload the brain would see — opaque to the simulator. */
  payload: Record<string, unknown>;
  /** The regulatory article this scenario is meant to exercise. */
  regulatory: string;
  /** Expected verdict for a perfect detector. */
  expected: 'flag' | 'escalate' | 'freeze';
  /** Difficulty in [1, 5]. Higher = harder to detect. */
  difficulty: 1 | 2 | 3 | 4 | 5;
}

export interface DetectorResult {
  verdict: 'pass' | 'flag' | 'escalate' | 'freeze';
  confidence: number;
  rationale?: string;
}

export type Detector = (scenario: RedTeamScenario) => Promise<DetectorResult> | DetectorResult;

export interface ScenarioRun {
  scenario: RedTeamScenario;
  detected: boolean;
  result: DetectorResult;
  durationMs: number;
}

export interface RedTeamReport {
  total: number;
  detected: number;
  detectionRate: number;
  byKind: Record<string, { total: number; detected: number; rate: number }>;
  byDifficulty: Record<number, { total: number; detected: number; rate: number }>;
  runs: ScenarioRun[];
  chain: ReasoningChain;
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (Mulberry32)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Scenario generators
// ---------------------------------------------------------------------------

const NAME_POOL = [
  'Mohammed Al-Kindi',
  'Khalid bin Rashid',
  'Faisal Al-Nahyan',
  'Abdul Aziz Hamad',
];

const HOMOGLYPH_MAP: Record<string, string> = {
  a: '\u0430', // Cyrillic a
  e: '\u0435',
  o: '\u043e',
  p: '\u0440',
  c: '\u0441',
  y: '\u0443',
};

function obfuscateName(name: string, mode: number): string {
  if (mode === 0) return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (mode === 1) return name.split(' ').reverse().join(' ');
  if (mode === 2)
    return name
      .split('')
      .map((ch) => HOMOGLYPH_MAP[ch.toLowerCase()] ?? ch)
      .join('');
  return name.replace(/-/g, ' ').replace(/\s+/g, ' ');
}

export function generateScenarios(seed: number, count: number): RedTeamScenario[] {
  const rand = mulberry32(seed);
  const out: RedTeamScenario[] = [];
  const kinds: ScenarioKind[] = [
    'name_obfuscation',
    'structuring',
    'circular_trade',
    'round_tripping',
    'new_entity_hop',
    'good_delivery_swap',
    'vault_overdraw',
    'pep_shadow',
    'crypto_layer',
    'document_forge',
  ];

  for (let i = 0; i < count; i++) {
    const kind = kinds[Math.floor(rand() * kinds.length)];
    const id = `rt-${seed}-${i}`;
    out.push(buildScenario(id, kind, rand));
  }
  return out;
}

function buildScenario(
  id: string,
  kind: ScenarioKind,
  rand: () => number,
): RedTeamScenario {
  switch (kind) {
    case 'name_obfuscation': {
      const base = NAME_POOL[Math.floor(rand() * NAME_POOL.length)];
      const mode = Math.floor(rand() * 4);
      const obf = obfuscateName(base, mode);
      return {
        id,
        kind,
        description: `Obfuscated sanctioned name (mode ${mode})`,
        payload: { original: base, screened: obf, mode },
        regulatory: 'FDL Art.22; FATF Rec 6',
        expected: 'freeze',
        difficulty: mode === 2 ? 5 : mode === 1 ? 3 : 2,
      };
    }
    case 'structuring': {
      const count = 3 + Math.floor(rand() * 4);
      const amounts = Array.from({ length: count }, () =>
        Math.round(40_000 + rand() * 14_000),
      );
      return {
        id,
        kind,
        description: 'Structuring below AED 55K DPMS threshold',
        payload: { amounts, windowHours: 24 },
        regulatory: 'MoE Circular 08/AML/2021',
        expected: 'flag',
        difficulty: 3,
      };
    }
    case 'circular_trade': {
      return {
        id,
        kind,
        description: 'A→B→C→A round-trip within 48h',
        payload: {
          legs: [
            { from: 'A', to: 'B', amount: 120_000 },
            { from: 'B', to: 'C', amount: 119_500 },
            { from: 'C', to: 'A', amount: 119_000 },
          ],
        },
        regulatory: 'FATF TBML typology 2020',
        expected: 'escalate',
        difficulty: 4,
      };
    }
    case 'round_tripping': {
      return {
        id,
        kind,
        description: 'Export to free zone then re-import with markup',
        payload: { exportValue: 1_000_000, reimportValue: 1_150_000, zone: 'DMCC' },
        regulatory: 'Cabinet Res 134/2025 Art.16',
        expected: 'flag',
        difficulty: 4,
      };
    }
    case 'new_entity_hop': {
      return {
        id,
        kind,
        description: 'Newly formed entity with sanctioned UBO',
        payload: {
          entityAgeDays: 12,
          uboSanctionsStatus: 'match',
          registeredIn: 'JAFZA',
        },
        regulatory: 'Cabinet Decision 109/2023; FDL Art.12',
        expected: 'freeze',
        difficulty: 2,
      };
    }
    case 'good_delivery_swap': {
      return {
        id,
        kind,
        description: 'LGD bar remelted into non-LGD ingot',
        payload: { inputKey: 'PAMP|ABC123', outputRefiner: 'UNKNOWN', lossPct: 1.5 },
        regulatory: 'LBMA RGG v9; Dubai Good Delivery',
        expected: 'escalate',
        difficulty: 5,
      };
    }
    case 'vault_overdraw': {
      return {
        id,
        kind,
        description: 'Unallocated claim exceeds physical inventory',
        payload: { physicalGrams: 10_000, unallocatedClaims: 11_500 },
        regulatory: 'LBMA Vault Operator Code of Conduct',
        expected: 'freeze',
        difficulty: 2,
      };
    }
    case 'pep_shadow': {
      return {
        id,
        kind,
        description: 'Close associate of PEP via trust',
        payload: { pep: 'X', associate: 'Y', relation: 'trustee' },
        regulatory: 'Cabinet Res 134/2025 Art.14; FATF Rec 12',
        expected: 'escalate',
        difficulty: 4,
      };
    }
    case 'crypto_layer': {
      return {
        id,
        kind,
        description: 'Fiat → USDT → mixer → fiat round-trip',
        payload: {
          fiatIn: 500_000,
          hops: ['USDT@TRX', 'Tornado', 'USDT@ETH', 'fiat-out'],
        },
        regulatory: 'FATF Rec 15; Central Bank VASP rules 2023',
        expected: 'escalate',
        difficulty: 4,
      };
    }
    case 'document_forge': {
      return {
        id,
        kind,
        description: 'Invoice date inconsistent with assay certificate',
        payload: { invoiceDate: '2026-03-01', assayDate: '2026-04-09' },
        regulatory: 'FATF Rec 10; LBMA RGG v9',
        expected: 'flag',
        difficulty: 3,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runRedTeam(
  scenarios: readonly RedTeamScenario[],
  detector: Detector,
): Promise<RedTeamReport> {
  const runs: ScenarioRun[] = [];
  const chain = createChain('red-team-run');
  addNode(chain, { id: 'root', type: 'event', label: 'red-team start', weight: 1 });

  for (const scenario of scenarios) {
    const start = Date.now();
    let result: DetectorResult;
    try {
      result = await detector(scenario);
    } catch (err) {
      result = {
        verdict: 'pass',
        confidence: 0,
        rationale: err instanceof Error ? err.message : String(err),
      };
    }
    const durationMs = Date.now() - start;
    const detected = verdictMeetsExpectation(result.verdict, scenario.expected);
    runs.push({ scenario, detected, result, durationMs });

    const nodeId = `s-${scenario.id}`;
    addNode(chain, {
      id: nodeId,
      type: 'evidence',
      label: `${scenario.kind} → ${result.verdict}`,
      weight: detected ? 1 : 0.1,
      regulatory: scenario.regulatory,
      data: { detected, confidence: result.confidence },
    });
    addEdge(chain, {
      fromId: 'root',
      toId: nodeId,
      relation: detected ? 'supports' : 'contradicts',
      weight: detected ? 1 : 0.1,
    });
  }

  seal(chain);

  const detected = runs.filter((r) => r.detected).length;
  const byKind: RedTeamReport['byKind'] = {};
  const byDifficulty: RedTeamReport['byDifficulty'] = {};
  for (const run of runs) {
    const k = run.scenario.kind;
    byKind[k] ??= { total: 0, detected: 0, rate: 0 };
    byKind[k].total += 1;
    if (run.detected) byKind[k].detected += 1;

    const d = run.scenario.difficulty;
    byDifficulty[d] ??= { total: 0, detected: 0, rate: 0 };
    byDifficulty[d].total += 1;
    if (run.detected) byDifficulty[d].detected += 1;
  }
  for (const bucket of Object.values(byKind)) {
    bucket.rate = bucket.total === 0 ? 0 : bucket.detected / bucket.total;
  }
  for (const bucket of Object.values(byDifficulty)) {
    bucket.rate = bucket.total === 0 ? 0 : bucket.detected / bucket.total;
  }

  return {
    total: runs.length,
    detected,
    detectionRate: runs.length === 0 ? 0 : detected / runs.length,
    byKind,
    byDifficulty,
    runs,
    chain,
  };
}

function verdictMeetsExpectation(
  actual: DetectorResult['verdict'],
  expected: RedTeamScenario['expected'],
): boolean {
  // Detection severity ordering — a stronger verdict than expected still counts.
  const rank = { pass: 0, flag: 1, escalate: 2, freeze: 3 } as const;
  return rank[actual] >= rank[expected];
}
