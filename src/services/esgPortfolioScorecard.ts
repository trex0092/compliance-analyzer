/**
 * ESG Portfolio Scorecard.
 *
 * Aggregates per-customer ESG scores (from `esgScorer.ts`) into a
 * portfolio-level scorecard suitable for the MLRO dashboard, the
 * Asana custom field router, and the regulator inspector portal.
 *
 * Pure compute. No I/O. Caller passes a list of `EsgScore` records
 * produced by `calculateEsgScore` and gets back per-pillar averages,
 * grade distribution, top-N highest risk customers, and a
 * SDG-alignment rollup.
 *
 * Regulatory basis:
 *   FATF Rec 1 (risk-based approach must consider ESG)
 *   LBMA RGG v9 Step 5 (annual ESG audit)
 *   MoE Circular 08/AML/2021 (DPMS sector ESG disclosure)
 *   GRI Universal Standards 2021 (E + S + G aggregation)
 *   TCFD (climate disclosure)
 *   EU CSRD (corporate sustainability reporting)
 */

import type { EsgScore, EsgGrade, EsgRiskLevel } from './esgScorer';

export interface CustomerEsgRecord {
  /** Stable customer identifier. */
  customerId: string;
  /** Hashed display name (FDL Art.29 — never the cleartext name). */
  displayName: string;
  /** ESG score from calculateEsgScore. */
  score: EsgScore;
  /** Optional sector tag for sector-level rollups. */
  sector?: string;
}

export interface PortfolioScorecard {
  generatedAtIso: string;
  totalCustomers: number;
  pillarAverages: {
    environmentalAvg: number;
    socialAvg: number;
    governanceAvg: number;
    overallAvg: number;
  };
  /** Counts per grade A..F. */
  gradeDistribution: Record<EsgGrade, number>;
  /** Counts per risk level low / medium / high / critical. */
  riskDistribution: Record<EsgRiskLevel, number>;
  /** Per-sector aggregate (if any sector tags supplied). */
  bySector: Array<{
    sector: string;
    count: number;
    overallAvg: number;
    grade: EsgGrade;
    risk: EsgRiskLevel;
  }>;
  /** Top N highest-risk customers. */
  topRisks: Array<{
    customerId: string;
    displayName: string;
    overallScore: number;
    grade: EsgGrade;
    riskLevel: EsgRiskLevel;
    sector?: string;
  }>;
  /** Total number of customers per pillar that fall in the bottom quartile. */
  bottomQuartileCounts: {
    environmental: number;
    social: number;
    governance: number;
  };
  /** Plain-English notes the dashboard surfaces. */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return Math.round((sum / values.length) * 100) / 100;
}

function gradeFromScore(score: number): EsgGrade {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function riskFromScore(score: number): EsgRiskLevel {
  if (score >= 75) return 'low';
  if (score >= 55) return 'medium';
  if (score >= 35) return 'high';
  return 'critical';
}

function emptyGradeDist(): Record<EsgGrade, number> {
  return { A: 0, B: 0, C: 0, D: 0, F: 0 };
}

function emptyRiskDist(): Record<EsgRiskLevel, number> {
  return { low: 0, medium: 0, high: 0, critical: 0 };
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export interface ScorecardOptions {
  /** Top-N risks to surface. Default 10. */
  topN?: number;
  /** Optional override of the generated-at timestamp (used in tests). */
  generatedAtIso?: string;
}

export function buildEsgPortfolioScorecard(
  customers: readonly CustomerEsgRecord[],
  options: ScorecardOptions = {}
): PortfolioScorecard {
  const generatedAtIso = options.generatedAtIso ?? new Date().toISOString();
  const topN = options.topN ?? 10;

  if (customers.length === 0) {
    return {
      generatedAtIso,
      totalCustomers: 0,
      pillarAverages: {
        environmentalAvg: 0,
        socialAvg: 0,
        governanceAvg: 0,
        overallAvg: 0,
      },
      gradeDistribution: emptyGradeDist(),
      riskDistribution: emptyRiskDist(),
      bySector: [],
      topRisks: [],
      bottomQuartileCounts: { environmental: 0, social: 0, governance: 0 },
      notes: ['No customers in scope.'],
    };
  }

  const envScores: number[] = [];
  const socScores: number[] = [];
  const govScores: number[] = [];
  const overallScores: number[] = [];
  const gradeDist = emptyGradeDist();
  const riskDist = emptyRiskDist();
  const sectorBuckets = new Map<string, number[]>();

  for (const c of customers) {
    envScores.push(c.score.pillars.E.score);
    socScores.push(c.score.pillars.S.score);
    govScores.push(c.score.pillars.G.score);
    overallScores.push(c.score.totalScore);
    gradeDist[c.score.grade]++;
    riskDist[c.score.riskLevel]++;
    if (c.sector) {
      const list = sectorBuckets.get(c.sector) ?? [];
      list.push(c.score.totalScore);
      sectorBuckets.set(c.sector, list);
    }
  }

  // Sort overall scores ascending so we can pick a 25th percentile.
  const sortedOverall = [...overallScores].sort((a, b) => a - b);
  const q1Index = Math.floor(sortedOverall.length * 0.25);
  const q1Threshold = sortedOverall[q1Index] ?? 0;

  const bottomQuartileEnv = envScores.filter((s) => s <= q1Threshold).length;
  const bottomQuartileSoc = socScores.filter((s) => s <= q1Threshold).length;
  const bottomQuartileGov = govScores.filter((s) => s <= q1Threshold).length;

  // Top-N highest-risk customers by ascending total score.
  const topRisks = [...customers]
    .sort((a, b) => a.score.totalScore - b.score.totalScore)
    .slice(0, topN)
    .map((c) => ({
      customerId: c.customerId,
      displayName: c.displayName,
      overallScore: c.score.totalScore,
      grade: c.score.grade,
      riskLevel: c.score.riskLevel,
      sector: c.sector,
    }));

  const bySector = Array.from(sectorBuckets.entries())
    .map(([sector, scores]) => {
      const avg = average(scores);
      return {
        sector,
        count: scores.length,
        overallAvg: avg,
        grade: gradeFromScore(avg),
        risk: riskFromScore(avg),
      };
    })
    .sort((a, b) => a.overallAvg - b.overallAvg);

  const overallAvg = average(overallScores);
  const notes: string[] = [];
  if (overallAvg < 55) {
    notes.push(
      `Portfolio overall ESG average is ${overallAvg} — below 55. ESG-related red flags should trigger EDD per FATF Rec 1.`
    );
  }
  if (riskDist.critical > 0) {
    notes.push(
      `${riskDist.critical} customer(s) at critical ESG risk. Review for STR / exit per FDL Art.20.`
    );
  }
  if (gradeDist.F > 0) {
    notes.push(`${gradeDist.F} customer(s) with grade F — eligible for immediate EDD escalation.`);
  }
  if (notes.length === 0) {
    notes.push('Portfolio ESG profile is within tolerance.');
  }

  return {
    generatedAtIso,
    totalCustomers: customers.length,
    pillarAverages: {
      environmentalAvg: average(envScores),
      socialAvg: average(socScores),
      governanceAvg: average(govScores),
      overallAvg,
    },
    gradeDistribution: gradeDist,
    riskDistribution: riskDist,
    bySector,
    topRisks,
    bottomQuartileCounts: {
      environmental: bottomQuartileEnv,
      social: bottomQuartileSoc,
      governance: bottomQuartileGov,
    },
    notes,
  };
}
