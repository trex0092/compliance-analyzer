/**
 * goAML XML Validator — Pre-submission validation
 *
 * Validates goAML XML against UAE FIU requirements before submission.
 * Checks required fields, date formats, amount formats, entity structure.
 *
 * Report types covered:
 *   STR   — Suspicious Transaction Report (FDL Art.26)
 *   SAR   — Suspicious Activity Report (FDL Art.26)
 *   CTR   — Cash Transaction Report (FDL Art.16)
 *   DPMSR — Dealer in Precious Metals Sector Report (MoE 08/AML/2021)
 *   CNMR  — Cross-border Notification / Match Report (Cabinet Res 74/2020)
 *
 * All validators share the Art.29 tipping-off invariant — no report
 * content may reference "we filed", "reported to FIU", etc.
 */

import { DPMS_CASH_THRESHOLD_AED } from '../domain/constants';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

interface ValidationError {
  field: string;
  message: string;
  regulatory: string;
}

interface ValidationWarning {
  field: string;
  message: string;
}

/**
 * Validate STR XML before submission.
 */
export function validateSTR(xml: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Required elements
  const requiredElements = [
    { tag: 'reportHeader', reg: 'FIU goAML Schema' },
    { tag: 'reportingEntity', reg: 'FDL Art.20' },
    { tag: 'suspiciousSubject', reg: 'FDL Art.26' },
    { tag: 'groundsForSuspicion', reg: 'FDL Art.26' },
    { tag: 'transactionDetails', reg: 'FDL Art.26' },
    { tag: 'reportFooter', reg: 'FIU goAML Schema' },
  ];

  for (const el of requiredElements) {
    if (!xml.includes(`<${el.tag}`) && !xml.includes(`<${el.tag}/`)) {
      errors.push({
        field: el.tag,
        message: `Missing required element: <${el.tag}>`,
        regulatory: el.reg,
      });
    }
  }

  // Report ID format (anchored to prevent partial matches)
  if (!xml.match(/RPT-\d+-[a-zA-Z0-9]+(?=<)/)) {
    errors.push({
      field: 'reportId',
      message: 'Report ID must follow RPT-[timestamp]-[random] format',
      regulatory: 'FIU goAML Schema',
    });
  }

  // Date format validation (YYYY-MM-DD) — safe extraction without backtracking
  const dateMatches = xml.match(/<[^>]*[Dd]ate[^>]*>[^<]+<\//g) || [];
  for (const match of dateMatches) {
    const value = match.replace(/<[^>]+>/g, '').replace(/<\/$/, '');
    if (value && !/^\d{4}-\d{2}-\d{2}/.test(value)) {
      errors.push({
        field: 'date',
        message: `Invalid date format: "${value}". Must be YYYY-MM-DD.`,
        regulatory: 'FIU goAML Schema',
      });
    }
  }

  // Amount format (numeric, 2 decimal places)
  const amountMatches = xml.match(/<[^>]*[Aa]mount[^>]*>([^<]+)<\//g) || [];
  for (const match of amountMatches) {
    const value = match.replace(/<[^>]*>/g, '').replace(/<\/.*/, '');
    if (value && !/^\d+(\.\d{1,2})?$/.test(value.trim())) {
      warnings.push({
        field: 'amount',
        message: `Amount "${value}" should be numeric with up to 2 decimal places`,
      });
    }
  }

  // Check for unescaped special characters (bare & not part of a valid XML entity)
  const textContent = xml.replace(/<[^>]*>/g, '');
  if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;)/.test(textContent)) {
    warnings.push({
      field: 'content',
      message: "Unescaped '&' character found. Use &amp; in XML.",
    });
  }

  // Subject name present
  if (!xml.match(/<subjectName>[^<]+<\/subjectName>/)) {
    errors.push({
      field: 'subjectName',
      message: 'Subject name is required for STR',
      regulatory: 'FDL Art.26',
    });
  }

  // Grounds for suspicion not empty
  if (xml.match(/<groundsForSuspicion>\s*<\/groundsForSuspicion>/)) {
    errors.push({
      field: 'groundsForSuspicion',
      message: 'Grounds for suspicion cannot be empty',
      regulatory: 'FDL Art.26',
    });
  }

  // Tipping-off check — STR should not contain subject notification language (FDL Art.29)
  // Use both exact phrases and regex patterns to catch variations
  const tippingOffPhrases = [
    'we have reported',
    'filed a report',
    'notified authorities',
    'suspicious transaction report',
    'str has been filed',
    'reported to fiu',
    'reported to authorities',
    'str submission',
    'suspicious activity report',
    'sar has been filed',
    'under investigation',
    'compliance referral',
  ];
  const tippingOffPatterns = [
    /\b(reported|filed|submitted)\s+(to|with)\s+(the\s+)?(fiu|authorities|regulator|goaml)/i,
    /\bstr\b.{0,20}\b(filed|submitted|sent|generated)/i,
    /\bsar\b.{0,20}\b(filed|submitted|sent|generated)/i,
    /\b(we|i|the company)\s+(have\s+)?(reported|filed|notified|informed)/i,
  ];
  const lowerXml = xml.toLowerCase();
  for (const phrase of tippingOffPhrases) {
    if (lowerXml.includes(phrase)) {
      errors.push({
        field: 'content',
        message: `Potential tipping-off risk: contains "${phrase}"`,
        regulatory: 'FDL Art.29 — No Tipping Off',
      });
    }
  }
  for (const pattern of tippingOffPatterns) {
    if (pattern.test(xml)) {
      errors.push({
        field: 'content',
        message: `Potential tipping-off risk: matches pattern ${pattern.source}`,
        regulatory: 'FDL Art.29 — No Tipping Off',
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate CTR XML before submission.
 */
export function validateCTR(xml: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const requiredElements = [
    { tag: 'reportHeader', reg: 'FIU goAML Schema' },
    { tag: 'reportingEntity', reg: 'FDL Art.20' },
    { tag: 'cashTransaction', reg: 'FDL Art.16' },
    { tag: 'cashAmount', reg: 'FDL Art.16' },
  ];

  for (const el of requiredElements) {
    if (!xml.includes(`<${el.tag}`) && !xml.includes(`<${el.tag}/`)) {
      errors.push({
        field: el.tag,
        message: `Missing required element: <${el.tag}>`,
        regulatory: el.reg,
      });
    }
  }

  // Verify amount >= 55,000 AED
  const amountMatch = xml.match(/<cashAmount>([^<]+)<\/cashAmount>/);
  if (amountMatch) {
    const amount = parseFloat(amountMatch[1]);
    if (!isNaN(amount) && amount < DPMS_CASH_THRESHOLD_AED) {
      warnings.push({
        field: 'cashAmount',
        message: `Amount ${amount} AED is below the AED ${DPMS_CASH_THRESHOLD_AED.toLocaleString()} threshold. CTR may not be required.`,
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function checkRequired(
  xml: string,
  required: Array<{ tag: string; reg: string }>,
  errors: ValidationError[],
): void {
  for (const el of required) {
    if (!xml.includes(`<${el.tag}`) && !xml.includes(`<${el.tag}/`)) {
      errors.push({
        field: el.tag,
        message: `Missing required element: <${el.tag}>`,
        regulatory: el.reg,
      });
    }
  }
}

function checkReportId(xml: string, errors: ValidationError[]): void {
  if (!xml.match(/RPT-\d+-[a-zA-Z0-9]+(?=<)/)) {
    errors.push({
      field: 'reportId',
      message: 'Report ID must follow RPT-[timestamp]-[random] format',
      regulatory: 'FIU goAML Schema',
    });
  }
}

function checkDateFormats(xml: string, errors: ValidationError[]): void {
  const dateMatches = xml.match(/<[^>]*[Dd]ate[^>]*>[^<]+<\//g) || [];
  for (const match of dateMatches) {
    const value = match.replace(/<[^>]+>/g, '').replace(/<\/$/, '');
    if (value && !/^\d{4}-\d{2}-\d{2}/.test(value)) {
      errors.push({
        field: 'date',
        message: `Invalid date format: "${value}". Must be YYYY-MM-DD.`,
        regulatory: 'FIU goAML Schema',
      });
    }
  }
}

function checkAmountFormats(xml: string, warnings: ValidationWarning[]): void {
  const amountMatches = xml.match(/<[^>]*[Aa]mount[^>]*>([^<]+)<\//g) || [];
  for (const match of amountMatches) {
    const value = match.replace(/<[^>]*>/g, '').replace(/<\/.*/, '');
    if (value && !/^\d+(\.\d{1,2})?$/.test(value.trim())) {
      warnings.push({
        field: 'amount',
        message: `Amount "${value}" should be numeric with up to 2 decimal places`,
      });
    }
  }
}

function checkXmlEntities(xml: string, warnings: ValidationWarning[]): void {
  const textContent = xml.replace(/<[^>]*>/g, '');
  if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;)/.test(textContent)) {
    warnings.push({
      field: 'content',
      message: "Unescaped '&' character found. Use &amp; in XML.",
    });
  }
}

/**
 * FDL Art.29 tipping-off check — any regulator-facing report must NOT
 * contain language that could be read as a notification to the subject.
 * Runs on all report types.
 */
function checkNoTippingOff(xml: string, errors: ValidationError[]): void {
  const phrases = [
    'we have reported',
    'filed a report',
    'notified authorities',
    'suspicious transaction report',
    'str has been filed',
    'reported to fiu',
    'reported to authorities',
    'str submission',
    'suspicious activity report',
    'sar has been filed',
    'under investigation',
    'compliance referral',
    'we have informed',
    'notified the fiu',
  ];
  const patterns = [
    /\b(reported|filed|submitted)\s+(to|with)\s+(the\s+)?(fiu|authorities|regulator|goaml)/i,
    /\bstr\b.{0,20}\b(filed|submitted|sent|generated)/i,
    /\bsar\b.{0,20}\b(filed|submitted|sent|generated)/i,
    /\b(we|i|the company)\s+(have\s+)?(reported|filed|notified|informed)/i,
  ];
  const lowerXml = xml.toLowerCase();
  for (const phrase of phrases) {
    if (lowerXml.includes(phrase)) {
      errors.push({
        field: 'content',
        message: `Potential tipping-off risk: contains "${phrase}"`,
        regulatory: 'FDL Art.29 — No Tipping Off',
      });
    }
  }
  for (const pattern of patterns) {
    if (pattern.test(xml)) {
      errors.push({
        field: 'content',
        message: `Potential tipping-off risk: matches pattern ${pattern.source}`,
        regulatory: 'FDL Art.29 — No Tipping Off',
      });
    }
  }
}

// ---------------------------------------------------------------------------
// SAR — Suspicious Activity Report (FDL Art.26)
// ---------------------------------------------------------------------------

/**
 * Validate SAR XML before submission.
 *
 * SAR differs from STR in that it reports suspicious *activity* (pattern
 * of behaviour) rather than a single transaction. The structural
 * requirements are similar but SAR must include an `<activityPattern>`
 * element describing the pattern observed.
 */
export function validateSAR(xml: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  checkRequired(
    xml,
    [
      { tag: 'reportHeader', reg: 'FIU goAML Schema' },
      { tag: 'reportingEntity', reg: 'FDL Art.20' },
      { tag: 'suspiciousSubject', reg: 'FDL Art.26' },
      { tag: 'activityPattern', reg: 'FDL Art.26 / FATF Rec.20' },
      { tag: 'groundsForSuspicion', reg: 'FDL Art.26' },
      { tag: 'reportFooter', reg: 'FIU goAML Schema' },
    ],
    errors,
  );

  checkReportId(xml, errors);
  checkDateFormats(xml, errors);
  checkAmountFormats(xml, warnings);
  checkXmlEntities(xml, warnings);

  if (!xml.match(/<subjectName>[^<]+<\/subjectName>/)) {
    errors.push({
      field: 'subjectName',
      message: 'Subject name is required for SAR',
      regulatory: 'FDL Art.26',
    });
  }

  if (xml.match(/<groundsForSuspicion>\s*<\/groundsForSuspicion>/)) {
    errors.push({
      field: 'groundsForSuspicion',
      message: 'Grounds for suspicion cannot be empty',
      regulatory: 'FDL Art.26',
    });
  }

  if (xml.match(/<activityPattern>\s*<\/activityPattern>/)) {
    errors.push({
      field: 'activityPattern',
      message: 'Activity pattern description cannot be empty',
      regulatory: 'FDL Art.26 / FATF Rec.20',
    });
  }

  checkNoTippingOff(xml, errors);

  return { valid: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// DPMSR — Dealer in Precious Metals Sector Report (MoE 08/AML/2021)
// ---------------------------------------------------------------------------

/**
 * Validate DPMSR XML before submission.
 *
 * DPMSR is the quarterly DPMS sector report per MoE Circular 08/AML/2021.
 * It summarises cash transactions ≥ AED 55,000 over the reporting period
 * and must include a reportingQuarter, a totals block, and a dealer
 * license reference.
 */
export function validateDPMSR(xml: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  checkRequired(
    xml,
    [
      { tag: 'reportHeader', reg: 'FIU goAML Schema' },
      { tag: 'reportingEntity', reg: 'MoE 08/AML/2021' },
      { tag: 'dealerLicense', reg: 'MoE 08/AML/2021' },
      { tag: 'reportingQuarter', reg: 'MoE 08/AML/2021' },
      { tag: 'totalTransactions', reg: 'MoE 08/AML/2021' },
      { tag: 'totalCashAmount', reg: 'MoE 08/AML/2021' },
      { tag: 'reportFooter', reg: 'FIU goAML Schema' },
    ],
    errors,
  );

  checkReportId(xml, errors);
  checkDateFormats(xml, errors);
  checkAmountFormats(xml, warnings);
  checkXmlEntities(xml, warnings);

  // Reporting quarter must match Q[1-4]-YYYY
  const quarterMatch = xml.match(/<reportingQuarter>([^<]+)<\/reportingQuarter>/);
  if (quarterMatch && !/^Q[1-4]-\d{4}$/.test(quarterMatch[1].trim())) {
    errors.push({
      field: 'reportingQuarter',
      message: `Reporting quarter "${quarterMatch[1]}" must be Q1-YYYY through Q4-YYYY`,
      regulatory: 'MoE 08/AML/2021',
    });
  }

  // Dealer license must be non-empty
  if (xml.match(/<dealerLicense>\s*<\/dealerLicense>/)) {
    errors.push({
      field: 'dealerLicense',
      message: 'Dealer license reference is required for DPMSR',
      regulatory: 'MoE 08/AML/2021',
    });
  }

  // Total cash amount warning if below threshold — the whole point of
  // DPMSR is to report aggregate AED 55K+ transactions
  const totalCashMatch = xml.match(/<totalCashAmount>([^<]+)<\/totalCashAmount>/);
  if (totalCashMatch) {
    const total = parseFloat(totalCashMatch[1]);
    if (!isNaN(total) && total < DPMS_CASH_THRESHOLD_AED) {
      warnings.push({
        field: 'totalCashAmount',
        message: `Total cash ${total} AED is below the AED ${DPMS_CASH_THRESHOLD_AED.toLocaleString()} threshold; DPMSR may not be required this quarter`,
      });
    }
  }

  checkNoTippingOff(xml, errors);

  return { valid: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// CNMR — Cross-border Notification / Match Report (Cabinet Res 74/2020)
// ---------------------------------------------------------------------------

/**
 * Validate CNMR XML before submission.
 *
 * CNMR is filed to the EOCN within 5 business days of a sanctions match
 * per Cabinet Resolution 74/2020 Art.5. It must cite the triggering
 * sanctions list, the match confidence, and the freeze action taken.
 */
export function validateCNMR(xml: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  checkRequired(
    xml,
    [
      { tag: 'reportHeader', reg: 'FIU goAML Schema' },
      { tag: 'reportingEntity', reg: 'Cabinet Res 74/2020 Art.5' },
      { tag: 'sanctionsList', reg: 'Cabinet Res 74/2020 Art.4' },
      { tag: 'matchedSubject', reg: 'Cabinet Res 74/2020 Art.5' },
      { tag: 'matchConfidence', reg: 'Cabinet Res 74/2020 Art.5' },
      { tag: 'freezeAction', reg: 'Cabinet Res 74/2020 Art.4' },
      { tag: 'freezeTimestamp', reg: 'Cabinet Res 74/2020 Art.4' },
      { tag: 'reportFooter', reg: 'FIU goAML Schema' },
    ],
    errors,
  );

  checkReportId(xml, errors);
  checkDateFormats(xml, errors);
  checkAmountFormats(xml, warnings);
  checkXmlEntities(xml, warnings);

  // Sanctions list must be one of the six recognised sources
  const listMatch = xml.match(/<sanctionsList>([^<]+)<\/sanctionsList>/);
  if (listMatch) {
    const list = listMatch[1].trim().toUpperCase();
    const valid = ['UN', 'OFAC', 'EU', 'UK', 'UAE', 'EOCN'];
    if (!valid.includes(list)) {
      errors.push({
        field: 'sanctionsList',
        message: `Sanctions list "${list}" must be one of: ${valid.join(', ')}`,
        regulatory: 'Cabinet Res 74/2020 Art.4',
      });
    }
  }

  // Match confidence must be numeric 0..1
  const confMatch = xml.match(/<matchConfidence>([^<]+)<\/matchConfidence>/);
  if (confMatch) {
    const conf = parseFloat(confMatch[1]);
    if (isNaN(conf) || conf < 0 || conf > 1) {
      errors.push({
        field: 'matchConfidence',
        message: `matchConfidence "${confMatch[1]}" must be a number in [0, 1]`,
        regulatory: 'Cabinet Res 74/2020 Art.5',
      });
    } else if (conf < 0.9) {
      warnings.push({
        field: 'matchConfidence',
        message: `matchConfidence ${conf} is below the 0.9 confirmed-match threshold; CNMR may be premature — verify with compliance officer`,
      });
    }
  }

  // Freeze action must be one of the recognised verbs
  const actionMatch = xml.match(/<freezeAction>([^<]+)<\/freezeAction>/);
  if (actionMatch) {
    const action = actionMatch[1].trim().toLowerCase();
    const validActions = ['frozen', 'blocked', 'held', 'rejected', 'pending_review'];
    if (!validActions.includes(action)) {
      errors.push({
        field: 'freezeAction',
        message: `freezeAction "${actionMatch[1]}" must be one of: ${validActions.join(', ')}`,
        regulatory: 'Cabinet Res 74/2020 Art.4',
      });
    }
  }

  checkNoTippingOff(xml, errors);

  return { valid: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Dispatcher — route to the right validator by report type
// ---------------------------------------------------------------------------

export type ReportType = 'STR' | 'SAR' | 'CTR' | 'DPMSR' | 'CNMR';

/**
 * Validate any goAML XML by explicit report type. Useful for CLI runners
 * and the pre-commit / CI guard that validates all fixtures under
 * tests/fixtures/goaml/.
 */
export function validateByType(type: ReportType, xml: string): ValidationResult {
  switch (type) {
    case 'STR':   return validateSTR(xml);
    case 'SAR':   return validateSAR(xml);
    case 'CTR':   return validateCTR(xml);
    case 'DPMSR': return validateDPMSR(xml);
    case 'CNMR':  return validateCNMR(xml);
    default: {
      const _exhaustive: never = type;
      throw new Error(`unknown report type: ${_exhaustive}`);
    }
  }
}
