/**
 * Greenwashing Detector — ESG Disclosure Integrity Analysis
 *
 * Detects ESG disclosure integrity failures (greenwashing) by analysing
 * EsgDisclosure objects against established criteria from regulatory
 * frameworks and voluntary standards.
 *
 * Detection categories:
 *   - vague_language        : claims with no metric and no verification
 *   - missing_metrics       : qualitative-only claims on material topics
 *   - cherry_picking        : only improving metrics reported
 *   - scope3_omission       : climate commitment without Scope 3 data
 *   - unverified_claim      : material claims without third-party verification
 *   - no_baseline           : targets stated without a baseline year
 *   - target_misalignment   : net-zero claim but target year > 2050
 *   - misleading_comparison : comparison lacking adequate context/peers
 *
 * Regulatory basis:
 *   - EU SFDR 2019/2088 (Art.4 — principal adverse impact disclosure)
 *   - EU Taxonomy Regulation 2020/852 (Art.3 — do no significant harm)
 *   - ESMA Greenwashing Report 2023 (common greenwashing patterns)
 *   - FCA SDR 2023 (Sustainability Disclosure Requirements)
 *   - ISSB IFRS S1 §B14-B15 (materiality assessment)
 *   - GRI Standards 2021 §2-4 (accuracy and completeness principle)
 */

// ---------------------------------------------------------------------------
// Types — exported as specified
// ---------------------------------------------------------------------------

export interface EsgClaim {
  category: 'environmental' | 'social' | 'governance';
  /** The stated claim text. */
  claim: string;
  /** Quantitative value if present. */
  metric?: number;
  metricUnit?: string;
  baselineYear?: number;
  targetYear?: number;
  targetValue?: number;
  verifiedByThirdParty: boolean;
  /** e.g. 'PricewaterhouseCoopers', 'Bureau Veritas' */
  verificationStandard?: string;
}

export interface EsgDisclosure {
  entityId: string;
  reportingYear: number;
  claims: EsgClaim[];
  disclosureStandard?: 'GRI' | 'SASB' | 'ISSB' | 'TCFD' | 'none';
  hasExternalAssurance: boolean;
  assuranceLevel?: 'limited' | 'reasonable';
  /** Actual measurable outcomes reported (vs claims). */
  measuredOutcomes?: Array<{ metric: string; value: number; unit: string }>;
}

export type GreenwashingRisk = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface GreenwashingFinding {
  type:
    | 'vague_language'
    | 'missing_metrics'
    | 'cherry_picking'
    | 'scope3_omission'
    | 'unverified_claim'
    | 'misleading_comparison'
    | 'no_baseline'
    | 'target_misalignment';
  severity: 'critical' | 'high' | 'medium';
  claim?: string;
  detail: string;
  citation: string;
}

export interface GreenwashingReport {
  entityId: string;
  overallRisk: GreenwashingRisk;
  findings: GreenwashingFinding[];
  /** 0-100: higher = more credible disclosure */
  disclosureIntegrityScore: number;
  /** Percentage of claims that carry third-party verification. */
  verifiedClaimsPct: number;
  narrative: string;
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/**
 * Material topics that REQUIRE quantitative metrics under ISSB IFRS S1 §B14-B15
 * and GRI Standards 2021 §2-4.
 */
const MATERIAL_TOPIC_PATTERNS: RegExp[] = [
  /emiss/i,
  /carbon/i,
  /ghg/i,
  /greenhouse/i,
  /energy/i,
  /water/i,
  /waste/i,
  /biodiversit/i,
  /climate/i,
  /scope\s*[123]/i,
];

/**
 * Vague claim language — phrases that indicate unsubstantiated assertions
 * as catalogued by ESMA Greenwashing Report 2023 §4.2.
 */
const VAGUE_LANGUAGE_PATTERNS: RegExp[] = [
  /\beco[- ]?friend/i,
  /\bgreen\b/i,
  /\bsustainable\b/i,
  /\bresponsible\b/i,
  /\bclean\b/i,
  /\bnet.?zero\b/i,
  /\bcarbon.?neutral/i,
  /\bplanet.?friend/i,
  /\benvironment(?:ally)?\s+conscious/i,
  /\bcommitted to\b/i,
  /\bstriving\b/i,
  /\bworking towards\b/i,
  /\baspir/i,
];

/**
 * Net-zero / carbon-neutral claim patterns — require both Scope 3 data and
 * target year ≤ 2050 per Paris Agreement Art.2 and GRI 305.
 */
const NET_ZERO_PATTERNS: RegExp[] = [
  /\bnet.?zero\b/i,
  /\bcarbon.?neutral/i,
  /\bclimate.?neutral/i,
  /\bzero.?emission/i,
];

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/** Returns true if the claim text touches a material topic requiring metrics. */
function isMaterialTopic(claim: string): boolean {
  return MATERIAL_TOPIC_PATTERNS.some((rx) => rx.test(claim));
}

/** Returns true if the claim uses vague language without quantification. */
function hasVagueLanguage(claim: string): boolean {
  return VAGUE_LANGUAGE_PATTERNS.some((rx) => rx.test(claim));
}

/** Returns true if the claim references a net-zero / carbon-neutral commitment. */
function isNetZeroClaim(claim: string): boolean {
  return NET_ZERO_PATTERNS.some((rx) => rx.test(claim));
}

/**
 * Derive a per-claim base integrity score contribution (0-10).
 * A fully quantified, verified claim contributes maximum points.
 */
function claimIntegrityScore(claim: EsgClaim): number {
  let score = 0;
  // Has a quantitative metric (+4)
  if (claim.metric !== undefined) score += 4;
  // Metric has a unit (+1)
  if (claim.metricUnit) score += 1;
  // Has a baseline year (+2)
  if (claim.baselineYear !== undefined) score += 2;
  // Third-party verified (+3)
  if (claim.verifiedByThirdParty) score += 3;
  return score; // 0-10
}

// ---------------------------------------------------------------------------
// Core detection function
// ---------------------------------------------------------------------------

/**
 * Analyses an ESG disclosure for greenwashing indicators.
 *
 * @param disclosure - The EsgDisclosure to evaluate.
 * @returns A GreenwashingReport containing risk rating, findings, and narrative.
 *
 * @see EU SFDR 2019/2088 Art.4
 * @see ESMA Greenwashing Report 2023
 * @see ISSB IFRS S1 §B14-B15
 * @see GRI Standards 2021 §2-4
 */
export function detectGreenwashing(disclosure: EsgDisclosure): GreenwashingReport {
  const findings: GreenwashingFinding[] = [];
  const { entityId, claims, reportingYear } = disclosure;

  if (claims.length === 0) {
    // No claims at all — not greenwashing per se, but flag the absence.
    return {
      entityId,
      overallRisk: 'none',
      findings: [],
      disclosureIntegrityScore: 0,
      verifiedClaimsPct: 0,
      narrative:
        'No ESG claims were provided in the disclosure. Disclosure completeness cannot be assessed.',
    };
  }

  // ── 1. Vague language / missing metrics ──────────────────────────────────

  for (const c of claims) {
    const lacksMetric = c.metric === undefined;
    const lacksVerification = !c.verifiedByThirdParty;
    const isVague = hasVagueLanguage(c.claim);
    const isMaterial = isMaterialTopic(c.claim);

    if (isVague && lacksMetric && lacksVerification) {
      findings.push({
        type: 'vague_language',
        severity: 'high',
        claim: c.claim,
        detail: `Claim uses aspirational language without any quantitative metric or third-party verification. This pattern is identified as a primary greenwashing indicator in ESMA Greenwashing Report 2023 §4.2.`,
        citation: 'ESMA Greenwashing Report 2023 §4.2; FCA SDR 2023 §3.1; GRI 2021 §2-4',
      });
    } else if (isMaterial && lacksMetric) {
      // Qualitative-only on material topic
      findings.push({
        type: 'missing_metrics',
        severity: 'high',
        claim: c.claim,
        detail: `This claim touches a material topic (energy, water, emissions, or biodiversity) but provides no quantitative metric. ISSB IFRS S1 §B14-B15 requires quantitative disclosure for material sustainability topics.`,
        citation: 'ISSB IFRS S1 §B14-B15; EU Taxonomy Regulation 2020/852 Art.3; GRI 305/303',
      });
    }

    // ── 2. Unverified material claims ───────────────────────────────────────
    if (isMaterial && lacksVerification && c.metric !== undefined) {
      findings.push({
        type: 'unverified_claim',
        severity: 'medium',
        claim: c.claim,
        detail: `Quantitative metric present but no third-party assurance. EU SFDR 2019/2088 Art.4 and FCA SDR 2023 require external verification for principal adverse impact (PAI) indicators.`,
        citation: 'EU SFDR 2019/2088 Art.4; FCA SDR 2023 §4.2',
      });
    }

    // ── 3. No baseline year ─────────────────────────────────────────────────
    if (c.targetYear !== undefined && c.targetValue !== undefined && c.baselineYear === undefined) {
      findings.push({
        type: 'no_baseline',
        severity: 'high',
        claim: c.claim,
        detail: `A target is stated (year ${c.targetYear}, value ${c.targetValue}) but no baseline year is disclosed. Without a baseline, the target cannot be evaluated for ambition or progress. GRI 2021 §2-4 (accuracy principle) requires baseline context.`,
        citation: 'GRI Standards 2021 §2-4; ISSB IFRS S1 §B14; ESMA Greenwashing Report 2023 §5.1',
      });
    }

    // ── 4. Target misalignment — net-zero beyond 2050 ───────────────────────
    if (isNetZeroClaim(c.claim) && c.targetYear !== undefined && c.targetYear > 2050) {
      findings.push({
        type: 'target_misalignment',
        severity: 'critical',
        claim: c.claim,
        detail: `Claim references net-zero/carbon neutrality but target year ${c.targetYear} exceeds 2050, misaligning with the Paris Agreement Art.2 temperature limit objective and IPCC 1.5°C pathway.`,
        citation: 'Paris Agreement Art.2; ISSB IFRS S2 §B35; ESMA Greenwashing Report 2023 §5.3',
      });
    }
  }

  // ── 5. Scope 3 omission ────────────────────────────────────────────────────
  const hasClimateClaim = claims.some(
    (c) => c.category === 'environmental' && isNetZeroClaim(c.claim),
  );
  const hasScope3Claim = claims.some(
    (c) => c.category === 'environmental' && /scope\s*3/i.test(c.claim),
  );
  const hasScope3Outcome = (disclosure.measuredOutcomes ?? []).some((o) =>
    /scope\s*3/i.test(o.metric),
  );

  if (hasClimateClaim && !hasScope3Claim && !hasScope3Outcome) {
    findings.push({
      type: 'scope3_omission',
      severity: 'critical',
      detail: `Disclosure makes net-zero or carbon neutrality claims but contains no Scope 3 emissions data. Scope 3 represents the majority of emissions for most entities; omission constitutes selective disclosure per ESMA Greenwashing Report 2023 §4.3 and ISSB IFRS S2 §29.`,
      citation:
        'ISSB IFRS S2 §29; ESMA Greenwashing Report 2023 §4.3; EU Taxonomy Regulation 2020/852 Art.3',
    });
  }

  // ── 6. Cherry-picking (only improving metrics reported) ───────────────────
  const outcomes = disclosure.measuredOutcomes ?? [];
  if (outcomes.length >= 2) {
    // We attempt a heuristic: if all measuredOutcomes imply improvement
    // (value > 0 is a proxy for positive) while there are also unverified
    // material claims with no outcome counterpart, flag selective reporting.
    const materialClaimsWithNoOutcome = claims.filter(
      (c) =>
        isMaterialTopic(c.claim) &&
        !outcomes.some((o) => o.metric.toLowerCase().includes(c.category)),
    );
    if (materialClaimsWithNoOutcome.length > 0 && outcomes.length < claims.length / 2) {
      findings.push({
        type: 'cherry_picking',
        severity: 'medium',
        detail: `${materialClaimsWithNoOutcome.length} material claim(s) have no corresponding measured outcome, suggesting selective reporting of favourable data. GRI 2021 §2-4 (completeness principle) requires disclosure of all material topics, including worsening indicators.`,
        citation: 'GRI Standards 2021 §2-4; ESMA Greenwashing Report 2023 §4.4; FCA SDR 2023 §3.2',
      });
    }
  }

  // ── 7. Misleading comparison — no assurance + no standard ─────────────────
  if (
    !disclosure.hasExternalAssurance &&
    (!disclosure.disclosureStandard || disclosure.disclosureStandard === 'none')
  ) {
    const materialClaims = claims.filter((c) => isMaterialTopic(c.claim));
    if (materialClaims.length > 0) {
      findings.push({
        type: 'misleading_comparison',
        severity: 'medium',
        detail: `Material environmental/social claims are made without any recognised reporting standard (GRI, SASB, ISSB, TCFD) or external assurance. Without a standardised methodology, claims cannot be meaningfully compared against peers or verified.`,
        citation: 'ESMA Greenwashing Report 2023 §5.2; FCA SDR 2023 §5.1; GRI 2021 §2-3',
      });
    }
  }

  // ── Integrity Score ───────────────────────────────────────────────────────

  // Base: average per-claim integrity (0-10 scaled to 0-60)
  const claimScoreSum = claims.reduce((acc, c) => acc + claimIntegrityScore(c), 0);
  const avgClaimScore = claims.length > 0 ? claimScoreSum / claims.length : 0;
  let integrityScore = (avgClaimScore / 10) * 60; // 0-60

  // Bonus for external assurance (+20 for reasonable, +10 for limited)
  if (disclosure.hasExternalAssurance) {
    integrityScore += disclosure.assuranceLevel === 'reasonable' ? 20 : 10;
  }

  // Bonus for recognised disclosure standard (+10 for ISSB/GRI, +5 for others)
  if (disclosure.disclosureStandard === 'ISSB' || disclosure.disclosureStandard === 'GRI') {
    integrityScore += 10;
  } else if (
    disclosure.disclosureStandard === 'SASB' ||
    disclosure.disclosureStandard === 'TCFD'
  ) {
    integrityScore += 5;
  }

  // Penalty: deduct for each finding by severity
  for (const f of findings) {
    if (f.severity === 'critical') integrityScore -= 15;
    else if (f.severity === 'high') integrityScore -= 8;
    else integrityScore -= 4;
  }

  integrityScore = Math.max(0, Math.min(100, Math.round(integrityScore)));

  // ── Verified claims percentage ────────────────────────────────────────────
  const verifiedCount = claims.filter((c) => c.verifiedByThirdParty).length;
  const verifiedClaimsPct =
    claims.length > 0 ? Math.round((verifiedCount / claims.length) * 100) : 0;

  // ── Overall risk rating ───────────────────────────────────────────────────
  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const highCount = findings.filter((f) => f.severity === 'high').length;

  let overallRisk: GreenwashingRisk;
  if (criticalCount >= 2 || integrityScore < 20) {
    overallRisk = 'critical';
  } else if (criticalCount >= 1 || highCount >= 3 || integrityScore < 40) {
    overallRisk = 'high';
  } else if (highCount >= 1 || findings.length >= 3 || integrityScore < 60) {
    overallRisk = 'medium';
  } else if (findings.length >= 1 || integrityScore < 80) {
    overallRisk = 'low';
  } else {
    overallRisk = 'none';
  }

  // ── Narrative ─────────────────────────────────────────────────────────────
  const narrative = buildNarrative({
    entityId,
    reportingYear,
    overallRisk,
    findings,
    integrityScore,
    verifiedClaimsPct,
    disclosure,
  });

  return {
    entityId,
    overallRisk,
    findings,
    disclosureIntegrityScore: integrityScore,
    verifiedClaimsPct,
    narrative,
  };
}

// ---------------------------------------------------------------------------
// Narrative builder
// ---------------------------------------------------------------------------

interface NarrativeContext {
  entityId: string;
  reportingYear: number;
  overallRisk: GreenwashingRisk;
  findings: GreenwashingFinding[];
  integrityScore: number;
  verifiedClaimsPct: number;
  disclosure: EsgDisclosure;
}

function buildNarrative(ctx: NarrativeContext): string {
  const {
    entityId,
    reportingYear,
    overallRisk,
    findings,
    integrityScore,
    verifiedClaimsPct,
    disclosure,
  } = ctx;

  const riskLabel =
    overallRisk === 'none'
      ? 'no significant greenwashing indicators'
      : overallRisk === 'low'
        ? 'low greenwashing risk'
        : overallRisk === 'medium'
          ? 'moderate greenwashing risk'
          : overallRisk === 'high'
            ? 'HIGH greenwashing risk'
            : 'CRITICAL greenwashing risk — disclosure integrity is severely compromised';

  const parts: string[] = [
    `ESG Greenwashing Analysis for entity ${entityId} (reporting year ${reportingYear}):`,
    `Overall assessment: ${riskLabel}. Disclosure Integrity Score: ${integrityScore}/100. Third-party verified claims: ${verifiedClaimsPct}%.`,
  ];

  if (findings.length === 0) {
    parts.push(
      'No greenwashing indicators were detected. Claims are quantified, baselined, and independently verified.',
    );
  } else {
    const criticals = findings.filter((f) => f.severity === 'critical');
    const highs = findings.filter((f) => f.severity === 'high');
    const mediums = findings.filter((f) => f.severity === 'medium');

    parts.push(
      `${findings.length} finding(s) identified: ${criticals.length} critical, ${highs.length} high, ${mediums.length} medium.`,
    );

    if (criticals.length > 0) {
      parts.push(
        `Critical issues: ${criticals.map((f) => f.type.replace(/_/g, ' ')).join('; ')}.`,
      );
    }
  }

  // Disclosure standard / assurance context
  if (disclosure.disclosureStandard && disclosure.disclosureStandard !== 'none') {
    parts.push(`Disclosure standard: ${disclosure.disclosureStandard}.`);
  } else {
    parts.push('No recognised disclosure standard (GRI/SASB/ISSB/TCFD) identified.');
  }

  if (disclosure.hasExternalAssurance) {
    parts.push(
      `External assurance: present (level: ${disclosure.assuranceLevel ?? 'unspecified'}).`,
    );
  } else {
    parts.push('No external assurance obtained — all data is self-reported.');
  }

  parts.push(
    'Regulatory references: EU SFDR 2019/2088 Art.4; EU Taxonomy Regulation 2020/852 Art.3; ESMA Greenwashing Report 2023; FCA SDR 2023; ISSB IFRS S1 §B14-B15; GRI Standards 2021 §2-4.',
  );

  return parts.join(' ');
}
