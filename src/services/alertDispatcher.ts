/**
 * Alert Dispatcher — rule engine that turns health / drift / SLA /
 * dead-letter signals into structured alerts the notification layer
 * delivers (email, Slack webhook, Asana, on-call pager).
 *
 * Why this exists:
 *   Every Tier 1/2/3 subsystem already PRODUCES signals (KS drift,
 *   dead-letter depth, cron failures, SLA breach predictor, feedback
 *   loop overdue). But there's no DELIVERY layer: signals sit in
 *   blob stores until somebody opens the Brain Console. By then the
 *   incident is old.
 *
 *   This module is the pure rule engine. It takes the aggregated
 *   signals + a rule set + a delivery adapter and decides which
 *   rules fire, with what severity, to whom. It is PURE with respect
 *   to the delivery adapter — tests inject a recording mock,
 *   production wires a real SMTP / webhook / pager client.
 *
 *   Rules are deterministic: same inputs → same alert set. Alert
 *   idempotency is enforced by hash-keying on (rule, subject, hour)
 *   so we do NOT spam operators with the same alert every cron
 *   cycle.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO incident awareness)
 *   Cabinet Res 74/2020 Art.4-7 (SLA breach = regulatory incident)
 *   Cabinet Res 134/2025 Art.19 (internal review)
 *   Cabinet Res 71/2024       (administrative penalty avoidance)
 *   FATF Rec 1               (operational risk)
 *   NIST AI RMF 1.0 MANAGE-3 (incident response)
 *   NIST AI RMF 1.0 MEASURE-4 (continuous validation)
 *   EU AI Act Art.15         (accuracy + robustness)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AlertSeverity = 'info' | 'warning' | 'critical' | 'page';
export type AlertChannel = 'email' | 'slack' | 'asana' | 'pager' | 'log';

export interface AlertEvent {
  /** Stable id derived from rule + subject + hour bucket. */
  id: string;
  severity: AlertSeverity;
  /** Short title. */
  title: string;
  /** Plain-English body. */
  body: string;
  /** Target channels (duplicates dedup'd upstream). */
  channels: readonly AlertChannel[];
  /** Rule that produced this alert. */
  ruleId: string;
  /** Regulatory citation inlined into the alert body. */
  regulatory: string;
  /** Structured metadata for the receiving channel. */
  meta: Readonly<Record<string, unknown>>;
}

/**
 * Signals the dispatcher evaluates. Supply only the ones you have —
 * rules skip cleanly when their required fields are absent.
 */
export interface AlertSignals {
  /** KS drift report. */
  drift?: {
    status: 'stable' | 'drift_detected' | 'insufficient_data';
    severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
    ksStatistic: number;
    tenantId: string;
  };
  /** Dead-letter queue depth. */
  deadLetter?: {
    tenantId: string;
    depth: number;
  };
  /** SLA breach prediction report. */
  slaBreach?: {
    tenantId: string;
    willBreachCount: number;
    alreadyBreachedCount: number;
  };
  /** Cron status snapshots. */
  crons?: ReadonlyArray<{
    id: string;
    lastResult: 'ok' | 'error' | 'never_run';
    consecutiveFailures: number;
  }>;
  /** Env / config validation health. */
  config?: {
    health: 'ok' | 'degraded' | 'broken';
    missingRequired: readonly string[];
  };
  /** Feedback loop — number of overrides pending rollup. */
  feedback?: {
    tenantId: string;
    overduePendingRollup: number;
  };
  /** Adversarial fuzz robustness score. */
  fuzz?: {
    robustnessScore: number;
    criticalFindings: number;
  };
  /** ISO timestamp of the evaluation — used for hour bucketing. */
  evaluatedAtIso: string;
}

export interface AlertRule {
  id: string;
  description: string;
  /** Returns an AlertEvent when the rule fires, null otherwise. */
  evaluate: (signals: AlertSignals) => AlertEvent | null;
}

export interface DispatchReport {
  schemaVersion: 1;
  evaluatedAtIso: string;
  alerts: readonly AlertEvent[];
  summary: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hourBucket(iso: string): string {
  // YYYY-MM-DDTHH (hour granularity) — enough to prevent spam.
  return iso.slice(0, 13);
}

function ruleAlertId(ruleId: string, subject: string, iso: string): string {
  return `${ruleId}:${subject}:${hourBucket(iso)}`;
}

// ---------------------------------------------------------------------------
// Default rule set
// ---------------------------------------------------------------------------

export const DEFAULT_RULES: readonly AlertRule[] = [
  // ---- DRIFT ----
  {
    id: 'drift.critical',
    description: 'KS-test drift at critical severity → page',
    evaluate: (s) => {
      if (!s.drift) return null;
      if (s.drift.severity !== 'critical') return null;
      return {
        id: ruleAlertId('drift.critical', s.drift.tenantId, s.evaluatedAtIso),
        severity: 'page',
        title: `CRITICAL drift detected for ${s.drift.tenantId}`,
        body:
          `KS statistic ${s.drift.ksStatistic.toFixed(3)} exceeds critical threshold. ` +
          `Investigate upstream feature data, recent constants changes, and ` +
          `population shift immediately.`,
        channels: ['pager', 'email', 'slack'],
        ruleId: 'drift.critical',
        regulatory: 'FDL Art.20-22; NIST AI RMF MEASURE-4; EU AI Act Art.15',
        meta: { tenantId: s.drift.tenantId, ks: s.drift.ksStatistic },
      };
    },
  },
  {
    id: 'drift.high',
    description: 'KS-test drift at high severity → email + slack',
    evaluate: (s) => {
      if (!s.drift) return null;
      if (s.drift.severity !== 'high') return null;
      return {
        id: ruleAlertId('drift.high', s.drift.tenantId, s.evaluatedAtIso),
        severity: 'critical',
        title: `High drift for ${s.drift.tenantId}`,
        body:
          `KS statistic ${s.drift.ksStatistic.toFixed(3)}. ` +
          `Review today's verdict distribution against yesterday.`,
        channels: ['email', 'slack'],
        ruleId: 'drift.high',
        regulatory: 'FDL Art.20-22; NIST AI RMF MEASURE-4',
        meta: { tenantId: s.drift.tenantId, ks: s.drift.ksStatistic },
      };
    },
  },

  // ---- DEAD LETTER ----
  {
    id: 'deadLetter.depth',
    description: 'Dead-letter depth > 10 → warning',
    evaluate: (s) => {
      if (!s.deadLetter) return null;
      if (s.deadLetter.depth <= 10) return null;
      return {
        id: ruleAlertId('deadLetter.depth', s.deadLetter.tenantId, s.evaluatedAtIso),
        severity: s.deadLetter.depth > 50 ? 'critical' : 'warning',
        title: `Asana dead-letter depth ${s.deadLetter.depth}`,
        body:
          `${s.deadLetter.depth} tasks failed Asana dispatch and exhausted retry budget. ` +
          `Drain the queue via asana-retry-queue-cron or investigate Asana API health.`,
        channels: ['email', 'slack'],
        ruleId: 'deadLetter.depth',
        regulatory: 'Cabinet Res 134/2025 Art.19',
        meta: { tenantId: s.deadLetter.tenantId, depth: s.deadLetter.depth },
      };
    },
  },

  // ---- SLA BREACH ----
  {
    id: 'sla.already_breached',
    description: 'Any already-breached regulatory SLA → page',
    evaluate: (s) => {
      if (!s.slaBreach) return null;
      if (s.slaBreach.alreadyBreachedCount <= 0) return null;
      return {
        id: ruleAlertId('sla.already_breached', s.slaBreach.tenantId, s.evaluatedAtIso),
        severity: 'page',
        title: `${s.slaBreach.alreadyBreachedCount} SLA breach(es) on ${s.slaBreach.tenantId}`,
        body:
          `${s.slaBreach.alreadyBreachedCount} task(s) have exceeded their regulatory SLA. ` +
          `This is a Cabinet Res 71/2024 penalty-exposure event.`,
        channels: ['pager', 'email', 'slack'],
        ruleId: 'sla.already_breached',
        regulatory: 'Cabinet Res 74/2020 Art.4-7; Cabinet Res 71/2024; FDL Art.26-27',
        meta: { tenantId: s.slaBreach.tenantId, count: s.slaBreach.alreadyBreachedCount },
      };
    },
  },
  {
    id: 'sla.will_breach',
    description: '≥1 SLA predicted to breach within horizon → warning',
    evaluate: (s) => {
      if (!s.slaBreach) return null;
      if (s.slaBreach.willBreachCount <= 0) return null;
      return {
        id: ruleAlertId('sla.will_breach', s.slaBreach.tenantId, s.evaluatedAtIso),
        severity: 'warning',
        title: `${s.slaBreach.willBreachCount} SLA(s) approaching breach on ${s.slaBreach.tenantId}`,
        body:
          `${s.slaBreach.willBreachCount} task(s) will exceed their SLA within the ` +
          `current horizon. Proactively escalate to avoid a Cabinet Res 71/2024 event.`,
        channels: ['slack'],
        ruleId: 'sla.will_breach',
        regulatory: 'Cabinet Res 74/2020 Art.4-7',
        meta: { tenantId: s.slaBreach.tenantId, count: s.slaBreach.willBreachCount },
      };
    },
  },

  // ---- CRONS ----
  {
    id: 'cron.repeated_failure',
    description: 'Any cron with ≥3 consecutive failures → critical',
    evaluate: (s) => {
      if (!s.crons) return null;
      const bad = s.crons.find((c) => c.consecutiveFailures >= 3);
      if (!bad) return null;
      return {
        id: ruleAlertId('cron.repeated_failure', bad.id, s.evaluatedAtIso),
        severity: 'critical',
        title: `Cron "${bad.id}" has failed ${bad.consecutiveFailures}× in a row`,
        body:
          `The cron has failed ${bad.consecutiveFailures} consecutive runs. ` +
          `Investigate the netlify function logs before the next scheduled tick.`,
        channels: ['email', 'slack'],
        ruleId: 'cron.repeated_failure',
        regulatory: 'FDL Art.20-22',
        meta: { cronId: bad.id, failures: bad.consecutiveFailures },
      };
    },
  },

  // ---- CONFIG ----
  {
    id: 'config.broken',
    description: 'Env config broken (required vars missing) → page',
    evaluate: (s) => {
      if (!s.config) return null;
      if (s.config.health !== 'broken') return null;
      return {
        id: ruleAlertId('config.broken', 'env', s.evaluatedAtIso),
        severity: 'page',
        title: `Env config BROKEN — ${s.config.missingRequired.length} required var(s) missing`,
        body:
          `Missing: ${s.config.missingRequired.join(', ')}. ` +
          `The brain cannot dispatch until these are set.`,
        channels: ['pager', 'email'],
        ruleId: 'config.broken',
        regulatory: 'FDL Art.20-22; EU AI Act Art.15',
        meta: { missing: s.config.missingRequired },
      };
    },
  },

  // ---- FUZZ ROBUSTNESS ----
  {
    id: 'fuzz.robustness_low',
    description: 'Fuzzer robustness < 70 → warning',
    evaluate: (s) => {
      if (!s.fuzz) return null;
      if (s.fuzz.robustnessScore >= 70) return null;
      return {
        id: ruleAlertId('fuzz.robustness_low', 'brain', s.evaluatedAtIso),
        severity: 'warning',
        title: `Brain robustness score ${s.fuzz.robustnessScore}/100`,
        body:
          `Adversarial fuzzer reports ${s.fuzz.criticalFindings} critical finding(s). ` +
          `Review boundary-fragile features and file clamp suggestions.`,
        channels: ['slack'],
        ruleId: 'fuzz.robustness_low',
        regulatory: 'EU AI Act Art.15; NIST AI RMF MEASURE-4',
        meta: { score: s.fuzz.robustnessScore, critical: s.fuzz.criticalFindings },
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Delivery adapter (injected)
// ---------------------------------------------------------------------------

export interface DeliveryAdapter {
  dispatch(alert: AlertEvent): Promise<{ ok: boolean; channel: AlertChannel; detail?: string }[]>;
}

/** No-op adapter used by tests + dry-runs. Records every dispatch. */
export class RecordingAdapter implements DeliveryAdapter {
  private records: AlertEvent[] = [];
  async dispatch(alert: AlertEvent) {
    this.records.push(alert);
    return alert.channels.map((c) => ({ ok: true, channel: c, detail: 'recorded' }));
  }
  recorded(): readonly AlertEvent[] {
    return [...this.records];
  }
  reset() {
    this.records = [];
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function evaluateAlerts(
  signals: AlertSignals,
  rules: readonly AlertRule[] = DEFAULT_RULES
): AlertEvent[] {
  const out: AlertEvent[] = [];
  for (const rule of rules) {
    const result = rule.evaluate(signals);
    if (result) out.push(result);
  }
  return out;
}

/**
 * Deduplicate alerts by id — ensures the same rule firing on the
 * same subject in the same hour never produces two alerts.
 */
export function dedupeAlerts(alerts: readonly AlertEvent[]): AlertEvent[] {
  const seen = new Map<string, AlertEvent>();
  for (const a of alerts) if (!seen.has(a.id)) seen.set(a.id, a);
  return Array.from(seen.values());
}

export async function dispatchAlerts(
  signals: AlertSignals,
  adapter: DeliveryAdapter,
  rules: readonly AlertRule[] = DEFAULT_RULES
): Promise<DispatchReport> {
  const raw = evaluateAlerts(signals, rules);
  const alerts = dedupeAlerts(raw);
  for (const a of alerts) {
    try {
      await adapter.dispatch(a);
    } catch (err) {
      // Never throw — an alert delivery failure must not itself
      // cause another incident. Log and continue.
      console.warn(
        '[alertDispatcher] delivery failed:',
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  return {
    schemaVersion: 1,
    evaluatedAtIso: signals.evaluatedAtIso,
    alerts,
    summary:
      alerts.length === 0
        ? 'All signals clean — no alerts fired.'
        : `${alerts.length} alert(s) dispatched (${alerts.filter((a) => a.severity === 'page').length} page, ${alerts.filter((a) => a.severity === 'critical').length} critical, ${alerts.filter((a) => a.severity === 'warning').length} warning).`,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'Cabinet Res 74/2020 Art.4-7',
      'Cabinet Res 134/2025 Art.19',
      'Cabinet Res 71/2024',
      'FATF Rec 1',
      'NIST AI RMF 1.0 MANAGE-3',
      'NIST AI RMF 1.0 MEASURE-4',
      'EU AI Act Art.15',
    ],
  };
}

// Exports for tests.
export const __test__ = { hourBucket, ruleAlertId };
