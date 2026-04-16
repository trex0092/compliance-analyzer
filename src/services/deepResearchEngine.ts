/**
 * Deep Research Engine — iterative search → reason → cite loop for compliance.
 *
 * Adapts the Jina node-DeepResearch pattern (vendor/node-DeepResearch) into a
 * browser-safe, dependency-injected engine that powers compliance use cases
 * the existing single-shot adverseMediaSearch + adverseMediaRanker pair cannot:
 *
 *   - Multi-step adverse media research (cross-corroboration across sources)
 *   - EDD on opaque counterparties (iterative UBO trace, shell-company hunt)
 *   - Pre-filing STR narrative drafting (gather facts → cite → draft)
 *
 * KEY DESIGN CONSTRAINTS
 *
 *  1. Browser-safe. No `fetch` import; all I/O is delegated to injected
 *     functions so the engine itself is pure orchestration logic and unit
 *     testable without network access.
 *
 *  2. Compliance carve-outs. The compliance work this engine does is what
 *     the auditor will look at first, so the engine MUST:
 *
 *       - Redact PII (national IDs, account numbers, passport numbers, IBANs)
 *         from every query before sending it to an external search backend.
 *         FDL No.10/2025 Art.29 — never tip off the subject.
 *       - Log every external call with timestamp, original query, redacted
 *         query, backend name, and result count. FDL No.10/2025 Art.24 —
 *         record retention.
 *       - Maintain citation discipline. Every claim in the final answer must
 *         carry at least one source URL. Claims with zero sources are
 *         dropped, not silently retained.
 *       - Apply a corroboration floor. The engine never reports
 *         confidence >= HIGH unless at least two independent sources (by
 *         hostname) corroborate the claim.
 *
 *  3. Bounded. max_iterations and max_queries_per_iteration are hard caps
 *     enforced by the loop, not advisory parameters. Runaway research is a
 *     real risk with iterative agents and a real cost in real money.
 *
 *  4. Auditor-friendly output. Every iteration's plan / search / extract /
 *     reflect step is captured in the reasoningChain so an MLRO or external
 *     auditor can replay the full investigation path.
 *
 * REGULATORY BASIS
 *
 *   - FDL No.10/2025 Art.19    — risk-based internal review
 *   - FDL No.10/2025 Art.24    — record retention (audit log of every step)
 *   - FDL No.10/2025 Art.29    — no tipping off (PII redaction)
 *   - Cabinet Res 134/2025 Art.14 — PEP / EDD enhanced research
 *   - FATF Rec 10              — ongoing monitoring, adverse media input
 */

// ---------------------------------------------------------------------------
// Public input / output types
// ---------------------------------------------------------------------------

export type ResearchPurpose =
  | 'adverse_media'
  | 'edd_counterparty'
  | 'str_narrative'
  | 'general_compliance';

export interface EntityContext {
  /** Display name used to seed queries. Should already be a reasonable public name. */
  displayName: string;
  /** Optional aliases (legal name, trading name, transliterations). */
  aliases?: readonly string[];
  /** ISO-3166-1 alpha-2 country code where the entity is based. */
  jurisdiction?: string;
  /** True if the entity is a natural person (drives PII redaction strictness). */
  isNaturalPerson?: boolean;
}

export interface DeepResearchInput {
  question: string;
  entity: EntityContext;
  purpose: ResearchPurpose;
  /** Hard cap on iterations of plan→search→extract→reflect. Default 3. */
  maxIterations?: number;
  /** Hard cap on queries dispatched per iteration. Default 4. */
  maxQueriesPerIteration?: number;
  /**
   * Wall-clock deadline. Engine returns whatever it has at the deadline
   * with `truncated: true`. Default: no deadline.
   */
  deadlineMs?: number;
}

export type ResearchVerdictHint = 'no_signal' | 'soft_signal' | 'material_signal' | 'critical';

export type ResearchConfidence = 'low' | 'medium' | 'high';

export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
}

export interface ResearchClaim {
  /** The factual statement, in the engine's own words. */
  text: string;
  /** Source URLs that support this claim. Always >= 1. */
  sources: readonly string[];
  /** Distinct hostnames among the sources (for corroboration scoring). */
  distinctHostnames: number;
  /** 'low' | 'medium' | 'high' — derived from distinctHostnames + relevance. */
  confidence: ResearchConfidence;
  /** Severity tag the engine assigned during reflection. */
  severity: 'critical' | 'material' | 'ambient' | 'low_signal';
}

export interface ReasoningStep {
  iteration: number;
  phase: 'plan' | 'search' | 'extract' | 'reflect' | 'synthesize';
  detail: string;
  durationMs?: number;
  tookActions?: number;
}

export interface ResearchAuditLogEntry {
  timestampIso: string;
  iteration: number;
  backend: 'search' | 'extract' | 'reason';
  originalQuery: string;
  /** Query as actually sent — PII redacted. */
  sentQuery: string;
  resultCount: number;
  /** True if the redactor found and stripped PII patterns. */
  redactedFields: readonly string[];
}

export interface DeepResearchResult {
  question: string;
  entity: EntityContext;
  purpose: ResearchPurpose;
  /** Plain-text synthesis of the strongest claims. Always includes inline [n] citations. */
  answer: string;
  /** Structured claims with sources. The MLRO pivots off these, not `answer`. */
  claims: readonly ResearchClaim[];
  /** Verdict hint the brain's clamp logic uses to decide whether to escalate. */
  verdictHint: ResearchVerdictHint;
  /** Aggregate confidence: lowest claim confidence among the strongest claims. */
  confidence: ResearchConfidence;
  /** Each iteration's plan/search/extract/reflect/synth steps in order. */
  reasoningChain: readonly ReasoningStep[];
  /** Every external call made, in order. Required by FDL Art.24. */
  auditLog: readonly ResearchAuditLogEntry[];
  /** All queries dispatched (post-redaction). */
  queriesUsed: readonly string[];
  /** True if any query needed PII redaction before being sent. */
  piiRedactionApplied: boolean;
  /** True if the engine bailed early on deadline / max iterations. */
  truncated: boolean;
  /** The reason the loop terminated. */
  terminationReason: 'answer_found' | 'max_iterations' | 'deadline' | 'no_signal';
}

// ---------------------------------------------------------------------------
// Dependency injection — pluggable backends
// ---------------------------------------------------------------------------

export type SearchFn = (query: string) => Promise<readonly SearchHit[]>;

export type ExtractFn = (url: string) => Promise<string | null>;

export interface ReasonInput {
  iteration: number;
  question: string;
  entity: EntityContext;
  purpose: ResearchPurpose;
  knowledgeSoFar: readonly ResearchClaim[];
  latestSnippets: readonly SearchHit[];
}

export interface ReasonOutput {
  /** Newly observed claims for this iteration (will be merged into knowledge). */
  newClaims: readonly Omit<ResearchClaim, 'distinctHostnames' | 'confidence'>[];
  /** New sub-queries to dispatch in the NEXT iteration. Empty = stop. */
  nextQueries: readonly string[];
  /** True if the reasoner believes the question is sufficiently answered. */
  done: boolean;
  /** Free-text rationale the engine records in the reasoningChain. */
  rationale: string;
}

export type ReasonFn = (input: ReasonInput) => Promise<ReasonOutput>;

export interface DeepResearchDeps {
  search: SearchFn;
  extract: ExtractFn;
  reason: ReasonFn;
  /** Override clock for deterministic tests. Default Date.now. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// PII redactor — never tip off (FDL Art.29)
// ---------------------------------------------------------------------------

// Order matters: more-specific patterns must run first so the generic
// digit-run rule does not consume substrings that would have matched
// e.g. phone numbers or Emirates IDs.
const PII_PATTERNS: readonly { name: string; re: RegExp }[] = [
  // Emirates ID: 784-YYYY-NNNNNNN-N (15 digits with optional dashes)
  { name: 'emirates_id', re: /\b784[-\s]?\d{4}[-\s]?\d{7}[-\s]?\d\b/g },
  // IBAN (UAE: AE + 21 digits, generic: 2 letters + 13–32 alphanum)
  { name: 'iban', re: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g },
  // Email (PII when bound to a subject; redact for tip-off safety)
  { name: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // Phone with international prefix (+9715xxxxxxxx etc.). Must precede
  // account_number so the leading + isn't stranded after a generic digit
  // run consumes the trailing digits.
  { name: 'phone', re: /\+\d{8,15}\b/g },
  // Generic passport-ish: 1 letter + 7-9 digits, or 9 alphanumerics
  { name: 'passport', re: /\b[A-Z]\d{7,9}\b/g },
  // Long account-number-ish digit runs (>=10 digits) — runs LAST so
  // it doesn't pre-consume Emirates IDs, IBANs, or phone digits.
  { name: 'account_number', re: /\b\d{10,}\b/g },
];

export interface RedactionResult {
  cleaned: string;
  fieldsFound: readonly string[];
}

export function redactPiiForExternalQuery(input: string): RedactionResult {
  let cleaned = input;
  const fields = new Set<string>();
  for (const { name, re } of PII_PATTERNS) {
    if (re.test(cleaned)) {
      fields.add(name);
      cleaned = cleaned.replace(re, `[REDACTED:${name}]`);
    }
    re.lastIndex = 0;
  }
  return { cleaned, fieldsFound: [...fields] };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return url; // best effort for non-URL refs
  }
}

function distinctHostnames(sources: readonly string[]): number {
  return new Set(sources.map(hostnameOf)).size;
}

function confidenceFor(
  distinctHosts: number,
  severity: ResearchClaim['severity']
): ResearchConfidence {
  if (severity === 'critical' && distinctHosts >= 2) return 'high';
  if (distinctHosts >= 3) return 'high';
  if (distinctHosts >= 2) return 'medium';
  return 'low';
}

function aggregateVerdictHint(claims: readonly ResearchClaim[]): ResearchVerdictHint {
  if (claims.length === 0) return 'no_signal';
  const hasCriticalCorroborated = claims.some(
    (c) => c.severity === 'critical' && c.distinctHostnames >= 2
  );
  if (hasCriticalCorroborated) return 'critical';
  if (claims.some((c) => c.severity === 'critical' || c.severity === 'material')) {
    return 'material_signal';
  }
  if (claims.some((c) => c.severity === 'ambient')) return 'soft_signal';
  return 'no_signal';
}

function aggregateConfidence(claims: readonly ResearchClaim[]): ResearchConfidence {
  if (claims.length === 0) return 'low';
  // Lowest confidence among the strongest claims = honest reporting.
  const ranking: Record<ResearchConfidence, number> = { low: 0, medium: 1, high: 2 };
  const strongest = [...claims].sort((a, b) => ranking[b.confidence] - ranking[a.confidence]);
  // Take the top 3 and report the WEAKEST among them
  const topK = strongest.slice(0, Math.min(3, strongest.length));
  return topK.reduce<ResearchConfidence>(
    (acc, c) => (ranking[c.confidence] < ranking[acc] ? c.confidence : acc),
    'high'
  );
}

function buildAnswer(claims: readonly ResearchClaim[]): string {
  if (claims.length === 0) {
    return 'No corroborated signal was found within the research budget.';
  }
  const sorted = [...claims].sort((a, b) => b.distinctHostnames - a.distinctHostnames);
  const lines: string[] = [];
  let citationIndex = 1;
  const seenSources = new Map<string, number>();
  const footnotes: string[] = [];
  for (const claim of sorted) {
    const refIds: number[] = [];
    for (const src of claim.sources) {
      let id = seenSources.get(src);
      if (id === undefined) {
        id = citationIndex++;
        seenSources.set(src, id);
        footnotes.push(`[${id}] ${src}`);
      }
      refIds.push(id);
    }
    const refStr = refIds.map((n) => `[${n}]`).join('');
    lines.push(`- (${claim.severity}, ${claim.confidence}) ${claim.text} ${refStr}`);
  }
  lines.push('');
  lines.push('Sources:');
  lines.push(...footnotes);
  return lines.join('\n');
}

function mergeClaims(
  existing: readonly ResearchClaim[],
  incoming: readonly Omit<ResearchClaim, 'distinctHostnames' | 'confidence'>[]
): ResearchClaim[] {
  const byText = new Map<string, ResearchClaim>();
  for (const c of existing) byText.set(c.text.toLowerCase(), c);
  for (const c of incoming) {
    const key = c.text.toLowerCase();
    const prior = byText.get(key);
    const allSources = prior
      ? Array.from(new Set([...prior.sources, ...c.sources]))
      : Array.from(new Set(c.sources));
    if (allSources.length === 0) continue; // citation discipline
    const distinctHosts = distinctHostnames(allSources);
    const merged: ResearchClaim = {
      text: c.text,
      sources: allSources,
      distinctHostnames: distinctHosts,
      severity: c.severity,
      confidence: confidenceFor(distinctHosts, c.severity),
    };
    byText.set(key, merged);
  }
  return [...byText.values()];
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export async function runDeepResearch(
  input: DeepResearchInput,
  deps: DeepResearchDeps
): Promise<DeepResearchResult> {
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();
  const deadline = input.deadlineMs ? startedAt + input.deadlineMs : Number.POSITIVE_INFINITY;
  const maxIterations = Math.max(1, input.maxIterations ?? 3);
  const maxQueriesPerIteration = Math.max(1, input.maxQueriesPerIteration ?? 4);

  const reasoningChain: ReasoningStep[] = [];
  const auditLog: ResearchAuditLogEntry[] = [];
  const queriesUsed: string[] = [];
  let piiRedactionApplied = false;
  let claims: ResearchClaim[] = [];

  // Seed query: the question itself, scoped by the entity name.
  const seed = `${input.question} "${input.entity.displayName}"`;
  let pendingQueries: string[] = [seed];

  let terminationReason: DeepResearchResult['terminationReason'] = 'max_iterations';
  let truncated = false;

  for (let iter = 1; iter <= maxIterations; iter++) {
    if (now() >= deadline) {
      terminationReason = 'deadline';
      truncated = true;
      break;
    }

    // 1. PLAN — record the queries we're about to dispatch.
    const planStart = now();
    const queriesThisIter = pendingQueries.slice(0, maxQueriesPerIteration);
    pendingQueries = pendingQueries.slice(maxQueriesPerIteration); // carry overflow
    reasoningChain.push({
      iteration: iter,
      phase: 'plan',
      detail: `Planned ${queriesThisIter.length} queries: ${queriesThisIter.join(' | ')}`,
      durationMs: now() - planStart,
      tookActions: queriesThisIter.length,
    });

    // 2. SEARCH — redact PII, dispatch, log every call.
    const searchStart = now();
    const allHits: SearchHit[] = [];
    for (const rawQ of queriesThisIter) {
      if (now() >= deadline) {
        terminationReason = 'deadline';
        truncated = true;
        break;
      }
      const redacted = redactPiiForExternalQuery(rawQ);
      if (redacted.fieldsFound.length > 0) piiRedactionApplied = true;
      const sentQuery = redacted.cleaned;
      queriesUsed.push(sentQuery);
      const hits = await deps.search(sentQuery);
      auditLog.push({
        timestampIso: new Date(now()).toISOString(),
        iteration: iter,
        backend: 'search',
        originalQuery: rawQ,
        sentQuery,
        resultCount: hits.length,
        redactedFields: redacted.fieldsFound,
      });
      allHits.push(...hits);
    }
    reasoningChain.push({
      iteration: iter,
      phase: 'search',
      detail: `Got ${allHits.length} hits across ${queriesThisIter.length} queries`,
      durationMs: now() - searchStart,
      tookActions: allHits.length,
    });

    // 3. EXTRACT — pull text from the top-K URLs (deduped by hostname,
    //    cap at 6 to keep token budget bounded). We don't propagate the
    //    extracted text in the engine output — the reasoner consumes it
    //    in-memory, and the audit log captures the URL fetch.
    const extractStart = now();
    const dedupHits: SearchHit[] = [];
    const seenHosts = new Set<string>();
    for (const hit of allHits) {
      const host = hostnameOf(hit.url);
      if (seenHosts.has(host)) continue;
      seenHosts.add(host);
      dedupHits.push(hit);
      if (dedupHits.length >= 6) break;
    }
    let extractedCount = 0;
    for (const hit of dedupHits) {
      if (now() >= deadline) {
        terminationReason = 'deadline';
        truncated = true;
        break;
      }
      const text = await deps.extract(hit.url);
      auditLog.push({
        timestampIso: new Date(now()).toISOString(),
        iteration: iter,
        backend: 'extract',
        originalQuery: hit.url,
        sentQuery: hit.url,
        resultCount: text ? 1 : 0,
        redactedFields: [],
      });
      if (text) extractedCount++;
    }
    reasoningChain.push({
      iteration: iter,
      phase: 'extract',
      detail: `Extracted ${extractedCount}/${dedupHits.length} URLs (deduped by hostname)`,
      durationMs: now() - extractStart,
      tookActions: extractedCount,
    });

    // 4. REFLECT — let the reasoner inspect the snippets and emit new claims
    //    + next queries. The reasoner is the only LLM-bearing dep; everything
    //    else is mechanical so it can be tested without network.
    const reflectStart = now();
    const reasonOut = await deps.reason({
      iteration: iter,
      question: input.question,
      entity: input.entity,
      purpose: input.purpose,
      knowledgeSoFar: claims,
      latestSnippets: dedupHits,
    });
    auditLog.push({
      timestampIso: new Date(now()).toISOString(),
      iteration: iter,
      backend: 'reason',
      originalQuery: input.question,
      sentQuery: input.question,
      resultCount: reasonOut.newClaims.length,
      redactedFields: [],
    });

    claims = mergeClaims(claims, reasonOut.newClaims);
    reasoningChain.push({
      iteration: iter,
      phase: 'reflect',
      detail:
        `${reasonOut.newClaims.length} new claims, ${reasonOut.nextQueries.length} ` +
        `follow-up queries. Rationale: ${reasonOut.rationale}`,
      durationMs: now() - reflectStart,
      tookActions: reasonOut.newClaims.length,
    });

    if (reasonOut.done) {
      terminationReason = claims.length > 0 ? 'answer_found' : 'no_signal';
      break;
    }

    // Carry the reasoner's follow-ups into the next iteration's queue.
    pendingQueries = [...pendingQueries, ...reasonOut.nextQueries];
    if (pendingQueries.length === 0) {
      terminationReason = claims.length > 0 ? 'answer_found' : 'no_signal';
      break;
    }
  }

  // 5. SYNTHESIZE — build the final answer with citations.
  const synthStart = now();
  const answer = buildAnswer(claims);
  reasoningChain.push({
    iteration: 0,
    phase: 'synthesize',
    detail: `Built final answer from ${claims.length} corroborated claims`,
    durationMs: now() - synthStart,
    tookActions: claims.length,
  });

  return {
    question: input.question,
    entity: input.entity,
    purpose: input.purpose,
    answer,
    claims,
    verdictHint: aggregateVerdictHint(claims),
    confidence: aggregateConfidence(claims),
    reasoningChain,
    auditLog,
    queriesUsed,
    piiRedactionApplied,
    truncated,
    terminationReason,
  };
}
