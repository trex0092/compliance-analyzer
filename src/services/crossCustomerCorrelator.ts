/**
 * Cross-Customer Correlator — shared-signal detection across entities.
 *
 * Phase 2 weaponization subsystem #29.
 *
 * The per-entity subsystems (UBO, wallets, adverse media) can't see
 * patterns that only become visible when you correlate across entities:
 * the same UBO appearing behind three shell companies, the same wallet
 * address funding multiple customers, the same PEP as the signatory on
 * unrelated accounts. The cross-customer correlator detects these shared
 * signals and emits a correlation report for the MLRO.
 *
 * This is a pure-function graph-style correlator. No database, no
 * network calls — the caller feeds a snapshot of all customer records
 * and the correlator returns matches.
 *
 * Regulatory basis:
 *   - Cabinet Decision 109/2023 (UBO register — cross-entity visibility)
 *   - FATF Rec 10, 11 (customer due diligence + record-keeping)
 *   - FDL No.10/2025 Art.12-14 (CDD obligations)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CustomerSnapshot {
  customerId: string;
  customerName: string;
  uboIds?: string[];
  walletAddresses?: string[];
  pepNames?: string[];
  sharedPhone?: string;
  sharedEmail?: string;
  sharedAddress?: string;
}

export interface CorrelationHit {
  /** Type of shared signal (ubo, wallet, pep, phone, email, address). */
  kind: 'ubo' | 'wallet' | 'pep' | 'phone' | 'email' | 'address';
  /** The shared identifier. */
  value: string;
  /** The customers sharing this signal. */
  customerIds: string[];
}

export interface CorrelationReport {
  hits: CorrelationHit[];
  /** Count of hits by kind. */
  countsByKind: Record<CorrelationHit['kind'], number>;
  narrative: string;
}

// ---------------------------------------------------------------------------
// Correlator
// ---------------------------------------------------------------------------

export function correlateAcrossCustomers(
  snapshots: readonly CustomerSnapshot[]
): CorrelationReport {
  const uboMap = new Map<string, string[]>();
  const walletMap = new Map<string, string[]>();
  const pepMap = new Map<string, string[]>();
  const phoneMap = new Map<string, string[]>();
  const emailMap = new Map<string, string[]>();
  const addressMap = new Map<string, string[]>();

  const addToMap = (map: Map<string, string[]>, key: string, customerId: string) => {
    const list = map.get(key) ?? [];
    if (!list.includes(customerId)) list.push(customerId);
    map.set(key, list);
  };

  for (const s of snapshots) {
    for (const u of s.uboIds ?? []) addToMap(uboMap, u, s.customerId);
    for (const w of s.walletAddresses ?? []) addToMap(walletMap, w, s.customerId);
    for (const p of s.pepNames ?? []) addToMap(pepMap, p.toLowerCase(), s.customerId);
    if (s.sharedPhone) addToMap(phoneMap, s.sharedPhone, s.customerId);
    if (s.sharedEmail) addToMap(emailMap, s.sharedEmail.toLowerCase(), s.customerId);
    if (s.sharedAddress) addToMap(addressMap, s.sharedAddress.toLowerCase(), s.customerId);
  }

  const hits: CorrelationHit[] = [];
  const pushHits = (map: Map<string, string[]>, kind: CorrelationHit['kind']) => {
    for (const [value, customerIds] of map) {
      if (customerIds.length >= 2) {
        hits.push({ kind, value, customerIds });
      }
    }
  };
  pushHits(uboMap, 'ubo');
  pushHits(walletMap, 'wallet');
  pushHits(pepMap, 'pep');
  pushHits(phoneMap, 'phone');
  pushHits(emailMap, 'email');
  pushHits(addressMap, 'address');

  const countsByKind: Record<CorrelationHit['kind'], number> = {
    ubo: 0,
    wallet: 0,
    pep: 0,
    phone: 0,
    email: 0,
    address: 0,
  };
  for (const h of hits) countsByKind[h.kind] += 1;

  const narrative =
    hits.length === 0
      ? `Cross-customer correlator: no shared signals detected across ${snapshots.length} customer(s).`
      : `Cross-customer correlator: ${hits.length} shared-signal match(es) across ${snapshots.length} customer(s). ` +
        Object.entries(countsByKind)
          .filter(([, c]) => c > 0)
          .map(([k, c]) => `${k}=${c}`)
          .join(', ') +
        '.';

  return { hits, countsByKind, narrative };
}
