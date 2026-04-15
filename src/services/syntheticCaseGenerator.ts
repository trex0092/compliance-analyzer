/**
 * Synthetic Case Generator — produces realistic-looking but FAKE
 * compliance cases for the adversarial fuzzer + brain training +
 * MLRO drill scenarios.
 *
 * Why this exists:
 *   The adversarialFuzzer needs probe inputs. The training pipeline
 *   wants edge cases. MLRO drills want realistic but disposable
 *   exam material. Hand-crafting these is slow and biased toward
 *   the cases the operator can imagine.
 *
 *   This module produces deterministic synthetic StrFeatures vectors
 *   sampled from one of N "personas" (clean retail, structuring
 *   smurfer, sanctions-flagged corp, PEP, mule, high-cash gold
 *   buyer, etc.). The same seed always produces the same case so
 *   tests are reproducible.
 *
 *   Pure function. No I/O. No randomness without a seed.
 *
 * Regulatory basis:
 *   FATF Rec 1               (risk-based approach validation)
 *   FATF Rec 20              (typology testing)
 *   NIST AI RMF 1.0 MEASURE-4 (validation + test data)
 *   EU AI Act Art.15         (accuracy + robustness via red-team)
 *
 * Safety: synthetic cases are CLEARLY MARKED with the `synthetic: true`
 * flag and a `personaId` so they cannot accidentally be mistaken for
 * real customer data in downstream stores.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PersonaId =
  | 'clean_retail'
  | 'high_cash_gold_buyer'
  | 'structuring_smurfer'
  | 'sanctions_flagged_corp'
  | 'pep_high_risk'
  | 'mule_account'
  | 'cross_border_velocity'
  | 'shell_company'
  | 'adverse_media_subject';

export interface SyntheticCase {
  id: string;
  synthetic: true;
  personaId: PersonaId;
  features: Record<string, number>;
  expectedVerdict: 'pass' | 'flag' | 'escalate' | 'freeze';
  notes: string;
}

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32 — small, deterministic, well-distributed)
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

function jitter(rng: () => number, base: number, pct: number): number {
  return base * (1 + (rng() * 2 - 1) * pct);
}

// ---------------------------------------------------------------------------
// Persona templates
// ---------------------------------------------------------------------------

const PERSONAS: Readonly<Record<PersonaId, (rng: () => number) => Omit<SyntheticCase, 'id' | 'synthetic'>>> = {
  clean_retail: (rng) => ({
    personaId: 'clean_retail',
    features: {
      priorAlerts90d: 0,
      txValue30dAED: jitter(rng, 12_000, 0.4),
      nearThresholdCount30d: 0,
      crossBorderRatio30d: jitter(rng, 0.05, 0.5),
      isPep: 0,
      highRiskJurisdiction: 0,
      hasAdverseMedia: 0,
      daysSinceOnboarding: jitter(rng, 800, 0.3),
      sanctionsMatchScore: 0,
      cashRatio30d: jitter(rng, 0.2, 0.4),
    },
    expectedVerdict: 'pass',
    notes: 'Stable retail customer with low cash ratio and no flags.',
  }),

  high_cash_gold_buyer: (rng) => ({
    personaId: 'high_cash_gold_buyer',
    features: {
      priorAlerts90d: 1,
      txValue30dAED: jitter(rng, 70_000, 0.2),
      nearThresholdCount30d: 0,
      crossBorderRatio30d: 0.1,
      isPep: 0,
      highRiskJurisdiction: 0,
      hasAdverseMedia: 0,
      daysSinceOnboarding: 200,
      sanctionsMatchScore: 0,
      cashRatio30d: 0.95,
    },
    expectedVerdict: 'flag',
    notes: 'High-cash DPMS gold purchase above AED 55K CTR threshold.',
  }),

  structuring_smurfer: (rng) => ({
    personaId: 'structuring_smurfer',
    features: {
      priorAlerts90d: 2,
      txValue30dAED: jitter(rng, 45_000, 0.1),
      nearThresholdCount30d: 8,
      crossBorderRatio30d: 0.3,
      isPep: 0,
      highRiskJurisdiction: 0,
      hasAdverseMedia: 0,
      daysSinceOnboarding: 90,
      sanctionsMatchScore: 0,
      cashRatio30d: 0.85,
    },
    expectedVerdict: 'escalate',
    notes: 'Multiple near-threshold transactions — classic smurfing.',
  }),

  sanctions_flagged_corp: () => ({
    personaId: 'sanctions_flagged_corp',
    features: {
      priorAlerts90d: 0,
      txValue30dAED: 250_000,
      nearThresholdCount30d: 0,
      crossBorderRatio30d: 0.6,
      isPep: 0,
      highRiskJurisdiction: 1,
      hasAdverseMedia: 1,
      daysSinceOnboarding: 30,
      sanctionsMatchScore: 0.92,
      cashRatio30d: 0.4,
    },
    expectedVerdict: 'freeze',
    notes: 'Confirmed sanctions match — 24h freeze + CNMR.',
  }),

  pep_high_risk: () => ({
    personaId: 'pep_high_risk',
    features: {
      priorAlerts90d: 0,
      txValue30dAED: 180_000,
      nearThresholdCount30d: 0,
      crossBorderRatio30d: 0.5,
      isPep: 1,
      highRiskJurisdiction: 1,
      hasAdverseMedia: 0,
      daysSinceOnboarding: 60,
      sanctionsMatchScore: 0,
      cashRatio30d: 0.3,
    },
    expectedVerdict: 'escalate',
    notes: 'PEP customer in high-risk jurisdiction — EDD required.',
  }),

  mule_account: (rng) => ({
    personaId: 'mule_account',
    features: {
      priorAlerts90d: 1,
      txValue30dAED: jitter(rng, 95_000, 0.2),
      nearThresholdCount30d: 0,
      crossBorderRatio30d: 0.85,
      isPep: 0,
      highRiskJurisdiction: 1,
      hasAdverseMedia: 0,
      daysSinceOnboarding: 25,
      sanctionsMatchScore: 0,
      cashRatio30d: 0.1,
    },
    expectedVerdict: 'escalate',
    notes: 'Newly opened account with high-velocity outbound transfers.',
  }),

  cross_border_velocity: (rng) => ({
    personaId: 'cross_border_velocity',
    features: {
      priorAlerts90d: 0,
      txValue30dAED: jitter(rng, 150_000, 0.3),
      nearThresholdCount30d: 0,
      crossBorderRatio30d: 0.95,
      isPep: 0,
      highRiskJurisdiction: 1,
      hasAdverseMedia: 0,
      daysSinceOnboarding: 400,
      sanctionsMatchScore: 0,
      cashRatio30d: 0.2,
    },
    expectedVerdict: 'flag',
    notes: 'Almost-all-cross-border activity in high-risk jurisdiction.',
  }),

  shell_company: () => ({
    personaId: 'shell_company',
    features: {
      priorAlerts90d: 0,
      txValue30dAED: 320_000,
      nearThresholdCount30d: 0,
      crossBorderRatio30d: 0.7,
      isPep: 0,
      highRiskJurisdiction: 1,
      hasAdverseMedia: 1,
      daysSinceOnboarding: 15,
      sanctionsMatchScore: 0,
      cashRatio30d: 0.4,
    },
    expectedVerdict: 'escalate',
    notes: 'Newly incorporated entity with adverse media — UBO chain unclear.',
  }),

  adverse_media_subject: () => ({
    personaId: 'adverse_media_subject',
    features: {
      priorAlerts90d: 0,
      txValue30dAED: 80_000,
      nearThresholdCount30d: 0,
      crossBorderRatio30d: 0.3,
      isPep: 0,
      highRiskJurisdiction: 0,
      hasAdverseMedia: 1,
      daysSinceOnboarding: 500,
      sanctionsMatchScore: 0.3,
      cashRatio30d: 0.3,
    },
    expectedVerdict: 'flag',
    notes: 'Adverse media + soft sanctions hit — manual review required.',
  }),
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generateCase(personaId: PersonaId, seed: number): SyntheticCase {
  const rng = mulberry32(seed);
  const tpl = PERSONAS[personaId](rng);
  return {
    id: `synthetic:${personaId}:${seed}`,
    synthetic: true,
    ...tpl,
  };
}

export interface BatchOptions {
  /** How many cases per persona. Default 5. */
  perPersona?: number;
  /** Starting seed. Default 1. */
  seedStart?: number;
}

export function generateBatch(opts: BatchOptions = {}): SyntheticCase[] {
  const perPersona = opts.perPersona ?? 5;
  let seed = opts.seedStart ?? 1;
  const out: SyntheticCase[] = [];
  for (const personaId of Object.keys(PERSONAS) as PersonaId[]) {
    for (let i = 0; i < perPersona; i++) {
      out.push(generateCase(personaId, seed++));
    }
  }
  return out;
}

export const PERSONA_IDS = Object.keys(PERSONAS) as PersonaId[];

// Exports for tests.
export const __test__ = { mulberry32, jitter, PERSONAS };
