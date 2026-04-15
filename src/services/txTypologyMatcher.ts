/**
 * TM Typology Matcher — FATF / MoE typology pattern detection.
 *
 * The rule engine catches bright-line threshold breaches (CTR,
 * cross-border cash, structuring). This layer catches multi-
 * transaction patterns that look like known money-laundering
 * typologies:
 *
 *   - smurfing:     many small cash deposits under the CTR ceiling
 *                   by one customer over a short window
 *   - layering:     fast in-out rotation through multiple
 *                   counterparties in a short window
 *   - round-trip:   funds return to the originator via a short
 *                   counterparty chain
 *   - tbml-price-anomaly: trade-based money laundering — purchase
 *                   / sale price outside a reasonable corridor
 *   - hawala-pattern:  paired cash-in / cash-out with third-party
 *                      counterparty and no documented contract
 *   - shell-passthrough: sequential credit + debit of nearly the
 *                        same amount within 48h, counterparty is a
 *                        shell indicator
 *
 * Pure function. Takes a batch of transactions (one customer's
 * window), returns findings.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.15
 *   FDL No.10/2025 Art.26-27   (STR filing)
 *   FATF Typologies Report 2021 — Gold & Precious Metals
 *   FATF Rec 10, 11, 20, 21
 *   Cabinet Res 134/2025 Art.14
 *   MoE Circular 08/AML/2021
 */

import {
  DPMS_CASH_CTR_THRESHOLD_AED,
  STRUCTURING_BELOW_PERCENT,
  type TmFinding,
  type Transaction,
} from '../domain/transaction';

// ---------------------------------------------------------------------------
// Helpers shared across typologies
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function shortHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

function makeFindingId(customerId: string, kind: string, txIds: readonly string[]): string {
  return `${customerId}:${kind}:${shortHash([...txIds].sort().join(','))}`;
}

function toMs(tx: Transaction): number {
  return Date.parse(tx.atIso);
}

// ---------------------------------------------------------------------------
// 1. Smurfing — 3+ cash deposits just under CTR threshold in a 7-day window
// ---------------------------------------------------------------------------

interface SmurfingOptions {
  readonly windowDays?: number;
  readonly minCount?: number;
}

function detectSmurfing(
  txs: readonly Transaction[],
  opts: SmurfingOptions = {}
): readonly TmFinding[] {
  const windowDays = opts.windowDays ?? 7;
  const minCount = opts.minCount ?? 3;
  const bandFloor = DPMS_CASH_CTR_THRESHOLD_AED * (1 - STRUCTURING_BELOW_PERCENT * 2);
  const candidates = txs
    .filter(
      (tx) =>
        tx.instrument === 'cash' &&
        tx.direction === 'credit' &&
        tx.amountAed >= bandFloor &&
        tx.amountAed < DPMS_CASH_CTR_THRESHOLD_AED
    )
    .sort((a, b) => toMs(a) - toMs(b));
  if (candidates.length < minCount) return [];

  const out: TmFinding[] = [];
  const windowMs = windowDays * MS_PER_DAY;
  const grouped: Map<string, Transaction[]> = new Map();

  for (const tx of candidates) {
    const start = toMs(tx);
    const bucket: Transaction[] = [tx];
    for (const other of candidates) {
      if (other.id === tx.id) continue;
      const delta = toMs(other) - start;
      if (delta > 0 && delta <= windowMs) bucket.push(other);
    }
    if (bucket.length >= minCount) {
      // De-dupe by sorted id set.
      const key = bucket
        .map((x) => x.id)
        .sort()
        .join('|');
      if (!grouped.has(key)) grouped.set(key, bucket);
    }
  }

  for (const bucket of grouped.values()) {
    const totalAed = bucket.reduce((sum, x) => sum + x.amountAed, 0);
    const ids = bucket.map((x) => x.id);
    const customerId = bucket[0]!.customerId;
    out.push({
      id: makeFindingId(customerId, 'smurfing', ids),
      customerId,
      kind: 'smurfing',
      severity: 'high',
      message: `Smurfing pattern: ${bucket.length} cash credits totalling AED ${totalAed.toLocaleString('en-AE')} within ${windowDays} days, each just below the AED ${DPMS_CASH_CTR_THRESHOLD_AED.toLocaleString('en-AE')} CTR threshold. Classic structuring.`,
      regulatory: 'FATF Rec 20 / MoE Circular 08/AML/2021',
      triggeringTxIds: ids,
      confidence: 0.9,
      suggestedAction: 'auto-str',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Layering — 4+ counterparties touched in 48h with similar amounts
// ---------------------------------------------------------------------------

function detectLayering(txs: readonly Transaction[]): readonly TmFinding[] {
  const windowMs = 48 * 60 * 60 * 1000;
  const sorted = [...txs].sort((a, b) => toMs(a) - toMs(b));
  const out: TmFinding[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < sorted.length; i++) {
    const anchor = sorted[i]!;
    const bucket = [anchor];
    const counterparties = new Set([anchor.counterpartyName]);
    for (let j = i + 1; j < sorted.length; j++) {
      const next = sorted[j]!;
      if (toMs(next) - toMs(anchor) > windowMs) break;
      bucket.push(next);
      counterparties.add(next.counterpartyName);
    }
    if (counterparties.size < 4) continue;
    if (bucket.length < 4) continue;
    // Require the amounts to be within 20% of each other (layering
    // typology — "evenly spread" rotation).
    const amounts = bucket.map((x) => x.amountAed);
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const maxDev = Math.max(...amounts.map((a) => Math.abs(a - avg) / avg));
    if (maxDev > 0.2) continue;
    const ids = bucket.map((x) => x.id);
    const key = ids.sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const customerId = anchor.customerId;
    out.push({
      id: makeFindingId(customerId, 'layering', ids),
      customerId,
      kind: 'layering',
      severity: 'high',
      message: `Layering pattern: ${bucket.length} transactions across ${counterparties.size} counterparties within 48h, amounts within ±20% of AED ${Math.round(avg).toLocaleString('en-AE')}. Rotation-through-nominees typology.`,
      regulatory: 'FATF Typologies Report 2021 / FDL Art.15',
      triggeringTxIds: ids,
      confidence: 0.8,
      suggestedAction: 'escalate',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. Round-trip — funds return to originator via short chain
// ---------------------------------------------------------------------------

function detectRoundTrip(txs: readonly Transaction[]): readonly TmFinding[] {
  // Pair a debit and a credit of near-identical amount within 72h
  // where the credit counterparty matches the debit counterparty.
  const windowMs = 72 * 60 * 60 * 1000;
  const out: TmFinding[] = [];
  const seen = new Set<string>();
  const sorted = [...txs].sort((a, b) => toMs(a) - toMs(b));
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    if (a.direction !== 'debit') continue;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (toMs(b) - toMs(a) > windowMs) break;
      if (b.direction !== 'credit') continue;
      if (b.counterpartyName !== a.counterpartyName) continue;
      const ratio = Math.abs(a.amountAed - b.amountAed) / a.amountAed;
      if (ratio > 0.1) continue;
      const ids = [a.id, b.id];
      const key = [...ids].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: makeFindingId(a.customerId, 'round-trip', ids),
        customerId: a.customerId,
        kind: 'round-trip',
        severity: 'high',
        message: `Round-trip pattern: debit of AED ${a.amountAed.toLocaleString('en-AE')} to ${a.counterpartyName} returned as credit of AED ${b.amountAed.toLocaleString('en-AE')} within 72h. Funds rotation.`,
        regulatory: 'FATF Typologies Report 2021',
        triggeringTxIds: ids,
        confidence: 0.85,
        suggestedAction: 'escalate',
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. TBML price anomaly — gold/precious-metals purchase outside corridor
// ---------------------------------------------------------------------------

export interface TbmlCorridor {
  /** Asset identifier recognised in tx.reference (e.g. "GOLD_OZ_T"). */
  readonly asset: string;
  /** Fair-value lower bound in AED per unit. */
  readonly minAedPerUnit: number;
  /** Fair-value upper bound in AED per unit. */
  readonly maxAedPerUnit: number;
  /** Unit of the asset (tola, oz, kg, gram). */
  readonly unit: string;
}

function parseQuantity(reference: string): { qty: number; asset: string } | null {
  // Accepts references like "GOLD_OZ_T:12" or "1KG_GOLD" — caller
  // injects the parser in more complex setups. Simple regex here.
  const m = /([A-Z_]+):(\d+(?:\.\d+)?)/.exec(reference);
  if (m) return { asset: m[1]!, qty: parseFloat(m[2]!) };
  return null;
}

function detectTbmlPriceAnomaly(
  txs: readonly Transaction[],
  corridors: readonly TbmlCorridor[]
): readonly TmFinding[] {
  if (corridors.length === 0) return [];
  const out: TmFinding[] = [];
  for (const tx of txs) {
    if (!tx.reference) continue;
    const parsed = parseQuantity(tx.reference);
    if (!parsed) continue;
    const corridor = corridors.find((c) => c.asset === parsed.asset);
    if (!corridor) continue;
    const perUnit = tx.amountAed / parsed.qty;
    if (perUnit >= corridor.minAedPerUnit && perUnit <= corridor.maxAedPerUnit) continue;
    const deviation =
      perUnit < corridor.minAedPerUnit
        ? `${(((corridor.minAedPerUnit - perUnit) / corridor.minAedPerUnit) * 100).toFixed(1)}% below fair`
        : `${(((perUnit - corridor.maxAedPerUnit) / corridor.maxAedPerUnit) * 100).toFixed(1)}% above fair`;
    out.push({
      id: makeFindingId(tx.customerId, 'tbml-price-anomaly', [tx.id]),
      customerId: tx.customerId,
      kind: 'tbml-price-anomaly',
      severity: 'high',
      message: `TBML price anomaly: ${parsed.asset} purchased at AED ${Math.round(perUnit).toLocaleString('en-AE')}/${corridor.unit}, fair corridor AED ${corridor.minAedPerUnit.toLocaleString('en-AE')} – ${corridor.maxAedPerUnit.toLocaleString('en-AE')}/${corridor.unit} (${deviation}).`,
      regulatory: 'FATF Typologies 2021 / LBMA RGG v9',
      triggeringTxIds: [tx.id],
      confidence: 0.85,
      suggestedAction: 'escalate',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. Hawala pattern — paired cash-in / cash-out via third-party
// ---------------------------------------------------------------------------

function detectHawala(txs: readonly Transaction[]): readonly TmFinding[] {
  const windowMs = 7 * MS_PER_DAY;
  const out: TmFinding[] = [];
  const seen = new Set<string>();
  const cashIn = txs.filter((t) => t.instrument === 'cash' && t.direction === 'credit');
  const cashOut = txs.filter((t) => t.instrument === 'cash' && t.direction === 'debit');
  for (const inTx of cashIn) {
    for (const outTx of cashOut) {
      const delta = Math.abs(toMs(outTx) - toMs(inTx));
      if (delta > windowMs) continue;
      // Counterparty names differ (third-party settlement is hawala's signature).
      if (inTx.counterpartyName === outTx.counterpartyName) continue;
      // Amounts within 5%.
      const ratio = Math.abs(inTx.amountAed - outTx.amountAed) / inTx.amountAed;
      if (ratio > 0.05) continue;
      const ids = [inTx.id, outTx.id];
      const key = [...ids].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: makeFindingId(inTx.customerId, 'hawala-pattern', ids),
        customerId: inTx.customerId,
        kind: 'hawala-pattern',
        severity: 'critical',
        message: `Hawala pattern: cash credit of AED ${inTx.amountAed.toLocaleString('en-AE')} from ${inTx.counterpartyName} paired with cash debit of AED ${outTx.amountAed.toLocaleString('en-AE')} to ${outTx.counterpartyName} within 7 days. Third-party settlement without a contract is a hawala red flag.`,
        regulatory: 'FDL Art.15 / FATF Typologies 2021',
        triggeringTxIds: ids,
        confidence: 0.75,
        suggestedAction: 'auto-str',
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 6. Shell passthrough — sequential credit+debit of nearly identical amounts
// ---------------------------------------------------------------------------

function detectShellPassthrough(txs: readonly Transaction[]): readonly TmFinding[] {
  const windowMs = 48 * 60 * 60 * 1000;
  const out: TmFinding[] = [];
  const seen = new Set<string>();
  const sorted = [...txs].sort((a, b) => toMs(a) - toMs(b));
  for (let i = 0; i < sorted.length - 1; i++) {
    const credit = sorted[i]!;
    const debit = sorted[i + 1]!;
    if (credit.direction !== 'credit') continue;
    if (debit.direction !== 'debit') continue;
    if (toMs(debit) - toMs(credit) > windowMs) continue;
    const ratio = Math.abs(credit.amountAed - debit.amountAed) / credit.amountAed;
    if (ratio > 0.02) continue;
    const ids = [credit.id, debit.id];
    const key = [...ids].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: makeFindingId(credit.customerId, 'shell-passthrough', ids),
      customerId: credit.customerId,
      kind: 'shell-passthrough',
      severity: 'high',
      message: `Shell passthrough: credit of AED ${credit.amountAed.toLocaleString('en-AE')} from ${credit.counterpartyName} followed by debit of AED ${debit.amountAed.toLocaleString('en-AE')} to ${debit.counterpartyName} within 48h. Account used as passthrough.`,
      regulatory: 'FATF Typologies 2021 / FDL Art.15',
      triggeringTxIds: ids,
      confidence: 0.75,
      suggestedAction: 'escalate',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface TypologyOptions {
  readonly tbmlCorridors?: readonly TbmlCorridor[];
  readonly smurfingWindowDays?: number;
  readonly smurfingMinCount?: number;
}

/**
 * Run every typology matcher over the transaction batch. Pure.
 * Caller is responsible for scoping the batch to a single customer
 * (or passing a cross-customer batch and accepting findings that
 * span customers — the finding structure carries the customerId so
 * the orchestrator can partition afterwards).
 */
export function runTypologyMatcher(
  transactions: readonly Transaction[],
  options: TypologyOptions = {}
): readonly TmFinding[] {
  const out: TmFinding[] = [];
  out.push(
    ...detectSmurfing(transactions, {
      windowDays: options.smurfingWindowDays,
      minCount: options.smurfingMinCount,
    })
  );
  out.push(...detectLayering(transactions));
  out.push(...detectRoundTrip(transactions));
  out.push(...detectTbmlPriceAnomaly(transactions, options.tbmlCorridors ?? []));
  out.push(...detectHawala(transactions));
  out.push(...detectShellPassthrough(transactions));
  return out;
}
