/**
 * PEP Proximity Scorer
 *
 * Scores the proximity of an entity to Politically Exposed Persons (PEPs)
 * up to the 3rd degree of separation in a relationship network.
 * Applies EDD triggers per UAE AML regulations.
 *
 * Regulatory: FDL No.10/2025 Art.12-14, Cabinet Res 134/2025 Art.14
 *             (PEP EDD + board approval), FATF Rec 12 (PEP), FATF
 *             Rec 22/23 (DPMS), Cabinet Decision 109/2023 (UBO).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type PepCategory =
  | 'head_of_state'
  | 'government_minister'
  | 'parliament_member'
  | 'senior_judicial'
  | 'senior_military'
  | 'senior_soe' // state-owned enterprise executive
  | 'international_org' // senior international org official
  | 'central_bank'
  | 'party_official';

export type RelationshipType =
  | 'self' // the entity IS a PEP
  | 'immediate_family' // spouse, child, parent, sibling
  | 'known_associate' // known close business/personal associate
  | 'beneficial_owner' // entity is beneficially owned by PEP (>25%)
  | 'nominee' // entity holds on behalf of PEP
  | 'employer' // entity employs PEP
  | 'corporate_director' // PEP sits on entity's board
  | 'indirect_holding' // PEP owns through intermediate entity
  | 'former_pep'; // PEP left office <12 months ago (cooling off)

export type PepRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface PepNode {
  nodeId: string;
  name: string;
  isPep: boolean;
  pepCategory?: PepCategory;
  pepJurisdiction?: string;
  leftOfficeDate?: string; // ISO date; null = still in office
  relationshipToTarget: RelationshipType;
  degreeOfSeparation: 0 | 1 | 2 | 3;
}

export interface PepProximityInput {
  targetEntityId: string;
  networkNodes: PepNode[];
  /** Is the target entity itself being screened? */
  isDirectScreening: boolean;
}

export interface PepProximityScore {
  targetEntityId: string;
  generatedAt: string;
  overallRisk: PepRiskLevel;
  maxProximityScore: number; // 0–100; highest-risk PEP link
  pepLinks: PepLink[];
  requiresEdd: boolean;
  requiresBoardApproval: boolean;
  cddLevel: 'SDD' | 'CDD' | 'EDD';
  reviewFrequencyMonths: number;
  flags: string[];
  narrativeSummary: string;
  regulatoryRefs: string[];
}

export interface PepLink {
  pepNodeId: string;
  pepName: string;
  pepCategory?: PepCategory;
  relationshipType: RelationshipType;
  degreeOfSeparation: number;
  proximityScore: number; // 0–100
  riskLevel: PepRiskLevel;
  inCoolingOff: boolean;
  mitigatingFactors: string[];
  escalationTriggers: string[];
}

// ─── Proximity Scoring ────────────────────────────────────────────────────────

/** Base scores by degree of separation */
const BASE_DEGREE_SCORES: Record<0 | 1 | 2 | 3, number> = {
  0: 100, // entity IS the PEP
  1: 75, // immediate family / direct associate
  2: 45, // second-degree link
  3: 20, // third-degree link
};

/** PEP category risk multipliers */
const PEP_CATEGORY_MULTIPLIERS: Record<PepCategory, number> = {
  head_of_state: 1.3,
  government_minister: 1.2,
  parliament_member: 1.0,
  senior_judicial: 1.1,
  senior_military: 1.1,
  senior_soe: 0.9,
  international_org: 1.0,
  central_bank: 1.1,
  party_official: 0.9,
};

/** Relationship risk multipliers */
const RELATIONSHIP_MULTIPLIERS: Record<RelationshipType, number> = {
  self: 1.0,
  immediate_family: 0.9,
  known_associate: 0.8,
  beneficial_owner: 1.1,
  nominee: 1.2,
  employer: 0.7,
  corporate_director: 0.85,
  indirect_holding: 0.9,
  former_pep: 0.6,
};

function isCoolingOff(node: PepNode): boolean {
  if (!node.leftOfficeDate) return false;
  const left = new Date(node.leftOfficeDate);
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
  return left > twelveMonthsAgo;
}

function scorePepLink(node: PepNode): PepLink {
  const baseScore = BASE_DEGREE_SCORES[node.degreeOfSeparation];
  const catMult = node.pepCategory ? PEP_CATEGORY_MULTIPLIERS[node.pepCategory] : 1.0;
  const relMult = RELATIONSHIP_MULTIPLIERS[node.relationshipToTarget];
  const coolingOff = isCoolingOff(node);
  const coolingMult = coolingOff ? 0.75 : 1.0;

  const proximityScore = Math.min(100, baseScore * catMult * relMult * coolingMult);
  const riskLevel: PepRiskLevel =
    proximityScore >= 70
      ? 'critical'
      : proximityScore >= 45
        ? 'high'
        : proximityScore >= 20
          ? 'medium'
          : 'low';

  const escalationTriggers: string[] = [];
  if (node.relationshipToTarget === 'beneficial_owner')
    escalationTriggers.push('PEP holds >25% beneficial ownership — Cabinet Decision 109/2023');
  if (node.relationshipToTarget === 'nominee')
    escalationTriggers.push('Nominee structure with PEP — elevated structuring risk');
  if (node.degreeOfSeparation <= 1)
    escalationTriggers.push(
      'First-degree PEP link — EDD + board approval required (Cabinet Res 134/2025 Art.14)'
    );

  const mitigatingFactors: string[] = [];
  if (node.degreeOfSeparation >= 3)
    mitigatingFactors.push('Third-degree separation reduces inherent risk');
  if (coolingOff)
    mitigatingFactors.push(
      'PEP in 12-month cooling-off period — apply standard EDD until fully elapsed'
    );
  if (node.relationshipToTarget === 'former_pep')
    mitigatingFactors.push('No longer in public office >12 months');

  return {
    pepNodeId: node.nodeId,
    pepName: node.name,
    pepCategory: node.pepCategory,
    relationshipType: node.relationshipToTarget,
    degreeOfSeparation: node.degreeOfSeparation,
    proximityScore,
    riskLevel,
    inCoolingOff: coolingOff,
    mitigatingFactors,
    escalationTriggers,
  };
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function scorePepProximity(input: PepProximityInput): PepProximityScore {
  const pepLinks = input.networkNodes.filter((n) => n.isPep).map(scorePepLink);

  const maxScore = pepLinks.length > 0 ? Math.max(...pepLinks.map((l) => l.proximityScore)) : 0;

  const overallRisk: PepRiskLevel =
    maxScore >= 70 ? 'critical' : maxScore >= 45 ? 'high' : maxScore >= 20 ? 'medium' : 'low';

  const requiresEdd = maxScore >= 45 || pepLinks.some((l) => l.degreeOfSeparation <= 1);
  const requiresBoardApproval = maxScore >= 70 || pepLinks.some((l) => l.degreeOfSeparation === 0);

  const cddLevel: 'SDD' | 'CDD' | 'EDD' = requiresEdd ? 'EDD' : maxScore >= 20 ? 'CDD' : 'SDD';

  const reviewFrequencyMonths = cddLevel === 'EDD' ? 3 : cddLevel === 'CDD' ? 6 : 12;

  const flags: string[] = [];
  if (requiresBoardApproval)
    flags.push(
      'CRITICAL: Board approval required before onboarding PEP-linked entity (Cabinet Res 134/2025 Art.14)'
    );
  if (pepLinks.some((l) => l.relationshipType === 'nominee'))
    flags.push(
      'WARNING: Nominee structure detected — enhanced source-of-funds verification required'
    );
  if (pepLinks.some((l) => l.relationshipType === 'beneficial_owner'))
    flags.push('WARNING: PEP beneficial ownership — verify UBO per Cabinet Decision 109/2023');

  const narrativeSummary =
    `Entity ${input.targetEntityId}: ${pepLinks.length} PEP link(s) detected. ` +
    `Max proximity score: ${maxScore.toFixed(0)}/100 (${overallRisk.toUpperCase()}). ` +
    `CDD level: ${cddLevel}. Board approval required: ${requiresBoardApproval}. ` +
    `Review cycle: every ${reviewFrequencyMonths} months.`;

  return {
    targetEntityId: input.targetEntityId,
    generatedAt: new Date().toISOString(),
    overallRisk,
    maxProximityScore: maxScore,
    pepLinks,
    requiresEdd,
    requiresBoardApproval,
    cddLevel,
    reviewFrequencyMonths,
    flags,
    narrativeSummary,
    regulatoryRefs: [
      'FDL No.10/2025 Art.12-14 — CDD obligations',
      'Cabinet Res 134/2025 Art.14 — PEP EDD and board approval',
      'FATF Recommendation 12 — Politically Exposed Persons',
      'FATF Recommendation 22/23 — DPMS PEP obligations',
      'Cabinet Decision 109/2023 — UBO register ≥25%',
    ],
  };
}
