/**
 * Privacy-Preserving Compliance Intel Sharing.
 *
 * Problem: two DPMS firms want to check whether they share a sanctioned
 * counterparty WITHOUT disclosing their customer lists to each other.
 *
 * Solution: Bloom-filter-based Private Set Intersection.
 *
 *   Firm A builds a Bloom filter from hashes of its (normalised) customer
 *   names salted with a shared secret. Firm B probes the filter with
 *   candidates from its own list. Matches are "maybe in the set";
 *   misses are "definitely not in the set". False-positive rate is
 *   tunable via `falsePositiveRate`.
 *
 * Privacy properties:
 *   - Firm A never sees Firm B's list.
 *   - Firm B only learns that the hashes of its candidates are/aren't
 *     in Firm A's filter. It does not learn the original names.
 *   - With a sufficiently large filter, A cannot practically enumerate
 *     the members from the bit-array (requires brute-forcing salted
 *     hashes of the full name space).
 *
 * Caveats:
 *   - Not a cryptographic PSI. Bloom filters leak cardinality and admit
 *     dictionary attacks on sufficiently small name spaces. For stronger
 *     guarantees use actual PSI (e.g., DH-based PSI or OPRF) — out of
 *     scope for this in-browser implementation.
 *   - The shared secret must be exchanged out of band.
 *
 * Regulatory basis:
 *   - FATF Rec 2 (inter-institutional information sharing)
 *   - UAE Personal Data Protection Law FDL No.45/2021
 *   - EOCN Public-Private Partnership Guidelines 2024
 */

import { normalise, stripLegalSuffix } from './nameMatching';

function normaliseForIntel(name: string): string {
  return stripLegalSuffix(normalise(name)).replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Bloom filter implementation
// ---------------------------------------------------------------------------

export interface BloomFilter {
  bits: Uint8Array;
  numBits: number;
  numHashes: number;
  saltHex: string;
  estimatedCount: number;
}

/**
 * Fowler-Noll-Vo 1a hash (32-bit). Cheap, non-cryptographic, but our
 * security doesn't rely on hash collision resistance — the secret salt
 * is what matters.
 */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/** Double-hashing scheme: hash_i(x) = h1(x) + i * h2(x). */
function hashIndices(key: string, salt: string, numHashes: number, numBits: number): number[] {
  const h1 = fnv1a(salt + ':a:' + key);
  const h2 = fnv1a(salt + ':b:' + key) || 1;
  const out: number[] = [];
  for (let i = 0; i < numHashes; i++) {
    out.push((h1 + i * h2) % numBits);
  }
  return out;
}

export interface BloomConfig {
  expectedItems: number;
  falsePositiveRate: number;
  salt: string;
}

export function createBloomFilter(config: BloomConfig): BloomFilter {
  const { expectedItems, falsePositiveRate, salt } = config;
  if (expectedItems < 1) throw new Error('expectedItems must be >= 1');
  if (falsePositiveRate <= 0 || falsePositiveRate >= 1)
    throw new Error('falsePositiveRate must be in (0, 1)');
  // m = -n ln p / (ln 2)^2
  const numBits = Math.max(
    8,
    Math.ceil((-expectedItems * Math.log(falsePositiveRate)) / Math.LN2 ** 2)
  );
  // k = (m/n) ln 2
  const numHashes = Math.max(1, Math.round((numBits / expectedItems) * Math.LN2));
  return {
    bits: new Uint8Array(Math.ceil(numBits / 8)),
    numBits,
    numHashes,
    saltHex: salt,
    estimatedCount: 0,
  };
}

export function bloomAdd(filter: BloomFilter, key: string): void {
  const indices = hashIndices(key, filter.saltHex, filter.numHashes, filter.numBits);
  for (const idx of indices) {
    filter.bits[idx >>> 3] |= 1 << (idx & 7);
  }
  filter.estimatedCount += 1;
}

export function bloomHas(filter: BloomFilter, key: string): boolean {
  const indices = hashIndices(key, filter.saltHex, filter.numHashes, filter.numBits);
  for (const idx of indices) {
    if (!(filter.bits[idx >>> 3] & (1 << (idx & 7)))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

export function serialiseBloom(filter: BloomFilter): string {
  return JSON.stringify({
    v: 1,
    numBits: filter.numBits,
    numHashes: filter.numHashes,
    saltHex: filter.saltHex,
    estimatedCount: filter.estimatedCount,
    bits: bytesToBase64(filter.bits),
  });
}

export function deserialiseBloom(payload: string): BloomFilter {
  const obj = JSON.parse(payload) as {
    v: number;
    numBits: number;
    numHashes: number;
    saltHex: string;
    estimatedCount: number;
    bits: string;
  };
  if (obj.v !== 1) throw new Error(`unsupported bloom version ${obj.v}`);
  return {
    numBits: obj.numBits,
    numHashes: obj.numHashes,
    saltHex: obj.saltHex,
    estimatedCount: obj.estimatedCount,
    bits: base64ToBytes(obj.bits),
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  if (typeof btoa === 'function') return btoa(binary);
  return Buffer.from(binary, 'binary').toString('base64');
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  const buf = Buffer.from(b64, 'base64');
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

// ---------------------------------------------------------------------------
// Compliance intel wrapper
// ---------------------------------------------------------------------------

export interface IntelFilterConfig {
  salt: string;
  falsePositiveRate?: number;
}

export function buildCustomerIntelFilter(
  names: readonly string[],
  config: IntelFilterConfig
): BloomFilter {
  const filter = createBloomFilter({
    expectedItems: Math.max(1, names.length),
    falsePositiveRate: config.falsePositiveRate ?? 0.001,
    salt: config.salt,
  });
  for (const name of names) {
    bloomAdd(filter, normaliseForIntel(name));
  }
  return filter;
}

export interface IntelMatchResult {
  query: string;
  normalised: string;
  possibleMatch: boolean;
}

export function probeCustomerIntel(
  filter: BloomFilter,
  candidates: readonly string[]
): IntelMatchResult[] {
  return candidates.map((query) => {
    const normalised = normaliseForIntel(query);
    return {
      query,
      normalised,
      possibleMatch: bloomHas(filter, normalised),
    };
  });
}
