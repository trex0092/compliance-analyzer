/**
 * Allocated vs Unallocated Vault Storage Tracking.
 *
 * LBMA vault storage has two fundamentally different legal regimes:
 *
 * ALLOCATED:
 *   - Customer owns specific bars, by serial number
 *   - Bars are segregated, tagged, and uniquely identified to the customer
 *   - In insolvency, allocated bars are NOT part of the vault's estate
 *   - Higher storage fees, lower systemic risk
 *
 * UNALLOCATED:
 *   - Customer has a claim on a POOL of metal
 *   - Vault operator owes the customer a quantity; no specific bars
 *   - Customer is an unsecured creditor in insolvency
 *   - Lower fees, higher counterparty risk
 *   - The vault can rehypothecate (with some restrictions)
 *
 * This module:
 *   1. Tracks the allocated-vs-unallocated position per customer
 *   2. Enforces the invariant: Σ allocated bars + unallocated pool ≤ physical inventory
 *   3. Detects over-allocation (vault owes more than it holds)
 *   4. Computes per-customer exposure and vault-wide reconciliation
 *
 * Regulatory: LBMA Vault Operator Code of Conduct, FATF Typology on
 * Unallocated Gold 2023, DGD vault rules, UAE Central Bank guidance
 * on custodial gold.
 */

import type { Metal } from './fineness';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AllocatedHolding {
  customerId: string;
  /** Bar references: refinerId|serial */
  barKeys: string[];
  /** Total weight in grams (sum of the bar weights). */
  weightGrams: number;
  metal: Metal;
}

export interface UnallocatedHolding {
  customerId: string;
  /** Claim on pool in grams. */
  weightGrams: number;
  metal: Metal;
}

export interface PhysicalInventory {
  metal: Metal;
  /** Total physical grams in the vault, regardless of allocation status. */
  totalGrams: number;
  /** Sum of weights of bars marked as allocated. */
  allocatedBarsGrams: number;
}

export interface VaultPosition {
  vaultId: string;
  asOf: string;
  metal: Metal;
  physicalTotalGrams: number;
  physicalAllocatedGrams: number;
  physicalUnallocatedPoolGrams: number; // total - allocated
  customerAllocatedGrams: number; // sum over AllocatedHolding
  customerUnallocatedGrams: number; // sum over UnallocatedHolding
  isSolvent: boolean;
  overAllocationGrams: number; // how much vault owes over what it holds
  overUnallocatedGrams: number; // how much of the unallocated pool is "phantom"
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export function reconcileVault(
  vaultId: string,
  asOf: string,
  metal: Metal,
  physical: PhysicalInventory,
  allocated: readonly AllocatedHolding[],
  unallocated: readonly UnallocatedHolding[],
): VaultPosition {
  if (physical.metal !== metal) {
    throw new Error(`reconcileVault: metal mismatch`);
  }

  const customerAllocated = allocated
    .filter((h) => h.metal === metal)
    .reduce((s, h) => s + h.weightGrams, 0);
  const customerUnallocated = unallocated
    .filter((h) => h.metal === metal)
    .reduce((s, h) => s + h.weightGrams, 0);

  const physicalUnallocatedPool = Math.max(
    0,
    physical.totalGrams - physical.allocatedBarsGrams,
  );

  // Allocated solvency: customer's allocated claims must match the
  // physical bars marked as allocated.
  const overAllocated = Math.max(0, customerAllocated - physical.allocatedBarsGrams);

  // Unallocated solvency: customer's pool claims must not exceed the
  // unallocated physical pool.
  const overUnallocated = Math.max(0, customerUnallocated - physicalUnallocatedPool);

  const isSolvent = overAllocated === 0 && overUnallocated === 0;

  return {
    vaultId,
    asOf,
    metal,
    physicalTotalGrams: physical.totalGrams,
    physicalAllocatedGrams: physical.allocatedBarsGrams,
    physicalUnallocatedPoolGrams: physicalUnallocatedPool,
    customerAllocatedGrams: customerAllocated,
    customerUnallocatedGrams: customerUnallocated,
    isSolvent,
    overAllocationGrams: Math.round(overAllocated * 1000) / 1000,
    overUnallocatedGrams: Math.round(overUnallocated * 1000) / 1000,
  };
}

// ---------------------------------------------------------------------------
// Per-customer exposure
// ---------------------------------------------------------------------------

export interface CustomerExposure {
  customerId: string;
  metal: Metal;
  allocatedGrams: number;
  unallocatedGrams: number;
  totalGrams: number;
  /** Ratio of unallocated to total — higher = higher counterparty risk. */
  unallocatedRatio: number;
  /** Rehypothecation risk tier. */
  riskTier: 'low' | 'medium' | 'high';
}

export function customerExposure(
  customerId: string,
  metal: Metal,
  allocated: readonly AllocatedHolding[],
  unallocated: readonly UnallocatedHolding[],
): CustomerExposure {
  const allocatedGrams = allocated
    .filter((h) => h.customerId === customerId && h.metal === metal)
    .reduce((s, h) => s + h.weightGrams, 0);
  const unallocatedGrams = unallocated
    .filter((h) => h.customerId === customerId && h.metal === metal)
    .reduce((s, h) => s + h.weightGrams, 0);
  const total = allocatedGrams + unallocatedGrams;
  const ratio = total === 0 ? 0 : unallocatedGrams / total;

  let riskTier: CustomerExposure['riskTier'];
  if (ratio >= 0.75) riskTier = 'high';
  else if (ratio >= 0.25) riskTier = 'medium';
  else riskTier = 'low';

  return {
    customerId,
    metal,
    allocatedGrams: Math.round(allocatedGrams * 1000) / 1000,
    unallocatedGrams: Math.round(unallocatedGrams * 1000) / 1000,
    totalGrams: Math.round(total * 1000) / 1000,
    unallocatedRatio: Math.round(ratio * 10000) / 10000,
    riskTier,
  };
}

// ---------------------------------------------------------------------------
// Brain event mapping
// ---------------------------------------------------------------------------

export function positionToBrainEvent(
  position: VaultPosition,
): Record<string, unknown> | null {
  if (position.isSolvent) return null;

  const severity = 'critical' as const;
  return {
    kind: 'evidence_break', // over-allocation is an integrity incident
    severity,
    summary: `Vault ${position.vaultId} OVER-ALLOCATED: ${position.overAllocationGrams}g allocated, ${position.overUnallocatedGrams}g unallocated pool deficit`,
    refId: `${position.vaultId}-${position.asOf.slice(0, 10)}`,
    meta: {
      source: 'vault-storage-reconciliation',
      metal: position.metal,
      physicalTotalGrams: position.physicalTotalGrams,
      customerAllocatedGrams: position.customerAllocatedGrams,
      customerUnallocatedGrams: position.customerUnallocatedGrams,
      overAllocationGrams: position.overAllocationGrams,
      overUnallocatedGrams: position.overUnallocatedGrams,
    },
  };
}
