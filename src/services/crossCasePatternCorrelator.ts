/**
 * Cross-Case Pattern Correlator — a new brain subsystem that finds
 * multi-case patterns the single-case weaponized brain cannot see.
 *
 * Why: every subsystem upstream of this one reasons about one entity
 * at a time. That's a massive blind spot — money-laundering typologies
 * are defined by RELATIONSHIPS between cases:
 *
 *   - Smurfing/structuring across many accounts that each stay under
 *     AED 55K individually (MoE Circular 08/AML/2021)
 *   - Shared wallet addresses across different "customers"
 *     (FATF Rec 15 — VASPs)
 *   - Shell-company rings where the same UBO controls multiple
 *     layered entities (Cabinet Decision 109/2023)
 *   - Address reuse across supposedly-unrelated entities (FATF Rec 10)
 *   - Timing clusters: many case openings within a short window
 *     targeting the same sanctioned-country corridor (FATF Rec 6)
 *   - Repeated transaction narratives verbatim (copy-paste shell orders)
 *
 * This module is a PURE function: given a bag of historical case
 * snapshots, it returns a set of detected correlations. It does not
 * persist anything. The caller (runSuperDecision, or a scheduled
 * correlator job) decides what to do with the findings.
 *
 * Design principles:
 *   - Deterministic: same input → same output (tests can rely on this).
 *   - O(n log n) per pattern: we hash + group rather than O(n²).
 *   - Explainable: every finding carries the contributing case ids,
 *     the regulatory basis, and a confidence 0..1.
 *   - Never tip off: the correlator receives hashed or pseudonymised
 *     identifiers; it never emits entity legal names.
 *
 * Regulatory basis:
 *   FATF Rec 6, 10, 15, 20, 23       — risk-based + VASP + DPMS
 *   MoE Circular 08/AML/2021         — structuring, wire typologies
 *   Cabinet Decision 109/2023        — beneficial ownership
 *   Cabinet Res 74/2020 Art.4-7      — sanctions ring detection
 *   FDL No.10/2025 Art.20-21, Art.29 — CO reasoning + no tipping off
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CaseSnapshot {
  /** Opaque case id — must be unique across the input bag. */
  caseId: string;
  /** Tenant scope so findings do not leak across tenants. */
  tenantId: string;
  /** Snapshot open time (ISO) for temporal-cluster detection. */
  openedAt: string;
  /** Opaque entity identifier — NOT the entity legal name. */
  entityRef: string;
  /** UBO identifiers observed on the case. Opaque refs. */
  uboRefs?: readonly string[];
  /** Wallet addresses (lower-cased) if the case touched crypto. */
  wallets?: readonly string[];
  /** Physical address hash used for address-reuse detection. */
  addressHash?: string;
  /** Country-of-origin / corridor jurisdiction ISO-3166 alpha-2. */
  corridorCountry?: string;
  /** Maximum single-transaction AED value observed on the case. */
  maxTxAED?: number;
  /** Normalised narrative fingerprint (hash of first 200 chars). */
  narrativeHash?: string;
  /** Hash of the sanctioned-name match keys observed during screening. */
  sanctionsMatchKeys?: readonly string[];
}

export type CorrelationKind =
  | 'structuring-cluster'
  | 'wallet-reuse'
  | 'shared-ubo-ring'
  | 'address-reuse'
  | 'corridor-burst'
  | 'narrative-copypaste'
  | 'sanctions-key-reuse';

export interface Correlation {
  kind: CorrelationKind;
  /** Stable id for this specific finding — `<kind>:<grouping-key>`. */
  id: string;
  /** Case ids contributing to this correlation (>=2). */
  caseIds: readonly string[];
  /** Confidence 0..1. Higher = tighter pattern. */
  confidence: number;
  /** Severity band mapped from confidence + kind. */
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  /** Plain-English description (no entity names — audit-safe). */
  description: string;
  /** Regulatory basis citation. */
  regulatory: string;
}

export interface CorrelatorConfig {
  /** Min cases to form a cluster for structuring detection. Default 3. */
  minStructuringCluster?: number;
  /** Temporal window for structuring detection (hours). Default 168. */
  structuringWindowHours?: number;
  /** Max single-tx AED to count as structuring. Default 55_000. */
  structuringMaxTxAED?: number;
  /** Min cases for a corridor burst. Default 5. */
  minCorridorBurst?: number;
  /** Temporal window for corridor burst (hours). Default 24. */
  corridorBurstWindowHours?: number;
  /** Tenant id to scope findings to — required for safety. */
  tenantId: string;
}

export interface CorrelationReport {
  tenantId: string;
  caseCount: number;
  correlations: readonly Correlation[];
  /** Top-level severity summary across all correlations. */
  topSeverity: Correlation['severity'];
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<Correlation['severity'], number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function severityFromConfidence(
  kind: CorrelationKind,
  confidence: number
): Correlation['severity'] {
  // Critical typologies (wallet reuse, shared UBO, sanctions key reuse)
  // escalate faster; structuring / narrative cluster escalate slower.
  const criticalKinds: CorrelationKind[] = [
    'wallet-reuse',
    'shared-ubo-ring',
    'sanctions-key-reuse',
  ];
  if (criticalKinds.includes(kind)) {
    if (confidence >= 0.8) return 'critical';
    if (confidence >= 0.6) return 'high';
    if (confidence >= 0.4) return 'medium';
    return 'low';
  }
  if (confidence >= 0.85) return 'high';
  if (confidence >= 0.65) return 'medium';
  if (confidence >= 0.45) return 'low';
  return 'info';
}

function groupBy<T, K>(items: readonly T[], keyFn: (item: T) => K | null): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    if (k === null) continue;
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}

function withinWindow(
  snapshots: readonly CaseSnapshot[],
  windowHours: number
): boolean {
  if (snapshots.length < 2) return false;
  const times = snapshots
    .map((s) => Date.parse(s.openedAt))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (times.length < 2) return false;
  const span = times[times.length - 1] - times[0];
  return span <= windowHours * 3_600_000;
}

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

function detectStructuringClusters(
  cases: readonly CaseSnapshot[],
  cfg: Required<CorrelatorConfig>
): Correlation[] {
  // Group cases whose entity opens multiple sub-threshold transactions
  // inside a window. Uses maxTxAED and sharedness of UBOs as signals.
  const findings: Correlation[] = [];
  if (cases.length < cfg.minStructuringCluster) return findings;

  const subThreshold = cases.filter(
    (c) => typeof c.maxTxAED === 'number' && c.maxTxAED <= cfg.structuringMaxTxAED
  );
  if (subThreshold.length < cfg.minStructuringCluster) return findings;

  // Bucket by the first shared UBO ref — same UBO + many sub-threshold
  // cases within the window is a classic smurfing signal.
  const byFirstUbo = groupBy(subThreshold, (c) =>
    c.uboRefs && c.uboRefs.length > 0 ? c.uboRefs[0] : null
  );
  for (const [ubo, bucket] of byFirstUbo) {
    if (bucket.length >= cfg.minStructuringCluster && withinWindow(bucket, cfg.structuringWindowHours)) {
      const confidence = Math.min(1, bucket.length / 10 + 0.4);
      findings.push({
        kind: 'structuring-cluster',
        id: `structuring-cluster:${hashString(ubo)}`,
        caseIds: bucket.map((c) => c.caseId),
        confidence,
        severity: severityFromConfidence('structuring-cluster', confidence),
        description: `${bucket.length} sub-threshold transactions across cases sharing a common UBO within ${cfg.structuringWindowHours}h — potential structuring per MoE Circular 08/AML/2021.`,
        regulatory: 'MoE Circular 08/AML/2021; FDL No.10/2025 Art.16',
      });
    }
  }
  return findings;
}

function detectWalletReuse(cases: readonly CaseSnapshot[]): Correlation[] {
  // Group by every wallet. If the same wallet appears on 2+ distinct
  // entities it's a VASP red flag per FATF Rec 15.
  const map = new Map<string, Set<string>>(); // wallet → caseIds
  for (const c of cases) {
    if (!c.wallets) continue;
    for (const w of c.wallets) {
      const key = w.toLowerCase();
      const bucket = map.get(key) ?? new Set<string>();
      bucket.add(c.caseId);
      map.set(key, bucket);
    }
  }

  const findings: Correlation[] = [];
  for (const [wallet, caseIds] of map) {
    if (caseIds.size >= 2) {
      const confidence = Math.min(1, caseIds.size * 0.3 + 0.4);
      findings.push({
        kind: 'wallet-reuse',
        id: `wallet-reuse:${hashString(wallet)}`,
        caseIds: Array.from(caseIds),
        confidence,
        severity: severityFromConfidence('wallet-reuse', confidence),
        description: `${caseIds.size} distinct cases share the same wallet address — virtual asset pooling signal per FATF Rec 15.`,
        regulatory: 'FATF Rec 15; FDL No.10/2025 Art.20',
      });
    }
  }
  return findings;
}

function detectSharedUboRings(cases: readonly CaseSnapshot[]): Correlation[] {
  // Group by UBO ref; any UBO controlling >=2 supposedly-distinct
  // entities is a shell-company ring under Cabinet Decision 109/2023.
  const map = new Map<string, Set<string>>(); // ubo → caseIds
  for (const c of cases) {
    if (!c.uboRefs) continue;
    for (const u of c.uboRefs) {
      const bucket = map.get(u) ?? new Set<string>();
      bucket.add(c.caseId);
      map.set(u, bucket);
    }
  }

  const findings: Correlation[] = [];
  for (const [ubo, caseIds] of map) {
    if (caseIds.size >= 2) {
      const confidence = Math.min(1, caseIds.size * 0.25 + 0.4);
      findings.push({
        kind: 'shared-ubo-ring',
        id: `shared-ubo-ring:${hashString(ubo)}`,
        caseIds: Array.from(caseIds),
        confidence,
        severity: severityFromConfidence('shared-ubo-ring', confidence),
        description: `${caseIds.size} distinct entities share the same beneficial owner — potential shell-company ring per Cabinet Decision 109/2023.`,
        regulatory: 'Cabinet Decision 109/2023; FATF Rec 24-25',
      });
    }
  }
  return findings;
}

function detectAddressReuse(cases: readonly CaseSnapshot[]): Correlation[] {
  const map = new Map<string, Set<string>>(); // addressHash → caseIds
  for (const c of cases) {
    if (!c.addressHash) continue;
    const bucket = map.get(c.addressHash) ?? new Set<string>();
    bucket.add(c.caseId);
    map.set(c.addressHash, bucket);
  }
  const findings: Correlation[] = [];
  for (const [hash, caseIds] of map) {
    if (caseIds.size >= 2) {
      const confidence = Math.min(1, caseIds.size * 0.2 + 0.35);
      findings.push({
        kind: 'address-reuse',
        id: `address-reuse:${hash.slice(0, 12)}`,
        caseIds: Array.from(caseIds),
        confidence,
        severity: severityFromConfidence('address-reuse', confidence),
        description: `${caseIds.size} distinct cases registered at the same physical address — verify whether entities are truly independent (FATF Rec 10).`,
        regulatory: 'FATF Rec 10',
      });
    }
  }
  return findings;
}

function detectCorridorBursts(
  cases: readonly CaseSnapshot[],
  cfg: Required<CorrelatorConfig>
): Correlation[] {
  // Group cases by corridorCountry and look for N+ cases within a short
  // temporal window — indicates coordinated campaign (typology burst).
  const byCorridor = groupBy(cases, (c) => c.corridorCountry ?? null);
  const findings: Correlation[] = [];
  for (const [country, bucket] of byCorridor) {
    if (bucket.length >= cfg.minCorridorBurst && withinWindow(bucket, cfg.corridorBurstWindowHours)) {
      const confidence = Math.min(1, bucket.length / 15 + 0.5);
      findings.push({
        kind: 'corridor-burst',
        id: `corridor-burst:${country}`,
        caseIds: bucket.map((c) => c.caseId),
        confidence,
        severity: severityFromConfidence('corridor-burst', confidence),
        description: `${bucket.length} cases opened within ${cfg.corridorBurstWindowHours}h targeting corridor ${country} — potential coordinated typology per FATF Rec 20.`,
        regulatory: 'FATF Rec 20; Cabinet Res 74/2020 Art.4',
      });
    }
  }
  return findings;
}

function detectNarrativeCopypaste(cases: readonly CaseSnapshot[]): Correlation[] {
  const map = new Map<string, Set<string>>(); // hash → caseIds
  for (const c of cases) {
    if (!c.narrativeHash) continue;
    const bucket = map.get(c.narrativeHash) ?? new Set<string>();
    bucket.add(c.caseId);
    map.set(c.narrativeHash, bucket);
  }
  const findings: Correlation[] = [];
  for (const [hash, caseIds] of map) {
    if (caseIds.size >= 2) {
      const confidence = Math.min(1, caseIds.size * 0.2 + 0.3);
      findings.push({
        kind: 'narrative-copypaste',
        id: `narrative-copypaste:${hash.slice(0, 12)}`,
        caseIds: Array.from(caseIds),
        confidence,
        severity: severityFromConfidence('narrative-copypaste', confidence),
        description: `${caseIds.size} cases share the same STR narrative fingerprint — copy-paste signal per FATF Rec 20.`,
        regulatory: 'FATF Rec 20; FDL No.10/2025 Art.26-27',
      });
    }
  }
  return findings;
}

function detectSanctionsKeyReuse(cases: readonly CaseSnapshot[]): Correlation[] {
  const map = new Map<string, Set<string>>(); // key → caseIds
  for (const c of cases) {
    if (!c.sanctionsMatchKeys) continue;
    for (const key of c.sanctionsMatchKeys) {
      const bucket = map.get(key) ?? new Set<string>();
      bucket.add(c.caseId);
      map.set(key, bucket);
    }
  }
  const findings: Correlation[] = [];
  for (const [key, caseIds] of map) {
    if (caseIds.size >= 2) {
      const confidence = Math.min(1, caseIds.size * 0.35 + 0.5);
      findings.push({
        kind: 'sanctions-key-reuse',
        id: `sanctions-key-reuse:${hashString(key)}`,
        caseIds: Array.from(caseIds),
        confidence,
        severity: severityFromConfidence('sanctions-key-reuse', confidence),
        description: `${caseIds.size} cases share a sanctions list match key — potential evasion via name variants per Cabinet Res 74/2020 Art.4.`,
        regulatory: 'Cabinet Res 74/2020 Art.4-7; FATF Rec 6',
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = {
  minStructuringCluster: 3,
  structuringWindowHours: 168,
  structuringMaxTxAED: 55_000,
  minCorridorBurst: 5,
  corridorBurstWindowHours: 24,
} as const;

/**
 * Correlate a bag of case snapshots and return every detected pattern.
 * Snapshots from other tenants are silently dropped for isolation.
 *
 * The returned findings are sorted by severity then confidence so the
 * top entry is always the most urgent.
 */
export function correlateCrossCases(
  cases: readonly CaseSnapshot[],
  cfg: CorrelatorConfig
): CorrelationReport {
  const full: Required<CorrelatorConfig> = {
    minStructuringCluster: cfg.minStructuringCluster ?? DEFAULT_CONFIG.minStructuringCluster,
    structuringWindowHours: cfg.structuringWindowHours ?? DEFAULT_CONFIG.structuringWindowHours,
    structuringMaxTxAED: cfg.structuringMaxTxAED ?? DEFAULT_CONFIG.structuringMaxTxAED,
    minCorridorBurst: cfg.minCorridorBurst ?? DEFAULT_CONFIG.minCorridorBurst,
    corridorBurstWindowHours: cfg.corridorBurstWindowHours ?? DEFAULT_CONFIG.corridorBurstWindowHours,
    tenantId: cfg.tenantId,
  };
  const scoped = cases.filter((c) => c.tenantId === cfg.tenantId);

  const correlations: Correlation[] = [
    ...detectStructuringClusters(scoped, full),
    ...detectWalletReuse(scoped),
    ...detectSharedUboRings(scoped),
    ...detectAddressReuse(scoped),
    ...detectCorridorBursts(scoped, full),
    ...detectNarrativeCopypaste(scoped),
    ...detectSanctionsKeyReuse(scoped),
  ];

  correlations.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.confidence - a.confidence
  );

  let topSeverity: Correlation['severity'] = 'info';
  for (const c of correlations) {
    if (SEVERITY_RANK[c.severity] > SEVERITY_RANK[topSeverity]) topSeverity = c.severity;
  }

  return {
    tenantId: cfg.tenantId,
    caseCount: scoped.length,
    correlations,
    topSeverity,
  };
}

/**
 * Tiny synchronous FNV-1a 32-bit hash used for stable finding ids.
 * Not cryptographic — purely for short, stable correlation keys.
 */
function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// Exports for tests.
export const __test__ = {
  hashString,
  withinWindow,
  severityFromConfidence,
};
