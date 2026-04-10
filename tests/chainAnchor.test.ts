import { describe, it, expect } from 'vitest';
import { addNode, createChain, seal } from '@/services/reasoningChain';
import {
  createAnchor,
  generateMerkleProof,
  verifyMerkleProof,
  hashChain,
} from '@/services/chainAnchor';

function mkChain(id: string, topic: string) {
  const c = createChain(topic, id);
  // Pin createdAt so the hash is deterministic across invocations.
  c.createdAt = '2026-01-01T00:00:00.000Z';
  addNode(c, { id: 'n1', type: 'event', label: 'e', weight: 1 });
  addNode(c, { id: 'n2', type: 'decision', label: 'freeze', weight: 1 });
  // Pin each node createdAt too.
  for (const n of c.nodes) n.createdAt = '2026-01-01T00:00:00.000Z';
  seal(c);
  return c;
}

describe('chainAnchor — deterministic hashing', () => {
  it('same chain → same hash', async () => {
    const a = await hashChain(mkChain('rc-1', 'topic'));
    const b = await hashChain(mkChain('rc-1', 'topic'));
    expect(a).toBe(b);
  });

  it('different chains → different hashes', async () => {
    const a = await hashChain(mkChain('rc-1', 'topic A'));
    const b = await hashChain(mkChain('rc-2', 'topic B'));
    expect(a).not.toBe(b);
  });
});

describe('chainAnchor — root generation', () => {
  it('produces a signing payload and a root', async () => {
    const chains = [mkChain('rc-1', 'A'), mkChain('rc-2', 'B'), mkChain('rc-3', 'C')];
    const { anchor, leafHashes } = await createAnchor({
      chains,
      policyVersion: 'v1',
      windowStartIso: '2026-04-01T00:00:00Z',
      windowEndIso: '2026-04-10T00:00:00Z',
      anchoredAtIso: '2026-04-10T12:00:00Z',
    });
    expect(anchor.rootHash).toMatch(/^[0-9a-f]{64}$/);
    expect(anchor.chainCount).toBe(3);
    expect(leafHashes).toHaveLength(3);
    expect(anchor.signingPayload).toContain('HAWKEYE-ANCHOR-v1');
    expect(anchor.signingPayload).toContain(anchor.rootHash);
  });
});

describe('chainAnchor — Merkle proofs', () => {
  const input = () => ({
    chains: [mkChain('rc-1', 'A'), mkChain('rc-2', 'B'), mkChain('rc-3', 'C'), mkChain('rc-4', 'D')],
    policyVersion: 'v1',
    windowStartIso: '2026-04-01T00:00:00Z',
    windowEndIso: '2026-04-10T00:00:00Z',
  });

  it('generates and verifies a proof for every chain', async () => {
    const { chains } = input();
    for (const c of chains) {
      const proof = await generateMerkleProof(input(), c.id);
      expect(proof).not.toBeNull();
      const ok = await verifyMerkleProof(proof!);
      expect(ok).toBe(true);
    }
  });

  it('tampered leaf fails verification', async () => {
    const proof = await generateMerkleProof(input(), 'rc-1');
    expect(proof).not.toBeNull();
    proof!.leafHash = '0'.repeat(64);
    expect(await verifyMerkleProof(proof!)).toBe(false);
  });

  it('returns null for unknown chain id', async () => {
    const proof = await generateMerkleProof(input(), 'rc-ghost');
    expect(proof).toBeNull();
  });
});
