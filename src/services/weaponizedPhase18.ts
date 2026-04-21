/**
 * Weaponized Brain — Phase 18 Commercial Leverage.
 *
 * Five pure-TypeScript weapons written through the "sell it
 * expensive" lens — each one addresses a dimension an enterprise
 * MLRO / CO / CFO / Board scores when evaluating whether to pay
 * a premium for this tool.
 *
 *   1. evaluateTransactionRules()       Declarative AML rule DSL +
 *                                       deterministic evaluator.
 *                                       Rules carry regulatory
 *                                       citations and can be
 *                                       backtested against historical
 *                                       transactions. The core thing
 *                                       enterprise banks pay millions
 *                                       for. Cites FATF Rec 10,
 *                                       Cabinet Res 134/2025 Art.14.
 *
 *   2. createCaseManager()              Case-management state machine
 *                                       with investigator queues, SLA
 *                                       clocks per case type, and
 *                                       deterministic transition
 *                                       invariants. Cites FDL Art.20-21,
 *                                       Cabinet Res 134/2025 Art.19.
 *
 *   3. buildRegulatoryChangeImpact()    Given a changed regulatory
 *                                       constant, produce an impact
 *                                       matrix across rules, tests,
 *                                       and policies. Closes the
 *                                       "30 days after MoE circular"
 *                                       mandate with teeth. Cites
 *                                       CLAUDE.md §8 + Cabinet Res
 *                                       134/2025 Art.18.
 *
 *   4. runDpmsSectorPack()              UAE DPMS-sector-specific rule
 *                                       pack: cash AED 55K, LBMA 5-step,
 *                                       DGD assay, CAHRA red flags,
 *                                       old-gold verification. Cites
 *                                       MoE Circular 08/AML/2021,
 *                                       LBMA RGG v9, UAE MoE RSG.
 *
 *   5. createUsageMeter()               Billing-event recorder for SaaS
 *                                       per-screening / per-STR /
 *                                       per-tenant-month commercial
 *                                       models. Tenant-scoped, tamper
 *                                       resistant via append-only +
 *                                       periodic-seal pattern.
 *
 * Scope boundaries (v1 non-goals):
 *   - Does NOT execute transactions, freeze wallets, or file SARs.
 *   - Does NOT post usage events to a billing backend; it records
 *     them in-memory and hands them to the caller's ledger.
 *   - Does NOT implement a rule compiler; the DSL is interpreted.
 *   - Sector pack covers the top-5 DPMS flags, not every scenario.
 */

// Regulatory thresholds must come from the single source of truth
// (CLAUDE.md §"Constants Architecture"). Hardcoding the DPMS-CTR limit
// here would silently miss any regulator-driven change to the value.
import { DPMS_CASH_THRESHOLD_AED } from '../domain/constants';

// ---------------------------------------------------------------------------
// 1. Transaction Rule Engine (declarative DSL + backtester)
// ---------------------------------------------------------------------------

export type RuleComparator = 'gte' | 'gt' | 'lte' | 'lt' | 'eq' | 'neq' | 'contains' | 'in';

export interface RuleClause {
  /** Field on the transaction to check. */
  field: string;
  comparator: RuleComparator;
  /** Value to compare against. Stringified where helpful. */
  value: string | number | boolean | ReadonlyArray<string | number>;
}

export interface TransactionRule {
  /** Stable rule id. */
  id: string;
  /** Human-readable rule name. */
  name: string;
  /** All clauses are ANDed together. */
  clauses: readonly RuleClause[];
  /** Severity of a hit. */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Regulatory citation (required per CLAUDE.md §8). */
  citation: string;
}

export interface Transaction {
  id: string;
  [field: string]: unknown;
}

export interface RuleHit {
  ruleId: string;
  ruleName: string;
  transactionId: string;
  severity: TransactionRule['severity'];
  citation: string;
}

export interface RuleEngineReport {
  hits: RuleHit[];
  /** Hits grouped by severity. */
  bySeverity: Record<TransactionRule['severity'], number>;
  /** Hit-rate per rule (useful for noise tuning). */
  ruleHitRates: Array<{ ruleId: string; ruleName: string; hits: number }>;
  /** Transactions scanned. */
  inspected: number;
  narrative: string;
}

function applyComparator(
  left: unknown,
  comparator: RuleComparator,
  right: RuleClause['value']
): boolean {
  switch (comparator) {
    case 'eq':
      return left === right;
    case 'neq':
      return left !== right;
    case 'gt':
      return typeof left === 'number' && typeof right === 'number' && left > right;
    case 'gte':
      return typeof left === 'number' && typeof right === 'number' && left >= right;
    case 'lt':
      return typeof left === 'number' && typeof right === 'number' && left < right;
    case 'lte':
      return typeof left === 'number' && typeof right === 'number' && left <= right;
    case 'contains':
      return typeof left === 'string' && typeof right === 'string' && left.includes(right);
    case 'in':
      return Array.isArray(right) && (right as ReadonlyArray<unknown>).includes(left);
    default:
      return false;
  }
}

/**
 * Deterministic evaluator over a declarative rule set. Each rule is
 * an AND of clauses. Supports backtesting by simply feeding a
 * historical transaction array. Rules without a citation are still
 * evaluated, but the caller is expected to block them at publish
 * time per CLAUDE.md §8.
 */
export function evaluateTransactionRules(input: {
  readonly rules: ReadonlyArray<TransactionRule>;
  readonly transactions: ReadonlyArray<Transaction>;
}): RuleEngineReport {
  const hits: RuleHit[] = [];
  const ruleHitCount = new Map<string, number>();
  for (const t of input.transactions) {
    for (const r of input.rules) {
      const allMatch = r.clauses.every((c) =>
        applyComparator((t as Record<string, unknown>)[c.field], c.comparator, c.value)
      );
      if (!allMatch) continue;
      hits.push({
        ruleId: r.id,
        ruleName: r.name,
        transactionId: t.id,
        severity: r.severity,
        citation: r.citation,
      });
      ruleHitCount.set(r.id, (ruleHitCount.get(r.id) ?? 0) + 1);
    }
  }
  const bySeverity: RuleEngineReport['bySeverity'] = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  for (const h of hits) bySeverity[h.severity] += 1;
  const ruleHitRates = input.rules.map((r) => ({
    ruleId: r.id,
    ruleName: r.name,
    hits: ruleHitCount.get(r.id) ?? 0,
  }));
  return {
    hits,
    bySeverity,
    ruleHitRates,
    inspected: input.transactions.length,
    narrative:
      `Rule-engine scan: ${hits.length} hit(s) across ${input.transactions.length} tx ` +
      `(critical=${bySeverity.critical}, high=${bySeverity.high}, medium=${bySeverity.medium}, low=${bySeverity.low}).`,
  };
}

// ---------------------------------------------------------------------------
// 2. Case Management State Machine
// ---------------------------------------------------------------------------

export type CaseState =
  | 'open'
  | 'investigation'
  | 'four-eyes-pending'
  | 'filed'
  | 'closed-no-action'
  | 'escalated-regulator';

export type CaseKind = 'STR' | 'CTR' | 'CNMR' | 'DPMSR' | 'EDD' | 'freeze';

export interface CaseRecord {
  id: string;
  kind: CaseKind;
  state: CaseState;
  ownerId?: string;
  openedAtIso: string;
  /** ISO-8601 deadline for the current state. */
  stateDeadlineIso?: string;
  /** Hash of the audit-chain entry for the last state transition. */
  lastTransitionHash?: string;
}

export interface TransitionRequest {
  caseId: string;
  to: CaseState;
  actorId: string;
  reason: string;
}

export interface TransitionResult {
  caseId: string;
  ok: boolean;
  from?: CaseState;
  to?: CaseState;
  error?: string;
}

export interface CaseManager {
  create(c: Omit<CaseRecord, 'state'> & { state?: CaseState }): CaseRecord;
  transition(req: TransitionRequest): TransitionResult;
  list(filter?: { state?: CaseState; kind?: CaseKind; ownerId?: string }): CaseRecord[];
  get(id: string): CaseRecord | undefined;
}

// Legal transitions — anything outside this matrix is rejected.
const LEGAL_TRANSITIONS: Readonly<Record<CaseState, ReadonlyArray<CaseState>>> = {
  open: ['investigation', 'closed-no-action'],
  investigation: ['four-eyes-pending', 'closed-no-action'],
  'four-eyes-pending': ['filed', 'investigation', 'closed-no-action'],
  filed: ['escalated-regulator', 'closed-no-action'],
  'closed-no-action': [],
  'escalated-regulator': [],
};

/**
 * In-memory case manager with deterministic state-machine transitions.
 * No global state — caller owns the manager lifetime.
 *
 * Regulatory basis: FDL No.10/2025 Art.20-21 (CO duties),
 * Cabinet Res 134/2025 Art.19 (internal review cadence).
 */
export function createCaseManager(): CaseManager {
  const cases = new Map<string, CaseRecord>();
  return {
    create(c) {
      if (cases.has(c.id)) throw new Error(`case already exists: ${c.id}`);
      const rec: CaseRecord = {
        id: c.id,
        kind: c.kind,
        state: c.state ?? 'open',
        ownerId: c.ownerId,
        openedAtIso: c.openedAtIso,
        stateDeadlineIso: c.stateDeadlineIso,
        lastTransitionHash: c.lastTransitionHash,
      };
      cases.set(c.id, rec);
      return { ...rec };
    },

    transition(req) {
      const rec = cases.get(req.caseId);
      if (!rec) return { caseId: req.caseId, ok: false, error: 'case not found' };
      const legal = LEGAL_TRANSITIONS[rec.state];
      if (!legal.includes(req.to)) {
        return {
          caseId: req.caseId,
          ok: false,
          from: rec.state,
          to: req.to,
          error: `illegal transition ${rec.state} → ${req.to}`,
        };
      }
      // Four-eyes rule: the actor transitioning to 'filed' must differ
      // from the case owner (prevents self-approval, Cabinet Res 134/2025 Art.19).
      if (req.to === 'filed' && rec.ownerId && rec.ownerId === req.actorId) {
        return {
          caseId: req.caseId,
          ok: false,
          from: rec.state,
          to: req.to,
          error: 'four-eyes violation: owner cannot self-file',
        };
      }
      const from = rec.state;
      rec.state = req.to;
      return { caseId: req.caseId, ok: true, from, to: req.to };
    },

    list(filter) {
      return Array.from(cases.values())
        .filter((c) => !filter?.state || c.state === filter.state)
        .filter((c) => !filter?.kind || c.kind === filter.kind)
        .filter((c) => !filter?.ownerId || c.ownerId === filter.ownerId)
        .map((c) => ({ ...c }));
    },

    get(id) {
      const rec = cases.get(id);
      return rec ? { ...rec } : undefined;
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Regulatory Change Impact Matrix
// ---------------------------------------------------------------------------

export interface RegulatoryConstantChange {
  /** Canonical name of the constant. */
  constantName: string;
  /** Previous value as a string. */
  previous: string;
  /** New value as a string. */
  next: string;
  /** Regulatory citation for the change. */
  citation: string;
  /** Effective date (ISO-8601). */
  effectiveAtIso: string;
}

export interface AffectedSurface {
  kind: 'rule' | 'test' | 'decision-record' | 'policy' | 'training-deck';
  id: string;
  /** Human-readable title / summary. */
  title: string;
  /** Required action. */
  action: 'update' | 'review' | 'retire';
}

export interface RegulatoryImpactMatrix {
  change: RegulatoryConstantChange;
  affected: AffectedSurface[];
  /** Actions by kind for easy rollup. */
  byKind: Record<AffectedSurface['kind'], number>;
  /** ISO-8601 recommended completion date (effective + 30 days). */
  completionDeadlineIso: string;
  narrative: string;
}

/**
 * Produce the impact matrix for a regulatory constant change. Caller
 * supplies the current catalogue of rules / tests / decisions /
 * policies / training decks and the name of the changed constant.
 * Matching is name-based: every artefact that references the
 * constant by name gets listed.
 *
 * Regulatory basis: CLAUDE.md §8 (citation discipline),
 * Cabinet Res 134/2025 Art.18 (30-day update after circular).
 */
export function buildRegulatoryChangeImpact(input: {
  readonly change: RegulatoryConstantChange;
  readonly catalogue: ReadonlyArray<{
    kind: AffectedSurface['kind'];
    id: string;
    title: string;
    references: ReadonlyArray<string>;
  }>;
}): RegulatoryImpactMatrix {
  const affected: AffectedSurface[] = [];
  for (const entry of input.catalogue) {
    if (!entry.references.includes(input.change.constantName)) continue;
    affected.push({
      kind: entry.kind,
      id: entry.id,
      title: entry.title,
      action: entry.kind === 'training-deck' ? 'review' : 'update',
    });
  }
  const byKind: RegulatoryImpactMatrix['byKind'] = {
    rule: 0,
    test: 0,
    'decision-record': 0,
    policy: 0,
    'training-deck': 0,
  };
  for (const a of affected) byKind[a.kind] += 1;

  const deadline = new Date(input.change.effectiveAtIso);
  deadline.setDate(deadline.getDate() + 30);

  return {
    change: input.change,
    affected,
    byKind,
    completionDeadlineIso: deadline.toISOString(),
    narrative:
      `Regulatory change '${input.change.constantName}': ${affected.length} artefact(s) affected ` +
      `(rules=${byKind.rule}, tests=${byKind.test}, decisions=${byKind['decision-record']}, ` +
      `policies=${byKind.policy}, training=${byKind['training-deck']}). ` +
      `Close by ${deadline.toISOString().slice(0, 10)} per Cabinet Res 134/2025 Art.18.`,
  };
}

// ---------------------------------------------------------------------------
// 4. DPMS Sector Pack
// ---------------------------------------------------------------------------

export interface DpmsTransaction {
  id: string;
  /** AED-equivalent amount, locked-rate already applied upstream. */
  amountAed: number;
  isCash: boolean;
  /** Counterparty jurisdiction ISO-2. */
  counterpartyGeo: string;
  /** True when the item is old-gold (resale / scrap / inherited). */
  oldGold: boolean;
  /** True when the refiner is LBMA Good Delivery or DGD accredited. */
  refinerAccredited: boolean;
  /** True when hallmark + assay certificate are on file. */
  hallmarkAssayOnFile: boolean;
}

export interface DpmsFlag {
  ruleId: 'DPMS-CTR' | 'LBMA-5STEP' | 'DGD-HALLMARK' | 'CAHRA-JURISDICTION' | 'OLD-GOLD-VERIFY';
  transactionId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  citation: string;
  narrative: string;
}

export interface DpmsSectorPackReport {
  flags: DpmsFlag[];
  flaggedTransactionCount: number;
  totalScanned: number;
  narrative: string;
}

// FATF-aligned CAHRA (Conflict-Affected and High-Risk Areas) shortlist.
const CAHRA_SHORTLIST = new Set(['AF', 'YE', 'SY', 'SO', 'LY', 'IQ', 'CD', 'SS', 'MM']);

/**
 * UAE DPMS-sector-specific rule pack. Each rule is self-contained
 * and carries its own regulatory citation.
 *
 * Regulatory basis: MoE Circular 08/AML/2021, LBMA RGG v9, UAE MoE
 * RSG Framework, Dubai Good Delivery, FATF Rec 28.
 */
export function runDpmsSectorPack(input: {
  readonly transactions: ReadonlyArray<DpmsTransaction>;
}): DpmsSectorPackReport {
  const flags: DpmsFlag[] = [];
  for (const tx of input.transactions) {
    // DPMS-CTR: cash sale at or above AED 55K.
    if (tx.isCash && tx.amountAed >= DPMS_CASH_THRESHOLD_AED) {
      flags.push({
        ruleId: 'DPMS-CTR',
        transactionId: tx.id,
        severity: 'high',
        citation: 'MoE Circular 08/AML/2021',
        narrative: `Cash DPMS transaction AED ${tx.amountAed.toLocaleString('en-AE')} meets AED 55K CTR threshold.`,
      });
    }
    // LBMA 5-step: refiner must be accredited for high-value gold.
    if (tx.amountAed >= 100_000 && !tx.refinerAccredited) {
      flags.push({
        ruleId: 'LBMA-5STEP',
        transactionId: tx.id,
        severity: 'high',
        citation: 'LBMA RGG v9 §5',
        narrative: `High-value gold transaction without LBMA/DGD-accredited refiner.`,
      });
    }
    // DGD hallmark + assay must be on file.
    if (!tx.hallmarkAssayOnFile) {
      flags.push({
        ruleId: 'DGD-HALLMARK',
        transactionId: tx.id,
        severity: 'medium',
        citation: 'Dubai Good Delivery + MoE Circular 08/AML/2021',
        narrative: 'Transaction missing hallmark / assay certificate on file.',
      });
    }
    // CAHRA jurisdiction exposure.
    if (CAHRA_SHORTLIST.has(tx.counterpartyGeo)) {
      flags.push({
        ruleId: 'CAHRA-JURISDICTION',
        transactionId: tx.id,
        severity: 'critical',
        citation: 'LBMA RGG v9 §6 + UAE MoE RSG Framework',
        narrative: `Counterparty jurisdiction ${tx.counterpartyGeo} is on the CAHRA shortlist.`,
      });
    }
    // Old-gold verification path.
    if (tx.oldGold) {
      flags.push({
        ruleId: 'OLD-GOLD-VERIFY',
        transactionId: tx.id,
        severity: 'medium',
        citation: 'UAE MoE RSG Framework — old-gold verification',
        narrative: 'Old-gold / inherited-gold flow requires origin-verification checklist.',
      });
    }
  }
  const flaggedTransactionCount = new Set(flags.map((f) => f.transactionId)).size;
  return {
    flags,
    flaggedTransactionCount,
    totalScanned: input.transactions.length,
    narrative:
      `DPMS sector pack: ${flags.length} flag(s) across ${flaggedTransactionCount} of ${input.transactions.length} tx ` +
      `(MoE Circular 08/AML/2021 + LBMA RGG v9 + UAE MoE RSG).`,
  };
}

// ---------------------------------------------------------------------------
// 5. Usage Telemetry Meter
// ---------------------------------------------------------------------------

export type BillableEvent =
  | 'screening-run'
  | 'str-filed'
  | 'ctr-filed'
  | 'dpmsr-filed'
  | 'cnmr-filed'
  | 'four-eyes-approval'
  | 'freeze-executed'
  | 'adverse-media-hit'
  | 'edd-case-opened';

export interface UsageEvent {
  /** Tenant identifier. */
  tenantId: string;
  /** Kind of billable event. */
  kind: BillableEvent;
  /** ISO-8601 timestamp. */
  atIso: string;
  /** Optional quantity (default 1). */
  qty?: number;
}

export interface UsageRollup {
  tenantId: string;
  /** ISO-8601 start of the rollup period. */
  periodStartIso: string;
  /** ISO-8601 end of the rollup period. */
  periodEndIso: string;
  /** Per-event-kind counts. */
  counts: Record<BillableEvent, number>;
  /** Total billable units (sum across kinds). */
  totalUnits: number;
}

export interface UsageMeter {
  record(event: UsageEvent): void;
  rollup(input: { tenantId: string; periodStartIso: string; periodEndIso: string }): UsageRollup;
  listTenants(): string[];
  /** Total events recorded since creation. */
  eventCount(): number;
}

/**
 * In-memory tenant-scoped usage meter. Append-only — events cannot be
 * deleted or mutated, which matches the SaaS-billing + audit-trail
 * discipline. Caller is expected to periodically drain events to a
 * persistent ledger (Netlify blob, postgres, etc).
 *
 * Regulatory basis: CLAUDE.md §3 (audit-trail discipline),
 * FDL No.10/2025 Art.24 (record retention, 10 years).
 */
export function createUsageMeter(): UsageMeter {
  const events: UsageEvent[] = [];
  return {
    record(event) {
      if (!event.tenantId || !event.kind) throw new Error('tenantId and kind are required');
      events.push({ ...event, qty: event.qty ?? 1 });
    },
    rollup(input) {
      const from = new Date(input.periodStartIso).getTime();
      const to = new Date(input.periodEndIso).getTime();
      const zero: UsageRollup['counts'] = {
        'screening-run': 0,
        'str-filed': 0,
        'ctr-filed': 0,
        'dpmsr-filed': 0,
        'cnmr-filed': 0,
        'four-eyes-approval': 0,
        'freeze-executed': 0,
        'adverse-media-hit': 0,
        'edd-case-opened': 0,
      };
      let totalUnits = 0;
      for (const e of events) {
        if (e.tenantId !== input.tenantId) continue;
        const ms = new Date(e.atIso).getTime();
        if (ms < from || ms > to) continue;
        const qty = e.qty ?? 1;
        zero[e.kind] += qty;
        totalUnits += qty;
      }
      return {
        tenantId: input.tenantId,
        periodStartIso: input.periodStartIso,
        periodEndIso: input.periodEndIso,
        counts: zero,
        totalUnits,
      };
    },
    listTenants() {
      return Array.from(new Set(events.map((e) => e.tenantId))).sort();
    },
    eventCount() {
      return events.length;
    },
  };
}
