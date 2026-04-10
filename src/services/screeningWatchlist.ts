/**
 * Screening Watchlist — subject-persistence module for ongoing monitoring.
 *
 * You add a subject once (via /api/watchlist POST from the UI onboarding
 * flow or programmatically). The scheduled-screening GitHub Actions cron
 * job reads this watchlist twice per day, runs delta adverse-media
 * searches for each subject using the 30-day lookback default,
 * fingerprints each hit, and dispatches NEW hits as Asana tasks in the
 * SCREENINGS project.
 *
 * Storage: in-memory Map for this module's API. Persistence is handled
 * by the caller (Netlify Blobs in production, a file on disk in dev).
 * This module is deliberately pure so it's trivial to test and swap
 * storage backends later.
 *
 * Cadence: per the product requirement "all daily regardless of the
 * risk", there is no per-tier cadence logic — every subject on the
 * watchlist is checked on every scheduled run. The riskTier field is
 * retained for reporting / tagging but does not affect frequency.
 *
 * Regulatory basis:
 *   - FATF Rec 10 (ongoing customer due diligence)
 *   - Cabinet Res 134/2025 Art.19 (periodic internal review)
 *   - FDL No.10/2025 Art.24 (record retention applies to the
 *     monitoring audit trail, not just to the verdicts themselves)
 */

import type { AdverseMediaHit } from './adverseMediaSearch';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskTier = 'high' | 'medium' | 'low';

export interface WatchlistEntry {
  /** Stable, caller-chosen id (usually customerId from the onboarding system). */
  id: string;
  /** The subject to screen — person or entity legal name. */
  subjectName: string;
  /**
   * Customer risk tier — retained for reporting and alert tagging.
   * Does NOT affect screening cadence; all subjects are checked on
   * every scheduled run regardless of tier.
   */
  riskTier: RiskTier;
  /** When the subject was added to the watchlist (ISO). */
  addedAtIso: string;
  /** When the subject was last screened (ISO). Undefined means never. */
  lastScreenedAtIso?: string;
  /**
   * Fingerprints (SHA-256 hex) of hits already seen, so subsequent runs
   * can detect NEW hits via set-difference.
   */
  seenHitFingerprints: string[];
  /** Total count of hits ever reported for this subject (monotonically increasing). */
  alertCount: number;
  /** Free-form metadata (customer id, jurisdiction, onboarding note, etc). */
  metadata?: Record<string, string | number | boolean>;
}

export interface Watchlist {
  entries: Map<string, WatchlistEntry>;
}

// ---------------------------------------------------------------------------
// Construction + CRUD
// ---------------------------------------------------------------------------

export function createWatchlist(): Watchlist {
  return { entries: new Map() };
}

export interface AddToWatchlistInput {
  id: string;
  subjectName: string;
  riskTier?: RiskTier;
  metadata?: Record<string, string | number | boolean>;
}

export function addToWatchlist(wl: Watchlist, input: AddToWatchlistInput): WatchlistEntry {
  const subjectName = input.subjectName.trim();
  if (!subjectName) {
    throw new Error('addToWatchlist: subjectName cannot be empty');
  }
  if (!input.id || input.id.trim().length === 0) {
    throw new Error('addToWatchlist: id cannot be empty');
  }
  if (wl.entries.has(input.id)) {
    throw new Error(`addToWatchlist: id "${input.id}" already exists in watchlist`);
  }
  const entry: WatchlistEntry = {
    id: input.id,
    subjectName,
    riskTier: input.riskTier ?? 'medium',
    addedAtIso: new Date().toISOString(),
    seenHitFingerprints: [],
    alertCount: 0,
    metadata: input.metadata,
  };
  wl.entries.set(input.id, entry);
  return entry;
}

export function removeFromWatchlist(wl: Watchlist, id: string): boolean {
  return wl.entries.delete(id);
}

export function getEntry(wl: Watchlist, id: string): WatchlistEntry | undefined {
  return wl.entries.get(id);
}

export function listAllEntries(wl: Watchlist): WatchlistEntry[] {
  return Array.from(wl.entries.values());
}

export function watchlistSize(wl: Watchlist): number {
  return wl.entries.size;
}

// ---------------------------------------------------------------------------
// Cadence — all daily (no per-tier logic per product requirement)
// ---------------------------------------------------------------------------

/**
 * Return all watchlist entries that are due for a screen.
 *
 * Per the product requirement "all daily regardless of the risk", this
 * returns EVERY entry on the watchlist on every invocation. The `now`
 * parameter is kept for future cadence extensions and deterministic
 * testing — a future revision could compare `now - lastScreenedAtIso`
 * against a per-tier interval.
 */
export function listDueSubjects(wl: Watchlist, _now: Date = new Date()): WatchlistEntry[] {
  return listAllEntries(wl);
}

// ---------------------------------------------------------------------------
// Hit fingerprinting — stable hash so delta detection works across runs
// ---------------------------------------------------------------------------

/**
 * Compute a stable fingerprint for a hit, using SHA-256 via Web Crypto.
 *
 * The fingerprint is based on (normalised URL) + title + publishedAt.
 * URLs are normalised to strip tracking query parameters (utm_*, fbclid,
 * gclid, etc.) and the hash fragment, so the same article shared with
 * different tracking tags does NOT look "new" on every run — a key
 * property for accurate delta detection.
 */
export async function fingerprintHit(hit: AdverseMediaHit): Promise<string> {
  const normalisedUrl = normaliseUrl(hit.url);
  const titlePart = (hit.title ?? '').trim();
  const datePart = (hit.publishedAt ?? '').trim();
  const payload = `${normalisedUrl}|${titlePart}|${datePart}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(payload);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Normalise a URL for fingerprinting:
 *   - Lowercase the host
 *   - Drop the fragment (#section-2 etc)
 *   - Remove common tracking query params (utm_*, fbclid, gclid, ref, ...)
 *
 * If URL parsing fails (malformed input), return the raw string so the
 * fingerprint is still stable for whatever garbage was passed in.
 */
function normaliseUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    const trackingParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'fbclid',
      'gclid',
      'msclkid',
      '_ga',
      'ref',
      'ref_src',
      'ref_url',
      'source',
      'mc_cid',
      'mc_eid',
      'igshid',
    ];
    for (const p of trackingParams) u.searchParams.delete(p);
    return u.toString();
  } catch {
    return rawUrl;
  }
}

// ---------------------------------------------------------------------------
// Post-screening update — diff hits, return NEW ones, mutate the entry
// ---------------------------------------------------------------------------

export interface ScreeningUpdateResult {
  /** Hits whose fingerprint was NOT in the entry's seenHitFingerprints set. */
  newHits: AdverseMediaHit[];
  /** The updated entry (also mutated in-place inside the watchlist). */
  entry: WatchlistEntry;
}

/**
 * After a screening run, update the entry with:
 *   - New `lastScreenedAtIso` (always)
 *   - Merged `seenHitFingerprints` (old + new)
 *   - Incremented `alertCount` if any new hits were found
 *
 * Returns the set of NEW hits (ones not previously seen) for downstream
 * dispatch to Asana.
 */
export async function updateAfterScreening(
  wl: Watchlist,
  id: string,
  hits: readonly AdverseMediaHit[],
  now: Date = new Date()
): Promise<ScreeningUpdateResult> {
  const entry = wl.entries.get(id);
  if (!entry) {
    throw new Error(`updateAfterScreening: unknown watchlist id "${id}"`);
  }

  const seenSet = new Set(entry.seenHitFingerprints);
  const newHits: AdverseMediaHit[] = [];

  for (const hit of hits) {
    const fp = await fingerprintHit(hit);
    if (!seenSet.has(fp)) {
      newHits.push(hit);
      seenSet.add(fp);
    }
  }

  entry.lastScreenedAtIso = now.toISOString();
  entry.seenHitFingerprints = Array.from(seenSet);
  if (newHits.length > 0) {
    entry.alertCount += newHits.length;
  }

  return { newHits, entry };
}

// ---------------------------------------------------------------------------
// Serialisation — so the watchlist can be persisted to Netlify Blobs
// ---------------------------------------------------------------------------

export interface SerialisedWatchlist {
  version: 1;
  entries: WatchlistEntry[];
}

export function serialiseWatchlist(wl: Watchlist): SerialisedWatchlist {
  return { version: 1, entries: listAllEntries(wl) };
}

/**
 * Restore a watchlist from a serialised blob. Tolerant of corrupted
 * input — malformed entries are silently skipped rather than throwing,
 * so a single bad row doesn't lose the whole watchlist. Version
 * mismatches return an empty watchlist (forcing the caller to rebuild
 * from onboarding).
 */
export function deserialiseWatchlist(raw: unknown): Watchlist {
  const wl = createWatchlist();
  if (!raw || typeof raw !== 'object') return wl;
  const obj = raw as { version?: unknown; entries?: unknown };
  if (obj.version !== 1) return wl;
  if (!Array.isArray(obj.entries)) return wl;
  for (const entry of obj.entries) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Partial<WatchlistEntry>;
    if (typeof e.id !== 'string' || typeof e.subjectName !== 'string') continue;
    wl.entries.set(e.id, {
      id: e.id,
      subjectName: e.subjectName,
      riskTier: (e.riskTier as RiskTier) ?? 'medium',
      addedAtIso: e.addedAtIso ?? new Date().toISOString(),
      lastScreenedAtIso: e.lastScreenedAtIso,
      seenHitFingerprints: Array.isArray(e.seenHitFingerprints) ? e.seenHitFingerprints : [],
      alertCount: typeof e.alertCount === 'number' ? e.alertCount : 0,
      metadata: e.metadata,
    });
  }
  return wl;
}
