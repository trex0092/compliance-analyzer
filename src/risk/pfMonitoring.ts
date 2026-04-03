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
}

export interface PFAlert {
  ruleId: string;
  severity: "medium" | "high" | "critical";
  message: string;
  regulatoryRef: string;
  mandatoryAction: string;
}

export interface PFConfig {
  highRiskCountries: string[];
  dualUseIndicators: string[];
}

// Default lists — can be overridden at runtime via PFConfig
export const DEFAULT_PF_HIGH_RISK_COUNTRIES = ["KP", "IR", "SY"];

export const DEFAULT_DUAL_USE_INDICATORS = [
  "industrial platinum", "industrial palladium", "rhodium",
  "iridium", "osmium", "ruthenium", "rhenium",
  "nuclear", "centrifuge", "enrichment",
  "ballistic", "missile", "warhead",
];

export const DEFAULT_PF_CONFIG: PFConfig = {
  highRiskCountries: DEFAULT_PF_HIGH_RISK_COUNTRIES,
  dualUseIndicators: DEFAULT_DUAL_USE_INDICATORS,
};

export function runPFScreening(
  input: PFScreeningInput,
  config?: PFConfig
): PFAlert[] {
  const alerts: PFAlert[] = [];
  const pfCountries = config?.highRiskCountries ?? DEFAULT_PF_CONFIG.highRiskCountries;
  const dualUseList = config?.dualUseIndicators ?? DEFAULT_PF_CONFIG.dualUseIndicators;

  // Rule 1: Strategic goods list match
  if (input.onStrategicGoodsList) {
    alerts.push({
      ruleId: "pf_strategic_goods",
      severity: "critical",
      message: `${input.entityName}: Item appears on UAE Strategic Goods and Dual-Use Control Lists.`,
      regulatoryRef: "Cabinet Resolution 156/2025 Art.3-5, UNSC Res 1718/2231",
      mandatoryAction: "Block transaction. Report to competent authority.",
    });
  }

  // Rule 2: High-risk PF jurisdiction
  if (pfCountries.includes(input.destinationCountry ?? "")) {
    alerts.push({
      ruleId: "pf_jurisdiction",
      severity: "critical",
      message: `${input.entityName}: Transaction involves PF high-risk jurisdiction (${input.destinationCountry}).`,
      regulatoryRef: "FDL No.10/2025 Art.22-23, FATF Rec 7",
      mandatoryAction: "Freeze assets. Report to EOCN within 24 hours.",
    });
  }

  // Rule 3: Dual-use material indicators
  const goods = (input.goodsDescription ?? "").toLowerCase();
  const dualUseMatch = dualUseList.find((ind) => goods.includes(ind));
  if (dualUseMatch) {
    alerts.push({
      ruleId: "pf_dual_use",
      severity: "high",
      message: `${input.entityName}: Goods description contains dual-use indicator "${dualUseMatch}".`,
      regulatoryRef: "Cabinet Resolution 156/2025, FATF Rec 7",
      mandatoryAction: "Escalate to MLRO. Verify end-use declaration.",
    });
  }

  // Rule 4: Industrial grade precious metals + unusual quantities
  if (input.isIndustrialGrade && (input.quantity ?? 0) > 50) {
    alerts.push({
      ruleId: "pf_industrial_quantity",
      severity: "high",
      message: `${input.entityName}: Industrial-grade precious metals in unusual quantity (${input.quantity} units).`,
      regulatoryRef: "Cabinet Resolution 156/2025 Art.7, FATF Rec 1",
      mandatoryAction: "Verify end-user certificate. Enhanced DD required.",
    });
  }

  // Rule 5: Unusual routing (transshipment through third country)
  if (input.unusualRouting) {
    alerts.push({
      ruleId: "pf_unusual_routing",
      severity: "high",
      message: `${input.entityName}: Unusual routing detected. Origin: ${input.originCountry}, Destination: ${input.destinationCountry}.`,
      regulatoryRef: "FATF Rec 7, OFAC advisories",
      mandatoryAction: "Investigate transshipment rationale. Screen intermediaries.",
    });
  }

  // Rule 6: Missing or vague end-use declaration
  if (
    input.highRiskJurisdiction &&
    (!input.endUseDeclaration || input.endUseDeclaration.length < 20)
  ) {
    alerts.push({
      ruleId: "pf_missing_end_use",
      severity: "high",
      message: `${input.entityName}: Missing or insufficient end-use declaration for high-risk jurisdiction.`,
      regulatoryRef: "Cabinet Resolution 156/2025, UNSC Resolutions",
      mandatoryAction: "Obtain detailed end-use certificate before proceeding.",
    });
  }

  return alerts;
}
