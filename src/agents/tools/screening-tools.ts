/**
 * Screening MCP Tools
 *
 * Exposes sanctions screening, multi-model screening, and cross-entity
 * scanning as callable MCP tools.
 *
 * Regulatory basis: FDL No.10/2025 Art.22, Art.35; FATF Rec 6-7
 */

import type { ScreeningResult, SanctionsMatch } from '../../services/sanctionsApi';
import type {
  ConsensusResult,
  MultiModelScreeningRequest,
} from '../../services/multiModelScreening';
import type { CrossEntityReport } from '../../services/crossEntityScreening';
import type { ScreeningRun as _ScreeningRun } from '../../domain/screening';
import type { CustomerProfile } from '../../domain/customers';
import type { ToolResult } from '../mcp-server';

import { screenEntityComprehensive, fetchAllSanctionsLists } from '../../services/sanctionsApi';
import {
  runMultiModelScreening,
  consensusToScreeningRun as _consensusToScreeningRun,
} from '../../services/multiModelScreening';
import { runCrossEntityScan } from '../../services/crossEntityScreening';
import { appendToChain, type ChainedAuditEvent } from '../../utils/auditChain';
import { sanitizeText } from '../../utils/sanitize';

// ---------------------------------------------------------------------------
// Tool: screen_entity
// ---------------------------------------------------------------------------

export interface ScreenEntityInput {
  entityName: string;
  entityType?: 'individual' | 'entity';
  proxyUrl?: string;
}

export async function screenEntity(
  input: ScreenEntityInput,
  auditChain: ChainedAuditEvent[],
  analyst: string
): Promise<ToolResult<ScreeningResult>> {
  const name = sanitizeText(input.entityName);
  if (!name || name.length < 2) {
    return { ok: false, error: 'Entity name must be at least 2 characters' };
  }

  const result = await screenEntityComprehensive(name, input.proxyUrl);

  // Audit trail — every screening MUST be logged (CLAUDE.md § Regulatory)
  await appendToChain(auditChain, {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    by: analyst,
    action: 'screening-completed',
    note: `Screened "${name}" — ${result.matches.length} match(es) across ${result.listsChecked.length} lists`,
  });

  return { ok: true, data: result };
}

// ---------------------------------------------------------------------------
// Tool: screen_multi_model
// ---------------------------------------------------------------------------

export interface MultiModelScreenInput {
  entityName: string;
  entityType: 'individual' | 'entity';
  screeningType: 'sanctions' | 'pep' | 'risk-assessment' | 'adverse-media';
  nationality?: string;
  dateOfBirth?: string;
  additionalContext?: string;
  existingMatches?: SanctionsMatch[];
}

export async function screenMultiModel(
  input: MultiModelScreenInput,
  apiKey: string,
  auditChain: ChainedAuditEvent[],
  analyst: string
): Promise<ToolResult<ConsensusResult>> {
  const name = sanitizeText(input.entityName);
  if (!name || name.length < 2) {
    return { ok: false, error: 'Entity name must be at least 2 characters' };
  }

  const request: MultiModelScreeningRequest = {
    entityName: name,
    entityType: input.entityType,
    screeningType: input.screeningType,
    nationality: input.nationality,
    dateOfBirth: input.dateOfBirth,
    additionalContext: input.additionalContext,
    existingMatches: input.existingMatches,
  };

  const result = await runMultiModelScreening(request, apiKey);

  await appendToChain(auditChain, {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    by: analyst,
    action: 'screening-completed',
    note: `Multi-model screening "${name}" — consensus: ${result.consensus}, confidence: ${result.consensusConfidence}, models: ${result.modelsResponded}/${result.modelsQueried}`,
  });

  return { ok: true, data: result };
}

// ---------------------------------------------------------------------------
// Tool: screen_cross_entity
// ---------------------------------------------------------------------------

export interface CrossEntityScreenInput {
  companyCustomerMap: Record<string, { companyName: string; customers: CustomerProfile[] }>;
  companyUBOMap: Record<
    string,
    {
      companyName: string;
      ubos: Array<{
        id: string;
        fullName: string;
        nationality?: string;
        ownershipPercent?: number;
        pepStatus: string;
        sanctionsStatus: string;
      }>;
    }
  >;
}

export async function screenCrossEntity(
  input: CrossEntityScreenInput,
  auditChain: ChainedAuditEvent[],
  analyst: string
): Promise<ToolResult<CrossEntityReport>> {
  const customerMap = new Map(Object.entries(input.companyCustomerMap));
  const uboMap = new Map(Object.entries(input.companyUBOMap));

  const report = runCrossEntityScan(customerMap as never, uboMap as never);

  await appendToChain(auditChain, {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    by: analyst,
    action: 'screening-completed',
    note: `Cross-entity scan — ${report.matches.length} match(es), risk: ${report.riskLevel}`,
  });

  return { ok: true, data: report };
}

// ---------------------------------------------------------------------------
// Tool: refresh_sanctions_lists
// ---------------------------------------------------------------------------

export async function refreshSanctionsLists(
  proxyUrl?: string
): Promise<ToolResult<{ listsChecked: string[]; totalEntries: number; errors: string[] }>> {
  const result = await fetchAllSanctionsLists(proxyUrl);
  return {
    ok: true,
    data: {
      listsChecked: result.listsChecked,
      totalEntries: result.entries.length,
      errors: result.errors,
    },
  };
}

// ---------------------------------------------------------------------------
// Schema exports for MCP registration
// ---------------------------------------------------------------------------

export const SCREENING_TOOL_SCHEMAS = [
  {
    name: 'screen_entity',
    description:
      'Screen an entity against all sanctions lists (UN, OFAC, EU, UK, UAE/EOCN). Returns matches with confidence scores. Regulatory: FDL Art.22, Art.35.',
    inputSchema: {
      type: 'object',
      properties: {
        entityName: { type: 'string', description: 'Name of entity to screen' },
        entityType: { type: 'string', enum: ['individual', 'entity'], default: 'entity' },
        proxyUrl: { type: 'string', description: 'Optional CORS proxy URL' },
      },
      required: ['entityName'],
    },
  },
  {
    name: 'screen_multi_model',
    description:
      'Run multi-model AI consensus screening (5 LLMs in parallel). Returns consensus verdict, confidence, and per-model opinions. Regulatory: FDL Art.12-14, FATF Rec 22/23.',
    inputSchema: {
      type: 'object',
      properties: {
        entityName: { type: 'string' },
        entityType: { type: 'string', enum: ['individual', 'entity'] },
        screeningType: {
          type: 'string',
          enum: ['sanctions', 'pep', 'risk-assessment', 'adverse-media'],
        },
        nationality: { type: 'string' },
        dateOfBirth: { type: 'string' },
        additionalContext: { type: 'string' },
      },
      required: ['entityName', 'entityType', 'screeningType'],
    },
  },
  {
    name: 'screen_cross_entity',
    description:
      'Detect shared customers and UBOs across group entities. Identifies undisclosed relationships. Regulatory: Cabinet Decision 109/2023, FDL Art.12-14.',
    inputSchema: {
      type: 'object',
      properties: {
        companyCustomerMap: {
          type: 'object',
          description: 'Map of companyId → { companyName, customers[] }',
        },
        companyUBOMap: {
          type: 'object',
          description: 'Map of companyId → { companyName, ubos[] }',
        },
      },
      required: ['companyCustomerMap', 'companyUBOMap'],
    },
  },
  {
    name: 'refresh_sanctions_lists',
    description:
      'Fetch latest sanctions lists from all sources (UN, OFAC, EU, UK, UAE). Returns list status and entry counts.',
    inputSchema: {
      type: 'object',
      properties: {
        proxyUrl: { type: 'string', description: 'Optional CORS proxy URL' },
      },
    },
  },
] as const;
