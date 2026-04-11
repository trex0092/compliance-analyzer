/**
 * Quantum-Resistant Audit Seal — subsystem #91 (Phase 8).
 *
 * The Phase 1 zkComplianceProof uses SHA-256. SHA-256 is currently
 * secure but is VULNERABLE to quantum attacks via Grover's algorithm
 * (search for collisions in 2^128 operations instead of 2^256). For
 * records that must hold up 5+ years — per FDL Art.24 — we need a
 * hash function that resists quantum attacks.
 *
 * This module uses a quantum-resistant construction based on:
 *
 *   1. SHA-3-512 (Keccak family) as the underlying hash — NIST
 *      considers SHA-3-512 quantum-resistant for practical purposes
 *      because Grover reduces effective security to 256 bits which
 *      exceeds every projected quantum budget for the next 50 years.
 *
 *   2. A chained Merkle tree over records with domain separation
 *      (SHA3-512("leaf" ‖ data) for leaves, SHA3-512("node" ‖ left ‖
 *      right) for internal nodes). Domain separation prevents length-
 *      extension attacks regardless of the underlying primitive.
 *
 *   3. A commit-and-reveal salt per seal so even if the hash function
 *      is later broken, the original record is protected by the
 *      salt's pre-image resistance.
 *
 * Pure-TypeScript SHA-3-512 implementation (Keccak-f[1600] permutation)
 * — zero dependencies, works in browser and Node. Not fast, but
 * correct and self-contained; ~400 lines for the permutation + wrapper.
 *
 * To keep this file sane, we ship a MINIMAL SHA-3-512 implementation
 * good enough for audit sealing (small records, infrequent calls).
 * For high-volume production we'd wire a native impl — but the
 * interface is fixed so swapping implementations is trivial.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (5-year retention — quantum horizon)
 *   - NIST AI RMF MS-4.1 (audit trail integrity)
 *   - ISO/IEC 42001:2023 A.9.3 (long-term AIMS audit)
 *   - EU AI Act Art.11, 12 (technical documentation + logging)
 */

// ---------------------------------------------------------------------------
// SHA-3-512 (Keccak-f[1600]) — minimal reference implementation
// ---------------------------------------------------------------------------

// Keccak round constants
const RC: readonly bigint[] = [
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n,
];

// Rho rotation offsets
const R: readonly number[] = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
];

function rotl64(x: bigint, n: number): bigint {
  const mask = 0xffffffffffffffffn;
  return (((x << BigInt(n)) & mask) | (x >> BigInt(64 - n))) & mask;
}

function keccakF(state: bigint[]): void {
  const mask = 0xffffffffffffffffn;
  for (let round = 0; round < 24; round++) {
    // Theta
    const C = new Array<bigint>(5);
    for (let x = 0; x < 5; x++) {
      C[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    const D = new Array<bigint>(5);
    for (let x = 0; x < 5; x++) {
      D[x] = (C[(x + 4) % 5] ^ rotl64(C[(x + 1) % 5], 1)) & mask;
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        state[x + 5 * y] = (state[x + 5 * y] ^ D[x]) & mask;
      }
    }
    // Rho + Pi
    const B = new Array<bigint>(25).fill(0n);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl64(state[x + 5 * y], R[x + 5 * y]);
      }
    }
    // Chi
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        state[x + 5 * y] =
          (B[x + 5 * y] ^ (~B[((x + 1) % 5) + 5 * y] & B[((x + 2) % 5) + 5 * y])) & mask;
      }
    }
    // Iota
    state[0] = (state[0] ^ RC[round]) & mask;
  }
}

function sha3_512Bytes(data: Uint8Array): Uint8Array {
  const rate = 72; // 576 bits for SHA-3-512
  const outLen = 64;
  const state = new Array<bigint>(25).fill(0n);

  // Pad: append 0x06, zeros, final 0x80 (SHA-3 padding)
  const padded = new Uint8Array(Math.ceil((data.length + 1) / rate) * rate);
  padded.set(data);
  padded[data.length] = 0x06;
  padded[padded.length - 1] |= 0x80;

  // Absorb
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let j = 0; j < 8; j++) {
        lane |= BigInt(padded[off + i * 8 + j]) << BigInt(8 * j);
      }
      state[i] ^= lane;
    }
    keccakF(state);
  }

  // Squeeze
  const out = new Uint8Array(outLen);
  let outOff = 0;
  while (outOff < outLen) {
    for (let i = 0; i < rate / 8 && outOff < outLen; i++) {
      let lane = state[i];
      for (let j = 0; j < 8 && outOff < outLen; j++) {
        out[outOff++] = Number(lane & 0xffn);
        lane >>= 8n;
      }
    }
    if (outOff < outLen) keccakF(state);
  }
  return out;
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

export function sha3_512Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  return toHex(sha3_512Bytes(bytes));
}

// ---------------------------------------------------------------------------
// Quantum-resistant Merkle seal
// ---------------------------------------------------------------------------

export interface QuantumSealRecord {
  id: string;
  data: unknown;
}

export interface QuantumSealBundle {
  hashFunction: 'sha3-512';
  domainSeparated: true;
  salt: string;
  rootHash: string;
  leafCount: number;
  sealedAt: string;
}

function leafHash(salt: string, record: QuantumSealRecord): string {
  return sha3_512Hex(`leaf|${salt}|${record.id}|${JSON.stringify(record.data)}`);
}

function nodeHash(salt: string, left: string, right: string): string {
  return sha3_512Hex(`node|${salt}|${left}|${right}`);
}

function randomSalt(): string {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
  const arr = new Uint8Array(16);
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(arr);
  } else {
    // Deterministic-but-non-cryptographic fallback for environments
    // without Web Crypto — downstream callers should replace with a
    // real RNG. Used only when the host lacks crypto.getRandomValues.
    const seed = Date.now();
    for (let i = 0; i < arr.length; i++) arr[i] = (seed + i * 131) & 0xff;
  }
  return toHex(arr);
}

/**
 * Seal a set of compliance records into a quantum-resistant Merkle
 * root. Deterministic given the salt; callers that want an
 * unpredictable seal pass `salt: undefined` and we generate one.
 */
export function sealQuantumResistant(
  records: readonly QuantumSealRecord[],
  saltOverride?: string
): QuantumSealBundle {
  const salt = saltOverride ?? randomSalt();
  if (records.length === 0) {
    return {
      hashFunction: 'sha3-512',
      domainSeparated: true,
      salt,
      rootHash: sha3_512Hex(`empty|${salt}`),
      leafCount: 0,
      sealedAt: new Date().toISOString(),
    };
  }

  let level = records.map((r) => leafHash(salt, r));
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : left;
      next.push(nodeHash(salt, left, right));
    }
    level = next;
  }

  return {
    hashFunction: 'sha3-512',
    domainSeparated: true,
    salt,
    rootHash: level[0],
    leafCount: records.length,
    sealedAt: new Date().toISOString(),
  };
}

/** Verify that a set of records matches a sealed bundle. */
export function verifyQuantumSeal(
  records: readonly QuantumSealRecord[],
  bundle: QuantumSealBundle
): boolean {
  const replay = sealQuantumResistant(records, bundle.salt);
  return replay.rootHash === bundle.rootHash;
}
