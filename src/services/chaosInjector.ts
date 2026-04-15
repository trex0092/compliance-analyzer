/**
 * Chaos Injector — off-by-default rule engine for injecting faults
 * into brain and downstream subsystems during drills.
 *
 * Why this exists:
 *   The brain is tested on happy paths. Real life is:
 *     - Asana 503 for 90 seconds
 *     - Blob store 429 on a burst
 *     - Advisor proxy timeout
 *     - Drift watchdog reading stale data
 *
 *   Chaos testing is the only way to prove the brain degrades
 *   gracefully under these conditions. This module provides a
 *   deterministic rule engine: operators switch it on via an env
 *   var, declare which faults should fire + at what rate, and the
 *   affected subsystems consult the injector before every call.
 *
 *   Pure function layer. OFF BY DEFAULT. The env var `HAWKEYE_CHAOS_ENABLED`
 *   must be set to `true` for any rule to fire. This is a safety
 *   invariant — chaos testing never runs in production.
 *
 * Regulatory basis:
 *   NIST AI RMF 1.0 MEASURE-4 (continuous validation via drills)
 *   NIST AI RMF 1.0 MANAGE-3 (incident response readiness)
 *   EU AI Act Art.15         (robustness — validated via drills)
 *   ISO/IEC 27001 A.17       (business continuity)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FaultKind =
  | 'http_503'
  | 'http_429'
  | 'timeout'
  | 'blob_unavailable'
  | 'asana_dispatch_fail'
  | 'advisor_timeout';

export interface ChaosRule {
  id: string;
  /** Which subsystem this rule affects. */
  subsystem: 'asana' | 'blob-store' | 'advisor-proxy' | 'drift-watchdog' | 'sanctions-ingest';
  fault: FaultKind;
  /** Probability in [0, 1] that the fault fires per call. */
  probability: number;
  /** Plain-English reason for the chaos injection. */
  reason: string;
}

export interface ChaosState {
  enabled: boolean;
  rules: readonly ChaosRule[];
  /** Seed for the deterministic PRNG. Changing it replays a different stream. */
  seed: number;
  /** Per-subsystem hit count. */
  hits: Readonly<Record<ChaosRule['subsystem'], number>>;
}

export interface InjectionResult {
  fire: boolean;
  rule: ChaosRule | null;
  reason: string;
}

// ---------------------------------------------------------------------------
// Deterministic PRNG
// ---------------------------------------------------------------------------

/**
 * mulberry32 — same PRNG used by syntheticCaseGenerator. Keeps the
 * whole chaos stream deterministic per seed.
 */
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
// Public API
// ---------------------------------------------------------------------------

export function emptyChaosState(): ChaosState {
  return {
    enabled: false,
    rules: [],
    seed: 0,
    hits: {
      asana: 0,
      'blob-store': 0,
      'advisor-proxy': 0,
      'drift-watchdog': 0,
      'sanctions-ingest': 0,
    },
  };
}

export interface BuildStateInput {
  /** Raw value of HAWKEYE_CHAOS_ENABLED env var. */
  enabledRaw: string | undefined;
  rules: readonly ChaosRule[];
  seed: number;
}

export function buildChaosState(input: BuildStateInput): ChaosState {
  const enabled = input.enabledRaw === 'true' || input.enabledRaw === '1';
  return {
    ...emptyChaosState(),
    enabled,
    rules: input.rules,
    seed: input.seed,
  };
}

/**
 * Deterministic injection check. Takes a PRNG closure + a subsystem.
 * Returns whether a fault should fire and which rule. Pure with
 * respect to the PRNG closure — the caller must advance it through
 * a seeded sequence.
 */
export function shouldInject(
  state: ChaosState,
  subsystem: ChaosRule['subsystem'],
  rng: () => number
): InjectionResult {
  if (!state.enabled) {
    return { fire: false, rule: null, reason: 'chaos disabled' };
  }
  const applicableRules = state.rules.filter((r) => r.subsystem === subsystem);
  if (applicableRules.length === 0) {
    return { fire: false, rule: null, reason: `no rules for ${subsystem}` };
  }
  for (const rule of applicableRules) {
    const roll = rng();
    if (roll < rule.probability) {
      return { fire: true, rule, reason: rule.reason };
    }
  }
  return { fire: false, rule: null, reason: `all ${applicableRules.length} rule rolls missed` };
}

/**
 * Convenience driver: builds its own deterministic PRNG from the
 * state's seed + subsystem name, returning the injection result.
 * Used by tests and by production where we want a single function
 * call per injection.
 */
export function rollInjection(
  state: ChaosState,
  subsystem: ChaosRule['subsystem'],
  callIndex: number
): InjectionResult {
  // Mix the seed, subsystem, and call index into a deterministic stream.
  let subsystemHash = 0;
  for (let i = 0; i < subsystem.length; i++) {
    subsystemHash = (subsystemHash * 31 + subsystem.charCodeAt(i)) >>> 0;
  }
  const seed = (state.seed ^ subsystemHash ^ callIndex) >>> 0;
  const rng = mulberry32(seed);
  return shouldInject(state, subsystem, rng);
}

export interface FaultResponse {
  status: number;
  body: { error: string; chaos: true; ruleId: string };
}

/**
 * Turn a fired rule into an HTTP-style response the caller can
 * short-circuit with. Pure.
 */
export function faultResponseFor(rule: ChaosRule): FaultResponse {
  const statusByFault: Record<FaultKind, number> = {
    http_503: 503,
    http_429: 429,
    timeout: 504,
    blob_unavailable: 503,
    asana_dispatch_fail: 502,
    advisor_timeout: 504,
  };
  return {
    status: statusByFault[rule.fault] ?? 500,
    body: {
      error: `chaos:${rule.fault}`,
      chaos: true,
      ruleId: rule.id,
    },
  };
}

// Exports for tests.
export const __test__ = { mulberry32 };
