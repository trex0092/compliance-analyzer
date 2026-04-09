/**
 * Pre-built Compliance Workflows
 *
 * Ready-to-use orchestration workflows that chain agents and tools
 * for common multi-step compliance operations.
 *
 * Each workflow follows the decision trees in CLAUDE.md.
 */

import type { WorkflowDefinition, StepContext, StepResult } from './engine';
import type { CustomerProfile } from '../../domain/customers';
import type { ComplianceCase } from '../../domain/cases';
import type { SuspicionReport } from '../../domain/reports';

import { runScreeningAgent } from '../definitions/screening-agent';
import { runOnboardingAgent } from '../definitions/onboarding-agent';
import { runIncidentAgent } from '../definitions/incident-agent';
import { runFilingAgent } from '../definitions/filing-agent';
import { runAuditAgent } from '../definitions/audit-agent';

// ---------------------------------------------------------------------------
// Workflow: Full Customer Onboarding
// ---------------------------------------------------------------------------

export function createOnboardingWorkflow(
  customer: CustomerProfile,
  redFlagCodes?: string[],
): WorkflowDefinition {
  return {
    id: `wf-onboard-${customer.id}-${Date.now()}`,
    name: `Customer Onboarding: ${customer.legalName}`,
    description: 'Full onboarding pipeline: screen → score → tier → case → approvals',
    steps: [
      {
        id: 'onboard',
        name: 'Run onboarding agent',
        dependsOn: [],
        execute: async (ctx: StepContext): Promise<StepResult> => {
          const result = await runOnboardingAgent(
            {
              customer,
              redFlagCodes,
              context: {
                highRiskJurisdiction: false,
                pep: customer.pepStatus === 'match',
                cash: false,
              },
            },
            ctx.server,
            ctx.session,
          );
          ctx.workflowData.onboardingResult = result;
          return {
            stepId: 'onboard',
            status: result.blocked ? 'failed' : 'completed',
            data: result,
            error: result.blockReason,
            durationMs: 0,
            retryCount: 0,
          };
        },
      },
      {
        id: 'incident-if-blocked',
        name: 'Handle sanctions block (if needed)',
        dependsOn: ['onboard'],
        condition: (ctx: StepContext) => {
          const r = ctx.workflowData.onboardingResult as { blocked: boolean } | undefined;
          return r?.blocked === true;
        },
        execute: async (ctx: StepContext): Promise<StepResult> => {
          const result = await runIncidentAgent(
            {
              entityId: customer.id,
              entityName: customer.legalName,
              incidentType: 'sanctions-match',
              matchConfidence: 1.0,
            },
            ctx.server,
            ctx.session,
          );
          return {
            stepId: 'incident-if-blocked',
            status: 'completed',
            data: result,
            durationMs: 0,
            retryCount: 0,
          };
        },
      },
      {
        id: 'cdd-schedule',
        name: 'Schedule CDD renewal',
        dependsOn: ['onboard'],
        condition: (ctx: StepContext) => {
          const r = ctx.workflowData.onboardingResult as { blocked: boolean } | undefined;
          return r?.blocked !== true;
        },
        execute: async (ctx: StepContext): Promise<StepResult> => {
          const r = ctx.workflowData.onboardingResult as { nextReviewDate: string; cddTier: string };
          const result = await ctx.server.callTool({
            name: 'scan_cdd_renewals',
            arguments: {
              customers: [{
                ...customer,
                nextCDDReviewDate: r.nextReviewDate,
                riskRating: r.cddTier === 'EDD' ? 'high' : r.cddTier === 'CDD' ? 'medium' : 'low',
              }],
            },
          });
          return {
            stepId: 'cdd-schedule',
            status: 'completed',
            data: result,
            durationMs: 0,
            retryCount: 0,
          };
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Workflow: Incident Response with Filing
// ---------------------------------------------------------------------------

export function createIncidentWithFilingWorkflow(
  entityId: string,
  entityName: string,
  incidentType: 'sanctions-match' | 'str-trigger',
  report?: SuspicionReport,
): WorkflowDefinition {
  return {
    id: `wf-incident-${entityId}-${Date.now()}`,
    name: `Incident Response: ${entityName} (${incidentType})`,
    description: 'Incident handling with automatic filing generation',
    steps: [
      {
        id: 'incident',
        name: 'Run incident agent',
        dependsOn: [],
        execute: async (ctx: StepContext): Promise<StepResult> => {
          const result = await runIncidentAgent(
            { entityId, entityName, incidentType },
            ctx.server,
            ctx.session,
          );
          ctx.workflowData.incidentResult = result;
          return {
            stepId: 'incident',
            status: 'completed',
            data: result,
            durationMs: 0,
            retryCount: 0,
          };
        },
      },
      {
        id: 'filing',
        name: 'Generate filing',
        dependsOn: ['incident'],
        condition: () => !!report,
        execute: async (ctx: StepContext): Promise<StepResult> => {
          const incident = ctx.workflowData.incidentResult as { caseCreated: ComplianceCase | null };
          const filingType = incidentType === 'sanctions-match' ? 'CNMR' : 'STR';
          const result = await runFilingAgent(
            {
              filingType: filingType as 'CNMR' | 'STR',
              report: report!,
              linkedCase: incident.caseCreated ?? undefined,
              eventDate: new Date().toISOString(),
            },
            ctx.server,
            ctx.session,
          );
          return {
            stepId: 'filing',
            status: result.validationPassed ? 'completed' : 'failed',
            data: result,
            error: result.validationPassed ? undefined : 'XML validation failed',
            durationMs: 0,
            retryCount: 0,
          };
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Workflow: Periodic Compliance Review
// ---------------------------------------------------------------------------

export function createPeriodicReviewWorkflow(
  entity: string,
  customers: CustomerProfile[],
  cases: ComplianceCase[],
  period: string,
  analyst: string,
): WorkflowDefinition {
  return {
    id: `wf-review-${entity}-${Date.now()}`,
    name: `Periodic Review: ${entity} (${period})`,
    description: 'CDD renewals + KPI report + audit chain verification',
    steps: [
      {
        id: 'cdd-scan',
        name: 'Scan CDD renewals',
        dependsOn: [],
        execute: async (ctx: StepContext): Promise<StepResult> => {
          const result = await ctx.server.callTool({
            name: 'scan_cdd_renewals',
            arguments: { customers },
          });
          ctx.workflowData.cddResult = result.result.data;
          return {
            stepId: 'cdd-scan',
            status: 'completed',
            data: result.result.data,
            durationMs: 0,
            retryCount: 0,
          };
        },
      },
      {
        id: 're-screen',
        name: 'Re-screen all customers',
        dependsOn: [],
        execute: async (ctx: StepContext): Promise<StepResult> => {
          const results = [];
          for (const cust of customers) {
            const r = await runScreeningAgent(
              {
                entityName: cust.legalName,
                entityType: 'entity',
                depth: 'basic',
              },
              ctx.server,
              ctx.session,
            );
            results.push({ customer: cust.legalName, verdict: r.overallVerdict });
          }
          ctx.workflowData.screeningResults = results;
          return {
            stepId: 're-screen',
            status: 'completed',
            data: results,
            durationMs: 0,
            retryCount: 0,
          };
        },
      },
      {
        id: 'audit-report',
        name: 'Generate audit report',
        dependsOn: ['cdd-scan', 're-screen'],
        execute: async (ctx: StepContext): Promise<StepResult> => {
          const result = await runAuditAgent(
            {
              scope: 'full',
              entity,
              period,
              customers,
              cases,
              generatedBy: analyst,
              auditChain: ctx.server.getAuditChain(),
            },
            ctx.server,
            ctx.session,
          );
          return {
            stepId: 'audit-report',
            status: 'completed',
            data: result,
            durationMs: 0,
            retryCount: 0,
          };
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Workflow: Batch Entity Screening
// ---------------------------------------------------------------------------

export function createBatchScreeningWorkflow(
  entities: Array<{ name: string; type: 'individual' | 'entity' }>,
): WorkflowDefinition {
  const steps: WorkflowDefinition['steps'] = entities.map((entity, i) => ({
    id: `screen-${i}`,
    name: `Screen: ${entity.name}`,
    dependsOn: [], // all run in parallel
    execute: async (ctx: StepContext): Promise<StepResult> => {
      const result = await runScreeningAgent(
        {
          entityName: entity.name,
          entityType: entity.type,
          depth: 'enhanced',
        },
        ctx.server,
        ctx.session,
      );

      // Store result for aggregation
      const results = (ctx.workflowData.batchResults ?? []) as unknown[];
      results.push({
        entity: entity.name,
        verdict: result.overallVerdict,
        confidence: result.confidence,
        escalation: result.escalationRequired,
      });
      ctx.workflowData.batchResults = results;

      return {
        stepId: `screen-${i}`,
        status: 'completed',
        data: result,
        durationMs: 0,
        retryCount: 0,
      };
    },
  }));

  // Add aggregation step that depends on all screenings
  steps.push({
    id: 'aggregate',
    name: 'Aggregate screening results',
    dependsOn: entities.map((_, i) => `screen-${i}`),
    execute: async (ctx: StepContext): Promise<StepResult> => {
      const results = ctx.workflowData.batchResults as Array<{
        entity: string;
        verdict: string;
        confidence: number;
        escalation: boolean;
      }>;

      const summary = {
        total: results.length,
        clear: results.filter((r) => r.verdict === 'clear').length,
        potentialMatches: results.filter((r) => r.verdict === 'potential-match').length,
        confirmedMatches: results.filter((r) => r.verdict === 'confirmed-match').length,
        escalationsRequired: results.filter((r) => r.escalation).length,
        results,
      };

      return {
        stepId: 'aggregate',
        status: 'completed',
        data: summary,
        durationMs: 0,
        retryCount: 0,
      };
    },
  });

  return {
    id: `wf-batch-screen-${Date.now()}`,
    name: `Batch Screening: ${entities.length} entities`,
    description: 'Parallel screening of multiple entities with result aggregation',
    steps,
  };
}
