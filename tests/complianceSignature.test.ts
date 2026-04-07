import { describe, it, expect } from 'vitest';
import {
  generateKeyPair,
  signDocument,
  verifySignature,
} from '../src/utils/complianceSignature';

describe('complianceSignature', () => {
  it('generates a key pair for a user', async () => {
    const kp = await generateKeyPair('co-officer');
    expect(kp.userId).toBe('co-officer');
    expect(kp.publicKey).toContain('P-256');
    expect(kp.privateKey).toContain('P-256');
    expect(kp.createdAt).toBeDefined();
  });

  it('signs and verifies a document', async () => {
    const kp = await generateKeyPair('mlro');
    const content = 'STR-2026-001: Suspicious transaction for ENTITY X. Amount AED 250,000.';

    const signed = await signDocument('doc-001', content, 'mlro', kp.privateKey);

    expect(signed.documentId).toBe('doc-001');
    expect(signed.signedBy).toBe('mlro');
    expect(signed.signature.length).toBeGreaterThan(0);

    const result = await verifySignature(signed, content);
    expect(result.valid).toBe(true);
  });

  it('detects tampered document', async () => {
    const kp = await generateKeyPair('co');
    const original = 'Approval for high-risk customer onboarding.';

    const signed = await signDocument('doc-002', original, 'co', kp.privateKey);

    const tampered = 'Approval for LOW-risk customer onboarding.';
    const result = await verifySignature(signed, tampered);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('modified');
  });

  it('different keys produce different signatures', async () => {
    const kp1 = await generateKeyPair('user1');
    const kp2 = await generateKeyPair('user2');
    const content = 'Same document content';

    const signed1 = await signDocument('d1', content, 'user1', kp1.privateKey);
    const signed2 = await signDocument('d2', content, 'user2', kp2.privateKey);

    expect(signed1.signature).not.toBe(signed2.signature);
  });
});
