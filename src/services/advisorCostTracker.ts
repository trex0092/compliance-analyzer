/**
 * Advisor Cost Tracker — observability for the Anthropic advisor
 * strategy (Sonnet worker + Opus advisor pattern).
 *
 * Why this exists:
 *   The advisor strategy fires Opus 4.6 from inside Sonnet 4.6
 *   (or Haiku 4.5) calls. Opus is materially more expensive per
 *   token than Sonnet, so the question "what fraction of decisions
 *   actually escalated to the advisor, and how much did that cost"
 *   determines whether the strategy is paying for itself.
 *
 *   Until now we had no per-call cost telemetry: every advisor
 *   call left a `modelUsed` string on the decision but no token
 *   counts and no rolled-up spend. The CO could see "advisor
 *   invoked: yes" but not "this month we spent $X on advisor calls
 *   across Y decisions, and the median escalation cost was $Z".
 *
 *   This module fixes that. It is a pure function over a tiny
 *   typed event stream: every advisor call records a CostEvent;
 *   the aggregator rolls the events into a CostReport.
 *
 * Pricing model:
 *   Token prices are loaded from a static table (ANTHROPIC_PRICES)
 *   so updates are a single-line PR. Prices are USD per million
 *   tokens. The table is correct as of this commit but DOES drift
 *   — operators MUST refresh quarterly.
 *
 *   Pricing source: https://www.anthropic.com/pricing (Apr 2026)
 *   - claude-opus-4-6     : $15 in / $75 out
 *   - claude-sonnet-4-6   : $3  in / $15 out
 *   - claude-haiku-4-5    : $1  in / $5  out
 *   - deterministic-fallback : $0 in / $0 out (no API call)
 *
 * Storage:
 *   Events are append-only and held in memory by default. Tests
 *   construct an in-memory tracker; production wires the tracker
 *   to a Netlify Blob store under `advisor-cost:*` for cross-
 *   request persistence.
 *
 * Regulatory basis:
 *   - NIST AI RMF 1.0 GOVERN-3 (oversight + cost accountability)
 *   - NIST AI RMF 1.0 MEASURE-4 (test, evaluate, verify, validate
 *     — including resource-cost validation)
 *   - EU AI Act Art.15 (accuracy + robustness — cost is a
 *     real-world constraint on model selection)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdvisorModel =
  | 'claude-opus-4-6'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5'
  | 'claude-haiku-4-5-20251001'
  | 'deterministic-fallback';

export interface CostEvent {
  /** ISO 8601 timestamp of the call. */
  tsIso: string;
  /** Tenant scope. */
  tenantId: string;
  /** Caller subsystem id, e.g. 'brain-analyze' or 'super-runner'. */
  caller: string;
  /** Model used by the advisor. */
  model: AdvisorModel;
  /** Input tokens consumed (sent to the model). */
  inputTokens: number;
  /** Output tokens produced (received from the model). */
  outputTokens: number;
  /** Verdict the brain produced for this case (for cost-by-verdict). */
  verdict?: 'pass' | 'flag' | 'escalate' | 'freeze';
  /** Which of the six MANDATORY triggers fired the advisor (if known). */
  triggerReason?: string;
}

export interface CostReport {
  totalEvents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalUsdCost: number;
  /** Cost rolled up by model. */
  byModel: Record<
    string,
    { events: number; inputTokens: number; outputTokens: number; usdCost: number }
  >;
  /** Cost rolled up by verdict (or 'unknown' when the verdict was missing). */
  byVerdict: Record<string, { events: number; usdCost: number }>;
  /** Cost rolled up by trigger reason. */
  byTrigger: Record<string, { events: number; usdCost: number }>;
  /** Per-tenant cost. */
  byTenant: Record<string, { events: number; usdCost: number }>;
  /** Plain-English summary safe for the CO weekly digest. */
  summary: string;
  /** Regulatory anchors. */
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Pricing table — USD per 1 million tokens.
// Refresh quarterly. Last verified: 2026-04-15.
// ---------------------------------------------------------------------------

interface PriceRow {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

export const ANTHROPIC_PRICES: Readonly<Record<AdvisorModel, PriceRow>> = {
  'claude-opus-4-6': { inputUsdPerMillion: 15, outputUsdPerMillion: 75 },
  'claude-sonnet-4-6': { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
  'claude-haiku-4-5': { inputUsdPerMillion: 1, outputUsdPerMillion: 5 },
  'claude-haiku-4-5-20251001': { inputUsdPerMillion: 1, outputUsdPerMillion: 5 },
  'deterministic-fallback': { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
};

/**
 * Compute the USD cost for a single advisor call using the static
 * price table. Returns 0 for unknown models so a stray model id
 * cannot crash the pipeline.
 */
export function costForEvent(event: CostEvent): number {
  const row = ANTHROPIC_PRICES[event.model];
  if (!row) return 0;
  const inputCost = (event.inputTokens / 1_000_000) * row.inputUsdPerMillion;
  const outputCost = (event.outputTokens / 1_000_000) * row.outputUsdPerMillion;
  return inputCost + outputCost;
}

// ---------------------------------------------------------------------------
// Aggregator (pure function)
// ---------------------------------------------------------------------------

function emptyBucket(): { events: number; usdCost: number } {
  return { events: 0, usdCost: 0 };
}

function emptyModelBucket(): {
  events: number;
  inputTokens: number;
  outputTokens: number;
  usdCost: number;
} {
  return { events: 0, inputTokens: 0, outputTokens: 0, usdCost: 0 };
}

/**
 * Roll a list of CostEvents into a CostReport. Pure function — same
 * input → same output. Safe to call from any caller.
 */
export function aggregateAdvisorCost(events: readonly CostEvent[]): CostReport {
  const byModel: Record<string, ReturnType<typeof emptyModelBucket>> = {};
  const byVerdict: Record<string, ReturnType<typeof emptyBucket>> = {};
  const byTrigger: Record<string, ReturnType<typeof emptyBucket>> = {};
  const byTenant: Record<string, ReturnType<typeof emptyBucket>> = {};

  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;

  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    const cost = costForEvent(e);
    totalInput += e.inputTokens || 0;
    totalOutput += e.outputTokens || 0;
    totalCost += cost;

    const m = (byModel[e.model] = byModel[e.model] ?? emptyModelBucket());
    m.events += 1;
    m.inputTokens += e.inputTokens || 0;
    m.outputTokens += e.outputTokens || 0;
    m.usdCost += cost;

    const verdictKey = e.verdict ?? 'unknown';
    const v = (byVerdict[verdictKey] = byVerdict[verdictKey] ?? emptyBucket());
    v.events += 1;
    v.usdCost += cost;

    const triggerKey = e.triggerReason ?? 'unknown';
    const t = (byTrigger[triggerKey] = byTrigger[triggerKey] ?? emptyBucket());
    t.events += 1;
    t.usdCost += cost;

    const tenantKey = e.tenantId ?? 'unknown';
    const tn = (byTenant[tenantKey] = byTenant[tenantKey] ?? emptyBucket());
    tn.events += 1;
    tn.usdCost += cost;
  }

  const summary =
    events.length === 0
      ? 'No advisor calls observed in window.'
      : `${events.length} advisor call(s), ${totalInput.toLocaleString()} in tokens, ` +
        `${totalOutput.toLocaleString()} out tokens, total $${totalCost.toFixed(4)} USD.`;

  return {
    totalEvents: events.length,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalUsdCost: totalCost,
    byModel,
    byVerdict,
    byTrigger,
    byTenant,
    summary,
    regulatory: ['NIST AI RMF 1.0 GOVERN-3', 'NIST AI RMF 1.0 MEASURE-4', 'EU AI Act Art.15'],
  };
}

// ---------------------------------------------------------------------------
// Tracker — in-memory append-only buffer + thin persistence hook.
// ---------------------------------------------------------------------------

/**
 * Persistence adapter for cost events. Production wires this to a
 * Netlify Blob handle; tests use the in-memory default.
 */
export interface CostEventStore {
  load(): Promise<readonly CostEvent[]>;
  append(event: CostEvent): Promise<void>;
  reset(): Promise<void>;
}

/** In-memory store for tests + cold function instances. */
export class InMemoryCostEventStore implements CostEventStore {
  private events: CostEvent[] = [];
  async load(): Promise<readonly CostEvent[]> {
    return this.events.slice();
  }
  async append(event: CostEvent): Promise<void> {
    this.events.push(event);
  }
  async reset(): Promise<void> {
    this.events = [];
  }
}

/**
 * Simple tracker — records cost events and produces reports. Stateful
 * (delegates to an injectable store). Pure aggregation.
 */
export class AdvisorCostTracker {
  private readonly store: CostEventStore;
  constructor(store: CostEventStore = new InMemoryCostEventStore()) {
    this.store = store;
  }

  /** Record a cost event. Fire-and-forget — failures are logged. */
  async record(event: CostEvent): Promise<void> {
    try {
      await this.store.append(event);
    } catch (err) {
      console.warn(
        '[advisorCostTracker] append failed:',
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  /** Build a cost report over every recorded event. */
  async report(): Promise<CostReport> {
    const events = await this.store.load();
    return aggregateAdvisorCost(events);
  }

  /**
   * Build a report scoped to a single tenant. Convenience for the
   * CO weekly digest where each tenant gets its own line item.
   */
  async reportForTenant(tenantId: string): Promise<CostReport> {
    const events = (await this.store.load()).filter((e) => e.tenantId === tenantId);
    return aggregateAdvisorCost(events);
  }

  /**
   * Build a report scoped to a date range (inclusive). Used by the
   * monthly cost roll-up cron.
   */
  async reportForRange(startIso: string, endIso: string): Promise<CostReport> {
    const start = Date.parse(startIso);
    const end = Date.parse(endIso);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return aggregateAdvisorCost([]);
    }
    const events = (await this.store.load()).filter((e) => {
      const t = Date.parse(e.tsIso);
      return Number.isFinite(t) && t >= start && t <= end;
    });
    return aggregateAdvisorCost(events);
  }

  /** Clear the buffer. Tests + cron rotation only. */
  async reset(): Promise<void> {
    await this.store.reset();
  }
}

// Exports for tests.
export const __test__ = { emptyBucket, emptyModelBucket };
