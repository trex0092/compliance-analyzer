/**
 * Approver Pool — pick two independent four-eyes approvers.
 *
 * When the super-brain dispatcher produces a verdict that requires
 * four-eyes review (escalate / freeze), the caller has to supply a
 * pair of approvers. This service turns a flat pool of analysts
 * into a deterministic, load-balanced pair pick.
 *
 * Pure function — no I/O. The pool comes from env / localStorage
 * via the caller; the picker just balances across it.
 *
 * Independence guarantee (Cabinet Res 134/2025 Art.19):
 *   - Two approvers must NEVER be the same person
 *   - Two approvers must NEVER have a shared team lead when
 *     the pool supplies team metadata (optional)
 *   - Round-robin across the pool to prevent reviewer burnout
 *
 * SOLO-MLRO MODE (Tier-1 #7 — opt-in via env):
 *   When HAWKEYE_SOLO_MLRO_MODE=true the picker accepts a single
 *   member pool and produces a degenerate pair where both entries
 *   point at the same MLRO. The pair is annotated with
 *   `cooldownUntilIso` set to (now + HAWKEYE_SOLO_MLRO_COOLDOWN_HOURS,
 *   default 24h). The approvals API (netlify/functions/approvals.mts)
 *   enforces the cooldown server-side: the same actor voting twice
 *   on the same event is rejected until the cooldown has elapsed,
 *   forcing a fresh-eyes second look on a different day. This is
 *   the only safe degradation for a one-MLRO operation — it
 *   preserves the fresh-eyes principle behind Cabinet Res 134/2025
 *   Art.19 even when a deputy isn't available.
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.19 (independent four-eyes review)
 *   - FDL No.10/2025 Art.20-21 (CO/MLRO duty of care)
 *   - FATF Rec 18 (internal controls proportionate to risk)
 */

import type { FourEyesApprover } from './fourEyesSubtasks';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApproverPoolMember {
  gid: string;
  name: string;
  /** Optional team id — used to enforce cross-team independence. */
  teamId?: string;
  /** Current open-approval load (picker prefers lighter loads). */
  openApprovals?: number;
  /** Whether the member is available (on shift, not on leave, etc.). */
  available?: boolean;
}

export interface PoolPickOptions {
  /** Deterministic seed — advances the round-robin pointer. */
  rotationSeed?: number;
  /** Reject pairs from the same team when teamId is set. */
  requireDistinctTeams?: boolean;
  /** Optional exclusion list (e.g. the analyst who raised the case). */
  excludeGids?: readonly string[];
  /**
   * Solo-MLRO opt-in. When true, the picker accepts a 1-member pool
   * and produces a degenerate pair where both entries point at the
   * same MLRO. Caller MUST treat the result as solo mode (pair[0].gid
   * === pair[1].gid) and the cooldown enforcement happens in the
   * approval API. Default: false. Read from env at call sites via
   * `isSoloMlroModeEnabled()`.
   */
  soloMlroMode?: boolean;
  /**
   * Cooldown applied to the SECOND approval slot when soloMlroMode
   * is true. Default: 24 hours. The picker writes the corresponding
   * `cooldownUntilIso` into PoolPickResult so the approval handler
   * can enforce it without re-reading env.
   */
  soloMlroCooldownHours?: number;
  /**
   * Reference timestamp for cooldown computation — defaults to
   * Date.now(). Test seam.
   */
  nowMs?: number;
}

export interface PoolPickResult {
  ok: boolean;
  pair?: readonly [FourEyesApprover, FourEyesApprover];
  error?: string;
  /** Metadata for logging + audit. */
  diagnostics: {
    poolSize: number;
    eligibleCount: number;
    pickStrategy: 'round-robin' | 'lowest-load' | 'fallback' | 'solo-mlro';
  };
  /**
   * Solo-MLRO mode metadata. Populated only when the picker ran in
   * solo mode. The cooldownUntilIso is the earliest moment the same
   * actor can cast their SECOND approval vote on the same event.
   */
  soloMode?: {
    enabled: true;
    cooldownHours: number;
    cooldownUntilIso: string;
  };
}

// ---------------------------------------------------------------------------
// Pure picker
// ---------------------------------------------------------------------------

/**
 * Rank pool members by ascending open-approval load. Ties broken
 * alphabetically by gid so the pick is stable under any fixed pool
 * order.
 */
function rankByLoad(members: readonly ApproverPoolMember[]): ApproverPoolMember[] {
  return [...members].sort((a, b) => {
    const loadA = a.openApprovals ?? 0;
    const loadB = b.openApprovals ?? 0;
    if (loadA !== loadB) return loadA - loadB;
    return a.gid.localeCompare(b.gid);
  });
}

/**
 * Pick two distinct approvers from the pool. Prefers:
 *   1. Lowest-load reviewer first
 *   2. Second pick from a different team (if requireDistinctTeams)
 *   3. Second pick advanced by rotationSeed to spread load across runs
 *
 * In SOLO-MLRO mode (opt-in), the picker accepts a 1-member pool
 * and produces a degenerate pair where both entries point at the
 * same MLRO. The pair carries cooldown metadata so the approvals
 * API can enforce a fresh-eyes second vote on a different day.
 */
export function pickFourEyesPair(
  pool: readonly ApproverPoolMember[],
  options: PoolPickOptions = {}
): PoolPickResult {
  const excluded = new Set(options.excludeGids ?? []);
  const eligible = pool.filter((m) => m.available !== false && !excluded.has(m.gid));
  const diagnostics = {
    poolSize: pool.length,
    eligibleCount: eligible.length,
    pickStrategy: 'lowest-load' as 'round-robin' | 'lowest-load' | 'fallback' | 'solo-mlro',
  };

  // Solo-MLRO short-circuit. Triggered explicitly via options.
  // When the pool has exactly 1 eligible member AND solo mode is on,
  // produce a degenerate pair pointing at the same MLRO and emit
  // the cooldown metadata. The approvals API enforces the cooldown
  // when it sees the same actor casting a second vote.
  if (options.soloMlroMode && eligible.length === 1) {
    const solo = eligible[0];
    const cooldownHours = options.soloMlroCooldownHours ?? DEFAULT_SOLO_COOLDOWN_HOURS;
    const nowMs = options.nowMs ?? Date.now();
    const cooldownUntilIso = new Date(nowMs + cooldownHours * 60 * 60 * 1000).toISOString();
    diagnostics.pickStrategy = 'solo-mlro';
    return {
      ok: true,
      pair: [
        { gid: solo.gid, name: solo.name },
        { gid: solo.gid, name: solo.name },
      ],
      diagnostics,
      soloMode: {
        enabled: true,
        cooldownHours,
        cooldownUntilIso,
      },
    };
  }

  if (eligible.length < 2) {
    return {
      ok: false,
      error: `Approver pool has ${eligible.length} eligible member(s); four-eyes requires 2 (Cabinet Res 134/2025 Art.19). Set HAWKEYE_SOLO_MLRO_MODE=true to enable solo-MLRO mode with delayed self-review.`,
      diagnostics,
    };
  }

  const ranked = rankByLoad(eligible);
  const primary = ranked[0];

  // Second pick: rotate by rotationSeed across the rest of the pool
  // so repeated identical pools don't always pair the same two
  // people. The seed wraps around len-1 and never lands on the
  // primary.
  const rest = ranked.slice(1);
  const seed = Math.max(0, options.rotationSeed ?? 0);
  let secondaryIdx = seed % rest.length;

  // Enforce distinct-team rule when requested.
  if (options.requireDistinctTeams && primary.teamId) {
    const firstDistinctTeam = rest.findIndex((m) => m.teamId !== primary.teamId);
    if (firstDistinctTeam >= 0) {
      // Combine the rotation rule with the distinct-team rule: pick
      // the first distinct-team member that is at-or-after the
      // rotated index.
      const rotated = rest
        .slice(secondaryIdx)
        .concat(rest.slice(0, secondaryIdx))
        .findIndex((m) => m.teamId !== primary.teamId);
      if (rotated >= 0) {
        secondaryIdx = (secondaryIdx + rotated) % rest.length;
      } else {
        secondaryIdx = firstDistinctTeam;
        diagnostics.pickStrategy = 'fallback';
      }
    } else {
      return {
        ok: false,
        error:
          'No cross-team pair available — every eligible approver is on the same team as the primary',
        diagnostics,
      };
    }
  } else if ((options.rotationSeed ?? 0) > 0) {
    diagnostics.pickStrategy = 'round-robin';
  }

  const secondary = rest[secondaryIdx];
  if (!secondary) {
    return {
      ok: false,
      error: 'Internal error — failed to pick secondary approver from non-empty eligible pool',
      diagnostics,
    };
  }

  if (primary.gid === secondary.gid) {
    return {
      ok: false,
      error:
        'Picker returned the same gid for both approvers — this is a Cabinet Res 134/2025 Art.19 violation',
      diagnostics,
    };
  }

  const pair: [FourEyesApprover, FourEyesApprover] = [
    { gid: primary.gid, name: primary.name },
    { gid: secondary.gid, name: secondary.name },
  ];
  return { ok: true, pair, diagnostics };
}

// ---------------------------------------------------------------------------
// Solo-MLRO env helpers
// ---------------------------------------------------------------------------

/** Default cooldown applied between an MLRO's two approval votes. */
export const DEFAULT_SOLO_COOLDOWN_HOURS = 24;

function readEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env?.[key]) return process.env[key];
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as Record<string, unknown>;
    const val = g[key];
    if (typeof val === 'string') return val;
  }
  return undefined;
}

/**
 * True when the operator has opted into solo-MLRO mode via env.
 * Case-insensitive — accepts 'true', '1', 'yes', 'on'. Anything
 * else is treated as off (default).
 */
export function isSoloMlroModeEnabled(): boolean {
  const raw = readEnv('HAWKEYE_SOLO_MLRO_MODE');
  if (!raw) return false;
  const lower = raw.trim().toLowerCase();
  return lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on';
}

/**
 * Cooldown hours from env, or DEFAULT_SOLO_COOLDOWN_HOURS when
 * unset / malformed. Clamped to [1, 168] (1 hour to 1 week) so a
 * misconfiguration can never produce a no-op cooldown.
 */
export function getSoloMlroCooldownHours(): number {
  const raw = readEnv('HAWKEYE_SOLO_MLRO_COOLDOWN_HOURS');
  if (!raw) return DEFAULT_SOLO_COOLDOWN_HOURS;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SOLO_COOLDOWN_HOURS;
  return Math.max(1, Math.min(168, parsed));
}

// ---------------------------------------------------------------------------
// Persistent pool — localStorage source of truth for the SPA
// ---------------------------------------------------------------------------

const POOL_STORAGE_KEY = 'fgl_approver_pool';
const SEED_STORAGE_KEY = 'fgl_approver_rotation_seed';

export function readApproverPool(): ApproverPoolMember[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(POOL_STORAGE_KEY);
    if (!raw) return DEFAULT_POOL;
    const parsed = JSON.parse(raw) as ApproverPoolMember[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_POOL;
  } catch {
    return DEFAULT_POOL;
  }
}

export function saveApproverPool(pool: readonly ApproverPoolMember[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(POOL_STORAGE_KEY, JSON.stringify(pool));
  } catch {
    /* storage quota — degrade silently */
  }
}

export function advanceRotationSeed(): number {
  try {
    if (typeof localStorage === 'undefined') return 0;
    const raw = localStorage.getItem(SEED_STORAGE_KEY);
    const next = ((raw ? Number.parseInt(raw, 10) : 0) + 1) % 1_000_000;
    localStorage.setItem(SEED_STORAGE_KEY, String(next));
    return next;
  } catch {
    return 0;
  }
}

/**
 * Default pool seeded on first boot so the super-brain dispatcher
 * has someone to pick from out of the box. Replace via the Brain
 * Console settings pane in a real deployment.
 */
const DEFAULT_POOL: ApproverPoolMember[] = [
  {
    gid: 'user-mlro-primary',
    name: 'MLRO Primary',
    teamId: 'mlro',
    openApprovals: 0,
    available: true,
  },
  {
    gid: 'user-mlro-deputy',
    name: 'MLRO Deputy',
    teamId: 'mlro',
    openApprovals: 0,
    available: true,
  },
  {
    gid: 'user-co-primary',
    name: 'Compliance Officer',
    teamId: 'co',
    openApprovals: 0,
    available: true,
  },
  {
    gid: 'user-co-deputy',
    name: 'Compliance Deputy',
    teamId: 'co',
    openApprovals: 0,
    available: true,
  },
];

// ---------------------------------------------------------------------------
// One-shot picker for the dispatcher
// ---------------------------------------------------------------------------

/**
 * Pick a four-eyes pair using the persistent pool + a rotating
 * seed. Used by the super-brain dispatcher when the caller doesn't
 * supply explicit approvers.
 *
 * Honours HAWKEYE_SOLO_MLRO_MODE automatically — when set, the
 * caller doesn't have to pass soloMlroMode: true explicitly. This
 * keeps the dispatcher path identical between deputy + solo
 * deployments.
 */
export function pickFourEyesFromPersistentPool(
  options: Omit<PoolPickOptions, 'rotationSeed'> = {}
): PoolPickResult {
  const pool = readApproverPool();
  const seed = advanceRotationSeed();
  const soloFromEnv = isSoloMlroModeEnabled();
  return pickFourEyesPair(pool, {
    ...options,
    rotationSeed: seed,
    // Distinct-team enforcement makes no sense in solo mode (only
    // one team member exists) — skip it when solo is active.
    requireDistinctTeams: soloFromEnv ? false : (options.requireDistinctTeams ?? true),
    soloMlroMode: options.soloMlroMode ?? soloFromEnv,
    soloMlroCooldownHours: options.soloMlroCooldownHours ?? getSoloMlroCooldownHours(),
  });
}
