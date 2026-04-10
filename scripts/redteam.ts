#!/usr/bin/env tsx
/**
 * Red-team sweep against the MegaBrain.
 *
 * Usage:
 *   npx tsx scripts/redteam.ts [--seed 42] [--count 200]
 *
 * Generates `count` deterministic adversarial scenarios (see
 * redTeamSimulator) and feeds each through a detector wrapper that
 * consults the MegaBrain. Prints a detection-rate table and exits
 * non-zero if detection rate falls below the threshold.
 */

import {
  generateScenarios,
  runRedTeam,
  type Detector,
  type DetectorResult,
  type RedTeamScenario,
} from '../src/services/redTeamSimulator';
import { runMegaBrain } from '../src/services/megaBrain';
import type { StrFeatures } from '../src/services/predictiveStr';

const args = process.argv.slice(2);
const seed = argInt(args, '--seed', 42);
const count = argInt(args, '--count', 100);
const threshold = argFloat(args, '--threshold', 0.6);

function argInt(list: string[], name: string, fallback: number): number {
  const idx = list.indexOf(name);
  if (idx < 0 || idx + 1 >= list.length) return fallback;
  const n = Number(list[idx + 1]);
  return Number.isFinite(n) ? n : fallback;
}

function argFloat(list: string[], name: string, fallback: number): number {
  const idx = list.indexOf(name);
  if (idx < 0 || idx + 1 >= list.length) return fallback;
  const n = Number(list[idx + 1]);
  return Number.isFinite(n) ? n : fallback;
}

const cleanBase: StrFeatures = {
  priorAlerts90d: 0,
  txValue30dAED: 100_000,
  nearThresholdCount30d: 0,
  crossBorderRatio30d: 0,
  isPep: false,
  highRiskJurisdiction: false,
  hasAdverseMedia: false,
  daysSinceOnboarding: 365,
  sanctionsMatchScore: 0,
  cashRatio30d: 0.1,
};

function scenarioToFeatures(scenario: RedTeamScenario): StrFeatures {
  const features = { ...cleanBase };
  switch (scenario.kind) {
    case 'name_obfuscation':
      features.sanctionsMatchScore = 0.85;
      features.hasAdverseMedia = true;
      break;
    case 'structuring':
      features.nearThresholdCount30d = 6;
      features.cashRatio30d = 0.7;
      break;
    case 'circular_trade':
      features.crossBorderRatio30d = 0.8;
      features.priorAlerts90d = 3;
      break;
    case 'round_tripping':
      features.txValue30dAED = 2_500_000;
      features.crossBorderRatio30d = 0.9;
      break;
    case 'new_entity_hop':
      features.daysSinceOnboarding = 12;
      features.sanctionsMatchScore = 0.9;
      break;
    case 'good_delivery_swap':
      features.priorAlerts90d = 4;
      features.hasAdverseMedia = true;
      break;
    case 'vault_overdraw':
      features.priorAlerts90d = 5;
      features.highRiskJurisdiction = true;
      break;
    case 'pep_shadow':
      features.isPep = true;
      features.hasAdverseMedia = true;
      break;
    case 'crypto_layer':
      features.crossBorderRatio30d = 0.95;
      features.cashRatio30d = 0.3;
      break;
    case 'document_forge':
      features.priorAlerts90d = 2;
      features.hasAdverseMedia = true;
      break;
  }
  return features;
}

const megaBrainDetector: Detector = async (scenario): Promise<DetectorResult> => {
  const features = scenarioToFeatures(scenario);
  const result = runMegaBrain({
    topic: `Red-team: ${scenario.kind}`,
    entity: {
      id: scenario.id,
      name: scenario.id,
      features,
    },
  });
  return {
    verdict: result.verdict,
    confidence: result.confidence,
    rationale: result.recommendedAction,
  };
};

async function main(): Promise<void> {
  const scenarios = generateScenarios(seed, count);
  console.log(
    `Running red-team sweep: seed=${seed}, scenarios=${count}, threshold=${threshold}`,
  );
  const report = await runRedTeam(scenarios, megaBrainDetector);
  console.log('');
  console.log(
    `Detection rate: ${(report.detectionRate * 100).toFixed(1)}% (${report.detected}/${report.total})`,
  );
  console.log('');
  console.log('By kind:');
  for (const [kind, bucket] of Object.entries(report.byKind)) {
    console.log(
      `  ${kind.padEnd(22)}  ${bucket.detected}/${bucket.total}  ${(bucket.rate * 100).toFixed(1)}%`,
    );
  }
  console.log('');
  console.log('By difficulty:');
  for (const [d, bucket] of Object.entries(report.byDifficulty)) {
    console.log(`  difficulty ${d}  ${bucket.detected}/${bucket.total}  ${(bucket.rate * 100).toFixed(1)}%`);
  }

  if (report.detectionRate < threshold) {
    console.error(
      `\nFAIL: detection rate ${(report.detectionRate * 100).toFixed(1)}% below threshold ${(threshold * 100).toFixed(0)}%`,
    );
    process.exit(1);
  }
  console.log('\nOK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
