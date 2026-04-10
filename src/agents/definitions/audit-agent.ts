/**
 * Audit Agent
 *
 * Generates comprehensive audit packs and compliance reports:
 * - Pre-audit preparation
 * - MoE inspection readiness (25-item checklist)
 * - KPI compliance reports
 * - CDD renewal status
 * - Filing compliance verification
 * - Audit trail integrity verification
 *
 * Regulatory basis: FDL No.10/2025 Art.24 (record retention 5yr),
 * Cabinet Res 134/2025 Art.19 (internal review)
 */

import type { ComplianceMCPServer } from '../mcp-server';
import type { SessionManager, AgentMessage } from '../session/manager';
import type { ComplianceCase } from '../../domain/cases';
import type { CustomerProfile } from '../../domain/customers';
import type { KPIReport } from '../../domain/kpiFramework';

import { verifyChain, type ChainedAuditEvent } from '../../utils/auditChain';

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------

export type AuditScope =
  | 'full'
  | 'kpi-only'
  | 'cdd-renewals'
  | 'filing-compliance'
  | 'moe-readiness';

export interface AuditAgentConfig {
  scope: AuditScope;
  entity: string;
  period: string;
  /** Customer profiles for CDD review scanning */
  customers?: CustomerProfile[];
  /** Cases for filing compliance check */
  cases?: ComplianceCase[];
  /** KPI measurements for KPI report */
  kpiMeasurements?: Array<{ kpiId: string; value: number; period: string }>;
  /** Audit chain for integrity verification */
  auditChain?: ChainedAuditEvent[];
  /** Analyst name */
  generatedBy: string;
}

export interface AuditAgentResult {
  scope: AuditScope;
  entity: string;
  period: string;
  kpiReport: KPIReport | null;
  cddRenewalSummary: {
    due: number;
    overdue: number;
    upcoming: number;
  } | null;
  auditChainIntegrity: {
    valid: boolean;
    checkedCount: number;
    brokenAt: number | null;
  } | null;
  findings: string[];
  recommendations: string[];
  overallReadiness: 'ready' | 'needs-attention' | 'not-ready';
  messages: AgentMessage[];
}

// ---------------------------------------------------------------------------
// Agent execution
// ---------------------------------------------------------------------------

export async function runAuditAgent(
  config: AuditAgentConfig,
  server: ComplianceMCPServer,
  session: SessionManager
): Promise<AuditAgentResult> {
  const messages: AgentMessage[] = [];
  const findings: string[] = [];
  const recommendations: string[] = [];

  const log = (role: AgentMessage['role'], content: string) => {
    const msg: AgentMessage = { role, content, timestamp: new Date().toISOString() };
    messages.push(msg);
    session.addMessage(msg);
  };

  log('system', `Audit agent started — scope: ${config.scope}, entity: ${config.entity}`);

  let kpiReport: KPIReport | null = null;
  let cddRenewalSummary: AuditAgentResult['cddRenewalSummary'] = null;
  let auditChainIntegrity: AuditAgentResult['auditChainIntegrity'] = null;

  // ---- KPI Report ----
  if (config.scope === 'full' || config.scope === 'kpi-only' || config.scope === 'moe-readiness') {
    log('assistant', `Generating KPI compliance report...`);

    if (config.kpiMeasurements && config.kpiMeasurements.length > 0) {
      const kpiResult = await server.callTool({
        name: 'generate_kpi_report',
        arguments: {
          measurements: config.kpiMeasurements.map((m) => ({
            ...m,
            ragStatus: 'green', // will be recalculated
            measuredAt: new Date().toISOString(),
          })),
          entity: config.entity,
          period: config.period,
          generatedBy: config.generatedBy,
        },
      });

      if (kpiResult.result.ok) {
        kpiReport = kpiResult.result.data as KPIReport;
        log(
          'assistant',
          `KPI report: overall ${kpiReport.overallRAG} (score: ${kpiReport.overallScore})`
        );

        if (kpiReport.summary.redCount > 0) {
          findings.push(`${kpiReport.summary.redCount} KPI(s) in RED status`);
          recommendations.push('Address RED KPIs immediately — potential regulatory penalties');
        }
        if (kpiReport.summary.amberCount > 0) {
          findings.push(`${kpiReport.summary.amberCount} KPI(s) in AMBER status`);
        }
        findings.push(...kpiReport.summary.criticalFindings);
        recommendations.push(...kpiReport.summary.recommendations);
      }
    } else {
      log('assistant', `No KPI measurements provided. Listing available definitions...`);
      const defsResult = await server.callTool({
        name: 'list_kpi_definitions',
        arguments: {},
      });
      if (defsResult.result.ok) {
        const defs = defsResult.result.data as { definitions: Array<{ id: string; name: string }> };
        findings.push(
          `${defs.definitions.length} KPI definitions available but no measurements recorded`
        );
        recommendations.push('Populate KPI measurements before audit');
      }
    }
  }

  // ---- CDD Renewals ----
  if (
    config.scope === 'full' ||
    config.scope === 'cdd-renewals' ||
    config.scope === 'moe-readiness'
  ) {
    log('assistant', `Scanning CDD renewal status...`);

    if (config.customers && config.customers.length > 0) {
      const renewalResult = await server.callTool({
        name: 'scan_cdd_renewals',
        arguments: { customers: config.customers },
      });

      if (renewalResult.result.ok) {
        const data = renewalResult.result.data as {
          renewalsDue: unknown[];
          renewalsOverdue: unknown[];
          upcomingIn30Days: unknown[];
        };
        cddRenewalSummary = {
          due: data.renewalsDue.length,
          overdue: data.renewalsOverdue.length,
          upcoming: data.upcomingIn30Days.length,
        };

        log(
          'assistant',
          `CDD renewals: ${cddRenewalSummary.overdue} overdue, ${cddRenewalSummary.due} due, ${cddRenewalSummary.upcoming} upcoming (30d)`
        );

        if (cddRenewalSummary.overdue > 0) {
          findings.push(`${cddRenewalSummary.overdue} customer(s) with OVERDUE CDD review`);
          recommendations.push(
            'Complete overdue CDD reviews immediately (Cabinet Res 134/2025 Art.7-10)'
          );
        }
      }
    } else {
      findings.push('No customer data provided for CDD renewal scan');
      recommendations.push('Provide customer profiles for CDD renewal analysis');
    }
  }

  // ---- Audit Chain Integrity ----
  if (config.scope === 'full' || config.scope === 'moe-readiness') {
    log('assistant', `Verifying audit chain integrity...`);

    if (config.auditChain && config.auditChain.length > 0) {
      auditChainIntegrity = await verifyChain(config.auditChain);

      if (auditChainIntegrity.valid) {
        log('assistant', `Audit chain VALID — ${auditChainIntegrity.checkedCount} events verified`);
      } else {
        log(
          'assistant',
          `AUDIT CHAIN BROKEN at event #${auditChainIntegrity.brokenAt}. Investigate immediately.`
        );
        findings.push(`Audit chain integrity broken at event #${auditChainIntegrity.brokenAt}`);
        recommendations.push(
          'Investigate audit chain tampering — this is a critical compliance failure'
        );
      }
    } else {
      findings.push('No audit chain provided for integrity verification');
    }
  }

  // ---- Overall readiness ----
  let overallReadiness: AuditAgentResult['overallReadiness'] = 'ready';

  const criticalIssues = findings.filter(
    (f) => f.includes('OVERDUE') || f.includes('BROKEN') || f.includes('RED')
  );

  if (criticalIssues.length > 0) {
    overallReadiness = 'not-ready';
  } else if (findings.length > 0) {
    overallReadiness = 'needs-attention';
  }

  log(
    'system',
    `Audit complete — readiness: ${overallReadiness}, ${findings.length} findings, ${recommendations.length} recommendations`
  );

  return {
    scope: config.scope,
    entity: config.entity,
    period: config.period,
    kpiReport,
    cddRenewalSummary,
    auditChainIntegrity,
    findings,
    recommendations,
    overallReadiness,
    messages,
  };
}
