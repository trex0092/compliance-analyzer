import { describe, it, expect } from 'vitest';
import {
  FREE_ZONE_RULES,
  checkFreeZoneCompliance,
  rulesFor,
  type EntityFacts,
} from '@/services/freeZoneRules';

const now = new Date().toISOString();

function perfectDmcc(): EntityFacts {
  return {
    freeZone: 'DMCC',
    hasResponsibleSourcingPolicy: true,
    hasAnnualIndependentAudit: true,
    lastAuditDate: now,
    hasCahraTagging: true,
    hasAnnualPublicDisclosure: true,
    lastDisclosureDate: now,
    retainsSupplierSaq: true,
  };
}

describe('FREE_ZONE_RULES catalogue', () => {
  it('has DMCC, JAFZA, DIFC, mainland rules', () => {
    expect(rulesFor('DMCC').length).toBeGreaterThanOrEqual(5);
    expect(rulesFor('JAFZA').length).toBeGreaterThanOrEqual(1);
    expect(rulesFor('DIFC').length).toBeGreaterThanOrEqual(1);
    expect(rulesFor('mainland').length).toBeGreaterThanOrEqual(1);
  });

  it('every rule has an id, source, and checker', () => {
    for (const r of FREE_ZONE_RULES) {
      expect(r.id).toBeTruthy();
      expect(r.source).toBeTruthy();
      expect(r.checker).toBeTruthy();
    }
  });

  it('rule ids are unique', () => {
    const ids = new Set(FREE_ZONE_RULES.map((r) => r.id));
    expect(ids.size).toBe(FREE_ZONE_RULES.length);
  });
});

describe('checkFreeZoneCompliance — DMCC', () => {
  it('perfect DMCC entity → compliant, zero failures', () => {
    const result = checkFreeZoneCompliance(perfectDmcc());
    expect(result.isCompliant).toBe(true);
    expect(result.mandatoryFailures).toHaveLength(0);
  });

  it('missing sourcing policy → mandatory failure', () => {
    const facts = perfectDmcc();
    facts.hasResponsibleSourcingPolicy = false;
    const result = checkFreeZoneCompliance(facts);
    expect(result.isCompliant).toBe(false);
    expect(result.mandatoryFailures.some((r) => r.id === 'DMCC-RSG-001')).toBe(true);
  });

  it('stale audit → mandatory failure', () => {
    const facts = perfectDmcc();
    facts.lastAuditDate = '2020-01-01'; // >1 year old
    const result = checkFreeZoneCompliance(facts);
    expect(result.isCompliant).toBe(false);
    expect(result.mandatoryFailures.some((r) => r.id === 'DMCC-RSG-002')).toBe(true);
  });

  it('missing CAHRA tagging → mandatory failure', () => {
    const facts = perfectDmcc();
    facts.hasCahraTagging = false;
    const result = checkFreeZoneCompliance(facts);
    expect(result.mandatoryFailures.some((r) => r.id === 'DMCC-RSG-003')).toBe(true);
  });

  it('missing public disclosure → mandatory failure', () => {
    const facts = perfectDmcc();
    facts.hasAnnualPublicDisclosure = false;
    const result = checkFreeZoneCompliance(facts);
    expect(result.mandatoryFailures.some((r) => r.id === 'DMCC-RSG-004')).toBe(true);
  });
});

describe('checkFreeZoneCompliance — JAFZA', () => {
  it('JAFZA entity with all requirements met → compliant', () => {
    const facts: EntityFacts = {
      freeZone: 'JAFZA',
      hasRegisteredCo: true,
      hasTransitDocumentation: true,
    };
    const result = checkFreeZoneCompliance(facts);
    expect(result.isCompliant).toBe(true);
  });

  it('unregistered CO → mandatory failure', () => {
    const facts: EntityFacts = {
      freeZone: 'JAFZA',
      hasRegisteredCo: false,
      hasTransitDocumentation: true,
    };
    const result = checkFreeZoneCompliance(facts);
    expect(result.mandatoryFailures.some((r) => r.id === 'JAFZA-001')).toBe(true);
  });
});

describe('checkFreeZoneCompliance — mainland', () => {
  it('MoE-registered mainland DPMS → compliant', () => {
    const result = checkFreeZoneCompliance({ freeZone: 'mainland', hasMoeRegistration: true });
    expect(result.isCompliant).toBe(true);
  });

  it('unregistered mainland → failure', () => {
    const result = checkFreeZoneCompliance({ freeZone: 'mainland', hasMoeRegistration: false });
    expect(result.isCompliant).toBe(false);
  });
});

describe('checkFreeZoneCompliance — cross-zone isolation', () => {
  it('DMCC entity is not checked against JAFZA rules', () => {
    const result = checkFreeZoneCompliance({ freeZone: 'DMCC' });
    const ids = result.mandatoryFailures.map((r) => r.id);
    expect(ids.some((id) => id.startsWith('JAFZA'))).toBe(false);
  });
});
