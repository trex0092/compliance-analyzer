/**
 * Regulatory traceability — attach a canonical citation to every hit
 * and every decision so MoE / LBMA auditors can trace the reasoning.
 *
 * This closes a big gap vs. Refinitiv WorldCheck: WC shows you WHAT it
 * matched on, but not WHY that match is regulatorily significant.
 */

export interface RegulatoryCitation {
  instrument: string;
  article: string;
  summary: string;
  retentionYears?: number;
}

export type MatchKind =
  | 'sanctions_un'
  | 'sanctions_ofac'
  | 'sanctions_eu'
  | 'sanctions_uk'
  | 'sanctions_uae'
  | 'pep_direct'
  | 'pep_family'
  | 'pep_kca'
  | 'soe_50pct'
  | 'ubo_25pct'
  | 'adverse_media'
  | 'dual_use_goods'
  | 'crypto_sanctioned_address';

const CITATIONS: Record<MatchKind, RegulatoryCitation> = {
  sanctions_un: {
    instrument: 'UN Security Council Resolutions (1267/1988/1989/2253)',
    article: 'Cabinet Res 74/2020 Art.4-7',
    summary:
      'Asset freeze within 24 clock hours of identification; report to EOCN; file CNMR in 5 business days.',
    retentionYears: 10,
  },
  sanctions_ofac: {
    instrument: 'US OFAC SDN / Consolidated',
    article: 'FDL No.10/2025 Art.35; Cabinet Res 74/2020 Art.4',
    summary:
      'Secondary-sanctions exposure — freeze if nexus to US persons; escalate to CO regardless.',
    retentionYears: 10,
  },
  sanctions_eu: {
    instrument: 'EU CFSP',
    article: 'Cabinet Res 74/2020 Art.4',
    summary: 'Freeze within 24h when a nexus to the Union is present.',
    retentionYears: 10,
  },
  sanctions_uk: {
    instrument: 'UK OFSI',
    article: 'Cabinet Res 74/2020 Art.4',
    summary: 'Freeze within 24h when a UK nexus applies.',
    retentionYears: 10,
  },
  sanctions_uae: {
    instrument: 'UAE EOCN',
    article: 'Cabinet Res 74/2020 Art.4-7',
    summary: 'Mandatory local freeze; CNMR filing with EOCN within 5 business days.',
    retentionYears: 10,
  },
  pep_direct: {
    instrument: 'FATF Rec 12; FDL No.10/2025 Art.13',
    article: 'Cabinet Res 134/2025 Art.14',
    summary: 'EDD required; senior/board approval before onboarding; enhanced ongoing monitoring.',
    retentionYears: 10,
  },
  pep_family: {
    instrument: 'FATF Rec 12',
    article: 'Cabinet Res 134/2025 Art.14',
    summary:
      'EDD required for family member of a PEP (spouse, parent, child, sibling).',
    retentionYears: 10,
  },
  pep_kca: {
    instrument: 'FATF Rec 12',
    article: 'Cabinet Res 134/2025 Art.14',
    summary:
      'EDD required for Known Close Associate (business partner, beneficial owner of shared entity).',
    retentionYears: 10,
  },
  soe_50pct: {
    instrument: 'OFAC 50% Rule; UK OFSI 50% Rule',
    article: 'Cabinet Res 156/2025',
    summary:
      'Entity is 50%+ owned by a state/ sanctioned party — treat as if directly listed.',
    retentionYears: 10,
  },
  ubo_25pct: {
    instrument: 'Cabinet Decision 109/2023',
    article: 'Cabinet Decision 109/2023 Art.4',
    summary:
      'Beneficial owner threshold — identify, verify, and re-verify within 15 working days of change.',
    retentionYears: 10,
  },
  adverse_media: {
    instrument: 'FATF 40+9 predicate offences',
    article: 'FDL No.10/2025 Art.12-14',
    summary:
      'Adverse-media signal mapped to a FATF predicate offence; factor into risk score and EDD.',
    retentionYears: 10,
  },
  dual_use_goods: {
    instrument: 'UAE Federal Law 13/2007 (Strategic Goods); Cabinet Res 156/2025',
    article: 'Cabinet Res 156/2025',
    summary: 'Export-control screening + end-user due-diligence required.',
    retentionYears: 10,
  },
  crypto_sanctioned_address: {
    instrument: 'OFAC SDN crypto list; VARA Rulebook',
    article: 'Cabinet Res 74/2020 Art.4; UAE FDL 4/2002 as amended',
    summary:
      'Blocked address — reject the transaction, freeze any related assets, file CNMR.',
    retentionYears: 10,
  },
};

export function citationFor(kind: MatchKind): RegulatoryCitation {
  return CITATIONS[kind];
}

export function citationForUnknown(): RegulatoryCitation {
  return {
    instrument: 'General AML/CFT framework',
    article: 'FDL No.10/2025 Art.20-21',
    summary: 'Document the rationale and escalate to the Compliance Officer.',
    retentionYears: 10,
  };
}

export function traceabilityBlock(
  kind: MatchKind,
  matchDetail: string
): string {
  const c = citationFor(kind);
  return [
    `${c.instrument} — ${c.article}`,
    c.summary,
    `Match: ${matchDetail}`,
    `Retention: ${c.retentionYears ?? 10} years (FDL Art.24).`,
  ].join('\n');
}

export { CITATIONS };
