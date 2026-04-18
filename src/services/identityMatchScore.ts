/**
 * Identity Match Score — composite score for classifying a screening
 * hit against a resolved subject identity.
 *
 * The "all the Mohameds" problem: a bare name like "Mohamed Ahmed"
 * matches thousands of list entries. Once the MLRO pins the
 * watchlist entry to a specific person via `ResolvedIdentity`
 * (DoB, nationality, ID number, alias list, list-entry reference),
 * every subsequent daily hit is scored against that pinned profile
 * instead of the bare name. Name-only coincidences are suppressed;
 * corroborated matches are promoted to alerts.
 *
 * Formula (four weighted components + one bonus):
 *   Name         0.30  matchScore(subjectName, hitName).score
 *   Date of birth 0.30  exact = 1.0, year-only = 0.5, miss = 0
 *   Nationality  0.20  match = 1.0, miss = 0
 *   ID number    0.20  exact = 1.0, miss = 0
 *   +Alias bonus 0.10  best name score came from a recorded alias
 *
 * Classification bands:
 *   >= 0.80 → 'alert'    — probable match, surface to MLRO today
 *   >= 0.50 → 'possible' — MLRO must review but do not treat as a
 *                          confirmed match
 *   <  0.50 → 'suppress' — name-only coincidence, keep out of alerts
 *
 * Unresolved identity clamp: when the subject has no resolved
 * identity the MLRO has not positively identified which person the
 * watchlist entry represents. The classification is downgraded from
 * 'alert' to 'possible' — we cannot responsibly fire a daily alert
 * until disambiguation has happened. The raw composite is preserved
 * for debugging.
 *
 * Regulatory basis:
 *   FATF Rec 10 — CDD must positively identify the customer.
 *   Cabinet Res 134/2025 Art.7-10 — tiered CDD with a unique identifier.
 *   FDL No.10/2025 Art.12 + Art.35 — freezes apply to THE subject,
 *     not to anyone who happens to share their name.
 */

import { matchScore } from './nameMatching';
import type { ResolvedIdentity } from './screeningWatchlist';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface IdentityMatchInput {
  /** The primary name on the list entry that produced the hit. */
  listEntryName: string;
  /** Aliases on the list entry (unused today, reserved for future cross-alias work). */
  listEntryAliases?: string[];
  /** Date of birth on the list entry — dd/mm/yyyy, yyyy-mm-dd, or yyyy only. */
  listEntryDob?: string;
  /** Nationality on the list entry — ISO alpha-2 preferred. */
  listEntryNationality?: string;
  /** Document number on the list entry if published. */
  listEntryIdNumber?: string;
  /** Source + reference of the list entry (used for pinned designation matches). */
  listEntryRef?: { list: string; reference: string };
}

export interface IdentityMatchBreakdown {
  name: number;
  dob: number;
  nationality: number;
  id: number;
  alias: number;
}

export type IdentityClassification = 'alert' | 'possible' | 'suppress';

export interface IdentityMatchResult {
  composite: number;
  breakdown: IdentityMatchBreakdown;
  classification: IdentityClassification;
  hasResolvedIdentity: boolean;
}

export const IDENTITY_MATCH_WEIGHTS = {
  name: 0.3,
  dob: 0.3,
  nationality: 0.2,
  id: 0.2,
  aliasBonus: 0.1,
} as const;

export const IDENTITY_MATCH_THRESHOLDS = {
  alert: 0.8,
  possible: 0.5,
} as const;

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

function normDob(s: string | undefined): { full?: string; year?: string } {
  if (!s) return {};
  const trimmed = s.trim();
  if (!trimmed) return {};
  const ddmmyyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (ddmmyyyy) {
    return { full: `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`, year: ddmmyyyy[3] };
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) {
    return { full: `${iso[1]}-${iso[2]}-${iso[3]}`, year: iso[1] };
  }
  const yearOnly = /^(\d{4})$/.exec(trimmed);
  if (yearOnly) {
    return { year: yearOnly[1] };
  }
  return {};
}

function normCountry(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = s.trim().toUpperCase();
  return t.length > 0 ? t : undefined;
}

function normId(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = s.replace(/[\s-]/g, '').toUpperCase();
  return t.length > 0 ? t : undefined;
}

function scoreNameAgainstIdentity(
  hitName: string,
  subjectName: string,
  aliases: readonly string[]
): { score: number; aliasHit: boolean } {
  let best = matchScore(subjectName, hitName).score;
  let bestFromAlias = false;
  for (const alias of aliases) {
    const s = matchScore(alias, hitName).score;
    if (s > best) {
      best = s;
      bestFromAlias = true;
    }
  }
  // Only award the alias bonus when the alias was a strong match AND
  // it dominated the subject-name score. A weak alias on an
  // already-matching subject name must not inflate the composite.
  const aliasHit = bestFromAlias && best >= 0.85;
  return { score: best, aliasHit };
}

// ---------------------------------------------------------------------------
// Main scorer
// ---------------------------------------------------------------------------

export function scoreHitAgainstProfile(
  hit: IdentityMatchInput,
  subjectName: string,
  identity?: ResolvedIdentity
): IdentityMatchResult {
  const hasResolved = !!identity;

  const aliases =
    identity?.aliases?.filter((a): a is string => typeof a === 'string' && a.trim().length > 0) ??
    [];

  const { score: nameScore, aliasHit } = scoreNameAgainstIdentity(
    hit.listEntryName,
    subjectName,
    aliases
  );

  // Date of birth — exact day wins, year-only is a partial signal.
  let dob = 0;
  const subjDob = normDob(identity?.dob);
  const hitDob = normDob(hit.listEntryDob);
  if (subjDob.full && hitDob.full && subjDob.full === hitDob.full) {
    dob = 1;
  } else if (subjDob.year && hitDob.year && subjDob.year === hitDob.year) {
    dob = 0.5;
  }

  // Nationality.
  let nationality = 0;
  const subjNat = normCountry(identity?.nationality);
  const hitNat = normCountry(hit.listEntryNationality);
  if (subjNat && hitNat && subjNat === hitNat) nationality = 1;

  // Document number.
  let id = 0;
  const subjId = normId(identity?.idNumber);
  const hitId = normId(hit.listEntryIdNumber);
  if (subjId && hitId && subjId === hitId) id = 1;

  // listEntryRef pin — if the MLRO resolved to a specific list
  // designation and the daily hit is from the exact same designation,
  // that is an authoritative identifier (stronger than a document
  // number). Treat it as a full ID match.
  const pin = identity?.listEntryRef;
  const hitRef = hit.listEntryRef;
  if (
    pin &&
    hitRef &&
    pin.list.trim().toUpperCase() === hitRef.list.trim().toUpperCase() &&
    pin.reference.trim() === hitRef.reference.trim()
  ) {
    id = 1;
  }

  const aliasBonus = aliasHit ? IDENTITY_MATCH_WEIGHTS.aliasBonus : 0;

  let composite =
    nameScore * IDENTITY_MATCH_WEIGHTS.name +
    dob * IDENTITY_MATCH_WEIGHTS.dob +
    nationality * IDENTITY_MATCH_WEIGHTS.nationality +
    id * IDENTITY_MATCH_WEIGHTS.id +
    aliasBonus;
  composite = Math.min(1, composite);

  let classification: IdentityClassification;
  if (composite >= IDENTITY_MATCH_THRESHOLDS.alert) classification = 'alert';
  else if (composite >= IDENTITY_MATCH_THRESHOLDS.possible) classification = 'possible';
  else classification = 'suppress';

  // Unresolved clamp. FATF Rec 10 requires positive identification
  // before treating a hit as actionable. Downgrade 'alert' to
  // 'possible' until the MLRO has pinned the identity.
  if (!hasResolved && classification === 'alert') {
    classification = 'possible';
  }

  return {
    composite,
    breakdown: { name: nameScore, dob, nationality, id, alias: aliasBonus },
    classification,
    hasResolvedIdentity: hasResolved,
  };
}
