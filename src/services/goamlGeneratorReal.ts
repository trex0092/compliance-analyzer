/**
 * Real goAML XML Generator — Tier A3.
 *
 * Upgrade path from the stub in strAutoAttachmentPipeline. This
 * module emits a goAML-shaped XML document driven by a structured
 * input (case + customer + transactions) rather than the
 * placeholder-only stub.
 *
 * The output validates against a minimal goAML schema (enforced
 * by validateGoamlPayload). It's NOT full goAML v5.x compliance —
 * that requires ~200 element types — but it passes the FIU's
 * "well-formed + required fields present" gate, which is what
 * the MLRO can actually hit today.
 *
 * Pure builder + validator. Tests cover every branch of the
 * field derivation + escape + validation paths.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.26-27 (STR filing obligations)
 *   - FDL No.10/2025 Art.29 (no tipping off — subject references
 *     use case id only)
 *   - MoE Circular 08/AML/2021 (goAML submission chain)
 */

import type { ComplianceCase } from '../domain/cases';
import type { CustomerProfile } from '../domain/customers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoamlTransaction {
  id: string;
  dateIso: string;
  amountAed: number;
  direction: 'incoming' | 'outgoing';
  counterparty?: string;
  narrative?: string;
}

export interface GoamlPayload {
  reportingEntityId: string;
  reportCode: 'STR' | 'SAR' | 'CTR' | 'DPMSR' | 'CNMR';
  case: ComplianceCase;
  customer?: CustomerProfile;
  transactions?: readonly GoamlTransaction[];
  generatedAtIso?: string;
  narrative?: string;
}

export interface GoamlValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export function validateGoamlPayload(payload: GoamlPayload): GoamlValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!payload.reportingEntityId || payload.reportingEntityId.trim().length === 0) {
    errors.push('reportingEntityId is required');
  }
  if (!payload.reportCode) {
    errors.push('reportCode is required');
  }
  if (!payload.case?.id) {
    errors.push('case.id is required');
  }
  if (!payload.case?.narrative) {
    warnings.push('case.narrative is empty — FIU will reject on review');
  }
  if (payload.reportCode === 'CTR') {
    const total = (payload.transactions ?? []).reduce((sum, tx) => sum + Math.abs(tx.amountAed), 0);
    if (total === 0) {
      errors.push('CTR requires at least one transaction with a non-zero amount');
    }
    if (total < 55_000) {
      warnings.push(
        `CTR total is AED ${total.toLocaleString()} — below the 55,000 DPMS threshold (MoE Circular 08/AML/2021)`
      );
    }
  }
  if (payload.reportCode === 'STR' || payload.reportCode === 'SAR') {
    if ((payload.case?.redFlags?.length ?? 0) === 0) {
      warnings.push('STR/SAR with no red flags — FIU will request additional context');
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Pure builder
// ---------------------------------------------------------------------------

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function deriveSubjectType(customer: CustomerProfile | undefined): 'legal_entity' | 'individual' {
  // DPMS customers are overwhelmingly legal entities (trade licenses).
  // Individuals would come through a retail channel, which isn't
  // the compliance-analyzer's primary flow.
  if (!customer) return 'legal_entity';
  return 'legal_entity';
}

function riskLevelToInt(level: ComplianceCase['riskLevel']): number {
  switch (level) {
    case 'critical':
      return 4;
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
  }
}

/**
 * Emit a goAML-shaped XML document from the payload. The output
 * is a deterministic string — same input produces byte-identical
 * output (aside from the generatedAtIso timestamp which the
 * caller can override).
 */
export function generateGoamlXml(payload: GoamlPayload): {
  ok: boolean;
  xml?: string;
  validation: GoamlValidationResult;
} {
  const validation = validateGoamlPayload(payload);
  if (!validation.ok) {
    return { ok: false, validation };
  }

  const generatedAt = payload.generatedAtIso ?? new Date().toISOString();
  const caseObj = payload.case;
  const narrativeBody = payload.narrative ?? caseObj.narrative ?? 'see case notes';
  const subjectType = deriveSubjectType(payload.customer);

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<report xmlns="http://www.goaml.org/xsd/transaction/v5">',
    `  <rentity_id>${escapeXml(payload.reportingEntityId)}</rentity_id>`,
    `  <submission_code>${payload.reportCode}</submission_code>`,
    `  <report_code>${escapeXml(`${payload.reportCode}-${caseObj.id}`)}</report_code>`,
    `  <submission_date>${generatedAt}</submission_date>`,
    '  <!-- FDL No.10/2025 Art.29 — no tipping off. Subject referenced by case id. -->',
    '  <subject>',
    `    <subject_id>case-${escapeXml(caseObj.id)}</subject_id>`,
    `    <subject_type>${subjectType}</subject_type>`,
    `    <risk_level>${escapeXml(caseObj.riskLevel)}</risk_level>`,
    `    <risk_level_int>${riskLevelToInt(caseObj.riskLevel)}</risk_level_int>`,
    `    <risk_score>${Number.isFinite(caseObj.riskScore) ? caseObj.riskScore : 0}</risk_score>`,
  ];

  if (payload.customer) {
    lines.push(
      `    <country_of_registration>${escapeXml(payload.customer.countryOfRegistration ?? 'UNKNOWN')}</country_of_registration>`,
      `    <customer_risk_rating>${escapeXml(payload.customer.riskRating)}</customer_risk_rating>`,
      `    <pep_status>${escapeXml(payload.customer.pepStatus)}</pep_status>`,
      `    <sanctions_status>${escapeXml(payload.customer.sanctionsStatus)}</sanctions_status>`
    );
  }

  lines.push(
    '  </subject>',
    '  <reason>',
    `    <narrative>${escapeXml(narrativeBody)}</narrative>`
  );

  const redFlags = caseObj.redFlags ?? [];
  if (redFlags.length > 0) {
    lines.push('    <red_flags>');
    for (const rf of redFlags) {
      lines.push(`      <flag>${escapeXml(rf)}</flag>`);
    }
    lines.push('    </red_flags>');
  }

  const findings = caseObj.findings ?? [];
  if (findings.length > 0) {
    lines.push('    <findings>');
    for (const f of findings) {
      lines.push(`      <finding>${escapeXml(f)}</finding>`);
    }
    lines.push('    </findings>');
  }

  lines.push('  </reason>');

  const txs = payload.transactions ?? [];
  if (txs.length > 0) {
    lines.push('  <transactions>');
    for (const tx of txs) {
      lines.push(
        '    <transaction>',
        `      <transaction_id>${escapeXml(tx.id)}</transaction_id>`,
        `      <date>${escapeXml(tx.dateIso)}</date>`,
        `      <amount_aed>${tx.amountAed.toFixed(2)}</amount_aed>`,
        `      <direction>${tx.direction}</direction>`,
        tx.counterparty
          ? `      <counterparty>${escapeXml(tx.counterparty)}</counterparty>`
          : '      <counterparty>redacted</counterparty>',
        tx.narrative ? `      <narrative>${escapeXml(tx.narrative)}</narrative>` : '',
        '    </transaction>'
      );
    }
    lines.push('  </transactions>');
  }

  lines.push(
    '  <retention years="10">FDL No.10/2025 Art.24</retention>',
    '  <regulatory_basis>FDL No.10/2025 Art.26-27; Cabinet Res 134/2025 Art.19; MoE Circular 08/AML/2021</regulatory_basis>',
    '</report>'
  );

  return {
    ok: true,
    xml: lines.filter((l) => l !== '').join('\n'),
    validation,
  };
}
