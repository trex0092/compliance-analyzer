/**
 * SLA Breach Predictor — predicts which open Asana tasks will breach
 * their regulatory SLA in the next horizon, so the SLA enforcer can
 * escalate proactively instead of reactively.
 *
 * Why this exists:
 *   asanaSlaEnforcer.ts catches breaches AFTER the deadline expires.
 *   That's correct behaviour for the audit trail but operationally
 *   too late: a 24h freeze breach becomes a 5-figure penalty under
 *   Cabinet Res 71/2024.
 *
 *   This module looks at the rate-of-progress on each open task
 *   (elapsed-since-section-entry / SLA-window) and predicts which
 *   tasks will breach inside `horizonHours`. The cron then proactively
 *   escalates them BEFORE the breach happens.
 *
 *   Pure function. Same input → same predictions. No I/O.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.26-27 (STR without delay)
 *   Cabinet Res 74/2020 Art.4-7 (24h freeze + 5 BD CNMR)
 *   Cabinet Res 134/2025 Art.19 (internal review)
 *   Cabinet Res 71/2024       (administrative penalties — drives
 *                                the cost-of-breach logic)
 *   FATF Rec 1               (operational risk)
 *   NIST AI RMF 1.0 MANAGE-2 (resource allocation)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpenTaskSnapshot {
  /** Asana task GID. */
  taskGid: string;
  tenantId: string;
  /** Section name — drives which SLA applies. */
  section: string;
  /** ISO timestamp the task entered the current section. */
  enteredSectionAtIso: string;
  /** Caller-supplied SLA window in clock hours. */
  slaHours: number;
  /** Caller-supplied: is this a regulatory or internal SLA? */
  slaKind: 'regulatory' | 'internal';
  /** Citation that drives the SLA. */
  citation: string;
}

export interface BreachPrediction {
  taskGid: string;
  tenantId: string;
  section: string;
  /** Elapsed clock hours in the current section. */
  elapsedHours: number;
  /** Hours remaining until the SLA window closes. */
  hoursRemaining: number;
  /** Fraction of the SLA consumed (0..1, may exceed 1 if already breached). */
  consumedRatio: number;
  /**
   * Predicted state at the end of the horizon:
   *   - 'safe'        : will not breach within horizon
   *   - 'at_risk'     : will be > 75% consumed at end of horizon
   *   - 'will_breach' : will exceed 100% within horizon
   *   - 'already_breached' : SLA window already closed
   */
  prediction: 'safe' | 'at_risk' | 'will_breach' | 'already_breached';
  citation: string;
  finding: string;
}

export interface BreachPredictionReport {
  schemaVersion: 1;
  evaluatedAtIso: string;
  horizonHours: number;
  predictions: readonly BreachPrediction[];
  summary: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PredictOptions {
  /** Horizon in clock hours. Default 4. */
  horizonHours?: number;
  /** Override the "now" function for tests. */
  now?: () => Date;
}

/**
 * Predict SLA breach state for a list of open tasks. Pure function.
 */
export function predictSlaBreaches(
  tasks: readonly OpenTaskSnapshot[],
  opts: PredictOptions = {}
): BreachPredictionReport {
  const horizon = opts.horizonHours ?? 4;
  const now = (opts.now ?? (() => new Date()))();
  const evaluatedAtIso = now.toISOString();

  const predictions: BreachPrediction[] = [];
  for (const t of tasks) {
    if (!t || typeof t.enteredSectionAtIso !== 'string') continue;
    const entered = Date.parse(t.enteredSectionAtIso);
    if (!Number.isFinite(entered)) continue;
    const elapsedMs = now.getTime() - entered;
    const elapsedHours = elapsedMs / 3_600_000;
    const projectedHours = elapsedHours + horizon;
    const consumedNow = t.slaHours > 0 ? elapsedHours / t.slaHours : 0;
    const projectedConsumed = t.slaHours > 0 ? projectedHours / t.slaHours : 0;
    const hoursRemaining = t.slaHours - elapsedHours;

    let prediction: BreachPrediction['prediction'];
    if (consumedNow >= 1) prediction = 'already_breached';
    else if (projectedConsumed >= 1) prediction = 'will_breach';
    else if (projectedConsumed >= 0.75) prediction = 'at_risk';
    else prediction = 'safe';

    predictions.push({
      taskGid: t.taskGid,
      tenantId: t.tenantId,
      section: t.section,
      elapsedHours,
      hoursRemaining,
      consumedRatio: consumedNow,
      prediction,
      citation: t.citation,
      finding:
        `${t.taskGid} in section "${t.section}": elapsed ${elapsedHours.toFixed(1)}h ` +
        `of ${t.slaHours}h SLA (${(consumedNow * 100).toFixed(0)}% consumed). ` +
        `Prediction at +${horizon}h: ${prediction}.`,
    });
  }

  // Sort: already_breached first, then will_breach, then at_risk, then safe.
  const order: Record<BreachPrediction['prediction'], number> = {
    already_breached: 0,
    will_breach: 1,
    at_risk: 2,
    safe: 3,
  };
  predictions.sort((a, b) => order[a.prediction] - order[b.prediction]);

  const breached = predictions.filter((p) => p.prediction === 'already_breached').length;
  const willBreach = predictions.filter((p) => p.prediction === 'will_breach').length;
  const atRisk = predictions.filter((p) => p.prediction === 'at_risk').length;

  const summary =
    `${tasks.length} task(s) evaluated. ${breached} already breached, ` +
    `${willBreach} will breach within ${horizon}h, ${atRisk} at risk.`;

  return {
    schemaVersion: 1,
    evaluatedAtIso,
    horizonHours: horizon,
    predictions,
    summary,
    regulatory: [
      'FDL No.10/2025 Art.26-27',
      'Cabinet Res 74/2020 Art.4-7',
      'Cabinet Res 134/2025 Art.19',
      'Cabinet Res 71/2024',
      'FATF Rec 1',
      'NIST AI RMF 1.0 MANAGE-2',
    ],
  };
}
