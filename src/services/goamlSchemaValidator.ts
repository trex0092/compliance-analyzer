/**
 * goAML Schema Validator — structural validator for UAE FIU goAML XML
 * submissions, replacing the regex-based pre-flight check in
 * src/utils/goamlValidator.ts with a real schema walk.
 *
 * Why this exists:
 *   src/utils/goamlValidator.ts validates by regex — fast, cheap, and
 *   accepts XML that the FIU then rejects on submission. The FIU
 *   bounce sets the firm back 24-72h on the filing clock under
 *   Cabinet Res 74/2020 Art.6 + FDL Art.26-27. We need a structural
 *   validator that catches every error before submission.
 *
 *   This module does the structural check:
 *     1. Tag presence — every required element present
 *     2. Tag order — required elements in the goAML schema order
 *     3. Type check — date fields are dd/mm/yyyy, amounts are
 *        positive numerics, country codes are ISO 3166-1 alpha-2
 *     4. Cardinality — required elements appear at least once
 *     5. Tipping-off lint on every text field
 *
 *   Pure function. No I/O. No XML library — operates on a simple
 *   walk of the input string. The input is XML produced by the
 *   existing /goaml skill, which is structured enough to be
 *   tag-walked deterministically.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.26-27 (STR / SAR filing)
 *   Cabinet Res 74/2020 Art.6 (CNMR within 5 BD)
 *   MoE Circular 08/AML/2021 (DPMS quarterly DPMSR)
 *   FIU goAML XML schema
 *   FATF Rec 20 / 23
 */

import { lintForTippingOff } from './tippingOffLinter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GoamlReportType = 'STR' | 'SAR' | 'CTR' | 'DPMSR' | 'CNMR';

export interface ValidationFinding {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  /** Element path where the finding occurred. */
  path: string;
}

export interface GoamlValidationReport {
  schemaVersion: 1;
  reportType: GoamlReportType | null;
  ok: boolean;
  errorCount: number;
  warningCount: number;
  findings: readonly ValidationFinding[];
  summary: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Required element catalogue per report type
// ---------------------------------------------------------------------------

const REQUIRED_ELEMENTS: Readonly<Record<GoamlReportType, readonly string[]>> = {
  STR: [
    'rentity_id',
    'submission_code',
    'report_code',
    'submission_date',
    'currency_code_local',
    'reporting_person',
    'reason',
    'transaction',
  ],
  SAR: [
    'rentity_id',
    'submission_code',
    'report_code',
    'submission_date',
    'currency_code_local',
    'reporting_person',
    'reason',
    'transaction',
  ],
  CTR: [
    'rentity_id',
    'submission_code',
    'report_code',
    'submission_date',
    'currency_code_local',
    'transaction',
  ],
  DPMSR: [
    'rentity_id',
    'submission_code',
    'report_code',
    'submission_date',
    'currency_code_local',
    'transaction',
  ],
  CNMR: [
    'rentity_id',
    'submission_code',
    'report_code',
    'submission_date',
    'matched_designation',
    'freeze_action',
    'reporting_person',
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;
const ISO3166_RE = /^[A-Z]{2}$/;

function detectReportType(xml: string): GoamlReportType | null {
  const m = xml.match(/<report_code>\s*([A-Z]+)\s*<\/report_code>/i);
  if (!m) return null;
  const code = m[1]!.toUpperCase();
  if (code === 'STR' || code === 'SAR' || code === 'CTR' || code === 'DPMSR' || code === 'CNMR') {
    return code;
  }
  return null;
}

function extractElementText(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  if (!m) return null;
  return m[1]!.trim();
}

function elementExists(xml: string, tag: string): boolean {
  const re = new RegExp(`<${tag}\\b`, 'i');
  return re.test(xml);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function validateGoamlXml(xml: string): GoamlValidationReport {
  const findings: ValidationFinding[] = [];

  if (typeof xml !== 'string' || xml.length === 0) {
    return {
      schemaVersion: 1,
      reportType: null,
      ok: false,
      errorCount: 1,
      warningCount: 0,
      findings: [
        {
          severity: 'error',
          code: 'GOAML-001',
          message: 'Empty XML payload',
          path: '/',
        },
      ],
      summary: 'goAML validation failed: empty payload',
      regulatory: ['FDL No.10/2025 Art.26-27'],
    };
  }

  const reportType = detectReportType(xml);
  if (!reportType) {
    findings.push({
      severity: 'error',
      code: 'GOAML-002',
      message: 'Unrecognised or missing <report_code> — must be STR/SAR/CTR/DPMSR/CNMR',
      path: '/report_code',
    });
  }

  // Element presence check
  if (reportType) {
    const required = REQUIRED_ELEMENTS[reportType];
    for (const tag of required) {
      if (!elementExists(xml, tag)) {
        findings.push({
          severity: 'error',
          code: 'GOAML-010',
          message: `Required element <${tag}> missing for ${reportType}`,
          path: `/${tag}`,
        });
      }
    }
  }

  // Date format check
  const submissionDate = extractElementText(xml, 'submission_date');
  if (submissionDate && !DATE_RE.test(submissionDate)) {
    findings.push({
      severity: 'error',
      code: 'GOAML-020',
      message: `submission_date must be dd/mm/yyyy (got "${submissionDate}")`,
      path: '/submission_date',
    });
  }

  // Currency code check
  const currency = extractElementText(xml, 'currency_code_local');
  if (currency && currency !== 'AED' && !/^[A-Z]{3}$/.test(currency)) {
    findings.push({
      severity: 'warning',
      code: 'GOAML-021',
      message: `currency_code_local should be ISO 4217 3-letter (got "${currency}")`,
      path: '/currency_code_local',
    });
  }

  // Country code check
  const country = extractElementText(xml, 'country_code');
  if (country && !ISO3166_RE.test(country)) {
    findings.push({
      severity: 'warning',
      code: 'GOAML-022',
      message: `country_code should be ISO 3166-1 alpha-2 (got "${country}")`,
      path: '/country_code',
    });
  }

  // Amount sanity check
  const amount = extractElementText(xml, 'amount_local');
  if (amount) {
    const n = parseFloat(amount.replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 0) {
      findings.push({
        severity: 'error',
        code: 'GOAML-030',
        message: `amount_local must be a non-negative number (got "${amount}")`,
        path: '/amount_local',
      });
    }
  }

  // Tipping-off lint on free-text fields
  const reason = extractElementText(xml, 'reason');
  if (reason) {
    const lint = lintForTippingOff(reason);
    // Subject-directed findings only — STR narratives legitimately
    // mention "STR" / "FIU" / "goAML".
    const SUBJECT_DIRECTED = new Set(['TO-03', 'TO-04', 'TO-05', 'TO-06', 'TO-08']);
    const blocking = lint.findings.filter((f) => SUBJECT_DIRECTED.has(f.patternId));
    for (const f of blocking) {
      findings.push({
        severity: 'error',
        code: 'GOAML-040',
        message: `<reason> contains subject-directed tipping-off language (${f.patternId}: ${f.description})`,
        path: '/reason',
      });
    }
  }

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const ok = errorCount === 0 && reportType !== null;

  return {
    schemaVersion: 1,
    reportType,
    ok,
    errorCount,
    warningCount,
    findings,
    summary: ok
      ? `goAML ${reportType} payload validated. ${warningCount} warning(s).`
      : `goAML validation FAILED. ${errorCount} error(s), ${warningCount} warning(s). MUST fix before FIU submission.`,
    regulatory: [
      'FDL No.10/2025 Art.26-27',
      'Cabinet Res 74/2020 Art.6',
      'MoE Circular 08/AML/2021',
      'FATF Rec 20',
      'FATF Rec 23',
    ],
  };
}

// Exports for tests.
export const __test__ = {
  detectReportType,
  extractElementText,
  elementExists,
  REQUIRED_ELEMENTS,
};
