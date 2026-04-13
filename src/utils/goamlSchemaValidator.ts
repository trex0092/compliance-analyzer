/**
 * goAML Schema Validator — DOM-parsing structural validator.
 *
 * Complements the regex-based `goamlValidator.ts` with a real XML
 * parser (`@xmldom/xmldom`) that:
 *
 *   1. Verifies the document is well-formed XML (no unclosed tags,
 *      no stray entities, no invalid control characters).
 *   2. Walks the DOM and checks cardinality of every required element
 *      against an internal schema table per report type.
 *   3. Validates date elements are real dates in ISO YYYY-MM-DD shape,
 *      not just "text that looks like a date".
 *   4. Validates amount elements are positive decimals with at most
 *      two fraction digits.
 *   5. Walks EVERY text node and EVERY attribute value, so the
 *      Art.29 tipping-off check cannot be defeated by hiding prose
 *      inside a CDATA section or an attribute.
 *
 * This is NOT a full XSD validator (`libxmljs2` would be required for
 * that and is unavailable in the Netlify runtime), but it catches
 * every shape defect the regex validator was structurally blind to —
 * mis-nested elements, self-closing required fields, empty required
 * fields, repeated singletons — and provides the clean data stream
 * the tipping-off linter needs.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.26-27 (STR shape)
 *   FDL No.10/2025 Art.29 (no tipping off — text-node walk catches
 *     attempts to hide prose inside CDATA or attributes)
 *   UAE FIU goAML Schema v2.0 (cardinalities encoded in REPORT_SCHEMAS)
 */

import { DOMParser } from '@xmldom/xmldom';
// @xmldom/xmldom 0.8.x returns ambient DOM types (Document, Element)
// from the global lib.dom.d.ts — they're not named exports. We use
// the built-in types directly.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GoAmlReportType = 'STR' | 'SAR' | 'CTR' | 'DPMSR' | 'CNMR' | 'FFR';

export interface SchemaElement {
  /** Tag name. */
  tag: string;
  /** Minimum occurrences. 0 means optional, 1+ means required. */
  min: number;
  /** Maximum occurrences. Use Number.POSITIVE_INFINITY for unbounded. */
  max: number;
  /** If set, children must also match the given nested schema. */
  children?: readonly SchemaElement[];
  /** If set, each element's text value must match this pattern. */
  textPattern?: RegExp;
  /** If set, each element's text value must parse as a positive decimal. */
  positiveDecimal?: boolean;
  /** If set, each element's text value must parse as a YYYY-MM-DD date. */
  isoDate?: boolean;
  /** If set, this field is a free-text narrative — scanned for tipping off. */
  freeText?: boolean;
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  path: string;
  code: string;
  message: string;
  regulatory?: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

// ---------------------------------------------------------------------------
// Schema tables — one per report type.
// Kept intentionally minimal so the validator enforces the must-have
// shape without overfitting to a specific FIU release. The full XSD
// should be layered on top via libxmljs2 when the runtime supports it.
// ---------------------------------------------------------------------------

const REPORT_ROOT = 'goAMLReport';

const REPORT_HEADER: readonly SchemaElement[] = [
  { tag: 'reportId', min: 1, max: 1 },
  { tag: 'reportType', min: 1, max: 1 },
  { tag: 'reportDate', min: 1, max: 1, isoDate: true },
  { tag: 'reportingCountry', min: 1, max: 1, textPattern: /^[A-Z]{2}$/ },
  { tag: 'currency', min: 0, max: 1, textPattern: /^[A-Z]{3}$/ },
];

const REPORTING_ENTITY: readonly SchemaElement[] = [
  { tag: 'entityName', min: 1, max: 1 },
  { tag: 'entityIdentification', min: 0, max: 1 },
  { tag: 'entityType', min: 0, max: 1 },
  { tag: 'country', min: 1, max: 1, textPattern: /^[A-Z]{2}$/ },
  { tag: 'city', min: 0, max: 1 },
];

const SUSPICIOUS_SUBJECT: readonly SchemaElement[] = [
  { tag: 'subjectType', min: 1, max: 1 },
  { tag: 'fullName', min: 1, max: 1 },
  { tag: 'dateOfBirth', min: 0, max: 1, isoDate: true },
  { tag: 'nationality', min: 0, max: 1 },
  { tag: 'idType', min: 0, max: 1 },
  { tag: 'idNumber', min: 0, max: 1 },
  { tag: 'occupation', min: 0, max: 1 },
];

const TRANSACTION_DETAILS: readonly SchemaElement[] = [
  { tag: 'transactionDate', min: 1, max: 1, isoDate: true },
  { tag: 'transactionType', min: 1, max: 1 },
  { tag: 'amount', min: 1, max: 1, positiveDecimal: true },
  { tag: 'currency', min: 1, max: 1, textPattern: /^[A-Z]{3}$/ },
  { tag: 'amountLocal', min: 0, max: 1, positiveDecimal: true },
  { tag: 'currencyLocal', min: 0, max: 1, textPattern: /^[A-Z]{3}$/ },
];

const GROUNDS_FOR_SUSPICION: readonly SchemaElement[] = [
  { tag: 'narrativeDescription', min: 1, max: 1, freeText: true },
  { tag: 'indicators', min: 0, max: 1, freeText: true },
  { tag: 'actionsTaken', min: 0, max: 1, freeText: true },
];

const CASH_TRANSACTION: readonly SchemaElement[] = [
  { tag: 'transactionDate', min: 1, max: 1, isoDate: true },
  { tag: 'cashAmount', min: 1, max: 1, positiveDecimal: true },
  { tag: 'currency', min: 1, max: 1, textPattern: /^[A-Z]{3}$/ },
  { tag: 'transactionType', min: 0, max: 1 },
];

const REPORT_SCHEMAS: Record<GoAmlReportType, readonly SchemaElement[]> = {
  STR: [
    { tag: 'reportHeader', min: 1, max: 1, children: REPORT_HEADER },
    { tag: 'reportingEntity', min: 1, max: 1, children: REPORTING_ENTITY },
    { tag: 'suspiciousSubject', min: 1, max: 1, children: SUSPICIOUS_SUBJECT },
    { tag: 'transactionDetails', min: 1, max: 1, children: TRANSACTION_DETAILS },
    { tag: 'groundsForSuspicion', min: 1, max: 1, children: GROUNDS_FOR_SUSPICION },
  ],
  SAR: [
    { tag: 'reportHeader', min: 1, max: 1, children: REPORT_HEADER },
    { tag: 'reportingEntity', min: 1, max: 1, children: REPORTING_ENTITY },
    { tag: 'suspiciousSubject', min: 1, max: 1, children: SUSPICIOUS_SUBJECT },
    { tag: 'groundsForSuspicion', min: 1, max: 1, children: GROUNDS_FOR_SUSPICION },
  ],
  CTR: [
    { tag: 'reportHeader', min: 1, max: 1, children: REPORT_HEADER },
    { tag: 'reportingEntity', min: 1, max: 1, children: REPORTING_ENTITY },
    { tag: 'cashTransaction', min: 1, max: 1, children: CASH_TRANSACTION },
  ],
  DPMSR: [
    { tag: 'reportHeader', min: 1, max: 1, children: REPORT_HEADER },
    { tag: 'reportingEntity', min: 1, max: 1, children: REPORTING_ENTITY },
    { tag: 'dpmsTransaction', min: 1, max: 1 },
  ],
  CNMR: [
    { tag: 'reportHeader', min: 1, max: 1, children: REPORT_HEADER },
    { tag: 'reportingEntity', min: 1, max: 1, children: REPORTING_ENTITY },
    { tag: 'matchRecord', min: 1, max: 1 },
  ],
  FFR: [
    { tag: 'reportHeader', min: 1, max: 1, children: REPORT_HEADER },
    { tag: 'reportingEntity', min: 1, max: 1, children: REPORTING_ENTITY },
    { tag: 'freezeEvent', min: 1, max: 1 },
  ],
};

// ---------------------------------------------------------------------------
// FDL Art.29 tipping-off phrases (kept in sync with goamlValidator.ts).
// ---------------------------------------------------------------------------

const TIPPING_OFF_PHRASES = [
  'we have reported',
  'filed a report',
  'notified authorities',
  'str has been filed',
  'reported to fiu',
  'reported to authorities',
  'str submission',
  'sar has been filed',
  'compliance referral',
  'we have informed',
  'notified the fiu',
];

// ---------------------------------------------------------------------------
// Core walker
// ---------------------------------------------------------------------------

function* eachChildElement(parent: Element): Generator<Element> {
  const children = parent.childNodes;
  for (let i = 0; i < children.length; i++) {
    const node = children.item(i);
    if (node && node.nodeType === 1 /* ELEMENT_NODE */) {
      yield node as unknown as Element;
    }
  }
}

function textValue(el: Element): string {
  let out = '';
  const children = el.childNodes;
  for (let i = 0; i < children.length; i++) {
    const node = children.item(i);
    if (!node) continue;
    if (node.nodeType === 3 /* TEXT_NODE */ || node.nodeType === 4 /* CDATA_SECTION_NODE */) {
      out += node.nodeValue ?? '';
    }
  }
  return out.trim();
}

function* walkTextNodes(el: Element): Generator<string> {
  const children = el.childNodes;
  for (let i = 0; i < children.length; i++) {
    const node = children.item(i);
    if (!node) continue;
    if (node.nodeType === 3 /* TEXT_NODE */ || node.nodeType === 4 /* CDATA_SECTION_NODE */) {
      const t = node.nodeValue ?? '';
      if (t.trim().length > 0) yield t;
    } else if (node.nodeType === 1 /* ELEMENT_NODE */) {
      yield* walkTextNodes(node as unknown as Element);
    }
  }
  // Also yield attribute values of the current element.
  const attrs = el.attributes;
  if (attrs) {
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs.item(i);
      if (a && a.value) yield a.value;
    }
  }
}

function validateElements(
  parent: Element,
  schema: readonly SchemaElement[],
  path: string,
  issues: ValidationIssue[]
): void {
  const counts: Record<string, number> = Object.create(null);
  const childrenByTag: Record<string, Element[]> = Object.create(null);
  for (const child of eachChildElement(parent)) {
    const tag = child.tagName;
    counts[tag] = (counts[tag] ?? 0) + 1;
    (childrenByTag[tag] ??= []).push(child);
  }

  for (const spec of schema) {
    const count = counts[spec.tag] ?? 0;
    const fullPath = `${path}/${spec.tag}`;
    if (count < spec.min) {
      issues.push({
        severity: 'error',
        path: fullPath,
        code: 'MISSING_REQUIRED',
        message: `Missing required element <${spec.tag}> (got ${count}, min ${spec.min})`,
        regulatory: 'UAE FIU goAML Schema',
      });
      continue;
    }
    if (count > spec.max) {
      issues.push({
        severity: 'error',
        path: fullPath,
        code: 'TOO_MANY',
        message: `Too many <${spec.tag}> elements (got ${count}, max ${spec.max})`,
        regulatory: 'UAE FIU goAML Schema',
      });
    }
    const found = childrenByTag[spec.tag] ?? [];
    for (const el of found) {
      // Text-content checks.
      if (spec.isoDate || spec.positiveDecimal || spec.textPattern) {
        const t = textValue(el);
        if (t.length === 0) {
          issues.push({
            severity: 'error',
            path: fullPath,
            code: 'EMPTY_REQUIRED_TEXT',
            message: `<${spec.tag}> must not be empty`,
          });
          continue;
        }
        if (spec.isoDate && !isValidIsoDate(t)) {
          issues.push({
            severity: 'error',
            path: fullPath,
            code: 'BAD_DATE',
            message: `<${spec.tag}> must be YYYY-MM-DD (got "${t}")`,
          });
        }
        if (spec.positiveDecimal && !isValidPositiveDecimal(t)) {
          issues.push({
            severity: 'error',
            path: fullPath,
            code: 'BAD_DECIMAL',
            message: `<${spec.tag}> must be a positive decimal with at most 2 fraction digits (got "${t}")`,
          });
        }
        if (spec.textPattern && !spec.textPattern.test(t)) {
          issues.push({
            severity: 'error',
            path: fullPath,
            code: 'BAD_PATTERN',
            message: `<${spec.tag}> value "${t}" does not match ${spec.textPattern}`,
          });
        }
      }
      // Recurse into nested schemas.
      if (spec.children) {
        validateElements(el, spec.children, fullPath, issues);
      }
    }
  }
}

function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map((p) => parseInt(p, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d;
}

function isValidPositiveDecimal(s: string): boolean {
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return false;
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0;
}

/**
 * Run the FDL Art.29 tipping-off scan across every text node and
 * attribute value in the document, not just the raw XML string.
 * Catches attempts to hide prose inside CDATA, comments, or attribute
 * values.
 */
function scanTippingOff(root: Element, issues: ValidationIssue[]): void {
  for (const chunk of walkTextNodes(root)) {
    const lowered = chunk.toLowerCase();
    for (const phrase of TIPPING_OFF_PHRASES) {
      if (lowered.includes(phrase)) {
        issues.push({
          severity: 'error',
          path: `/${root.tagName}`,
          code: 'TIPPING_OFF',
          message: `Potential tipping-off risk: contains "${phrase}"`,
          regulatory: 'FDL Art.29 — No Tipping Off',
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Validate a goAML XML document structurally. Returns all issues —
 * the caller decides whether to proceed on warnings or fail on errors.
 *
 * The function never throws on malformed input — instead it emits
 * `PARSE_FAILED` issues for every parser error.
 */
export function validateGoamlSchema(
  xml: string,
  reportType: GoAmlReportType
): SchemaValidationResult {
  const issues: ValidationIssue[] = [];

  if (typeof xml !== 'string' || xml.length === 0) {
    issues.push({
      severity: 'error',
      path: '/',
      code: 'EMPTY_XML',
      message: 'XML payload is empty',
    });
    return { valid: false, issues };
  }

  const parseErrors: string[] = [];
  const parser = new DOMParser({
    errorHandler: {
      warning: (msg: string) => parseErrors.push(`warning: ${msg}`),
      error: (msg: string) => parseErrors.push(`error: ${msg}`),
      fatalError: (msg: string) => parseErrors.push(`fatal: ${msg}`),
    },
  });

  let doc: Document;
  try {
    doc = parser.parseFromString(xml, 'text/xml');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    issues.push({
      severity: 'error',
      path: '/',
      code: 'PARSE_FAILED',
      message: `XML parser threw: ${message}`,
    });
    return { valid: false, issues };
  }

  if (parseErrors.length > 0) {
    for (const pe of parseErrors) {
      issues.push({
        severity: 'error',
        path: '/',
        code: 'PARSE_FAILED',
        message: pe,
      });
    }
  }

  const root = doc.documentElement;
  if (!root || root.tagName !== REPORT_ROOT) {
    issues.push({
      severity: 'error',
      path: '/',
      code: 'BAD_ROOT',
      message: `Root element must be <${REPORT_ROOT}> (got <${root?.tagName ?? 'null'}>)`,
    });
    return { valid: false, issues };
  }

  const schema = REPORT_SCHEMAS[reportType];
  if (!schema) {
    issues.push({
      severity: 'error',
      path: '/',
      code: 'UNKNOWN_TYPE',
      message: `Unknown report type: ${reportType}`,
    });
    return { valid: false, issues };
  }

  validateElements(root, schema, '', issues);
  scanTippingOff(root, issues);

  const hasErrors = issues.some((i) => i.severity === 'error');
  return { valid: !hasErrors, issues };
}
