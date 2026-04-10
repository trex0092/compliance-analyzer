import { describe, it, expect } from 'vitest';
import {
  detectChain,
  normaliseAddress,
  createWalletDatabase,
  addWallet,
  lookupWallet,
  scoreWallet,
  scoreWallets,
  summarisePortfolioWallets,
} from '@/services/vaspWalletScoring';

const BTC_ADDR = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'; // Satoshi's genesis
const BTC_BECH32 = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const ETH_ADDR = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7';
const TRX_ADDR = 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7';

describe('detectChain', () => {
  it('detects BTC legacy addresses', () => {
    expect(detectChain(BTC_ADDR)).toBe('BTC');
  });

  it('detects BTC bech32 addresses', () => {
    expect(detectChain(BTC_BECH32)).toBe('BTC');
  });

  it('detects Ethereum addresses', () => {
    expect(detectChain(ETH_ADDR)).toBe('ETH');
  });

  it('detects Tron addresses', () => {
    expect(detectChain(TRX_ADDR)).toBe('TRX');
  });

  it('returns UNKNOWN for garbage', () => {
    expect(detectChain('not-a-wallet')).toBe('UNKNOWN');
    expect(detectChain('0xabc')).toBe('UNKNOWN');
  });
});

describe('normaliseAddress', () => {
  it('lowercases ETH addresses', () => {
    const upper = ETH_ADDR.toUpperCase().replace('0X', '0x');
    expect(normaliseAddress(upper)).toBe(ETH_ADDR.toLowerCase());
  });

  it('preserves BTC case', () => {
    expect(normaliseAddress(BTC_ADDR)).toBe(BTC_ADDR);
  });
});

describe('wallet database', () => {
  it('stores and retrieves a record', () => {
    const db = createWalletDatabase();
    addWallet(db, {
      address: ETH_ADDR,
      chain: 'ETH',
      tags: ['sanctioned'],
      source: 'OFAC',
      label: 'OFAC SDN crypto entry',
    });
    const rec = lookupWallet(db, ETH_ADDR);
    expect(rec).not.toBeNull();
    expect(rec?.tags).toContain('sanctioned');
  });

  it('lookup is case-insensitive for ETH', () => {
    const db = createWalletDatabase();
    addWallet(db, {
      address: ETH_ADDR.toLowerCase(),
      chain: 'ETH',
      tags: ['mixer'],
      source: 'CUSTOM',
    });
    const rec = lookupWallet(db, ETH_ADDR.toUpperCase().replace('0X', '0x'));
    expect(rec).not.toBeNull();
  });

  it('returns null for unknown wallet', () => {
    const db = createWalletDatabase();
    expect(lookupWallet(db, ETH_ADDR)).toBeNull();
  });
});

describe('scoreWallet', () => {
  const db = createWalletDatabase();
  addWallet(db, {
    address: ETH_ADDR,
    chain: 'ETH',
    tags: ['sanctioned'],
    source: 'OFAC',
    label: 'Tornado Cash deposit pool',
  });
  addWallet(db, {
    address: BTC_ADDR,
    chain: 'BTC',
    tags: ['mixer'],
    source: 'COMMUNITY',
  });
  addWallet(db, {
    address: TRX_ADDR,
    chain: 'TRX',
    tags: ['exchange'],
    source: 'COMMUNITY',
  });

  it('unknown wallet → 0 score, clean classification', () => {
    const r = scoreWallet(db, '0x0000000000000000000000000000000000000000');
    expect(r.score).toBe(0);
    expect(r.classification).toBe('clean');
  });

  it('sanctioned wallet → 100 score, confirmed_hit', () => {
    const r = scoreWallet(db, ETH_ADDR);
    expect(r.score).toBe(100);
    expect(r.severity).toBe('critical');
    expect(r.classification).toBe('confirmed_hit');
  });

  it('mixer wallet → 85 score, potential', () => {
    const r = scoreWallet(db, BTC_ADDR);
    expect(r.score).toBe(85);
    expect(r.severity).toBe('high');
    expect(r.classification).toBe('potential');
  });

  it('compliant exchange → 10 score, watch', () => {
    const r = scoreWallet(db, TRX_ADDR);
    expect(r.score).toBe(10);
    expect(r.classification).toBe('watch');
  });

  it('reasons list includes tags, label, and source', () => {
    const r = scoreWallet(db, ETH_ADDR);
    expect(r.reasons.some((x) => x.includes('sanctioned'))).toBe(true);
    expect(r.reasons.some((x) => x.includes('Tornado Cash'))).toBe(true);
    expect(r.reasons.some((x) => x.includes('OFAC'))).toBe(true);
  });
});

describe('summarisePortfolioWallets', () => {
  const db = createWalletDatabase();
  addWallet(db, { address: ETH_ADDR, chain: 'ETH', tags: ['sanctioned'], source: 'OFAC' });
  addWallet(db, { address: BTC_ADDR, chain: 'BTC', tags: ['mixer'], source: 'COMMUNITY' });
  addWallet(db, { address: TRX_ADDR, chain: 'TRX', tags: ['exchange'], source: 'COMMUNITY' });

  it('aggregates classification counts', () => {
    const summary = summarisePortfolioWallets(db, [
      ETH_ADDR,
      BTC_ADDR,
      TRX_ADDR,
      '1BoatSLRHtKNngkdXEeobR76b53LETtpyT', // unknown BTC
    ]);
    expect(summary.total).toBe(4);
    expect(summary.confirmedHits).toBe(1);
    expect(summary.potential).toBe(1);
    expect(summary.watch).toBe(1);
    expect(summary.clean).toBe(1);
  });

  it('reports the highest score', () => {
    const summary = summarisePortfolioWallets(db, [ETH_ADDR, BTC_ADDR]);
    expect(summary.highestScore).toBe(100);
  });

  it('hits list includes all non-clean wallets', () => {
    const summary = summarisePortfolioWallets(db, [ETH_ADDR, BTC_ADDR, TRX_ADDR]);
    expect(summary.hits).toHaveLength(3);
  });
});
