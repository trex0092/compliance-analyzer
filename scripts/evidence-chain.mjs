/**
 * Evidence Chain — Tamper-Evident Compliance Audit Trail
 * Implements a hash-chained log for regulatory evidence.
 * Every entry references the hash of the previous entry, creating
 * a tamper-evident chain similar to a blockchain.
 * Conforms to: FDL No.10/2025 Art.24, 10-year record retention
 */
import { load, save } from './lib/store.mjs';
import { createHash } from 'node:crypto';

/**
 * Verify the integrity of the entire evidence chain.
 * @returns {{ valid: boolean, entries: number, message: string, brokenAt?: number }}
 */
export async function verifyChain() {
  const chain = await load('evidence-chain', []);

  if (chain.length === 0) {
    return { valid: true, entries: 0, message: 'Chain is empty' };
  }

  // Verify genesis entry
  if (chain[0].previousHash !== '0000000000000000') {
    return { valid: false, entries: chain.length, message: 'Genesis entry has invalid previous hash', brokenAt: 0 };
  }

  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];

    // Verify entry hash
    const computed = computeHash(entry);
    if (computed !== entry.hash) {
      return { valid: false, entries: chain.length, message: `Entry ${i} hash mismatch: expected ${computed}, got ${entry.hash}`, brokenAt: i };
    }

    // Verify chain linkage (except genesis)
    if (i > 0 && entry.previousHash !== chain[i - 1].hash) {
      return { valid: false, entries: chain.length, message: `Entry ${i} previous hash doesn't match entry ${i - 1}`, brokenAt: i };
    }
  }

  return { valid: true, entries: chain.length, message: `Chain intact: ${chain.length} entries verified` };
}

/**
 * Append a new entry to the evidence chain.
 * @param {{ action: string, actor: string, subject: string, detail: string, data?: object }} entry
 * @returns {object} The appended entry with hash
 */
export async function appendEvidence(entry) {
  const chain = await load('evidence-chain', []);

  const previousHash = chain.length > 0
    ? chain[chain.length - 1].hash
    : '0000000000000000';

  const newEntry = {
    index: chain.length,
    timestamp: new Date().toISOString(),
    action: entry.action,
    actor: entry.actor,
    subject: entry.subject,
    detail: entry.detail,
    data: entry.data || null,
    previousHash,
    hash: '', // Will be computed
  };

  newEntry.hash = computeHash(newEntry);
  chain.push(newEntry);

  await save('evidence-chain', chain);

  return newEntry;
}

function computeHash(entry) {
  const payload = [
    entry.index,
    entry.timestamp,
    entry.action,
    entry.actor,
    entry.subject,
    entry.detail,
    JSON.stringify(entry.data),
    entry.previousHash,
  ].join('|');

  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}
