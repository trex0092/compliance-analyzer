import { describe, it, expect } from 'vitest';
import {
  commitRecord,
  sealComplianceBundle,
  generateProof,
  verifyProof,
  verifyRevealedRecord,
} from '@/services/zkComplianceProof';

const sampleRecords = [
  { recordId: 'R1', data: { customer: 'Alice', screenedAt: '2026-04-01', verdict: 'clean' } },
  { recordId: 'R2', data: { customer: 'Bob', screenedAt: '2026-04-02', verdict: 'clean' } },
  { recordId: 'R3', data: { customer: 'Carol', screenedAt: '2026-04-03', verdict: 'flag' } },
  { recordId: 'R4', data: { customer: 'Dan', screenedAt: '2026-04-04', verdict: 'clean' } },
  { recordId: 'R5', data: { customer: 'Eve', screenedAt: '2026-04-05', verdict: 'freeze' } },
];

describe('zkComplianceProof — commitments', () => {
  it('commits a record and produces different hashes for different blinds', async () => {
    const a = await commitRecord(sampleRecords[0]);
    const b = await commitRecord(sampleRecords[0]);
    expect(a.commitmentHash).not.toBe(b.commitmentHash);
    expect(a.blindingFactor).not.toBe(b.blindingFactor);
  });

  it('same record + same blind → same commitment', async () => {
    const a = await commitRecord(sampleRecords[0], 'blind-abc');
    const b = await commitRecord(sampleRecords[0], 'blind-abc');
    expect(a.commitmentHash).toBe(b.commitmentHash);
  });
});

describe('zkComplianceProof — bundle + proof', () => {
  it('sealComplianceBundle returns root + all commitments', async () => {
    const bundle = await sealComplianceBundle(sampleRecords);
    expect(bundle.recordCount).toBe(5);
    expect(bundle.commitments).toHaveLength(5);
    expect(bundle.rootHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generateProof + verifyProof round-trips for every record', async () => {
    const bundle = await sealComplianceBundle(sampleRecords);
    for (const rec of sampleRecords) {
      const proof = await generateProof(bundle, rec.recordId);
      expect(proof).not.toBeNull();
      const ok = await verifyProof(proof!);
      expect(ok).toBe(true);
    }
  });

  it('tampered proof fails verification', async () => {
    const bundle = await sealComplianceBundle(sampleRecords);
    const proof = await generateProof(bundle, 'R3');
    expect(proof).not.toBeNull();
    proof!.commitmentHash = '0'.repeat(64);
    const ok = await verifyProof(proof!);
    expect(ok).toBe(false);
  });

  it('returns null for unknown record', async () => {
    const bundle = await sealComplianceBundle(sampleRecords);
    const proof = await generateProof(bundle, 'NOPE');
    expect(proof).toBeNull();
  });

  it('verifyRevealedRecord confirms disclosed record matches commitment', async () => {
    const bundle = await sealComplianceBundle(sampleRecords);
    const commitment = bundle.commitments[2];
    const ok = await verifyRevealedRecord(sampleRecords[2], commitment);
    expect(ok).toBe(true);
  });

  it('verifyRevealedRecord rejects tampered record', async () => {
    const bundle = await sealComplianceBundle(sampleRecords);
    const commitment = bundle.commitments[0];
    const tampered = {
      ...sampleRecords[0],
      data: { ...sampleRecords[0].data, verdict: 'freeze' },
    };
    const ok = await verifyRevealedRecord(tampered, commitment);
    expect(ok).toBe(false);
  });
});
