/**
 * UN SDG Alignment Scorer for DPMS Gold Dealers
 *
 * Maps entity activities, policies and disclosures to the 17 UN Sustainable
 * Development Goals, with DPMS-sector relevance weighting and LBMA/OECD
 * responsible-sourcing alignment checks.
 *
 * Regulatory: UN SDG Framework (2015), LBMA Responsible Gold Guidance v9,
 *             OECD DDG 2016 (5-step framework), GRI Standards 2021,
 *             UAE Vision 2031, UAE SDG Agenda, DIFC Sustainable Finance
 *             Framework 2023, IFC Performance Standards.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type SdgNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17;

export type SdgAlignment = 'negative' | 'neutral' | 'partial' | 'aligned' | 'leading';
export type SdgImpactDirection = 'positive' | 'neutral' | 'negative';

export interface SdgIndicator {
  sdg: SdgNumber;
  title: string;
  dpmsRelevance: 'core' | 'adjacent' | 'low';
  weight: number; // weighting for DPMS sector 0–1
}

/** All 17 SDGs with DPMS-sector weights */
export const DPMS_SDG_WEIGHTS: SdgIndicator[] = [
  { sdg: 1, title: 'No Poverty', dpmsRelevance: 'adjacent', weight: 0.03 },
  { sdg: 2, title: 'Zero Hunger', dpmsRelevance: 'low', weight: 0.01 },
  { sdg: 3, title: 'Good Health and Well-Being', dpmsRelevance: 'adjacent', weight: 0.03 },
  { sdg: 4, title: 'Quality Education', dpmsRelevance: 'low', weight: 0.02 },
  { sdg: 5, title: 'Gender Equality', dpmsRelevance: 'adjacent', weight: 0.03 },
  { sdg: 6, title: 'Clean Water and Sanitation', dpmsRelevance: 'adjacent', weight: 0.04 },
  { sdg: 7, title: 'Affordable and Clean Energy', dpmsRelevance: 'core', weight: 0.07 },
  { sdg: 8, title: 'Decent Work and Economic Growth', dpmsRelevance: 'core', weight: 0.1 },
  {
    sdg: 9,
    title: 'Industry, Innovation, Infrastructure',
    dpmsRelevance: 'adjacent',
    weight: 0.04,
  },
  { sdg: 10, title: 'Reduced Inequalities', dpmsRelevance: 'adjacent', weight: 0.04 },
  { sdg: 11, title: 'Sustainable Cities and Communities', dpmsRelevance: 'low', weight: 0.02 },
  { sdg: 12, title: 'Responsible Consumption and Production', dpmsRelevance: 'core', weight: 0.12 },
  { sdg: 13, title: 'Climate Action', dpmsRelevance: 'core', weight: 0.12 },
  { sdg: 14, title: 'Life Below Water', dpmsRelevance: 'adjacent', weight: 0.03 },
  { sdg: 15, title: 'Life on Land', dpmsRelevance: 'core', weight: 0.1 },
  { sdg: 16, title: 'Peace, Justice and Strong Institutions', dpmsRelevance: 'core', weight: 0.15 },
  { sdg: 17, title: 'Partnerships for the Goals', dpmsRelevance: 'adjacent', weight: 0.05 },
];

export interface SdgEvidenceInput {
  /** SDG 8 — fair wages, no child/forced labour, ILO compliance */
  decentWorkPoliciesInPlace: boolean;
  iloConventionsRatified: boolean;
  /** SDG 12 — responsible sourcing */
  oecd5StepComplianceLevel: 0 | 1 | 2 | 3 | 4 | 5;
  lbmaAccredited: boolean;
  recycledGoldPct: number; // 0–100
  /** SDG 13 — climate */
  netZeroTargetSet: boolean;
  carbonFootprintDisclosed: boolean;
  renewableEnergyPct: number; // 0–100
  /** SDG 15 — biodiversity / land */
  miningRehabilitationProgramme: boolean;
  noHighConservationValueSourcing: boolean;
  /** SDG 16 — AML/CFT/CPF, anti-corruption */
  amlProgrammeImplemented: boolean;
  sanctionsScreeningInPlace: boolean;
  antiCorruptionPolicyExists: boolean;
  strFilingCapabilityExists: boolean;
  transparencyReportPublished: boolean;
  /** SDG 5 — gender */
  genderEqualityPolicyExists: boolean;
  womenInLeadershipPct: number; // 0–100
  /** SDG 7 — clean energy */
  cleanEnergyCommitmentExists: boolean;
  /** SDG 6 — water */
  waterUsageMonitored: boolean;
  waterRecyclingInPlace: boolean;
  /** SDG 17 — partnerships */
  industryInitiativeMemberships: string[];
}

export interface SdgAlignmentScore {
  sdg: SdgNumber;
  title: string;
  weight: number;
  rawScore: number; // 0–100 before weighting
  weightedScore: number;
  alignment: SdgAlignment;
  impactDirection: SdgImpactDirection;
  evidence: string[];
  gaps: string[];
}

export interface UnSdgReport {
  entityId: string;
  reportingYear: number;
  generatedAt: string;
  overallScore: number; // 0–100 weighted composite
  coreGoalsScore: number; // average of core-relevance SDGs only
  sdgScores: SdgAlignmentScore[];
  topAlignedSdgs: SdgNumber[];
  criticalGapSdgs: SdgNumber[];
  lbmaAligned: boolean;
  oecd5StepLevel: number;
  narrativeSummary: string;
  actionPriorities: string[];
  regulatoryRefs: string[];
}

// ─── Scoring Helpers ──────────────────────────────────────────────────────────

function alignmentFromScore(score: number): SdgAlignment {
  if (score >= 80) return 'leading';
  if (score >= 60) return 'aligned';
  if (score >= 35) return 'partial';
  if (score >= 10) return 'neutral';
  return 'negative';
}

function computeSdgScores(ev: SdgEvidenceInput): SdgAlignmentScore[] {
  const scores: SdgAlignmentScore[] = [];

  const add = (
    sdg: SdgNumber,
    raw: number,
    impact: SdgImpactDirection,
    evidence: string[],
    gaps: string[]
  ) => {
    const meta = DPMS_SDG_WEIGHTS.find((s) => s.sdg === sdg)!;
    scores.push({
      sdg,
      title: meta.title,
      weight: meta.weight,
      rawScore: Math.min(100, Math.max(0, raw)),
      weightedScore: meta.weight * Math.min(100, Math.max(0, raw)),
      alignment: alignmentFromScore(raw),
      impactDirection: impact,
      evidence,
      gaps,
    });
  };

  // SDG 8 — Decent Work
  const sdg8 = (ev.decentWorkPoliciesInPlace ? 50 : 0) + (ev.iloConventionsRatified ? 50 : 0);
  add(
    8,
    sdg8,
    sdg8 >= 50 ? 'positive' : 'negative',
    [
      ...(ev.decentWorkPoliciesInPlace ? ['Decent work policies documented'] : []),
      ...(ev.iloConventionsRatified ? ['ILO conventions adopted'] : []),
    ],
    [
      ...(!ev.decentWorkPoliciesInPlace ? ['Adopt decent-work policy covering supply chain'] : []),
      ...(!ev.iloConventionsRatified
        ? ['Ratify ILO core conventions (29, 87, 98, 105, 138, 182)']
        : []),
    ]
  );

  // SDG 12 — Responsible Consumption
  const sdg12 =
    (ev.oecd5StepComplianceLevel / 5) * 60 +
    (ev.lbmaAccredited ? 20 : 0) +
    (ev.recycledGoldPct / 100) * 20;
  add(
    12,
    sdg12,
    sdg12 >= 60 ? 'positive' : sdg12 >= 30 ? 'neutral' : 'negative',
    [
      `OECD 5-step level ${ev.oecd5StepComplianceLevel}/5`,
      `Recycled gold: ${ev.recycledGoldPct}%`,
      ...(ev.lbmaAccredited ? ['LBMA accredited'] : []),
    ],
    [
      ...(ev.oecd5StepComplianceLevel < 3
        ? ['Advance OECD 5-step compliance to at least level 3']
        : []),
      ...(!ev.lbmaAccredited ? ['Pursue LBMA Responsible Gold accreditation'] : []),
      ...(ev.recycledGoldPct < 20 ? ['Increase recycled/secondary gold sourcing to ≥20%'] : []),
    ]
  );

  // SDG 13 — Climate Action
  const sdg13 =
    (ev.netZeroTargetSet ? 35 : 0) +
    (ev.carbonFootprintDisclosed ? 35 : 0) +
    (ev.renewableEnergyPct / 100) * 30;
  add(
    13,
    sdg13,
    sdg13 >= 50 ? 'positive' : sdg13 >= 20 ? 'neutral' : 'negative',
    [
      ...(ev.netZeroTargetSet ? ['Net Zero target set'] : []),
      ...(ev.carbonFootprintDisclosed ? ['Carbon footprint disclosed (IFRS S2)'] : []),
      `Renewable energy: ${ev.renewableEnergyPct}%`,
    ],
    [
      ...(!ev.netZeroTargetSet ? ['Set Net Zero target aligned to UAE NZ2050'] : []),
      ...(!ev.carbonFootprintDisclosed ? ['Disclose Scope 1, 2, 3 emissions per IFRS S2'] : []),
      ...(ev.renewableEnergyPct < 30
        ? ['Increase renewable energy to ≥30% of facility power']
        : []),
    ]
  );

  // SDG 15 — Life on Land
  const sdg15 =
    (ev.miningRehabilitationProgramme ? 50 : 0) + (ev.noHighConservationValueSourcing ? 50 : 0);
  add(
    15,
    sdg15,
    sdg15 >= 50 ? 'positive' : 'negative',
    [
      ...(ev.miningRehabilitationProgramme ? ['Mining rehabilitation programme in place'] : []),
      ...(ev.noHighConservationValueSourcing
        ? ['No high conservation value sourcing confirmed']
        : []),
    ],
    [
      ...(!ev.miningRehabilitationProgramme
        ? ['Require mining rehabilitation plans from suppliers']
        : []),
      ...(!ev.noHighConservationValueSourcing
        ? ['Screen for HCV/HCS sourcing per RSPO/WWF guidance']
        : []),
    ]
  );

  // SDG 16 — Peace, Justice, Strong Institutions (most DPMS-relevant)
  const sdg16 =
    (ev.amlProgrammeImplemented ? 25 : 0) +
    (ev.sanctionsScreeningInPlace ? 25 : 0) +
    (ev.antiCorruptionPolicyExists ? 20 : 0) +
    (ev.strFilingCapabilityExists ? 20 : 0) +
    (ev.transparencyReportPublished ? 10 : 0);
  add(
    16,
    sdg16,
    sdg16 >= 60 ? 'positive' : sdg16 >= 30 ? 'neutral' : 'negative',
    [
      ...(ev.amlProgrammeImplemented ? ['AML programme implemented (FDL 10/2025)'] : []),
      ...(ev.sanctionsScreeningInPlace
        ? ['Sanctions screening in place (Cabinet Res 74/2020)']
        : []),
      ...(ev.antiCorruptionPolicyExists ? ['Anti-corruption policy documented'] : []),
      ...(ev.strFilingCapabilityExists ? ['STR filing capability (FDL Art.26-27)'] : []),
    ],
    [
      ...(!ev.amlProgrammeImplemented
        ? ['Implement full AML/CFT programme per FDL No.10/2025']
        : []),
      ...(!ev.sanctionsScreeningInPlace
        ? ['Deploy real-time sanctions screening (all 6 lists)']
        : []),
      ...(!ev.transparencyReportPublished ? ['Publish annual AML/ESG transparency report'] : []),
    ]
  );

  // SDG 5 — Gender Equality
  const sdg5 = (ev.genderEqualityPolicyExists ? 50 : 0) + (ev.womenInLeadershipPct / 100) * 50;
  add(
    5,
    sdg5,
    sdg5 >= 40 ? 'positive' : 'neutral',
    [
      `Women in leadership: ${ev.womenInLeadershipPct}%`,
      ...(ev.genderEqualityPolicyExists ? ['Gender equality policy exists'] : []),
    ],
    [
      ...(!ev.genderEqualityPolicyExists
        ? ['Adopt gender equality and non-discrimination policy']
        : []),
      ...(ev.womenInLeadershipPct < 30
        ? ['Target ≥30% women in leadership roles (ILO Parity)']
        : []),
    ]
  );

  // SDG 7 — Clean Energy
  const sdg7 = (ev.cleanEnergyCommitmentExists ? 40 : 0) + (ev.renewableEnergyPct / 100) * 60;
  add(
    7,
    sdg7,
    sdg7 >= 40 ? 'positive' : 'neutral',
    [`Renewable energy: ${ev.renewableEnergyPct}%`],
    [
      ...(!ev.cleanEnergyCommitmentExists ? ['Commit to 100% renewable energy by 2030'] : []),
      ...(ev.renewableEnergyPct < 50 ? ['Increase renewable energy sourcing to ≥50%'] : []),
    ]
  );

  // SDG 6 — Clean Water
  const sdg6 = (ev.waterUsageMonitored ? 50 : 0) + (ev.waterRecyclingInPlace ? 50 : 0);
  add(
    6,
    sdg6,
    sdg6 >= 50 ? 'positive' : 'neutral',
    [
      ...(ev.waterUsageMonitored ? ['Water usage monitored and reported'] : []),
      ...(ev.waterRecyclingInPlace ? ['Water recycling/treatment in place'] : []),
    ],
    [
      ...(!ev.waterUsageMonitored ? ['Monitor and report water consumption per GRI 303'] : []),
      ...(!ev.waterRecyclingInPlace
        ? ['Implement water recycling programme for refinery/vault operations']
        : []),
    ]
  );

  // SDG 17 — Partnerships
  const sdg17 = Math.min(100, ev.industryInitiativeMemberships.length * 20);
  add(
    17,
    sdg17,
    sdg17 >= 40 ? 'positive' : 'neutral',
    ev.industryInitiativeMemberships.map((m) => `Member: ${m}`),
    sdg17 < 40 ? ['Join LBMA, RJC, or OECD DDJF for responsible sourcing partnerships'] : []
  );

  // Low-weight SDGs — assign neutral scores
  for (const meta of DPMS_SDG_WEIGHTS) {
    if (!scores.find((s) => s.sdg === meta.sdg)) {
      add(meta.sdg, 40, 'neutral', ['No specific DPMS evidence — sector relevance low'], []);
    }
  }

  return scores.sort((a, b) => a.sdg - b.sdg);
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function scoreUnSdgAlignment(
  entityId: string,
  reportingYear: number,
  evidence: SdgEvidenceInput
): UnSdgReport {
  const sdgScores = computeSdgScores(evidence);

  const overallScore = sdgScores.reduce((s, g) => s + g.weightedScore, 0);
  const coreGoals = sdgScores.filter(
    (s) => DPMS_SDG_WEIGHTS.find((w) => w.sdg === s.sdg)?.dpmsRelevance === 'core'
  );
  const coreGoalsScore =
    coreGoals.length > 0 ? coreGoals.reduce((s, g) => s + g.rawScore, 0) / coreGoals.length : 0;

  const topAlignedSdgs = sdgScores
    .filter((s) => s.rawScore >= 70)
    .sort((a, b) => b.rawScore - a.rawScore)
    .slice(0, 5)
    .map((s) => s.sdg);

  const criticalGapSdgs = sdgScores
    .filter((s) => s.rawScore < 30 && s.weight >= 0.07)
    .sort((a, b) => a.rawScore - b.rawScore)
    .map((s) => s.sdg);

  const actionPriorities = sdgScores
    .filter((s) => s.gaps.length > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6)
    .flatMap((s) => s.gaps.slice(0, 1));

  const narrativeSummary =
    `Entity ${entityId} achieves a weighted UN SDG alignment score of ${overallScore.toFixed(1)}/100 ` +
    `for ${reportingYear}. Core DPMS SDG score: ${coreGoalsScore.toFixed(1)}/100. ` +
    `Top aligned goals: SDG ${topAlignedSdgs.join(', ')}. ` +
    `Critical gaps: ${criticalGapSdgs.length > 0 ? 'SDG ' + criticalGapSdgs.join(', ') : 'none'}. ` +
    `OECD 5-step level: ${evidence.oecd5StepComplianceLevel}/5.`;

  return {
    entityId,
    reportingYear,
    generatedAt: new Date().toISOString(),
    overallScore,
    coreGoalsScore,
    sdgScores,
    topAlignedSdgs,
    criticalGapSdgs,
    lbmaAligned: evidence.lbmaAccredited && evidence.oecd5StepComplianceLevel >= 3,
    oecd5StepLevel: evidence.oecd5StepComplianceLevel,
    narrativeSummary,
    actionPriorities,
    regulatoryRefs: [
      'UN SDG Framework (2015) — Agenda 2030',
      'LBMA Responsible Gold Guidance v9',
      'OECD DDG 2016 — 5-Step Due Diligence Framework',
      'GRI Universal Standards 2021',
      'UAE Vision 2031 — Sustainable Development Targets',
      'DIFC Sustainable Finance Framework 2023',
      'IFC Performance Standards (2012)',
      'ILO Core Labour Conventions (29, 87, 98, 105, 138, 182)',
    ],
  };
}
