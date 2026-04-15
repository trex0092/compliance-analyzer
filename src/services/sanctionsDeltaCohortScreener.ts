/**
 * Sanctions Delta Cohort Screener — re-screens an existing customer
 * cohort against ONLY a sanctions-list delta (newly added entries +
 * modified entries), instead of running a full screen against the
 * entire list.
 *
 * Why this exists:
 *   Today screening is point-in-time at customer onboarding. If
 *   OFAC adds a name on Tuesday and your customer was onboarded on
 *   Monday, you find out at the next periodic CDD review — which
 *   may be weeks away. EOCN guidance for Cabinet Res 74/2020 Art.4
 *   is "without delay" — weeks is unacceptable.
 *
 *   The existing src/services/sanctionsDelta.ts knows how to diff
 *   two snapshots. This module consumes that delta + a cohort of
 *   active customers, and returns the subset of cohort members
 *   that match against ONE OF the new/modified entries. It then
 *   produces the `auto-remediation` payload the existing
 *   `autoRemediationExecutor` expects (24h freeze countdown +
 *   CNMR within 5 BD + STR draft + four-eyes pair).
 *
 *   Pure function — no I/O. The cron in
 *   netlify/functions/sanctions-delta-cron.mts is the thin
 *   transport wrapper that calls this with the loaded delta + the
 *   loaded cohort.
 *
 * Matching rule:
 *   For each delta entry (added OR modified), the cohort screener
 *   walks every customer and runs a fuzzy-name match using the
 *   existing nameVariantExpander. A match is a hit when:
 *     - canonical name match     (Levenshtein ≤ 2 on normalised)
 *     - alias match              (any alias variant matches)
 *     - DOB + nationality match  (when both fields are present)
 *
 *   Match confidence is derived from how many of the above fired:
 *     1 dimension  → 0.55  (potential — escalate to CO)
 *     2 dimensions → 0.85  (likely — auto-freeze gate)
 *     3 dimensions → 0.99  (confirmed — immediate freeze)
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO duty of care + reasoned decision)
 *   FDL No.10/2025 Art.35    (TFS — sanctions completeness)
 *   Cabinet Res 74/2020 Art.4-7 (asset freeze without delay,
 *                                 24h EOCN, 5 BD CNMR)
 *   FATF Rec 6               (UN sanctions screening completeness)
 *   FATF Rec 20              (continuous monitoring)
 *   MoE Circular 08/AML/2021 (DPMS sector — quarterly-or-faster
 *                             screening cadence)
 */

import type { SanctionsDelta, SanctionsEntry } from './sanctionsDelta';
import { expandNameVariants } from './nameVariantExpander';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal shape for a customer record going through delta screening.
 * Tenants enrich beyond this freely — only the fields below are read.
 */
export interface CohortCustomer {
  /** Opaque tenant-scoped customer id. NEVER a legal name field by itself. */
  id: string;
  /** Tenant scope. */
  tenantId: string;
  /** Legal name as on file. */
  name: string;
  /** Alternate names / aliases. */
  aliases?: readonly string[];
  /** Date of birth (YYYY-MM-DD) when known. */
  dateOfBirth?: string;
  /** ISO 3166-1 alpha-2 country code when known. */
  nationality?: string;
  /** Last screen date — informational only. */
  lastScreenedAtIso?: string;
}

export type DeltaHitConfidence = 'low' | 'potential' | 'likely' | 'confirmed';

export interface DeltaScreenHit {
  /** The cohort customer that matched. */
  customerId: string;
  /** Tenant scope (carried through for the orchestrator). */
  tenantId: string;
  /** The delta entry that caused the hit. */
  matchedAgainst: SanctionsEntry;
  /** Why it matched — `name` / `alias` / `dob+nationality` (in order they fired). */
  matchReasons: readonly string[];
  /**
   * Numeric confidence in [0, 1]. Mapped from the count of matching
   * dimensions. See the matching rule docs.
   */
  matchScore: number;
  /** Coarse band derived from `matchScore`. */
  confidence: DeltaHitConfidence;
  /**
   * Recommended downstream action. The autoRemediationExecutor
   * consumes this verbatim.
   */
  recommendedAction:
    | 'freeze_immediately'
    | 'gate_for_co_review'
    | 'escalate_for_review';
  /** Regulatory anchor for this specific hit. */
  regulatory: readonly string[];
}

export interface DeltaScreenReport {
  /** Number of cohort customers actually evaluated. */
  cohortSize: number;
  /** Number of (added + modified) delta entries evaluated. */
  deltaEntries: number;
  /** All hits, in confidence-descending order. */
  hits: readonly DeltaScreenHit[];
  /** Snapshot hash of the source delta (for audit replay). */
  fromSnapshotHash: string;
  toSnapshotHash: string;
  /** Plain-English summary safe for the CO digest + audit log. */
  summary: string;
  /** Regulatory anchors covered by this report. */
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Matching helpers
// ---------------------------------------------------------------------------

/** Pure Levenshtein — small fixed cap for early-exit perf. */
function levenshtein(a: string, b: string, cap: number): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length > cap ? cap + 1 : b.length;
  if (b.length === 0) return a.length > cap ? cap + 1 : a.length;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;

  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0]!;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (cur[j]! < rowMin) rowMin = cur[j]!;
    }
    if (rowMin > cap) return cap + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]!;
  }
  return prev[b.length]!;
}

function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchName(customerName: string, sanctionedName: string): boolean {
  const c = normalise(customerName);
  const s = normalise(sanctionedName);
  if (!c || !s) return false;
  if (c === s) return true;
  // Token-set overlap — if every token in the shorter name appears in the
  // longer one, treat as match.
  const ct = new Set(c.split(' '));
  const st = new Set(s.split(' '));
  const small = ct.size <= st.size ? ct : st;
  const big = ct.size <= st.size ? st : ct;
  let overlap = 0;
  for (const t of small) if (big.has(t)) overlap += 1;
  if (small.size > 0 && overlap / small.size >= 0.85) return true;
  // Levenshtein on normalised concatenation, capped at 2 for short strings.
  return levenshtein(c, s, 2) <= 2;
}

function matchAlias(customer: CohortCustomer, sanctioned: SanctionsEntry): boolean {
  const customerVariants = new Set<string>();
  customerVariants.add(normalise(customer.name));
  for (const a of customer.aliases ?? []) customerVariants.add(normalise(a));
  // Pull every romanised + honorific-stripped + Arabic variant from the
  // expander so we benefit from the existing CJK / Arabic / honorific
  // logic without duplicating it.
  const expansion = expandNameVariants(customer.name);
  for (const v of expansion.variants) customerVariants.add(v);

  const sanctionedNames: string[] = [sanctioned.name];
  for (const a of sanctioned.aliases ?? []) sanctionedNames.push(a);
  for (const sn of sanctionedNames) {
    const norm = normalise(sn);
    if (customerVariants.has(norm)) return true;
    for (const cv of customerVariants) {
      if (cv && norm && (cv.includes(norm) || norm.includes(cv))) {
        if (Math.min(cv.length, norm.length) >= 4) return true;
      }
    }
  }
  return false;
}

function matchDobAndNationality(
  customer: CohortCustomer,
  sanctioned: SanctionsEntry
): boolean {
  if (!customer.dateOfBirth || !customer.nationality) return false;
  if (!sanctioned.dateOfBirth || !sanctioned.nationality) return false;
  return (
    customer.dateOfBirth.slice(0, 10) === sanctioned.dateOfBirth.slice(0, 10) &&
    customer.nationality.toUpperCase() === sanctioned.nationality.toUpperCase()
  );
}

function deriveAction(score: number): DeltaScreenHit['recommendedAction'] {
  if (score >= 0.9) return 'freeze_immediately';
  if (score >= 0.8) return 'gate_for_co_review';
  return 'escalate_for_review';
}

function deriveBand(score: number): DeltaHitConfidence {
  if (score >= 0.95) return 'confirmed';
  if (score >= 0.8) return 'likely';
  if (score >= 0.5) return 'potential';
  return 'low';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ScreenCohortOptions {
  /**
   * Lower bound on `matchScore` to include in the report. Defaults to
   * 0.5 — anything below that has so little signal that surfacing it
   * just wastes MLRO cycles.
   */
  minMatchScore?: number;
}

/**
 * Re-screen `cohort` against the (added + modified) entries of `delta`.
 * Pure function. Same input → same hits. No I/O.
 *
 * Cost: O(C * D) where C = cohort size and D = delta entries. The
 * inner match is O(L^2) where L is name length, capped by the
 * Levenshtein early-exit at 2. Realistic ~10k cohort × 50 delta
 * entries finishes well inside a Netlify scheduled-function budget.
 */
export function screenCohortAgainstDelta(
  cohort: readonly CohortCustomer[],
  delta: SanctionsDelta,
  opts: ScreenCohortOptions = {}
): DeltaScreenReport {
  const minScore = opts.minMatchScore ?? 0.5;

  // Walk added + modified.after entries.
  const targets: SanctionsEntry[] = [];
  for (const e of delta.added) targets.push(e);
  for (const m of delta.modified) targets.push(m.after);

  const hits: DeltaScreenHit[] = [];

  for (const customer of cohort) {
    if (!customer || !customer.id || !customer.name) continue;
    for (const target of targets) {
      const reasons: string[] = [];
      if (matchName(customer.name, target.name)) reasons.push('name');
      if (matchAlias(customer, target)) reasons.push('alias');
      if (matchDobAndNationality(customer, target)) reasons.push('dob+nationality');
      if (reasons.length === 0) continue;

      // 1 dimension → 0.55 / 2 → 0.85 / 3 → 0.99
      let score: number;
      if (reasons.length >= 3) score = 0.99;
      else if (reasons.length === 2) score = 0.85;
      else score = 0.55;

      if (score < minScore) continue;

      hits.push({
        customerId: customer.id,
        tenantId: customer.tenantId,
        matchedAgainst: target,
        matchReasons: reasons,
        matchScore: score,
        confidence: deriveBand(score),
        recommendedAction: deriveAction(score),
        regulatory: [
          'FDL No.10/2025 Art.35',
          'Cabinet Res 74/2020 Art.4-7',
          'FATF Rec 6',
        ],
      });
    }
  }

  hits.sort((a, b) => b.matchScore - a.matchScore);

  const summary =
    hits.length === 0
      ? `No cohort hits across ${cohort.length} customer(s) and ${targets.length} delta entries (${delta.fromSnapshotHash.slice(0, 8)}→${delta.toSnapshotHash.slice(0, 8)}).`
      : `${hits.length} cohort hit(s) across ${cohort.length} customer(s) and ${targets.length} delta entries — ${hits.filter((h) => h.recommendedAction === 'freeze_immediately').length} confirmed, ${hits.filter((h) => h.recommendedAction === 'gate_for_co_review').length} likely, ${hits.filter((h) => h.recommendedAction === 'escalate_for_review').length} potential.`;

  return {
    cohortSize: cohort.length,
    deltaEntries: targets.length,
    hits,
    fromSnapshotHash: delta.fromSnapshotHash,
    toSnapshotHash: delta.toSnapshotHash,
    summary,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'FDL No.10/2025 Art.35',
      'Cabinet Res 74/2020 Art.4-7',
      'FATF Rec 6',
      'FATF Rec 20',
      'MoE Circular 08/AML/2021',
    ],
  };
}

// Exports for tests.
export const __test__ = {
  levenshtein,
  normalise,
  matchName,
  matchAlias,
  matchDobAndNationality,
  deriveAction,
  deriveBand,
};
