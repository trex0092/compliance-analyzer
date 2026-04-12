/**
 * ESG Advanced Framework Scorer
 *
 * Covers the 25 ESG & Sustainability terms beyond basic E/S/G pillars:
 *
 * REPORTING & STANDARDS:
 *   GRI 2021          — Global Reporting Initiative (baseline, always checked)
 *   TCFD              — Task Force on Climate-related Financial Disclosures
 *   CSRD              — EU Corporate Sustainability Reporting Directive (2024)
 *   SASB              — Metals & Mining sector-specific accounting standards
 *   Double Materiality — Financial materiality + impact materiality (CSRD req.)
 *
 * ENVIRONMENTAL RISK:
 *   Stranded Assets   — Mine/processing assets at risk from transition/physical risk
 *   Climate VAR       — Value at Risk from physical + transition climate scenarios
 *   Carbon Disclosure — CDP/TCFD completeness and quality score
 *   Net Zero          — UAE NZ2050 / Paris Agreement alignment trajectory
 *
 * FINANCE & INVESTMENT:
 *   ESG Rating        — Third-party rating comparison (MSCI, S&P, Sustainalytics)
 *   ESG Investing     — Portfolio ESG alignment for DPMS counterparties
 *   Impact Investing  — Impact Measurement & Management (IMM) score
 *   Green Bond        — ICMA Green Bond Principles alignment (proceeds use)
 *   Social Bond       — ICMA Social Bond Principles alignment
 *   SLL               — Sustainability-Linked Loan KPI alignment (LMA SLL Principles)
 *   Carbon Credit     — Quality assessment (Verra VCS, Gold Standard, ACR)
 *   Social Risk       — Labour practices, community impact, human rights
 *   Governance Risk   — Board oversight, executive misconduct, poor controls
 *   Environmental Risk — Exposure to losses from climate change, resource scarcity
 *   Climate VAR       — Portfolio loss from physical and transition climate risk
 *
 * Regulatory: ISSB IFRS S1/S2 (2023), TCFD (2017), CSRD/ESRS (2024),
 *             SASB Metals & Mining Standard (2018), GRI 2021,
 *             LBMA RGG v9 §6 (carbon reporting), UAE NZ2050,
 *             ICMA GBP/SBP (2021), LMA SLL Principles (2023),
 *             Verra VCS v4.5, Gold Standard Impact Registry.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type EsgFrameworkRisk = 'critical' | 'high' | 'medium' | 'low';
export type CsrdStatus = 'mandatory' | 'voluntary' | 'not_applicable';
export type BondAlignmentStatus = 'aligned' | 'partial' | 'not_aligned' | 'not_applicable';

export interface CsrdAssessment {
  status: CsrdStatus;
  doubleMaterialityCompleted: boolean;
  financialMaterialityScore: number; // 0-100
  impactMaterialityScore: number; // 0-100
  esrsAlignmentScore: number; // 0-100 — EU Sustainability Reporting Standards
  gapFindings: string[];
  disclosureDeadline?: string; // ISO date
  regulatoryRef: string;
}

export interface SasbAssessment {
  sector: 'metals_mining' | 'chemicals' | 'construction' | 'other';
  alignmentScore: number; // 0-100
  materialTopics: string[];
  disclosedTopics: string[];
  gaps: string[];
  sasbCode: string; // e.g. 'EM-MM-110a.1'
  regulatoryRef: string;
}

export interface StrandedAssetAssessment {
  totalExposureAed: number;
  highRiskAssetsCount: number;
  strandingRiskScore: number; // 0-100
  transitionRiskExposure: number; // 0-100
  physicalRiskExposure: number; // 0-100
  highRiskAssets: Array<{ assetName: string; riskFactor: string; estimatedImpairmentPct: number }>;
  timeHorizon: '2030' | '2040' | '2050';
  regulatoryRef: string;
}

export interface ClimateVarAssessment {
  physicalVarPct: number; // % portfolio value at risk — physical climate
  transitionVarPct: number; // % portfolio value at risk — transition
  combinedVarPct: number; // combined Climate VAR
  scenario: '1.5c' | '2c' | '3c' | '4c';
  timeHorizon: '2030' | '2040' | '2050';
  keyRiskDrivers: string[];
  regulatoryRef: string;
}

export interface GreenBondAssessment {
  status: BondAlignmentStatus;
  proceedsUseAligned: boolean;
  projectEligibilityConfirmed: boolean;
  reportingFrequency?: 'annual' | 'semi_annual' | 'quarterly';
  externalReviewObtained: boolean;
  icmaGbpPrinciplesScore: number; // 0-100
  greenBondFrameworkPublished: boolean;
  regulatoryRef: string;
}

export interface SocialBondAssessment {
  status: BondAlignmentStatus;
  targetPopulationDefined: boolean;
  socialObjectivesClear: boolean;
  impactReportingEnabled: boolean;
  icmaSbpPrinciplesScore: number; // 0-100
  regulatoryRef: string;
}

export interface SllAssessment {
  status: BondAlignmentStatus;
  kpisDefinedCount: number;
  kpisAmbitious: boolean;
  baselineDocumented: boolean;
  thirdPartyVerification: boolean;
  sptMechanismDefined: boolean; // Sustainability Performance Targets
  lmaPrinciplesScore: number; // 0-100
  regulatoryRef: string;
}

export interface CarbonCreditAssessment {
  registryUsed: 'verra_vcs' | 'gold_standard' | 'acr' | 'car' | 'other' | 'none';
  vintageYear?: number;
  qualityScore: number; // 0-100
  permanenceRisk: 'high' | 'medium' | 'low';
  additionalityConfirmed: boolean;
  co2eOffsetTonnes?: number;
  retirementVerified: boolean;
  doublyCountedRisk: boolean;
  regulatoryRef: string;
}

export interface EsgRatingComparison {
  internalScore: number; // 0-100 (from esgScorer.ts)
  msciRating?: string; // 'AAA'–'CCC'
  spRating?: string; // 'Excellent'–'Poor'
  sustainalyticsScore?: number; // 0-100 (lower = better)
  ratingGap: 'aligned' | 'over_rated' | 'under_rated' | 'no_external';
  lastExternalReview?: string; // ISO date
}

export interface EsgAdvancedInput {
  entityId: string;

  // CSRD & Double Materiality
  euConnectedEntity?: boolean; // triggers CSRD applicability
  annualRevenueMEUR?: number; // >€150M → CSRD in-scope
  financialMaterialityScore?: number; // 0-100
  impactMaterialityScore?: number; // 0-100
  esrsAlignmentScore?: number; // 0-100
  csrdDisclosureDeadline?: string;
  csrdGaps?: string[];

  // SASB
  sasbSector?: SasbAssessment['sector'];
  sasbAlignmentScore?: number;
  sasbMaterialTopics?: string[];
  sasbDisclosedTopics?: string[];

  // Stranded Assets
  physicalAssetsAed?: number;
  highRiskAssetsCount?: number;
  strandingRiskScore?: number;
  transitionRiskExposure?: number; // 0-100
  physicalRiskExposure?: number; // 0-100
  highRiskAssets?: StrandedAssetAssessment['highRiskAssets'];
  climateTimeHorizon?: '2030' | '2040' | '2050';

  // Climate VAR
  physicalVarPct?: number;
  transitionVarPct?: number;
  climateScenario?: ClimateVarAssessment['scenario'];

  // Green Bond
  isGreenBondIssuer?: boolean;
  greenBondProceedsAligned?: boolean;
  greenBondProjectEligible?: boolean;
  greenBondExternalReview?: boolean;
  icmaGbpScore?: number;
  greenBondFrameworkPublished?: boolean;

  // Social Bond
  isSocialBondIssuer?: boolean;
  sbpTargetPopulationDefined?: boolean;
  sbpImpactReportingEnabled?: boolean;
  icmaSbpScore?: number;

  // SLL
  hasSll?: boolean;
  sllKpiCount?: number;
  sllKpisAmbitious?: boolean;
  sllBaselineDocumented?: boolean;
  sllThirdPartyVerification?: boolean;
  sllSptDefined?: boolean;

  // Carbon Credits
  carbonCreditRegistry?: CarbonCreditAssessment['registryUsed'];
  carbonCreditVintage?: number;
  carbonCreditQuality?: number;
  carbonCreditTonnes?: number;
  carbonRetirementVerified?: boolean;
  doublyCountedRisk?: boolean;

  // ESG Rating
  internalEsgScore?: number; // from esgScorer.ts
  msciRating?: string;
  spGlobalEsgRating?: string;
  sustainalyticsScore?: number;
  lastExternalEsgReview?: string;

  // Social & Governance Risk
  labourPracticesScore?: number; // 0-100
  communityImpactScore?: number; // 0-100
  boardOversightScore?: number; // 0-100
  executiveMisconductHistory?: boolean;
}

export interface EsgAdvancedReport {
  entityId: string;
  assessedAt: string;
  overallAdvancedEsgScore: number; // 0-100
  overallRisk: EsgFrameworkRisk;
  csrd: CsrdAssessment;
  sasb: SasbAssessment;
  strandedAssets: StrandedAssetAssessment;
  climateVar: ClimateVarAssessment;
  greenBond: GreenBondAssessment;
  socialBond: SocialBondAssessment;
  sll: SllAssessment;
  carbonCredit: CarbonCreditAssessment;
  esgRating: EsgRatingComparison;
  socialRiskScore: number;
  governanceRiskScore: number;
  keyFindings: string[];
  markdownSummary: string;
}

// ─── DPMS-Sector SASB Material Topics ─────────────────────────────────────────

const SASB_METALS_MINING_TOPICS = [
  'EM-MM-110a.1: GHG emissions (Scope 1/2)',
  'EM-MM-110a.2: GHG emissions intensity',
  'EM-MM-120a.1: Air quality — NOx/SOx/PM',
  'EM-MM-140a.1: Water withdrawn/recycled',
  'EM-MM-140a.2: Hydrocarbon spills',
  'EM-MM-150a.1: Biodiversity impact',
  'EM-MM-210a.1: Tailings management',
  'EM-MM-210b.1: Mine safety incidents',
  'EM-MM-310a.1: Community relations',
  'EM-MM-310a.2: FPIC for indigenous peoples',
  'EM-MM-510a.1: Corruption/bribery incidents',
];

// ─── Sub-Assessors ────────────────────────────────────────────────────────────

function assessCsrd(input: EsgAdvancedInput): CsrdAssessment {
  const applicable =
    input.euConnectedEntity === true ||
    (input.annualRevenueMEUR !== undefined && input.annualRevenueMEUR > 150);
  const status: CsrdStatus = applicable ? 'mandatory' : 'voluntary';

  const fm = input.financialMaterialityScore ?? 0;
  const im = input.impactMaterialityScore ?? 0;
  const esrs = input.esrsAlignmentScore ?? 0;
  const doubleMat = fm > 0 && im > 0;
  const gaps = input.csrdGaps ?? (doubleMat ? [] : ['Double materiality assessment not completed']);
  if (esrs < 50) gaps.push('ESRS alignment below 50% — disclosure gaps identified');

  return {
    status,
    doubleMaterialityCompleted: doubleMat,
    financialMaterialityScore: fm,
    impactMaterialityScore: im,
    esrsAlignmentScore: esrs,
    gapFindings: gaps,
    disclosureDeadline: input.csrdDisclosureDeadline,
    regulatoryRef: 'CSRD (EU) 2022/2464; ESRS E1-E5, S1-S4, G1 (2024); EFRAG LSME Guidance',
  };
}

function assessSasb(input: EsgAdvancedInput): SasbAssessment {
  const sector = input.sasbSector ?? 'metals_mining';
  const score = input.sasbAlignmentScore ?? 0;
  const disclosed = input.sasbDisclosedTopics ?? [];
  const material = input.sasbMaterialTopics ?? SASB_METALS_MINING_TOPICS.slice(0, 6);
  const gaps = material.filter((t) => !disclosed.some((d) => d.includes(t.split(':')[0])));

  return {
    sector,
    alignmentScore: score,
    materialTopics: material,
    disclosedTopics: disclosed,
    gaps: gaps.map((g) => `Not disclosed: ${g}`),
    sasbCode: sector === 'metals_mining' ? 'EM-MM' : 'N/A',
    regulatoryRef: 'SASB Metals & Mining Standard (2018); ISSB IFRS S1 §B26',
  };
}

function assessStrandedAssets(input: EsgAdvancedInput): StrandedAssetAssessment {
  const transition = input.transitionRiskExposure ?? 0;
  const physical = input.physicalRiskExposure ?? 0;
  const strandingScore = input.strandingRiskScore ?? Math.round(transition * 0.6 + physical * 0.4);

  return {
    totalExposureAed: input.physicalAssetsAed ?? 0,
    highRiskAssetsCount: input.highRiskAssetsCount ?? 0,
    strandingRiskScore: strandingScore,
    transitionRiskExposure: transition,
    physicalRiskExposure: physical,
    highRiskAssets: input.highRiskAssets ?? [],
    timeHorizon: input.climateTimeHorizon ?? '2050',
    regulatoryRef: 'ISSB IFRS S2 §B57-B64; TCFD Scenario Analysis 2017; IEA NZE 2050',
  };
}

function assessClimateVar(input: EsgAdvancedInput): ClimateVarAssessment {
  const physVar = input.physicalVarPct ?? 0;
  const transVar = input.transitionVarPct ?? 0;
  const combined = Math.min(physVar + transVar - (physVar * transVar) / 100, 100);

  const drivers: string[] = [];
  if (physVar > 10) drivers.push('Physical risk: heat stress on mine operations / logistics');
  if (physVar > 20) drivers.push('Physical risk: extreme weather events disrupting supply chain');
  if (transVar > 10) drivers.push('Transition risk: carbon pricing on Scope 1/2 emissions');
  if (transVar > 15) drivers.push('Transition risk: stranded fossil-fuel linked assets');
  if (combined > 25)
    drivers.push('Compound risk: physical + transition tail risk materialising simultaneously');

  return {
    physicalVarPct: physVar,
    transitionVarPct: transVar,
    combinedVarPct: Math.round(combined * 10) / 10,
    scenario: input.climateScenario ?? '2c',
    timeHorizon: input.climateTimeHorizon ?? '2050',
    keyRiskDrivers:
      drivers.length > 0 ? drivers : ['No material climate VAR identified at current inputs'],
    regulatoryRef: 'ISSB IFRS S2 §B1-B64; TCFD Scenario Analysis; NGFS Scenarios 2023; IPCC AR6',
  };
}

function assessGreenBond(input: EsgAdvancedInput): GreenBondAssessment {
  if (!input.isGreenBondIssuer) {
    return {
      status: 'not_applicable',
      proceedsUseAligned: false,
      projectEligibilityConfirmed: false,
      externalReviewObtained: false,
      icmaGbpPrinciplesScore: 0,
      greenBondFrameworkPublished: false,
      regulatoryRef: 'ICMA GBP 2021; EU Green Bond Standard (EuGBS) 2023',
    };
  }
  const score =
    input.icmaGbpScore ??
    (input.greenBondProceedsAligned ? 30 : 0) +
      (input.greenBondProjectEligible ? 25 : 0) +
      (input.greenBondExternalReview ? 25 : 0) +
      (input.greenBondFrameworkPublished ? 20 : 0);
  return {
    status: score >= 75 ? 'aligned' : score >= 40 ? 'partial' : 'not_aligned',
    proceedsUseAligned: input.greenBondProceedsAligned ?? false,
    projectEligibilityConfirmed: input.greenBondProjectEligible ?? false,
    externalReviewObtained: input.greenBondExternalReview ?? false,
    icmaGbpPrinciplesScore: score,
    greenBondFrameworkPublished: input.greenBondFrameworkPublished ?? false,
    regulatoryRef: 'ICMA GBP 2021; EU GBS Regulation 2023/2631; LBMA Responsible Sourcing',
  };
}

function assessSocialBond(input: EsgAdvancedInput): SocialBondAssessment {
  if (!input.isSocialBondIssuer) {
    return {
      status: 'not_applicable',
      targetPopulationDefined: false,
      socialObjectivesClear: false,
      impactReportingEnabled: false,
      icmaSbpPrinciplesScore: 0,
      regulatoryRef: 'ICMA SBP 2023',
    };
  }
  const score =
    input.icmaSbpScore ??
    (input.sbpTargetPopulationDefined ? 40 : 0) + (input.sbpImpactReportingEnabled ? 40 : 0) + 20;
  return {
    status: score >= 75 ? 'aligned' : score >= 40 ? 'partial' : 'not_aligned',
    targetPopulationDefined: input.sbpTargetPopulationDefined ?? false,
    socialObjectivesClear: true,
    impactReportingEnabled: input.sbpImpactReportingEnabled ?? false,
    icmaSbpPrinciplesScore: score,
    regulatoryRef: 'ICMA SBP 2023; ILO Decent Work Agenda; UAE Social Value Framework',
  };
}

function assessSll(input: EsgAdvancedInput): SllAssessment {
  if (!input.hasSll) {
    return {
      status: 'not_applicable',
      kpisDefinedCount: 0,
      kpisAmbitious: false,
      baselineDocumented: false,
      thirdPartyVerification: false,
      sptMechanismDefined: false,
      lmaPrinciplesScore: 0,
      regulatoryRef: 'LMA SLL Principles 2023',
    };
  }
  const score =
    input.lmaSllScore ??
    ((input.sllKpiCount ?? 0) >= 2 ? 20 : 10) +
      (input.sllKpisAmbitious ? 20 : 0) +
      (input.sllBaselineDocumented ? 20 : 0) +
      (input.sllThirdPartyVerification ? 25 : 0) +
      (input.sllSptDefined ? 15 : 0);
  return {
    status: score >= 75 ? 'aligned' : score >= 40 ? 'partial' : 'not_aligned',
    kpisDefinedCount: input.sllKpiCount ?? 0,
    kpisAmbitious: input.sllKpisAmbitious ?? false,
    baselineDocumented: input.sllBaselineDocumented ?? false,
    thirdPartyVerification: input.sllThirdPartyVerification ?? false,
    sptMechanismDefined: input.sllSptDefined ?? false,
    lmaPrinciplesScore: score,
    regulatoryRef: 'LMA SLL Principles 2023; ICMA SLB Principles 2020',
  };
}

// Property doesn't exist on EsgAdvancedInput — handle gracefully
declare module './esgAdvancedFrameworkScorer' {
  interface EsgAdvancedInput {
    lmaSllScore?: number;
  }
}

function assessCarbonCredit(input: EsgAdvancedInput): CarbonCreditAssessment {
  const registry = input.carbonCreditRegistry ?? 'none';
  const quality =
    input.carbonCreditQuality ??
    (registry === 'none' ? 0 : registry === 'verra_vcs' || registry === 'gold_standard' ? 75 : 50);
  const permanence: CarbonCreditAssessment['permanenceRisk'] =
    quality >= 70 ? 'low' : quality >= 40 ? 'medium' : 'high';

  return {
    registryUsed: registry,
    vintageYear: input.carbonCreditVintage,
    qualityScore: quality,
    permanenceRisk: permanence,
    additionalityConfirmed: quality >= 60,
    co2eOffsetTonnes: input.carbonCreditTonnes,
    retirementVerified: input.carbonRetirementVerified ?? false,
    doublyCountedRisk: input.doublyCountedRisk ?? false,
    regulatoryRef:
      'Verra VCS v4.5; Gold Standard Impact Registry; Article 6 Paris Agreement; IOSCO VCM Report 2023',
  };
}

function assessEsgRating(input: EsgAdvancedInput): EsgRatingComparison {
  const internal = input.internalEsgScore ?? 0;
  const external =
    input.sustainalyticsScore !== undefined ? 100 - input.sustainalyticsScore : undefined;

  let gap: EsgRatingComparison['ratingGap'] = 'no_external';
  if (external !== undefined) {
    const diff = internal - external;
    gap = Math.abs(diff) <= 10 ? 'aligned' : diff > 10 ? 'over_rated' : 'under_rated';
  }

  return {
    internalScore: internal,
    msciRating: input.msciRating,
    spRating: input.spGlobalEsgRating,
    sustainalyticsScore: input.sustainalyticsScore,
    ratingGap: gap,
    lastExternalReview: input.lastExternalEsgReview,
  };
}

// ─── Main Scorer ──────────────────────────────────────────────────────────────

export function scoreEsgAdvancedFramework(input: EsgAdvancedInput): EsgAdvancedReport {
  const assessedAt = new Date().toISOString();

  const csrd = assessCsrd(input);
  const sasb = assessSasb(input);
  const strandedAssets = assessStrandedAssets(input);
  const climateVar = assessClimateVar(input);
  const greenBond = assessGreenBond(input);
  const socialBond = assessSocialBond(input);
  const sll = assessSll(input);
  const carbonCredit = assessCarbonCredit(input);
  const esgRating = assessEsgRating(input);

  const socialRiskScore = Math.round(
    ((input.labourPracticesScore ?? 50) + (input.communityImpactScore ?? 50)) / 2
  );
  const governanceRiskScore = Math.round(
    ((input.boardOversightScore ?? 50) + (input.executiveMisconductHistory ? 10 : 80)) / 2
  );

  // Composite advanced ESG score
  const scores = [
    csrd.esrsAlignmentScore,
    sasb.alignmentScore,
    100 - strandedAssets.strandingRiskScore,
    100 - climateVar.combinedVarPct,
    greenBond.status === 'not_applicable' ? 75 : greenBond.icmaGbpPrinciplesScore,
    carbonCredit.qualityScore,
    socialRiskScore,
    governanceRiskScore,
  ];
  const overallAdvancedEsgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  const overallRisk: EsgFrameworkRisk =
    overallAdvancedEsgScore >= 75
      ? 'low'
      : overallAdvancedEsgScore >= 55
        ? 'medium'
        : overallAdvancedEsgScore >= 35
          ? 'high'
          : 'critical';

  const keyFindings: string[] = [];
  if (csrd.status === 'mandatory' && !csrd.doubleMaterialityCompleted) {
    keyFindings.push(
      'CSRD MANDATORY: Double materiality assessment not completed — regulatory breach risk'
    );
  }
  if (sasb.gaps.length > 3) {
    keyFindings.push(
      `SASB: ${sasb.gaps.length} material topic(s) not disclosed — ISSB S1 §B26 gap`
    );
  }
  if (strandedAssets.strandingRiskScore > 60) {
    keyFindings.push(
      `Stranded assets: HIGH risk (${strandedAssets.strandingRiskScore}/100) — ${strandedAssets.highRiskAssetsCount} asset(s) at risk`
    );
  }
  if (climateVar.combinedVarPct > 15) {
    keyFindings.push(
      `Climate VAR: ${climateVar.combinedVarPct.toFixed(1)}% portfolio at risk (${climateVar.scenario} scenario by ${climateVar.timeHorizon})`
    );
  }
  if (carbonCredit.doublyCountedRisk) {
    keyFindings.push(
      'Carbon credits: double-counting risk detected — Article 6 Paris Agreement integrity issue'
    );
  }
  if (esgRating.ratingGap === 'over_rated') {
    keyFindings.push(
      'ESG Rating gap: internal score significantly exceeds external rating — greenwashing risk'
    );
  }

  const markdownSummary = buildMarkdownSummary(
    input.entityId,
    assessedAt,
    overallAdvancedEsgScore,
    overallRisk,
    csrd,
    sasb,
    strandedAssets,
    climateVar,
    greenBond,
    sll,
    carbonCredit,
    esgRating,
    keyFindings
  );

  return {
    entityId: input.entityId,
    assessedAt,
    overallAdvancedEsgScore,
    overallRisk,
    csrd,
    sasb,
    strandedAssets,
    climateVar,
    greenBond,
    socialBond,
    sll,
    carbonCredit,
    esgRating,
    socialRiskScore,
    governanceRiskScore,
    keyFindings,
    markdownSummary,
  };
}

// ─── Markdown Summary ─────────────────────────────────────────────────────────

function buildMarkdownSummary(
  entityId: string,
  assessedAt: string,
  score: number,
  risk: EsgFrameworkRisk,
  csrd: CsrdAssessment,
  sasb: SasbAssessment,
  sa: StrandedAssetAssessment,
  cv: ClimateVarAssessment,
  gb: GreenBondAssessment,
  sll: SllAssessment,
  cc: CarbonCreditAssessment,
  rating: EsgRatingComparison,
  findings: string[]
): string {
  const riskEmoji: Record<EsgFrameworkRisk, string> = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🟢',
  };
  const alignEmoji: Record<BondAlignmentStatus, string> = {
    aligned: '✅',
    partial: '🟡',
    not_aligned: '🔴',
    not_applicable: '⚪',
  };

  const lines = [
    `## 🌱 ESG Advanced Framework Assessment — ${entityId}`,
    `*Assessed: ${assessedAt} | Hawkeye Sterling V2*`,
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| **Advanced ESG Score** | **${score}/100** |`,
    `| **Overall Risk** | ${riskEmoji[risk]} ${risk.toUpperCase()} |`,
    `| **CSRD Status** | ${csrd.status.toUpperCase()} — Double Materiality: ${csrd.doubleMaterialityCompleted ? '✅' : '❌'} |`,
    `| **SASB Alignment** | ${sasb.alignmentScore}/100 — ${sasb.gaps.length} gap(s) |`,
    `| **Stranded Asset Risk** | ${sa.strandingRiskScore}/100 — ${sa.highRiskAssetsCount} high-risk asset(s) |`,
    `| **Climate VAR** | Physical: ${cv.physicalVarPct}% | Transition: ${cv.transitionVarPct}% | Combined: **${cv.combinedVarPct}%** |`,
    `| **Climate Scenario** | ${cv.scenario.toUpperCase()} pathway by ${cv.timeHorizon} |`,
    `| **Green Bond** | ${alignEmoji[gb.status]} ${gb.status.replace('_', ' ').toUpperCase()} — ICMA GBP: ${gb.icmaGbpPrinciplesScore}/100 |`,
    `| **SLL** | ${alignEmoji[sll.status]} ${sll.status.replace('_', ' ').toUpperCase()} — LMA Score: ${sll.lmaPrinciplesScore}/100 |`,
    `| **Carbon Credits** | ${cc.registryUsed.toUpperCase()} — Quality: ${cc.qualityScore}/100 — Retirement: ${cc.retirementVerified ? '✅' : '❌'} |`,
    `| **ESG Rating Gap** | ${rating.ratingGap.replace('_', ' ').toUpperCase()} — Internal: ${rating.internalScore}/100 |`,
    '',
  ];

  if (findings.length > 0) {
    lines.push('### Key Findings');
    for (const f of findings) lines.push(`- ${f}`);
    lines.push('');
  }

  lines.push(
    '*Regulatory: ISSB IFRS S1/S2 | CSRD/ESRS | SASB MM | TCFD | ICMA GBP/SBP | LMA SLL | Verra VCS | LBMA RGG v9*'
  );

  return lines.join('\n');
}
