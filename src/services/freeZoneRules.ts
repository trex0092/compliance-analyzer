/**
 * Free Zone Rulebook — DMCC / JAFZA / DIFC supplementary rules.
 *
 * UAE free zones publish supplementary rules on top of the federal
 * AML framework. A DPMS licensed in DMCC must follow DMCC's
 * Practical Guide to Gold Responsible Sourcing AND the federal
 * Cabinet Res 74/2020 / 134/2025. Same for JAFZA and DIFC DFSA.
 *
 * This module encodes the free-zone-specific supplementary
 * requirements as declarative rule objects, and exposes a check
 * function that asks "does this operation satisfy the rules for its
 * free zone?"
 *
 * Scope is deliberately limited to what's publicly-published as of
 * 2026-Q1. Free-zone rulebooks update; the static table should be
 * audited quarterly and the source cited in every rule.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FreeZone = 'DMCC' | 'JAFZA' | 'DIFC' | 'ADGM' | 'mainland';

export type RuleCategory =
  | 'governance'
  | 'kyc'
  | 'sourcing'
  | 'reporting'
  | 'record_keeping'
  | 'training'
  | 'audit';

export interface FreeZoneRule {
  id: string;
  freeZone: FreeZone;
  category: RuleCategory;
  title: string;
  description: string;
  /** Is this rule MANDATORY (errors) or RECOMMENDED (warnings)? */
  severity: 'mandatory' | 'recommended';
  /** Citation back to the public document. */
  source: string;
  /** Checker function name — looked up at check time. */
  checker: string;
}

// ---------------------------------------------------------------------------
// Rule catalogue
// ---------------------------------------------------------------------------

export const FREE_ZONE_RULES: FreeZoneRule[] = [
  // DMCC — Dubai Multi Commodities Centre
  {
    id: 'DMCC-RSG-001',
    freeZone: 'DMCC',
    category: 'sourcing',
    title: 'DMCC Responsible Sourcing Policy required',
    description:
      'Every DMCC gold trader must adopt a Responsible Sourcing Policy aligned with the OECD Due Diligence Guidance.',
    severity: 'mandatory',
    source: 'DMCC Practical Guide to Gold Responsible Sourcing §2.1',
    checker: 'hasResponsibleSourcingPolicy',
  },
  {
    id: 'DMCC-RSG-002',
    freeZone: 'DMCC',
    category: 'audit',
    title: 'Annual independent audit per DMCC Rules',
    description:
      'DMCC members must submit to an annual audit by a DMCC-approved auditor covering the 5-step framework.',
    severity: 'mandatory',
    source: 'DMCC Practical Guide to Gold Responsible Sourcing §5',
    checker: 'hasAnnualIndependentAudit',
  },
  {
    id: 'DMCC-RSG-003',
    freeZone: 'DMCC',
    category: 'sourcing',
    title: 'CAHRA supplier tagging',
    description:
      'Every supplier must be tagged with a CAHRA risk level and evaluated against the DMCC red-flag list.',
    severity: 'mandatory',
    source: 'DMCC Practical Guide to Gold Responsible Sourcing §3.2',
    checker: 'hasCahraTagging',
  },
  {
    id: 'DMCC-RSG-004',
    freeZone: 'DMCC',
    category: 'reporting',
    title: 'Annual public disclosure',
    description:
      'DMCC gold traders must publish an annual responsible sourcing report within 90 days of year-end.',
    severity: 'mandatory',
    source: 'DMCC Practical Guide to Gold Responsible Sourcing §5.4',
    checker: 'hasAnnualPublicDisclosure',
  },
  {
    id: 'DMCC-KYC-005',
    freeZone: 'DMCC',
    category: 'kyc',
    title: 'DMCC-specific KYC — supplier SAQ retention',
    description: 'Supplier Self-Assessment Questionnaires must be retained for minimum 10 years.',
    severity: 'mandatory',
    source: 'DMCC Member Rules §6.3',
    checker: 'retainsSupplierSaq',
  },

  // JAFZA
  {
    id: 'JAFZA-001',
    freeZone: 'JAFZA',
    category: 'governance',
    title: 'JAFZA Compliance Officer registered',
    description:
      'Every JAFZA-licensed DPMS must register its Compliance Officer with the JAFZA authority.',
    severity: 'mandatory',
    source: 'JAFZA Rules of Registration 2015 as amended',
    checker: 'hasRegisteredCo',
  },
  {
    id: 'JAFZA-002',
    freeZone: 'JAFZA',
    category: 'record_keeping',
    title: 'Transit cargo documentation',
    description:
      'Transit gold through JAFZA must carry proof of non-UAE origin and non-UAE destination for customs clearance.',
    severity: 'mandatory',
    source: 'JAFZA Customs Guidelines',
    checker: 'hasTransitDocumentation',
  },

  // DIFC — DFSA-regulated DPMS (rare; most DPMS are DMCC or mainland)
  {
    id: 'DIFC-DFSA-001',
    freeZone: 'DIFC',
    category: 'governance',
    title: 'DFSA Financial Crime Policy',
    description:
      'DIFC-licensed entities must adopt the DFSA Financial Crime Policy covering AML, CTF, sanctions, and bribery.',
    severity: 'mandatory',
    source: 'DFSA AML Module AML-4',
    checker: 'hasDfsaFinCrimePolicy',
  },

  // mainland
  {
    id: 'MAIN-001',
    freeZone: 'mainland',
    category: 'governance',
    title: 'MoE DPMS registration',
    description:
      'Mainland DPMS must register with the Ministry of Economy under MoE Circular 08/AML/2021.',
    severity: 'mandatory',
    source: 'MoE Circular 08/AML/2021',
    checker: 'hasMoeRegistration',
  },
];

// ---------------------------------------------------------------------------
// Entity facts — what we know about a given entity
// ---------------------------------------------------------------------------

export interface EntityFacts {
  freeZone: FreeZone;
  hasResponsibleSourcingPolicy?: boolean;
  hasAnnualIndependentAudit?: boolean;
  lastAuditDate?: string;
  hasCahraTagging?: boolean;
  hasAnnualPublicDisclosure?: boolean;
  lastDisclosureDate?: string;
  retainsSupplierSaq?: boolean;
  hasRegisteredCo?: boolean;
  hasTransitDocumentation?: boolean;
  hasDfsaFinCrimePolicy?: boolean;
  hasMoeRegistration?: boolean;
}

// ---------------------------------------------------------------------------
// Checker functions
// ---------------------------------------------------------------------------

const CHECKERS: Record<string, (facts: EntityFacts) => boolean> = {
  hasResponsibleSourcingPolicy: (f) => f.hasResponsibleSourcingPolicy === true,
  hasAnnualIndependentAudit: (f) => {
    if (!f.hasAnnualIndependentAudit) return false;
    if (!f.lastAuditDate) return false;
    const age = Date.now() - new Date(f.lastAuditDate).getTime();
    return age <= 365 * 24 * 60 * 60 * 1000;
  },
  hasCahraTagging: (f) => f.hasCahraTagging === true,
  hasAnnualPublicDisclosure: (f) => {
    if (!f.hasAnnualPublicDisclosure) return false;
    if (!f.lastDisclosureDate) return false;
    const age = Date.now() - new Date(f.lastDisclosureDate).getTime();
    return age <= 365 * 24 * 60 * 60 * 1000;
  },
  retainsSupplierSaq: (f) => f.retainsSupplierSaq === true,
  hasRegisteredCo: (f) => f.hasRegisteredCo === true,
  hasTransitDocumentation: (f) => f.hasTransitDocumentation === true,
  hasDfsaFinCrimePolicy: (f) => f.hasDfsaFinCrimePolicy === true,
  hasMoeRegistration: (f) => f.hasMoeRegistration === true,
};

// ---------------------------------------------------------------------------
// Top-level check
// ---------------------------------------------------------------------------

export interface FreeZoneCheckResult {
  freeZone: FreeZone;
  totalRules: number;
  passed: number;
  failed: number;
  mandatoryFailures: FreeZoneRule[];
  recommendedFailures: FreeZoneRule[];
  isCompliant: boolean;
}

export function checkFreeZoneCompliance(facts: EntityFacts): FreeZoneCheckResult {
  const applicable = FREE_ZONE_RULES.filter((r) => r.freeZone === facts.freeZone);
  const mandatoryFailures: FreeZoneRule[] = [];
  const recommendedFailures: FreeZoneRule[] = [];
  let passed = 0;

  for (const rule of applicable) {
    const checker = CHECKERS[rule.checker];
    if (!checker) continue;
    const ok = checker(facts);
    if (ok) {
      passed++;
    } else if (rule.severity === 'mandatory') {
      mandatoryFailures.push(rule);
    } else {
      recommendedFailures.push(rule);
    }
  }

  return {
    freeZone: facts.freeZone,
    totalRules: applicable.length,
    passed,
    failed: mandatoryFailures.length + recommendedFailures.length,
    mandatoryFailures,
    recommendedFailures,
    isCompliant: mandatoryFailures.length === 0,
  };
}

export function rulesFor(freeZone: FreeZone): FreeZoneRule[] {
  return FREE_ZONE_RULES.filter((r) => r.freeZone === freeZone);
}
