/**
 * ESG Composite Scorer — subsystem #82 (Phase 10 ESG Weaponization).
 *
 * Computes a 0-100 ESG score across three equally-weighted pillars:
 *
 *   E — Environmental  (33.3 pts max)
 *       Carbon intensity vs gold-mining benchmark, environmental incidents,
 *       water-use intensity, renewable energy share, waste recycling rate,
 *       third-party environmental certification (ISO 14001, EMAS).
 *
 *   S — Social  (33.3 pts max)
 *       Labor rights score, safety record (LTIFR), living-wage compliance,
 *       gender pay gap, community grievance mechanism, supplier code-of-conduct
 *       coverage, modern-slavery statement quality.
 *
 *   G — Governance  (33.3 pts max)
 *       Board independence, anti-corruption programme, whistleblower channel,
 *       ESG disclosure quality (GRI/SASB/ISSB), executive pay ratio,
 *       tax-transparency report, beneficial ownership transparency.
 *
 * Grades: A (≥80), B (60-79), C (40-59), D (20-39), F (<20).
 * Score < 40 → HIGH ESG RISK — triggers a safety clamp in the brain.
 *
 * Regulatory basis:
 *   - ISSB IFRS S1 (general sustainability disclosures)
 *   - ISSB IFRS S2 (climate-related disclosures)
 *   - GRI Standards 2021 (Materiality + Topic Standards)
 *   - UAE Vision 2031 / UAE Net Zero 2050
 *   - DIFC Sustainable Finance Framework 2023
 *   - LBMA Responsible Gold Guidance v9 (ESG component)
 *   - OECD Due Diligence Guidance 2016 (supply-chain)
 *   - EU SFDR 2019/2088 (disclosure regulation)
 *   - NIST AI RMF GV-1.6 (AI governance ↔ ESG accountability)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnvironmentalInput {
  /** Carbon intensity (tCO₂eq per troy oz gold or per AED 1M revenue). */
  carbonIntensity?: number;
  /** Industry benchmark for carbon intensity (same units). Default: 20 tCO₂/oz. */
  carbonBenchmark?: number;
  /** Number of material environmental incidents in last 12 months. */
  environmentalIncidents?: number;
  /** Renewable energy share (0-100 %). */
  renewableEnergyPct?: number;
  /** Water recycling/reuse rate (0-100 %). */
  waterRecyclingPct?: number;
  /** Has ISO 14001 or equivalent certification. */
  hasEnvironmentalCertification?: boolean;
  /** Scope 3 emissions disclosed in latest report. */
  scope3Disclosed?: boolean;
}

export interface SocialInput {
  /** Composite labour rights score from auditor (0-100). */
  labourRightsScore?: number;
  /** Lost-Time Injury Frequency Rate per 1M hours. */
  ltifr?: number;
  /** Industry LTIFR benchmark. Default: 2.5. */
  ltifrBenchmark?: number;
  /** Gender pay gap (%) — positive means men earn more. */
  genderPayGapPct?: number;
  /** % of supply chain suppliers covered by code-of-conduct. */
  supplierCocCoveragePct?: number;
  /** Has formal community grievance mechanism. */
  hasCommunityGrievanceMechanism?: boolean;
  /** Modern slavery statement published and compliant. */
  modernSlaveryStatementCompliant?: boolean;
  /** Local employment ratio (% of workforce from host communities). */
  localEmploymentPct?: number;
}

export interface GovernanceInput {
  /** Board independence ratio (0-100 %). */
  boardIndependencePct?: number;
  /** Has formal anti-corruption programme (ISO 37001 or equivalent). */
  hasAntiCorruptionProgramme?: boolean;
  /** Has operational whistleblower channel. */
  hasWhistleblowerChannel?: boolean;
  /** ESG disclosure standard used ('GRI' | 'SASB' | 'ISSB' | 'TCFD' | 'none'). */
  disclosureStandard?: 'GRI' | 'SASB' | 'ISSB' | 'TCFD' | 'integrated' | 'none';
  /** CEO-to-median-worker pay ratio. */
  ceToMedianPayRatio?: number;
  /** Publishes country-by-country tax transparency report. */
  taxTransparencyReport?: boolean;
  /** UBO register up to date (Cabinet Decision 109/2023). */
  uboRegisterCurrent?: boolean;
  /** Is listed entity or subject to mandatory ESG reporting. */
  mandatoryEsgReporting?: boolean;
}

export interface EsgInput {
  /** Entity identifier. */
  entityId: string;
  /** Entity name for narrative. */
  entityName: string;
  /** Industry sector — used for benchmark context. */
  sector?: 'precious_metals' | 'mining' | 'refining' | 'trading' | 'retail_jewellery' | 'other';
  environmental?: EnvironmentalInput;
  social?: SocialInput;
  governance?: GovernanceInput;
}

export interface EsgPillarScore {
  pillar: 'E' | 'S' | 'G';
  score: number; // 0-33.3
  maxScore: number; // 33.3
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  gaps: string[];
  strengths: string[];
}

export type EsgGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export type EsgRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface EsgScore {
  entityId: string;
  totalScore: number; // 0-100
  grade: EsgGrade;
  riskLevel: EsgRiskLevel;
  pillars: { E: EsgPillarScore; S: EsgPillarScore; G: EsgPillarScore };
  criticalGaps: string[];
  keyStrengths: string[];
  narrative: string;
  disclosureCompleteness: number; // 0-100, based on how many inputs were provided
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function grade(score: number, max: number): EsgGrade {
  const pct = (score / max) * 100;
  if (pct >= 80) return 'A';
  if (pct >= 60) return 'B';
  if (pct >= 40) return 'C';
  if (pct >= 20) return 'D';
  return 'F';
}

function riskLevel(total: number): EsgRiskLevel {
  if (total >= 70) return 'low';
  if (total >= 50) return 'medium';
  if (total >= 30) return 'high';
  return 'critical';
}

const MAX_PILLAR = 100 / 3; // ≈ 33.333

// ---------------------------------------------------------------------------
// Environmental scoring
// ---------------------------------------------------------------------------

function scoreEnvironmental(e: EnvironmentalInput): EsgPillarScore {
  const gaps: string[] = [];
  const strengths: string[] = [];
  let score = 0;
  const pts = MAX_PILLAR / 6; // 6 sub-dimensions

  // Carbon intensity vs benchmark
  const benchmark = e.carbonBenchmark ?? 20;
  if (e.carbonIntensity !== undefined) {
    const ratio = e.carbonIntensity / benchmark;
    if (ratio <= 0.5) {
      score += pts;
      strengths.push('Carbon intensity ≤50% of sector benchmark');
    } else if (ratio <= 1.0) {
      score += pts * 0.6;
    } else if (ratio <= 2.0) {
      score += pts * 0.2;
      gaps.push(
        `Carbon intensity ${e.carbonIntensity.toFixed(1)} = ${(ratio * 100).toFixed(0)}% of benchmark (ISSB S2)`
      );
    } else {
      gaps.push(
        `Carbon intensity ${e.carbonIntensity.toFixed(1)} = ${(ratio * 100).toFixed(0)}% of benchmark — critical (ISSB S2)`
      );
    }
  } else {
    gaps.push('Carbon intensity not disclosed (ISSB IFRS S2 mandatory)');
  }

  // Environmental incidents
  const incidents = e.environmentalIncidents ?? 0;
  if (incidents === 0) {
    score += pts;
    strengths.push('Zero material environmental incidents');
  } else if (incidents <= 2) {
    score += pts * 0.4;
    gaps.push(`${incidents} environmental incident(s) — review root cause`);
  } else {
    gaps.push(`${incidents} environmental incidents — material (GRI 302)`);
  }

  // Renewable energy
  if (e.renewableEnergyPct !== undefined) {
    score += pts * Math.min(e.renewableEnergyPct / 100, 1);
    if (e.renewableEnergyPct >= 50) strengths.push(`${e.renewableEnergyPct}% renewable energy`);
    else if (e.renewableEnergyPct < 20)
      gaps.push(`Only ${e.renewableEnergyPct}% renewable energy (UAE Net Zero 2050)`);
  } else {
    gaps.push('Renewable energy share not disclosed (UAE Net Zero 2050)');
  }

  // Water recycling
  if (e.waterRecyclingPct !== undefined) {
    score += pts * Math.min(e.waterRecyclingPct / 100, 1);
    if (e.waterRecyclingPct >= 60) strengths.push(`${e.waterRecyclingPct}% water recycling rate`);
  } else {
    gaps.push('Water recycling rate not disclosed (GRI 303)');
  }

  // Environmental certification
  if (e.hasEnvironmentalCertification) {
    score += pts;
    strengths.push('ISO 14001 or equivalent certification');
  } else {
    gaps.push('No third-party environmental certification (ISO 14001 recommended)');
  }

  // Scope 3 disclosure
  if (e.scope3Disclosed) {
    score += pts;
    strengths.push('Scope 3 emissions disclosed');
  } else {
    gaps.push('Scope 3 emissions not disclosed (ISSB IFRS S2 / GHG Protocol)');
  }

  return {
    pillar: 'E',
    score,
    maxScore: MAX_PILLAR,
    grade: grade(score, MAX_PILLAR),
    gaps,
    strengths,
  };
}

// ---------------------------------------------------------------------------
// Social scoring
// ---------------------------------------------------------------------------

function scoreSocial(s: SocialInput): EsgPillarScore {
  const gaps: string[] = [];
  const strengths: string[] = [];
  let score = 0;
  const pts = MAX_PILLAR / 7;

  // Labour rights score
  if (s.labourRightsScore !== undefined) {
    score += pts * (s.labourRightsScore / 100);
    if (s.labourRightsScore >= 80) strengths.push(`Labour rights score ${s.labourRightsScore}/100`);
    else if (s.labourRightsScore < 50)
      gaps.push(
        `Labour rights score ${s.labourRightsScore}/100 — below threshold (ILO C29, C87, C98)`
      );
  } else {
    gaps.push('Labour rights audit score not available (ILO core conventions)');
  }

  // LTIFR safety record
  const ltifrBench = s.ltifrBenchmark ?? 2.5;
  if (s.ltifr !== undefined) {
    const ratio = s.ltifr / ltifrBench;
    if (ratio <= 0.5) {
      score += pts;
      strengths.push(`LTIFR ${s.ltifr} (≤50% of benchmark)`);
    } else if (ratio <= 1.0) {
      score += pts * 0.6;
    } else {
      gaps.push(`LTIFR ${s.ltifr} exceeds benchmark ${ltifrBench} (GRI 403)`);
    }
  } else {
    gaps.push('Safety LTIFR not disclosed (GRI 403)');
  }

  // Gender pay gap
  if (s.genderPayGapPct !== undefined) {
    if (s.genderPayGapPct <= 5) {
      score += pts;
      strengths.push(`Gender pay gap ${s.genderPayGapPct}% (near parity)`);
    } else if (s.genderPayGapPct <= 15) {
      score += pts * 0.5;
      gaps.push(`Gender pay gap ${s.genderPayGapPct}% (target <5%, GRI 405)`);
    } else {
      gaps.push(
        `Gender pay gap ${s.genderPayGapPct}% — material (GRI 405 / UAE Gender Balance Council)`
      );
    }
  } else {
    gaps.push('Gender pay gap not disclosed (GRI 405)');
  }

  // Supplier code-of-conduct coverage
  if (s.supplierCocCoveragePct !== undefined) {
    score += pts * Math.min(s.supplierCocCoveragePct / 100, 1);
    if (s.supplierCocCoveragePct >= 80)
      strengths.push(`${s.supplierCocCoveragePct}% supplier CoC coverage`);
    else if (s.supplierCocCoveragePct < 50)
      gaps.push(
        `Only ${s.supplierCocCoveragePct}% of suppliers covered by Code of Conduct (OECD DDG 2016)`
      );
  } else {
    gaps.push('Supplier CoC coverage not disclosed (OECD DDG 2016)');
  }

  // Community grievance mechanism
  if (s.hasCommunityGrievanceMechanism) {
    score += pts;
    strengths.push('Formal community grievance mechanism in place');
  } else {
    gaps.push('No community grievance mechanism (GRI 413 / UN Guiding Principles)');
  }

  // Modern slavery statement
  if (s.modernSlaveryStatementCompliant) {
    score += pts;
    strengths.push('Modern slavery statement compliant');
  } else {
    gaps.push(
      'Modern slavery statement absent or non-compliant (UAE Fed Law 51/2006 / UK MSA 2015)'
    );
  }

  // Local employment
  if (s.localEmploymentPct !== undefined) {
    score += pts * Math.min(s.localEmploymentPct / 60, 1);
    if (s.localEmploymentPct >= 40) strengths.push(`${s.localEmploymentPct}% local employment`);
  } else {
    gaps.push('Local employment ratio not disclosed (GRI 202)');
  }

  return {
    pillar: 'S',
    score,
    maxScore: MAX_PILLAR,
    grade: grade(score, MAX_PILLAR),
    gaps,
    strengths,
  };
}

// ---------------------------------------------------------------------------
// Governance scoring
// ---------------------------------------------------------------------------

function scoreGovernance(g: GovernanceInput): EsgPillarScore {
  const gaps: string[] = [];
  const strengths: string[] = [];
  let score = 0;
  const pts = MAX_PILLAR / 7;

  // Board independence
  if (g.boardIndependencePct !== undefined) {
    score += pts * Math.min(g.boardIndependencePct / 50, 1); // full credit at 50%+
    if (g.boardIndependencePct >= 50)
      strengths.push(`${g.boardIndependencePct}% board independence`);
    else if (g.boardIndependencePct < 30)
      gaps.push(`Only ${g.boardIndependencePct}% board independent (target ≥50%, GRI 2-9)`);
  } else {
    gaps.push('Board composition not disclosed (GRI 2-9)');
  }

  // Anti-corruption
  if (g.hasAntiCorruptionProgramme) {
    score += pts;
    strengths.push('Formal anti-corruption programme (ISO 37001 / FCPA)');
  } else {
    gaps.push('No anti-corruption programme (ISO 37001 / UAE Federal Law 4/2012 / FCPA)');
  }

  // Whistleblower
  if (g.hasWhistleblowerChannel) {
    score += pts;
    strengths.push('Whistleblower channel operational');
  } else {
    gaps.push('No whistleblower channel (GRI 2-26 / UAE Labour Law)');
  }

  // Disclosure standard
  const disclosureScores: Record<string, number> = {
    integrated: 1.0,
    ISSB: 1.0,
    GRI: 0.85,
    SASB: 0.8,
    TCFD: 0.75,
    none: 0,
  };
  const discStd = g.disclosureStandard ?? 'none';
  score += pts * (disclosureScores[discStd] ?? 0);
  if (discStd !== 'none') strengths.push(`ESG disclosure standard: ${discStd}`);
  else gaps.push('No ESG disclosure standard adopted (ISSB IFRS S1 / GRI 2021)');

  // CEO pay ratio
  if (g.ceToMedianPayRatio !== undefined) {
    if (g.ceToMedianPayRatio <= 20) {
      score += pts;
      strengths.push(`CEO/median pay ratio ${g.ceToMedianPayRatio}× (within range)`);
    } else if (g.ceToMedianPayRatio <= 50) {
      score += pts * 0.5;
      gaps.push(`CEO/median pay ratio ${g.ceToMedianPayRatio}× — elevated (GRI 2-21)`);
    } else {
      gaps.push(`CEO/median pay ratio ${g.ceToMedianPayRatio}× — excessive (GRI 2-21)`);
    }
  } else {
    gaps.push('CEO-to-median pay ratio not disclosed (GRI 2-21)');
  }

  // Tax transparency
  if (g.taxTransparencyReport) {
    score += pts;
    strengths.push('Country-by-country tax transparency published');
  } else {
    gaps.push('No country-by-country tax report (GRI 207 / GloBE Pillar 2)');
  }

  // UBO register
  if (g.uboRegisterCurrent) {
    score += pts;
    strengths.push('UBO register current (Cabinet Decision 109/2023)');
  } else {
    gaps.push('UBO register not current (Cabinet Decision 109/2023 — 15-day re-verification)');
  }

  return {
    pillar: 'G',
    score,
    maxScore: MAX_PILLAR,
    grade: grade(score, MAX_PILLAR),
    gaps,
    strengths,
  };
}

// ---------------------------------------------------------------------------
// Main scorer
// ---------------------------------------------------------------------------

export function calculateEsgScore(input: EsgInput): EsgScore {
  const eScore = input.environmental
    ? scoreEnvironmental(input.environmental)
    : {
        pillar: 'E' as const,
        score: 0,
        maxScore: MAX_PILLAR,
        grade: 'F' as EsgGrade,
        gaps: ['No Environmental data provided'],
        strengths: [],
      };

  const sScore = input.social
    ? scoreSocial(input.social)
    : {
        pillar: 'S' as const,
        score: 0,
        maxScore: MAX_PILLAR,
        grade: 'F' as EsgGrade,
        gaps: ['No Social data provided'],
        strengths: [],
      };

  const gScore = input.governance
    ? scoreGovernance(input.governance)
    : {
        pillar: 'G' as const,
        score: 0,
        maxScore: MAX_PILLAR,
        grade: 'F' as EsgGrade,
        gaps: ['No Governance data provided'],
        strengths: [],
      };

  const totalScore = Math.round((eScore.score + sScore.score + gScore.score) * 10) / 10;
  const totalGrade = grade(totalScore, 100);
  const risk = riskLevel(totalScore);

  // Disclosure completeness: count provided inputs
  const provided = [input.environmental, input.social, input.governance].filter(Boolean).length;
  const disclosureCompleteness = Math.round((provided / 3) * 100);

  const criticalGaps = [
    ...eScore.gaps.filter((g) => g.includes('critical') || g.includes('mandatory')),
    ...sScore.gaps.filter((g) => g.includes('critical') || g.toLowerCase().includes('slavery')),
    ...gScore.gaps.filter((g) => g.includes('anti-corruption') || g.includes('UBO')),
  ];

  const keyStrengths = [
    ...eScore.strengths.slice(0, 2),
    ...sScore.strengths.slice(0, 2),
    ...gScore.strengths.slice(0, 2),
  ];

  const narrative =
    `ESG assessment for ${input.entityName} (${input.sector ?? 'unknown sector'}): ` +
    `composite score ${totalScore}/100 (grade ${totalGrade}, ${risk} ESG risk). ` +
    `E=${eScore.score.toFixed(1)}/33 (${eScore.grade}), ` +
    `S=${sScore.score.toFixed(1)}/33 (${sScore.grade}), ` +
    `G=${gScore.score.toFixed(1)}/33 (${gScore.grade}). ` +
    `Disclosure completeness: ${disclosureCompleteness}%. ` +
    (criticalGaps.length > 0 ? `Critical gaps: ${criticalGaps.length}.` : 'No critical gaps.');

  return {
    entityId: input.entityId,
    totalScore,
    grade: totalGrade,
    riskLevel: risk,
    pillars: { E: eScore, S: sScore, G: gScore },
    criticalGaps,
    keyStrengths,
    narrative,
    disclosureCompleteness,
  };
}
