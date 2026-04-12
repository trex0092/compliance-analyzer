/**
 * TCFD Alignment Checker
 *
 * Scores an entity's climate-related financial disclosures against the
 * four TCFD pillars: Governance, Strategy, Risk Management, Metrics & Targets.
 * Also maps to ISSB IFRS S1/S2 (2023) and UAE Net Zero 2050 requirements.
 *
 * Regulatory: TCFD Recommendations (2017) + 2021 Guidance,
 *             ISSB IFRS S1 (General Requirements) 2023,
 *             ISSB IFRS S2 (Climate-related Disclosures) 2023,
 *             UAE Net Zero 2050 National Strategy,
 *             DIFC Sustainable Finance Framework 2023.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type TcfdPillar = 'governance' | 'strategy' | 'risk_management' | 'metrics_targets';
export type TcfdMaturity = 'not_started' | 'partial' | 'progressing' | 'advanced' | 'leading';
export type TcfdComplianceLevel = 'non_compliant' | 'partial' | 'compliant' | 'exemplary';

export interface TcfdGovernanceInput {
  boardOversightDocumented: boolean;
  climateInBoardMandate: boolean;
  executiveIncentivesLinkedToClimate: boolean;
  climateRiskCommitteeExists: boolean;
  annualBoardClimateReview: boolean;
}

export interface TcfdStrategyInput {
  physicalRisksIdentified: boolean;
  transitionRisksIdentified: boolean;
  climateOpportunitiesIdentified: boolean;
  scenarioAnalysisPerformed: boolean;
  timeHorizonsUsed: ('short' | 'medium' | 'long')[];
  businessStrategyClimateIntegrated: boolean;
  financialPlanningClimateIntegrated: boolean;
}

export interface TcfdRiskMgmtInput {
  climateRisksInERM: boolean;
  climateRiskProcessDocumented: boolean;
  physicalRiskAssessmentDone: boolean;
  transitionRiskAssessmentDone: boolean;
  climateRisksMaterialityAssessed: boolean;
  supplierClimateRiskAssessed: boolean;
}

export interface TcfdMetricsInput {
  scope1Disclosed: boolean;
  scope2Disclosed: boolean;
  scope3Disclosed: boolean;
  climateTargetSet: boolean;
  netZeroTargetAligned: boolean;
  progressTrackingInPlace: boolean;
  internalCarbonPriceUsed: boolean;
  climateVarDisclosed: boolean;   // climate-related financial value at risk
}

export interface TcfdAlignmentInput {
  entityId: string;
  reportingYear: number;
  governance: TcfdGovernanceInput;
  strategy: TcfdStrategyInput;
  riskManagement: TcfdRiskMgmtInput;
  metrics: TcfdMetricsInput;
}

export interface TcfdPillarScore {
  pillar: TcfdPillar;
  score: number;             // 0–100
  maxScore: number;
  pct: number;               // score / maxScore * 100
  maturity: TcfdMaturity;
  gaps: string[];
  recommendations: string[];
}

export interface TcfdAlignmentReport {
  entityId: string;
  reportingYear: number;
  generatedAt: string;
  overallScore: number;       // 0–100 weighted average
  complianceLevel: TcfdComplianceLevel;
  pillarScores: TcfdPillarScore[];
  ifrss1Compliant: boolean;
  ifrss2Compliant: boolean;
  uaeNZ2050Aligned: boolean;
  priorityGaps: string[];
  actionPlan: string[];
  narrativeSummary: string;
  regulatoryRefs: string[];
}

// ─── Scoring Logic ────────────────────────────────────────────────────────────

function scoreGovernance(g: TcfdGovernanceInput): TcfdPillarScore {
  const checks: [boolean, number, string, string][] = [
    [g.boardOversightDocumented,            20, 'Board oversight not documented',               'Document board-level climate oversight in governance charter'],
    [g.climateInBoardMandate,               20, 'Climate not in board mandate',                 'Amend board mandate to include climate-related responsibilities'],
    [g.executiveIncentivesLinkedToClimate,  15, 'No climate-linked executive incentives',       'Link executive remuneration to climate KPIs'],
    [g.climateRiskCommitteeExists,          25, 'No dedicated climate risk committee',          'Establish a climate / sustainability committee reporting to board'],
    [g.annualBoardClimateReview,            20, 'No annual board climate review cycle',         'Mandate annual board review of climate strategy and targets'],
  ];

  return buildPillarScore('governance', checks);
}

function scoreStrategy(s: TcfdStrategyInput): TcfdPillarScore {
  const checks: [boolean, number, string, string][] = [
    [s.physicalRisksIdentified,             15, 'Physical climate risks not identified',         'Complete physical risk assessment (heat, flood, water stress)'],
    [s.transitionRisksIdentified,           15, 'Transition risks not identified',              'Map policy, technology and market transition risks'],
    [s.climateOpportunitiesIdentified,      10, 'Climate opportunities not mapped',             'Identify revenue/cost opportunities from low-carbon transition'],
    [s.scenarioAnalysisPerformed,           20, 'No scenario analysis performed',              'Run <2°C and 4°C scenarios per TCFD supplemental guidance'],
    [s.timeHorizonsUsed.includes('short'),   5, 'Short-term horizon missing from scenarios',   'Define short-term (<3yr) horizon for transition risk analysis'],
    [s.timeHorizonsUsed.includes('long'),   10, 'Long-term horizon missing from scenarios',    'Define long-term (>10yr) horizon for physical risk analysis'],
    [s.businessStrategyClimateIntegrated,   15, 'Climate not integrated into business strategy','Embed climate risks/opps into strategic planning process'],
    [s.financialPlanningClimateIntegrated,  10, 'Climate not in financial planning',           'Reflect climate scenarios in capex and revenue projections'],
  ];

  return buildPillarScore('strategy', checks);
}

function scoreRiskMgmt(r: TcfdRiskMgmtInput): TcfdPillarScore {
  const checks: [boolean, number, string, string][] = [
    [r.climateRisksInERM,                   25, 'Climate risks not in ERM',                     'Integrate climate risks into enterprise risk register'],
    [r.climateRiskProcessDocumented,        20, 'Climate risk process not documented',           'Document identification, assessment and mitigation processes'],
    [r.physicalRiskAssessmentDone,          15, 'Physical risk assessment not completed',       'Assess asset exposure to flood, heat, water, and storm risk'],
    [r.transitionRiskAssessmentDone,        15, 'Transition risk assessment not completed',     'Quantify stranded-asset and carbon-cost exposures'],
    [r.climateRisksMaterialityAssessed,     15, 'Materiality of climate risks not assessed',    'Determine financial materiality thresholds for climate risks'],
    [r.supplierClimateRiskAssessed,         10, 'Supplier climate risk not assessed',           'Include gold-supplier Scope 3 risk in supplier due-diligence'],
  ];

  return buildPillarScore('risk_management', checks);
}

function scoreMetrics(m: TcfdMetricsInput): TcfdPillarScore {
  const checks: [boolean, number, string, string][] = [
    [m.scope1Disclosed,            15, 'Scope 1 emissions not disclosed',         'Disclose direct Scope 1 emissions with boundary and methodology'],
    [m.scope2Disclosed,            15, 'Scope 2 emissions not disclosed',         'Disclose location-based and market-based Scope 2 emissions'],
    [m.scope3Disclosed,            15, 'Scope 3 emissions not disclosed',         'Disclose material Scope 3 categories (gold supply chain = Cat 1)'],
    [m.climateTargetSet,           15, 'No climate reduction target set',          'Set SBTi-aligned absolute emissions reduction target'],
    [m.netZeroTargetAligned,       15, 'Not aligned to Net Zero target',           'Align to UAE Net Zero 2050 with interim 2030/2035 milestones'],
    [m.progressTrackingInPlace,    10, 'No progress tracking in place',           'Implement annual carbon accounting and target-tracking system'],
    [m.internalCarbonPriceUsed,     7, 'No internal carbon price applied',        'Apply internal carbon price (≥USD 50/tCO2e recommended)'],
    [m.climateVarDisclosed,         8, 'Climate VaR not disclosed',               'Quantify and disclose climate-related financial value at risk'],
  ];

  return buildPillarScore('metrics_targets', checks);
}

function buildPillarScore(
  pillar: TcfdPillar,
  checks: [boolean, number, string, string][],
): TcfdPillarScore {
  let score = 0;
  const maxScore = checks.reduce((s, [, w]) => s + w, 0);
  const gaps: string[] = [];
  const recommendations: string[] = [];

  for (const [passed, weight, gap, rec] of checks) {
    if (passed) {
      score += weight;
    } else {
      gaps.push(gap);
      recommendations.push(rec);
    }
  }

  const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;
  const maturity = deriveMaturity(pct);

  return { pillar, score, maxScore, pct, maturity, gaps, recommendations };
}

function deriveMaturity(pct: number): TcfdMaturity {
  if (pct < 20) return 'not_started';
  if (pct < 40) return 'partial';
  if (pct < 65) return 'progressing';
  if (pct < 85) return 'advanced';
  return 'leading';
}

function deriveComplianceLevel(overallScore: number): TcfdComplianceLevel {
  if (overallScore < 30) return 'non_compliant';
  if (overallScore < 60) return 'partial';
  if (overallScore < 85) return 'compliant';
  return 'exemplary';
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function checkTcfdAlignment(input: TcfdAlignmentInput): TcfdAlignmentReport {
  const pillarScores = [
    scoreGovernance(input.governance),
    scoreStrategy(input.strategy),
    scoreRiskMgmt(input.riskManagement),
    scoreMetrics(input.metrics),
  ];

  // Equal-weight average across 4 pillars
  const overallScore = pillarScores.reduce((s, p) => s + p.pct, 0) / pillarScores.length;
  const complianceLevel = deriveComplianceLevel(overallScore);

  // IFRS S1/S2 compliance requires all pillars ≥50%
  const ifrss1Compliant = pillarScores.every(p => p.pct >= 50);
  const ifrss2Compliant = ifrss1Compliant && input.metrics.scope1Disclosed && input.metrics.scope2Disclosed;
  const uaeNZ2050Aligned = input.metrics.netZeroTargetAligned && input.metrics.climateTargetSet;

  // Priority gaps: from the lowest-scoring pillar
  const sortedByScore = [...pillarScores].sort((a, b) => a.pct - b.pct);
  const priorityGaps = sortedByScore[0].gaps.slice(0, 3);

  // Top-3 cross-pillar action items
  const actionPlan = pillarScores
    .flatMap(p => p.recommendations)
    .slice(0, 6);

  const narrativeSummary =
    `Entity ${input.entityId} achieves a TCFD alignment score of ${overallScore.toFixed(1)}/100 ` +
    `(${complianceLevel.replace('_', ' ')}) for reporting year ${input.reportingYear}. ` +
    `Pillar scores — Governance: ${pillarScores[0].pct.toFixed(0)}%, ` +
    `Strategy: ${pillarScores[1].pct.toFixed(0)}%, ` +
    `Risk Mgmt: ${pillarScores[2].pct.toFixed(0)}%, ` +
    `Metrics: ${pillarScores[3].pct.toFixed(0)}%. ` +
    `IFRS S2 compliant: ${ifrss2Compliant}. UAE NZ2050 aligned: ${uaeNZ2050Aligned}.`;

  return {
    entityId: input.entityId,
    reportingYear: input.reportingYear,
    generatedAt: new Date().toISOString(),
    overallScore,
    complianceLevel,
    pillarScores,
    ifrss1Compliant,
    ifrss2Compliant,
    uaeNZ2050Aligned,
    priorityGaps,
    actionPlan,
    narrativeSummary,
    regulatoryRefs: [
      'TCFD Recommendations (2017) + 2021 Guidance',
      'ISSB IFRS S1 — General Requirements for Disclosure (2023)',
      'ISSB IFRS S2 — Climate-related Disclosures (2023)',
      'UAE Net Zero 2050 National Strategy',
      'DIFC Sustainable Finance Framework 2023',
      'GRI 305 — Emissions (2022)',
      'SBTi Corporate Net-Zero Standard v1.1',
    ],
  };
}
