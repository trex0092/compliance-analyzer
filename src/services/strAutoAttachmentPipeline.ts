/**
 * STR Auto-Attachment Pipeline — attach the goAML XML to the
 * goaml-xml subtask automatically.
 *
 * When the STR 7-subtask lifecycle reaches stage 3 (goaml-xml),
 * the goAML schema-valid XML must be produced and attached to
 * the subtask so the MLRO can submit it directly from Asana
 * without leaving the compliance context. This module:
 *
 *   1. Accepts a ComplianceCase + STR lifecycle subtask gid
 *   2. Builds a minimal goAML-shaped XML body via a pure
 *      buildGoamlXmlStub() function (stub — a real implementation
 *      would call the full src/utils/goamlValidator.ts chain)
 *   3. Uploads the XML as an attachment via
 *      uploadAsanaAttachment
 *
 * Pure builder + thin uploader. Tests cover the builder shape and
 * the happy-path composition. The uploader is covered by the
 * existing asanaClient attachment test surface.
 *
 * Why a stub XML builder? The real goAML validator lives in a
 * bigger module that needs full customer + transaction + UBO
 * graphs — too much to pull into the SPA bundle just for the
 * attachment demo. The stub produces a schema-shaped XML body
 * with placeholder values that a human can edit in Asana before
 * submitting to the FIU. It carries the exact case metadata and
 * cites FDL Art.26-27 in a <retention> field so it's traceable.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (attachments are retained 10yr)
 *   - FDL No.10/2025 Art.26-27 (STR filing obligations)
 *   - FDL No.10/2025 Art.29 (no tipping off — XML uses case id
 *     as the subject reference, never the entity legal name)
 *   - MoE Circular 08/AML/2021 (goAML submission chain)
 */

import type { ComplianceCase } from '../domain/cases';
import { uploadAsanaAttachment, isAsanaConfigured } from './asanaClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoamlXmlStubOptions {
  /** Optional override for the reporting entity FIU id. */
  reportingEntityFiuId?: string;
  /** Optional override for the STR reference number. */
  strRef?: string;
  /** Optional override for the generation timestamp. */
  generatedAtIso?: string;
}

export interface AutoAttachResult {
  ok: boolean;
  attachmentGid?: string;
  error?: string;
  /** The XML content that was (or would have been) uploaded. */
  xml: string;
}

// ---------------------------------------------------------------------------
// Pure builder — unit tested
// ---------------------------------------------------------------------------

/**
 * Build a minimal goAML-shaped XML body from a ComplianceCase.
 * Stub — a real implementation would call the full goAML
 * validator. The stub emits a schema-shaped document with
 * placeholder values so the MLRO can open it in Asana and edit
 * before submission.
 *
 * Important: the `subject` element uses `case-{caseId}` and NEVER
 * the entity legal name. This preserves FDL Art.29 even if the
 * XML is accidentally exposed.
 */
export function buildGoamlXmlStub(
  caseObj: ComplianceCase,
  options: GoamlXmlStubOptions = {}
): string {
  const generatedAt = options.generatedAtIso ?? new Date().toISOString();
  const ref = options.strRef ?? `STR-${caseObj.id}`;
  const entityId = options.reportingEntityFiuId ?? 'REPORTING-ENTITY-ID';
  const redFlags = (caseObj.redFlags ?? []).map((rf) => escapeXml(rf));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<report xmlns="http://www.goaml.org/xsd/transaction">',
    `  <rentity_id>${entityId}</rentity_id>`,
    '  <submission_code>STR</submission_code>',
    `  <report_code>${escapeXml(ref)}</report_code>`,
    `  <submission_date>${generatedAt}</submission_date>`,
    '  <!-- FDL No.10/2025 Art.29 — no tipping off. Subject referenced by case id only. -->',
    '  <subject>',
    `    <subject_id>case-${escapeXml(caseObj.id)}</subject_id>`,
    `    <risk_level>${escapeXml(caseObj.riskLevel)}</risk_level>`,
    `    <risk_score>${Number.isFinite(caseObj.riskScore) ? caseObj.riskScore : 0}</risk_score>`,
    '  </subject>',
    '  <!-- Reason for suspicion — compiled from case narrative + red flags -->',
    '  <reason>',
    `    <narrative>${escapeXml(caseObj.narrative ?? 'see case notes')}</narrative>`,
    '    <red_flags>',
    ...redFlags.map((rf) => `      <flag>${rf}</flag>`),
    '    </red_flags>',
    '  </reason>',
    '  <retention years="10">FDL No.10/2025 Art.24</retention>',
    '  <regulatory_basis>FDL No.10/2025 Art.26-27; Cabinet Res 134/2025 Art.19; MoE Circular 08/AML/2021</regulatory_basis>',
    '</report>',
  ].join('\n');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------------------------------------------------------------------------
// Attacher — thin wrapper over uploadAsanaAttachment
// ---------------------------------------------------------------------------

/**
 * Attach a goAML XML stub to the given Asana subtask. Callers
 * should invoke this when the STR lifecycle stage advances to
 * `goaml-xml`.
 */
export async function autoAttachGoamlXmlToSubtask(
  caseObj: ComplianceCase,
  subtaskGid: string,
  options: GoamlXmlStubOptions = {}
): Promise<AutoAttachResult> {
  const xml = buildGoamlXmlStub(caseObj, options);

  if (!isAsanaConfigured()) {
    return {
      ok: false,
      error: 'Asana not configured — XML stub generated but not uploaded',
      xml,
    };
  }

  const fileName = `str-${caseObj.id}-${Date.now()}.xml`;
  const upload = await uploadAsanaAttachment(subtaskGid, fileName, 'application/xml', xml);

  return {
    ok: upload.ok,
    attachmentGid: upload.attachment?.gid,
    error: upload.error,
    xml,
  };
}
