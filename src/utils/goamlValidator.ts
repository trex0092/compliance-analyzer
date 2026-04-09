/**
 * goAML XML Validator — Pre-submission validation
 *
 * Validates goAML XML against UAE FIU requirements before submission.
 * Checks required fields, date formats, amount formats, entity structure.
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
