/**
 * STR Narrative Grader — subsystem #38.
 *
 * FIU rejection rates on STR filings are driven by narrative quality.
 * This module grades a draft narrative against the FIU rubric (FATF
 * Rec 20 + FDL Art.26-27 + MoE Circular 08/AML/2021) BEFORE filing
 * so the MLRO can fix issues upfront.
 *
 * The grader checks six dimensions (each 0-20, total 0-120):
 *   1. 5W completeness: who / what / when / where / why
 *   2. Specificity: named entities, dates, amounts, jurisdictions
 *   3. Typology clarity: matches a known FATF/EOCN typology
 *   4. Evidence references: cites concrete transaction IDs / sources
 *   5. Non-boilerplate: doesn't reuse prior filing language
 *   6. Regulatory citation: cites the correct Article / Circular
 *
 * Purely deterministic — no LLM calls. A narrative that scores <70
 * is flagged "rewrite required"; 70-99 is "usable but improve"; >=100
 * is "filing-ready".
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.26-27 (STR quality + filing)
 *   - MoE Circular 08/AML/2021 (DPMS STR format)
 *   - FATF Rec 20 (meaningful reporting, not boilerplate)
 *   - Cabinet Res 134/2025 Art.19 (internal review before filing)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StrGradeInput {
  narrative: string;
  /** Known typologies the matcher already identified. */
  matchedTypologies?: readonly string[];
}

export interface StrGradeReport {
  totalScore: number;
  dimensions: {
    fiveW: number;
    specificity: number;
    typology: number;
    evidence: number;
    nonBoilerplate: number;
    citation: number;
  };
  verdict: 'filing_ready' | 'usable_improve' | 'rewrite_required';
  gaps: string[];
  narrative: string;
}

// ---------------------------------------------------------------------------
// Grader
// ---------------------------------------------------------------------------

const WHO_PATTERNS =
  /\b(customer|subject|entity|natural person|legal entity|beneficial owner|signatory|counterparty)\b/i;
const WHAT_PATTERNS =
  /\b(transaction|transfer|deposit|withdrawal|wire|cash|bullion|gold|crypto|shipment|invoice)\b/i;
const WHEN_PATTERNS =
  /\b(on|between|from|since|during|january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}\/\d{1,2}\/\d{2,4})\b/i;
const WHERE_PATTERNS =
  /\b(UAE|Dubai|Abu Dhabi|Iran|DPRK|Sudan|Syria|Russia|onshore|offshore|free zone|bank account|exchange|VASP)\b/i;
const WHY_PATTERNS =
  /\b(suspicion|suspicious|possible|likely|indicator|red flag|typology|evasion|structuring|layering|integration|TF|terrorist|PF|proliferation)\b/i;

const SPECIFICITY_PATTERNS = [
  /\bAED\s?\d/i, // amount with AED
  /\d{1,3}(?:,\d{3})+/, // formatted amounts
  /\b(IBAN|BIC|SWIFT)\b/i, // banking identifiers
  /\b\d{4}-\d{2}-\d{2}\b/, // ISO date
  /\b\d{1,2}\/\d{1,2}\/\d{4}\b/, // dd/mm/yyyy
];

const BOILERPLATE_PHRASES = [
  'exhibited unusual behaviour',
  'engaged in suspicious activity',
  'was flagged by the system',
  'triggered an alert in our system',
  'large amount of cash',
  'without clear economic purpose',
];

const ARTICLE_CITATION =
  /(FDL\s*(?:No\.?\s*)?10\/2025|Cabinet\s*Res(olution)?\s*\d+\/\d{4}|Cabinet\s*Decision\s*\d+\/\d{4}|MoE\s*Circular|FATF\s*Rec)/i;

export function gradeStrNarrative(input: StrGradeInput): StrGradeReport {
  const text = input.narrative;
  const lower = text.toLowerCase();
  const gaps: string[] = [];

  // 1. 5W completeness — 4 points per W present
  let fiveW = 0;
  if (WHO_PATTERNS.test(text)) fiveW += 4;
  else gaps.push('5W: WHO missing — name the subject / customer / UBO.');
  if (WHAT_PATTERNS.test(text)) fiveW += 4;
  else gaps.push('5W: WHAT missing — name the activity / instrument.');
  if (WHEN_PATTERNS.test(text)) fiveW += 4;
  else gaps.push('5W: WHEN missing — include date / time window.');
  if (WHERE_PATTERNS.test(text)) fiveW += 4;
  else gaps.push('5W: WHERE missing — include jurisdiction / venue.');
  if (WHY_PATTERNS.test(text)) fiveW += 4;
  else gaps.push('5W: WHY missing — state the suspicion / red flag.');

  // 2. Specificity — 4 points per specific detail up to 20
  let specificity = 0;
  for (const p of SPECIFICITY_PATTERNS) {
    if (p.test(text)) specificity += 4;
  }
  specificity = Math.min(20, specificity);
  if (specificity < 12) gaps.push('Specificity: add concrete amounts, dates, identifiers.');

  // 3. Typology clarity — 20 if matchedTypologies present; else detect inline
  let typology = 0;
  if (input.matchedTypologies && input.matchedTypologies.length > 0) {
    typology = 20;
  } else if (
    /\b(structuring|smurfing|layering|trade-based|front-company|shell|chain-hopping|BIC stripping)\b/i.test(
      text
    )
  ) {
    typology = 16;
  } else if (/\btypology\b/i.test(text)) {
    typology = 10;
  } else {
    gaps.push('Typology: no FATF/EOCN typology named explicitly.');
  }

  // 4. Evidence references — txID / case ID / tabular reference
  let evidence = 0;
  if (/\b(tx|transaction)[\s-]?id[\s:]*[\w-]+/i.test(text)) evidence += 8;
  if (/\b(case|alert|file)[\s-]?id[\s:]*[\w-]+/i.test(text)) evidence += 6;
  if (/\bwitnessed|observed|reviewed|analysed|verified\b/i.test(text)) evidence += 4;
  if (/\bcompliance officer|MLRO|auditor|analyst\b/i.test(text)) evidence += 2;
  evidence = Math.min(20, evidence);
  if (evidence < 10) gaps.push('Evidence: cite concrete transaction / case IDs.');

  // 5. Non-boilerplate — 20 minus 4 per boilerplate hit
  let nonBoilerplate = 20;
  for (const b of BOILERPLATE_PHRASES) {
    if (lower.includes(b)) nonBoilerplate -= 4;
  }
  nonBoilerplate = Math.max(0, nonBoilerplate);
  if (nonBoilerplate < 16)
    gaps.push('Non-boilerplate: replace cliché phrases with specific observations.');

  // 6. Regulatory citation — 20 if article cited, else 0
  let citation = 0;
  if (ARTICLE_CITATION.test(text)) {
    citation = 20;
  } else {
    gaps.push('Citation: reference the specific Article / Circular that triggers the report.');
  }

  const total = fiveW + specificity + typology + evidence + nonBoilerplate + citation;
  const verdict: StrGradeReport['verdict'] =
    total >= 100 ? 'filing_ready' : total >= 70 ? 'usable_improve' : 'rewrite_required';

  const narrative =
    `STR narrative grader: ${total}/120 score, verdict ${verdict}. ` +
    (gaps.length > 0 ? `${gaps.length} gap(s) identified.` : 'No gaps.');

  return {
    totalScore: total,
    dimensions: {
      fiveW,
      specificity,
      typology,
      evidence,
      nonBoilerplate,
      citation,
    },
    verdict,
    gaps,
    narrative,
  };
}
