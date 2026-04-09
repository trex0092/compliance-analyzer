export interface PFScreeningInput {
  entityName: string;
  goodsDescription?: string;
  endUseDeclaration?: string;
  originCountry?: string;
  destinationCountry?: string;
  quantity?: number;
  isIndustrialGrade?: boolean;
  highRiskJurisdiction?: boolean;
  onStrategicGoodsList?: boolean;
  unusualRouting?: boolean;
  // EOCN PF RA Guidance — additional fields
  customerIsPEP?: boolean;
  complexOwnershipStructure?: boolean;
  uboSanctionsMatch?: boolean;
  customerDualUseTrading?: boolean;
  nonFaceToFaceOnboarding?: boolean;
  neighbouringCountryRouting?: boolean;
  inconsistentTransactionProfile?: boolean;
  customerSector?: string;
}

export interface PFAlert {
  ruleId: string;
  severity: 'medium' | 'high' | 'critical';
  message: string;
  regulatoryRef: string;
  mandatoryAction: string;
}

export interface PFConfig {
  highRiskCountries: string[];
  dualUseIndicators: readonly string[];
}

// Default lists — can be overridden at runtime via PFConfig
export const DEFAULT_PF_HIGH_RISK_COUNTRIES = [
  'KP', // DPRK — UNSC Res 1718
  'IR', // Iran — UNSC Res 2231
  'SY', // Syria — EU/US sanctions
  'MM', // Myanmar — FATF High-Risk
  'YE', // Yemen — UNSC Res 2140
];

// Consolidated dual-use keywords — single source of truth in constants.ts.
// PF-specific additions that aren't in the shared list are appended here.
import { DUAL_USE_KEYWORDS } from '../domain/constants';

const PF_SPECIFIC_KEYWORDS = [
  'industrial platinum',
  'industrial palladium',
  'ruthenium',
  'rhenium',
  'hexafluoride',
  'yellowcake',
  'ballistic',
  'warhead',
  'semiconductor',
  'fluorine compound',
  'hydrogen fluoride',
  'tributyl phosphate',
  'neodymium',
  'samarium',
  'dysprosium',
] as const;

export const DEFAULT_DUAL_USE_INDICATORS: readonly string[] = [
  ...DUAL_USE_KEYWORDS,
  ...PF_SPECIFIC_KEYWORDS,
];

export const DEFAULT_PF_CONFIG: PFConfig = {
  highRiskCountries: DEFAULT_PF_HIGH_RISK_COUNTRIES,
  dualUseIndicators: DEFAULT_DUAL_USE_INDICATORS,
};

export function runPFScreening(input: PFScreeningInput, config?: PFConfig): PFAlert[] {
  const alerts: PFAlert[] = [];
  const pfCountries = config?.highRiskCountries ?? DEFAULT_PF_CONFIG.highRiskCountries;
  const dualUseList = config?.dualUseIndicators ?? DEFAULT_PF_CONFIG.dualUseIndicators;

  // Rule 1: Strategic goods list match
  if (input.onStrategicGoodsList) {
    alerts.push({
      ruleId: 'pf_strategic_goods',
      severity: 'critical',
      message: `${input.entityName}: Item appears on UAE Strategic Goods and Dual-Use Control Lists.`,
      regulatoryRef: 'Cabinet Resolution 156/2025 Art.3-5, UNSC Res 1718/2231',
      mandatoryAction: 'Block transaction. Report to competent authority.',
    });
  }

  // Rule 2: High-risk PF jurisdiction (check both origin and destination)
  const destMatch = pfCountries.includes(input.destinationCountry ?? '');
  const originMatch = pfCountries.includes(input.originCountry ?? '');
  if (destMatch || originMatch) {
    const flaggedCountry = destMatch ? input.destinationCountry : input.originCountry;
    const direction = destMatch ? 'destination' : 'origin';
    alerts.push({
      ruleId: 'pf_jurisdiction',
      severity: 'critical',
      message: `${input.entityName}: Transaction involves PF high-risk ${direction} jurisdiction (${flaggedCountry}).`,
      regulatoryRef: 'FDL No.10/2025 Art.22-23, FATF Rec 7',
      mandatoryAction: 'Freeze assets. Report to EOCN within 24 hours.',
    });
  }

  // Rule 3: Dual-use material indicators
  const goods = (input.goodsDescription ?? '').toLowerCase();
  const dualUseMatch = dualUseList.find((ind) => goods.includes(ind));
  if (dualUseMatch) {
    alerts.push({
      ruleId: 'pf_dual_use',
      severity: 'high',
      message: `${input.entityName}: Goods description contains dual-use indicator "${dualUseMatch}".`,
      regulatoryRef: 'Cabinet Resolution 156/2025, FATF Rec 7',
      mandatoryAction: 'Escalate to MLRO. Verify end-use declaration.',
    });
  }

  // Rule 4: Industrial grade precious metals + unusual quantities
  if (input.isIndustrialGrade && (input.quantity ?? 0) > 50) {
    alerts.push({
      ruleId: 'pf_industrial_quantity',
      severity: 'high',
      message: `${input.entityName}: Industrial-grade precious metals in unusual quantity (${input.quantity} units).`,
      regulatoryRef: 'Cabinet Resolution 156/2025 Art.7, FATF Rec 1',
      mandatoryAction: 'Verify end-user certificate. Enhanced DD required.',
    });
  }

  // Rule 5: Unusual routing (transshipment through third country)
  if (input.unusualRouting) {
    alerts.push({
      ruleId: 'pf_unusual_routing',
      severity: 'high',
      message: `${input.entityName}: Unusual routing detected. Origin: ${input.originCountry}, Destination: ${input.destinationCountry}.`,
      regulatoryRef: 'FATF Rec 7, OFAC advisories',
      mandatoryAction: 'Investigate transshipment rationale. Screen intermediaries.',
    });
  }

  // Rule 6: Missing or vague end-use declaration
  if (
    input.highRiskJurisdiction &&
    (!input.endUseDeclaration || input.endUseDeclaration.length < 20)
  ) {
    alerts.push({
      ruleId: 'pf_missing_end_use',
      severity: 'high',
      message: `${input.entityName}: Missing or insufficient end-use declaration for high-risk jurisdiction.`,
      regulatoryRef: 'Cabinet Resolution 156/2025, UNSC Resolutions',
      mandatoryAction: 'Obtain detailed end-use certificate before proceeding.',
    });
  }

  // ── EOCN PF RA Guidance 2025 — Additional Rules ──────────────────

  // Rule 7: UBO owned/controlled by sanctioned person (indirect exposure)
  if (input.uboSanctionsMatch) {
    alerts.push({
      ruleId: 'pf_ubo_sanctions',
      severity: 'critical',
      message: `${input.entityName}: UBO matches UN/EOCN sanctions list. Indirect PF exposure through beneficial ownership.`,
      regulatoryRef: 'EOCN PF RA Guidance 2025, Cabinet Resolution 74/2020, FDL No.10/2025 Art.14',
      mandatoryAction:
        'Freeze assets without delay. Report to EOCN within 24 hours. File CNMR within 5 business days.',
    });
  }

  // Rule 8: Complex/opaque ownership structure
  if (input.complexOwnershipStructure) {
    alerts.push({
      ruleId: 'pf_complex_ownership',
      severity: 'high',
      message: `${input.entityName}: Complex or opaque ownership structure without business justification — PF vulnerability indicator.`,
      regulatoryRef: 'EOCN PF RA Guidance 2025, FATF Rec 24, Cabinet Resolution 134/2025 Art.8',
      mandatoryAction:
        'Apply EDD. Reduce UBO threshold from 25% to 10%. Obtain senior management approval.',
    });
  }

  // Rule 9: PEP as PF risk factor
  if (input.customerIsPEP && input.highRiskJurisdiction) {
    alerts.push({
      ruleId: 'pf_pep_jurisdiction',
      severity: 'high',
      message: `${input.entityName}: PEP with high-risk jurisdiction exposure — elevated PF risk per EOCN guidance.`,
      regulatoryRef: 'EOCN PF RA Guidance 2025, FDL No.10/2025 Art.16, FATF Rec 12',
      mandatoryAction:
        'Apply EDD. Senior management approval required. Enhanced ongoing monitoring.',
    });
  }

  // Rule 10: Customer trades in dual-use goods
  if (input.customerDualUseTrading) {
    alerts.push({
      ruleId: 'pf_customer_dual_use',
      severity: 'high',
      message: `${input.entityName}: Customer engages in dual-use goods trading — direct PF exposure per EOCN guidance.`,
      regulatoryRef: 'EOCN PF RA Guidance 2025, Cabinet Resolution 156/2025 Art.3-5, UNSCR 1540',
      mandatoryAction:
        'Verify trading licence for controlled goods. Screen against UAE Strategic Goods Control Lists.',
    });
  }

  // Rule 11: Neighbouring country routing (proliferators use adjacent countries)
  if (input.neighbouringCountryRouting) {
    alerts.push({
      ruleId: 'pf_neighbouring_routing',
      severity: 'high',
      message: `${input.entityName}: Transaction routed through country neighbouring DPRK/Iran — proliferators use third-country routing to procure materials.`,
      regulatoryRef: 'EOCN PF RA Guidance 2025, FATF PF Guidance 2021, Cabinet Resolution 74/2020',
      mandatoryAction:
        'Investigate routing rationale. Enhanced DD on all intermediaries. Consider STR filing.',
    });
  }

  // Rule 12: Non-face-to-face onboarding (delivery channel risk)
  if (input.nonFaceToFaceOnboarding && input.highRiskJurisdiction) {
    alerts.push({
      ruleId: 'pf_delivery_channel_risk',
      severity: 'medium',
      message: `${input.entityName}: Non-face-to-face onboarding from high-risk jurisdiction — elevated delivery channel PF risk.`,
      regulatoryRef: 'EOCN PF RA Guidance 2025, Cabinet Resolution 134/2025 Art.12, FATF Rec 10',
      mandatoryAction:
        'Apply enhanced identity verification. Collect additional documentation from independent sources.',
    });
  }

  // Rule 13: Inconsistent transaction profile
  if (input.inconsistentTransactionProfile) {
    alerts.push({
      ruleId: 'pf_inconsistent_profile',
      severity: 'high',
      message: `${input.entityName}: Transaction value/pattern inconsistent with customer's socio-economic profile — PF acquisition typology indicator.`,
      regulatoryRef: 'EOCN PF RA Guidance 2025, FDL No.10/2025 Art.15-16, FATF Rec 20',
      mandatoryAction:
        'Investigate discrepancy. Obtain source of funds documentation. Consider STR filing.',
    });
  }

  // Rule 14: High-risk business sector
  if (
    input.customerSector &&
    ['defence', 'military', 'aerospace', 'nuclear', 'chemical', 'biotech'].some((s) =>
      (input.customerSector ?? '').toLowerCase().includes(s)
    )
  ) {
    alerts.push({
      ruleId: 'pf_high_risk_sector',
      severity: 'high',
      message: `${input.entityName}: Customer operates in high-risk PF sector (${input.customerSector}).`,
      regulatoryRef: 'EOCN PF RA Guidance 2025, Cabinet Resolution 156/2025, FATF Rec 7',
      mandatoryAction:
        "Apply EDD. Verify customer's business activities are legitimate. Senior management approval required.",
    });
  }

  return alerts;
}
