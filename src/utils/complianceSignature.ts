/**
 * Compliance Document Digital Signatures
 *
 * Provides cryptographic signing and verification for compliance documents.
 * Uses ECDSA P-256 via Web Crypto API (browser-native, no dependencies).
 *
 * Each compliance action (STR filing, approval, risk assessment) can be
 * digitally signed by the acting officer. The signature proves:
 * 1. WHO signed it (key pair tied to user)
 * 2. WHEN it was signed (timestamp in payload)
 * 3. WHAT was signed (document hash)
 * 4. It hasn't been TAMPERED with (signature verification)
 *
 * Auditor value: "Show me proof this STR was approved by the CO, not backdated."
 */

export interface SignedDocument {
  documentId: string;
  documentHash: string;
  signedBy: string;
  signedAt: string;
  signature: string;
  publicKey: string;
}

export interface KeyPair {
  userId: string;
  publicKey: string;
  privateKey: string;
  createdAt: string;
}

/**
 * Generate an ECDSA P-256 key pair for a user.
 * Store the private key securely — it proves identity.
 */
export async function generateKeyPair(userId: string): Promise<KeyPair> {
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);

  const publicKeyRaw = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKeyRaw = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

  return {
    userId,
    publicKey: JSON.stringify(publicKeyRaw),
    privateKey: JSON.stringify(privateKeyRaw),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Hash a document's content using SHA-256.
 */
async function hashDocument(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const buffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Sign a compliance document.
 * Creates a tamper-proof signature using the user's private key.
 */
export async function signDocument(
  documentId: string,
  documentContent: string,
  signedBy: string,
  privateKeyJwk: string
): Promise<SignedDocument> {
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    JSON.parse(privateKeyJwk),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const documentHash = await hashDocument(documentContent);
  const signedAt = new Date().toISOString();

  // Sign the payload: hash + signer + timestamp
  const payload = `${documentHash}|${signedBy}|${signedAt}`;
  const encoder = new TextEncoder();
  const signatureBuffer = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    encoder.encode(payload)
  );

  const signature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Export public key for verification
  const publicKey = await derivePublicKey(privateKeyJwk);

  return {
    documentId,
    documentHash,
    signedBy,
    signedAt,
    signature,
    publicKey,
  };
}

/**
 * Verify a signed document.
 * Returns true if the signature is valid and the document hasn't been tampered with.
 */
export async function verifySignature(
  signedDoc: SignedDocument,
  documentContent: string
): Promise<{ valid: boolean; reason?: string }> {
  try {
    // Verify document hash matches
    const currentHash = await hashDocument(documentContent);
    if (currentHash !== signedDoc.documentHash) {
      return { valid: false, reason: 'Document content has been modified since signing' };
    }

    // Import public key
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      JSON.parse(signedDoc.publicKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );

    // Reconstruct payload
    const payload = `${signedDoc.documentHash}|${signedDoc.signedBy}|${signedDoc.signedAt}`;
    const encoder = new TextEncoder();

    // Convert hex signature back to buffer
    const sigMatches = signedDoc.signature.match(/.{1,2}/g);
    if (!sigMatches) return { valid: false, reason: 'Empty or invalid signature' };
    const sigBytes = new Uint8Array(sigMatches.map((byte) => parseInt(byte, 16)));

    // Verify
    const isValid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      sigBytes,
      encoder.encode(payload)
    );

    return isValid ? { valid: true } : { valid: false, reason: 'Signature verification failed' };
  } catch (e) {
    return { valid: false, reason: `Verification error: ${String(e)}` };
  }
}

/**
 * Derive public key JWK from private key JWK.
 */
async function derivePublicKey(privateKeyJwk: string): Promise<string> {
  const jwk = JSON.parse(privateKeyJwk);
  // Remove private key component to get public key
  const publicJwk = { ...jwk, d: undefined, key_ops: ['verify'] };
  delete publicJwk.d;
  return JSON.stringify(publicJwk);
}
