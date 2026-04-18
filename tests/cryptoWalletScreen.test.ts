/**
 * Tests for src/services/cryptoWalletScreen.ts — deterministic
 * address validation + denylist + heuristic risk signals.
 */
import { describe, it, expect } from 'vitest';
import {
  validateAddress,
  screenWalletHeuristic,
  SEED_SANCTIONED_CRYPTO,
  type SanctionedCryptoEntry,
} from '@/services/cryptoWalletScreen';

describe('cryptoWalletScreen.validateAddress', () => {
  it('accepts a well-formed ETH address', () => {
    expect(
      validateAddress('0xAbCdEf0123456789AbCdEf0123456789AbCdEf01', 'ETH')
    ).toBe(true);
  });

  it('rejects a too-short ETH address', () => {
    expect(validateAddress('0x123', 'ETH')).toBe(false);
  });

  it('accepts a bech32 BTC address', () => {
    expect(
      validateAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'BTC')
    ).toBe(true);
  });

  it('accepts a legacy base58 BTC address', () => {
    expect(validateAddress('1BoatSLRHtKNngkdXEeobR76b53LETtpyT', 'BTC')).toBe(true);
  });

  it('accepts a TRX address starting with T', () => {
    expect(
      validateAddress('TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL', 'TRX')
    ).toBe(true);
  });

  it('rejects empty address', () => {
    expect(validateAddress('', 'ETH')).toBe(false);
  });
});

describe('cryptoWalletScreen.screenWalletHeuristic', () => {
  const denylist: SanctionedCryptoEntry[] = [
    {
      address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      network: 'ETH',
      source: 'OFAC_SDN_CRYPTO',
      linkedEntity: 'Tornado Cash',
    },
  ];

  it('flags a direct denylist hit with riskScore 1 and a sanctions signal', () => {
    const res = screenWalletHeuristic(
      {
        address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        network: 'ETH',
      },
      denylist
    );
    expect(res.onSanctionsList).toBe(true);
    expect(res.riskScore).toBe(1);
    expect(res.signals.some((s) => s.id === 'sanctions_hit')).toBe(true);
    expect(res.sources).toContain('OFAC_SDN_CRYPTO');
  });

  it('raises the fan-out signal above the 100-counterparty threshold', () => {
    const res = screenWalletHeuristic(
      {
        address: '0xAbCdEf0123456789AbCdEf0123456789AbCdEf01',
        network: 'ETH',
        counterpartyCount: 500,
      },
      []
    );
    expect(res.signals.some((s) => s.id === 'fan_out')).toBe(true);
    expect(res.onSanctionsList).toBe(false);
  });

  it('raises the high-volume signal above $1M', () => {
    const res = screenWalletHeuristic(
      {
        address: '0xAbCdEf0123456789AbCdEf0123456789AbCdEf01',
        network: 'ETH',
        volumeLast30dUsd: 2_500_000,
      },
      []
    );
    expect(res.signals.some((s) => s.id === 'high_volume')).toBe(true);
  });

  it('flags invalid addresses with an invalid_address signal', () => {
    const res = screenWalletHeuristic({ address: '0x1', network: 'ETH' }, []);
    expect(res.addressValid).toBe(false);
    expect(res.signals.some((s) => s.id === 'invalid_address')).toBe(true);
  });

  it('ships a non-empty SEED_SANCTIONED_CRYPTO placeholder', () => {
    expect(SEED_SANCTIONED_CRYPTO.length).toBeGreaterThan(0);
  });
});
