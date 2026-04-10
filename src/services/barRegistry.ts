/**
 * Bar / Ingot Registry — serial-number-level ledger for physical metal.
 *
 * Every physical bar in custody is tracked by its serial number.
 * Each event in the bar's life is logged append-only: receipt from
 * a refiner, transfer to a vault, customer allocation, sale,
 * melt-down, export. This is the authoritative answer to "where is
 * bar EGR-2026-000123 right now?" and "when did we last touch it?".
 *
 * A registered bar carries:
 *   - Serial number (unique within refiner)
 *   - Refiner id (cross-checked against accreditation list)
 *   - Metal + fineness + weight
 *   - Current custody location
 *   - Current owner (if allocated)
 *   - Chain of custody events
 *
 * Integration with other modules:
 *   - fineness.ts — validateGoodDelivery() on every register call
 *   - sanctionsIngest.ts — owner name goes through sanctions screen
 *   - timeTravelAudit.ts — the event log is a sub-chain that can be
 *     replayed via replayUntil() logic
 *   - brain.mts — status changes fire brain events for hight-value bars
 *
 * Regulatory: LBMA RGG v9 Step 4/5, DGD chain of custody, MoE 08/AML/2021.
 */

import { validateGoodDelivery, type Metal } from './fineness';

// ---------------------------------------------------------------------------
// Refiner accreditation
// ---------------------------------------------------------------------------

export type RefinerAccreditation =
  | 'LBMA_Good_Delivery'
  | 'Dubai_Good_Delivery'
  | 'COMEX_Approved'
  | 'Shanghai_Gold_Exchange'
  | 'Responsible_Jewellery_Council'
  | 'not_accredited';

export interface Refiner {
  id: string;
  name: string;
  country: string;
  accreditations: RefinerAccreditation[];
  /** ISO date the accreditation was last verified. */
  lastVerifiedAt?: string;
}

export interface RefinerRegistry {
  refiners: Map<string, Refiner>;
}

export function createRefinerRegistry(): RefinerRegistry {
  return { refiners: new Map() };
}

export function registerRefiner(reg: RefinerRegistry, refiner: Refiner): void {
  reg.refiners.set(refiner.id, refiner);
}

export function lookupRefiner(reg: RefinerRegistry, id: string): Refiner | null {
  return reg.refiners.get(id) ?? null;
}

export function isAccredited(refiner: Refiner | null): boolean {
  if (!refiner) return false;
  return refiner.accreditations.some((a) => a !== 'not_accredited');
}

// ---------------------------------------------------------------------------
// Bar record + event log
// ---------------------------------------------------------------------------

export type BarStatus =
  | 'received'
  | 'in_vault_allocated'
  | 'in_vault_unallocated'
  | 'in_transit'
  | 'sold'
  | 'melted_down'
  | 'exported'
  | 'disputed'
  | 'lost';

export type BarEventType =
  | 'receive'
  | 'allocate'
  | 'deallocate'
  | 'transfer'
  | 'sell'
  | 'return'
  | 'melt'
  | 'export'
  | 'dispute'
  | 'mark_lost'
  | 'reassay';

export interface BarEvent {
  at: string;
  type: BarEventType;
  actor: string;
  location?: string;
  counterparty?: string;
  note?: string;
  data?: Record<string, unknown>;
}

export interface Bar {
  serial: string;
  refinerId: string;
  metal: Metal;
  fineness: number;
  weightGrams: number;
  castDate?: string;
  hallmark?: string;
  status: BarStatus;
  currentLocation?: string;
  currentOwner?: string;
  events: BarEvent[];
}

export interface BarRegistry {
  bars: Map<string, Bar>;
  refiners: RefinerRegistry;
}

// ---------------------------------------------------------------------------
// Registry API
// ---------------------------------------------------------------------------

export function createBarRegistry(refiners: RefinerRegistry): BarRegistry {
  return { bars: new Map(), refiners };
}

export interface RegisterBarInput {
  serial: string;
  refinerId: string;
  metal: Metal;
  fineness: number;
  weightGrams: number;
  castDate?: string;
  hallmark?: string;
  initialLocation: string;
  actor: string;
}

export interface RegisterBarResult {
  ok: boolean;
  bar?: Bar;
  errors: string[];
  warnings: string[];
}

/**
 * Register a new bar. Validates the refiner, enforces Good Delivery
 * spec compliance, and opens the event log with the initial `receive`.
 * Duplicate serials within the same refiner are rejected.
 */
export function registerBar(registry: BarRegistry, input: RegisterBarInput): RegisterBarResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.serial || input.serial.length < 4) {
    errors.push('Serial number missing or too short');
  }

  const key = `${input.refinerId}|${input.serial}`;
  if (registry.bars.has(key)) {
    errors.push(`Bar ${key} is already registered`);
  }

  const refiner = lookupRefiner(registry.refiners, input.refinerId);
  if (!refiner) {
    errors.push(`Unknown refiner: ${input.refinerId}`);
  } else if (!isAccredited(refiner)) {
    warnings.push(
      `Refiner "${refiner.name}" is not accredited by any recognised body — bar requires enhanced due diligence`
    );
  }

  // Good Delivery spec check — failure becomes a warning, not an error,
  // because sub-spec bars still exist in the wild (small bars, jewellery
  // ingots). The warning tells the MLRO to apply higher scrutiny.
  const gdCheck = validateGoodDelivery(input.metal, input.fineness, input.weightGrams);
  if (!gdCheck.ok) {
    for (const err of gdCheck.errors) {
      warnings.push(`Good Delivery spec: ${err}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  const bar: Bar = {
    serial: input.serial,
    refinerId: input.refinerId,
    metal: input.metal,
    fineness: input.fineness,
    weightGrams: input.weightGrams,
    castDate: input.castDate,
    hallmark: input.hallmark,
    status: 'received',
    currentLocation: input.initialLocation,
    currentOwner: undefined,
    events: [
      {
        at: new Date().toISOString(),
        type: 'receive',
        actor: input.actor,
        location: input.initialLocation,
      },
    ],
  };

  registry.bars.set(key, bar);
  return { ok: true, bar, errors: [], warnings };
}

export function lookupBar(registry: BarRegistry, refinerId: string, serial: string): Bar | null {
  return registry.bars.get(`${refinerId}|${serial}`) ?? null;
}

// ---------------------------------------------------------------------------
// Event recording — state transitions with guards
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<BarStatus, BarStatus[]> = {
  received: ['in_vault_allocated', 'in_vault_unallocated', 'in_transit', 'disputed', 'lost'],
  in_vault_unallocated: [
    'in_vault_allocated',
    'in_transit',
    'sold',
    'melted_down',
    'exported',
    'disputed',
    'lost',
  ],
  in_vault_allocated: [
    'in_vault_unallocated',
    'in_transit',
    'sold',
    'exported',
    'disputed',
    'lost',
  ],
  in_transit: [
    'in_vault_allocated',
    'in_vault_unallocated',
    'sold',
    'exported',
    'disputed',
    'lost',
  ],
  sold: ['returned' as BarStatus, 'disputed'], // 'returned' pseudo-status, maps to in_vault_*
  melted_down: [], // terminal
  exported: ['disputed'], // terminal unless disputed
  disputed: [
    'in_vault_unallocated',
    'in_vault_allocated',
    'sold',
    'melted_down',
    'exported',
    'lost',
  ],
  lost: ['disputed'], // found again = disputed until resolved
};

export interface RecordEventInput {
  refinerId: string;
  serial: string;
  event: BarEventType;
  actor: string;
  newStatus?: BarStatus;
  newLocation?: string;
  newOwner?: string;
  counterparty?: string;
  note?: string;
  data?: Record<string, unknown>;
}

export interface RecordEventResult {
  ok: boolean;
  bar?: Bar;
  errors: string[];
}

export function recordBarEvent(registry: BarRegistry, input: RecordEventInput): RecordEventResult {
  const errors: string[] = [];
  const bar = lookupBar(registry, input.refinerId, input.serial);
  if (!bar) {
    errors.push(`Bar ${input.refinerId}|${input.serial} not found`);
    return { ok: false, errors };
  }

  // Transition guard
  if (input.newStatus) {
    const allowed = VALID_TRANSITIONS[bar.status] ?? [];
    if (!allowed.includes(input.newStatus) && input.newStatus !== bar.status) {
      errors.push(`Invalid state transition: ${bar.status} → ${input.newStatus}`);
      return { ok: false, errors };
    }
    bar.status = input.newStatus;
  }

  if (input.newLocation !== undefined) bar.currentLocation = input.newLocation;
  if (input.newOwner !== undefined) bar.currentOwner = input.newOwner;

  bar.events.push({
    at: new Date().toISOString(),
    type: input.event,
    actor: input.actor,
    location: input.newLocation,
    counterparty: input.counterparty,
    note: input.note,
    data: input.data,
  });

  return { ok: true, bar, errors: [] };
}

// ---------------------------------------------------------------------------
// Aggregate queries
// ---------------------------------------------------------------------------

export interface VaultReport {
  location: string;
  totalBars: number;
  totalWeightGrams: number;
  byMetal: Record<Metal, { count: number; weightGrams: number }>;
  allocated: number;
  unallocated: number;
}

export function vaultReport(registry: BarRegistry, location: string): VaultReport {
  const report: VaultReport = {
    location,
    totalBars: 0,
    totalWeightGrams: 0,
    byMetal: {
      gold: { count: 0, weightGrams: 0 },
      silver: { count: 0, weightGrams: 0 },
      platinum: { count: 0, weightGrams: 0 },
      palladium: { count: 0, weightGrams: 0 },
    },
    allocated: 0,
    unallocated: 0,
  };
  for (const bar of registry.bars.values()) {
    if (bar.currentLocation !== location) continue;
    if (bar.status !== 'in_vault_allocated' && bar.status !== 'in_vault_unallocated') continue;
    report.totalBars++;
    report.totalWeightGrams += bar.weightGrams;
    report.byMetal[bar.metal].count++;
    report.byMetal[bar.metal].weightGrams += bar.weightGrams;
    if (bar.status === 'in_vault_allocated') report.allocated++;
    else report.unallocated++;
  }
  return report;
}

export function findBarsByOwner(registry: BarRegistry, owner: string): Bar[] {
  const out: Bar[] = [];
  for (const bar of registry.bars.values()) {
    if (bar.currentOwner === owner) out.push(bar);
  }
  return out;
}

export function findBarsByStatus(registry: BarRegistry, status: BarStatus): Bar[] {
  const out: Bar[] = [];
  for (const bar of registry.bars.values()) {
    if (bar.status === status) out.push(bar);
  }
  return out;
}
