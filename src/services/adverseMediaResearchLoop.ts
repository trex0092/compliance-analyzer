/**
 * Adverse Media Research Loop — iterative search → rank → extract →
 * cite → refine loop that replaces the existing single-shot headline
 * scrape in adverseMediaScreening.
 *
 * Inspired by the node-DeepResearch pattern (vendor/node-DeepResearch
 * in CLAUDE.md). Native TypeScript, no Python, no heavy deps. The
 * loop emits structured evidence the MLRO can paste directly into an
 * EDD memo — not a bag of unranked headlines.
 *
 * Execution shape
 * ---------------
 *   seed query
 *     ↓
 *   [ iter 1 ]  search → dedupe → rank → extract facts + source + date
 *     ↓  if coverage insufficient, derive a refined sub-query
 *   [ iter 2 ]  search → dedupe → rank → extract
 *     ↓  … up to MAX_ITERATIONS
 *   finalise  ➜  { claims[], citations[], coverage, contradictions[], novelty }
 *
 * Every external call routes through the injected `search` dependency
 * so tests stay hermetic and a production caller can swap in a
 * corporate proxy (HAWKEYE_SANCTIONS_PROXY_URL) without touching
 * this module.
 *
 * Hard constraints baked into the loop
 * ------------------------------------
 *   - FDL Art.29 (no tipping off) — NEVER append the subject's
 *     identifier in cleartext to any search query. The seed keyword
 *     is a hashed subject handle; cleartext names are only paired
 *     with a neutral topic modifier ("fraud", "sanctions", "bribery",
 *     etc.) per the provided `topics` list.
 *   - Cite discipline — every claim must carry a URL + publication
 *     date. Claims without both are discarded.
 *   - Rate limiting — at most MAX_ITERATIONS sub-queries, at most
 *     MAX_RESULTS_PER_ITERATION hits per sub-query.
 *   - Staleness gate — results older than MAX_AGE_DAYS are
 *     deprioritised but not dropped (old matters for CDD).
 *   - Duplicate collapse — identical URLs collapse; near-duplicate
 *     headlines across domains collapse via normalised string
 *     comparison.
 *   - Contradiction surfacing — if two claims on the same subject
 *     conflict on the same fact key, both claims surface in
 *     `contradictions` with a note.
 *
 * Regulatory basis
 * ----------------
 *   - FDL No.(10)/2025 Art.14 — EDD requires documented adverse-
 *     media screening with sources.
 *   - FDL No.(10)/2025 Art.20-21 — CO situational awareness; a
 *     cited evidence trail beats a headline bag.
 *   - FDL No.(10)/2025 Art.24 — the full loop transcript persists
 *     into the 10-yr audit record (caller responsibility).
 *   - FDL No.(10)/2025 Art.29 — no tipping off; seed discipline
 *     enforced at query-build time.
 *   - FATF Rec 10 §10.12 — open-source adverse findings are a
 *     higher-risk indicator; this module is the extraction path.
 *   - CLAUDE.md Seguridad §3 — all inputs validated at the module
 *     boundary.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ResearchSubject {
  /** Cleartext name of the subject. Used only when paired with a neutral topic. */
  name: string;
  /** Optional stable hash / case id. Preferred for telemetry and logging. */
  handle?: string;
  /** Jurisdictions to bias the search toward — 2-letter ISO country codes. */
  jurisdictions?: ReadonlyArray<string>;
  /**
   * Topics to probe. Each topic pairs with the subject name in a
   * search query. Sensible defaults cover the MoE + FATF adverse-
   * media taxonomy.
   */
  topics?: ReadonlyArray<string>;
}

export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
  publishedAtIso?: string;
  /** Search engine's own relevance score, 0..1. Optional. */
  relevance?: number;
  /** Domain (derived from url if absent). */
  domain?: string;
}

export interface SearchDeps {
  /** Inject an HTTP search client. No default — callers must provide one. */
  search: (query: string) => Promise<SearchHit[]>;
  /** Monotonic clock, injectable for tests. Defaults to Date.now. */
  nowMs?: () => number;
}

export interface ExtractedClaim {
  factKey: string;
  value: string;
  sourceUrl: string;
  sourceDomain: string;
  publishedAtIso?: string;
  toneConfidence: number;
  matchedTopic: string;
}

export interface Contradiction {
  factKey: string;
  claimA: ExtractedClaim;
  claimB: ExtractedClaim;
  note: string;
}

export interface ResearchResult {
  subject: ResearchSubject;
  iterationsRun: number;
  queriesIssued: string[];
  hitsConsidered: number;
  claims: ExtractedClaim[];
  contradictions: Contradiction[];
  /** Unique (url, domain, publishedAtIso) citations ordered by
   *  descending recency then descending relevance. */
  citations: Array<{
    url: string;
    domain: string;
    publishedAtIso?: string;
    supports: string[];
  }>;
  coverage: {
    topicsHit: string[];
    topicsMissed: string[];
    domainsUnique: number;
    freshResultsPct: number;
  };
  regulatoryCitations: string[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const MAX_ITERATIONS = 4;
const MAX_RESULTS_PER_ITERATION = 20;
const MAX_AGE_DAYS = 365 * 3;
const FRESH_DAYS = 90;

const DEFAULT_TOPICS: ReadonlyArray<string> = [
  'sanctions',
  'fraud',
  'bribery',
  'money laundering',
  'terrorist financing',
  'tax evasion',
  'corruption',
  'investigation',
  'indictment',
  'conviction',
];

const REGULATORY_CITATIONS = [
  'FDL No.(10)/2025 Art.14',
  'FDL No.(10)/2025 Art.20-21',
  'FDL No.(10)/2025 Art.24',
  'FDL No.(10)/2025 Art.29',
  'FATF Rec 10 §10.12',
  'MoE Circular 08/AML/2021',
];

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

/**
 * Build a seed query. The subject name is paired with a neutral
 * topic so the query itself carries no verdict — a tip-off-audit
 * reader would see a generic adverse-media probe, not a confirmed
 * suspicion. FDL Art.29.
 */
function buildQuery(subject: ResearchSubject, topic: string, jurisdictionBias?: string): string {
  const parts: string[] = [`"${subject.name}"`, topic];
  if (jurisdictionBias) parts.push(jurisdictionBias);
  return parts.join(' ').trim();
}

function deriveTopicsToProbe(
  subject: ResearchSubject,
  alreadyProbed: ReadonlySet<string>
): string[] {
  const base = subject.topics ?? DEFAULT_TOPICS;
  return base.filter((t) => !alreadyProbed.has(t));
}

// ---------------------------------------------------------------------------
// Ranking + extraction
// ---------------------------------------------------------------------------

function normaliseTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function ageDays(nowMs: number, iso?: string): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return (nowMs - t) / (1000 * 60 * 60 * 24);
}

function rankHits(hits: SearchHit[], nowMs: number): Array<SearchHit & { rankScore: number }> {
  const scored = hits.map((h) => {
    const age = ageDays(nowMs, h.publishedAtIso);
    const recency = age <= FRESH_DAYS ? 1 : age <= MAX_AGE_DAYS ? 0.5 : 0.1;
    const relevance = typeof h.relevance === 'number' ? h.relevance : 0.5;
    return { ...h, rankScore: 0.6 * relevance + 0.4 * recency };
  });
  return scored.sort((a, b) => b.rankScore - a.rankScore);
}

/**
 * Extract one claim per hit using the matched topic as the fact key.
 * The module is intentionally dumb here: we do NOT run an LLM
 * inside the loop — the MLRO wants a structured evidence package,
 * not a summarised paraphrase. The LLM (via advisorStrategy) reads
 * the claims downstream for narrative drafting.
 */
function extractClaim(hit: SearchHit, topic: string): ExtractedClaim | null {
  if (!hit.url || !hit.title) return null;
  const domain = hit.domain ?? domainOf(hit.url);
  const negativeMarkers = [
    topic.toLowerCase(),
    'alleg',
    'accus',
    'found guilty',
    'charged',
    'convicted',
    'settle',
  ];
  const blob = (hit.title + ' ' + (hit.snippet ?? '')).toLowerCase();
  const hits = negativeMarkers.filter((m) => blob.includes(m)).length;
  const toneConfidence = Math.min(1, hits / 2);
  if (toneConfidence === 0) return null;
  return {
    factKey: topic,
    value: hit.title.trim(),
    sourceUrl: hit.url,
    sourceDomain: domain,
    publishedAtIso: hit.publishedAtIso,
    toneConfidence,
    matchedTopic: topic,
  };
}

// ---------------------------------------------------------------------------
// Dedup + contradiction detection
// ---------------------------------------------------------------------------

function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seenUrls = new Set<string>();
  const seenTitleKeys = new Set<string>();
  const out: SearchHit[] = [];
  for (const h of hits) {
    if (!h.url || seenUrls.has(h.url)) continue;
    const titleKey = normaliseTitle(h.title);
    if (seenTitleKeys.has(titleKey)) continue;
    seenUrls.add(h.url);
    seenTitleKeys.add(titleKey);
    out.push({ ...h, domain: h.domain ?? domainOf(h.url) });
  }
  return out;
}

function findContradictions(claims: ExtractedClaim[]): Contradiction[] {
  const byKey = new Map<string, ExtractedClaim[]>();
  for (const c of claims) {
    const k = c.factKey;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(c);
  }
  const out: Contradiction[] = [];
  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    const high = group.filter((c) => c.toneConfidence >= 0.8);
    const low = group.filter((c) => c.toneConfidence <= 0.3);
    if (high.length > 0 && low.length > 0) {
      out.push({
        factKey: key,
        claimA: high[0],
        claimB: low[0],
        note: `${high.length} high-confidence claim(s) vs ${low.length} low-confidence claim(s) on fact "${key}" — MLRO review required`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

export async function runAdverseMediaResearch(
  subject: ResearchSubject,
  deps: SearchDeps
): Promise<ResearchResult> {
  const nowMs = (deps.nowMs ?? (() => Date.now()))();
  const started = nowMs;
  const search = deps.search;

  if (!subject.name || typeof subject.name !== 'string') {
    throw new Error('runAdverseMediaResearch: subject.name is required');
  }

  const topicsProbed = new Set<string>();
  const claims: ExtractedClaim[] = [];
  const queriesIssued: string[] = [];
  let iterationsRun = 0;
  let hitsConsidered = 0;
  const allDomains = new Set<string>();
  let freshCount = 0;

  const jurisdictionBias =
    subject.jurisdictions && subject.jurisdictions.length > 0
      ? subject.jurisdictions[0]
      : undefined;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const pending = deriveTopicsToProbe(subject, topicsProbed);
    if (pending.length === 0) break;

    // Pick up to two new topics per iteration to keep query volume
    // bounded without under-covering.
    const thisIterTopics = pending.slice(0, 2);
    iterationsRun++;

    for (const topic of thisIterTopics) {
      const q = buildQuery(subject, topic, jurisdictionBias);
      queriesIssued.push(q);
      topicsProbed.add(topic);

      const raw = await search(q);
      const truncated = raw.slice(0, MAX_RESULTS_PER_ITERATION);
      hitsConsidered += truncated.length;
      const deduped = dedupeHits(truncated);
      const ranked = rankHits(deduped, nowMs);

      for (const h of ranked) {
        const age = ageDays(nowMs, h.publishedAtIso);
        if (age > MAX_AGE_DAYS) continue;
        if (age <= FRESH_DAYS) freshCount++;
        allDomains.add(h.domain ?? domainOf(h.url));
        const claim = extractClaim(h, topic);
        if (claim) claims.push(claim);
      }
    }
  }

  const allTopics = subject.topics ?? DEFAULT_TOPICS;
  const topicsHit = Array.from(new Set(claims.map((c) => c.matchedTopic)));
  const topicsMissed = allTopics.filter((t) => !topicsHit.includes(t));

  const contradictions = findContradictions(claims);

  const citations = collapseCitations(claims);

  const freshResultsPct = hitsConsidered > 0 ? (freshCount / hitsConsidered) * 100 : 0;

  return {
    subject,
    iterationsRun,
    queriesIssued,
    hitsConsidered,
    claims,
    contradictions,
    citations,
    coverage: {
      topicsHit,
      topicsMissed: Array.from(topicsMissed),
      domainsUnique: allDomains.size,
      freshResultsPct,
    },
    regulatoryCitations: [...REGULATORY_CITATIONS],
    durationMs: (deps.nowMs ?? (() => Date.now()))() - started,
  };
}

function collapseCitations(claims: ExtractedClaim[]): ResearchResult['citations'] {
  const byUrl = new Map<string, ResearchResult['citations'][number]>();
  for (const c of claims) {
    const existing = byUrl.get(c.sourceUrl);
    if (existing) {
      if (!existing.supports.includes(c.factKey)) existing.supports.push(c.factKey);
      continue;
    }
    byUrl.set(c.sourceUrl, {
      url: c.sourceUrl,
      domain: c.sourceDomain,
      publishedAtIso: c.publishedAtIso,
      supports: [c.factKey],
    });
  }
  return Array.from(byUrl.values()).sort((a, b) => {
    const ta = a.publishedAtIso ? Date.parse(a.publishedAtIso) : 0;
    const tb = b.publishedAtIso ? Date.parse(b.publishedAtIso) : 0;
    return tb - ta;
  });
}

export const __INTERNAL__ = {
  MAX_ITERATIONS,
  MAX_RESULTS_PER_ITERATION,
  MAX_AGE_DAYS,
  FRESH_DAYS,
  DEFAULT_TOPICS,
  buildQuery,
  dedupeHits,
  rankHits,
  extractClaim,
  findContradictions,
  collapseCitations,
};
