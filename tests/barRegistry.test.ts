import { describe, it, expect } from 'vitest';
import {
  createRefinerRegistry,
  registerRefiner,
  lookupRefiner,
  isAccredited,
  createBarRegistry,
  registerBar,
  lookupBar,
  recordBarEvent,
  vaultReport,
  findBarsByOwner,
  findBarsByStatus,
  type BarRegistry,
} from '@/services/barRegistry';
import { troyOzToGrams } from '@/services/fineness';

function buildFixture(): BarRegistry {
  const refiners = createRefinerRegistry();
  registerRefiner(refiners, {
    id: 'EGR',
    name: 'Emirates Gold Refinery',
    country: 'AE',
    accreditations: ['Dubai_Good_Delivery', 'LBMA_Good_Delivery'],
    lastVerifiedAt: '2026-01-01',
  });
  registerRefiner(refiners, {
    id: 'UNKN',
    name: 'Unknown Refiner Co',
    country: 'XX',
    accreditations: ['not_accredited'],
  });
  return createBarRegistry(refiners);
}

describe('refiner registry', () => {
  it('registers and looks up refiners', () => {
    const reg = createRefinerRegistry();
    registerRefiner(reg, {
      id: 'A',
      name: 'Alpha',
      country: 'AE',
      accreditations: ['LBMA_Good_Delivery'],
    });
    expect(lookupRefiner(reg, 'A')?.name).toBe('Alpha');
    expect(lookupRefiner(reg, 'Z')).toBeNull();
  });

  it('isAccredited true for LBMA', () => {
    expect(
      isAccredited({
        id: 'A',
        name: '',
        country: 'X',
        accreditations: ['LBMA_Good_Delivery'],
      }),
    ).toBe(true);
  });

  it('isAccredited false for not_accredited only', () => {
    expect(
      isAccredited({
        id: 'A',
        name: '',
        country: 'X',
        accreditations: ['not_accredited'],
      }),
    ).toBe(false);
  });
});

describe('registerBar', () => {
  it('registers a spec-compliant bar', () => {
    const registry = buildFixture();
    const result = registerBar(registry, {
      serial: 'EGR-2026-000123',
      refinerId: 'EGR',
      metal: 'gold',
      fineness: 999.9,
      weightGrams: troyOzToGrams(400),
      initialLocation: 'Vault-A',
      actor: 'co',
    });
    expect(result.ok).toBe(true);
    expect(result.bar?.status).toBe('received');
    expect(result.bar?.events).toHaveLength(1);
    expect(result.bar?.events[0].type).toBe('receive');
  });

  it('rejects a duplicate serial', () => {
    const registry = buildFixture();
    registerBar(registry, {
      serial: 'EGR-001',
      refinerId: 'EGR',
      metal: 'gold',
      fineness: 999.9,
      weightGrams: troyOzToGrams(400),
      initialLocation: 'V',
      actor: 'co',
    });
    const second = registerBar(registry, {
      serial: 'EGR-001',
      refinerId: 'EGR',
      metal: 'gold',
      fineness: 999.9,
      weightGrams: troyOzToGrams(400),
      initialLocation: 'V',
      actor: 'co',
    });
    expect(second.ok).toBe(false);
    expect(second.errors.some((e) => /already/i.test(e))).toBe(true);
  });

  it('rejects an unknown refiner', () => {
    const registry = buildFixture();
    const result = registerBar(registry, {
      serial: 'X-001',
      refinerId: 'NOT_REGISTERED',
      metal: 'gold',
      fineness: 999.9,
      weightGrams: troyOzToGrams(400),
      initialLocation: 'V',
      actor: 'co',
    });
    expect(result.ok).toBe(false);
  });

  it('warns when refiner is not accredited', () => {
    const registry = buildFixture();
    const result = registerBar(registry, {
      serial: 'UNKN-001',
      refinerId: 'UNKN',
      metal: 'gold',
      fineness: 999.9,
      weightGrams: troyOzToGrams(400),
      initialLocation: 'V',
      actor: 'co',
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => /not accredited/i.test(w))).toBe(true);
  });

  it('warns when bar fails Good Delivery spec (sub-spec bar)', () => {
    const registry = buildFixture();
    const result = registerBar(registry, {
      serial: 'EGR-SMALL-001',
      refinerId: 'EGR',
      metal: 'gold',
      fineness: 999.9,
      weightGrams: troyOzToGrams(100), // below 350 troy oz minimum
      initialLocation: 'V',
      actor: 'co',
    });
    expect(result.ok).toBe(true); // not a hard error — sub-spec bars exist
    expect(result.warnings.some((w) => /Good Delivery/i.test(w))).toBe(true);
  });

  it('rejects short serial', () => {
    const registry = buildFixture();
    const result = registerBar(registry, {
      serial: 'A',
      refinerId: 'EGR',
      metal: 'gold',
      fineness: 999.9,
      weightGrams: troyOzToGrams(400),
      initialLocation: 'V',
      actor: 'co',
    });
    expect(result.ok).toBe(false);
  });
});

describe('recordBarEvent — state transitions', () => {
  function newBarRegistry() {
    const registry = buildFixture();
    registerBar(registry, {
      serial: 'EGR-SM-0001',
      refinerId: 'EGR',
      metal: 'gold',
      fineness: 999.9,
      weightGrams: troyOzToGrams(400),
      initialLocation: 'Vault-A',
      actor: 'co',
    });
    return registry;
  }

  it('received → in_vault_unallocated is valid', () => {
    const registry = newBarRegistry();
    const result = recordBarEvent(registry, {
      refinerId: 'EGR',
      serial: 'EGR-SM-0001',
      event: 'receive',
      actor: 'co',
      newStatus: 'in_vault_unallocated',
    });
    expect(result.ok).toBe(true);
    expect(result.bar?.status).toBe('in_vault_unallocated');
  });

  it('in_vault_unallocated → in_vault_allocated with owner', () => {
    const registry = newBarRegistry();
    recordBarEvent(registry, {
      refinerId: 'EGR',
      serial: 'EGR-SM-0001',
      event: 'receive',
      actor: 'co',
      newStatus: 'in_vault_unallocated',
    });
    const result = recordBarEvent(registry, {
      refinerId: 'EGR',
      serial: 'EGR-SM-0001',
      event: 'allocate',
      actor: 'co',
      newStatus: 'in_vault_allocated',
      newOwner: 'CUST-001',
    });
    expect(result.ok).toBe(true);
    expect(result.bar?.currentOwner).toBe('CUST-001');
  });

  it('rejects invalid transition (received → sold direct)', () => {
    const registry = newBarRegistry();
    const result = recordBarEvent(registry, {
      refinerId: 'EGR',
      serial: 'EGR-SM-0001',
      event: 'sell',
      actor: 'co',
      newStatus: 'sold',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /transition/i.test(e))).toBe(true);
  });

  it('melted_down is terminal (no further transitions)', () => {
    const registry = newBarRegistry();
    recordBarEvent(registry, {
      refinerId: 'EGR',
      serial: 'EGR-SM-0001',
      event: 'receive',
      actor: 'co',
      newStatus: 'in_vault_unallocated',
    });
    recordBarEvent(registry, {
      refinerId: 'EGR',
      serial: 'EGR-SM-0001',
      event: 'melt',
      actor: 'co',
      newStatus: 'melted_down',
    });
    const fromTerminal = recordBarEvent(registry, {
      refinerId: 'EGR',
      serial: 'EGR-SM-0001',
      event: 'allocate',
      actor: 'co',
      newStatus: 'in_vault_allocated',
    });
    expect(fromTerminal.ok).toBe(false);
  });

  it('rejects event on unknown bar', () => {
    const registry = newBarRegistry();
    const result = recordBarEvent(registry, {
      refinerId: 'EGR',
      serial: 'NOPE',
      event: 'receive',
      actor: 'co',
    });
    expect(result.ok).toBe(false);
  });
});

describe('vault report', () => {
  it('aggregates bars by metal and allocation status', () => {
    const registry = buildFixture();
    registerBar(registry, {
      serial: 'GOLD-1',
      refinerId: 'EGR',
      metal: 'gold',
      fineness: 999.9,
      weightGrams: troyOzToGrams(400),
      initialLocation: 'Vault-A',
      actor: 'co',
    });
    registerBar(registry, {
      serial: 'GOLD-2',
      refinerId: 'EGR',
      metal: 'gold',
      fineness: 999.9,
      weightGrams: troyOzToGrams(400),
      initialLocation: 'Vault-A',
      actor: 'co',
    });
    // Both bars transition to vault
    recordBarEvent(registry, {
      refinerId: 'EGR',
      serial: 'GOLD-1',
      event: 'receive',
      actor: 'co',
      newStatus: 'in_vault_unallocated',
    });
    recordBarEvent(registry, {
      refinerId: 'EGR',
      serial: 'GOLD-2',
      event: 'receive',
      actor: 'co',
      newStatus: 'in_vault_allocated',
      newOwner: 'CUST-X',
    });

    const report = vaultReport(registry, 'Vault-A');
    expect(report.totalBars).toBe(2);
    expect(report.byMetal.gold.count).toBe(2);
    expect(report.allocated).toBe(1);
    expect(report.unallocated).toBe(1);
  });
});

describe('findBarsByOwner / findBarsByStatus', () => {
  it('returns only bars owned by the given customer', () => {
    const registry = buildFixture();
    registerBar(registry, {
      serial: 'BAR-0001',
      refinerId: 'EGR',
      metal: 'gold',
      fineness: 999.9,
      weightGrams: troyOzToGrams(400),
      initialLocation: 'V',
      actor: 'co',
    });
    recordBarEvent(registry, {
      refinerId: 'EGR',
      serial: 'BAR-0001',
      event: 'allocate',
      actor: 'co',
      newStatus: 'in_vault_allocated',
      newOwner: 'CUST-A',
    });
    expect(findBarsByOwner(registry, 'CUST-A')).toHaveLength(1);
    expect(findBarsByOwner(registry, 'CUST-B')).toHaveLength(0);
  });

  it('returns all bars in a given status', () => {
    const registry = buildFixture();
    registerBar(registry, {
      serial: 'BAR-0002',
      refinerId: 'EGR',
      metal: 'gold',
      fineness: 999.9,
      weightGrams: troyOzToGrams(400),
      initialLocation: 'V',
      actor: 'co',
    });
    expect(findBarsByStatus(registry, 'received')).toHaveLength(1);
  });
});

describe('lookupBar', () => {
  it('returns null for unknown bar', () => {
    const registry = buildFixture();
    expect(lookupBar(registry, 'EGR', 'NOPE')).toBeNull();
  });
});
