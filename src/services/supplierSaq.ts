/**
 * Supplier SAQ (Self-Assessment Questionnaire) + Tier-N supply map.
 *
 * OECD Due Diligence Guidance for Responsible Supply Chains of
 * Minerals from Conflict-Affected and High-Risk Areas — Step 2
 * requires identifying and assessing risks in the supply chain. This
 * module provides:
 *
 *   1. A structured SAQ with DMCC-aligned questions
 *   2. A supplier map that traces upstream through tier-1, tier-2,
 *      tier-3 relationships
 *   3. CAHRA (Conflict-Affected and High-Risk Areas) risk scoring
 *   4. Red-flag detection on the SAQ responses
 *
 * The map answers: "for any gold we received this month, who was the
 * mine, refiner, and intermediary chain?" and "which suppliers in our
 * chain are CAHRA-linked?"
 *
 * Regulatory: OECD DDG 2016, DMCC Practical Guide, LBMA RGG v9 Step 2,
 * UAE MoE RSG Framework.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CAHRALevel = 'none' | 'medium' | 'high' | 'critical';

export type SaqAnswer = 'yes' | 'no' | 'partial' | 'not_applicable' | 'unknown';

export interface SaqQuestion {
  id: string;
  category:
    | 'governance'
    | 'provenance'
    | 'human_rights'
    | 'conflict'
    | 'environment'
    | 'audit';
  text: string;
  /** The answer considered compliant. If actual != expected, flags a gap. */
  expected: SaqAnswer;
  /** Weight of this question in the overall score (0-100 scale). */
  weight: number;
  regulatory: string;
}

export const STANDARD_SAQ: SaqQuestion[] = [
  {
    id: 'SAQ-GOV-01',
    category: 'governance',
    text: 'Does the supplier have a written Responsible Sourcing Policy aligned with OECD DDG?',
    expected: 'yes',
    weight: 10,
    regulatory: 'OECD DDG Step 1',
  },
  {
    id: 'SAQ-GOV-02',
    category: 'governance',
    text: 'Has the supplier appointed a senior manager responsible for due diligence?',
    expected: 'yes',
    weight: 5,
    regulatory: 'OECD DDG Step 1.A',
  },
  {
    id: 'SAQ-PROV-03',
    category: 'provenance',
    text: 'Can the supplier identify the country and mine of origin for all gold supplied?',
    expected: 'yes',
    weight: 15,
    regulatory: 'LBMA RGG v9 §3.1',
  },
  {
    id: 'SAQ-PROV-04',
    category: 'provenance',
    text: 'Does the supplier maintain chain-of-custody documentation for each batch?',
    expected: 'yes',
    weight: 10,
    regulatory: 'LBMA RGG v9 §3.2',
  },
  {
    id: 'SAQ-CONF-05',
    category: 'conflict',
    text: 'Has the supplier identified whether any of its sources are in CAHRA?',
    expected: 'yes',
    weight: 15,
    regulatory: 'OECD DDG Step 2',
  },
  {
    id: 'SAQ-CONF-06',
    category: 'conflict',
    text: 'If sourcing from CAHRA, has the supplier conducted on-the-ground due diligence?',
    expected: 'yes',
    weight: 10,
    regulatory: 'OECD DDG Step 2.B',
  },
  {
    id: 'SAQ-HR-07',
    category: 'human_rights',
    text: 'Has the supplier assessed human-rights risks (child labour, forced labour, torture)?',
    expected: 'yes',
    weight: 10,
    regulatory: 'OECD DDG Annex II',
  },
  {
    id: 'SAQ-HR-08',
    category: 'human_rights',
    text: 'Has the supplier had any enforcement action or public allegation of human-rights abuse?',
    expected: 'no',
    weight: 10,
    regulatory: 'OECD DDG Annex II',
  },
  {
    id: 'SAQ-ENV-09',
    category: 'environment',
    text: 'Does the supplier comply with mercury, cyanide, and tailings environmental controls?',
    expected: 'yes',
    weight: 5,
    regulatory: 'Minamata Convention on Mercury',
  },
  {
    id: 'SAQ-AUDIT-10',
    category: 'audit',
    text: 'Has the supplier undergone an independent responsible sourcing audit in the last 12 months?',
    expected: 'yes',
    weight: 10,
    regulatory: 'LBMA RGG v9 Step 4',
  },
];

// ---------------------------------------------------------------------------
// Supplier profile
// ---------------------------------------------------------------------------

export interface SaqResponse {
  questionId: string;
  answer: SaqAnswer;
  evidence?: string;
  answeredAt: string;
}

export interface SupplierProfile {
  id: string;
  name: string;
  country: string;
  tier: 1 | 2 | 3;
  /** Parent supplier id(s) — this supplier sources FROM these. */
  parents: string[];
  cahraLevel: CAHRALevel;
  saqResponses: SaqResponse[];
  lastAssessedAt?: string;
}

// ---------------------------------------------------------------------------
// SAQ scoring
// ---------------------------------------------------------------------------

export interface SaqScore {
  supplierId: string;
  score: number; // 0..100
  possibleScore: number;
  gaps: Array<{ questionId: string; expected: SaqAnswer; actual: SaqAnswer; weight: number }>;
  unanswered: string[];
  compliance: 'compliant' | 'partial' | 'non_compliant';
}

export function scoreSaq(
  supplier: SupplierProfile,
  questions: readonly SaqQuestion[] = STANDARD_SAQ,
): SaqScore {
  const responseMap = new Map(supplier.saqResponses.map((r) => [r.questionId, r]));

  let earned = 0;
  let possible = 0;
  const gaps: SaqScore['gaps'] = [];
  const unanswered: string[] = [];

  for (const q of questions) {
    possible += q.weight;
    const resp = responseMap.get(q.id);
    if (!resp || resp.answer === 'unknown') {
      unanswered.push(q.id);
      continue;
    }
    if (resp.answer === q.expected) {
      earned += q.weight;
    } else if (resp.answer === 'partial') {
      earned += q.weight * 0.5;
      gaps.push({ questionId: q.id, expected: q.expected, actual: 'partial', weight: q.weight });
    } else if (resp.answer === 'not_applicable') {
      // N/A removes from denominator
      possible -= q.weight;
    } else {
      gaps.push({ questionId: q.id, expected: q.expected, actual: resp.answer, weight: q.weight });
    }
  }

  const score = possible === 0 ? 0 : Math.round((earned / possible) * 10000) / 100;
  let compliance: SaqScore['compliance'];
  if (score >= 85) compliance = 'compliant';
  else if (score >= 60) compliance = 'partial';
  else compliance = 'non_compliant';

  return {
    supplierId: supplier.id,
    score,
    possibleScore: possible,
    gaps,
    unanswered,
    compliance,
  };
}

// ---------------------------------------------------------------------------
// Supply map + tier-N traversal
// ---------------------------------------------------------------------------

export interface SupplyMap {
  suppliers: Map<string, SupplierProfile>;
}

export function createSupplyMap(): SupplyMap {
  return { suppliers: new Map() };
}

export function addSupplier(map: SupplyMap, supplier: SupplierProfile): void {
  map.suppliers.set(supplier.id, supplier);
}

export interface UpstreamReport {
  rootId: string;
  maxTier: number;
  totalSuppliers: number;
  cahraSuppliers: Array<{ id: string; name: string; level: CAHRALevel; hops: number }>;
  worstCahraLevel: CAHRALevel;
  chainCountries: string[];
}

/**
 * Walk upstream from a root supplier, gathering every ancestor within
 * `maxHops`. Reports CAHRA-flagged suppliers anywhere in the chain.
 */
export function walkUpstream(
  map: SupplyMap,
  rootId: string,
  maxHops = 5,
): UpstreamReport {
  const root = map.suppliers.get(rootId);
  if (!root) {
    return {
      rootId,
      maxTier: 0,
      totalSuppliers: 0,
      cahraSuppliers: [],
      worstCahraLevel: 'none',
      chainCountries: [],
    };
  }

  interface Frame {
    id: string;
    hops: number;
  }
  const visited = new Set<string>([rootId]);
  const queue: Frame[] = [{ id: rootId, hops: 0 }];
  const cahraSuppliers: UpstreamReport['cahraSuppliers'] = [];
  const countries = new Set<string>();
  let maxTier = root.tier;

  while (queue.length > 0) {
    const frame = queue.shift()!;
    const supplier = map.suppliers.get(frame.id);
    if (!supplier) continue;
    countries.add(supplier.country);
    if (supplier.tier > maxTier) maxTier = supplier.tier;
    if (supplier.cahraLevel !== 'none') {
      cahraSuppliers.push({
        id: supplier.id,
        name: supplier.name,
        level: supplier.cahraLevel,
        hops: frame.hops,
      });
    }
    if (frame.hops >= maxHops) continue;
    for (const parentId of supplier.parents) {
      if (visited.has(parentId)) continue;
      visited.add(parentId);
      queue.push({ id: parentId, hops: frame.hops + 1 });
    }
  }

  // Worst CAHRA level
  const priority: Record<CAHRALevel, number> = {
    none: 0,
    medium: 1,
    high: 2,
    critical: 3,
  };
  let worstLevel: CAHRALevel = 'none';
  for (const s of cahraSuppliers) {
    if (priority[s.level] > priority[worstLevel]) worstLevel = s.level;
  }

  return {
    rootId,
    maxTier,
    totalSuppliers: visited.size,
    cahraSuppliers,
    worstCahraLevel: worstLevel,
    chainCountries: [...countries],
  };
}
