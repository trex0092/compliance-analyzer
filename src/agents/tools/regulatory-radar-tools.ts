/**
 * Regulatory Change Radar
 *
 * Monitors and processes regulatory changes:
 * 1. Parse regulatory updates (new laws, circulars, amendments)
 * 2. Auto-classify impact level and affected areas
 * 3. Map changes to existing code via Knowledge Graph
 * 4. Generate implementation action items with deadlines
 * 5. Track compliance with implementation deadlines (30 days per MoE circular)
 *
 * Regulatory: Cabinet Res 134/2025 Art.19 (internal review),
 * MoE Circular implementation (30-day deadline)
 */

import type { ToolResult } from '../mcp-server';
import { MOE_CIRCULAR_IMPLEMENTATION_DAYS } from '../../domain/constants';

export interface RegulatoryChange {
  id: string;
  title: string;
  source: string;
  issuedBy: string;
  issuedDate: string;
  effectiveDate: string;
  category: 'new-law' | 'amendment' | 'circular' | 'guidance' | 'sanctions-update' | 'list-update';
  summary: string;
  fullText?: string;
  affectedAreas: string[];
}

export interface ImpactAssessment {
  changeId: string;
  impactLevel: 'low' | 'medium' | 'high' | 'critical';
  affectedModules: string[];
  affectedRegulations: string[];
  implementationDeadline: string;
  daysRemaining: number;
  isOverdue: boolean;
  actionItems: Array<{
    priority: 'critical' | 'high' | 'medium' | 'low';
    action: string;
    responsible: string;
    deadline: string;
    status: 'pending' | 'in-progress' | 'completed';
  }>;
  riskIfNotImplemented: string;
  penaltyRange?: string;
}

export interface RadarReport {
  analyzedAt: string;
  totalChanges: number;
  criticalChanges: number;
  overdueImplementations: number;
  upcomingDeadlines: Array<{
    changeId: string;
    title: string;
    deadline: string;
    daysRemaining: number;
  }>;
  assessments: ImpactAssessment[];
  alerts: string[];
}

// ---------------------------------------------------------------------------
// Impact Classification
// ---------------------------------------------------------------------------

const AREA_MODULE_MAP: Record<string, string[]> = {
  cdd: ['src/domain/customers.ts', 'src/services/cddRenewalEngine.ts', 'src/risk/decisions.ts'],
  sanctions: [
    'src/services/sanctionsApi.ts',
    'src/services/multiModelScreening.ts',
    'tfs-refresh.js',
    'hawkeye-sterling/tfs-engine.js',
  ],
  reporting: ['src/services/goamlBuilder.ts', 'src/utils/goamlValidator.ts', 'goaml-export.js'],
  thresholds: [
    'src/domain/constants.ts',
    'src/risk/transactionMonitoring.ts',
    'threshold-monitor.js',
  ],
  'risk-scoring': ['src/risk/scoring.ts', 'src/risk/decisions.ts', 'src/risk/redFlags.ts'],
  ubo: ['src/services/crossEntityScreening.ts', 'src/domain/customers.ts'],
  pf: ['src/risk/pfMonitoring.ts'],
  tfs: [
    'tfs-refresh.js',
    'hawkeye-sterling/tfs-engine.js',
    'src/agents/definitions/incident-agent.ts',
  ],
  'record-keeping': ['src/utils/auditChain.ts', 'src/services/indexedDbStore.ts', 'database.js'],
  governance: ['src/domain/approvalWorkflow.ts', 'src/domain/rbac.ts', 'auth-rbac.js'],
  training: [],
  'supply-chain': ['supply-chain.js'],
};

const KEYWORD_IMPACT: Array<{ keywords: string[]; area: string; impactBoost: number }> = [
  {
    keywords: ['sanctions', 'designated', 'freeze', 'EOCN', 'TFS'],
    area: 'sanctions',
    impactBoost: 3,
  },
  {
    keywords: ['threshold', 'reporting limit', 'AED 55', 'AED 60', 'cash transaction'],
    area: 'thresholds',
    impactBoost: 2,
  },
  {
    keywords: ['STR', 'SAR', 'CTR', 'goAML', 'suspicious', 'filing'],
    area: 'reporting',
    impactBoost: 2,
  },
  { keywords: ['beneficial owner', 'UBO', 'ownership'], area: 'ubo', impactBoost: 2 },
  {
    keywords: ['penalty', 'fine', 'administrative', 'violation'],
    area: 'governance',
    impactBoost: 3,
  },
  {
    keywords: ['CDD', 'due diligence', 'KYC', 'verification', 'onboarding'],
    area: 'cdd',
    impactBoost: 1,
  },
  { keywords: ['proliferation', 'dual-use', 'strategic goods', 'WMD'], area: 'pf', impactBoost: 3 },
  {
    keywords: ['risk assessment', 'risk appetite', 'scoring'],
    area: 'risk-scoring',
    impactBoost: 1,
  },
];

export function assessRegulatoryChange(change: RegulatoryChange): ImpactAssessment {
  const textToAnalyze = `${change.title} ${change.summary} ${change.fullText ?? ''}`.toLowerCase();

  // Detect affected areas
  const detectedAreas = new Set<string>(change.affectedAreas);
  let impactScore = 0;

  for (const { keywords, area, impactBoost } of KEYWORD_IMPACT) {
    if (keywords.some((kw) => textToAnalyze.includes(kw.toLowerCase()))) {
      detectedAreas.add(area);
      impactScore += impactBoost;
    }
  }

  // Map areas to modules
  const affectedModules: string[] = [];
  for (const area of detectedAreas) {
    const modules = AREA_MODULE_MAP[area] ?? [];
    affectedModules.push(...modules);
  }

  // Determine impact level
  let impactLevel: ImpactAssessment['impactLevel'] = 'low';
  if (impactScore >= 8 || change.category === 'new-law') impactLevel = 'critical';
  else if (impactScore >= 5 || change.category === 'amendment') impactLevel = 'high';
  else if (impactScore >= 3) impactLevel = 'medium';

  // Calculate deadline
  const effectiveDate = new Date(change.effectiveDate);
  const deadlineDays = change.category === 'circular' ? MOE_CIRCULAR_IMPLEMENTATION_DAYS : 90;
  const deadline = new Date(effectiveDate.getTime() + deadlineDays * 86400_000);
  const daysRemaining = Math.ceil((deadline.getTime() - Date.now()) / 86400_000);

  // Generate action items
  const actionItems: ImpactAssessment['actionItems'] = [];

  if (detectedAreas.has('thresholds')) {
    actionItems.push({
      priority: 'critical',
      action: 'Update threshold constants in src/domain/constants.ts',
      responsible: 'Compliance Officer',
      deadline: deadline.toISOString().slice(0, 10),
      status: 'pending',
    });
    actionItems.push({
      priority: 'high',
      action: 'Update tests in tests/constants.test.ts',
      responsible: 'Developer',
      deadline: deadline.toISOString().slice(0, 10),
      status: 'pending',
    });
  }

  if (detectedAreas.has('sanctions')) {
    actionItems.push({
      priority: 'critical',
      action: 'Update sanctions list sources and screening logic',
      responsible: 'MLRO',
      deadline: new Date(Math.min(deadline.getTime(), Date.now() + 24 * 3600_000))
        .toISOString()
        .slice(0, 10),
      status: 'pending',
    });
  }

  if (detectedAreas.has('reporting')) {
    actionItems.push({
      priority: 'high',
      action: 'Update goAML XML schema and validator',
      responsible: 'Developer',
      deadline: deadline.toISOString().slice(0, 10),
      status: 'pending',
    });
  }

  actionItems.push({
    priority: 'medium',
    action: 'Update REGULATORY_CONSTANTS_VERSION in constants.ts',
    responsible: 'Developer',
    deadline: deadline.toISOString().slice(0, 10),
    status: 'pending',
  });

  actionItems.push({
    priority: 'medium',
    action: 'Document regulatory change in compliance register',
    responsible: 'Compliance Officer',
    deadline: deadline.toISOString().slice(0, 10),
    status: 'pending',
  });

  return {
    changeId: change.id,
    impactLevel,
    affectedModules: [...new Set(affectedModules)],
    affectedRegulations: Array.from(detectedAreas),
    implementationDeadline: deadline.toISOString().slice(0, 10),
    daysRemaining,
    isOverdue: daysRemaining < 0,
    actionItems,
    riskIfNotImplemented:
      impactLevel === 'critical'
        ? 'Regulatory non-compliance — potential enforcement action and penalties AED 10K-100M'
        : impactLevel === 'high'
          ? 'Significant compliance gap — increased regulatory scrutiny'
          : 'Minor gap — address during next review cycle',
    penaltyRange:
      impactLevel === 'critical' || impactLevel === 'high'
        ? 'AED 10,000 – AED 100,000,000 (Cabinet Res 71/2024)'
        : undefined,
  };
}

export function runRegulatoryRadar(changes: RegulatoryChange[]): ToolResult<RadarReport> {
  if (changes.length === 0) return { ok: false, error: 'No regulatory changes provided' };

  const assessments = changes.map(assessRegulatoryChange);
  const critical = assessments.filter((a) => a.impactLevel === 'critical');
  const overdue = assessments.filter((a) => a.isOverdue);
  const upcoming = assessments
    .filter((a) => !a.isOverdue && a.daysRemaining <= 30)
    .map((a) => ({
      changeId: a.changeId,
      title: changes.find((c) => c.id === a.changeId)?.title ?? '',
      deadline: a.implementationDeadline,
      daysRemaining: a.daysRemaining,
    }))
    .sort((a, b) => a.daysRemaining - b.daysRemaining);

  const alerts: string[] = [];
  if (overdue.length > 0) alerts.push(`${overdue.length} regulatory implementation(s) OVERDUE`);
  if (critical.length > 0)
    alerts.push(`${critical.length} CRITICAL regulatory change(s) require immediate action`);
  if (upcoming.length > 0) alerts.push(`${upcoming.length} deadline(s) within 30 days`);

  return {
    ok: true,
    data: {
      analyzedAt: new Date().toISOString(),
      totalChanges: changes.length,
      criticalChanges: critical.length,
      overdueImplementations: overdue.length,
      upcomingDeadlines: upcoming,
      assessments,
      alerts,
    },
  };
}

export const RADAR_TOOL_SCHEMAS = [
  {
    name: 'assess_regulatory_change',
    description:
      'Process a regulatory change: auto-classify impact, map to affected code modules, generate action items with deadlines. Tracks MoE 30-day implementation window.',
    inputSchema: {
      type: 'object',
      properties: {
        change: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            source: { type: 'string' },
            issuedBy: { type: 'string' },
            issuedDate: { type: 'string' },
            effectiveDate: { type: 'string' },
            category: { type: 'string' },
            summary: { type: 'string' },
            affectedAreas: { type: 'array', items: { type: 'string' } },
          },
          required: [
            'id',
            'title',
            'source',
            'issuedBy',
            'issuedDate',
            'effectiveDate',
            'category',
            'summary',
            'affectedAreas',
          ],
        },
      },
      required: ['change'],
    },
  },
] as const;
