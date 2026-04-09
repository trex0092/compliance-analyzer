/**
 * Compliance Knowledge Graph
 *
 * Maps every regulation to its implementation in code, test coverage,
 * and evidence trail:
 *
 *   Regulation → Requirement → Code Implementation → Test → Evidence
 *
 * Enables:
 * 1. Regulatory traceability — prove every law is implemented
 * 2. Gap analysis — find regulations without implementation
 * 3. Impact analysis — when a law changes, show what code must change
 * 4. Audit mapping — link evidence to specific regulatory requirements
 * 5. Coverage scoring — percentage of regulations with full coverage
 *
 * Regulatory basis: FDL No.10/2025, Cabinet Res 134/2025,
 * Cabinet Res 74/2020, FATF 40 Recommendations
 */

import type { ToolResult } from '../mcp-server';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Regulation {
  id: string;
  name: string;
  source: string; // e.g. 'FDL No.10/2025'
  article: string; // e.g. 'Art.12-14'
  description: string;
  effectiveDate: string;
  category: 'cdd' | 'sanctions' | 'reporting' | 'record-keeping' | 'governance' | 'tfs' | 'pf' | 'ubo';
}

export interface Requirement {
  id: string;
  regulationId: string;
  description: string;
  mandatory: boolean;
  deadline?: string;
  thresholdValue?: number;
  thresholdUnit?: string;
}

export interface CodeImplementation {
  id: string;
  requirementId: string;
  filePath: string;
  functionName: string;
  lineRange: { start: number; end: number };
  implementationType: 'full' | 'partial' | 'stub' | 'planned';
  lastUpdated: string;
}

export interface TestCoverage {
  id: string;
  implementationId: string;
  testFilePath: string;
  testName: string;
  passing: boolean;
  lastRun: string;
}

export interface EvidenceLink {
  id: string;
  requirementId: string;
  evidenceType: 'policy' | 'procedure' | 'training' | 'report' | 'screening' | 'filing' | 'audit';
  description: string;
  location: string;
  lastVerified: string;
}

export interface TraceabilityNode {
  regulation: Regulation;
  requirements: Requirement[];
  implementations: CodeImplementation[];
  tests: TestCoverage[];
  evidence: EvidenceLink[];
  coverage: {
    implemented: boolean;
    tested: boolean;
    evidenced: boolean;
    score: number; // 0-100
  };
}

export interface GapAnalysis {
  totalRegulations: number;
  fullyImplemented: number;
  partiallyImplemented: number;
  notImplemented: number;
  fullyTested: number;
  notTested: number;
  fullyEvidenced: number;
  notEvidenced: number;
  overallScore: number;
  gaps: Array<{
    regulationId: string;
    regulationName: string;
    gapType: 'no-implementation' | 'no-test' | 'no-evidence' | 'partial-implementation' | 'failing-test';
    severity: 'critical' | 'high' | 'medium' | 'low';
    recommendation: string;
  }>;
}

// ---------------------------------------------------------------------------
// Knowledge Graph
// ---------------------------------------------------------------------------

export class ComplianceKnowledgeGraph {
  private regulations = new Map<string, Regulation>();
  private requirements = new Map<string, Requirement>();
  private implementations = new Map<string, CodeImplementation>();
  private tests = new Map<string, TestCoverage>();
  private evidence = new Map<string, EvidenceLink>();

  // ---- Build ----

  addRegulation(reg: Regulation): void { this.regulations.set(reg.id, reg); }
  addRequirement(req: Requirement): void { this.requirements.set(req.id, req); }
  addImplementation(impl: CodeImplementation): void { this.implementations.set(impl.id, impl); }
  addTest(test: TestCoverage): void { this.tests.set(test.id, test); }
  addEvidence(ev: EvidenceLink): void { this.evidence.set(ev.id, ev); }

  // ---- Query ----

  /** Get full traceability for a regulation */
  getTraceability(regulationId: string): TraceabilityNode | null {
    const regulation = this.regulations.get(regulationId);
    if (!regulation) return null;

    const requirements = Array.from(this.requirements.values()).filter((r) => r.regulationId === regulationId);
    const reqIds = new Set(requirements.map((r) => r.id));

    const implementations = Array.from(this.implementations.values()).filter((i) => reqIds.has(i.requirementId));
    const implIds = new Set(implementations.map((i) => i.id));

    const tests = Array.from(this.tests.values()).filter((t) => implIds.has(t.implementationId));
    const evidence = Array.from(this.evidence.values()).filter((e) => reqIds.has(e.requirementId));

    const implemented = implementations.length > 0 && implementations.some((i) => i.implementationType === 'full');
    const tested = tests.length > 0 && tests.every((t) => t.passing);
    const evidenced = evidence.length > 0;

    let score = 0;
    if (implemented) score += 40;
    else if (implementations.length > 0) score += 20;
    if (tested) score += 30;
    else if (tests.length > 0) score += 15;
    if (evidenced) score += 30;

    return {
      regulation,
      requirements,
      implementations,
      tests,
      evidence,
      coverage: { implemented, tested, evidenced, score },
    };
  }

  /** Run full gap analysis */
  runGapAnalysis(): GapAnalysis {
    const gaps: GapAnalysis['gaps'] = [];
    let fullyImplemented = 0, partiallyImplemented = 0, notImplemented = 0;
    let fullyTested = 0, notTested = 0;
    let fullyEvidenced = 0, notEvidenced = 0;

    for (const [regId, reg] of this.regulations) {
      const trace = this.getTraceability(regId);
      if (!trace) continue;

      if (trace.coverage.implemented) fullyImplemented++;
      else if (trace.implementations.length > 0) partiallyImplemented++;
      else notImplemented++;

      if (trace.coverage.tested) fullyTested++;
      else notTested++;

      if (trace.coverage.evidenced) fullyEvidenced++;
      else notEvidenced++;

      // Identify gaps
      if (trace.implementations.length === 0) {
        gaps.push({
          regulationId: regId,
          regulationName: reg.name,
          gapType: 'no-implementation',
          severity: 'critical',
          recommendation: `Implement ${reg.source} ${reg.article}: ${reg.description}`,
        });
      } else if (trace.implementations.some((i) => i.implementationType === 'partial' || i.implementationType === 'stub')) {
        gaps.push({
          regulationId: regId,
          regulationName: reg.name,
          gapType: 'partial-implementation',
          severity: 'high',
          recommendation: `Complete implementation of ${reg.source} ${reg.article}`,
        });
      }

      if (trace.tests.length === 0 && trace.implementations.length > 0) {
        gaps.push({
          regulationId: regId,
          regulationName: reg.name,
          gapType: 'no-test',
          severity: 'high',
          recommendation: `Add test coverage for ${reg.source} ${reg.article} implementation`,
        });
      } else if (trace.tests.some((t) => !t.passing)) {
        gaps.push({
          regulationId: regId,
          regulationName: reg.name,
          gapType: 'failing-test',
          severity: 'critical',
          recommendation: `Fix failing tests for ${reg.source} ${reg.article}`,
        });
      }

      if (trace.evidence.length === 0) {
        gaps.push({
          regulationId: regId,
          regulationName: reg.name,
          gapType: 'no-evidence',
          severity: 'medium',
          recommendation: `Collect and link evidence for ${reg.source} ${reg.article} compliance`,
        });
      }
    }

    const total = this.regulations.size;
    const overallScore = total > 0
      ? Math.round(((fullyImplemented * 40 + partiallyImplemented * 20) / (total * 40) * 40 +
          (fullyTested / Math.max(1, total)) * 30 +
          (fullyEvidenced / Math.max(1, total)) * 30))
      : 0;

    return {
      totalRegulations: total,
      fullyImplemented,
      partiallyImplemented,
      notImplemented,
      fullyTested,
      notTested,
      fullyEvidenced,
      notEvidenced,
      overallScore,
      gaps: gaps.sort((a, b) => {
        const sev = { critical: 0, high: 1, medium: 2, low: 3 };
        return sev[a.severity] - sev[b.severity];
      }),
    };
  }

  /** Impact analysis — what code changes if a regulation changes */
  getImpactAnalysis(regulationId: string): {
    regulation: Regulation | undefined;
    affectedFiles: string[];
    affectedFunctions: string[];
    affectedTests: string[];
    totalImpact: number;
  } {
    const trace = this.getTraceability(regulationId);
    if (!trace) {
      return {
        regulation: this.regulations.get(regulationId),
        affectedFiles: [],
        affectedFunctions: [],
        affectedTests: [],
        totalImpact: 0,
      };
    }

    const files = [...new Set(trace.implementations.map((i) => i.filePath))];
    const functions = trace.implementations.map((i) => `${i.filePath}:${i.functionName}`);
    const tests = trace.tests.map((t) => `${t.testFilePath}:${t.testName}`);

    return {
      regulation: trace.regulation,
      affectedFiles: files,
      affectedFunctions: functions,
      affectedTests: tests,
      totalImpact: files.length + functions.length + tests.length,
    };
  }

  /** Seed with UAE regulatory framework */
  seedUAERegulations(): void {
    const regs: Regulation[] = [
      { id: 'FDL-ART12', name: 'Customer Due Diligence', source: 'FDL No.10/2025', article: 'Art.12-14', description: 'CDD requirements for all customers', effectiveDate: '2025-01-01', category: 'cdd' },
      { id: 'FDL-ART15', name: 'Transaction Thresholds', source: 'FDL No.10/2025', article: 'Art.15-16', description: 'DPMS cash threshold AED 55,000', effectiveDate: '2025-01-01', category: 'reporting' },
      { id: 'FDL-ART22', name: 'Sanctions Screening', source: 'FDL No.10/2025', article: 'Art.22', description: 'Screen against all applicable sanctions lists', effectiveDate: '2025-01-01', category: 'sanctions' },
      { id: 'FDL-ART24', name: 'Record Retention', source: 'FDL No.10/2025', article: 'Art.24', description: 'Minimum 5-year record retention', effectiveDate: '2025-01-01', category: 'record-keeping' },
      { id: 'FDL-ART26', name: 'STR Filing', source: 'FDL No.10/2025', article: 'Art.26-27', description: 'File STR without delay', effectiveDate: '2025-01-01', category: 'reporting' },
      { id: 'FDL-ART29', name: 'No Tipping Off', source: 'FDL No.10/2025', article: 'Art.29', description: 'Never disclose STR to subject', effectiveDate: '2025-01-01', category: 'reporting' },
      { id: 'FDL-ART35', name: 'TFS Implementation', source: 'FDL No.10/2025', article: 'Art.35', description: 'Targeted Financial Sanctions compliance', effectiveDate: '2025-01-01', category: 'tfs' },
      { id: 'CAB134-ART5', name: 'Risk Appetite', source: 'Cabinet Res 134/2025', article: 'Art.5', description: 'Define and document risk appetite', effectiveDate: '2025-01-01', category: 'governance' },
      { id: 'CAB134-ART7', name: 'CDD Tiers', source: 'Cabinet Res 134/2025', article: 'Art.7-10', description: 'SDD/CDD/EDD tiering based on risk', effectiveDate: '2025-01-01', category: 'cdd' },
      { id: 'CAB134-ART14', name: 'PEP Requirements', source: 'Cabinet Res 134/2025', article: 'Art.14', description: 'PEP identification and EDD', effectiveDate: '2025-01-01', category: 'cdd' },
      { id: 'CAB74-ART4', name: 'Asset Freeze', source: 'Cabinet Res 74/2020', article: 'Art.4-7', description: 'Freeze within 24h, CNMR in 5 days', effectiveDate: '2020-01-01', category: 'tfs' },
      { id: 'CAB109-UBO', name: 'UBO Register', source: 'Cabinet Decision 109/2023', article: 'Full', description: 'Beneficial ownership >25%, re-verify in 15 days', effectiveDate: '2023-01-01', category: 'ubo' },
      { id: 'CAB156-PF', name: 'PF Controls', source: 'Cabinet Res 156/2025', article: 'Full', description: 'PF risk assessment, strategic goods screening', effectiveDate: '2025-01-01', category: 'pf' },
    ];

    for (const reg of regs) this.addRegulation(reg);

    // Add requirements
    const requirements: Requirement[] = [
      { id: 'REQ-CDD-01', regulationId: 'FDL-ART12', description: 'Verify customer identity before establishing business relationship', mandatory: true },
      { id: 'REQ-CDD-02', regulationId: 'CAB134-ART7', description: 'Apply SDD for score < 6, CDD for 6-15, EDD for >= 16', mandatory: true },
      { id: 'REQ-SCREEN-01', regulationId: 'FDL-ART22', description: 'Screen against UN, OFAC, EU, UK, UAE/EOCN lists', mandatory: true },
      { id: 'REQ-SCREEN-02', regulationId: 'FDL-ART35', description: 'Implement TFS within 24 hours of designation', mandatory: true },
      { id: 'REQ-REPORT-01', regulationId: 'FDL-ART26', description: 'File STR without delay when suspicion formed', mandatory: true },
      { id: 'REQ-REPORT-02', regulationId: 'FDL-ART15', description: 'File CTR for cash transactions >= AED 55,000', mandatory: true, thresholdValue: 55000, thresholdUnit: 'AED' },
      { id: 'REQ-NOTRIP-01', regulationId: 'FDL-ART29', description: 'Do not disclose STR/SAR to subject', mandatory: true },
      { id: 'REQ-FREEZE-01', regulationId: 'CAB74-ART4', description: 'Freeze assets within 24 hours', mandatory: true, deadline: '24h' },
      { id: 'REQ-FREEZE-02', regulationId: 'CAB74-ART4', description: 'File CNMR within 5 business days', mandatory: true, deadline: '5bd' },
      { id: 'REQ-UBO-01', regulationId: 'CAB109-UBO', description: 'Register UBO above 25% ownership', mandatory: true, thresholdValue: 25, thresholdUnit: '%' },
      { id: 'REQ-PEP-01', regulationId: 'CAB134-ART14', description: 'Apply EDD for PEPs with Senior Management approval', mandatory: true },
      { id: 'REQ-PF-01', regulationId: 'CAB156-PF', description: 'Screen for PF indicators and dual-use goods', mandatory: true },
      { id: 'REQ-RECORD-01', regulationId: 'FDL-ART24', description: 'Retain all compliance records for minimum 5 years', mandatory: true },
    ];

    for (const req of requirements) this.addRequirement(req);

    // Add implementations mapping to actual code
    const implementations: CodeImplementation[] = [
      { id: 'IMPL-CDD-01', requirementId: 'REQ-CDD-01', filePath: 'src/domain/customers.ts', functionName: 'CustomerProfile', lineRange: { start: 1, end: 151 }, implementationType: 'full', lastUpdated: '2026-04-08' },
      { id: 'IMPL-CDD-02', requirementId: 'REQ-CDD-02', filePath: 'src/services/cddRenewalEngine.ts', functionName: 'scanForRenewals', lineRange: { start: 1, end: 150 }, implementationType: 'full', lastUpdated: '2026-04-08' },
      { id: 'IMPL-SCREEN-01', requirementId: 'REQ-SCREEN-01', filePath: 'src/services/sanctionsApi.ts', functionName: 'screenEntityComprehensive', lineRange: { start: 1, end: 420 }, implementationType: 'full', lastUpdated: '2026-04-08' },
      { id: 'IMPL-SCREEN-02', requirementId: 'REQ-SCREEN-02', filePath: 'src/agents/definitions/incident-agent.ts', functionName: 'handleSanctionsMatch', lineRange: { start: 1, end: 100 }, implementationType: 'full', lastUpdated: '2026-04-09' },
      { id: 'IMPL-REPORT-01', requirementId: 'REQ-REPORT-01', filePath: 'src/services/goamlBuilder.ts', functionName: 'buildGoAMLXml', lineRange: { start: 1, end: 276 }, implementationType: 'full', lastUpdated: '2026-04-08' },
      { id: 'IMPL-REPORT-02', requirementId: 'REQ-REPORT-02', filePath: 'src/risk/transactionMonitoring.ts', functionName: 'runTransactionMonitoring', lineRange: { start: 1, end: 254 }, implementationType: 'full', lastUpdated: '2026-04-08' },
      { id: 'IMPL-SCORING', requirementId: 'REQ-CDD-02', filePath: 'src/risk/scoring.ts', functionName: 'calcFlagScore', lineRange: { start: 1, end: 32 }, implementationType: 'full', lastUpdated: '2026-04-08' },
      { id: 'IMPL-DECISION', requirementId: 'REQ-CDD-02', filePath: 'src/risk/decisions.ts', functionName: 'decideCase', lineRange: { start: 1, end: 75 }, implementationType: 'full', lastUpdated: '2026-04-08' },
      { id: 'IMPL-UBO', requirementId: 'REQ-UBO-01', filePath: 'src/services/crossEntityScreening.ts', functionName: 'detectSharedUBOs', lineRange: { start: 1, end: 158 }, implementationType: 'full', lastUpdated: '2026-04-08' },
      { id: 'IMPL-PF', requirementId: 'REQ-PF-01', filePath: 'src/risk/pfMonitoring.ts', functionName: 'runPFScreening', lineRange: { start: 1, end: 262 }, implementationType: 'full', lastUpdated: '2026-04-08' },
      { id: 'IMPL-AUDIT', requirementId: 'REQ-RECORD-01', filePath: 'src/utils/auditChain.ts', functionName: 'createChainedEvent', lineRange: { start: 1, end: 94 }, implementationType: 'full', lastUpdated: '2026-04-08' },
      { id: 'IMPL-NOTRIP', requirementId: 'REQ-NOTRIP-01', filePath: 'src/agents/definitions/incident-agent.ts', functionName: 'runIncidentAgent', lineRange: { start: 1, end: 50 }, implementationType: 'full', lastUpdated: '2026-04-09' },
    ];

    for (const impl of implementations) this.addImplementation(impl);

    // Add test mappings
    const tests: TestCoverage[] = [
      { id: 'TEST-SCORING', implementationId: 'IMPL-SCORING', testFilePath: 'tests/scoring.test.ts', testName: 'scoring suite', passing: true, lastRun: '2026-04-09' },
      { id: 'TEST-DECISIONS', implementationId: 'IMPL-DECISION', testFilePath: 'tests/decisions.test.ts', testName: 'decisions suite', passing: true, lastRun: '2026-04-09' },
      { id: 'TEST-AUDIT', implementationId: 'IMPL-AUDIT', testFilePath: 'tests/auditChain.test.ts', testName: 'audit chain suite', passing: true, lastRun: '2026-04-09' },
      { id: 'TEST-GOAML', implementationId: 'IMPL-REPORT-01', testFilePath: 'tests/goamlValidator.test.ts', testName: 'goAML validator suite', passing: true, lastRun: '2026-04-09' },
      { id: 'TEST-TM', implementationId: 'IMPL-REPORT-02', testFilePath: 'tests/transactionMonitoringEngine.test.ts', testName: 'TM engine suite', passing: true, lastRun: '2026-04-09' },
      { id: 'TEST-KPI', implementationId: 'IMPL-CDD-02', testFilePath: 'tests/kpiFramework.test.ts', testName: 'KPI framework suite', passing: true, lastRun: '2026-04-09' },
      { id: 'TEST-CROSS', implementationId: 'IMPL-UBO', testFilePath: 'tests/crossEntity.test.ts', testName: 'cross-entity suite', passing: true, lastRun: '2026-04-09' },
      { id: 'TEST-QUANT', implementationId: 'IMPL-REPORT-02', testFilePath: 'tests/quantAnalytics.test.ts', testName: 'quant analytics suite', passing: true, lastRun: '2026-04-09' },
    ];

    for (const test of tests) this.addTest(test);
  }

  get stats() {
    return {
      regulations: this.regulations.size,
      requirements: this.requirements.size,
      implementations: this.implementations.size,
      tests: this.tests.size,
      evidence: this.evidence.size,
    };
  }
}

// ---------------------------------------------------------------------------
// Schema exports
// ---------------------------------------------------------------------------

export const KNOWLEDGE_GRAPH_TOOL_SCHEMAS = [
  {
    name: 'traceability_query',
    description:
      'Query the compliance knowledge graph for full regulatory traceability: regulation → requirement → code → test → evidence. Shows coverage score for any regulation.',
    inputSchema: {
      type: 'object',
      properties: {
        regulationId: { type: 'string', description: 'Regulation ID (e.g. FDL-ART12, CAB134-ART7)' },
      },
      required: ['regulationId'],
    },
  },
  {
    name: 'gap_analysis',
    description:
      'Run full regulatory gap analysis. Identifies regulations without implementation, tests, or evidence. Returns prioritized gap list with recommendations.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'regulation_impact_analysis',
    description:
      'When a regulation changes, show exactly which files, functions, and tests are affected. Critical for regulatory update impact assessment.',
    inputSchema: {
      type: 'object',
      properties: {
        regulationId: { type: 'string' },
      },
      required: ['regulationId'],
    },
  },
] as const;
