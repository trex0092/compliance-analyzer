/**
 * Sanctions Evasion Typology Matcher — static library of FATF/EOCN patterns.
 *
 * Phase 2 weaponization subsystem #27.
 *
 * The matcher runs a case's signals against a fixed library of known
 * sanctions-evasion typologies (shell-company layering, SDN aliasing,
 * BIC stripping, trade-based laundering, nested correspondent banking,
 * front-company payments, chain-hopping via VASPs, structuring around
 * the AED 55K DPMS threshold). Each typology is a pattern over signal
 * presence; matches are scored and ranked.
 *
 * Why we ship this deterministically: typologies come from published
 * FATF / EOCN / OFAC guidance. They don't change often, they're auditable,
 * and the compliance team can point at a specific typology ID when
 * explaining a decision. An LLM-based matcher would be faster to write
 * but much harder to defend in an MoE inspection.
 *
 * Regulatory basis:
 *   - FATF Rec 16 (wire transfer record-keeping, correspondent banking)
 *   - FATF Rec 20 (suspicious transaction reporting)
 *   - Cabinet Res 74/2020 Art.4-7 (asset freeze on typology hit)
 *   - MoE Circular 08/AML/2021 (DPMS red flags)
 */

import { DEFAULT_CLAMP_POLICY, type ClampPolicy } from './clampPolicy';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TypologySignals {
  /** Number of distinct intermediary entities between source and destination. */
  intermediaryCount?: number;
  /** Whether the entity has a shell-company profile (no staff, no ops). */
  isShellCompany?: boolean;
  /** Whether any UBO is on a sanctions list. */
  hasSanctionedUbo?: boolean;
  /** Number of transactions just below the AED 55K DPMS threshold. */
  nearThresholdCount?: number;
  /** Number of distinct counterparties in the last 30 days. */
  counterpartyCount30d?: number;
  /** Whether the entity is a VASP / crypto-to-fiat conduit. */
  isVasp?: boolean;
  /** Whether trade goods are high-risk (gold, art, real estate). */
  isHighRiskGoods?: boolean;
  /** Whether the counterparty country is high-risk (IR/KP/MM/SY). */
  isHighRiskCountry?: boolean;
  /** Whether any BIC/SWIFT field was stripped or missing. */
  hasStrippedBic?: boolean;
}

export interface TypologyHit {
  id: string;
  name: string;
  citation: string;
  /** Match score in [0,1]. */
  score: number;
  /** Signals that matched this typology. */
  matchedSignals: string[];
  /** Required clamp action if the typology matches above threshold. */
  action: 'freeze' | 'escalate' | 'flag';
}

export interface TypologyMatchReport {
  hits: TypologyHit[];
  /** Highest-scoring match. null if no hits. */
  topHit: TypologyHit | null;
  narrative: string;
}

// ---------------------------------------------------------------------------
// Typology library
// ---------------------------------------------------------------------------

interface TypologyDef {
  id: string;
  name: string;
  citation: string;
  action: TypologyHit['action'];
  /** Returns [matchedSignals, score]. */
  check: (s: TypologySignals) => { matched: string[]; score: number };
}

const TYPOLOGIES: TypologyDef[] = [
  {
    id: 'T1',
    name: 'Shell-company layering',
    citation: 'FATF Rec 10 + Cabinet Decision 109/2023',
    action: 'escalate',
    check: (s) => {
      const matched: string[] = [];
      if (s.isShellCompany) matched.push('isShellCompany');
      if ((s.intermediaryCount ?? 0) >= 3) matched.push('intermediaryCount>=3');
      const score = matched.length / 2;
      return { matched, score };
    },
  },
  {
    id: 'T2',
    name: 'Sanctioned UBO front company',
    citation: 'Cabinet Res 74/2020 Art.4-7',
    action: 'freeze',
    check: (s) => {
      const matched: string[] = [];
      if (s.hasSanctionedUbo) matched.push('hasSanctionedUbo');
      if (s.isShellCompany) matched.push('isShellCompany');
      const score = s.hasSanctionedUbo ? 1.0 : 0;
      return { matched, score };
    },
  },
  {
    id: 'T3',
    name: 'DPMS threshold structuring',
    citation: 'MoE Circular 08/AML/2021 + FDL Art.26-27',
    action: 'escalate',
    check: (s) => {
      const matched: string[] = [];
      if ((s.nearThresholdCount ?? 0) >= 5) matched.push('nearThresholdCount>=5');
      if ((s.counterpartyCount30d ?? 0) >= 10) matched.push('counterpartyCount30d>=10');
      let score = 0;
      if ((s.nearThresholdCount ?? 0) >= 5) score += 0.6;
      if ((s.counterpartyCount30d ?? 0) >= 10) score += 0.4;
      return { matched, score };
    },
  },
  {
    id: 'T4',
    name: 'VASP chain-hopping',
    citation: 'FATF Rec 15 VASP',
    action: 'escalate',
    check: (s) => {
      const matched: string[] = [];
      if (s.isVasp) matched.push('isVasp');
      if ((s.intermediaryCount ?? 0) >= 2) matched.push('intermediaryCount>=2');
      if (s.isHighRiskCountry) matched.push('isHighRiskCountry');
      const score = matched.length / 3;
      return { matched, score };
    },
  },
  {
    id: 'T5',
    name: 'Trade-based money laundering (high-risk goods)',
    citation: 'FATF Rec 20 + MoE Circular 08/AML/2021',
    action: 'flag',
    check: (s) => {
      const matched: string[] = [];
      if (s.isHighRiskGoods) matched.push('isHighRiskGoods');
      if (s.isHighRiskCountry) matched.push('isHighRiskCountry');
      const score = matched.length / 2;
      return { matched, score };
    },
  },
  {
    id: 'T6',
    name: 'BIC stripping / wire obfuscation',
    citation: 'FATF Rec 16',
    action: 'escalate',
    check: (s) => {
      const matched: string[] = [];
      if (s.hasStrippedBic) matched.push('hasStrippedBic');
      const score = s.hasStrippedBic ? 1.0 : 0;
      return { matched, score };
    },
  },
];

// ---------------------------------------------------------------------------
// Matcher
// ---------------------------------------------------------------------------

const ACTION_RANK: Record<TypologyHit['action'], number> = {
  freeze: 2,
  escalate: 1,
  flag: 0,
};

export function matchTypologies(
  signals: TypologySignals,
  policy: Readonly<ClampPolicy> = DEFAULT_CLAMP_POLICY
): TypologyMatchReport {
  const hits: TypologyHit[] = [];
  for (const t of TYPOLOGIES) {
    const { matched, score } = t.check(signals);
    if (score >= policy.typologyMatchThreshold) {
      hits.push({
        id: t.id,
        name: t.name,
        citation: t.citation,
        score,
        matchedSignals: matched,
        action: t.action,
      });
    }
  }
  // Primary sort: score descending. Secondary sort: action severity
  // descending (freeze > escalate > flag). A sanctioned-UBO front company
  // must win the tiebreaker against a shell-layering pattern because the
  // regulatory action is stricter — freeze per Cabinet Res 74/2020 Art.4-7
  // trumps escalate per FATF Rec 10.
  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return ACTION_RANK[b.action] - ACTION_RANK[a.action];
  });

  const topHit = hits[0] ?? null;
  const narrative =
    hits.length === 0
      ? `Sanctions-evasion typology matcher: no typology matches above ${(policy.typologyMatchThreshold * 100).toFixed(0)}% threshold.`
      : `Sanctions-evasion typology matcher: ${hits.length} typology match(es). ` +
        `Top: ${topHit!.id} ${topHit!.name} (score ${(topHit!.score * 100).toFixed(0)}%, action ${topHit!.action}, ${topHit!.citation}).`;

  return { hits, topHit, narrative };
}
