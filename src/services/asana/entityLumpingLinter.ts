/**
 * Entity Lumping Linter — detects compliance task titles that mention
 * more than one legal entity from COMPANY_REGISTRY, so the dispatcher
 * can reject them at creation time and the setup wizard can flag
 * existing lumped tasks for operator cleanup.
 *
 * Why this exists:
 *   UAE AML/CFT requires per-entity CDD records and audit trails.
 *   Lumping multiple entities into a single Asana task destroys the
 *   per-entity audit trail, breaks the four-eyes approver chain
 *   (which key is pinned to which entity?), collapses the deadline
 *   calendar (a single due date cannot enforce 3 different review
 *   cycles), and makes the SLA enforcer unreliable.
 *
 *   An observed failure mode (from operator screenshots):
 *
 *     Standard CDD — Pending Completion:
 *       FG LLC — CDD Outstanding Files Review
 *       FG BRANCH — CDD Outstanding Files Review
 *       MADISON LLC — CDD Outstanding Files Review
 *       GRAMALTIN AS / NAPLES LLC / ZOE FZE — CDD Outstanding Files Review  ← LUMPED
 *
 *   Three distinct legal entities (Gramaltin, Naples, Zoe) were lumped
 *   into a single task. The MLRO cannot tell from the task alone which
 *   entity is blocking approval, and any document attached becomes
 *   ambiguous evidence for audit purposes. This module prevents that
 *   class of task from being created, and provides a diff tool the
 *   setup wizard calls to report existing lumps.
 *
 *   Pure function. No I/O, no state, no network. Safe for tests and
 *   for netlify functions.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.12-14 (CDD — per-customer obligation)
 *   FDL No.10/2025 Art.24    (10yr retention — per-entity audit trail)
 *   FDL No.10/2025 Art.26-27 (STR / SAR filing — per-subject)
 *   Cabinet Res 134/2025 Art.7-10 (CDD data collection per entity)
 *   Cabinet Res 134/2025 Art.19   (internal review per case)
 *   Cabinet Decision 109/2023     (UBO register per entity)
 *   FATF Rec 10 (CDD)
 *   FATF Rec 22 (DPMS CDD)
 */

// ---------------------------------------------------------------------------
// Entity alias table
// ---------------------------------------------------------------------------

/**
 * One record per legal entity in COMPANY_REGISTRY, with the list of
 * aliases an operator might reasonably type into an Asana task title.
 *
 * Hand-coded rather than auto-derived from COMPANY_REGISTRY because:
 *
 *   1. `FG LLC` and `FG BRANCH` both live under the `Fine Gold Group`
 *      and would conflict if derived naively from the short name "FG".
 *   2. Auto-derivation from the long legal name (e.g. "GRAMALTIN
 *      KIYMETLI MADENLER RAFINERI SANAYI VE TICARET ANONIM SIRKETI")
 *      would produce too many false positives on common tokens like
 *      "TICARET" or "SANAYI".
 *   3. The linter is a compliance tripwire — every entity in this
 *      table is audit-visible. Hand-curation keeps operator intent
 *      explicit.
 *
 * Match rules:
 *   - Case-insensitive substring match against the task title
 *   - Each alias is at least 4 characters (short tokens produce false
 *     positives on unrelated words — e.g. "AS" would match any
 *     sentence containing "as")
 *   - The first matching alias per entity "wins" — the linter reports
 *     at most one match per entity, never duplicates
 */
export interface EntityAliasRecord {
  /** Stable id matching the COMPANY_REGISTRY entry. */
  readonly entityId: string;
  /** Display name used in linter error messages. */
  readonly displayName: string;
  /** Case-insensitive substrings that identify this entity in a task title. */
  readonly aliases: readonly string[];
}

export const ENTITY_ALIASES: readonly EntityAliasRecord[] = [
  {
    entityId: 'company-1',
    displayName: 'MADISON LLC',
    aliases: ['MADISON LLC', 'MADISON L.L.C', 'MADISON JEWELLERY', 'MADISON'],
  },
  {
    entityId: 'company-2',
    displayName: 'NAPLES LLC',
    aliases: ['NAPLES LLC', 'NAPLES L.L.C', 'NAPLES JEWELLERY', 'NAPLES'],
  },
  {
    entityId: 'company-3',
    displayName: 'GRAMALTIN AS',
    aliases: ['GRAMALTIN AS', 'GRAMALTIN KIYMETLI', 'GRAMALTIN'],
  },
  {
    entityId: 'company-4',
    displayName: 'ZOE FZE',
    aliases: ['ZOE FZE', 'ZOE PRECIOUS', 'ZOE (FZE)'],
  },
  {
    entityId: 'company-5',
    // FG LLC must be disambiguated from FG BRANCH. Aliases that
    // match both ("FINE GOLD", "FG") are OMITTED — the linter is
    // only confident a title names FG LLC when it explicitly says
    // "FG LLC" / "FINE GOLD LLC" etc. Ambiguous "FG" mentions do
    // not count as a match for either entity, preventing the
    // linter from reporting a false lump.
    displayName: 'FG LLC',
    aliases: ['FG LLC', 'FINE GOLD LLC', 'FG L.L.C'],
  },
  {
    entityId: 'company-6',
    displayName: 'FG BRANCH',
    aliases: ['FG BRANCH', 'FINE GOLD BRANCH', 'FG (BRANCH)', 'FINE GOLD (BRANCH)'],
  },
];

// ---------------------------------------------------------------------------
// Lint result
// ---------------------------------------------------------------------------

export interface LumpingMatch {
  readonly entityId: string;
  readonly displayName: string;
  /** The alias that matched. */
  readonly alias: string;
  /** 0-based position of the match in the title (for debugging). */
  readonly position: number;
}

export interface LumpingLintResult {
  /** True if the title mentions 2 or more distinct entities. */
  readonly isLumped: boolean;
  /** Every distinct entity match, ordered by first-occurrence position. */
  readonly matches: readonly LumpingMatch[];
  /** Plain-English error message when `isLumped` is true, null otherwise. */
  readonly error: string | null;
  /** Regulatory anchor for the finding. */
  readonly regulatory: string;
}

/**
 * Lint a single task title. Pure function.
 *
 * Returns `isLumped: true` if the title mentions 2 or more distinct
 * entities from `ENTITY_ALIASES`. The match list is ordered by
 * first-occurrence position, so the caller can highlight the alias
 * positions in the UI if needed.
 *
 * Empty / whitespace-only / `null` titles return a clean result
 * (nothing to lint).
 */
export function lintTaskTitle(
  title: string | undefined | null,
  registry: readonly EntityAliasRecord[] = ENTITY_ALIASES
): LumpingLintResult {
  const clean = typeof title === 'string' ? title.trim() : '';
  const regulatory = 'FDL Art.12-14 / Art.24 / Cabinet Res 134/2025 Art.7-10';

  if (clean.length === 0) {
    return { isLumped: false, matches: [], error: null, regulatory };
  }

  const upper = clean.toUpperCase();
  const matches: LumpingMatch[] = [];

  for (const entity of registry) {
    // Find the first alias that matches in the upper-cased title.
    // We report at most one match per entity — even if multiple
    // aliases hit, the entity is only counted once.
    let hit: { alias: string; position: number } | null = null;
    for (const alias of entity.aliases) {
      const idx = upper.indexOf(alias.toUpperCase());
      if (idx !== -1) {
        if (hit === null || idx < hit.position) {
          hit = { alias, position: idx };
        }
      }
    }
    if (hit !== null) {
      matches.push({
        entityId: entity.entityId,
        displayName: entity.displayName,
        alias: hit.alias,
        position: hit.position,
      });
    }
  }

  // Sort matches by first-occurrence position so the error message
  // lists entities in the order the operator typed them.
  matches.sort((a, b) => a.position - b.position);

  const isLumped = matches.length >= 2;
  const error = isLumped
    ? `Task title lumps ${matches.length} entities (${matches.map((m) => m.displayName).join(', ')}). Each legal entity must have its own dedicated task per ${regulatory}. Split this task into ${matches.length} separate tasks, one per entity, before dispatch.`
    : null;

  return { isLumped, matches, error, regulatory };
}

// ---------------------------------------------------------------------------
// Scanner over an existing task list
// ---------------------------------------------------------------------------

export interface ExistingTask {
  readonly gid: string;
  readonly name: string;
}

export interface LumpedTaskReport {
  readonly gid: string;
  readonly name: string;
  readonly entityCount: number;
  readonly entities: readonly string[];
  readonly error: string;
}

export interface ScanReport {
  /** Total tasks scanned. */
  readonly scanned: number;
  /** Tasks that lint clean (no lumping). */
  readonly cleanCount: number;
  /** Tasks that lump 2+ entities — must be split. */
  readonly lumpedTasks: readonly LumpedTaskReport[];
  /** Human-readable summary. */
  readonly summary: string;
  readonly regulatory: readonly string[];
}

/**
 * Scan an existing Asana task list for lumped titles and report
 * every finding. Pure function — caller injects the task list.
 */
export function scanForLumpedTasks(
  tasks: readonly ExistingTask[],
  registry: readonly EntityAliasRecord[] = ENTITY_ALIASES
): ScanReport {
  const lumped: LumpedTaskReport[] = [];
  for (const t of tasks) {
    const result = lintTaskTitle(t.name, registry);
    if (result.isLumped) {
      lumped.push({
        gid: t.gid,
        name: t.name,
        entityCount: result.matches.length,
        entities: result.matches.map((m) => m.displayName),
        error: result.error ?? 'lumped',
      });
    }
  }
  const cleanCount = tasks.length - lumped.length;
  const summary =
    lumped.length === 0
      ? `All ${tasks.length} task(s) scanned: zero lumping findings. ✓`
      : `${lumped.length} of ${tasks.length} tasks lump multiple entities and must be split into ${lumped.reduce((acc, t) => acc + t.entityCount, 0)} separate tasks.`;

  return {
    scanned: tasks.length,
    cleanCount,
    lumpedTasks: lumped,
    summary,
    regulatory: [
      'FDL No.10/2025 Art.12-14',
      'FDL No.10/2025 Art.24',
      'FDL No.10/2025 Art.26-27',
      'Cabinet Res 134/2025 Art.7-10',
      'Cabinet Res 134/2025 Art.19',
      'Cabinet Decision 109/2023',
      'FATF Rec 10',
      'FATF Rec 22',
    ],
  };
}

// ---------------------------------------------------------------------------
// Throwing variant for the dispatcher
// ---------------------------------------------------------------------------

/**
 * Assert that a task title does not lump entities. Throws a typed
 * error if it does. Used by the task creation path in the dispatcher
 * so a compliance violation is blocked at write time, not discovered
 * later during an audit.
 */
export class EntityLumpingError extends Error {
  readonly code = 'ENTITY_LUMPING';
  readonly matches: readonly LumpingMatch[];
  readonly regulatory: string;

  constructor(message: string, matches: readonly LumpingMatch[], regulatory: string) {
    super(message);
    this.name = 'EntityLumpingError';
    this.matches = matches;
    this.regulatory = regulatory;
  }
}

export function assertTaskTitleNotLumped(title: string | undefined | null): void {
  const result = lintTaskTitle(title);
  if (result.isLumped) {
    throw new EntityLumpingError(result.error!, result.matches, result.regulatory);
  }
}
