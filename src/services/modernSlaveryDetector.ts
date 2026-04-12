/**
 * Modern Slavery & Forced Labour Risk Detector
 *
 * Implements ILO's 11 indicators of forced labour and maps supply-chain
 * workforce profiles to risk ratings for DPMS precious-metals dealers.
 *
 * Regulatory basis:
 *   - UAE Federal Law No. 51/2006 on Combating Human Trafficking (as amended)
 *   - ILO Convention C29 — Forced Labour Convention (1930)
 *   - ILO Convention C105 — Abolition of Forced Labour Convention (1957)
 *   - ILO Convention C182 — Worst Forms of Child Labour (1999)
 *   - ILO Special Action Programme (SAP-FL) — Indicators of Forced Labour (2012)
 *   - UK Modern Slavery Act 2015 (s.54 transparency in supply chains)
 *   - FATF Report on Human Trafficking 2018 (financial red flags)
 *   - LBMA Responsible Gold Guidance v9 — ASM labour standards (§7)
 *   - UAE MoE RSG Framework — responsible sourcing (labour provisions §3.3)
 */

// ─── High-risk countries for modern slavery / forced labour ─────────────────
// Source: Walk Free Global Slavery Index 2023 + ILO + US DoS TIP Report 2023

const HIGH_RISK_COUNTRIES = new Set<string>([
  'KP', // DPRK — state-sponsored forced labour (UN Panel of Experts)
  'ER', // Eritrea — national service forced labour (ILO report 2019)
  'BD', // Bangladesh — garment/shrimp sector; recruitment debt bondage
  'PK', // Pakistan — brick kilns, agriculture peonage
  'NP', // Nepal — foreign migrant worker recruitment abuses
  'KH', // Cambodia — forced labour in fishing, construction
  'MM', // Myanmar — military-ordered forced labour (ILO Art. 33 action)
  'LA', // Laos — Special Economic Zones, gambling compounds
  'QA', // Qatar — kafala system (FIFA World Cup scrutiny; reforms ongoing)
  'AE', // UAE — construction/domestic worker sectors under kafala
  'KW', // Kuwait — domestic workers; kafala restrictions on movement
  'BH', // Bahrain — kafala system; migrant worker reports
  'OM', // Oman — kafala; domestic worker sector
  'SA', // Saudi Arabia — kafala; domestic workers; Vision 2030 reforms ongoing
  'TH', // Thailand — fishing industry; ILO ship-to-shore reports
  'IN', // India — bonded labour in brick kilns, agriculture, quarrying
  'NG', // Nigeria — child labour in artisanal mining (LBMA flag)
  'CD', // DRC — artisanal cobalt/gold mining; child labour (UN reports)
  'ET', // Ethiopia — domestic workers in Gulf states; internal bonded labour
  'PH', // Philippines — overseas recruitment abuses; domestic labour
]);

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WorkforceProfile {
  entityId: string;
  sector: string;
  countryOfOperations: string[]; // ISO alpha-2
  totalWorkers?: number;
  migrantWorkerPct?: number;        // 0-100
  recruitmentFeesPaid?: boolean;    // workers paying recruitment fees = red flag
  passportsHeld?: boolean;          // employer retaining passports = red flag
  freedomOfMovement?: boolean;      // workers can leave freely (true = safe)
  overtimeHours?: number;           // average hours/week
  minimumWageCompliant?: boolean;
  paySlipsProvided?: boolean;
  independentAuditConducted?: boolean;
  lastAuditDate?: string;           // ISO 8601
  grievanceMechanismOperational?: boolean;
  subcontractorsAudited?: boolean;
}

export interface SlaveryFinding {
  indicator: string;        // ILO forced labour indicator name
  iloIndicatorId: number;   // 1-11 per ILO SAP-FL framework
  severity: 'critical' | 'high' | 'medium';
  detail: string;
  citation: string;
}

export interface ModernSlaveryReport {
  entityId: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  iloIndicatorsTriggered: number; // count of 11 ILO indicators
  findings: SlaveryFinding[];
  requiresEnhancedDueDiligence: boolean;
  requiresImmediateAction: boolean;
  narrative: string;
}

// ─── ILO Indicator Assessment Functions ─────────────────────────────────────
// Each returns a SlaveryFinding or null. Numbering per ILO SAP-FL (2012).

function checkIndicator1_AbuseOfVulnerability(p: WorkforceProfile): SlaveryFinding | null {
  // Proxy: high migrant worker percentage in high-risk country without audit
  const highRiskOps = p.countryOfOperations.some((c) => HIGH_RISK_COUNTRIES.has(c));
  const highMigrant = (p.migrantWorkerPct ?? 0) > 40;
  if (highRiskOps && highMigrant && !p.independentAuditConducted) {
    return {
      indicator: 'Abuse of vulnerability',
      iloIndicatorId: 1,
      severity: 'high',
      detail: `High migrant-worker concentration (${p.migrantWorkerPct}%) in high-risk jurisdiction without independent audit raises vulnerability-abuse risk.`,
      citation: 'ILO SAP-FL Indicator 1; ILO C29 Art.2; UK MSA 2015 s.54',
    };
  }
  return null;
}

function checkIndicator2_Deception(p: WorkforceProfile): SlaveryFinding | null {
  // Proxy: recruitment fees paid by workers often implies deceptive job offers
  if (p.recruitmentFeesPaid === true) {
    return {
      indicator: 'Deception',
      iloIndicatorId: 2,
      severity: 'high',
      detail:
        'Workers paying recruitment fees is a strong proxy for deceptive recruitment practices. ' +
        'Workers may have been promised different conditions than received (ILO operational definition).',
      citation:
        'ILO SAP-FL Indicator 2; ILO General Principles on Fair Recruitment §9; FATF HT Report 2018 §3.2',
    };
  }
  return null;
}

function checkIndicator3_RestrictionOfMovement(p: WorkforceProfile): SlaveryFinding | null {
  if (p.freedomOfMovement === false) {
    return {
      indicator: 'Restriction of movement',
      iloIndicatorId: 3,
      severity: 'critical',
      detail:
        'Workers are unable to leave freely. Restriction of movement is a primary ILO forced-labour indicator.',
      citation:
        'ILO SAP-FL Indicator 3; ILO C29 Art.2(1); UAE Federal Law 51/2006 Art.1 (confinement)',
    };
  }
  return null;
}

function checkIndicator4_Isolation(p: WorkforceProfile): SlaveryFinding | null {
  // Proxy: high migrant % + passport retention → social isolation
  const highMigrant = (p.migrantWorkerPct ?? 0) > 50;
  if (highMigrant && p.passportsHeld === true && !p.grievanceMechanismOperational) {
    return {
      indicator: 'Isolation',
      iloIndicatorId: 4,
      severity: 'high',
      detail:
        'High migrant-worker concentration combined with document retention and no grievance mechanism ' +
        'creates conditions of worker isolation from support networks.',
      citation:
        'ILO SAP-FL Indicator 4; ILO C29; UAE Federal Law 51/2006 Art.2 (exploitation); LBMA RGG v9 §7.4',
    };
  }
  return null;
}

function checkIndicator5_PhysicalViolence(p: WorkforceProfile): SlaveryFinding | null {
  // Cannot be directly assessed from workforce profile data — flag if sector
  // is artisanal mining in known violent CAHRA countries with no audit.
  const violentMiningCountries = new Set(['CD', 'MM', 'NG', 'SS', 'CF']);
  const isRiskyMining =
    p.sector.toLowerCase().includes('mining') &&
    p.countryOfOperations.some((c) => violentMiningCountries.has(c));
  if (isRiskyMining && !p.independentAuditConducted) {
    return {
      indicator: 'Physical and sexual violence',
      iloIndicatorId: 5,
      severity: 'high',
      detail:
        'Artisanal mining operations in conflict-affected jurisdictions have documented histories of ' +
        'physical coercion and sexual violence. No independent audit on record to rule this out.',
      citation:
        'ILO SAP-FL Indicator 5; UN Panel of Experts (CD) 2023; LBMA RGG v9 §7.5 (ASM violence risk)',
    };
  }
  return null;
}

function checkIndicator6_IntimidationAndThreats(p: WorkforceProfile): SlaveryFinding | null {
  // Proxy: no grievance mechanism + no freedom of movement = threats may be suppressed
  if (p.grievanceMechanismOperational === false && p.freedomOfMovement === false) {
    return {
      indicator: 'Intimidation and threats',
      iloIndicatorId: 6,
      severity: 'critical',
      detail:
        'Absence of an operational grievance mechanism combined with restricted movement strongly ' +
        'suggests threats or intimidation are used to prevent workers from raising concerns.',
      citation:
        'ILO SAP-FL Indicator 6; ILO C29 Art.2; UAE Federal Law 51/2006 Art.2(7) (threat as exploitation)',
    };
  }
  return null;
}

function checkIndicator7_DocumentRetention(p: WorkforceProfile): SlaveryFinding | null {
  if (p.passportsHeld === true) {
    return {
      indicator: 'Retention of identity documents',
      iloIndicatorId: 7,
      severity: 'critical',
      detail:
        'Employer retaining worker passports or identity documents is a per-se forced labour indicator ' +
        'under ILO standards and constitutes an offence under UAE Federal Law 51/2006.',
      citation:
        'ILO SAP-FL Indicator 7; UAE Federal Law 51/2006 Art.2; ILO C29 Art.2; UK MSA 2015 s.3(6)',
    };
  }
  return null;
}

function checkIndicator8_WithholdingOfWages(p: WorkforceProfile): SlaveryFinding | null {
  const wageIssues =
    p.minimumWageCompliant === false || p.paySlipsProvided === false;
  if (wageIssues) {
    const details: string[] = [];
    if (p.minimumWageCompliant === false) details.push('wages below legal minimum');
    if (p.paySlipsProvided === false) details.push('no payslips provided (concealment of wage deductions)');
    return {
      indicator: 'Withholding of wages',
      iloIndicatorId: 8,
      severity: p.minimumWageCompliant === false ? 'critical' : 'high',
      detail: `Wage withholding indicators detected: ${details.join('; ')}.`,
      citation:
        'ILO SAP-FL Indicator 8; ILO C95 (Protection of Wages); UAE Labour Law Federal Decree 33/2021 Art.27; LBMA RGG v9 §7.3',
    };
  }
  return null;
}

function checkIndicator9_DebtBondage(p: WorkforceProfile): SlaveryFinding | null {
  // Recruitment fees + wage issues together = debt bondage pattern
  if (p.recruitmentFeesPaid === true && p.minimumWageCompliant === false) {
    return {
      indicator: 'Debt bondage',
      iloIndicatorId: 9,
      severity: 'critical',
      detail:
        'Combination of worker-paid recruitment fees and below-minimum wages creates classic debt bondage: ' +
        'workers cannot repay recruitment debt on insufficient wages.',
      citation:
        'ILO SAP-FL Indicator 9; Supplementary Convention on Slavery 1956 Art.1(a); ' +
        'UAE Federal Law 51/2006 Art.2; FATF HT Report 2018 §3.3 (debt bondage typology)',
    };
  }
  return null;
}

function checkIndicator10_AbusiveWorkingConditions(p: WorkforceProfile): SlaveryFinding | null {
  const highRiskOps = p.countryOfOperations.some((c) => HIGH_RISK_COUNTRIES.has(c));
  if (highRiskOps && p.subcontractorsAudited === false && !p.independentAuditConducted) {
    return {
      indicator: 'Abusive working and living conditions',
      iloIndicatorId: 10,
      severity: 'medium',
      detail:
        'Operations in high-risk jurisdiction with unaudited subcontractors. ' +
        'Abusive living/working conditions in subcontractor facilities cannot be ruled out.',
      citation:
        'ILO SAP-FL Indicator 10; ILO C155 (Occupational Safety); LBMA RGG v9 §7.6; UK MSA 2015 s.54(5)(b)',
    };
  }
  return null;
}

function checkIndicator11_ExcessiveOvertime(p: WorkforceProfile): SlaveryFinding | null {
  // ILO C1 limits = 48h/week standard; >60h/week consistently = forced overtime
  if ((p.overtimeHours ?? 0) > 60) {
    return {
      indicator: 'Excessive overtime',
      iloIndicatorId: 11,
      severity: p.overtimeHours! > 72 ? 'critical' : 'high',
      detail: `Average ${p.overtimeHours} hours/week exceeds ILO C1 (48h) and constitutes excessive compulsory overtime.`,
      citation:
        'ILO SAP-FL Indicator 11; ILO C1 (Hours of Work Convention 1919); ILO C30; ' +
        'UAE Labour Law Federal Decree 33/2021 Art.17 (max 8h/day, 48h/week)',
    };
  }
  return null;
}

// ─── Audit freshness check ────────────────────────────────────────────────────

function auditOverdue(lastAuditDate: string | undefined): boolean {
  if (!lastAuditDate) return true;
  const audit = new Date(lastAuditDate);
  if (isNaN(audit.getTime())) return true;
  const monthsAgo =
    (new Date().getFullYear() - audit.getFullYear()) * 12 +
    (new Date().getMonth() - audit.getMonth());
  return monthsAgo > 12;
}

// ─── Risk level derivation ────────────────────────────────────────────────────

function deriveRiskLevel(findings: SlaveryFinding[]): ModernSlaveryReport['riskLevel'] {
  if (findings.some((f) => f.severity === 'critical')) return 'critical';
  if (findings.some((f) => f.severity === 'high')) return 'high';
  if (findings.length > 0) return 'medium';
  return 'low';
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Assess a supplier/entity's workforce profile against ILO's 11 forced labour
 * indicators and produce a ModernSlaveryReport.
 *
 * Designed for use in DPMS gold supply-chain EDD workflows and LBMA RGG
 * annual disclosure. A 'critical' result should trigger an immediate STR
 * referral under UAE Federal Law 51/2006 and FDL No.10/2025 Art.26-27.
 *
 * @param profile - Workforce characteristics of the entity being assessed.
 * @returns ModernSlaveryReport
 */
export function assessModernSlaveryRisk(profile: WorkforceProfile): ModernSlaveryReport {
  const checks = [
    checkIndicator1_AbuseOfVulnerability(profile),
    checkIndicator2_Deception(profile),
    checkIndicator3_RestrictionOfMovement(profile),
    checkIndicator4_Isolation(profile),
    checkIndicator5_PhysicalViolence(profile),
    checkIndicator6_IntimidationAndThreats(profile),
    checkIndicator7_DocumentRetention(profile),
    checkIndicator8_WithholdingOfWages(profile),
    checkIndicator9_DebtBondage(profile),
    checkIndicator10_AbusiveWorkingConditions(profile),
    checkIndicator11_ExcessiveOvertime(profile),
  ];

  const findings: SlaveryFinding[] = checks.filter((f): f is SlaveryFinding => f !== null);

  // Dedup: if debt bondage already flagged, suppress the component indicators
  // to avoid double-counting in the narrative (debt bondage subsumes 2 + 8).
  const hasDebtBondage = findings.some((f) => f.iloIndicatorId === 9);
  const dedupedFindings = hasDebtBondage
    ? findings.filter((f) => ![2, 8].includes(f.iloIndicatorId))
    : findings;

  const riskLevel = deriveRiskLevel(dedupedFindings);
  const iloIndicatorsTriggered = new Set(dedupedFindings.map((f) => f.iloIndicatorId)).size;
  const requiresImmediateAction =
    riskLevel === 'critical' ||
    dedupedFindings.some((f) =>
      [3, 6, 7, 9].includes(f.iloIndicatorId), // movement, threats, docs, debt bondage
    );
  const requiresEnhancedDueDiligence =
    requiresImmediateAction || riskLevel === 'high' || iloIndicatorsTriggered >= 2;

  // Audit gap always added to findings if overdue, unless already critical
  const auditMissing =
    !profile.independentAuditConducted || auditOverdue(profile.lastAuditDate);
  if (auditMissing && riskLevel !== 'critical') {
    dedupedFindings.push({
      indicator: 'No current independent audit',
      iloIndicatorId: 0, // Not a numbered ILO indicator — operational finding
      severity: 'medium',
      detail:
        profile.independentAuditConducted === false
          ? 'No independent social/labour audit has been conducted.'
          : `Last audit (${profile.lastAuditDate ?? 'unknown'}) is more than 12 months old.`,
      citation: 'LBMA RGG v9 §7.1; UK MSA 2015 s.54(5)(d); UAE MoE RSG Framework §3.3',
    });
  }

  // Build narrative
  const criticalFlags = dedupedFindings.filter((f) => f.severity === 'critical').map((f) => f.indicator);
  let narrative =
    `Modern slavery risk assessment for entity ${profile.entityId} (sector: ${profile.sector}). ` +
    `Risk level: ${riskLevel.toUpperCase()}. ` +
    `ILO forced-labour indicators triggered: ${iloIndicatorsTriggered}/11.`;

  if (requiresImmediateAction) {
    narrative +=
      ` IMMEDIATE ACTION REQUIRED. Critical indicators: ${criticalFlags.join(', ')}.` +
      ' File an STR with UAE FIU via goAML if financial flows are linked to this entity' +
      ' (FDL No.10/2025 Art.26-27; UAE Federal Law 51/2006 Art.2).';
  } else if (requiresEnhancedDueDiligence) {
    narrative +=
      ' Enhanced Due Diligence required before continuing commercial relationship.' +
      ' (Cabinet Res 134/2025 Art.14; LBMA RGG v9 §7)';
  } else if (riskLevel === 'medium') {
    narrative += ' Corrective action plan required within 30 days. (LBMA RGG v9 §7; UAE MoE RSG §3.3)';
  } else {
    narrative += ' No critical forced-labour indicators detected. Maintain annual audit schedule.';
  }

  return {
    entityId: profile.entityId,
    riskLevel,
    iloIndicatorsTriggered,
    findings: dedupedFindings,
    requiresEnhancedDueDiligence,
    requiresImmediateAction,
    narrative,
  };
}
