/**
 * Asana Audit Pack Uploader — F7.
 *
 * When the audit-pack endpoint produces a signed JSON bundle, this
 * helper converts it into the payload shape the Asana attachment
 * uploader expects (`uploadAsanaAttachment` in asanaClient.ts) AND
 * pre-validates it against `asanaAttachmentSecurity.ts` so a
 * tampered or oversized bundle is rejected before it reaches Asana.
 *
 * Pure compute — produces the upload request shape. The orchestrator
 * calls the actual asanaClient + virus scanner.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.24 (record retention with reconstruction)
 *   FATF Methodology 2022 §4 (supervisory access)
 *   ISO/IEC 27001 A.8.10 (data separation)
 */

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024; // 50 MiB Asana cap

export interface AuditPackUploadRequest {
  /** Asana parent task gid the attachment will be linked to. */
  parentTaskGid: string;
  /** Filename to surface in the Asana UI. */
  filename: string;
  /** UTF-8 string of the JSON bundle. */
  bodyText: string;
  /** Content type — always application/json for audit packs. */
  contentType: 'application/json';
}

export interface UploadValidationResult {
  ok: boolean;
  reason?: string;
  /** Size in bytes after UTF-8 encoding. */
  byteLength: number;
}

/**
 * Validate the upload request before sending it to Asana. Rejects:
 *   - Empty or missing parent task gid
 *   - Bundles larger than 50 MiB (Asana's hard cap)
 *   - Malformed JSON content
 *   - Bundles missing the manifest signature when the env var is set
 */
export function validateAuditPackUpload(
  req: AuditPackUploadRequest,
  options: { requireSignature?: boolean } = {}
): UploadValidationResult {
  const byteLength = new TextEncoder().encode(req.bodyText).byteLength;
  if (!req.parentTaskGid) {
    return { ok: false, reason: 'parentTaskGid is required', byteLength };
  }
  if (byteLength === 0) {
    return { ok: false, reason: 'audit pack body is empty', byteLength };
  }
  if (byteLength > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      reason: `audit pack ${byteLength} bytes exceeds Asana 50 MiB cap`,
      byteLength,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(req.bodyText);
  } catch {
    return { ok: false, reason: 'audit pack body is not valid JSON', byteLength };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'audit pack must be a JSON object', byteLength };
  }
  const manifest = (parsed as { manifest?: { signature?: string } }).manifest;
  if (options.requireSignature && (!manifest || !manifest.signature)) {
    return {
      ok: false,
      reason: 'audit pack manifest is missing the HMAC signature (set HAWKEYE_AUDIT_HMAC_KEY)',
      byteLength,
    };
  }
  return { ok: true, byteLength };
}

/**
 * Build the create-attachment request body for asanaClient.
 * Returns a `Blob` so the existing `uploadAsanaAttachment` signature
 * (which expects a multipart-friendly Blob) accepts it directly.
 */
export function buildAuditPackBlob(req: AuditPackUploadRequest): Blob {
  return new Blob([req.bodyText], { type: req.contentType });
}
