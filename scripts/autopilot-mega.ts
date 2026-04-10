#!/usr/bin/env tsx
/**
 * MegaBrain Autopilot — batch assessment of a customer portfolio.
 *
 * Runs the MegaBrain over a set of customer feature vectors loaded
 * from `autopilot-portfolio.json` (default) and prints a summary
 * table of verdicts + confidences + required-review flags.
 *
 * Usage:
 *   npx tsx scripts/autopilot-mega.ts [--portfolio path.json] [--json]
 *
 * Each customer in the portfolio JSON must look like:
 *
 *   {
 *     "id": "CUST-001",
 *     "name": "Acme Metals LLC",
 *     "features": {
 *       "priorAlerts90d": 0,
 *       "txValue30dAED": 500000,
 *       "nearThresholdCount30d": 0,
 *       "crossBorderRatio30d": 0,
 *       "isPep": false,
 *       "highRiskJurisdiction": false,
 *       "hasAdverseMedia": false,
 *       "daysSinceOnboarding": 365,
 *       "sanctionsMatchScore": 0,
 *       "cashRatio30d": 0.1
 *     }
 *   }
 *
 * Exits non-zero if any customer requires human review (so it can be
 * used as a CI gate that forces MLRO attention on escalations).
 */

import { readFile } from 'node:fs/promises';
import { runMegaBrain, type MegaBrainResponse } from '../src/services/megaBrain';
import type { StrFeatures } from '../src/services/predictiveStr';

const args = process.argv.slice(2);
const portfolioPath = argValue(args, '--portfolio', 'autopilot-portfolio.json');
const asJson = args.includes('--json');

function argValue(list: string[], name: string, fallback: string): string {
  const idx = list.indexOf(name);
  if (idx < 0 || idx + 1 >= list.length) return fallback;
  return list[idx + 1];
}

interface PortfolioEntry {
  id: string;
  name: string;
  features: StrFeatures;
  isSanctionsConfirmed?: boolean;
}

async function loadPortfolio(path: string): Promise<PortfolioEntry[]> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as PortfolioEntry[];
  } catch {
    console.warn(`No portfolio file at ${path}, using built-in demo portfolio.`);
    return demoPortfolio();
  }
}

function demoPortfolio(): PortfolioEntry[] {
  return [
    {
      id: 'CUST-A',
      name: 'Clean Gold Trading LLC',
      features: {
        priorAlerts90d: 0,
        txValue30dAED: 300_000,
        nearThresholdCount30d: 0,
        crossBorderRatio30d: 0,
        isPep: false,
        highRiskJurisdiction: false,
        hasAdverseMedia: false,
        daysSinceOnboarding: 900,
        sanctionsMatchScore: 0,
        cashRatio30d: 0.05,
      },
    },
    {
      id: 'CUST-B',
      name: 'Medium Risk Jewellers',
      features: {
        priorAlerts90d: 2,
        txValue30dAED: 1_200_000,
        nearThresholdCount30d: 1,
        crossBorderRatio30d: 0.3,
        isPep: false,
        highRiskJurisdiction: false,
        hasAdverseMedia: false,
        daysSinceOnboarding: 180,
        sanctionsMatchScore: 0.1,
        cashRatio30d: 0.4,
      },
    },
    {
      id: 'CUST-C',
      name: 'High Risk Bullion Co',
      features: {
        priorAlerts90d: 6,
        txValue30dAED: 4_500_000,
        nearThresholdCount30d: 5,
        crossBorderRatio30d: 0.8,
        isPep: true,
        highRiskJurisdiction: true,
        hasAdverseMedia: true,
        daysSinceOnboarding: 60,
        sanctionsMatchScore: 0.85,
        cashRatio30d: 0.75,
      },
    },
  ];
}

function summarise(entry: PortfolioEntry, response: MegaBrainResponse): Record<string, unknown> {
  return {
    id: entry.id,
    name: entry.name,
    verdict: response.verdict,
    confidence: response.confidence,
    requiresHumanReview: response.requiresHumanReview,
    recommendedAction: response.recommendedAction,
    strProbability: response.subsystems.strPrediction.probability,
    reflectionScore: response.subsystems.reflection.confidence,
  };
}

async function main(): Promise<void> {
  const portfolio = await loadPortfolio(portfolioPath);
  const summaries: Array<Record<string, unknown>> = [];
  let needingReview = 0;

  for (const entry of portfolio) {
    const response = runMegaBrain({
      topic: `Autopilot assessment: ${entry.name}`,
      entity: {
        id: entry.id,
        name: entry.name,
        features: entry.features,
        isSanctionsConfirmed: entry.isSanctionsConfirmed,
      },
    });
    if (response.requiresHumanReview) needingReview++;
    summaries.push(summarise(entry, response));
  }

  if (asJson) {
    console.log(JSON.stringify({ portfolio: summaries, needingReview }, null, 2));
  } else {
    console.log(`MegaBrain autopilot — ${portfolio.length} customers`);
    console.log('-'.repeat(90));
    console.log(
      `${'ID'.padEnd(10)} ${'VERDICT'.padEnd(10)} ${'CONF'.padEnd(6)} ${'REVIEW'.padEnd(7)} NAME`,
    );
    console.log('-'.repeat(90));
    for (const s of summaries) {
      console.log(
        `${String(s.id).padEnd(10)} ${String(s.verdict).padEnd(10)} ${String(s.confidence).padEnd(6)} ${String(s.requiresHumanReview).padEnd(7)} ${String(s.name)}`,
      );
    }
    console.log('-'.repeat(90));
    console.log(`${needingReview} of ${portfolio.length} customer(s) need human review.`);
  }

  if (needingReview > 0) {
    process.exitCode = 2; // distinct from test failure (1)
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
