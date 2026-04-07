/**
 * Cross-Entity Screening — Detect shared customers, UBOs, and counterparties
 * across the 6 group companies.
 *
 * MoE inspectors check for:
 * - Same customer appearing at multiple entities without disclosure
 * - Shared UBOs across supposedly independent companies
 * - Counterparty relationships that create circular risk
 *
 * Uses normalized name matching (same as sanctionsApi.ts) to catch variations.
 */

import type { CustomerProfile, UBORecord } from '../domain/customers';

export interface CrossEntityMatch {
  type: 'shared-customer' | 'shared-ubo' | 'counterparty-link';
  entity1: { companyId: string; companyName: string };
  entity2: { companyId: string; companyName: string };
  matchedName: string;
  matchedName2?: string;
  confidence: number;
  riskImplication: string;
  regulatoryRef: string;
}

export interface CrossEntityReport {
  scannedAt: string;
  companiesScanned: number;
  customersScanned: number;
  ubosScanned: number;
  matches: CrossEntityMatch[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .replace(
      /\b(llc|ltd|fze|fzc|fzco|inc|corp|plc|pvt|pty|gmbh|sarl|srl|ag|sa|bv|nv|anonim|sirketi|trading|jewellery|jewelry|precious|metals|gold)\b/g,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigramsA = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2));
  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    if (bigramsA.has(b.slice(i, i + 2))) intersection++;
  }
  return (2 * intersection) / (a.length - 1 + b.length - 1);
}

/**
 * Scan for shared customers across companies.
 * Compares customer names with fuzzy matching.
 */
export function detectSharedCustomers(
  companyCustomerMap: Map<string, { companyName: string; customers: CustomerProfile[] }>
): CrossEntityMatch[] {
  const matches: CrossEntityMatch[] = [];
  const companies = Array.from(companyCustomerMap.entries());

  for (let i = 0; i < companies.length; i++) {
    for (let j = i + 1; j < companies.length; j++) {
      const [compId1, data1] = companies[i];
      const [compId2, data2] = companies[j];

      for (const c1 of data1.customers) {
        const norm1 = normalize(c1.legalName);
        for (const c2 of data2.customers) {
          const norm2 = normalize(c2.legalName);
          const score = similarity(norm1, norm2);

          if (score >= 0.8) {
            matches.push({
              type: 'shared-customer',
              entity1: { companyId: compId1, companyName: data1.companyName },
              entity2: { companyId: compId2, companyName: data2.companyName },
              matchedName: c1.legalName,
              matchedName2: c2.legalName,
              confidence: Math.round(score * 100) / 100,
              riskImplication:
                'Same customer at multiple entities may indicate structuring or layering. Verify CDD consistency.',
              regulatoryRef: 'FDL No.10/2025 Art.15-16, Cabinet Res 134/2025 Art.9',
            });
          }
        }
      }
    }
  }

  return matches;
}

/**
 * Scan for shared UBOs across companies.
 * A UBO appearing in multiple unrelated entities is a red flag.
 */
export function detectSharedUBOs(
  companyUBOMap: Map<string, { companyName: string; ubos: UBORecord[] }>
): CrossEntityMatch[] {
  const matches: CrossEntityMatch[] = [];
  const companies = Array.from(companyUBOMap.entries());

  for (let i = 0; i < companies.length; i++) {
    for (let j = i + 1; j < companies.length; j++) {
      const [compId1, data1] = companies[i];
      const [compId2, data2] = companies[j];

      // Skip companies in the same group (shared UBO is expected)
      // Group detection would need groupId — caller should filter

      for (const u1 of data1.ubos) {
        const norm1 = normalize(u1.fullName);
        for (const u2 of data2.ubos) {
          const norm2 = normalize(u2.fullName);
          const score = similarity(norm1, norm2);

          if (score >= 0.85) {
            matches.push({
              type: 'shared-ubo',
              entity1: { companyId: compId1, companyName: data1.companyName },
              entity2: { companyId: compId2, companyName: data2.companyName },
              matchedName: u1.fullName,
              matchedName2: u2.fullName,
              confidence: Math.round(score * 100) / 100,
              riskImplication:
                'Shared beneficial owner across entities. Verify if entities are genuinely independent. Check for nominee/shell structures.',
              regulatoryRef: 'Cabinet Decision 109/2023, FDL Art.12-14',
            });
          }
        }
      }
    }
  }

  return matches;
}

/**
 * Run full cross-entity scan — customers + UBOs.
 */
export function runCrossEntityScan(
  companyCustomerMap: Map<string, { companyName: string; customers: CustomerProfile[] }>,
  companyUBOMap: Map<string, { companyName: string; ubos: UBORecord[] }>
): CrossEntityReport {
  const customerMatches = detectSharedCustomers(companyCustomerMap);
  const uboMatches = detectSharedUBOs(companyUBOMap);
  const allMatches = [...customerMatches, ...uboMatches];

  let totalCustomers = 0;
  let totalUBOs = 0;
  for (const [, data] of companyCustomerMap) totalCustomers += data.customers.length;
  for (const [, data] of companyUBOMap) totalUBOs += data.ubos.length;

  const highConfidence = allMatches.filter((m) => m.confidence >= 0.95).length;
  const riskLevel =
    highConfidence >= 3
      ? 'critical'
      : highConfidence >= 1
        ? 'high'
        : allMatches.length > 0
          ? 'medium'
          : 'low';

  return {
    scannedAt: new Date().toISOString(),
    companiesScanned: companyCustomerMap.size,
    customersScanned: totalCustomers,
    ubosScanned: totalUBOs,
    matches: allMatches,
    riskLevel,
  };
}
