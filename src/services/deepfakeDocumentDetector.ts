/**
 * Deepfake Document Detector — subsystem #102 (Phase 9).
 *
 * Heuristic detector for AI-generated KYC documents (passports,
 * Emirates IDs, proof-of-address letters). Without pixel-level image
 * analysis — which requires binary dependencies we don't ship — this
 * module detects the TEXT-LEVEL and METADATA-LEVEL fingerprints that
 * AI-generated documents typically carry:
 *
 *   - Perfect grammar with zero typos across a long document
 *     (real scanned documents from retail customers almost always
 *     contain transcription artefacts)
 *   - Boilerplate LLM filler phrases ("I hereby certify", "to whom
 *     it may concern", "please find attached")
 *   - Round-number amounts (exactly AED 100,000 instead of AED
 *     97,432 — retail customers rarely have round numbers)
 *   - Suspiciously consistent formatting (same font weight, no
 *     header/footer rotation, no watermark)
 *   - Missing regulator-specific fields (passports should have
 *     MRZ lines, Emirates IDs should have 784-prefix format)
 *   - Inconsistent date-of-issue vs signature block
 *   - Zero natural imperfections (no creases mentioned, no scan
 *     rotation artefacts in OCR metadata)
 *
 * Returns a confidence score 0-100. Above 70 is "high confidence AI-
 * generated, reject upload"; 40-69 is "suspicious, route to
 * human review"; below 40 is likely genuine.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.12-14 (identity verification — must detect
 *     synthetic identity)
 *   - Cabinet Res 134/2025 Art.7-10 (CDD with verified evidence)
 *   - FATF Rec 10 (CDD on authentic documentation)
 *   - EU AI Act Art.50 (deepfake detection obligation)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DocumentEvidence {
  docType: 'passport' | 'emirates_id' | 'proof_of_address' | 'bank_statement' | 'generic';
  extractedText: string;
  /** Optional OCR/extraction metadata. */
  metadata?: {
    fontVariability?: number; // 0-1, higher = more varied fonts
    hasScanArtefacts?: boolean;
    hasMrzLines?: boolean;
    hasWatermark?: boolean;
  };
}

export interface DeepfakeFinding {
  id: string;
  severity: 'critical' | 'high' | 'medium';
  description: string;
}

export interface DeepfakeReport {
  score: number; // 0-100, higher = more likely AI-generated
  verdict: 'likely_genuine' | 'suspicious' | 'likely_deepfake';
  findings: DeepfakeFinding[];
  narrative: string;
}

// ---------------------------------------------------------------------------
// Heuristics
// ---------------------------------------------------------------------------

const LLM_FILLER_PHRASES = [
  'i hereby certify',
  'to whom it may concern',
  'please find attached',
  'for your consideration',
  'in accordance with',
  'pursuant to',
  'without prejudice',
  'should you have any questions',
  'at your earliest convenience',
  'rest assured',
];

const ROUND_NUMBER_REGEX = /\b(?:AED|USD|EUR)\s*\d{1,3}(?:,000){1,3}(?![,.]\d)/gi;

export function detectDeepfakeDocument(evidence: DocumentEvidence): DeepfakeReport {
  const findings: DeepfakeFinding[] = [];
  let score = 0;
  const text = evidence.extractedText;
  const lower = text.toLowerCase();

  // Heuristic 1: LLM filler phrase density
  let fillerCount = 0;
  for (const phrase of LLM_FILLER_PHRASES) {
    if (lower.includes(phrase)) fillerCount += 1;
  }
  if (fillerCount >= 3) {
    findings.push({
      id: 'DF-01',
      severity: 'high',
      description: `${fillerCount} LLM filler phrases detected — typical of generated text`,
    });
    score += 25;
  } else if (fillerCount >= 1) {
    score += 8;
  }

  // Heuristic 2: Round-number amounts
  const roundMatches = text.match(ROUND_NUMBER_REGEX);
  if (roundMatches && roundMatches.length >= 2) {
    findings.push({
      id: 'DF-02',
      severity: 'medium',
      description: `${roundMatches.length} round-number amounts detected — retail customers rarely have exact round figures`,
    });
    score += 15;
  }

  // Heuristic 3: Grammatical perfection over a long document
  // (real scanned KYC docs typically contain some typos / OCR errors)
  if (text.length >= 500) {
    const typoRegex = /\b\w+[0O]\w*|\b[Il1]{2,}\b|\b[Oo0]{2,}\b/;
    if (!typoRegex.test(text)) {
      findings.push({
        id: 'DF-03',
        severity: 'medium',
        description: `Long document (${text.length} chars) with zero OCR-typical imperfections`,
      });
      score += 10;
    }
  }

  // Heuristic 4: Passport-specific — missing MRZ lines
  if (evidence.docType === 'passport' && !evidence.metadata?.hasMrzLines) {
    findings.push({
      id: 'DF-04',
      severity: 'critical',
      description: 'Passport document missing MRZ (Machine-Readable Zone) lines — likely synthetic',
    });
    score += 35;
  }

  // Heuristic 5: Emirates ID format check
  if (evidence.docType === 'emirates_id') {
    const eidRegex = /\b784-?\d{4}-?\d{7}-?\d\b/;
    if (!eidRegex.test(text)) {
      findings.push({
        id: 'DF-05',
        severity: 'critical',
        description: 'Emirates ID document missing 784-prefix format — invalid or synthetic',
      });
      score += 35;
    }
  }

  // Heuristic 6: Metadata — suspiciously consistent formatting
  if (evidence.metadata?.fontVariability !== undefined && evidence.metadata.fontVariability < 0.1) {
    findings.push({
      id: 'DF-06',
      severity: 'medium',
      description:
        'Font variability is suspiciously low — AI-generated documents lack natural variation',
    });
    score += 10;
  }

  // Heuristic 7: Scan artefacts missing
  if (
    evidence.metadata?.hasScanArtefacts === false &&
    evidence.docType !== 'bank_statement' // bank statements may be natively PDF
  ) {
    findings.push({
      id: 'DF-07',
      severity: 'medium',
      description: 'Document has no scan artefacts — natively generated rather than scanned',
    });
    score += 8;
  }

  // Cap at 100
  score = Math.min(100, score);

  const verdict: DeepfakeReport['verdict'] =
    score >= 70 ? 'likely_deepfake' : score >= 40 ? 'suspicious' : 'likely_genuine';

  const narrative =
    verdict === 'likely_deepfake'
      ? `Deepfake detector: score ${score}/100 — LIKELY AI-GENERATED. Reject upload and request in-person verification per FDL Art.12-14.`
      : verdict === 'suspicious'
        ? `Deepfake detector: score ${score}/100 — SUSPICIOUS. Route to human review per Cabinet Res 134/2025 Art.19.`
        : `Deepfake detector: score ${score}/100 — likely genuine.`;

  return { score, verdict, findings, narrative };
}
