/**
 * Asana Attachment Security — Asana Phase 3 Cluster Q.
 *
 * Four security helpers for attachment uploads / downloads:
 *
 *   Q1 virusScanStub         — pluggable virus scanner (ClamAV /
 *                              VirusTotal in production; pure-function
 *                              signature matcher for tests)
 *   Q2 piiRedactor           — redacts passports, emiratesId, IBANs,
 *                              phone numbers, and UAE national ID
 *                              numbers from outbound attachments
 *   Q3 mimeAllowlist          — rejects risky content types before upload
 *   Q4 linkIntegrityChecker  — nightly audit that every Asana task link
 *                              still resolves and flags missing ones
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (retention — but also safety of records)
 *   - NIST AI RMF GV-1.6 (security testing for AI systems)
 *   - EU AI Act Art.15 (cybersecurity)
 *   - UAE Federal Law 45/2021 PDPL (personal data protection)
 *   - FATF Rec 21 (no tipping-off — accidental disclosure via attachment)
 */

// ---------------------------------------------------------------------------
// Q1 — Virus scan stub
// ---------------------------------------------------------------------------

export type Verdict = 'clean' | 'infected' | 'error';
export type VirusScanner = (bytes: Uint8Array | string) => Promise<{
  verdict: Verdict;
  signature?: string;
}>;

/**
 * Signature-based scanner for testing. Production wires a real
 * ClamAV/VirusTotal client. Detects the EICAR standard test signature.
 */
export function createSignatureScanner(
  signatures: readonly string[] = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*']
): VirusScanner {
  return async (content) => {
    const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
    for (const sig of signatures) {
      if (text.includes(sig)) {
        return { verdict: 'infected', signature: sig.slice(0, 32) };
      }
    }
    return { verdict: 'clean' };
  };
}

export async function assertScanClean(
  content: Uint8Array | string,
  scanner: VirusScanner
): Promise<void> {
  const result = await scanner(content);
  if (result.verdict === 'infected') {
    throw new Error(
      `Attachment rejected: infected with ${result.signature ?? 'unknown malware'}`
    );
  }
  if (result.verdict === 'error') {
    throw new Error('Attachment scanner error — rejecting upload conservatively');
  }
}

// ---------------------------------------------------------------------------
// Q2 — PII redactor
// ---------------------------------------------------------------------------

interface RedactionRule {
  name: string;
  regex: RegExp;
  replacement: string;
}

const REDACTION_RULES: readonly RedactionRule[] = [
  { name: 'passport', regex: /\b[A-Z]\d{8}\b/g, replacement: '[REDACTED-PASSPORT]' },
  { name: 'emirates_id', regex: /\b784-?\d{4}-?\d{7}-?\d\b/g, replacement: '[REDACTED-EID]' },
  { name: 'iban', regex: /\bAE\d{2}\s?\d{3}\s?\d{16}\b/g, replacement: '[REDACTED-IBAN]' },
  { name: 'uae_phone', regex: /\b(?:\+971|00971|0)?[ -]?5[0-9][ -]?\d{3}[ -]?\d{4}\b/g, replacement: '[REDACTED-PHONE]' },
  { name: 'email', regex: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, replacement: '[REDACTED-EMAIL]' },
];

export interface RedactionReport {
  redacted: string;
  counts: Record<string, number>;
}

export function redactPii(input: string): RedactionReport {
  const counts: Record<string, number> = {};
  let out = input;
  for (const rule of REDACTION_RULES) {
    const matches = out.match(rule.regex);
    counts[rule.name] = matches ? matches.length : 0;
    out = out.replace(rule.regex, rule.replacement);
  }
  return { redacted: out, counts };
}

// ---------------------------------------------------------------------------
// Q3 — MIME allowlist
// ---------------------------------------------------------------------------

const MIME_ALLOWLIST = new Set<string>([
  'text/plain',
  'text/markdown',
  'text/html',
  'text/csv',
  'application/pdf',
  'application/json',
  'application/xml',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

const MIME_BLOCKLIST = new Set<string>([
  'application/x-msdownload',
  'application/x-executable',
  'application/x-sh',
  'application/x-bat',
  'application/java-archive',
]);

export function isMimeAllowed(mime: string): boolean {
  const normalised = mime.toLowerCase().trim();
  if (MIME_BLOCKLIST.has(normalised)) return false;
  return MIME_ALLOWLIST.has(normalised);
}

export function assertMimeAllowed(mime: string): void {
  if (!isMimeAllowed(mime)) {
    throw new Error(`MIME type "${mime}" not in allowlist for Asana attachments`);
  }
}

// ---------------------------------------------------------------------------
// Q4 — Link integrity checker
// ---------------------------------------------------------------------------

export interface LinkCheckResult {
  taskGid: string;
  ok: boolean;
  reason?: string;
}

export type LinkResolver = (taskGid: string) => Promise<boolean>;

export async function checkLinkIntegrity(
  taskGids: readonly string[],
  resolver: LinkResolver
): Promise<{
  checked: number;
  ok: number;
  missing: string[];
  results: LinkCheckResult[];
}> {
  const results: LinkCheckResult[] = [];
  const missing: string[] = [];
  for (const gid of taskGids) {
    try {
      const exists = await resolver(gid);
      results.push({ taskGid: gid, ok: exists, reason: exists ? undefined : 'not_found' });
      if (!exists) missing.push(gid);
    } catch (err) {
      results.push({ taskGid: gid, ok: false, reason: (err as Error).message });
      missing.push(gid);
    }
  }
  return {
    checked: taskGids.length,
    ok: results.filter((r) => r.ok).length,
    missing,
    results,
  };
}
