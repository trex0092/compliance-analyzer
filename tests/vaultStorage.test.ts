import { describe, it, expect } from 'vitest';
import {
  reconcileVault,
  customerExposure,
  positionToBrainEvent,
  type AllocatedHolding,
  type UnallocatedHolding,
  type PhysicalInventory,
} from '@/services/vaultStorage';

describe('reconcileVault — solvent vault', () => {
  const physical: PhysicalInventory = {
    metal: 'gold',
    totalGrams: 10_000,
    allocatedBarsGrams: 7_000,
  };

  it('customer allocated = physical allocated → solvent', () => {
    const allocated: AllocatedHolding[] = [
      { customerId: 'CUST-A', barKeys: ['EGR|B1'], weightGrams: 4_000, metal: 'gold' },
      { customerId: 'CUST-B', barKeys: ['EGR|B2'], weightGrams: 3_000, metal: 'gold' },
    ];
    const unallocated: UnallocatedHolding[] = [
      { customerId: 'CUST-C', weightGrams: 2_000, metal: 'gold' },
      { customerId: 'CUST-D', weightGrams: 1_000, metal: 'gold' },
    ];
    const position = reconcileVault('V1', '2026-04-10', 'gold', physical, allocated, unallocated);
    expect(position.isSolvent).toBe(true);
    expect(position.overAllocationGrams).toBe(0);
    expect(position.overUnallocatedGrams).toBe(0);
    expect(position.physicalUnallocatedPoolGrams).toBe(3_000);
  });
});

describe('reconcileVault — insolvency detection', () => {
  const physical: PhysicalInventory = {
    metal: 'gold',
    totalGrams: 5_000,
    allocatedBarsGrams: 3_000,
  };

  it('customer claims exceed allocated physical → OVER_ALLOCATED', () => {
    const allocated: AllocatedHolding[] = [
      { customerId: 'CUST-A', barKeys: ['X'], weightGrams: 4_000, metal: 'gold' }, // claim > phys 3K
    ];
    const position = reconcileVault('V1', '2026-04-10', 'gold', physical, allocated, []);
    expect(position.isSolvent).toBe(false);
    expect(position.overAllocationGrams).toBe(1_000);
  });

  it('customer unallocated claims exceed pool → over-unallocated', () => {
    const unallocated: UnallocatedHolding[] = [
      { customerId: 'CUST-C', weightGrams: 3_000, metal: 'gold' }, // pool is 2K
    ];
    const position = reconcileVault('V1', '2026-04-10', 'gold', physical, [], unallocated);
    expect(position.isSolvent).toBe(false);
    expect(position.overUnallocatedGrams).toBe(1_000);
  });

  it('both violations tracked independently', () => {
    const allocated: AllocatedHolding[] = [
      { customerId: 'A', barKeys: [], weightGrams: 4_000, metal: 'gold' },
    ];
    const unallocated: UnallocatedHolding[] = [
      { customerId: 'B', weightGrams: 3_000, metal: 'gold' },
    ];
    const position = reconcileVault('V1', '2026-04-10', 'gold', physical, allocated, unallocated);
    expect(position.overAllocationGrams).toBeGreaterThan(0);
    expect(position.overUnallocatedGrams).toBeGreaterThan(0);
  });
});

describe('reconcileVault — metal mismatch', () => {
  it('throws when physical metal ≠ requested metal', () => {
    const physical: PhysicalInventory = { metal: 'silver', totalGrams: 100, allocatedBarsGrams: 50 };
    expect(() =>
      reconcileVault('V1', '2026-04-10', 'gold', physical, [], []),
    ).toThrow(/mismatch/);
  });
});

describe('customerExposure', () => {
  it('100% allocated → low risk', () => {
    const result = customerExposure(
      'A',
      'gold',
      [{ customerId: 'A', barKeys: [], weightGrams: 1000, metal: 'gold' }],
      [],
    );
    expect(result.riskTier).toBe('low');
    expect(result.unallocatedRatio).toBe(0);
  });

  it('100% unallocated → high risk', () => {
    const result = customerExposure(
      'A',
      'gold',
      [],
      [{ customerId: 'A', weightGrams: 1000, metal: 'gold' }],
    );
    expect(result.riskTier).toBe('high');
    expect(result.unallocatedRatio).toBe(1);
  });

  it('50/50 → medium risk', () => {
    const result = customerExposure(
      'A',
      'gold',
      [{ customerId: 'A', barKeys: [], weightGrams: 500, metal: 'gold' }],
      [{ customerId: 'A', weightGrams: 500, metal: 'gold' }],
    );
    expect(result.riskTier).toBe('medium');
    expect(result.unallocatedRatio).toBe(0.5);
  });

  it('excludes other customers from the total', () => {
    const result = customerExposure(
      'A',
      'gold',
      [
        { customerId: 'A', barKeys: [], weightGrams: 500, metal: 'gold' },
        { customerId: 'B', barKeys: [], weightGrams: 9000, metal: 'gold' },
      ],
      [],
    );
    expect(result.totalGrams).toBe(500);
  });

  it('filters to the requested metal', () => {
    const result = customerExposure(
      'A',
      'gold',
      [
        { customerId: 'A', barKeys: [], weightGrams: 500, metal: 'gold' },
        { customerId: 'A', barKeys: [], weightGrams: 9000, metal: 'silver' },
      ],
      [],
    );
    expect(result.totalGrams).toBe(500);
  });
});

describe('positionToBrainEvent', () => {
  it('returns null when vault is solvent', () => {
    const physical: PhysicalInventory = {
      metal: 'gold',
      totalGrams: 10_000,
      allocatedBarsGrams: 5_000,
    };
    const position = reconcileVault('V1', '2026-04-10', 'gold', physical, [], []);
    expect(positionToBrainEvent(position)).toBeNull();
  });

  it('returns critical brain event when insolvent', () => {
    const physical: PhysicalInventory = {
      metal: 'gold',
      totalGrams: 5_000,
      allocatedBarsGrams: 3_000,
    };
    const allocated: AllocatedHolding[] = [
      { customerId: 'A', barKeys: [], weightGrams: 4_000, metal: 'gold' },
    ];
    const position = reconcileVault('V1', '2026-04-10', 'gold', physical, allocated, []);
    const event = positionToBrainEvent(position);
    expect(event).not.toBeNull();
    expect(event?.kind).toBe('evidence_break');
    expect(event?.severity).toBe('critical');
  });
});
