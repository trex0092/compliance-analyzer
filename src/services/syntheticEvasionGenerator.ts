/**
 * Synthetic Evasion Generator — subsystem #66 (Phase 7 Cluster H).
 *
 * Generates deterministic synthetic adversarial compliance cases —
 * "what would a sanctions evader look like?" — to stress-test the
 * brain nightly. Each generated case is a realistic-looking but
 * non-trivial-to-detect scenario drawn from known FATF / EOCN /
 * OFAC typologies.
 *
 * Deterministic: same seed → same cases. This lets the golden-case
 * suite layer synthetic adversarial fixtures on top without flake.
 *
 * Regulatory basis:
 *   - FATF Rec 1 (risk-based approach with ongoing testing)
 *   - NIST AI RMF MS-1.1 (test with adversarial inputs)
 *   - EU AI Act Art.15 (accuracy + robustness testing)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyntheticCase {
  id: string;
  typology: string;
  expectedVerdict: 'pass' | 'flag' | 'escalate' | 'freeze';
  summary: string;
  signals: {
    sanctionsMatchScore?: number;
    uboUndisclosedPct?: number;
    hasSanctionedUbo?: boolean;
    confirmedWalletHits?: number;
    structuringSeverity?: 'low' | 'medium' | 'high';
    adverseMediaCriticalCount?: number;
    nearThresholdCount?: number;
    intermediaryCount?: number;
  };
}

export interface GenerateConfig {
  seed?: number;
  count?: number;
  typologyWhitelist?: readonly string[];
}

// ---------------------------------------------------------------------------
// Seeded PRNG
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Typology templates
// ---------------------------------------------------------------------------

interface TypologyTemplate {
  id: string;
  expectedVerdict: SyntheticCase['expectedVerdict'];
  buildSignals: (rand: () => number) => SyntheticCase['signals'];
  summaryTemplate: string;
}

const TYPOLOGIES: readonly TypologyTemplate[] = [
  {
    id: 'T-SUBSTAR',
    expectedVerdict: 'escalate',
    buildSignals: (r) => ({
      nearThresholdCount: Math.floor(5 + r() * 10),
      structuringSeverity: 'high',
      intermediaryCount: Math.floor(2 + r() * 3),
    }),
    summaryTemplate: 'Sub-threshold structuring: repeated AED 52K cash deposits across short window.',
  },
  {
    id: 'T-SHELLFRONT',
    expectedVerdict: 'freeze',
    buildSignals: (r) => ({
      hasSanctionedUbo: true,
      intermediaryCount: Math.floor(3 + r() * 5),
      uboUndisclosedPct: 30 + Math.floor(r() * 40),
    }),
    summaryTemplate: 'Shell-company front for sanctioned UBO; multiple layering intermediaries.',
  },
  {
    id: 'T-VASPCHAIN',
    expectedVerdict: 'escalate',
    buildSignals: (r) => ({
      confirmedWalletHits: Math.floor(r() * 2),
      intermediaryCount: Math.floor(4 + r() * 4),
    }),
    summaryTemplate: 'VASP chain-hopping through high-risk jurisdictions.',
  },
  {
    id: 'T-ADMEDIA',
    expectedVerdict: 'escalate',
    buildSignals: (r) => ({
      adverseMediaCriticalCount: Math.max(1, Math.floor(r() * 3)),
    }),
    summaryTemplate: 'Critical adverse media coverage on UBO.',
  },
  {
    id: 'T-HIGHSANCTIONS',
    expectedVerdict: 'freeze',
    buildSignals: (r) => ({
      sanctionsMatchScore: 0.9 + r() * 0.1,
      hasSanctionedUbo: true,
    }),
    summaryTemplate: 'High-confidence sanctions match on registered beneficial owner.',
  },
  {
    id: 'T-UNDISCLOSED',
    expectedVerdict: 'escalate',
    buildSignals: (r) => ({
      uboUndisclosedPct: 26 + Math.floor(r() * 40),
    }),
    summaryTemplate: 'Undisclosed ownership exceeding Cabinet Decision 109/2023 25% threshold.',
  },
  {
    id: 'T-CLEAN',
    expectedVerdict: 'pass',
    buildSignals: () => ({
      uboUndisclosedPct: 0,
      structuringSeverity: 'low',
      adverseMediaCriticalCount: 0,
    }),
    summaryTemplate: 'Clean routine retail transaction — control case for false-positive testing.',
  },
];

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export function generateSyntheticEvasionCases(
  config: GenerateConfig = {}
): SyntheticCase[] {
  const seed = config.seed ?? 42;
  const count = config.count ?? TYPOLOGIES.length * 3;
  const whitelist = config.typologyWhitelist;

  const pool = whitelist
    ? TYPOLOGIES.filter((t) => whitelist.includes(t.id))
    : TYPOLOGIES;
  if (pool.length === 0) return [];

  const rand = mulberry32(seed);
  const cases: SyntheticCase[] = [];

  for (let i = 0; i < count; i++) {
    const template = pool[i % pool.length];
    const signals = template.buildSignals(rand);
    cases.push({
      id: `SYN-${seed}-${i}`,
      typology: template.id,
      expectedVerdict: template.expectedVerdict,
      summary: template.summaryTemplate,
      signals,
    });
  }

  return cases;
}
