/**
 * ESG Adverse Media Classifier
 *
 * Classifies adverse media hits into ESG categories and extracts ESG signals
 * from headline and body text. Designed for integration with the compliance
 * screening pipeline (CDD/EDD adverse media step) and ESG scoring subsystem.
 *
 * Classification taxonomy:
 *   Environmental : pollution, spill, contamination, illegal mining, waste, deforestation, etc.
 *   Social        : forced/child labour, trafficking, worker death, exploitation, etc.
 *   Governance    : bribery, corruption, fraud, money laundering, sanctions violations, etc.
 *   ESG Combined  : hit contains signals from two or more pillars simultaneously
 *   Not ESG       : no ESG signal detected
 *
 * Severity escalation:
 *   - Environmental + criminal charge or large fine → critical
 *   - Social + forced/child labour → critical
 *   - Governance + sanctions or money laundering → critical
 *   - Others scored by keyword density and topic gravity
 *
 * Regulatory basis:
 *   - EU SFDR 2019/2088 Art.4 (principal adverse impact disclosure)
 *   - GRI 13 — Mining Sector Standard (media screening obligation)
 *   - LBMA Responsible Gold Guidance v9 §4 (adverse media screening)
 *   - FDL No.10/2025 Art.20-21 (CDD — adverse media in due diligence)
 *   - Cabinet Res 134/2025 Art.7-10 (CDD tiers — media triggers EDD)
 */

// ---------------------------------------------------------------------------
// Types — exported as specified
// ---------------------------------------------------------------------------

export type EsgCategory = 'environmental' | 'social' | 'governance' | 'esg_combined' | 'not_esg';

export interface AdverseMediaHitInput {
  id: string;
  headline: string;
  bodyText?: string;
  source?: string;
  publishedAt?: string;
}

export interface EsgMediaFinding {
  hitId: string;
  category: EsgCategory;
  /** e.g. 'pollution', 'labour_violation', 'bribery' */
  subCategory: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** Detected ESG keywords / phrases from the text. */
  esgSignals: string[];
  relevantRegulation?: string;
}

export interface EsgAdverseMediaReport {
  totalHits: number;
  esgHits: number;
  byCategory: {
    environmental: number;
    social: number;
    governance: number;
    combined: number;
  };
  criticalFindings: EsgMediaFinding[];
  allFindings: EsgMediaFinding[];
  topEsgRisk: EsgCategory | 'none';
  narrative: string;
}

// ---------------------------------------------------------------------------
// Keyword dictionaries
// ---------------------------------------------------------------------------

interface KeywordEntry {
  pattern: RegExp;
  subCategory: string;
  weight: number; // 1 = standard, 2 = elevated, 3 = severe
}

const ENVIRONMENTAL_KEYWORDS: KeywordEntry[] = [
  { pattern: /\bpollut/i, subCategory: 'pollution', weight: 2 },
  { pattern: /\bspill\b/i, subCategory: 'pollution', weight: 2 },
  { pattern: /\bcontaminat/i, subCategory: 'contamination', weight: 2 },
  { pattern: /\bdeforestat/i, subCategory: 'deforestation', weight: 2 },
  { pattern: /\billegal\s+mining\b/i, subCategory: 'illegal_mining', weight: 3 },
  { pattern: /\bmercury\b/i, subCategory: 'toxic_substance', weight: 3 },
  { pattern: /\bcyanide\b/i, subCategory: 'toxic_substance', weight: 3 },
  { pattern: /\btailing[s]?\b/i, subCategory: 'mining_waste', weight: 2 },
  { pattern: /\bwaste\s+dump\b/i, subCategory: 'illegal_waste', weight: 2 },
  { pattern: /\benvironmental\s+fine\b/i, subCategory: 'regulatory_penalty', weight: 2 },
  { pattern: /\becological\s+damage\b/i, subCategory: 'ecological_harm', weight: 2 },
  { pattern: /\bwater\s+contaminat/i, subCategory: 'water_pollution', weight: 3 },
  { pattern: /\bair\s+quality\b/i, subCategory: 'air_pollution', weight: 1 },
  { pattern: /\bbiodiversit/i, subCategory: 'biodiversity_loss', weight: 1 },
  { pattern: /\bhabitat\s+destruct/i, subCategory: 'habitat_destruction', weight: 2 },
  { pattern: /\btoxic\s+waste\b/i, subCategory: 'toxic_waste', weight: 3 },
  { pattern: /\bchemical\s+leak\b/i, subCategory: 'chemical_spill', weight: 2 },
  { pattern: /\barsenic\b/i, subCategory: 'toxic_substance', weight: 3 },
  { pattern: /\bmine\s+collapse\b/i, subCategory: 'mining_incident', weight: 2 },
  { pattern: /\bwildlife\s+kill/i, subCategory: 'biodiversity_loss', weight: 2 },
];

const SOCIAL_KEYWORDS: KeywordEntry[] = [
  { pattern: /\bforced\s+lab(?:ou?r|or)\b/i, subCategory: 'forced_labour', weight: 3 },
  { pattern: /\bchild\s+lab(?:ou?r|or)\b/i, subCategory: 'child_labour', weight: 3 },
  { pattern: /\bslavery\b/i, subCategory: 'modern_slavery', weight: 3 },
  { pattern: /\bhuman\s+trafficking\b/i, subCategory: 'trafficking', weight: 3 },
  { pattern: /\bworker\s+death\b/i, subCategory: 'fatal_incident', weight: 3 },
  { pattern: /\bunsafe\s+working\b/i, subCategory: 'safety_violation', weight: 2 },
  { pattern: /\bstrike\b/i, subCategory: 'labour_dispute', weight: 1 },
  { pattern: /\bexploitat/i, subCategory: 'exploitation', weight: 2 },
  { pattern: /\bdiscriminat/i, subCategory: 'discrimination', weight: 2 },
  { pattern: /\bharassment\b/i, subCategory: 'harassment', weight: 2 },
  { pattern: /\bkafala\b/i, subCategory: 'kafala_abuse', weight: 3 },
  { pattern: /\bwage\s+theft\b/i, subCategory: 'wage_theft', weight: 2 },
  { pattern: /\bpassport\s+confiscation\b/i, subCategory: 'forced_labour', weight: 3 },
  { pattern: /\bmigrant\s+worker\s+abuse\b/i, subCategory: 'migrant_abuse', weight: 3 },
  { pattern: /\bsexual\s+harassment\b/i, subCategory: 'harassment', weight: 2 },
  { pattern: /\bunion\s+bust/i, subCategory: 'labour_rights', weight: 2 },
  { pattern: /\bchild\s+soldier\b/i, subCategory: 'child_exploitation', weight: 3 },
  { pattern: /\btraffick/i, subCategory: 'trafficking', weight: 3 },
  { pattern: /\bslavery\s+ring\b/i, subCategory: 'modern_slavery', weight: 3 },
  { pattern: /\bocupational\s+hazard\b/i, subCategory: 'safety_violation', weight: 1 },
];

const GOVERNANCE_KEYWORDS: KeywordEntry[] = [
  { pattern: /\bbriber/i, subCategory: 'bribery', weight: 3 },
  { pattern: /\bcorrupt/i, subCategory: 'corruption', weight: 3 },
  { pattern: /\bfraud\b/i, subCategory: 'fraud', weight: 2 },
  { pattern: /\bmoney\s+launder/i, subCategory: 'money_laundering', weight: 3 },
  { pattern: /\bsanctions?\s+violation\b/i, subCategory: 'sanctions_breach', weight: 3 },
  { pattern: /\binsider\s+trading\b/i, subCategory: 'insider_trading', weight: 2 },
  { pattern: /\baccounting\s+fraud\b/i, subCategory: 'accounting_fraud', weight: 3 },
  { pattern: /\btax\s+evasion\b/i, subCategory: 'tax_evasion', weight: 2 },
  { pattern: /\bembezzlement\b/i, subCategory: 'embezzlement', weight: 3 },
  { pattern: /\bprice\s+fixing\b/i, subCategory: 'cartel', weight: 2 },
  { pattern: /\bcartel\b/i, subCategory: 'cartel', weight: 3 },
  { pattern: /\bkickback\b/i, subCategory: 'bribery', weight: 3 },
  { pattern: /\bfalsified\s+document/i, subCategory: 'document_fraud', weight: 3 },
  { pattern: /\bshell\s+compan/i, subCategory: 'corporate_opacity', weight: 2 },
  { pattern: /\bsanctions?\s+bust/i, subCategory: 'sanctions_breach', weight: 3 },
  { pattern: /\bregulatory\s+fine\b/i, subCategory: 'regulatory_penalty', weight: 1 },
  { pattern: /\bconflict\s+of\s+interest\b/i, subCategory: 'governance_failure', weight: 1 },
  { pattern: /\bwhistleblower\b/i, subCategory: 'governance_failure', weight: 1 },
  { pattern: /\bmarket\s+manipulat/i, subCategory: 'market_manipulation', weight: 2 },
  { pattern: /\bponzi\b/i, subCategory: 'fraud', weight: 3 },
];

// Escalation patterns that push severity to critical
const CRITICAL_ESCALATION_ENV: RegExp[] = [
  /\bcriminal\b/i,
  /\bmillion[s]?\s+(?:USD|AED|EUR|fine)\b/i,
  /\bprosecuted\b/i,
  /\bindicted\b/i,
];
const CRITICAL_ESCALATION_SOCIAL: RegExp[] = [
  /\bforced\s+lab/i,
  /\bchild\s+lab/i,
  /\bslavery\b/i,
  /\btraffick/i,
  /\bkafala\b/i,
  /\bpassport\s+confis/i,
];
const CRITICAL_ESCALATION_GOV: RegExp[] = [
  /\bsanctions\b/i,
  /\bmoney\s+launder/i,
  /\bterror/i,
  /\bembezzl/i,
  /\baccounting\s+fraud/i,
  /\bkickback/i,
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface PillarMatch {
  signals: string[];
  subCategories: string[];
  totalWeight: number;
}

function matchPillar(text: string, keywords: KeywordEntry[]): PillarMatch {
  const signals: string[] = [];
  const subCategories: string[] = [];
  let totalWeight = 0;

  for (const kw of keywords) {
    const match = text.match(kw.pattern);
    if (match) {
      const signal = match[0].toLowerCase().trim();
      if (!signals.includes(signal)) {
        signals.push(signal);
      }
      if (!subCategories.includes(kw.subCategory)) {
        subCategories.push(kw.subCategory);
      }
      totalWeight += kw.weight;
    }
  }

  return { signals, subCategories, totalWeight };
}

/**
 * Determine overall severity for an environmental hit.
 * Critical if criminal charges or large fines mentioned in the full text.
 */
function severityEnvironmental(fullText: string, weight: number): EsgMediaFinding['severity'] {
  const isCritical = CRITICAL_ESCALATION_ENV.some((rx) => rx.test(fullText));
  if (isCritical || weight >= 6) return 'critical';
  if (weight >= 4) return 'high';
  if (weight >= 2) return 'medium';
  return 'low';
}

/**
 * Determine overall severity for a social hit.
 * Critical for forced/child labour, slavery, trafficking.
 */
function severitySocial(fullText: string, weight: number): EsgMediaFinding['severity'] {
  const isCritical = CRITICAL_ESCALATION_SOCIAL.some((rx) => rx.test(fullText));
  if (isCritical || weight >= 6) return 'critical';
  if (weight >= 4) return 'high';
  if (weight >= 2) return 'medium';
  return 'low';
}

/**
 * Determine overall severity for a governance hit.
 * Critical for sanctions violations and money laundering.
 */
function severityGovernance(fullText: string, weight: number): EsgMediaFinding['severity'] {
  const isCritical = CRITICAL_ESCALATION_GOV.some((rx) => rx.test(fullText));
  if (isCritical || weight >= 6) return 'critical';
  if (weight >= 4) return 'high';
  if (weight >= 2) return 'medium';
  return 'low';
}

/** Regulation citation lookup by subCategory. */
function regulationForSubCategory(
  subCategory: string,
  pillar: 'environmental' | 'social' | 'governance'
): string {
  // Governance citations (FDL + AML)
  const govCitations: Record<string, string> = {
    money_laundering: 'FDL No.10/2025 Art.20-21; Cabinet Res 134/2025 Art.7-10',
    sanctions_breach: 'Cabinet Res 74/2020 Art.4-7; FDL No.10/2025 Art.35',
    bribery: 'FDL No.10/2025 Art.20-21; FATF Rec 22/23',
    corruption: 'FDL No.10/2025 Art.20-21; OECD Anti-Bribery Convention',
    fraud: 'FDL No.10/2025 Art.20-21; Cabinet Res 71/2024',
    accounting_fraud: 'FDL No.10/2025 Art.20-21; ISSB IFRS S1 §B14',
    cartel: 'FDL No.10/2025 Art.20-21',
    document_fraud: 'FDL No.10/2025 Art.20-21; Cabinet Res 134/2025 Art.7',
  };
  // Environmental citations
  const envCitations: Record<string, string> = {
    illegal_mining: 'LBMA RGG v9 §4; GRI 13 Mining Sector; EU SFDR 2019/2088 Art.4',
    water_pollution: 'GRI 303; EU Taxonomy 2020/852 Art.3; LBMA RGG v9',
    toxic_substance: 'GRI 305; LBMA RGG v9 §4; UAE Environment Law',
    pollution: 'EU SFDR 2019/2088 Art.4 (PAI); GRI 305-306',
    deforestation: 'EU Taxonomy Regulation 2020/852 Art.3; GRI 304',
  };
  // Social citations
  const socialCitations: Record<string, string> = {
    forced_labour: 'GRI 409; ILO Forced Labour Conventions; FDL No.10/2025 Art.20-21',
    child_labour: 'GRI 408; UN Convention on the Rights of the Child; ILO C138/C182',
    trafficking: 'FDL No.10/2025 Art.20-21; UN Protocol to Prevent Trafficking',
    modern_slavery: 'UK Modern Slavery Act 2015; GRI 409; FDL No.10/2025 Art.20-21',
    kafala_abuse: 'UAE Labour Law; ILO Forced Labour Convention; FDL Art.20-21',
  };

  if (pillar === 'governance' && govCitations[subCategory]) return govCitations[subCategory];
  if (pillar === 'environmental' && envCitations[subCategory]) return envCitations[subCategory];
  if (pillar === 'social' && socialCitations[subCategory]) return socialCitations[subCategory];

  // Generic fallback by pillar
  if (pillar === 'environmental') return 'EU SFDR 2019/2088 Art.4; GRI 13 Mining Sector';
  if (pillar === 'social') return 'GRI 400 Series; FDL No.10/2025 Art.20-21';
  return 'FDL No.10/2025 Art.20-21; LBMA RGG v9';
}

// ---------------------------------------------------------------------------
// Core classifier
// ---------------------------------------------------------------------------

/**
 * Classifies a single adverse media hit into ESG categories.
 * Returns null if no ESG signal is detected.
 */
function classifySingleHit(hit: AdverseMediaHitInput): EsgMediaFinding | null {
  const fullText = `${hit.headline} ${hit.bodyText ?? ''}`;

  const envMatch = matchPillar(fullText, ENVIRONMENTAL_KEYWORDS);
  const socMatch = matchPillar(fullText, SOCIAL_KEYWORDS);
  const govMatch = matchPillar(fullText, GOVERNANCE_KEYWORDS);

  const hasEnv = envMatch.totalWeight > 0;
  const hasSoc = socMatch.totalWeight > 0;
  const hasGov = govMatch.totalWeight > 0;

  const pillarCount = [hasEnv, hasSoc, hasGov].filter(Boolean).length;

  if (pillarCount === 0) return null; // Not ESG

  // Determine primary category
  let category: EsgCategory;
  let signals: string[];
  let subCategory: string;
  let severity: EsgMediaFinding['severity'];
  let relevantRegulation: string;

  if (pillarCount >= 2) {
    category = 'esg_combined';
    signals = [...envMatch.signals, ...socMatch.signals, ...govMatch.signals];
    // Pick primary sub-category from highest-weight pillar
    const dominant = [
      {
        pillar: 'environmental' as const,
        weight: envMatch.totalWeight,
        subs: envMatch.subCategories,
      },
      { pillar: 'social' as const, weight: socMatch.totalWeight, subs: socMatch.subCategories },
      { pillar: 'governance' as const, weight: govMatch.totalWeight, subs: govMatch.subCategories },
    ].sort((a, b) => b.weight - a.weight)[0];
    subCategory = dominant.subs[0] ?? 'multi_pillar';
    // Severity: critical if any pillar reaches critical
    const envSev = hasEnv ? severityEnvironmental(fullText, envMatch.totalWeight) : 'low';
    const socSev = hasSoc ? severitySocial(fullText, socMatch.totalWeight) : 'low';
    const govSev = hasGov ? severityGovernance(fullText, govMatch.totalWeight) : 'low';
    const severityOrder = ['critical', 'high', 'medium', 'low'] as const;
    const worstIdx = Math.min(
      severityOrder.indexOf(envSev),
      severityOrder.indexOf(socSev),
      severityOrder.indexOf(govSev)
    );
    severity = severityOrder[worstIdx];
    relevantRegulation =
      'EU SFDR 2019/2088 Art.4; FDL No.10/2025 Art.20-21; LBMA RGG v9 §4; GRI 13';
  } else if (hasEnv) {
    category = 'environmental';
    signals = envMatch.signals;
    subCategory = envMatch.subCategories[0] ?? 'environmental_violation';
    severity = severityEnvironmental(fullText, envMatch.totalWeight);
    relevantRegulation = regulationForSubCategory(subCategory, 'environmental');
  } else if (hasSoc) {
    category = 'social';
    signals = socMatch.signals;
    subCategory = socMatch.subCategories[0] ?? 'social_violation';
    severity = severitySocial(fullText, socMatch.totalWeight);
    relevantRegulation = regulationForSubCategory(subCategory, 'social');
  } else {
    // governance only
    category = 'governance';
    signals = govMatch.signals;
    subCategory = govMatch.subCategories[0] ?? 'governance_failure';
    severity = severityGovernance(fullText, govMatch.totalWeight);
    relevantRegulation = regulationForSubCategory(subCategory, 'governance');
  }

  return {
    hitId: hit.id,
    category,
    subCategory,
    severity,
    esgSignals: signals,
    relevantRegulation,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classifies a collection of adverse media hits into ESG categories and
 * aggregates the results into a structured report.
 *
 * @param hits - Adverse media hits to classify (read-only array).
 * @returns EsgAdverseMediaReport with full breakdown and narrative.
 *
 * @see EU SFDR 2019/2088 Art.4
 * @see GRI 13 (Mining Sector Standard)
 * @see LBMA Responsible Gold Guidance v9 §4
 * @see FDL No.10/2025 Art.20-21
 */
export function classifyEsgAdverseMedia(
  hits: readonly AdverseMediaHitInput[]
): EsgAdverseMediaReport {
  const allFindings: EsgMediaFinding[] = [];
  const byCategory = { environmental: 0, social: 0, governance: 0, combined: 0 };

  for (const hit of hits) {
    const finding = classifySingleHit(hit);
    if (finding) {
      allFindings.push(finding);
      if (finding.category === 'environmental') byCategory.environmental++;
      else if (finding.category === 'social') byCategory.social++;
      else if (finding.category === 'governance') byCategory.governance++;
      else if (finding.category === 'esg_combined') byCategory.combined++;
    }
  }

  const criticalFindings = allFindings.filter((f) => f.severity === 'critical');
  const esgHits = allFindings.length;

  // Determine top ESG risk category by hit count (combined counts toward each pillar)
  type CountedCategory = { category: EsgCategory | 'none'; count: number };
  const categoryRanking: CountedCategory[] = (
    [
      { category: 'environmental', count: byCategory.environmental + byCategory.combined },
      { category: 'social', count: byCategory.social + byCategory.combined },
      { category: 'governance', count: byCategory.governance + byCategory.combined },
    ] satisfies CountedCategory[]
  ).sort((a, b) => b.count - a.count);

  const topEsgRisk: EsgCategory | 'none' =
    categoryRanking[0].count > 0 ? categoryRanking[0].category : 'none';

  const narrative = buildMediaNarrative({
    totalHits: hits.length,
    esgHits,
    byCategory,
    criticalCount: criticalFindings.length,
    topEsgRisk,
    allFindings,
  });

  return {
    totalHits: hits.length,
    esgHits,
    byCategory,
    criticalFindings,
    allFindings,
    topEsgRisk,
    narrative,
  };
}

// ---------------------------------------------------------------------------
// Narrative builder
// ---------------------------------------------------------------------------

interface MediaNarrativeCtx {
  totalHits: number;
  esgHits: number;
  byCategory: { environmental: number; social: number; governance: number; combined: number };
  criticalCount: number;
  topEsgRisk: EsgCategory | 'none';
  allFindings: EsgMediaFinding[];
}

function buildMediaNarrative(ctx: MediaNarrativeCtx): string {
  const { totalHits, esgHits, byCategory, criticalCount, topEsgRisk, allFindings } = ctx;

  const parts: string[] = [
    `ESG Adverse Media Classification: ${totalHits} total hits screened; ${esgHits} classified as ESG-relevant.`,
  ];

  if (esgHits === 0) {
    parts.push('No ESG-related adverse media signals detected across all hits.');
    return parts.join(' ');
  }

  parts.push(
    `Breakdown: ${byCategory.environmental} environmental, ${byCategory.social} social, ${byCategory.governance} governance, ${byCategory.combined} multi-pillar.`
  );

  if (criticalCount > 0) {
    parts.push(
      `CRITICAL: ${criticalCount} finding(s) require immediate escalation per FDL No.10/2025 Art.20-21 and Cabinet Res 134/2025 Art.7-10 (EDD trigger).`
    );
  }

  if (topEsgRisk !== 'none') {
    parts.push(`Primary ESG risk concentration: ${topEsgRisk.toUpperCase()}.`);
  }

  // List the most severe sub-categories found
  const critSubCats = [
    ...new Set(allFindings.filter((f) => f.severity === 'critical').map((f) => f.subCategory)),
  ];
  if (critSubCats.length > 0) {
    parts.push(`Critical sub-categories: ${critSubCats.join(', ')}.`);
  }

  parts.push(
    'Regulatory obligations: EU SFDR 2019/2088 Art.4 (PAI disclosure); GRI 13 Mining Sector Standard; LBMA RGG v9 §4; FDL No.10/2025 Art.20-21 (CDD adverse media); Cabinet Res 134/2025 Art.7-10 (EDD if critical findings present).'
  );

  return parts.join(' ');
}
