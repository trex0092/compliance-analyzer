/**
 * Cross-Border Arbitrage Detector — subsystem #65 (Phase 7 Cluster G).
 *
 * Flags the "same customer, multiple jurisdictions" pattern that falls
 * between the cracks of two compliance regimes. Classic examples:
 *
 *   - Same UBO trading through UAE mainland AND DIFC (two different
 *     AML regulators, but same beneficial owner)
 *   - Same natural person owning entities in UAE AND Singapore /
 *     Hong Kong / Switzerland
 *   - Same shell structure using UAE for structuring and another
 *     jurisdiction for integration
 *
 * Pure function. Takes a list of CustomerFootprint records
 * (per-jurisdiction entities for a single canonical identity from
 * entityResolver) and flags multi-jurisdictional exposure.
 *
 * Regulatory basis:
 *   - FATF Rec 10 (CDD on the correct identity across entities)
 *   - Cabinet Decision 109/2023 (UBO visibility across structures)
 *   - FDL No.10/2025 Art.12-14 (risk-based CDD per jurisdiction)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CustomerFootprint {
  canonicalId: string;
  entityId: string;
  jurisdiction: string; // ISO-3166 or free-zone code (e.g. 'AE', 'DIFC', 'ADGM', 'SG')
  entityType: 'individual' | 'legal_entity';
  registeredAt: string;
}

export interface ArbitrageHit {
  canonicalId: string;
  jurisdictions: readonly string[];
  entityIds: readonly string[];
  score: number; // 0-1
  reason: string;
}

export interface ArbitrageReport {
  hits: ArbitrageHit[];
  totalCustomersChecked: number;
  narrative: string;
}

// ---------------------------------------------------------------------------
// Jurisdiction risk pairs — each pair has a "suspicion weight" when
// the same canonical identity appears in both.
// ---------------------------------------------------------------------------

const JURISDICTION_PAIR_WEIGHTS: ReadonlyArray<{
  pair: [string, string];
  weight: number;
  reason: string;
}> = [
  // UAE mainland + DIFC: two regulators, potential arbitrage between them.
  { pair: ['AE', 'DIFC'], weight: 0.5, reason: 'UAE mainland + DIFC (dual regulator exposure)' },
  { pair: ['AE', 'ADGM'], weight: 0.5, reason: 'UAE mainland + ADGM (dual regulator exposure)' },
  // UAE + high-secrecy jurisdictions: common structuring pattern.
  { pair: ['AE', 'CH'], weight: 0.6, reason: 'UAE + Switzerland (high-secrecy jurisdiction)' },
  { pair: ['AE', 'SG'], weight: 0.5, reason: 'UAE + Singapore (DPMS hub overlap)' },
  { pair: ['AE', 'HK'], weight: 0.5, reason: 'UAE + Hong Kong (DPMS hub overlap)' },
  // UAE + FATF grey/black:
  { pair: ['AE', 'PK'], weight: 0.7, reason: 'UAE + Pakistan (FATF grey list history)' },
  { pair: ['AE', 'TR'], weight: 0.7, reason: 'UAE + Turkey (FATF grey list history)' },
  { pair: ['AE', 'PA'], weight: 0.6, reason: 'UAE + Panama (ICIJ exposure)' },
];

function buildPairWeight(
  jurs: readonly string[]
): { score: number; reason: string } {
  let maxScore = 0;
  let reason = `${jurs.length} jurisdictions`;
  for (let i = 0; i < jurs.length; i++) {
    for (let j = i + 1; j < jurs.length; j++) {
      const hit = JURISDICTION_PAIR_WEIGHTS.find(
        ({ pair }) =>
          (pair[0] === jurs[i] && pair[1] === jurs[j]) ||
          (pair[0] === jurs[j] && pair[1] === jurs[i])
      );
      if (hit && hit.weight > maxScore) {
        maxScore = hit.weight;
        reason = hit.reason;
      }
    }
  }
  // Generic multi-jurisdictional exposure also has some weight even
  // when no listed pair matches.
  if (jurs.length >= 3 && maxScore === 0) {
    maxScore = 0.3;
    reason = `${jurs.length} jurisdictions (generic exposure)`;
  }
  return { score: maxScore, reason };
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export function detectCrossBorderArbitrage(
  footprints: readonly CustomerFootprint[]
): ArbitrageReport {
  const byCanonical = new Map<string, CustomerFootprint[]>();
  for (const fp of footprints) {
    const list = byCanonical.get(fp.canonicalId) ?? [];
    list.push(fp);
    byCanonical.set(fp.canonicalId, list);
  }

  const hits: ArbitrageHit[] = [];
  for (const [canonicalId, group] of byCanonical) {
    const jurisdictions = Array.from(new Set(group.map((g) => g.jurisdiction)));
    if (jurisdictions.length < 2) continue;
    const { score, reason } = buildPairWeight(jurisdictions);
    if (score > 0) {
      hits.push({
        canonicalId,
        jurisdictions,
        entityIds: group.map((g) => g.entityId),
        score,
        reason,
      });
    }
  }
  hits.sort((a, b) => b.score - a.score);

  const narrative =
    hits.length === 0
      ? `Cross-border arbitrage: no multi-jurisdiction exposure across ${byCanonical.size} canonical identity/identities.`
      : `Cross-border arbitrage: ${hits.length} canonical identity/identities span multiple jurisdictions. ` +
        `Top: ${hits[0].canonicalId} (${hits[0].reason}, score ${hits[0].score}).`;

  return {
    hits,
    totalCustomersChecked: byCanonical.size,
    narrative,
  };
}
