/**
 * Red-team continuous evasion test (cron).
 *
 * Runs nightly at 01:00 UTC. Generates 50 deterministic synthetic
 * adversarial compliance cases via `generateSyntheticEvasionCases`,
 * pushes each one through the compliance decision engine, and
 * records any miss — a case whose expected verdict was `escalate` or
 * `freeze` but whose actual engine verdict was `pass` or `flag`.
 *
 * Misses are persisted to a `red-team-misses` blob store so the MLRO
 * dashboard surfaces them, and also emit a high-severity brain event
 * that pages on-call.
 *
 * This is the "the model silently stopped catching SDGT typologies"
 * canary. Without it, a regression in one of the 97 subsystems is
 * only caught when a real MLRO notices a missed case in production.
 *
 * Regulatory basis:
 *   FATF Rec 1 — risk-based approach must be continuously tested
 *   NIST AI RMF MS-1.1 — adversarial robustness testing
 *   EU AI Act Art.15 — accuracy + robustness monitoring
 */

import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import {
  generateSyntheticEvasionCases,
  type SyntheticCase,
} from '../../src/services/syntheticEvasionGenerator';
import { runComplianceDecision } from '../../src/services/complianceDecisionEngine';
import type { StrFeatures } from '../../src/services/predictiveStr';

const RED_TEAM_STORE = 'red-team-misses';
const BRAIN_STORE = 'brain-events';

const VERDICT_RANK: Record<string, number> = {
  pass: 0,
  flag: 1,
  escalate: 2,
  freeze: 3,
};

/**
 * Translate a synthetic case into the minimum StrFeatures vector
 * required by the decision engine. Signals not expressed in the
 * synthetic case default to benign values.
 */
function synthToFeatures(c: SyntheticCase): StrFeatures {
  return {
    priorAlerts90d: c.signals.nearThresholdCount ? c.signals.nearThresholdCount : 0,
    txValue30dAED: 50_000,
    nearThresholdCount30d: c.signals.nearThresholdCount ?? 0,
    crossBorderRatio30d: c.signals.intermediaryCount ? 0.6 : 0.1,
    isPep: false,
    highRiskJurisdiction: (c.signals.adverseMediaCriticalCount ?? 0) > 0,
    hasAdverseMedia: (c.signals.adverseMediaCriticalCount ?? 0) > 0,
    daysSinceOnboarding: 400,
    sanctionsMatchScore: c.signals.sanctionsMatchScore ?? 0,
    cashRatio30d: 0.3,
  };
}

export default async (): Promise<Response> => {
  const startedAt = new Date().toISOString();
  const cases = generateSyntheticEvasionCases({ count: 50, seed: 42 });
  const misses: Array<{ case: SyntheticCase; actualVerdict: string; confidence: number }> = [];

  for (const c of cases) {
    try {
      const decision = await runComplianceDecision({
        tenantId: 'red-team',
        topic: `Synthetic: ${c.typology}`,
        entity: {
          id: c.id,
          name: `red-team-${c.id}`,
          features: synthToFeatures(c),
          actorUserId: 'red-team-cron',
        },
        sealAttestation: false,
      });
      const expectedRank = VERDICT_RANK[c.expectedVerdict] ?? 0;
      const actualRank = VERDICT_RANK[decision.verdict] ?? 0;
      if (actualRank < expectedRank) {
        misses.push({
          case: c,
          actualVerdict: decision.verdict,
          confidence: decision.confidence,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      misses.push({
        case: c,
        actualVerdict: `error:${message.slice(0, 80)}`,
        confidence: 0,
      });
    }
  }

  // Persist misses for the dashboard.
  if (misses.length > 0) {
    const store = getStore(RED_TEAM_STORE);
    await store.setJSON(`${startedAt.slice(0, 10)}/${Date.now()}.json`, {
      at: startedAt,
      total: cases.length,
      missed: misses.length,
      misses,
    });

    // Page on-call via a high-severity brain event.
    const brain = getStore(BRAIN_STORE);
    await brain.setJSON(`${startedAt.slice(0, 10)}/red-team-${Date.now()}.json`, {
      at: startedAt,
      event: {
        kind: 'system_warning',
        severity: 'high',
        summary: `Red-team: ${misses.length} of ${cases.length} synthetic cases misclassified. Immediate regression review required.`,
      },
    });

    // Dispatch an Asana red-team-miss plan for each miss so the MLRO
    // sees the regression in the same tool they use for real cases.
    // The dispatch is best-effort: a failure here does not unwind the
    // blob persistence above.
    try {
      const { orchestrateAsanaForEvent } = await import(
        '../../src/services/asanaComplianceOrchestrator'
      );
      const planStore = getStore('asana-plans');
      for (const m of misses.slice(0, 10)) {
        const plan = orchestrateAsanaForEvent({
          kind: 'red_team_miss',
          tenantId: 'red-team',
          occurredAtIso: startedAt,
          refId: m.case.id,
          payload: {
            typology: m.case.typology,
            expected: m.case.expectedVerdict,
            actual: m.actualVerdict,
          },
        });
        await planStore.setJSON(
          `${startedAt.slice(0, 10)}/red-team-${m.case.id}-${Date.now()}.json`,
          { at: startedAt, refId: m.case.id, plan }
        );
      }
    } catch (err) {
      console.warn('[red-team-cron] Asana dispatch failed:', err);
    }
  }

  return Response.json({
    ok: true,
    startedAt,
    total: cases.length,
    missed: misses.length,
    topMisses: misses.slice(0, 5).map((m) => ({
      typology: m.case.typology,
      expected: m.case.expectedVerdict,
      actual: m.actualVerdict,
    })),
  });
};

export const config: Config = {
  // 01:00 UTC daily — before the FX cron and before the business day.
  schedule: '0 1 * * *',
};
