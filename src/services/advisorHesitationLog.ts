/**
 * Advisor Hesitation Log — structured record of every "uncertain" brain
 * decision so the MLRO can review why the tool was unsure.
 *
 * CLAUDE.md §1 / §6 decision tree mandates that any screening match
 * with confidence 0.5-0.89 escalates to the Compliance Officer, and
 * that every advisor-escalation trigger (6 compliance gates) produces
 * a reviewable record. Today the brain fires those escalations but
 * the "why the brain hesitated" reasoning is scattered across the
 * audit chain alongside confident verdicts.
 *
 * This module carves out the hesitation band into its own append-only
 * log so:
 *
 *   - the MLRO daily digest can surface "n decisions waiting on you"
 *   - Cabinet Res 134/2025 Art.19 internal-review cadence has a
 *     first-class input (not scraped out of audit chain)
 *   - FDL No.(10)/2025 Art.20-21 reasoning trail is explicit
 *   - FDL Art.29 tipping-off guard is enforced at write-time: the
 *     log stores a *hashed* subject reference, never raw identifiers
 *
 * The log is intentionally pure (no network, no disk, no crypto).
 * Callers wire it to Netlify Blobs via the same CAS envelope pattern
 * used by asanaAuditLogMirror / asanaCentralMlroMirror.
 *
 * Regulatory basis:
 *   - FDL No.(10)/2025 Art.20-21 (CO reasoning trail),
 *     Art.24 (10-year retention),
 *     Art.29 (tipping-off — hashed subject ref only)
 *   - Cabinet Res 134/2025 Art.19 (internal review cadence)
 *   - Cabinet Res 74/2020 Art.4-7 (asset-freeze deliberation window)
 *   - FATF Rec 10 §10.12 (adverse-media band review)
 */

export type HesitationSource =
  | 'sanctions_potential_match' // confidence 0.5-0.89 on any of UN/OFAC/EU/UK/UAE/EOCN
  | 'advisor_trigger_fired'      // one of the 6 compliance gates from CLAUDE.md
  | 'threshold_edge_case'        // within 10% of AED 55K / 60K / 25% UBO
  | 'cdd_tier_change_uncertain'  // SDD→CDD or CDD→EDD without clear signal
  | 'str_draft_ambiguous'        // narrative generation uncertainty
  | 'pep_by_association'         // FATF Rec 12 second-order PEP
  | 'adverse_media_low_source';  // single unverified source

export interface HesitationEntry {
  /** Stable event id for dedup across retries. */
  readonly eventId: string;
  /** ISO-8601 UTC timestamp when the brain hesitated. */
  readonly at: string;
  /** Source / reason bucket (one of the enum values above). */
  readonly source: HesitationSource;
  /** Confidence the brain computed, in [0, 1]. */
  readonly confidence: number;
  /** SHA-256 hex of the subject identifier. NEVER store raw PII here (FDL Art.29). */
  readonly subjectRefHash: string;
  /** Human-readable evidence that pushed confidence UP. Max 500 chars. */
  readonly evidenceFor: string;
  /** Human-readable evidence that pushed confidence DOWN. Max 500 chars. */
  readonly evidenceAgainst: string;
  /**
   * What the brain did next after hesitating. Use one of the fixed
   * values so downstream analytics stays aggregatable.
   */
  readonly actionTaken:
    | 'escalated_to_co'
    | 'queued_for_four_eyes'
    | 'deferred_to_advisor'
    | 'auto_dismissed_with_log'
    | 'manual_review_requested';
  /** MLRO review state — starts 'pending', transitions to 'reviewed'. */
  readonly reviewState: 'pending' | 'reviewed' | 'overridden';
  /** Regulatory citation block to quote during audit. */
  readonly regulatoryCitation: string;
}

export interface HesitationReviewUpdate {
  readonly reviewedBy: string; // MLRO username / RBAC id
  readonly reviewedAt: string; // ISO-8601
  readonly verdict: 'confirmed_hesitation' | 'confirmed_match' | 'false_positive';
  readonly reviewerNotes?: string; // optional, max 1000 chars
}

export interface HesitationStats {
  readonly total: number;
  readonly pending: number;
  readonly reviewed: number;
  readonly overridden: number;
  readonly bySource: Readonly<Record<HesitationSource, number>>;
  /** Oldest pending entry age in hours, for Cabinet Res 134/2025 Art.19 reviews. */
  readonly oldestPendingHours: number | null;
}

export interface HesitationStore {
  list(): Promise<readonly HesitationEntry[]>;
  put(entry: HesitationEntry): Promise<void>;
  patch(eventId: string, update: Partial<HesitationEntry>): Promise<void>;
}

// Confidence-band definition per CLAUDE.md decision tree.
const LOW_CONFIDENCE = 0.5;
const HIGH_CONFIDENCE = 0.9;

export function isHesitationConfidence(confidence: number): boolean {
  return (
    Number.isFinite(confidence) &&
    confidence >= LOW_CONFIDENCE &&
    confidence < HIGH_CONFIDENCE
  );
}

export function validateHesitationEntry(
  entry: HesitationEntry,
): { ok: true } | { ok: false; reason: string } {
  if (!entry.eventId || entry.eventId.length < 8) {
    return { ok: false, reason: 'eventId must be at least 8 characters' };
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(entry.at)) {
    return { ok: false, reason: 'at must be ISO-8601 UTC' };
  }
  if (!Number.isFinite(entry.confidence) || entry.confidence < 0 || entry.confidence > 1) {
    return { ok: false, reason: 'confidence must be in [0, 1]' };
  }
  if (!/^[a-f0-9]{64}$/i.test(entry.subjectRefHash)) {
    return { ok: false, reason: 'subjectRefHash must be a SHA-256 hex digest (Art.29 — never raw PII)' };
  }
  if (entry.evidenceFor.length > 500) {
    return { ok: false, reason: 'evidenceFor too long (max 500)' };
  }
  if (entry.evidenceAgainst.length > 500) {
    return { ok: false, reason: 'evidenceAgainst too long (max 500)' };
  }
  if (!entry.regulatoryCitation) {
    return { ok: false, reason: 'regulatoryCitation is required' };
  }
  return { ok: true };
}

export function makeHesitationLog(store: HesitationStore) {
  async function record(entry: HesitationEntry): Promise<void> {
    const validation = validateHesitationEntry(entry);
    if (!validation.ok) {
      throw new Error(`advisorHesitationLog.record: ${validation.reason}`);
    }
    // Idempotent write — if eventId already exists, do NOT overwrite
    // (the brain may emit the same hesitation twice during retries).
    const existing = await store.list();
    if (existing.some((e) => e.eventId === entry.eventId)) return;
    await store.put(entry);
  }

  async function listPending(): Promise<readonly HesitationEntry[]> {
    const all = await store.list();
    return all.filter((e) => e.reviewState === 'pending');
  }

  async function markReviewed(
    eventId: string,
    update: HesitationReviewUpdate,
  ): Promise<void> {
    if (update.reviewerNotes && update.reviewerNotes.length > 1000) {
      throw new Error('advisorHesitationLog.markReviewed: reviewerNotes too long (max 1000)');
    }
    const all = await store.list();
    const current = all.find((e) => e.eventId === eventId);
    if (!current) {
      throw new Error(`advisorHesitationLog.markReviewed: eventId ${eventId} not found`);
    }
    if (current.reviewState === 'reviewed' || current.reviewState === 'overridden') {
      // Already closed — idempotent no-op, don't silently overwrite
      // the verdict that was already recorded.
      return;
    }
    const newState: HesitationEntry['reviewState'] =
      update.verdict === 'false_positive' ? 'overridden' : 'reviewed';
    await store.patch(eventId, { reviewState: newState });
  }

  async function stats(): Promise<HesitationStats> {
    const all = await store.list();
    const emptyBySource: Record<HesitationSource, number> = {
      sanctions_potential_match: 0,
      advisor_trigger_fired: 0,
      threshold_edge_case: 0,
      cdd_tier_change_uncertain: 0,
      str_draft_ambiguous: 0,
      pep_by_association: 0,
      adverse_media_low_source: 0,
    };
    const bySource = { ...emptyBySource };
    let pending = 0;
    let reviewed = 0;
    let overridden = 0;
    let oldestPendingAt: number | null = null;
    for (const e of all) {
      bySource[e.source]++;
      if (e.reviewState === 'pending') {
        pending++;
        const t = Date.parse(e.at);
        if (Number.isFinite(t) && (oldestPendingAt === null || t < oldestPendingAt)) {
          oldestPendingAt = t;
        }
      } else if (e.reviewState === 'reviewed') {
        reviewed++;
      } else if (e.reviewState === 'overridden') {
        overridden++;
      }
    }
    const oldestPendingHours =
      oldestPendingAt === null
        ? null
        : Math.max(0, (Date.now() - oldestPendingAt) / 3_600_000);
    return {
      total: all.length,
      pending,
      reviewed,
      overridden,
      bySource,
      oldestPendingHours,
    };
  }

  return { record, listPending, markReviewed, stats };
}

/**
 * In-memory store for tests and local dev. Production wires up a
 * Netlify-Blobs-backed store that implements the same interface.
 */
export function makeInMemoryHesitationStore(): HesitationStore {
  const items = new Map<string, HesitationEntry>();
  return {
    async list() {
      return Array.from(items.values());
    },
    async put(entry) {
      items.set(entry.eventId, entry);
    },
    async patch(eventId, update) {
      const current = items.get(eventId);
      if (!current) return;
      items.set(eventId, { ...current, ...update });
    },
  };
}
