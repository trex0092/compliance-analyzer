/**
 * Crypto wallet screening — lightweight heuristic layer + pluggable
 * provider interface for TRM Labs / Chainalysis / Elliptic.
 *
 * Phase 1 (this file): deterministic address validation + denylist
 * lookup + risk heuristics (mixer/tumbler patterns, sanctioned-entity
 * addresses from OFAC SDN crypto list).
 *
 * Phase 2 (stub interface): external-provider screen, wired via the
 * `CryptoProvider` interface. Callers must sign the provider contract
 * covering data-residency + no-tipping-off (FDL Art.29).
 */

export type CryptoNetwork =
  | 'BTC'
  | 'ETH'
  | 'TRX'
  | 'XRP'
  | 'USDT-TRC20'
  | 'USDT-ERC20'
  | 'USDC-ERC20'
  | 'BNB'
  | 'SOL';

export interface WalletScreenInput {
  address: string;
  network: CryptoNetwork;
  /** Optional transaction context for TBML heuristics. */
  volumeLast30dUsd?: number;
  counterpartyCount?: number;
}

export interface WalletRiskSignal {
  id: string;
  label: string;
  weight: number;
  evidence: string;
}

export interface WalletScreenResult {
  address: string;
  network: CryptoNetwork;
  addressValid: boolean;
  onSanctionsList: boolean;
  riskScore: number;
  signals: WalletRiskSignal[];
  sources: string[];
}

export interface SanctionedCryptoEntry {
  address: string;
  network: CryptoNetwork;
  source: string;
  linkedEntity?: string;
}

export interface CryptoProvider {
  screen(input: WalletScreenInput): Promise<WalletScreenResult>;
  name: string;
}

export function validateAddress(address: string, network: CryptoNetwork): boolean {
  const a = address.trim();
  if (!a) return false;
  switch (network) {
    case 'BTC':
      return /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(a);
    case 'ETH':
    case 'USDT-ERC20':
    case 'USDC-ERC20':
      return /^0x[a-fA-F0-9]{40}$/.test(a);
    case 'TRX':
    case 'USDT-TRC20':
      return /^T[a-zA-HJ-NP-Z0-9]{33}$/.test(a);
    case 'XRP':
      return /^r[0-9a-zA-Z]{24,34}$/.test(a);
    case 'BNB':
      return /^(bnb1[a-z0-9]{38}|0x[a-fA-F0-9]{40})$/.test(a);
    case 'SOL':
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
    default:
      return false;
  }
}

export function screenWalletHeuristic(
  input: WalletScreenInput,
  sanctionsList: SanctionedCryptoEntry[]
): WalletScreenResult {
  const signals: WalletRiskSignal[] = [];
  const sources: string[] = [];
  const valid = validateAddress(input.address, input.network);
  if (!valid) {
    signals.push({
      id: 'invalid_address',
      label: 'Address failed format validation',
      weight: 1,
      evidence: `${input.network} address "${input.address}" does not match expected pattern.`,
    });
  }

  let onList = false;
  const normalized = input.address.toLowerCase();
  for (const e of sanctionsList) {
    if (e.network !== input.network) continue;
    if (e.address.toLowerCase() === normalized) {
      onList = true;
      sources.push(e.source);
      signals.push({
        id: 'sanctions_hit',
        label: 'Direct sanctions list hit',
        weight: 1,
        evidence: `${input.network} ${input.address} matches ${e.source}${e.linkedEntity ? ` (linked: ${e.linkedEntity})` : ''}.`,
      });
    }
  }

  if (input.volumeLast30dUsd !== undefined && input.volumeLast30dUsd > 1_000_000) {
    signals.push({
      id: 'high_volume',
      label: 'High 30-day volume (>$1M)',
      weight: 0.3,
      evidence: `Volume last 30 days: $${input.volumeLast30dUsd.toLocaleString()}.`,
    });
  }
  if (input.counterpartyCount !== undefined && input.counterpartyCount > 100) {
    signals.push({
      id: 'fan_out',
      label: 'Fan-out pattern (>100 counterparties)',
      weight: 0.4,
      evidence: `${input.counterpartyCount} unique counterparties in window — possible mixer / peel chain.`,
    });
  }

  const riskScore = onList ? 1 : Math.min(1, signals.reduce((s, r) => s + r.weight, 0) / 2);

  return {
    address: input.address,
    network: input.network,
    addressValid: valid,
    onSanctionsList: onList,
    riskScore,
    signals,
    sources,
  };
}

/** Placeholder OFAC-style sanctioned crypto addresses. Replace at ingest time. */
export const SEED_SANCTIONED_CRYPTO: SanctionedCryptoEntry[] = [
  {
    address: '0x0000000000000000000000000000000000000001',
    network: 'ETH',
    source: 'OFAC_SDN_CRYPTO_seed',
    linkedEntity: 'SEED:DO_NOT_USE',
  },
];
