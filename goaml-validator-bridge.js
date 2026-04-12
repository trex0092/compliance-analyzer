/**
 * goAML Validator Bridge — Browser-safe mirror of src/utils/goamlValidator.ts
 *
 * PURPOSE
 * -------
 * The legacy `goaml-export.js` module runs in the browser as a vanilla IIFE
 * and cannot import TypeScript modules. This bridge exposes the critical
 * pre-submission invariants of `src/utils/goamlValidator.ts` on
 * `window.GoAMLValidator` so that any XML produced by the legacy exporter
 * can be validated before it touches disk.
 *
 * DO NOT use this file as the canonical validator — src/utils/goamlValidator.ts
 * is authoritative and is tested by tests/goamlValidator.test.ts (if present)
 * plus tests/goamlBridgeMirror.test.ts which enforces that the critical
 * invariant lists below stay in sync with the TypeScript source.
 *
 * WHAT THIS VALIDATES (defense-in-depth minimum set)
 * ---------------------------------------------------
 * 1. Required XML elements per report type (STR/SAR/CTR/DPMSR/CNMR)
 * 2. Date format = YYYY-MM-DD (FIU goAML schema)
 * 3. Subject name present (FDL Art.26)
 * 4. FDL Art.29 tipping-off phrase + pattern check
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.26-27 (STR filing obligation)
 *   - FDL No.10/2025 Art.29 (no tipping off)
 *   - UAE FIU goAML Schema (structural requirements)
 *
 * MAINTENANCE
 * -----------
 * When src/utils/goamlValidator.ts changes any of the four invariant
 * categories above, update this file AND run `npx vitest run
 * tests/goamlBridgeMirror.test.ts` to prove the mirrors match.
 */
(function (global) {
  'use strict';

  // ─── Invariant 1: Required elements per report type ────────────────────────
  var REQUIRED_ELEMENTS = {
    STR: ['reportHeader', 'reportingEntity', 'suspiciousSubject', 'groundsForSuspicion', 'transactionDetails', 'reportFooter'],
    SAR: ['reportHeader', 'reportingEntity', 'suspiciousSubject', 'groundsForSuspicion', 'reportFooter'],
    CTR: ['reportHeader', 'reportingEntity', 'cashTransaction', 'cashAmount'],
    DPMSR: ['reportHeader', 'reportingEntity', 'transactionDetails'],
    CNMR: ['reportHeader', 'reportingEntity', 'suspiciousSubject'],
    FFR: ['reportHeader', 'reportingEntity', 'frozenAsset'],
  };

  // ─── Invariant 4: FDL Art.29 tipping-off phrases ────────────────────────────
  // MUST stay in sync with checkNoTippingOff() in src/utils/goamlValidator.ts
  var TIPPING_OFF_PHRASES = [
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

  var TIPPING_OFF_PATTERNS = [
    /\b(reported|filed|submitted)\s+(to|with)\s+(the\s+)?(fiu|authorities|regulator|goaml)/i,
    /\bstr\b.{0,20}\b(filed|submitted|sent|generated)/i,
    /\bsar\b.{0,20}\b(filed|submitted|sent|generated)/i,
    /\b(we|i|the company)\s+(have\s+)?(reported|filed|notified|informed)/i,
  ];

  function checkRequiredElements(xml, reportType, errors) {
    var required = REQUIRED_ELEMENTS[reportType];
    if (!required) {
      errors.push({
        field: 'reportType',
        message: 'Unknown reportType: ' + reportType + '. Accepted: ' + Object.keys(REQUIRED_ELEMENTS).join(', '),
        regulatory: 'FIU goAML Schema',
      });
      return;
    }
    for (var i = 0; i < required.length; i++) {
      var tag = required[i];
      if (xml.indexOf('<' + tag) === -1) {
        errors.push({
          field: tag,
          message: 'Missing required element: <' + tag + '>',
          regulatory: 'FIU goAML Schema',
        });
      }
    }
  }

  function checkDateFormats(xml, errors) {
    var dateMatches = xml.match(/<[^>]*[Dd]ate[^>]*>[^<]+<\//g) || [];
    for (var i = 0; i < dateMatches.length; i++) {
      var value = dateMatches[i].replace(/<[^>]+>/g, '').replace(/<\/$/, '');
      if (value && !/^\d{4}-\d{2}-\d{2}/.test(value)) {
        errors.push({
          field: 'date',
          message: 'Invalid date format: "' + value + '". Must be YYYY-MM-DD.',
          regulatory: 'FIU goAML Schema',
        });
      }
    }
  }

  function checkSubjectName(xml, reportType, errors) {
    // STR/SAR/CNMR require a subject; CTR and DPMSR use different element.
    if (reportType === 'STR' || reportType === 'SAR' || reportType === 'CNMR') {
      if (!xml.match(/<subjectName>[^<]+<\/subjectName>/) && !xml.match(/<entityName>[^<]+<\/entityName>/)) {
        errors.push({
          field: 'subjectName',
          message: 'Subject name is required',
          regulatory: 'FDL Art.26',
        });
      }
    }
  }

  function checkNoTippingOff(xml, errors) {
    var lowerXml = xml.toLowerCase();
    for (var i = 0; i < TIPPING_OFF_PHRASES.length; i++) {
      if (lowerXml.indexOf(TIPPING_OFF_PHRASES[i]) !== -1) {
        errors.push({
          field: 'content',
          message: 'Potential tipping-off risk: contains "' + TIPPING_OFF_PHRASES[i] + '"',
          regulatory: 'FDL Art.29 — No Tipping Off',
        });
      }
    }
    for (var j = 0; j < TIPPING_OFF_PATTERNS.length; j++) {
      if (TIPPING_OFF_PATTERNS[j].test(xml)) {
        errors.push({
          field: 'content',
          message: 'Potential tipping-off risk: matches pattern ' + TIPPING_OFF_PATTERNS[j].source,
          regulatory: 'FDL Art.29 — No Tipping Off',
        });
      }
    }
  }

  /**
   * Validate a goAML XML document before submission / download.
   *
   * @param {string} xml        Full XML string.
   * @param {string} reportType One of: STR, SAR, CTR, DPMSR, CNMR, FFR.
   * @returns {{valid: boolean, errors: Array<{field:string,message:string,regulatory:string}>}}
   */
  function validateReport(xml, reportType) {
    var errors = [];
    if (typeof xml !== 'string' || xml.length === 0) {
      errors.push({ field: 'xml', message: 'XML payload is empty', regulatory: 'FIU goAML Schema' });
      return { valid: false, errors: errors };
    }
    checkRequiredElements(xml, reportType, errors);
    checkDateFormats(xml, errors);
    checkSubjectName(xml, reportType, errors);
    checkNoTippingOff(xml, errors);
    return { valid: errors.length === 0, errors: errors };
  }

  global.GoAMLValidator = Object.freeze({
    validateReport: validateReport,
    // Exposed for the mirror-sync test and for any introspection tool:
    _TIPPING_OFF_PHRASES: TIPPING_OFF_PHRASES,
    _TIPPING_OFF_PATTERNS: TIPPING_OFF_PATTERNS.map(function (p) { return p.source; }),
    _REQUIRED_ELEMENTS: REQUIRED_ELEMENTS,
  });
})(typeof window !== 'undefined' ? window : globalThis);
