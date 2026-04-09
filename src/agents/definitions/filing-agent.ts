/**
 * Filing Agent
 *
 * Handles compliance filing workflows:
 * - STR/SAR generation and validation
 * - CTR generation for DPMS cash transactions
 * - CNMR filing for sanctions matches
 * - DPMSR quarterly reports
 * - goAML XML generation and validation
 *
 * Regulatory deadlines (from CLAUDE.md):
 *   STR/SAR → without delay (FDL Art.26)
 *   CTR/DPMSR → 15 business days
 *   CNMR → 5 business days
 *   EOCN freeze → 24 clock hours
 */

import type { ComplianceMCPServer, ToolCallResponse } from '../mcp-server';
import type { SessionManager, AgentMessage } from '../session/manager';
import type { SuspicionReport } from '../../domain/reports';
import type { ComplianceCase } from '../../domain/cases';
import type { CustomerProfile } from '../../domain/customers';

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------

export type FilingType = 'STR' | 'SAR' | 'CTR' | 'CNMR' | 'DPMSR';

export interface FilingAgentConfig {
  filingType: FilingType;
  report: SuspicionReport;
  linkedCase?: ComplianceCase;
  linkedCustomer?: CustomerProfile;
  /** Event date for deadline calculation */
  eventDate: string;
}

export interface FilingAgentResult {
  filingType: FilingType;
  xml: string | null;
  filename: string | null;
  validationPassed: boolean;
  validationErrors: Array<{ field: string; message: string }>;
  validationWarnings: Array<{ field: string; message: string }>;
  deadline: {
    dueDate: string;
    isOverdue: boolean;
    businessDaysRemaining: number;
  } | null;
  approvalRequested: boolean;
  messages: AgentMessage[];
}

// ---------------------------------------------------------------------------
// Agent execution
// ---------------------------------------------------------------------------

export async function runFilingAgent(
  config: FilingAgentConfig,
  server: ComplianceMCPServer,
  session: SessionManager,
): Promise<FilingAgentResult> {
  const messages: AgentMessage[] = [];
  const log = (role: AgentMessage['role'], content: string) => {
    const msg: AgentMessage = { role, content, timestamp: new Date().toISOString() };
    messages.push(msg);
    session.addMessage(msg);
  };

  log('system', `Filing agent started — type: ${config.filingType}`);

  // Step 1: Check deadline
  log('assistant', `Checking filing deadline for ${config.filingType}...`);

  const filingTypeForDeadline = config.filingType === 'SAR' ? 'STR' : config.filingType;
  const deadlineResult = await server.callTool({
    name: 'check_filing_deadline',
    arguments: {
      eventDate: config.eventDate,
      filingType: filingTypeForDeadline,
    },
  });

  let deadline: FilingAgentResult['deadline'] = null;
  if (deadlineResult.result.ok) {
    const d = deadlineResult.result.data as { dueDate: string; isOverdue: boolean; businessDaysRemaining: number };
    deadline = d;
    if (d.isOverdue) {
      log('assistant', `WARNING: Filing is OVERDUE. Deadline was ${d.dueDate}. Expedite immediately.`);
    } else {
      log('assistant', `Deadline: ${d.dueDate} (${d.businessDaysRemaining} business days remaining).`);
    }
  }

  // Step 2: Generate goAML XML
  log('assistant', `Generating goAML XML for ${config.filingType}...`);
  const xmlResult = await server.callTool({
    name: 'generate_goaml_xml',
    arguments: {
      report: config.report,
      linkedCase: config.linkedCase,
      linkedCustomer: config.linkedCustomer,
    },
  });

  let xml: string | null = null;
  let filename: string | null = null;
  let validationPassed = false;
  let validationErrors: Array<{ field: string; message: string }> = [];
  let validationWarnings: Array<{ field: string; message: string }> = [];

  if (xmlResult.result.ok) {
    const data = xmlResult.result.data as {
      xml: string;
      filename: string;
      validation: {
        valid: boolean;
        errors: Array<{ field: string; message: string }>;
        warnings: Array<{ field: string; message: string }>;
      };
    };
    xml = data.xml;
    filename = data.filename;
    validationPassed = data.validation.valid;
    validationErrors = data.validation.errors;
    validationWarnings = data.validation.warnings;

    if (validationPassed) {
      log('assistant', `XML generated and validated successfully: ${filename}`);
    } else {
      log('assistant', `XML generated but validation FAILED with ${validationErrors.length} error(s):`);
      for (const err of validationErrors) {
        log('assistant', `  - ${err.field}: ${err.message}`);
      }
    }

    if (validationWarnings.length > 0) {
      log('assistant', `${validationWarnings.length} warning(s):`);
      for (const warn of validationWarnings) {
        log('assistant', `  - ${warn.field}: ${warn.message}`);
      }
    }
  } else {
    log('assistant', `Failed to generate XML: ${xmlResult.result.error}`);
  }

  // Step 3: Request approval (STR/SAR require MLRO approval)
  let approvalRequested = false;
  if (config.linkedCase && (config.filingType === 'STR' || config.filingType === 'SAR')) {
    log('assistant', `Requesting MLRO approval for ${config.filingType}...`);
    const gate = config.filingType === 'STR' ? 'str-approval' : 'sar-approval';
    await server.callTool({
      name: 'request_approval',
      arguments: { caseId: config.linkedCase.id, gate },
    });
    approvalRequested = true;
    log('assistant', `Approval requested. Filing will be submitted after MLRO sign-off.`);
  } else if (config.linkedCase && config.filingType === 'CTR') {
    await server.callTool({
      name: 'request_approval',
      arguments: { caseId: config.linkedCase.id, gate: 'ctr-approval' },
    });
    approvalRequested = true;
  }

  // No tipping off reminder
  if (config.filingType === 'STR' || config.filingType === 'SAR') {
    log('assistant', `REMINDER: Do NOT disclose this filing to the subject (FDL Art.29 — no tipping off).`);
  }

  log('system', `Filing agent complete — ${config.filingType} ${validationPassed ? 'ready' : 'needs fixes'}`);

  return {
    filingType: config.filingType,
    xml,
    filename,
    validationPassed,
    validationErrors,
    validationWarnings,
    deadline,
    approvalRequested,
    messages,
  };
}
