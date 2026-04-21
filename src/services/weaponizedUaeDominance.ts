/**
 * UAE Dominance Edge — enforcement-grade weapons.
 *
 * Where Phase 13 (#99-#103) and Phase 14 (#104-#109) added *reasoning*
 * and *intelligence*, this module adds *enforcement teeth* aligned to
 * the specific UAE regulatory surface: EOCN, FIU (goAML), CBUAE, MoE
 * DPMS supervisory framework. All four are pure TypeScript,
 * browser-safe, and dep-injected for any external I/O. None of them
 * exfiltrate subject data.
 *
 *   1. EOCN 24-hour countdown enforcer         (runEocnCountdown)
 *      Three-stage escalation ladder the moment a sanctions match is
 *      confirmed: T-12h MLRO ping, T-4h CO escalation, T-1h outbound
 *      lockout. Produces the exact actions each stage demands; caller
 *      executes them. Hard-cites Cabinet Res 74/2020 Art.4-7.
 *
 *   2. Sanctions-list hot diff monitor         (diffSanctionsLists)
 *      Diffs a previous sanctions-list snapshot against the latest and
 *      surfaces added / removed entries plus the subset of the active
 *      customer base that needs to be re-screened immediately. Closes
 *      the "list changed between screenings" audit finding.
 *      Cites FDL No.10/2025 Art.35, UN SC 1267/1988, Cabinet Res 74/2020.
 *
 *   3. CBUAE rate-locked AED threshold check   (checkAedThresholdLocked)
 *      Every AED threshold check pins to the CBUAE published rate on
 *      the transaction date, never today's rate. Fixes the common
 *      audit finding where historical threshold breaches are
 *      miscategorised because FX drifted. Cites MoE Circular
 *      08/AML/2021 (AED 55K DPMS), Cabinet Res 134/2025 Art.16
 *      (AED 60K cross-border).
 *
 *   4. MoE DPMS quarterly report compiler      (compileDpmsrQuarterly)
 *      Assembles the quarterly DPMSR summary per MoE Circular
 *      08/AML/2021 from raw screening + STR + freeze + training
 *      records. Outputs a structured document the caller serialises
 *      to XML/PDF. Caller owns transport.
 *
 * v1 scope: all four emit structured reports. None of them actually
 * freeze wallets, post to goAML, mutate CBUAE rates, or upload to
 * MoE — those live behind the existing approval gates and adapters
 * (autoFreezeExecutor.ts, goamlBuilder.ts, cbuaeRates.ts, asanaAuditPackUploader.ts).
 *
 * Composition: these weapons consume WeaponizedBrainResponse outputs
 * and extensions from Phase 13/14. They do not replace those layers.
 */

// Regulatory thresholds must come from the single source of truth
// (CLAUDE.md §"Constants Architecture"). The threshold table below is
// a routing map — it tells this module which constant to apply to
// which weapon kind — but every numeric value it carries has to be
// kept in lockstep with constants.ts by IMPORTING rather than DUPLICATING.
import {
  DPMS_CASH_THRESHOLD_AED,
  CROSS_BORDER_CASH_THRESHOLD_AED,
  UBO_OWNERSHIP_THRESHOLD_PCT,
} from '../domain/constants';

// ---------------------------------------------------------------------------
// Shared primitive types (kept local — no external coupling beyond Verdict).
// ---------------------------------------------------------------------------

export type UaeSanctionsList = 'UN' | 'OFAC' | 'EU' | 'UK' | 'UAE' | 'EOCN';

// ---------------------------------------------------------------------------
// 1. EOCN 24-hour countdown enforcer
// ---------------------------------------------------------------------------

export type EocnCountdownStage =
  | 'idle'
  | 'mlro-ping' // T-12h remaining
  | 'co-escalation' // T-4h remaining
  | 'outbound-lockout' // T-1h remaining
  | 'overdue'; // T+0 breached

export interface EocnCountdownState {
  /** Identifier of the subject under freeze. */
  subjectId: string;
  /** Sanctions match confidence in [0,1]. */
  matchConfidence: number;
  /** Wall-clock moment the 24-hour window started (ISO-8601). */
  freezeStartIso: string;
  /** Most recent stage already executed by the caller. */
  lastExecutedStage: EocnCountdownStage;
}

export interface EocnCountdownDirective {
  /** Stage the enforcer wants executed now. */
  stage: EocnCountdownStage;
  /** Hours remaining in the 24-hour window (negative = overdue). */
  hoursRemaining: number;
  /** Actions the caller must perform next. Ordered. */
  actions: string[];
  /** True when manual override would be required to skip this stage. */
  blocking: boolean;
  /** Regulatory citation for this stage. */
  citation: string;
  /** Short narrative for the audit chain. */
  narrative: string;
}

function stageForHoursRemaining(hoursRemaining: number): EocnCountdownStage {
  if (hoursRemaining <= 0) return 'overdue';
  if (hoursRemaining <= 1) return 'outbound-lockout';
  if (hoursRemaining <= 4) return 'co-escalation';
  if (hoursRemaining <= 12) return 'mlro-ping';
  return 'idle';
}

/**
 * Drive the 24-hour EOCN countdown through its stage ladder. Pure
 * function: caller provides current state + clock, receives the
 * directive for the current stage. Idempotent when the stage hasn't
 * changed.
 *
 * Regulatory basis: Cabinet Res 74/2020 Art.4-7 (24h freeze, 5d CNMR).
 * Tipping-off discipline: FDL No.10/2025 Art.29 — no subject notification.
 */
export function runEocnCountdown(input: {
  readonly state: EocnCountdownState;
  readonly asOf?: Date;
}): EocnCountdownDirective {
  const now = input.asOf ?? new Date();
  const startMs = new Date(input.state.freezeStartIso).getTime();
  const deadlineMs = startMs + 24 * 60 * 60 * 1000;
  const hoursRemaining = Math.round(((deadlineMs - now.getTime()) / (1000 * 60 * 60)) * 10) / 10;
  const stage = stageForHoursRemaining(hoursRemaining);

  const stageCfg: Record<EocnCountdownStage, { actions: string[]; blocking: boolean }> = {
    idle: {
      actions: ['Log baseline countdown entry in the audit chain.'],
      blocking: false,
    },
    'mlro-ping': {
      actions: [
        'Ping MLRO via alertDispatcher (high-priority channel).',
        'Confirm sanctions-match evidence bundle is attached.',
        'Do NOT notify the subject (FDL Art.29).',
      ],
      blocking: false,
    },
    'co-escalation': {
      actions: [
        'Escalate to CO (fourEyesSubtaskCreator).',
        'Open the freeze approval in the four-eyes queue.',
        'Prepare CNMR draft via goamlBuilder (5 business-day clock).',
      ],
      blocking: true,
    },
    'outbound-lockout': {
      actions: [
        'Engage autoFreezeExecutor with subject-ID scoped outbound block.',
        'Revoke any in-flight approvals that would release funds to subject.',
        'Board + CO two-factor override required to cancel the lockout.',
      ],
      blocking: true,
    },
    overdue: {
      actions: [
        'Record regulatory breach in the audit chain.',
        'Notify EOCN of the delayed freeze execution immediately.',
        'File CNMR with the actual freeze timestamp; explain the delay.',
      ],
      blocking: true,
    },
  };

  const cfg = stageCfg[stage];
  const narrative =
    stage === 'idle'
      ? `EOCN countdown nominal — ${hoursRemaining}h remaining, baseline stage.`
      : `EOCN countdown stage '${stage}' — ${hoursRemaining}h remaining; execute ${cfg.actions.length} action(s) per Cabinet Res 74/2020 Art.4-7.`;

  return {
    stage,
    hoursRemaining,
    actions: [...cfg.actions],
    blocking: cfg.blocking,
    citation: 'Cabinet Res 74/2020 Art.4-7 + FDL No.10/2025 Art.29',
    narrative,
  };
}

// ---------------------------------------------------------------------------
// 2. Sanctions-list hot diff monitor
// ---------------------------------------------------------------------------

export interface SanctionsListEntry {
  /** Stable identifier within the list. */
  id: string;
  /** Full legal name at match-key granularity. */
  name: string;
  /** Source list. */
  list: UaeSanctionsList;
  /** Optional aliases array. */
  aliases?: readonly string[];
  /** Optional jurisdiction code. */
  jurisdiction?: string;
}

export interface SanctionsListDiff {
  /** Entries present in `next` but not in `previous`. */
  added: SanctionsListEntry[];
  /** Entries present in `previous` but not in `next`. */
  removed: SanctionsListEntry[];
  /** Subset of the customer base that matches any added entry by name/alias. */
  rescreenRequired: Array<{ customerId: string; matchedEntryId: string; reason: string }>;
  /** Human-readable summary. */
  narrative: string;
}

export interface CustomerForRescreen {
  customerId: string;
  name: string;
  aliases?: readonly string[];
}

/**
 * Diff two sanctions-list snapshots and identify which active customers
 * must be re-screened immediately. Case-insensitive name/alias match.
 *
 * Regulatory basis: FDL No.10/2025 Art.35, UN SC 1267/1988,
 * Cabinet Res 74/2020 Art.4-7.
 */
export function diffSanctionsLists(input: {
  readonly previous: ReadonlyArray<SanctionsListEntry>;
  readonly next: ReadonlyArray<SanctionsListEntry>;
  readonly customers: ReadonlyArray<CustomerForRescreen>;
}): SanctionsListDiff {
  const prevById = new Map(input.previous.map((e) => [`${e.list}:${e.id}`, e]));
  const nextById = new Map(input.next.map((e) => [`${e.list}:${e.id}`, e]));

  const added: SanctionsListEntry[] = [];
  for (const [key, entry] of nextById) {
    if (!prevById.has(key)) added.push(entry);
  }
  const removed: SanctionsListEntry[] = [];
  for (const [key, entry] of prevById) {
    if (!nextById.has(key)) removed.push(entry);
  }

  // For every added entry, find customers whose name or any alias matches.
  const rescreenRequired: Array<{ customerId: string; matchedEntryId: string; reason: string }> =
    [];
  const customerTokens = input.customers.map((c) => ({
    id: c.customerId,
    names: [c.name, ...(c.aliases ?? [])].map((n) => n.toLowerCase().trim()),
  }));

  for (const entry of added) {
    const entryTokens = [entry.name, ...(entry.aliases ?? [])].map((n) => n.toLowerCase().trim());
    for (const cust of customerTokens) {
      const hit = cust.names.find((cn) => entryTokens.some((et) => cn === et || cn.includes(et)));
      if (hit) {
        rescreenRequired.push({
          customerId: cust.id,
          matchedEntryId: `${entry.list}:${entry.id}`,
          reason: `name/alias "${hit}" matches newly-added ${entry.list} entry "${entry.name}"`,
        });
      }
    }
  }

  const narrative =
    `Sanctions-list diff: +${added.length} / -${removed.length} entries. ` +
    `${rescreenRequired.length} active customer(s) need immediate re-screen ` +
    `(FDL Art.35; complete within 24h or trigger EOCN countdown per Cabinet Res 74/2020).`;

  return { added, removed, rescreenRequired, narrative };
}

// ---------------------------------------------------------------------------
// 3. CBUAE rate-locked AED threshold check
// ---------------------------------------------------------------------------

export type UaeThresholdKind = 'DPMS-CTR' | 'cross-border-cash' | 'UBO-ownership-pct' | 'custom';

export interface ThresholdCheckInput {
  /** Threshold category. */
  kind: UaeThresholdKind;
  /** Transaction currency ISO 4217 (e.g. 'USD', 'EUR', 'AED'). */
  currency: string;
  /** Amount in the source currency. */
  amount: number;
  /** Transaction date (ISO-8601). Must be in the past. */
  transactionDate: string;
  /**
   * CBUAE published rate for `currency → AED` as of `transactionDate`.
   * Caller resolves this via the existing cbuaeRates.ts adapter.
   * If currency is AED, pass 1.
   */
  cbuaeRateOnTransactionDate: number;
  /** Optional custom threshold override, only used when kind === 'custom'. */
  customThresholdAed?: number;
}

export interface ThresholdCheckResult {
  /** AED-equivalent amount at the locked rate. */
  amountAed: number;
  /** The threshold value in AED (resolved from kind + optional override). */
  thresholdAed: number;
  /** True when the AED amount meets or exceeds the threshold. */
  meetsThreshold: boolean;
  /** Regulatory citation for this threshold. */
  citation: string;
  /** Narrative including the locked rate, source, and result. */
  narrative: string;
}

// Canonical AED thresholds sourced from src/domain/constants.ts — the
// single source of truth. Any regulator-driven change flows through the
// constants bump + REGULATORY_CONSTANTS_VERSION bump, and is picked up
// here automatically without a second edit site to remember.
// UBO value is stored in percent (0-100) for this router; the canonical
// constant is in decimal (0-1), so it is scaled ×100 on read.
const THRESHOLD_AED_BY_KIND: Record<Exclude<UaeThresholdKind, 'custom'>, number> = {
  'DPMS-CTR': DPMS_CASH_THRESHOLD_AED,
  'cross-border-cash': CROSS_BORDER_CASH_THRESHOLD_AED,
  'UBO-ownership-pct': UBO_OWNERSHIP_THRESHOLD_PCT * 100, // percent — handled specially below
};

const THRESHOLD_CITATION: Record<UaeThresholdKind, string> = {
  'DPMS-CTR': 'MoE Circular 08/AML/2021',
  'cross-border-cash': 'Cabinet Res 134/2025 Art.16',
  'UBO-ownership-pct': 'Cabinet Decision 109/2023',
  custom: 'CLAUDE.md §8 (custom threshold — cite explicitly in context)',
};

/**
 * AED-threshold check that pins to the CBUAE rate published on the
 * transaction date, not today. Prevents rate-drift errors in historical
 * threshold analysis. UBO-ownership-pct is currency-agnostic.
 */
export function checkAedThresholdLocked(input: ThresholdCheckInput): ThresholdCheckResult {
  if (input.kind === 'UBO-ownership-pct') {
    // Percentage, not AED; rate is ignored.
    const thresholdPct = THRESHOLD_AED_BY_KIND['UBO-ownership-pct'];
    const meets = input.amount >= thresholdPct;
    return {
      amountAed: input.amount,
      thresholdAed: thresholdPct,
      meetsThreshold: meets,
      citation: THRESHOLD_CITATION['UBO-ownership-pct'],
      narrative:
        `UBO ownership check: ${input.amount}% vs ${thresholdPct}% threshold → ` +
        (meets ? 'REGISTER & re-verify within 15 working days' : 'below threshold, monitor only') +
        ` (Cabinet Decision 109/2023).`,
    };
  }

  if (input.cbuaeRateOnTransactionDate <= 0) {
    throw new Error(
      'CBUAE rate must be a positive published rate for the transaction date. ' +
        'Resolve via cbuaeRates.ts or abort the check.'
    );
  }

  const amountAed = Math.round(input.amount * input.cbuaeRateOnTransactionDate * 100) / 100;
  const thresholdAed =
    input.kind === 'custom' ? (input.customThresholdAed ?? 0) : THRESHOLD_AED_BY_KIND[input.kind];

  const meets = amountAed >= thresholdAed;

  return {
    amountAed,
    thresholdAed,
    meetsThreshold: meets,
    citation: THRESHOLD_CITATION[input.kind],
    narrative:
      `${input.kind} threshold check: ${input.amount} ${input.currency} ` +
      `@ CBUAE ${input.cbuaeRateOnTransactionDate} (locked to ${input.transactionDate}) ` +
      `= AED ${amountAed.toLocaleString('en-AE')} vs AED ${thresholdAed.toLocaleString('en-AE')} ` +
      `threshold → ${meets ? 'MEETS / file as required' : 'below, no filing'} ` +
      `(${THRESHOLD_CITATION[input.kind]}).`,
  };
}

// ---------------------------------------------------------------------------
// 4. MoE DPMS quarterly report compiler
// ---------------------------------------------------------------------------

export interface DpmsrQuarterlyInput {
  /** Entity producing the report. */
  entityId: string;
  entityName: string;
  /** Reporting quarter, e.g. 'Q1 2026'. */
  quarter: string;
  /** Start + end of the quarter (ISO-8601). */
  periodStartIso: string;
  periodEndIso: string;
  /** Aggregated counts for the quarter. */
  counts: {
    screeningsTotal: number;
    screeningsCleared: number;
    confirmedMatches: number;
    potentialMatchesEscalated: number;
    strFiled: number;
    ctrFiled: number;
    dpmsrFiled: number;
    freezesExecuted: number;
    freezeReleasesRequested: number;
    cddOnboarded: number;
    eddCases: number;
  };
  /** Compliance-officer name block. */
  complianceOfficerName: string;
  /** True when training refresh was conducted in this quarter. */
  trainingRefreshCompleted: boolean;
}

export interface DpmsrQuarterlyReport {
  entityId: string;
  entityName: string;
  quarter: string;
  periodStartIso: string;
  periodEndIso: string;
  sections: Array<{ title: string; content: string }>;
  /** Findings the caller must resolve BEFORE serialising to MoE format. */
  blockers: string[];
  /** True when no blockers remain. */
  readyToFile: boolean;
  citation: string;
  narrative: string;
}

/**
 * Compile a MoE DPMS quarterly report from aggregated counts. Produces
 * structured sections + a readiness flag the caller checks before
 * submission via goamlBuilder or the MoE supervisory portal.
 *
 * Regulatory basis: MoE Circular 08/AML/2021 (DPMS sector guidance,
 * quarterly DPMSR submission).
 */
export function compileDpmsrQuarterly(input: DpmsrQuarterlyInput): DpmsrQuarterlyReport {
  const c = input.counts;
  const blockers: string[] = [];
  if (!input.trainingRefreshCompleted) {
    blockers.push(
      'Training refresh not completed this quarter — required before DPMSR submission.'
    );
  }
  if (c.confirmedMatches > 0 && c.freezesExecuted < c.confirmedMatches) {
    blockers.push(
      `Freeze execution gap: ${c.confirmedMatches} confirmed match(es) vs ${c.freezesExecuted} freeze(s) executed — reconcile before filing.`
    );
  }
  if (c.screeningsTotal === 0) {
    blockers.push('Zero screenings in the quarter is implausible — verify ingestion pipeline.');
  }

  const clearRate = c.screeningsTotal === 0 ? 0 : (c.screeningsCleared / c.screeningsTotal) * 100;

  const sections = [
    {
      title: '1. Entity & Reporting Period',
      content:
        `Entity: ${input.entityName} (${input.entityId}). ` +
        `Quarter: ${input.quarter} (${input.periodStartIso} → ${input.periodEndIso}).`,
    },
    {
      title: '2. Screening Volume',
      content:
        `Total screenings: ${c.screeningsTotal}. Cleared: ${c.screeningsCleared} (${clearRate.toFixed(1)}%). ` +
        `Potential matches escalated: ${c.potentialMatchesEscalated}. Confirmed matches: ${c.confirmedMatches}.`,
    },
    {
      title: '3. Regulatory Filings',
      content:
        `STRs filed: ${c.strFiled}. CTRs filed: ${c.ctrFiled}. DPMSRs filed: ${c.dpmsrFiled}. ` +
        `Freezes executed: ${c.freezesExecuted}. Freeze-release requests: ${c.freezeReleasesRequested}.`,
    },
    {
      title: '4. Customer Intake',
      content: `CDD-tier onboardings: ${c.cddOnboarded}. EDD cases: ${c.eddCases}.`,
    },
    {
      title: '5. Training & Governance',
      content:
        `Quarterly training refresh: ${input.trainingRefreshCompleted ? 'COMPLETED' : 'NOT COMPLETED'}. ` +
        `Compliance Officer of record: ${input.complianceOfficerName}.`,
    },
    {
      title: '6. Citations',
      content:
        'MoE Circular 08/AML/2021 (DPMS sector). FDL No.10/2025 Art.20-22 (CO duties). ' +
        'Cabinet Res 74/2020 Art.4-7 (freeze workflow). Cabinet Res 134/2025 Art.19 (internal review).',
    },
  ];

  const readyToFile = blockers.length === 0;
  const narrative =
    `DPMSR ${input.quarter} for ${input.entityName}: ${c.strFiled} STR(s), ${c.ctrFiled} CTR(s), ` +
    `${c.freezesExecuted} freeze(s). ` +
    (readyToFile
      ? 'Ready to file.'
      : `${blockers.length} blocker(s) — resolve before submission to MoE.`);

  return {
    entityId: input.entityId,
    entityName: input.entityName,
    quarter: input.quarter,
    periodStartIso: input.periodStartIso,
    periodEndIso: input.periodEndIso,
    sections,
    blockers,
    readyToFile,
    citation: 'MoE Circular 08/AML/2021',
    narrative,
  };
}
