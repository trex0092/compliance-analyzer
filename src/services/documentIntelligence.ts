/**
 * Document Intelligence — KYC document extraction + tamper detection.
 *
 * Passports, Emirates IDs, trade licences, utility bills. The goal:
 * auto-populate the CRA form during onboarding, reducing manual data
 * entry errors and catching obvious forgery signals.
 *
 * This module ships the INTERFACE and a deterministic mock extractor
 * so the rest of the compliance pipeline can be built against it.
 * A real implementation backs it with:
 *   - Tesseract OCR (open-source, local)
 *   - Google Document AI / AWS Textract (commercial vision APIs)
 *   - PDF metadata inspection (exiftool) for tamper markers
 *
 * The swap-in point is `extractDocument()` — once the caller provides
 * a real extractor, the whole pipeline works without further changes.
 */

// ---------------------------------------------------------------------------
// Document types
// ---------------------------------------------------------------------------

export type DocumentType =
  | 'passport'
  | 'emirates_id'
  | 'trade_license'
  | 'utility_bill'
  | 'bank_statement'
  | 'proof_of_address'
  | 'unknown';

export interface ExtractedField {
  name: string;
  value: string;
  /** OCR confidence 0..1. */
  confidence: number;
  /** Bounding box on the source image (optional). */
  bbox?: { x: number; y: number; w: number; h: number };
}

export interface TamperSignal {
  kind:
    | 'inconsistent_font'
    | 'metadata_mismatch'
    | 'date_in_future'
    | 'expiry_passed'
    | 'checksum_mismatch'
    | 'duplicate_document_id'
    | 'layer_artefact'
    | 'unusual_resolution';
  severity: 'low' | 'medium' | 'high';
  detail: string;
}

export interface DocumentExtractionResult {
  documentType: DocumentType;
  fields: ExtractedField[];
  /** Auto-populated primary identifiers. */
  identifiers: {
    fullName?: string;
    dateOfBirth?: string;
    nationality?: string;
    documentNumber?: string;
    issueDate?: string;
    expiryDate?: string;
    issuingAuthority?: string;
  };
  tamperSignals: TamperSignal[];
  /** Overall confidence in the extraction as a whole. */
  overallConfidence: number;
}

// ---------------------------------------------------------------------------
// Pluggable extractor interface
// ---------------------------------------------------------------------------

export interface DocumentExtractor {
  name: string;
  extract(buffer: Uint8Array, hint?: DocumentType): Promise<DocumentExtractionResult>;
}

/** The global extractor — swap at startup with a real implementation. */
let globalExtractor: DocumentExtractor | null = null;

export function registerExtractor(extractor: DocumentExtractor): void {
  globalExtractor = extractor;
}

export function getExtractor(): DocumentExtractor {
  return globalExtractor ?? mockExtractor;
}

// ---------------------------------------------------------------------------
// Deterministic mock extractor (for tests + development)
// ---------------------------------------------------------------------------

/**
 * Pseudo-extractor that returns a fixed response when fed the ASCII
 * string "MOCK:<type>:<name>:<dob>:<docnum>" as a UTF-8 buffer.
 * Any other input returns an empty unknown-type result.
 */
export const mockExtractor: DocumentExtractor = {
  name: 'mock',
  async extract(buffer: Uint8Array, hint?: DocumentType): Promise<DocumentExtractionResult> {
    const text = new TextDecoder().decode(buffer);
    if (!text.startsWith('MOCK:')) {
      return {
        documentType: hint ?? 'unknown',
        fields: [],
        identifiers: {},
        tamperSignals: [],
        overallConfidence: 0,
      };
    }
    const [, type, name, dob, docNum] = text.split(':');
    const docType = (type as DocumentType) ?? 'unknown';
    return {
      documentType: docType,
      fields: [
        { name: 'full_name', value: name, confidence: 0.98 },
        { name: 'date_of_birth', value: dob, confidence: 0.96 },
        { name: 'document_number', value: docNum, confidence: 0.99 },
      ],
      identifiers: {
        fullName: name,
        dateOfBirth: dob,
        documentNumber: docNum,
      },
      tamperSignals: [],
      overallConfidence: 0.97,
    };
  },
};

export async function extractDocument(
  buffer: Uint8Array,
  hint?: DocumentType
): Promise<DocumentExtractionResult> {
  return getExtractor().extract(buffer, hint);
}

// ---------------------------------------------------------------------------
// Tamper detection — pure checks on the extracted result
// ---------------------------------------------------------------------------

/**
 * Run deterministic tamper checks on an already-extracted result.
 * Additive — appends to existing tamperSignals.
 */
export function runTamperChecks(
  result: DocumentExtractionResult,
  now = new Date().toISOString()
): DocumentExtractionResult {
  const signals: TamperSignal[] = [...result.tamperSignals];
  const nowDate = new Date(now).getTime();

  // 1. Expiry passed
  if (result.identifiers.expiryDate) {
    const expiry = new Date(result.identifiers.expiryDate).getTime();
    if (!isNaN(expiry) && expiry < nowDate) {
      signals.push({
        kind: 'expiry_passed',
        severity: 'high',
        detail: `Document expired on ${result.identifiers.expiryDate}`,
      });
    }
  }

  // 2. Issue date in the future
  if (result.identifiers.issueDate) {
    const issue = new Date(result.identifiers.issueDate).getTime();
    if (!isNaN(issue) && issue > nowDate) {
      signals.push({
        kind: 'date_in_future',
        severity: 'high',
        detail: `Issue date ${result.identifiers.issueDate} is in the future`,
      });
    }
  }

  // 3. DoB in the future
  if (result.identifiers.dateOfBirth) {
    const dob = new Date(result.identifiers.dateOfBirth).getTime();
    if (!isNaN(dob) && dob > nowDate) {
      signals.push({
        kind: 'date_in_future',
        severity: 'high',
        detail: `Date of birth ${result.identifiers.dateOfBirth} is in the future`,
      });
    }
  }

  // 4. Low-confidence extraction
  if (result.overallConfidence > 0 && result.overallConfidence < 0.6) {
    signals.push({
      kind: 'unusual_resolution',
      severity: 'low',
      detail: `Extraction confidence is low (${result.overallConfidence.toFixed(2)})`,
    });
  }

  return { ...result, tamperSignals: signals };
}

/**
 * Duplicate document-number detection across a historical set.
 * Used by the onboarding flow to catch "same passport, different customer".
 */
export function detectDuplicateDocuments(
  currentDocNumber: string,
  history: readonly string[]
): TamperSignal | null {
  if (!currentDocNumber) return null;
  const seen = history.filter((h) => h === currentDocNumber);
  if (seen.length === 0) return null;
  return {
    kind: 'duplicate_document_id',
    severity: 'high',
    detail: `Document number ${currentDocNumber} already seen in ${seen.length} prior record(s)`,
  };
}
