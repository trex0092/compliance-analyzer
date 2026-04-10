/**
 * VASP / Crypto Wallet Risk Scoring — FATF Recommendation 15.
 *
 * Gold-for-crypto is a recurring DPMS typology in Dubai. FATF Rec 15
 * (updated 2019) requires VASPs — and any DNFBP that transacts with
 * them — to apply AML/CFT controls including wallet-level screening.
 *
 * This module provides:
 *   - Wallet address normalisation (Bitcoin, Ethereum, Tron, BNB)
 *   - Static blacklist lookup (OFAC wallet list + custom high-risk)
 *   - Heuristic risk scoring:
 *       * direct hit on a sanctioned wallet                → 100
 *       * tagged mixer / tumbler / privacy coin            → 85
 *       * tagged darknet market / ransomware               → 90
 *       * tagged exchange (compliant)                      → 10
 *       * unknown wallet                                    → 0
 *   - Jurisdiction of the VASP (exchange) if known
 *
 * Integration: every wallet that appears in a transaction flows
 * through `scoreWallet()`. Hits trigger a brain event.
 *
 * Note: real chain analytics (Chainalysis, TRM Labs, Elliptic) are
 * commercial products behind expensive API contracts. This module
 * is the offline/fallback layer using publicly-available lists
 * (OFAC CryptoCurrency Addresses) plus a locally-maintained tag file.
 */

// ---------------------------------------------------------------------------
// Address normalisation
// ---------------------------------------------------------------------------

export type Chain =
  | 'BTC'
  | 'ETH'
  | 'USDT_ERC20'
  | 'TRX'
  | 'USDT_TRC20'
  | 'BNB'
  | 'UNKNOWN';

export function detectChain(address: string): Chain {
  const a = address.trim();
  if (/^bc1[a-z0-9]{39,59}$/.test(a)) return 'BTC'; // bech32
  if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(a)) return 'BTC'; // legacy / p2sh
  if (/^0x[a-fA-F0-9]{40}$/.test(a)) return 'ETH'; // includes USDT-ERC20
  if (/^T[a-km-zA-HJ-NP-Z1-9]{33}$/.test(a)) return 'TRX'; // includes USDT-TRC20
  if (/^bnb[a-z0-9]{39}$/.test(a)) return 'BNB';
  return 'UNKNOWN';
}

/** Normalise to lowercase for chains that are case-insensitive. */
export function normaliseAddress(address: string, chain?: Chain): string {
  const c = chain ?? detectChain(address);
  const trimmed = address.trim();
  // Ethereum addresses are case-insensitive for lookup (EIP-55
  // checksum case is semantic but not a different address).
  if (c === 'ETH') return trimmed.toLowerCase();
  return trimmed;
}

// ---------------------------------------------------------------------------
// Wallet tag database (pluggable)
// ---------------------------------------------------------------------------

export type WalletTag =
  | 'sanctioned'
  | 'mixer'
  | 'darknet_market'
  | 'ransomware'
  | 'scam'
  | 'exchange'
  | 'defi'
  | 'privacy_coin'
  | 'bridge'
  | 'gambling';

export interface WalletRecord {
  address: string;
  chain: Chain;
  tags: WalletTag[];
  label?: string;
  /** Source list that contributed this record. */
  source: 'OFAC' | 'UN' | 'CUSTOM' | 'COMMUNITY';
  /** ISO date added. */
  addedAt?: string;
}

export interface WalletDatabase {
  /** Key: `${chain}|${normalisedAddress}`. */
  entries: Map<string, WalletRecord>;
}

export function createWalletDatabase(): WalletDatabase {
  return { entries: new Map() };
}

export function addWallet(db: WalletDatabase, record: WalletRecord): void {
  const chain = record.chain ?? detectChain(record.address);
  const key = `${chain}|${normaliseAddress(record.address, chain)}`;
  db.entries.set(key, record);
}

export function lookupWallet(
  db: WalletDatabase,
  address: string,
  chain?: Chain,
): WalletRecord | null {
  const c = chain ?? detectChain(address);
  const key = `${c}|${normaliseAddress(address, c)}`;
  return db.entries.get(key) ?? null;
}

// ---------------------------------------------------------------------------
// Risk scoring
// ---------------------------------------------------------------------------

export interface WalletRiskAssessment {
  address: string;
  chain: Chain;
  score: number; // 0..100
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  classification: 'clean' | 'watch' | 'potential' | 'confirmed_hit';
  reasons: string[];
  matchedRecord: WalletRecord | null;
}

/**
 * Tag → weight mapping. Higher is worse.
 */
const TAG_WEIGHTS: Record<WalletTag, number> = {
  sanctioned: 100,
  ransomware: 95,
  darknet_market: 90,
  scam: 85,
  mixer: 85,
  privacy_coin: 70,
  gambling: 40,
  bridge: 25,
  defi: 15,
  exchange: 10,
};

export function scoreWallet(
  db: WalletDatabase,
  address: string,
): WalletRiskAssessment {
  const chain = detectChain(address);
  const record = lookupWallet(db, address, chain);

  if (!record) {
    return {
      address,
      chain,
      score: 0,
      severity: 'info',
      classification: 'clean',
      reasons: ['no database entry'],
      matchedRecord: null,
    };
  }

  // Score is the max of any tag's weight (not sum — one bad tag
  // dominates regardless of other tags)
  const score = Math.max(...record.tags.map((t) => TAG_WEIGHTS[t] ?? 0), 0);
  const reasons = record.tags.map((t) => `Tagged as ${t.replace(/_/g, ' ')}`);
  if (record.label) reasons.push(`Label: ${record.label}`);
  if (record.source) reasons.push(`Source: ${record.source}`);

  let severity: WalletRiskAssessment['severity'];
  let classification: WalletRiskAssessment['classification'];

  if (score >= 90) {
    severity = 'critical';
    classification = 'confirmed_hit';
  } else if (score >= 70) {
    severity = 'high';
    classification = 'potential';
  } else if (score >= 40) {
    severity = 'medium';
    classification = 'watch';
  } else if (score > 0) {
    severity = 'low';
    classification = 'watch';
  } else {
    severity = 'info';
    classification = 'clean';
  }

  return {
    address,
    chain,
    score,
    severity,
    classification,
    reasons,
    matchedRecord: record,
  };
}

// ---------------------------------------------------------------------------
// Batch assessment
// ---------------------------------------------------------------------------

export function scoreWallets(
  db: WalletDatabase,
  addresses: readonly string[],
): WalletRiskAssessment[] {
  return addresses.map((a) => scoreWallet(db, a));
}

/**
 * Aggregate summary for a single customer's wallets.
 */
export interface PortfolioWalletRisk {
  total: number;
  clean: number;
  watch: number;
  potential: number;
  confirmedHits: number;
  highestScore: number;
  hits: WalletRiskAssessment[];
}

export function summarisePortfolioWallets(
  db: WalletDatabase,
  addresses: readonly string[],
): PortfolioWalletRisk {
  const assessments = scoreWallets(db, addresses);
  const summary: PortfolioWalletRisk = {
    total: assessments.length,
    clean: 0,
    watch: 0,
    potential: 0,
    confirmedHits: 0,
    highestScore: 0,
    hits: [],
  };
  for (const a of assessments) {
    if (a.classification === 'clean') summary.clean++;
    else if (a.classification === 'watch') summary.watch++;
    else if (a.classification === 'potential') summary.potential++;
    else if (a.classification === 'confirmed_hit') summary.confirmedHits++;
    if (a.score > summary.highestScore) summary.highestScore = a.score;
    if (a.score > 0) summary.hits.push(a);
  }
  return summary;
}
