import type { EvidenceItem } from "./evidence";

export interface EvidenceRequirement {
  category: EvidenceItem["category"];
  required: boolean;
  description: string;
}

export const CDD_EVIDENCE_REQUIREMENTS: EvidenceRequirement[] = [
  { category: "kyc", required: true, description: "Valid trade license / incorporation certificate" },
  { category: "kyc", required: true, description: "Passport / Emirates ID of authorized signatory" },
  { category: "kyc", required: true, description: "UBO identification and verification documents" },
  { category: "screening", required: true, description: "Sanctions screening results (UN/OFAC/EU/UAE)" },
  { category: "screening", required: true, description: "PEP screening results" },
  { category: "sow-sof", required: true, description: "Source of funds documentation" },
  { category: "sow-sof", required: true, description: "Source of wealth documentation" },
];

export const EDD_EVIDENCE_REQUIREMENTS: EvidenceRequirement[] = [
  ...CDD_EVIDENCE_REQUIREMENTS,
  { category: "sow-sof", required: true, description: "Enhanced source of wealth verification" },
  { category: "approval", required: true, description: "Senior management approval for relationship" },
  { category: "screening", required: true, description: "Adverse media screening results" },
];

export function checkEvidenceCompleteness(
  linkedEvidence: EvidenceItem[],
  requirements: EvidenceRequirement[]
): {
  complete: boolean;
  completionPct: number;
  missing: string[];
} {
  const requiredItems = requirements.filter((r) => r.required);
  const missing: string[] = [];

  // Group linked evidence by category and count how many are linked per category
  const linkedByCategory = new Map<string, number>();
  for (const e of linkedEvidence) {
    if (e.status === "linked") {
      linkedByCategory.set(e.category, (linkedByCategory.get(e.category) ?? 0) + 1);
    }
  }

  // Count required items per category and check we have enough linked evidence
  const requiredByCategory = new Map<string, { count: number; descriptions: string[] }>();
  for (const req of requiredItems) {
    const entry = requiredByCategory.get(req.category) ?? { count: 0, descriptions: [] };
    entry.count++;
    entry.descriptions.push(req.description);
    requiredByCategory.set(req.category, entry);
  }

  for (const [category, { count, descriptions }] of requiredByCategory) {
    const linkedCount = linkedByCategory.get(category) ?? 0;
    if (linkedCount < count) {
      // Add descriptions for each missing item in this category
      const missingCount = count - linkedCount;
      for (let i = count - missingCount; i < count; i++) {
        missing.push(descriptions[i]);
      }
    }
  }

  const completionPct =
    requiredItems.length > 0
      ? Math.round(((requiredItems.length - missing.length) / requiredItems.length) * 100)
      : 100;

  return {
    complete: missing.length === 0,
    completionPct,
    missing,
  };
}

export function enforceEvidenceGate(
  linkedEvidence: EvidenceItem[],
  requirements: EvidenceRequirement[]
): { allowed: boolean; blockedReason?: string } {
  const { complete, missing } = checkEvidenceCompleteness(linkedEvidence, requirements);
  if (!complete) {
    return {
      allowed: false,
      blockedReason: `Required evidence is missing: ${missing.join("; ")}`,
    };
  }
  return { allowed: true };
}
