/**
 * Regulatory Ingestion Pipeline — pure NLP layer that turns raw
 * regulator bulletin text into a structured "candidate change set"
 * the MLRO can review.
 *
 * Why this exists:
 *   Today new circulars from MoE / EOCN / CBUAE / FIU are processed
 *   by hand. The MLRO reads the bulletin, cross-references against
 *   src/domain/constants.ts, opens a `regulatory-update` skill task
 *   in Asana. This costs hours per circular and creates a personnel
 *   single point of failure: if the MLRO is on leave when a critical
 *   circular drops, the firm is exposed.
 *
 *   This module is the FIRST automated layer. It does NOT auto-update
 *   constants.ts (Tier C principle). What it does:
 *
 *     1. Normalise bulletin text (strip HTML, collapse whitespace,
 *        unify date formats).
 *     2. Extract *candidate values* via regex patterns that match
 *        the language regulators use ("AED 55,000", "5 business
 *        days", "25 percent", "10 years").
 *     3. Diff each extracted value against the corresponding
 *        constant in `constants.ts` (passed in via the loader).
 *     4. Produce a `RegulatoryCandidate[]` list with the source
 *        snippet, the proposed value, the matched constant, and a
 *        confidence score.
 *
 *   The cron wrapper (regulatory-ingest-cron) consumes the result and
 *   files an Asana `regulatory-update` task per candidate. Tier C —
 *   the MLRO accepts the candidate AND opens a PR by hand.
 *
 *   Pure function. No HTTP, no LLM, no state. Deterministic — same
 *   bulletin text → same candidates.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO continuous monitoring of regulation)
 *   FDL No.10/2025 Art.24    (audit trail of every circular processed)
 *   Cabinet Res 134/2025 Art.19 (internal review)
 *   MoE Circular 08/AML/2021 (DPMS sector — 30-day implementation
 *                              deadline after circular publication)
 *   FATF Rec 1               (risk-based approach must be updated)
 *   NIST AI RMF 1.0 GOVERN-1 (process for regulatory change)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BulletinDocument {
  /** Stable identifier (URL or doc id). */
  id: string;
  /** Source authority. */
  source: 'MoE' | 'EOCN' | 'CBUAE' | 'FIU' | 'UAE-Cabinet' | 'FATF' | 'OTHER';
  /** Document title or headline. */
  title: string;
  /** Plain-text body — caller strips HTML before passing in. */
  body: string;
  /** ISO 8601 publication date. */
  publishedAtIso: string;
}

export interface RegulatoryCandidate {
  /** Stable id derived from source + extracted snippet position. */
  id: string;
  /** Source bulletin id this candidate came from. */
  sourceDocId: string;
  /** Source authority. */
  source: BulletinDocument['source'];
  /** Snippet of bulletin text containing the candidate value. */
  snippet: string;
  /** Constant key the candidate likely refers to (when matched). */
  matchedConstantKey: string | null;
  /** Current value of that constant (when matched). */
  currentValue: number | null;
  /** Proposed value extracted from the bulletin. */
  proposedValue: number;
  /** Unit family ("AED" | "days" | "years" | "percent" | "count"). */
  unit: 'AED' | 'days' | 'years' | 'percent' | 'count';
  /** Heuristic confidence in [0, 1]. */
  confidence: number;
  /** Plain-English finding. */
  finding: string;
  /** Regulatory anchor (the source bulletin reference itself). */
  citation: string;
}

export interface RegulatoryIngestionReport {
  schemaVersion: 1;
  documentId: string;
  candidates: readonly RegulatoryCandidate[];
  summary: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Constant catalogue (passed in by the cron — not imported, see Tier C)
// ---------------------------------------------------------------------------

export interface ConstantBinding {
  key: string;
  /** Current value. */
  value: number;
  /** Unit family of this constant. */
  unit: RegulatoryCandidate['unit'];
  /** Aliases / patterns that hint this constant in bulletin prose. */
  aliases: readonly string[];
}

// ---------------------------------------------------------------------------
// Pure normaliser
// ---------------------------------------------------------------------------

export function normaliseBulletinText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Regex extractors
// ---------------------------------------------------------------------------

/** AED amounts — supports "AED 55,000" / "AED 55K" / "55,000 AED" / etc. */
const AED_RE =
  /(?:AED|aed|د\.إ)\s*([0-9][0-9,\.]*)\s*(?:K|k|M|m)?|([0-9][0-9,\.]*)\s*(?:K|k|M|m)?\s*(?:AED|aed)/g;

/** Day expressions — "5 business days", "10 working days", "30 calendar days". */
const DAYS_RE = /(\d{1,3})\s*(business|working|calendar|clock)?\s*(days?|hours?)/gi;

/** Year expressions — "10 years". */
const YEARS_RE = /(\d{1,3})\s*years?/gi;

/** Percent expressions — "25 percent", "25%". */
const PCT_RE = /(\d{1,3}(?:\.\d+)?)\s*(?:percent|per\s*cent|%)/gi;

function parseAed(match: RegExpExecArray): number | null {
  const raw = match[1] ?? match[2];
  if (!raw) return null;
  let n = parseFloat(raw.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  // Detect K/M suffix in the original match.
  const tail = match[0].slice(-2).toLowerCase();
  if (tail.endsWith('k')) n *= 1_000;
  else if (tail.endsWith('m')) n *= 1_000_000;
  return n;
}

interface RawHit {
  value: number;
  unit: RegulatoryCandidate['unit'];
  snippet: string;
  position: number;
}

function extractRawHits(body: string): RawHit[] {
  const hits: RawHit[] = [];
  const snippetWindow = 80;

  const snip = (idx: number, len: number) =>
    body
      .slice(Math.max(0, idx - snippetWindow), Math.min(body.length, idx + len + snippetWindow))
      .trim();

  let m: RegExpExecArray | null;

  // AED
  AED_RE.lastIndex = 0;
  while ((m = AED_RE.exec(body)) !== null) {
    const value = parseAed(m);
    if (value !== null) {
      hits.push({ value, unit: 'AED', snippet: snip(m.index, m[0].length), position: m.index });
    }
  }
  // Days / hours
  DAYS_RE.lastIndex = 0;
  while ((m = DAYS_RE.exec(body)) !== null) {
    const n = parseFloat(m[1] ?? '');
    if (!Number.isFinite(n)) continue;
    const isHours = /hours?/i.test(m[3] ?? '');
    hits.push({
      value: n,
      unit: isHours ? 'count' : 'days',
      snippet: snip(m.index, m[0].length),
      position: m.index,
    });
  }
  // Years
  YEARS_RE.lastIndex = 0;
  while ((m = YEARS_RE.exec(body)) !== null) {
    const n = parseFloat(m[1] ?? '');
    if (!Number.isFinite(n)) continue;
    hits.push({ value: n, unit: 'years', snippet: snip(m.index, m[0].length), position: m.index });
  }
  // Percent
  PCT_RE.lastIndex = 0;
  while ((m = PCT_RE.exec(body)) !== null) {
    const n = parseFloat(m[1] ?? '');
    if (!Number.isFinite(n)) continue;
    hits.push({
      value: n,
      unit: 'percent',
      snippet: snip(m.index, m[0].length),
      position: m.index,
    });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Constant matcher
// ---------------------------------------------------------------------------

function matchConstant(
  hit: RawHit,
  bindings: readonly ConstantBinding[]
): { binding: ConstantBinding; score: number } | null {
  // Filter to bindings that share unit family.
  // Note: hours map to 'count' here, but for HOUR-typed constants we
  // accept the 'count' bridge.
  const candidates = bindings.filter((b) => {
    if (b.unit === hit.unit) return true;
    // Allow days→count cross-family for hour constants because we
    // tag hours as 'count' above.
    if (hit.unit === 'count' && b.unit === 'count') return true;
    return false;
  });
  if (candidates.length === 0) return null;

  const lowerSnippet = hit.snippet.toLowerCase();
  let best: { binding: ConstantBinding; score: number } | null = null;
  for (const b of candidates) {
    let score = 0;
    for (const alias of b.aliases) {
      if (lowerSnippet.includes(alias.toLowerCase())) {
        score += 0.4;
      }
    }
    // If the proposed value is within an order of magnitude of the
    // current value, bump confidence — we are clearly talking about
    // the same constant.
    const ratio = b.value > 0 ? hit.value / b.value : 0;
    if (ratio > 0.1 && ratio < 10) score += 0.3;
    if (ratio > 0.5 && ratio < 2) score += 0.2;
    if (score > 0 && (best === null || score > best.score)) {
      best = { binding: b, score: Math.min(1, score) };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function ingestBulletin(
  doc: BulletinDocument,
  bindings: readonly ConstantBinding[]
): RegulatoryIngestionReport {
  if (!doc || typeof doc !== 'object' || typeof doc.body !== 'string') {
    return {
      schemaVersion: 1,
      documentId: doc?.id ?? 'unknown',
      candidates: [],
      summary: 'Invalid bulletin document — no body to ingest.',
      regulatory: ['FDL No.10/2025 Art.22'],
    };
  }
  const normalised = normaliseBulletinText(doc.body);
  const hits = extractRawHits(normalised);

  const candidates: RegulatoryCandidate[] = [];
  for (const hit of hits) {
    const matched = matchConstant(hit, bindings);
    candidates.push({
      id: `${doc.id}:${hit.position}`,
      sourceDocId: doc.id,
      source: doc.source,
      snippet: hit.snippet,
      matchedConstantKey: matched?.binding.key ?? null,
      currentValue: matched?.binding.value ?? null,
      proposedValue: hit.value,
      unit: hit.unit,
      confidence: matched?.score ?? 0.1,
      finding: matched
        ? `Bulletin "${doc.title}" mentions ${hit.value} ${hit.unit} near "${(matched.binding.aliases[0] ?? matched.binding.key)}". ` +
          `Current constant ${matched.binding.key} = ${matched.binding.value}. ` +
          `${matched.binding.value === hit.value ? 'No change required.' : 'Candidate change.'}`
        : `Bulletin "${doc.title}" mentions ${hit.value} ${hit.unit} but no matching constant was found in the binding list. MLRO must classify manually.`,
      citation: `${doc.source} bulletin "${doc.title}" published ${doc.publishedAtIso}`,
    });
  }

  // Drop duplicates with the same matched constant + same proposed value.
  const dedup = new Map<string, RegulatoryCandidate>();
  for (const c of candidates) {
    const key = `${c.matchedConstantKey ?? 'unknown'}:${c.proposedValue}:${c.unit}`;
    const existing = dedup.get(key);
    if (!existing || c.confidence > existing.confidence) dedup.set(key, c);
  }

  // Sort by confidence desc.
  const finalCandidates = Array.from(dedup.values()).sort((a, b) => b.confidence - a.confidence);

  const matchedCount = finalCandidates.filter((c) => c.matchedConstantKey).length;
  const summary =
    finalCandidates.length === 0
      ? `No regulatory values extracted from "${doc.title}".`
      : `${finalCandidates.length} candidate(s) extracted from "${doc.title}" (${matchedCount} matched to live constants).`;

  return {
    schemaVersion: 1,
    documentId: doc.id,
    candidates: finalCandidates,
    summary,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'FDL No.10/2025 Art.24',
      'Cabinet Res 134/2025 Art.19',
      'MoE Circular 08/AML/2021',
      'FATF Rec 1',
      'NIST AI RMF 1.0 GOVERN-1',
    ],
  };
}

// Exports for tests.
export const __test__ = {
  normaliseBulletinText,
  extractRawHits,
  matchConstant,
  parseAed,
};
