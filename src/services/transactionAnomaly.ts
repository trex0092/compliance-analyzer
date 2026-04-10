/**
 * Transaction Anomaly Detection — statistical pattern recognition.
 *
 * Rule-based monitoring catches what you already know to look for.
 * This module catches what you don't. Implemented as a set of
 * detectors that each produce `AnomalyFinding`s. Each detector is
 * pure and independently testable.
 *
 * Detectors:
 *   1. structuring — transactions clustered just below a threshold
 *   2. fanIn       — many small inflows from different counterparties
 *                    aggregated into one wallet/account
 *   3. fanOut      — one inflow distributed to many counterparties
 *   4. cycling     — A → B → A round-trips (layering)
 *   5. velocity    — unusual transaction rate (z-score on daily count)
 *   6. amountEntropy — unnatural amount regularity (all same, or
 *                      all round-numbered)
 *
 * Regulatory anchoring:
 *   - Cabinet Res 134/2025 Art.19 — internal review of unusual activity
 *   - FATF Rec 20 — suspicious transaction reporting
 *   - MoE Circular 08/AML/2021 — DPMS-specific typologies
 */

import { DPMS_CASH_THRESHOLD_AED } from '../domain/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Transaction {
  id: string;
  /** ISO 8601 timestamp. */
  at: string;
  /** AED amount (positive for inflow to subject, negative for outflow). */
  amountAED: number;
  counterpartyId: string;
  /** Optional — the customer id this transaction belongs to. */
  customerId?: string;
  /** Optional free-form metadata. */
  meta?: Record<string, unknown>;
}

export type AnomalyKind =
  | 'structuring'
  | 'fan_in'
  | 'fan_out'
  | 'cycling'
  | 'velocity'
  | 'amount_entropy';

export interface AnomalyFinding {
  kind: AnomalyKind;
  severity: 'low' | 'medium' | 'high';
  /** 0..1 confidence. */
  confidence: number;
  summary: string;
  transactionIds: string[];
  meta: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 1. Structuring — just-below-threshold clustering
// ---------------------------------------------------------------------------

export interface StructuringConfig {
  threshold: number;
  /** How close to the threshold counts as "just below". Default 10%. */
  bandRatio: number;
  /** Minimum count in the band to flag. */
  minCount: number;
  /** Window in days — transactions outside this window are not correlated. */
  windowDays: number;
}

const STRUCTURING_DEFAULTS: StructuringConfig = {
  threshold: DPMS_CASH_THRESHOLD_AED,
  bandRatio: 0.1,
  minCount: 3,
  windowDays: 14,
};

export function detectStructuring(
  txs: readonly Transaction[],
  config: Partial<StructuringConfig> = {},
): AnomalyFinding[] {
  const cfg = { ...STRUCTURING_DEFAULTS, ...config };
  const lowerBound = cfg.threshold * (1 - cfg.bandRatio);
  const upperBound = cfg.threshold;

  // Transactions in the just-below band
  const inBand = txs.filter(
    (t) => Math.abs(t.amountAED) >= lowerBound && Math.abs(t.amountAED) < upperBound,
  );

  if (inBand.length < cfg.minCount) return [];

  // Group by customer + windowDays rolling window
  const byCustomer = new Map<string, Transaction[]>();
  for (const t of inBand) {
    const key = t.customerId ?? 'unknown';
    const list = byCustomer.get(key) ?? [];
    list.push(t);
    byCustomer.set(key, list);
  }

  const findings: AnomalyFinding[] = [];
  for (const [customerId, list] of byCustomer) {
    // Sort by timestamp
    list.sort((a, b) => a.at.localeCompare(b.at));
    // Sliding window
    let left = 0;
    for (let right = 0; right < list.length; right++) {
      const windowMs = cfg.windowDays * 24 * 60 * 60 * 1000;
      while (
        new Date(list[right].at).getTime() - new Date(list[left].at).getTime() >
        windowMs
      ) {
        left++;
      }
      const windowTxs = list.slice(left, right + 1);
      if (windowTxs.length >= cfg.minCount) {
        findings.push({
          kind: 'structuring',
          severity: windowTxs.length >= 2 * cfg.minCount ? 'high' : 'medium',
          confidence: Math.min(1, windowTxs.length / (cfg.minCount * 2)),
          summary: `${windowTxs.length} cash transactions in [${lowerBound}-${upperBound}] AED within ${cfg.windowDays} days for customer ${customerId}`,
          transactionIds: windowTxs.map((t) => t.id),
          meta: {
            customerId,
            count: windowTxs.length,
            lowerBound,
            upperBound,
            totalValue: windowTxs.reduce((s, t) => s + Math.abs(t.amountAED), 0),
          },
        });
        // Only one finding per customer
        break;
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 2. Fan-in — many distinct counterparties → one subject
// ---------------------------------------------------------------------------

export interface FanConfig {
  minUniqueCounterparties: number;
  windowDays: number;
}

const FAN_DEFAULTS: FanConfig = { minUniqueCounterparties: 10, windowDays: 7 };

export function detectFanIn(
  txs: readonly Transaction[],
  config: Partial<FanConfig> = {},
): AnomalyFinding[] {
  const cfg = { ...FAN_DEFAULTS, ...config };
  const byCustomer = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.amountAED <= 0) continue; // inflows only
    const key = t.customerId ?? 'unknown';
    const list = byCustomer.get(key) ?? [];
    list.push(t);
    byCustomer.set(key, list);
  }

  const findings: AnomalyFinding[] = [];
  const windowMs = cfg.windowDays * 24 * 60 * 60 * 1000;
  for (const [customerId, list] of byCustomer) {
    list.sort((a, b) => a.at.localeCompare(b.at));
    let left = 0;
    for (let right = 0; right < list.length; right++) {
      while (
        new Date(list[right].at).getTime() - new Date(list[left].at).getTime() > windowMs
      ) {
        left++;
      }
      const windowTxs = list.slice(left, right + 1);
      const uniqueCps = new Set(windowTxs.map((t) => t.counterpartyId));
      if (uniqueCps.size >= cfg.minUniqueCounterparties) {
        findings.push({
          kind: 'fan_in',
          severity: uniqueCps.size >= 2 * cfg.minUniqueCounterparties ? 'high' : 'medium',
          confidence: Math.min(1, uniqueCps.size / (cfg.minUniqueCounterparties * 2)),
          summary: `${uniqueCps.size} distinct counterparties sent funds to ${customerId} in ${cfg.windowDays} days`,
          transactionIds: windowTxs.map((t) => t.id),
          meta: {
            customerId,
            uniqueCounterparties: uniqueCps.size,
            totalValue: windowTxs.reduce((s, t) => s + t.amountAED, 0),
          },
        });
        break;
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 3. Fan-out — one subject → many distinct counterparties
// ---------------------------------------------------------------------------

export function detectFanOut(
  txs: readonly Transaction[],
  config: Partial<FanConfig> = {},
): AnomalyFinding[] {
  const cfg = { ...FAN_DEFAULTS, ...config };
  const byCustomer = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.amountAED >= 0) continue; // outflows only
    const key = t.customerId ?? 'unknown';
    const list = byCustomer.get(key) ?? [];
    list.push(t);
    byCustomer.set(key, list);
  }

  const findings: AnomalyFinding[] = [];
  const windowMs = cfg.windowDays * 24 * 60 * 60 * 1000;
  for (const [customerId, list] of byCustomer) {
    list.sort((a, b) => a.at.localeCompare(b.at));
    let left = 0;
    for (let right = 0; right < list.length; right++) {
      while (
        new Date(list[right].at).getTime() - new Date(list[left].at).getTime() > windowMs
      ) {
        left++;
      }
      const windowTxs = list.slice(left, right + 1);
      const uniqueCps = new Set(windowTxs.map((t) => t.counterpartyId));
      if (uniqueCps.size >= cfg.minUniqueCounterparties) {
        findings.push({
          kind: 'fan_out',
          severity: uniqueCps.size >= 2 * cfg.minUniqueCounterparties ? 'high' : 'medium',
          confidence: Math.min(1, uniqueCps.size / (cfg.minUniqueCounterparties * 2)),
          summary: `${customerId} sent funds to ${uniqueCps.size} distinct counterparties in ${cfg.windowDays} days`,
          transactionIds: windowTxs.map((t) => t.id),
          meta: {
            customerId,
            uniqueCounterparties: uniqueCps.size,
            totalValue: windowTxs.reduce((s, t) => s + Math.abs(t.amountAED), 0),
          },
        });
        break;
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 4. Cycling — A → B → A round-trips
// ---------------------------------------------------------------------------

export interface CyclingConfig {
  /** Max time in hours between the outflow and the return inflow. */
  maxHours: number;
  /** Amount tolerance — return must be within this percentage of the outflow. */
  amountTolerance: number;
}

const CYCLING_DEFAULTS: CyclingConfig = { maxHours: 72, amountTolerance: 0.15 };

export function detectCycling(
  txs: readonly Transaction[],
  config: Partial<CyclingConfig> = {},
): AnomalyFinding[] {
  const cfg = { ...CYCLING_DEFAULTS, ...config };
  const findings: AnomalyFinding[] = [];

  // Index outflows: customer → counterparty → list
  const outflows = new Map<string, Map<string, Transaction[]>>();
  for (const t of txs) {
    if (t.amountAED >= 0) continue;
    const cust = t.customerId ?? 'unknown';
    if (!outflows.has(cust)) outflows.set(cust, new Map());
    const byCp = outflows.get(cust)!;
    const list = byCp.get(t.counterpartyId) ?? [];
    list.push(t);
    byCp.set(t.counterpartyId, list);
  }

  const windowMs = cfg.maxHours * 60 * 60 * 1000;
  for (const t of txs) {
    if (t.amountAED <= 0) continue; // only inflows trigger the search
    const cust = t.customerId ?? 'unknown';
    const byCp = outflows.get(cust);
    if (!byCp) continue;
    const candidates = byCp.get(t.counterpartyId) ?? [];
    for (const out of candidates) {
      const tReturn = new Date(t.at).getTime();
      const tOut = new Date(out.at).getTime();
      if (tReturn <= tOut) continue;
      if (tReturn - tOut > windowMs) continue;
      const outAmount = Math.abs(out.amountAED);
      const inAmount = Math.abs(t.amountAED);
      const diff = Math.abs(outAmount - inAmount) / Math.max(outAmount, 1);
      if (diff <= cfg.amountTolerance) {
        findings.push({
          kind: 'cycling',
          severity: 'high',
          confidence: Math.max(0.6, 1 - diff),
          summary: `Round-trip detected: ${cust} → ${t.counterpartyId} (${outAmount.toFixed(0)} AED) → ${cust} (${inAmount.toFixed(0)} AED) within ${((tReturn - tOut) / 3600000).toFixed(1)}h`,
          transactionIds: [out.id, t.id],
          meta: {
            customerId: cust,
            counterpartyId: t.counterpartyId,
            outAmount,
            inAmount,
            hoursBetween: (tReturn - tOut) / 3600000,
          },
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 5. Velocity — z-score on daily transaction count per customer
// ---------------------------------------------------------------------------

export interface VelocityConfig {
  /** Baseline window in days (historical). */
  baselineDays: number;
  /** z-score threshold to flag. */
  zThreshold: number;
}

const VELOCITY_DEFAULTS: VelocityConfig = { baselineDays: 30, zThreshold: 3 };

export function detectVelocityAnomaly(
  txs: readonly Transaction[],
  asOf: string,
  config: Partial<VelocityConfig> = {},
): AnomalyFinding[] {
  const cfg = { ...VELOCITY_DEFAULTS, ...config };
  const findings: AnomalyFinding[] = [];

  const byCustomer = new Map<string, Transaction[]>();
  for (const t of txs) {
    const cust = t.customerId ?? 'unknown';
    const list = byCustomer.get(cust) ?? [];
    list.push(t);
    byCustomer.set(cust, list);
  }

  const now = new Date(asOf).getTime();
  const baselineMs = cfg.baselineDays * 24 * 60 * 60 * 1000;
  const todayMs = 24 * 60 * 60 * 1000;

  for (const [customerId, list] of byCustomer) {
    // Count per calendar day in the baseline (exclude today)
    const dayCounts = new Map<string, number>();
    let todayCount = 0;
    for (const t of list) {
      const ts = new Date(t.at).getTime();
      if (ts > now || ts < now - baselineMs - todayMs) continue;
      const day = t.at.slice(0, 10);
      if (now - ts < todayMs) {
        todayCount++;
      } else {
        dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
      }
    }

    const counts = [...dayCounts.values()];
    if (counts.length < 5) continue; // not enough history for z-score
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance = counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length;
    // Floor the stdev at 1 — a uniform baseline (e.g. 1 tx/day every
    // day) has zero variance, but "10 txs today" is still a spike we
    // want to catch. Without the floor, the division by 0 would skip
    // the check entirely.
    const stdev = Math.max(Math.sqrt(variance), 1);
    const z = (todayCount - mean) / stdev;

    if (z >= cfg.zThreshold) {
      findings.push({
        kind: 'velocity',
        severity: z >= cfg.zThreshold * 2 ? 'high' : 'medium',
        confidence: Math.min(1, z / (cfg.zThreshold * 2)),
        summary: `${customerId} had ${todayCount} txs today vs historical mean ${mean.toFixed(1)} (z=${z.toFixed(2)})`,
        transactionIds: [],
        meta: {
          customerId,
          todayCount,
          baselineMean: mean,
          baselineStdev: stdev,
          zScore: z,
        },
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// 6. Amount entropy — unnatural amount regularity
// ---------------------------------------------------------------------------

/**
 * Real business transactions have natural variance. A stream of
 * perfectly-round amounts or repeatedly-identical amounts is a weak
 * signal of scripted or automated laundering.
 */
export function detectAmountEntropy(
  txs: readonly Transaction[],
): AnomalyFinding[] {
  const byCustomer = new Map<string, Transaction[]>();
  for (const t of txs) {
    const cust = t.customerId ?? 'unknown';
    const list = byCustomer.get(cust) ?? [];
    list.push(t);
    byCustomer.set(cust, list);
  }

  const findings: AnomalyFinding[] = [];
  for (const [customerId, list] of byCustomer) {
    if (list.length < 5) continue;

    // All-round check: every amount is divisible by 1000
    const roundCount = list.filter((t) => Math.abs(t.amountAED) % 1000 === 0).length;
    const roundRatio = roundCount / list.length;

    // All-identical check: the mode accounts for ≥60% of transactions
    const freq = new Map<number, number>();
    for (const t of list) {
      const rounded = Math.round(Math.abs(t.amountAED));
      freq.set(rounded, (freq.get(rounded) ?? 0) + 1);
    }
    const maxFreq = Math.max(...freq.values());
    const modeRatio = maxFreq / list.length;

    if (roundRatio >= 0.95 || modeRatio >= 0.6) {
      findings.push({
        kind: 'amount_entropy',
        severity: 'medium',
        confidence: Math.max(roundRatio, modeRatio),
        summary: `${customerId} transactions show unnatural amount regularity (round=${(roundRatio * 100).toFixed(0)}%, mode=${(modeRatio * 100).toFixed(0)}%)`,
        transactionIds: list.map((t) => t.id),
        meta: { customerId, roundRatio, modeRatio, sampleSize: list.length },
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Runner — execute all detectors and merge findings
// ---------------------------------------------------------------------------

export interface DetectorSuiteResult {
  findings: AnomalyFinding[];
  detectorStats: Record<AnomalyKind, number>;
}

export function runAllDetectors(
  txs: readonly Transaction[],
  asOf = new Date().toISOString(),
): DetectorSuiteResult {
  const all: AnomalyFinding[] = [];
  all.push(...detectStructuring(txs));
  all.push(...detectFanIn(txs));
  all.push(...detectFanOut(txs));
  all.push(...detectCycling(txs));
  all.push(...detectVelocityAnomaly(txs, asOf));
  all.push(...detectAmountEntropy(txs));

  const detectorStats: Record<AnomalyKind, number> = {
    structuring: 0,
    fan_in: 0,
    fan_out: 0,
    cycling: 0,
    velocity: 0,
    amount_entropy: 0,
  };
  for (const f of all) detectorStats[f.kind]++;

  return { findings: all, detectorStats };
}
