/**
 * goAML XML Validator — Pre-submission validation
 *
 * Validates goAML XML against UAE FIU requirements before submission.
 * Checks required fields, date formats, amount formats, entity structure.
 */

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

  // Report ID format
  if (!xml.match(/RPT-\d+-[a-zA-Z0-9]+/)) {
    errors.push({
      field: 'reportId',
      message: 'Report ID must follow RPT-[timestamp]-[random] format',
      regulatory: 'FIU goAML Schema',
    });
  }

  // Date format validation (YYYY-MM-DD)
  const dateMatches = xml.match(/<[^>]*[Dd]ate[^>]*>([^<]+)<\//g) || [];
  for (const match of dateMatches) {
    const value = match.replace(/<[^>]*>/g, '').replace(/<\/.*/, '');
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

  // Check for unescaped special characters
  const textContent = xml.replace(/<[^>]*>/g, '');
  if (textContent.includes('&') && !textContent.includes('&amp;')) {
    warnings.push({
      field: 'content',
      message: "Possible unescaped '&' character found. Use &amp; in XML.",
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

  // Tipping-off check — STR should not contain subject notification language
  const tippingOffPhrases = [
    'we have reported',
    'filed a report',
    'notified authorities',
    'suspicious transaction report',
    'str has been filed',
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
    if (!isNaN(amount) && amount < 55000) {
      warnings.push({
        field: 'cashAmount',
        message: `Amount ${amount} AED is below the AED 55,000 threshold. CTR may not be required.`,
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
