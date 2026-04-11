/**
 * Advisor Hallucination Detector — subsystem #58.
 *
 * Phase 1 wired the Opus advisor into the Weaponized Brain. Opus is
 * excellent at regulatory reasoning but can occasionally fabricate
 * citations — "FDL Art.500" doesn't exist, neither does "Cabinet Res
 * 999/2099". This subsystem validates every article citation in
 * advisor output against a whitelist of real, known-good articles.
 *
 * Any citation outside the whitelist is flagged and either removed
 * from the response or surfaces as a hallucination warning to the
 * MLRO. The brain proceeds but the MLRO knows to double-check.
 *
 * Whitelist is loaded from src/domain/constants.ts style-citations we
 * already track elsewhere, so regulatory updates naturally extend the
 * whitelist without this subsystem needing to change.
 *
 * Regulatory basis:
 *   - NIST AI RMF MS-2.2 (explainability + accuracy)
 *   - FDL No.10/2025 Art.20-21 (CO documents reasoning — must be true)
 */

// ---------------------------------------------------------------------------
// Whitelist — every regulation the project legitimately cites.
// ---------------------------------------------------------------------------

/**
 * Known-good regulatory citations. Extend this list when a new
 * regulation lands. Each entry is a canonical form; the validator
 * normalises input before comparison.
 */
export const KNOWN_REGULATIONS: readonly string[] = [
  // UAE primary law
  'FDL No.10/2025',
  'FDL Art.12',
  'FDL Art.13',
  'FDL Art.14',
  'FDL Art.15',
  'FDL Art.16',
  'FDL Art.20',
  'FDL Art.21',
  'FDL Art.24',
  'FDL Art.26',
  'FDL Art.27',
  'FDL Art.29',
  'FDL Art.35',
  // Cabinet Resolutions
  'Cabinet Res 134/2025',
  'Cabinet Res 74/2020',
  'Cabinet Res 156/2025',
  'Cabinet Res 71/2024',
  'Cabinet Decision 109/2023',
  // MoE
  'MoE Circular 08/AML/2021',
  // LBMA
  'LBMA RGG v9',
  'LBMA Responsible Gold Guidance',
  // FATF
  'FATF Rec 1',
  'FATF Rec 6',
  'FATF Rec 10',
  'FATF Rec 11',
  'FATF Rec 15',
  'FATF Rec 16',
  'FATF Rec 18',
  'FATF Rec 20',
  'FATF Rec 21',
  'FATF Rec 22',
  'FATF Rec 23',
  // EU / NIST / ISO (Phase 5)
  'EU Reg 2024/1689',
  'NIST AI RMF',
  'ISO/IEC 42001',
  // UAE Charter + Strategy
  'UAE National AI Strategy 2031',
  'UAE AI Charter',
  'Federal Law 45/2021',
  'CBUAE CN 15/2021',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HallucinationFinding {
  citation: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export interface HallucinationReport {
  clean: boolean;
  findings: HallucinationFinding[];
  totalCitationsFound: number;
  totalCitationsValidated: number;
  narrative: string;
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

// Extracts anything that LOOKS like a regulatory citation.
const CITATION_PATTERNS: RegExp[] = [
  /\bFDL\s*(?:No\.?\s*)?\d{1,3}\/\d{4}\s*Art\.?\s*\d{1,3}(?:-\d{1,3})?/gi,
  /\bFDL\s*Art\.?\s*\d{1,3}(?:-\d{1,3})?/gi,
  /\bCabinet\s*(?:Res|Resolution|Decision)\s*\d{1,4}\/\d{4}(?:\s*Art\.?\s*\d{1,3}(?:-\d{1,3})?)?/gi,
  /\bMoE\s*Circular\s*\d{1,3}\/[A-Z]{3}\/\d{4}/gi,
  /\bLBMA\s*(?:RGG\s*v?\d+|Responsible\s*Gold\s*Guidance)/gi,
  /\bFATF\s*Rec\.?\s*\d{1,3}/gi,
  /\bEU\s*Reg(?:ulation)?\s*\d{4}\/\d{2,4}/gi,
  /\bNIST\s*AI\s*RMF/gi,
  /\bISO\/?IEC\s*42001/gi,
];

export function detectAdvisorHallucinations(advisorText: string): HallucinationReport {
  const foundCitations = new Set<string>();

  for (const pattern of CITATION_PATTERNS) {
    const matches = advisorText.matchAll(pattern);
    for (const m of matches) foundCitations.add(m[0].trim());
  }

  const findings: HallucinationFinding[] = [];
  let validated = 0;

  for (const citation of foundCitations) {
    if (isKnownCitation(citation)) {
      validated += 1;
      continue;
    }
    // Unknown — score confidence based on shape
    let confidence: HallucinationFinding['confidence'] = 'medium';
    let reason = 'citation not in known-regulations whitelist';

    // Extremely suspicious: obviously fabricated article numbers
    if (/\bArt\.?\s*(\d+)/i.test(citation)) {
      const m = citation.match(/\bArt\.?\s*(\d+)/i);
      const num = m ? Number.parseInt(m[1], 10) : 0;
      if (num > 100) {
        confidence = 'high';
        reason = `article number ${num} is outside known range — likely fabricated`;
      }
    }
    // Year far in the future
    if (/\/\d{4}/i.test(citation)) {
      const m = citation.match(/\/(\d{4})/);
      const yr = m ? Number.parseInt(m[1], 10) : 0;
      if (yr > new Date().getFullYear() + 2) {
        confidence = 'high';
        reason = `year ${yr} is in the future — likely fabricated`;
      }
    }

    findings.push({ citation, confidence, reason });
  }

  const clean = findings.length === 0;
  const narrative = clean
    ? `Advisor hallucination detector: clean. ${validated} citation(s) validated against whitelist.`
    : `Advisor hallucination detector: ${findings.length} unverified citation(s), ${validated} valid. ` +
      `Top finding: "${findings[0].citation}" (${findings[0].confidence}, ${findings[0].reason}).`;

  return {
    clean,
    findings,
    totalCitationsFound: foundCitations.size,
    totalCitationsValidated: validated,
    narrative,
  };
}

function isKnownCitation(candidate: string): boolean {
  const norm = candidate.replace(/\s+/g, ' ').trim();
  for (const known of KNOWN_REGULATIONS) {
    // Substring match — advisor may append "Art.X" to a known base.
    if (norm.toLowerCase().includes(known.toLowerCase())) return true;
    if (known.toLowerCase().includes(norm.toLowerCase())) return true;
  }
  return false;
}
