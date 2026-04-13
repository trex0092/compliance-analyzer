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
}

export interface PoolPickResult {
  ok: boolean;
  pair?: readonly [FourEyesApprover, FourEyesApprover];
  error?: string;
  /** Metadata for logging + audit. */
  diagnostics: {
    poolSize: number;
    eligibleCount: number;
    pickStrategy: 'round-robin' | 'lowest-load' | 'fallback';
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
    pickStrategy: 'lowest-load' as 'round-robin' | 'lowest-load' | 'fallback',
  };

  if (eligible.length < 2) {
    return {
      ok: false,
      error: `Approver pool has ${eligible.length} eligible member(s); four-eyes requires 2 (Cabinet Res 134/2025 Art.19)`,
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
 */
export function pickFourEyesFromPersistentPool(
  options: Omit<PoolPickOptions, 'rotationSeed'> = {}
): PoolPickResult {
  const pool = readApproverPool();
  const seed = advanceRotationSeed();
  return pickFourEyesPair(pool, {
    ...options,
    rotationSeed: seed,
    requireDistinctTeams: options.requireDistinctTeams ?? true,
  });
}
