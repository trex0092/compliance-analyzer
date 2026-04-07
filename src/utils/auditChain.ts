/**
 * Tamper-Proof Audit Trail — Hash Chain
 *
 * Each audit event includes a hash of the previous event, forming an
 * immutable chain. If any entry is modified, the chain breaks and
 * verification fails. This provides cryptographic proof of integrity
 * for MoE inspectors and external auditors.
 *
 * Uses SHA-256 via Web Crypto API (browser-native, no dependencies).
 */

export interface ChainedAuditEvent {
  id: string;
  at: string;
  by: string;
  action: string;
  note?: string;
  previousHash: string;
  hash: string;
}

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const buffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function eventPayload(event: Omit<ChainedAuditEvent, 'hash'>): string {
  return `${event.id}|${event.at}|${event.by}|${event.action}|${event.note || ''}|${event.previousHash}`;
}

/**
 * Create a new chained audit event. The hash links to the previous event.
 */
export async function createChainedEvent(
  event: { id: string; at: string; by: string; action: string; note?: string },
  previousHash: string = GENESIS_HASH
): Promise<ChainedAuditEvent> {
  const partial = { ...event, previousHash };
  const hash = await sha256(eventPayload(partial));
  return { ...partial, hash };
}

/**
 * Verify the integrity of an audit chain.
 * Returns { valid, brokenAt } — if invalid, brokenAt is the index of the first tampered entry.
 */
export async function verifyChain(
  chain: ChainedAuditEvent[]
): Promise<{ valid: boolean; brokenAt: number | null; checkedCount: number }> {
  if (chain.length === 0) return { valid: true, brokenAt: null, checkedCount: 0 };

  for (let i = 0; i < chain.length; i++) {
    const event = chain[i];

    // Verify previous hash link
    if (i === 0) {
      if (event.previousHash !== GENESIS_HASH) {
        return { valid: false, brokenAt: 0, checkedCount: 1 };
      }
    } else {
      if (event.previousHash !== chain[i - 1].hash) {
        return { valid: false, brokenAt: i, checkedCount: i + 1 };
      }
    }

    // Verify hash integrity
    const { hash: _, ...rest } = event;
    void _;
    const expectedHash = await sha256(eventPayload(rest));
    if (event.hash !== expectedHash) {
      return { valid: false, brokenAt: i, checkedCount: i + 1 };
    }
  }

  return { valid: true, brokenAt: null, checkedCount: chain.length };
}

/**
 * Append an event to an existing chain.
 */
export async function appendToChain(
  chain: ChainedAuditEvent[],
  event: { id: string; at: string; by: string; action: string; note?: string }
): Promise<ChainedAuditEvent[]> {
  const lastHash = chain.length > 0 ? chain[chain.length - 1].hash : GENESIS_HASH;
  const newEvent = await createChainedEvent(event, lastHash);
  return [...chain, newEvent];
}
