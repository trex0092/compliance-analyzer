/**
 * Filing & Reporting MCP Tools
 *
 * Exposes goAML XML generation, validation, and KPI reporting
 * as callable MCP tools.
 *
 * Regulatory basis: FDL No.10/2025 Art.26-27, MoE Circular 08/AML/2021
 */

import type { ToolResult } from '../mcp-server';
import type { SuspicionReport } from '../../domain/reports';
import type { ComplianceCase } from '../../domain/cases';
import type { CustomerProfile } from '../../domain/customers';
import type { KPIMeasurement, KPIReport } from '../../domain/kpiFramework';

import { buildGoAMLXml } from '../../services/goamlBuilder';
import { validateSTR, validateCTR, type ValidationResult } from '../../utils/goamlValidator';
import { generateKPIReport, DPMS_KPI_DEFINITIONS } from '../../domain/kpiFramework';
import { appendToChain, type ChainedAuditEvent } from '../../utils/auditChain';
import { checkDeadline } from '../../utils/businessDays';

// ---------------------------------------------------------------------------
// Tool: generate_goaml_xml
// ---------------------------------------------------------------------------

export interface GenerateGoAMLInput {
  report: SuspicionReport;
  linkedCase?: ComplianceCase;
  linkedCustomer?: CustomerProfile;
}

export async function generateGoAMLXml(
  input: GenerateGoAMLInput,
  auditChain: ChainedAuditEvent[],
  analyst: string,
): Promise<ToolResult<{ xml: string; filename: string; validation: ValidationResult }>> {
  const xml = buildGoAMLXml(input.report, input.linkedCase, input.linkedCustomer);

  // Auto-validate before returning (CLAUDE.md § goAML exports)
  const reportType = input.report.reportType ?? 'STR';
  const validation = reportType === 'CTR' ? validateCTR(xml) : validateSTR(xml);

  const filename = `goAML_${reportType}_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xml`;

  await appendToChain(auditChain, {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    by: analyst,
    action: reportType === 'STR' ? 'str-filed' : reportType === 'CTR' ? 'ctr-filed' : 'sar-filed',
    note: `Generated ${reportType} XML — valid: ${validation.valid}, errors: ${validation.errors.length}, warnings: ${validation.warnings.length}`,
  });

  return {
    ok: true,
    data: { xml, filename, validation },
  };
}

// ---------------------------------------------------------------------------
// Tool: validate_goaml_xml
// ---------------------------------------------------------------------------

export function validateGoAMLXml(
  input: { xml: string; reportType: 'STR' | 'CTR' },
): ToolResult<ValidationResult> {
  const validation = input.reportType === 'CTR'
    ? validateCTR(input.xml)
    : validateSTR(input.xml);

  return { ok: true, data: validation };
}

// ---------------------------------------------------------------------------
// Tool: check_filing_deadline
// ---------------------------------------------------------------------------

export interface CheckDeadlineInput {
  eventDate: string;
  filingType: 'STR' | 'CTR' | 'CNMR' | 'DPMSR';
}

export function checkFilingDeadline(
  input: CheckDeadlineInput,
): ToolResult<{ dueDate: string; isOverdue: boolean; businessDaysRemaining: number; filingType: string }> {
  const deadlineMap: Record<string, number> = {
    STR: 0,   // without delay — FDL Art.26
    CTR: 15,  // 15 business days
    CNMR: 5,  // 5 business days — Cabinet Res 74/2020 Art.6
    DPMSR: 15, // 15 business days
  };

  const days = deadlineMap[input.filingType];
  if (days === undefined) {
    return { ok: false, error: `Unknown filing type: ${input.filingType}` };
  }

  const deadline = checkDeadline(new Date(input.eventDate), days);
  const now = new Date();
  const dueDate = deadline.toISOString().slice(0, 10);
  const isOverdue = now > deadline;

  // Calculate remaining business days (approximate)
  let remaining = 0;
  if (!isOverdue) {
    const current = new Date(now);
    while (current < deadline) {
      current.setDate(current.getDate() + 1);
      const day = current.getDay();
      if (day !== 0 && day !== 6) remaining++;
    }
  }

  return {
    ok: true,
    data: {
      dueDate,
      isOverdue,
      businessDaysRemaining: isOverdue ? -1 : remaining,
      filingType: input.filingType,
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: generate_kpi_report
// ---------------------------------------------------------------------------

export interface GenerateKPIInput {
  measurements: KPIMeasurement[];
  entity: string;
  period: string;
  generatedBy: string;
}

export async function generateKPIReportTool(
  input: GenerateKPIInput,
  auditChain: ChainedAuditEvent[],
  analyst: string,
): Promise<ToolResult<KPIReport>> {
  const report = generateKPIReport(
    input.measurements,
    input.entity,
    input.period,
    input.generatedBy,
  );

  await appendToChain(auditChain, {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    by: analyst,
    action: 'created',
    note: `KPI report generated for ${input.entity} (${input.period}) — overall: ${report.overallRAG}, score: ${report.overallScore}`,
  });

  return { ok: true, data: report };
}

// ---------------------------------------------------------------------------
// Tool: list_kpi_definitions
// ---------------------------------------------------------------------------

export function listKPIDefinitions(
  category?: string,
): ToolResult<{ definitions: Array<{ id: string; name: string; category: string; frequency: string; targetValue: number; targetUnit: string }> }> {
  let defs = DPMS_KPI_DEFINITIONS;
  if (category) {
    defs = defs.filter((d) => d.category === category);
  }

  return {
    ok: true,
    data: {
      definitions: defs.map((d) => ({
        id: d.id,
        name: d.name,
        category: d.category,
        frequency: d.frequency,
        targetValue: d.targetValue,
        targetUnit: d.targetUnit,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Schema exports for MCP registration
// ---------------------------------------------------------------------------

export const FILING_TOOL_SCHEMAS = [
  {
    name: 'generate_goaml_xml',
    description:
      'Generate goAML XML filing (STR/SAR/CTR/DPMSR). Auto-validates against UAE FIU schema before returning. Regulatory: FDL Art.26-27.',
    inputSchema: {
      type: 'object',
      properties: {
        report: { type: 'object', description: 'SuspicionReport object' },
        linkedCase: { type: 'object', description: 'Optional linked ComplianceCase' },
        linkedCustomer: { type: 'object', description: 'Optional linked CustomerProfile' },
      },
      required: ['report'],
    },
  },
  {
    name: 'validate_goaml_xml',
    description:
      'Validate goAML XML against UAE FIU schema requirements. Checks required fields, date format (dd/mm/yyyy), reporting structure.',
    inputSchema: {
      type: 'object',
      properties: {
        xml: { type: 'string', description: 'Raw XML string to validate' },
        reportType: { type: 'string', enum: ['STR', 'CTR'] },
      },
      required: ['xml', 'reportType'],
    },
  },
  {
    name: 'check_filing_deadline',
    description:
      'Calculate filing deadline in business days. STR=immediate, CTR/DPMSR=15 days, CNMR=5 days. Uses UAE business day calendar.',
    inputSchema: {
      type: 'object',
      properties: {
        eventDate: { type: 'string', description: 'ISO date of triggering event' },
        filingType: { type: 'string', enum: ['STR', 'CTR', 'CNMR', 'DPMSR'] },
      },
      required: ['eventDate', 'filingType'],
    },
  },
  {
    name: 'generate_kpi_report',
    description:
      'Generate 30-KPI DPMS compliance report with RAG scoring. For quarterly/annual MoE, EOCN, FIU reporting.',
    inputSchema: {
      type: 'object',
      properties: {
        measurements: { type: 'array', description: 'Array of KPIMeasurement objects' },
        entity: { type: 'string', description: 'Entity name' },
        period: { type: 'string', description: 'Reporting period (e.g. Q1 2026)' },
        generatedBy: { type: 'string', description: 'Report author' },
      },
      required: ['measurements', 'entity', 'period', 'generatedBy'],
    },
  },
  {
    name: 'list_kpi_definitions',
    description:
      'List all 38 KPI definitions with targets and thresholds. Optionally filter by category.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['cdd-kyc', 'screening-tfs', 'reporting-fiu', 'risk-assessment', 'training', 'supply-chain', 'governance', 'record-keeping'],
        },
      },
    },
  },
] as const;
