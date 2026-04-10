/**
 * Penalty Exposure Calculator — Cabinet Resolution 71/2024.
 *
 * UAE AML/CFT administrative penalty ranges for DPMS. Each violation
 * type has a [min, max] band (AED). This module:
 *
 *   - enumerates the penalty-bearing violations
 *   - exposes calculateExposure() to tot up a firm's current exposure
 *     based on a list of open findings
 *   - produces a management-ready report
 *
 * Regulatory basis: Cabinet Res 71/2024 (AED 10K-100M range),
 * FDL No.10/2025 Art.34 (administrative penalties).
 *
 * The penalty ranges below are based on Cabinet Res 71/2024 and the
 * MoE 08/AML/2021 circular. Values should be verified against the
 * current gazette before production use.
 */

// ---------------------------------------------------------------------------
// Violation catalogue
// ---------------------------------------------------------------------------

export type ViolationCode =
  | 'CO_NOT_APPOINTED'
  | 'CO_NOT_NOTIFIED'
  | 'POLICY_NOT_APPROVED'
  | 'EWRA_MISSING'
  | 'CDD_NOT_DOCUMENTED'
  | 'EDD_NOT_APPLIED'
  | 'UBO_NOT_IDENTIFIED'
  | 'ONGOING_MONITORING_MISSING'
  | 'PEP_NOT_SCREENED'
  | 'SANCTIONS_NOT_SCREENED'
  | 'SANCTIONS_FREEZE_LATE'
  | 'CNMR_LATE'
  | 'STR_LATE'
  | 'STR_NOT_FILED'
  | 'CTR_NOT_FILED'
  | 'DPMSR_NOT_FILED'
  | 'GOAML_NOT_REGISTERED'
  | 'RECORDS_NOT_RETAINED'
  | 'TIPPING_OFF'
  | 'TRAINING_NOT_CONDUCTED'
  | 'INDEPENDENT_AUDIT_MISSING'
  | 'RISK_APPETITE_MISSING';

export interface PenaltyBand {
  code: ViolationCode;
  area: string;
  description: string;
  minAED: number;
  maxAED: number;
  /** Regulatory citation. */
  regulatory: string;
  /** If true, the offence can lead to criminal referral, not just fines. */
  criminal: boolean;
}

export const PENALTY_CATALOGUE: PenaltyBand[] = [
  // Governance
  {
    code: 'CO_NOT_APPOINTED',
    area: 'Governance',
    description: 'Compliance Officer not appointed or not registered with MoE',
    minAED: 100_000,
    maxAED: 1_000_000,
    regulatory: 'FDL Art.20; Cabinet Res 134/2025 Art.18',
    criminal: false,
  },
  {
    code: 'CO_NOT_NOTIFIED',
    area: 'Governance',
    description: 'CO change not notified within 15 days',
    minAED: 50_000,
    maxAED: 500_000,
    regulatory: 'Cabinet Res 134/2025 Art.18',
    criminal: false,
  },
  {
    code: 'POLICY_NOT_APPROVED',
    area: 'Governance',
    description: 'AML/CFT policy not approved by the Board',
    minAED: 50_000,
    maxAED: 500_000,
    regulatory: 'FDL Art.21; Cabinet Res 134/2025 Art.5',
    criminal: false,
  },
  {
    code: 'INDEPENDENT_AUDIT_MISSING',
    area: 'Governance',
    description: 'Independent AML audit not conducted in the last 12 months',
    minAED: 100_000,
    maxAED: 1_000_000,
    regulatory: 'Cabinet Res 134/2025 Art.19',
    criminal: false,
  },
  {
    code: 'RISK_APPETITE_MISSING',
    area: 'Governance',
    description: 'Board-approved risk appetite statement missing',
    minAED: 50_000,
    maxAED: 500_000,
    regulatory: 'Cabinet Res 134/2025 Art.5',
    criminal: false,
  },
  // Risk assessment
  {
    code: 'EWRA_MISSING',
    area: 'Risk Assessment',
    description: 'Entity-wide risk assessment not conducted or not updated',
    minAED: 200_000,
    maxAED: 2_000_000,
    regulatory: 'FDL Art.6; Cabinet Res 134/2025 Art.5',
    criminal: false,
  },
  // CDD
  {
    code: 'CDD_NOT_DOCUMENTED',
    area: 'CDD',
    description: 'CDD procedures not documented or not implemented',
    minAED: 100_000,
    maxAED: 1_000_000,
    regulatory: 'FDL Art.12-14',
    criminal: false,
  },
  {
    code: 'EDD_NOT_APPLIED',
    area: 'CDD',
    description: 'EDD not applied to high-risk customers',
    minAED: 200_000,
    maxAED: 2_000_000,
    regulatory: 'Cabinet Res 134/2025 Art.14',
    criminal: false,
  },
  {
    code: 'UBO_NOT_IDENTIFIED',
    area: 'CDD',
    description: 'Beneficial owners not identified at 25% threshold',
    minAED: 200_000,
    maxAED: 2_000_000,
    regulatory: 'Cabinet Decision 109/2023',
    criminal: false,
  },
  {
    code: 'ONGOING_MONITORING_MISSING',
    area: 'CDD',
    description: 'Ongoing monitoring of business relationships missing',
    minAED: 100_000,
    maxAED: 1_000_000,
    regulatory: 'FDL Art.13; FATF Rec.10',
    criminal: false,
  },
  {
    code: 'PEP_NOT_SCREENED',
    area: 'CDD',
    description: 'PEP screening not conducted',
    minAED: 100_000,
    maxAED: 1_000_000,
    regulatory: 'FDL Art.14',
    criminal: false,
  },
  // TFS
  {
    code: 'SANCTIONS_NOT_SCREENED',
    area: 'TFS',
    description: 'Sanctions screening not conducted against all six lists',
    minAED: 500_000,
    maxAED: 5_000_000,
    regulatory: 'Cabinet Res 74/2020 Art.4',
    criminal: false,
  },
  {
    code: 'SANCTIONS_FREEZE_LATE',
    area: 'TFS',
    description: 'Asset freeze not executed within 24 hours',
    minAED: 1_000_000,
    maxAED: 10_000_000,
    regulatory: 'Cabinet Res 74/2020 Art.4',
    criminal: true,
  },
  {
    code: 'CNMR_LATE',
    area: 'TFS',
    description: 'CNMR not filed to EOCN within 5 business days',
    minAED: 200_000,
    maxAED: 2_000_000,
    regulatory: 'Cabinet Res 74/2020 Art.5',
    criminal: false,
  },
  // STR / CTR
  {
    code: 'STR_LATE',
    area: 'Filing',
    description: 'STR not filed without delay',
    minAED: 500_000,
    maxAED: 5_000_000,
    regulatory: 'FDL Art.26-27',
    criminal: false,
  },
  {
    code: 'STR_NOT_FILED',
    area: 'Filing',
    description: 'STR not filed when suspicion existed',
    minAED: 1_000_000,
    maxAED: 50_000_000,
    regulatory: 'FDL Art.26-27',
    criminal: true,
  },
  {
    code: 'CTR_NOT_FILED',
    area: 'Filing',
    description: 'CTR not filed for cash transactions >= AED 55K',
    minAED: 200_000,
    maxAED: 2_000_000,
    regulatory: 'FDL Art.16; MoE 08/AML/2021',
    criminal: false,
  },
  {
    code: 'DPMSR_NOT_FILED',
    area: 'Filing',
    description: 'DPMS quarterly report not filed to MoE',
    minAED: 200_000,
    maxAED: 2_000_000,
    regulatory: 'MoE 08/AML/2021',
    criminal: false,
  },
  {
    code: 'GOAML_NOT_REGISTERED',
    area: 'Filing',
    description: 'Entity not registered with goAML',
    minAED: 100_000,
    maxAED: 1_000_000,
    regulatory: 'FDL Art.25',
    criminal: false,
  },
  // Records
  {
    code: 'RECORDS_NOT_RETAINED',
    area: 'Records',
    description: 'Records not retained for the 5-year minimum',
    minAED: 100_000,
    maxAED: 1_000_000,
    regulatory: 'FDL Art.24',
    criminal: false,
  },
  // Tipping off
  {
    code: 'TIPPING_OFF',
    area: 'Confidentiality',
    description: 'Subject was informed of an STR / investigation',
    minAED: 500_000,
    maxAED: 5_000_000,
    regulatory: 'FDL Art.29',
    criminal: true,
  },
  // Training
  {
    code: 'TRAINING_NOT_CONDUCTED',
    area: 'Training',
    description: 'AML/CFT training not conducted for all staff',
    minAED: 50_000,
    maxAED: 500_000,
    regulatory: 'FDL Art.21; Cabinet Res 134/2025',
    criminal: false,
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

const BY_CODE = new Map(PENALTY_CATALOGUE.map((p) => [p.code, p]));

export function lookupPenalty(code: ViolationCode): PenaltyBand | null {
  return BY_CODE.get(code) ?? null;
}

// ---------------------------------------------------------------------------
// Exposure calculation
// ---------------------------------------------------------------------------

export interface Finding {
  code: ViolationCode;
  /** Free-text detail. */
  detail: string;
  /** Estimated severity within the band: 0 = min, 1 = max. */
  severityFactor?: number;
}

export interface ExposureSummary {
  totalMinAED: number;
  totalMaxAED: number;
  totalExpectedAED: number;
  findingsCount: number;
  criminalReferrals: number;
  byArea: Record<string, { count: number; minAED: number; maxAED: number }>;
  lineItems: Array<{
    finding: Finding;
    band: PenaltyBand;
    expectedAED: number;
  }>;
}

export function calculateExposure(findings: readonly Finding[]): ExposureSummary {
  let totalMin = 0;
  let totalMax = 0;
  let totalExpected = 0;
  let criminalReferrals = 0;
  const byArea: Record<string, { count: number; minAED: number; maxAED: number }> = {};
  const lineItems: ExposureSummary['lineItems'] = [];

  for (const finding of findings) {
    const band = lookupPenalty(finding.code);
    if (!band) continue;
    totalMin += band.minAED;
    totalMax += band.maxAED;
    const factor = Math.max(0, Math.min(1, finding.severityFactor ?? 0.5));
    const expected = band.minAED + (band.maxAED - band.minAED) * factor;
    totalExpected += expected;

    if (band.criminal) criminalReferrals++;
    const area = byArea[band.area] ?? { count: 0, minAED: 0, maxAED: 0 };
    area.count++;
    area.minAED += band.minAED;
    area.maxAED += band.maxAED;
    byArea[band.area] = area;

    lineItems.push({ finding, band, expectedAED: Math.round(expected) });
  }

  return {
    totalMinAED: totalMin,
    totalMaxAED: totalMax,
    totalExpectedAED: Math.round(totalExpected),
    findingsCount: findings.length,
    criminalReferrals,
    byArea,
    lineItems,
  };
}

/** Format an exposure summary as a one-page Markdown brief for the MLRO. */
export function formatExposureReport(exposure: ExposureSummary): string {
  const lines: string[] = [];
  lines.push('# Penalty Exposure Report');
  lines.push('');
  lines.push(`**Findings:** ${exposure.findingsCount}  `);
  lines.push(`**Min exposure:** AED ${exposure.totalMinAED.toLocaleString()}  `);
  lines.push(`**Max exposure:** AED ${exposure.totalMaxAED.toLocaleString()}  `);
  lines.push(`**Expected:** AED ${exposure.totalExpectedAED.toLocaleString()}  `);
  lines.push(`**Criminal referrals:** ${exposure.criminalReferrals}`);
  lines.push('');
  lines.push('## By area');
  lines.push('| Area | Count | Min (AED) | Max (AED) |');
  lines.push('|---|---|---|---|');
  for (const [area, data] of Object.entries(exposure.byArea)) {
    lines.push(
      `| ${area} | ${data.count} | ${data.minAED.toLocaleString()} | ${data.maxAED.toLocaleString()} |`,
    );
  }
  lines.push('');
  lines.push('## Line items');
  lines.push('| Code | Description | Min | Max | Criminal | Detail |');
  lines.push('|---|---|---|---|---|---|');
  for (const li of exposure.lineItems) {
    lines.push(
      `| ${li.band.code} | ${li.band.description} | ${li.band.minAED.toLocaleString()} | ${li.band.maxAED.toLocaleString()} | ${li.band.criminal ? 'YES' : 'no'} | ${li.finding.detail} |`,
    );
  }
  return lines.join('\n');
}
