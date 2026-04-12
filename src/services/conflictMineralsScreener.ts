/**
 * Conflict Minerals Screener
 *
 * Implements OECD Due Diligence Guidance 5-Step Framework for responsible
 * sourcing of minerals from conflict-affected and high-risk areas (CAHRA).
 *
 * Regulatory basis:
 *   - Dodd-Frank Wall Street Reform Act, Section 1502 (3TG supply-chain disclosure)
 *   - EU Conflict Minerals Regulation 2017/821 (effective 01/01/2021)
 *   - OECD Due Diligence Guidance for Responsible Supply Chains of Minerals (3rd ed., 2016)
 *   - LBMA Responsible Gold Guidance v9 (5-step OECD framework, CAHRA due diligence)
 *   - UAE MoE Responsible Sourcing of Gold (RSG) Framework
 *   - Dubai Good Delivery (DGD) Standard — refiner accreditation requirements
 *
 * For DPMS gold dealers subject to UAE MoE oversight, failure to perform
 * adequate conflict minerals due diligence is an AML/CFT red flag and may
 * attract MoE inspection findings (Cabinet Res 71/2024 Art.3).
 */

// ─── CAHRA Country List ─────────────────────────────────────────────────────
// Source: OECD DDG Annex II + LBMA RGG v9 Appendix A + EU 2017/821 Annex
// Countries where conflict financing through mineral trade is documented.

const CAHRA_COUNTRIES = new Set<string>([
  'CD', // Democratic Republic of Congo — OECD DDG primary exemplar
  'SS', // South Sudan — ongoing conflict (UNSC Res 2428)
  'CF', // Central African Republic — EU/UN embargo
  'SD', // Sudan — Darfur; FATF grey-listed
  'SO', // Somalia — Al-Shabaab extortion of artisanal mining
  'MM', // Myanmar — military junta; Junta-controlled gems/jade
  'AF', // Afghanistan — Taliban taxation of mining
  'YE', // Yemen — Houthi-controlled ports/smuggling
  'ER', // Eritrea — forced labour in mining (ILO reports)
  'RU', // Russia — OFAC/EU/UK sanctions; gold as sanctions evasion
  'IR', // Iran — OFAC sanctions; gold used for sanctions evasion
  'KP', // DPRK — UN Res 2397; gold exports banned
  'SY', // Syria — EU/US sanctions; ISIS gold financing history
  'VE', // Venezuela — OFAC sanctions; illegal Arco Minero mining
  'ZW', // Zimbabwe — FATF grey-listed; ZANU-PF artisanal mining
  'ML', // Mali — Junta; jihadist groups tax artisanal mines
  'NE', // Niger — Junta coup 2023; uranium/gold CAHRA concerns
  'BF', // Burkina Faso — Junta; VDP-linked mine control
  'GN', // Guinea — political instability; artisanal gold
  'LR', // Liberia — FATF monitoring; historical conflict diamonds
  'SL', // Sierra Leone — post-conflict; ongoing ASM risks
]);

// ─── Certifications that meaningfully reduce conflict risk ──────────────────

/** Programmes providing independent third-party supply-chain assurance. */
const STRONG_CERTIFICATIONS = new Set<MineralSupplier['certifications'][number]>([
  'LBMA_RGG', // LBMA Responsible Gold Guidance — annual third-party audit
  'RMI_RMAP',  // Responsible Minerals Initiative — RMAP audit programme
  'ITSCI',     // ITRI Tin Supply Chain Initiative (covers tin, tantalum, tungsten)
]);

const MODERATE_CERTIFICATIONS = new Set<MineralSupplier['certifications'][number]>([
  'IRMA',      // Initiative for Responsible Mining Assurance
  'ASM_GOLD',  // Alliance for Responsible Mining — Fairtrade/Fairmined
  'CRAFT',     // Community-based Responsible Artisanal & Small-scale mining framework
]);

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MineralSupplier {
  supplierId: string;
  name: string;
  countryOfOrigin: string;  // ISO alpha-2
  mineral: 'gold' | 'tin' | 'tantalum' | 'tungsten';
  annualVolumeKg?: number;
  certifications: Array<'LBMA_RGG' | 'RMI_RMAP' | 'ITSCI' | 'CRAFT' | 'ASM_GOLD' | 'IRMA' | 'none'>;
  caharaStatus?: 'confirmed' | 'likely' | 'possible' | 'none';
  lastAuditDate?: string; // ISO 8601 date string
  hasSignedCoC: boolean;   // Chain-of-Custody signed declaration
  hasTraceabilitySystem: boolean;
}

export type ConflictRiskLevel = 'compliant' | 'low' | 'medium' | 'high' | 'critical';

export interface SupplierConflictAssessment {
  supplierId: string;
  riskLevel: ConflictRiskLevel;
  flags: Array<{ code: string; detail: string; citation: string }>;
  requiredActions: string[];
  oecd5StepScore: number; // 0-100
}

export interface ConflictMineralsReport {
  totalSuppliers: number;
  compliantCount: number;
  criticalCount: number;
  highRiskCount: number;
  assessments: SupplierConflictAssessment[];
  overallRisk: ConflictRiskLevel;
  narrative: string;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function auditAgeMonths(lastAuditDate: string | undefined): number | null {
  if (!lastAuditDate) return null;
  const audit = new Date(lastAuditDate);
  if (isNaN(audit.getTime())) return null;
  const now = new Date();
  return (now.getFullYear() - audit.getFullYear()) * 12 +
    (now.getMonth() - audit.getMonth());
}

function hasCertification(
  certs: MineralSupplier['certifications'],
  set: Set<MineralSupplier['certifications'][number]>,
): boolean {
  return certs.some((c) => set.has(c));
}

function hasAnyCertification(certs: MineralSupplier['certifications']): boolean {
  return certs.some((c) => c !== 'none');
}

// ─── OECD 5-Step Scoring ────────────────────────────────────────────────────
// OECD DDG 3rd ed. — five steps scored out of 20 points each = 100 total.
// Step 1: Management systems   (CoC, supplier disclosure policy)
// Step 2: Identify & assess    (CAHRA mapping, risk categorisation)
// Step 3: Design & implement   (response strategy for identified risks)
// Step 4: Independent audit    (third-party audit freshness)
// Step 5: Report publicly      (certification scheme participation = proxy)

function scoreOecd5Step(supplier: MineralSupplier): number {
  let score = 0;

  // Step 1 — Management systems (max 20)
  if (supplier.hasSignedCoC) score += 12;
  if (supplier.hasTraceabilitySystem) score += 8;

  // Step 2 — Risk identification (max 20)
  const isCahra = CAHRA_COUNTRIES.has(supplier.countryOfOrigin);
  const caharaStatus = supplier.caharaStatus ?? 'none';
  if (!isCahra) {
    score += 20; // Non-CAHRA origin passes step 2 fully
  } else if (caharaStatus === 'none' || caharaStatus === 'possible') {
    score += 10; // CAHRA origin but low/unclear status
  } else {
    score += 0; // confirmed/likely CAHRA — failing step 2
  }

  // Step 3 — Risk response (max 20)
  if (hasCertification(supplier.certifications, STRONG_CERTIFICATIONS)) {
    score += 20;
  } else if (hasCertification(supplier.certifications, MODERATE_CERTIFICATIONS)) {
    score += 12;
  } else if (hasAnyCertification(supplier.certifications)) {
    score += 6;
  }

  // Step 4 — Independent audit (max 20)
  const ageMonths = auditAgeMonths(supplier.lastAuditDate);
  if (ageMonths === null) {
    score += 0; // No audit date on record
  } else if (ageMonths <= 12) {
    score += 20;
  } else if (ageMonths <= 18) {
    score += 12;
  } else if (ageMonths <= 24) {
    score += 6;
  }

  // Step 5 — Public reporting proxy via recognised scheme (max 20)
  if (hasCertification(supplier.certifications, STRONG_CERTIFICATIONS)) {
    score += 20;
  } else if (hasCertification(supplier.certifications, MODERATE_CERTIFICATIONS)) {
    score += 10;
  }

  return Math.min(100, score);
}

// ─── Per-supplier assessment ─────────────────────────────────────────────────

function assessSupplier(supplier: MineralSupplier): SupplierConflictAssessment {
  const flags: SupplierConflictAssessment['flags'] = [];
  const requiredActions: string[] = [];
  const isCahra = CAHRA_COUNTRIES.has(supplier.countryOfOrigin);
  const hasStrong = hasCertification(supplier.certifications, STRONG_CERTIFICATIONS);
  const hasModerate = hasCertification(supplier.certifications, MODERATE_CERTIFICATIONS);
  const hasAny = hasAnyCertification(supplier.certifications);
  const ageMonths = auditAgeMonths(supplier.lastAuditDate);
  const caharaStatus = supplier.caharaStatus ?? 'none';

  // Flag: CAHRA origin with no certification at all — critical
  if (isCahra && !hasAny) {
    flags.push({
      code: 'CAHRA_NO_CERT',
      detail: `Supplier origin ${supplier.countryOfOrigin} is a CAHRA country and holds no recognised certification.`,
      citation: 'OECD DDG Step 3; LBMA RGG v9 §4.3; EU Reg 2017/821 Art.5',
    });
    requiredActions.push(
      'Obtain LBMA RGG, RMI RMAP, or ITSCI certification before next procurement cycle.',
    );
  }

  // Flag: Confirmed/likely CAHRA without strong cert
  if (isCahra && (caharaStatus === 'confirmed' || caharaStatus === 'likely') && !hasStrong) {
    flags.push({
      code: 'CONFIRMED_CAHRA_NO_STRONG_CERT',
      detail: `CAHRA status is "${caharaStatus}" but no LBMA_RGG or RMI_RMAP certification is held.`,
      citation: 'LBMA RGG v9 §5.1; OECD DDG Step 3; Dodd-Frank §1502(b)',
    });
    requiredActions.push('Escalate to CO for Enhanced Due Diligence decision on this supplier.');
    requiredActions.push('Require LBMA RGG or RMI RMAP audit within 90 days.');
  }

  // Flag: CAHRA origin without Chain of Custody
  if (isCahra && !supplier.hasSignedCoC) {
    flags.push({
      code: 'CAHRA_NO_COC',
      detail: `Supplier from CAHRA country ${supplier.countryOfOrigin} has not signed a Chain-of-Custody declaration.`,
      citation: 'LBMA RGG v9 §3.2; UAE MoE RSG Framework §2.4; OECD DDG Step 1',
    });
    requiredActions.push('Obtain signed Chain-of-Custody declaration immediately.');
  }

  // Flag: No traceability system
  if (!supplier.hasTraceabilitySystem) {
    flags.push({
      code: 'NO_TRACEABILITY',
      detail: 'Supplier lacks a documented mineral traceability system.',
      citation: 'OECD DDG Step 1; UAE MoE RSG Framework §2.3; LBMA RGG v9 §3.4',
    });
    requiredActions.push(
      'Implement or require documented supply-chain traceability down to mine/country of origin.',
    );
  }

  // Flag: Overdue audit (>12 months)
  if (ageMonths === null) {
    flags.push({
      code: 'NO_AUDIT_RECORD',
      detail: 'No third-party audit date on record for this supplier.',
      citation: 'LBMA RGG v9 §6; OECD DDG Step 4; EU Reg 2017/821 Art.6',
    });
    requiredActions.push('Commission a third-party supply-chain audit within 60 days.');
  } else if (ageMonths > 12) {
    flags.push({
      code: 'OVERDUE_AUDIT',
      detail: `Last audit was ${ageMonths} months ago. LBMA RGG requires annual audits.`,
      citation: 'LBMA RGG v9 §6.1 — annual independent third-party audit required',
    });
    requiredActions.push(`Schedule next audit immediately (${ageMonths - 12} months overdue).`);
  }

  // Flag: Sanctioned/embargoed countries regardless of mineral
  if (['KP', 'IR', 'RU', 'SY'].includes(supplier.countryOfOrigin)) {
    flags.push({
      code: 'SANCTIONS_JURISDICTION',
      detail: `Country ${supplier.countryOfOrigin} is subject to comprehensive trade sanctions affecting precious metals.`,
      citation:
        'Cabinet Res 74/2020 Art.4 (UAE TFS); OFAC SDN; EU Reg 833/2014 (Russia); UNSC Res 2397 (DPRK)',
    });
    requiredActions.push(
      'STOP procurement. Refer immediately to Compliance Officer for TFS screening before any further engagement.',
    );
  }

  const oecd5StepScore = scoreOecd5Step(supplier);

  // Derive risk level from flags and score
  let riskLevel: ConflictRiskLevel;
  const hasCriticalFlag = flags.some((f) =>
    ['CAHRA_NO_CERT', 'SANCTIONS_JURISDICTION'].includes(f.code),
  );
  const hasHighFlag = flags.some((f) =>
    ['CONFIRMED_CAHRA_NO_STRONG_CERT', 'CAHRA_NO_COC'].includes(f.code),
  );

  if (hasCriticalFlag) {
    riskLevel = 'critical';
  } else if (hasHighFlag || oecd5StepScore < 40) {
    riskLevel = 'high';
  } else if (flags.length > 0 || oecd5StepScore < 60) {
    riskLevel = 'medium';
  } else if (oecd5StepScore < 80) {
    riskLevel = 'low';
  } else {
    riskLevel = 'compliant';
  }

  return { supplierId: supplier.supplierId, riskLevel, flags, requiredActions, oecd5StepScore };
}

// ─── Aggregate risk roll-up ──────────────────────────────────────────────────

function rollupRisk(assessments: SupplierConflictAssessment[]): ConflictRiskLevel {
  if (assessments.some((a) => a.riskLevel === 'critical')) return 'critical';
  if (assessments.some((a) => a.riskLevel === 'high')) return 'high';
  if (assessments.some((a) => a.riskLevel === 'medium')) return 'medium';
  if (assessments.some((a) => a.riskLevel === 'low')) return 'low';
  return 'compliant';
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Screen a portfolio of mineral suppliers against conflict-minerals frameworks.
 *
 * Returns a full ConflictMineralsReport with per-supplier assessments,
 * aggregate counts, overall risk level, and a narrative summary suitable
 * for inclusion in an LBMA RGG annual disclosure or MoE audit pack.
 *
 * @param suppliers - Immutable array of supplier profiles to assess.
 * @returns ConflictMineralsReport
 */
export function screenConflictMinerals(
  suppliers: readonly MineralSupplier[],
): ConflictMineralsReport {
  if (suppliers.length === 0) {
    return {
      totalSuppliers: 0,
      compliantCount: 0,
      criticalCount: 0,
      highRiskCount: 0,
      assessments: [],
      overallRisk: 'compliant',
      narrative:
        'No suppliers submitted for screening. Submit supplier profiles to generate a conflict minerals assessment.',
    };
  }

  const assessments = suppliers.map(assessSupplier);
  const compliantCount = assessments.filter((a) => a.riskLevel === 'compliant').length;
  const criticalCount = assessments.filter((a) => a.riskLevel === 'critical').length;
  const highRiskCount = assessments.filter((a) => a.riskLevel === 'high').length;
  const overallRisk = rollupRisk(assessments);
  const avgScore =
    assessments.reduce((sum, a) => sum + a.oecd5StepScore, 0) / assessments.length;

  const criticalNames = suppliers
    .filter((s) => assessments.find((a) => a.supplierId === s.supplierId)?.riskLevel === 'critical')
    .map((s) => s.name);

  let narrative =
    `Conflict minerals screening completed for ${suppliers.length} supplier(s). ` +
    `Overall portfolio risk: ${overallRisk.toUpperCase()}. ` +
    `OECD 5-Step average score: ${avgScore.toFixed(1)}/100. ` +
    `Compliant: ${compliantCount}, High-risk: ${highRiskCount}, Critical: ${criticalCount}.`;

  if (criticalCount > 0) {
    narrative +=
      ` CRITICAL suppliers requiring immediate CO escalation: ${criticalNames.join(', ')}.` +
      ' Suspend procurement from critical suppliers pending Enhanced Due Diligence outcomes.' +
      ' (LBMA RGG v9 §5.1; UAE MoE RSG Framework §3.2)';
  } else if (highRiskCount > 0) {
    narrative +=
      ' High-risk suppliers require Enhanced Due Diligence and CO approval before next purchase order.' +
      ' (OECD DDG Step 3; LBMA RGG v9 §4.3)';
  } else if (overallRisk === 'medium') {
    narrative +=
      ' Medium-risk items require corrective action plans within 30 days. (OECD DDG Step 3)';
  } else {
    narrative += ' Portfolio meets baseline OECD DDG and LBMA RGG sourcing standards.';
  }

  return {
    totalSuppliers: suppliers.length,
    compliantCount,
    criticalCount,
    highRiskCount,
    assessments,
    overallRisk,
    narrative,
  };
}
