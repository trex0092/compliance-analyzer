/**
 * AI Governance Checker — 10-Point Pre-Deployment Checklist
 *
 * Implements the AI Governance Checklist (Responsible AI = Trust & Safety):
 *   1.  Problem Clarity        — Define the business need
 *   2.  Data Quality Check     — Ensure data is accurate & unbiased
 *   3.  Bias & Fairness        — Test for bias in the model
 *   4.  Model Transparency     — Ensure explainable decisions
 *   5.  Risk Assessment        — Identify potential risks
 *   6.  Regulatory Compliance  — Follow legal & ethical standards
 *   7.  Accountability         — Define responsibility
 *   8.  Monitoring & Maintenance — Plan for ongoing oversight
 *   9.  Security & Privacy     — Protect sensitive data
 *   10. Human Oversight        — Ensure human intervention
 *
 * Each dimension is scored 0–100 and mapped to a readiness level.
 * Produces a structured report + Asana-ready markdown.
 *
 * Regulatory: NIST AI RMF 1.0 (GV, MAP, MEASURE, MANAGE functions),
 *             EU AI Act 2024 (High-Risk AI, Art.9-17 obligations),
 *             ISO/IEC 42001:2023 (AI Management Systems),
 *             UAE AI Ethics Principles (MOCCAE 2019),
 *             FDL No.10/2025 Art.20-21 (CO accountability for AI decisions),
 *             Cabinet Res 134/2025 Art.19 (internal review before AI action).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type GovernanceReadiness =
  | 'exemplary' // 90-100 — exceeds all requirements
  | 'compliant' // 75-89  — meets all mandatory requirements
  | 'developing' // 50-74  — gaps in non-critical areas
  | 'deficient' // 25-49  — critical gaps requiring remediation
  | 'non_compliant'; // 0-24 — must not be deployed

export type CheckStatus = 'pass' | 'partial' | 'fail' | 'not_assessed';

export interface GovernanceDimension {
  id: string;
  name: string;
  description: string;
  score: number; // 0–100
  status: CheckStatus;
  findings: string[];
  recommendations: string[];
  regulatoryRefs: string[];
  nistFunction: 'GOVERN' | 'MAP' | 'MEASURE' | 'MANAGE';
  isMandatory: boolean; // EU AI Act High-Risk mandatory controls
}

export interface AiGovernanceReport {
  entityId: string;
  systemName: string;
  assessedAt: string;
  overallScore: number;
  readiness: GovernanceReadiness;
  deploymentApproved: boolean;
  criticalFailures: string[];
  dimensions: GovernanceDimension[];
  executiveSummary: string;
  markdownReport: string;
  regulatoryRisk: 'critical' | 'high' | 'medium' | 'low';
}

export interface AiGovernanceInput {
  entityId: string;
  systemName?: string;

  // 1. Problem Clarity
  businessNeedDocumented?: boolean;
  scopeAndLimitationsDefined?: boolean;
  successMetricsDefined?: boolean;

  // 2. Data Quality
  dataSourcesValidated?: boolean;
  dataBiasAuditCompleted?: boolean;
  dataLineageDocumented?: boolean;
  trainingDataRecencyMonths?: number; // months since last update

  // 3. Bias & Fairness
  demographicParityTested?: boolean;
  equalizedOddsTested?: boolean;
  nationalityBiasChecked?: boolean; // critical for AML screening
  falsePositiveRateByGroup?: Record<string, number>;

  // 4. Model Transparency
  explainabilityImplemented?: boolean;
  decisionRationaleProvided?: boolean; // per-decision explanation
  modelCardPublished?: boolean;

  // 5. Risk Assessment
  aiRiskClassification?: 'high' | 'limited' | 'minimal' | 'unacceptable';
  riskRegisterExists?: boolean;
  adversarialTestingCompleted?: boolean;
  hallucidationDetectionEnabled?: boolean;

  // 6. Regulatory Compliance
  uaeAiPrinciplesAligned?: boolean;
  nistAiRmfImplemented?: boolean;
  euAiActAssessed?: boolean;
  isoIec42001Certified?: boolean;
  amlCftRegulatoryApproval?: boolean; // specific to compliance tools

  // 7. Accountability
  aiSystemOwnerDesignated?: boolean;
  raciMatrixDocumented?: boolean;
  escalationPathDefined?: boolean;
  incidentResponsePlanExists?: boolean;

  // 8. Monitoring & Maintenance
  modelDriftMonitoringEnabled?: boolean;
  performanceKpisTracked?: boolean;
  retrainingScheduleExists?: boolean;
  verdictDriftAlertConfigured?: boolean;

  // 9. Security & Privacy
  adversarialMlDefenseEnabled?: boolean;
  dataMaskedInLogs?: boolean;
  rateLimitingImplemented?: boolean;
  inputValidationEnabled?: boolean;
  penTestCompleted?: boolean;

  // 10. Human Oversight
  humanInLoopForHighRisk?: boolean;
  fourEyesEnforced?: boolean;
  overrideCapabilityExists?: boolean;
  auditTrailEnabled?: boolean;
}

// ─── Scoring Logic ────────────────────────────────────────────────────────────

function scoreDimension(
  id: string,
  name: string,
  description: string,
  nistFunction: GovernanceDimension['nistFunction'],
  isMandatory: boolean,
  regulatoryRefs: string[],
  checks: Array<{ label: string; value: boolean | undefined; weight: number; critical?: boolean }>
): GovernanceDimension {
  const findings: string[] = [];
  const recommendations: string[] = [];
  let weightedScore = 0;
  let totalWeight = 0;
  let criticalFailure = false;

  for (const check of checks) {
    totalWeight += check.weight;
    if (check.value === true) {
      weightedScore += check.weight;
    } else if (check.value === false) {
      findings.push(`FAIL: ${check.label}`);
      if (check.critical) {
        criticalFailure = true;
        recommendations.push(`CRITICAL: Implement ${check.label} immediately before deployment`);
      } else {
        recommendations.push(`Implement: ${check.label}`);
      }
    } else {
      // undefined = not assessed, partial credit
      weightedScore += check.weight * 0.3;
      findings.push(`NOT ASSESSED: ${check.label}`);
      recommendations.push(`Assess: ${check.label}`);
    }
  }

  const rawScore = totalWeight > 0 ? (weightedScore / totalWeight) * 100 : 0;
  const score = criticalFailure ? Math.min(rawScore, 30) : rawScore;

  const status: CheckStatus =
    score >= 75 ? 'pass' : score >= 40 ? 'partial' : score > 0 ? 'fail' : 'not_assessed';

  return {
    id,
    name,
    description,
    score,
    status,
    findings,
    recommendations,
    regulatoryRefs,
    nistFunction,
    isMandatory,
  };
}

// ─── Main Checker ─────────────────────────────────────────────────────────────

export function checkAiGovernance(input: AiGovernanceInput): AiGovernanceReport {
  const assessedAt = new Date().toISOString();
  const systemName = input.systemName ?? 'Compliance AI System';

  const dimensions: GovernanceDimension[] = [];

  // ── 1. Problem Clarity ────────────────────────────────────────────────────
  dimensions.push(
    scoreDimension(
      'G1',
      'Problem Clarity',
      'Define the business need and scope of the AI system',
      'GOVERN',
      true,
      ['NIST AI RMF GV-1.1; EU AI Act Art.13; ISO/IEC 42001 §6.1'],
      [
        {
          label: 'Business need documented',
          value: input.businessNeedDocumented,
          weight: 35,
          critical: true,
        },
        {
          label: 'Scope and limitations defined',
          value: input.scopeAndLimitationsDefined,
          weight: 35,
          critical: true,
        },
        { label: 'Success metrics defined', value: input.successMetricsDefined, weight: 30 },
      ]
    )
  );

  // ── 2. Data Quality Check ─────────────────────────────────────────────────
  const dataRecencyOk =
    input.trainingDataRecencyMonths !== undefined
      ? input.trainingDataRecencyMonths <= 12
      : undefined;
  dimensions.push(
    scoreDimension(
      'G2',
      'Data Quality Check',
      'Ensure data is accurate, complete, and unbiased',
      'MAP',
      true,
      ['NIST AI RMF MAP-3.5; EU AI Act Art.10; ISO/IEC 42001 §8.4'],
      [
        {
          label: 'Data sources validated',
          value: input.dataSourcesValidated,
          weight: 30,
          critical: true,
        },
        {
          label: 'Data bias audit completed',
          value: input.dataBiasAuditCompleted,
          weight: 35,
          critical: true,
        },
        { label: 'Data lineage documented', value: input.dataLineageDocumented, weight: 20 },
        { label: 'Training data recency ≤ 12 months', value: dataRecencyOk, weight: 15 },
      ]
    )
  );

  // ── 3. Bias & Fairness ────────────────────────────────────────────────────
  dimensions.push(
    scoreDimension(
      'G3',
      'Bias & Fairness',
      'Test for bias in the model — especially nationality/origin bias in AML screening',
      'MEASURE',
      true,
      ['NIST AI RMF MEASURE-2.5; EU AI Act Art.9; FATF AML Bias Guidance 2023'],
      [
        {
          label: 'Demographic parity tested',
          value: input.demographicParityTested,
          weight: 25,
          critical: true,
        },
        {
          label: 'Equalized odds tested',
          value: input.equalizedOddsTested,
          weight: 25,
          critical: true,
        },
        {
          label: 'Nationality/origin bias checked (AML context)',
          value: input.nationalityBiasChecked,
          weight: 35,
          critical: true,
        },
        {
          label: 'False positive rate by group documented',
          value: input.falsePositiveRateByGroup !== undefined,
          weight: 15,
        },
      ]
    )
  );

  // ── 4. Model Transparency ─────────────────────────────────────────────────
  dimensions.push(
    scoreDimension(
      'G4',
      'Model Transparency',
      'Ensure every decision is explainable to regulators and auditors',
      'GOVERN',
      true,
      ['NIST AI RMF GV-6.1; EU AI Act Art.13-14; FDL No.10/2025 Art.24'],
      [
        {
          label: 'Explainability implemented (per-decision rationale)',
          value: input.explainabilityImplemented,
          weight: 40,
          critical: true,
        },
        {
          label: 'Decision rationale provided to MLRO/CO',
          value: input.decisionRationaleProvided,
          weight: 40,
          critical: true,
        },
        { label: 'Model card published', value: input.modelCardPublished, weight: 20 },
      ]
    )
  );

  // ── 5. Risk Assessment ────────────────────────────────────────────────────
  const aiRiskOk =
    input.aiRiskClassification === 'high' ||
    input.aiRiskClassification === 'limited' ||
    input.aiRiskClassification === 'minimal';
  const notUnacceptable = input.aiRiskClassification !== 'unacceptable';
  dimensions.push(
    scoreDimension(
      'G5',
      'Risk Assessment',
      'Identify and document all AI-specific risks before deployment',
      'MAP',
      true,
      ['NIST AI RMF MAP-2.1; EU AI Act Art.9 (High-Risk); ISO/IEC 42001 §6.1.2'],
      [
        {
          label: 'AI risk classification documented (not unacceptable)',
          value: aiRiskOk && notUnacceptable,
          weight: 25,
          critical: true,
        },
        {
          label: 'Risk register exists',
          value: input.riskRegisterExists,
          weight: 25,
          critical: true,
        },
        {
          label: 'Adversarial/red-team testing completed',
          value: input.adversarialTestingCompleted,
          weight: 25,
        },
        {
          label: 'Hallucination detection enabled',
          value: input.hallucidationDetectionEnabled,
          weight: 25,
        },
      ]
    )
  );

  // ── 6. Regulatory Compliance ──────────────────────────────────────────────
  dimensions.push(
    scoreDimension(
      'G6',
      'Regulatory Compliance',
      'Follow legal and ethical standards applicable to UAE AML/CFT AI systems',
      'GOVERN',
      true,
      ['UAE AI Ethics Principles 2019; NIST AI RMF; EU AI Act; FDL No.10/2025; ISO/IEC 42001'],
      [
        {
          label: 'UAE AI Ethics Principles aligned',
          value: input.uaeAiPrinciplesAligned,
          weight: 20,
          critical: true,
        },
        { label: 'NIST AI RMF implemented', value: input.nistAiRmfImplemented, weight: 20 },
        { label: 'EU AI Act impact assessed', value: input.euAiActAssessed, weight: 15 },
        { label: 'ISO/IEC 42001 certified/aligned', value: input.isoIec42001Certified, weight: 15 },
        {
          label: 'AML/CFT regulatory approval obtained',
          value: input.amlCftRegulatoryApproval,
          weight: 30,
          critical: true,
        },
      ]
    )
  );

  // ── 7. Accountability ─────────────────────────────────────────────────────
  dimensions.push(
    scoreDimension(
      'G7',
      'Accountability',
      'Define responsibility for AI decisions — CO/MLRO ownership required',
      'GOVERN',
      true,
      ['FDL No.10/2025 Art.20-21; NIST AI RMF GV-6.2; EU AI Act Art.17'],
      [
        {
          label: 'AI system owner designated (CO/MLRO)',
          value: input.aiSystemOwnerDesignated,
          weight: 30,
          critical: true,
        },
        {
          label: 'RACI matrix documented',
          value: input.raciMatrixDocumented,
          weight: 25,
          critical: true,
        },
        {
          label: 'Escalation path defined',
          value: input.escalationPathDefined,
          weight: 25,
          critical: true,
        },
        {
          label: 'Incident response plan exists',
          value: input.incidentResponsePlanExists,
          weight: 20,
        },
      ]
    )
  );

  // ── 8. Monitoring & Maintenance ───────────────────────────────────────────
  dimensions.push(
    scoreDimension(
      'G8',
      'Monitoring & Maintenance',
      'Plan for ongoing oversight — verdict drift and model decay detection',
      'MANAGE',
      true,
      ['NIST AI RMF MEASURE-2.7; EU AI Act Art.9(4); FDL No.10/2025 Art.24'],
      [
        {
          label: 'Model drift monitoring enabled',
          value: input.modelDriftMonitoringEnabled,
          weight: 30,
          critical: true,
        },
        {
          label: 'Performance KPIs tracked (30-KPI dashboard)',
          value: input.performanceKpisTracked,
          weight: 25,
        },
        { label: 'Retraining schedule exists', value: input.retrainingScheduleExists, weight: 25 },
        {
          label: 'Verdict drift alert configured',
          value: input.verdictDriftAlertConfigured,
          weight: 20,
        },
      ]
    )
  );

  // ── 9. Security & Privacy ─────────────────────────────────────────────────
  dimensions.push(
    scoreDimension(
      'G9',
      'Security & Privacy',
      'Protect sensitive compliance data from adversarial attacks and leakage',
      'MANAGE',
      true,
      ['NIST AI RMF MANAGE-4.2; EU AI Act Art.15; OWASP Top 10 ML 2023; UAE PDPL'],
      [
        {
          label: 'Adversarial ML defense enabled',
          value: input.adversarialMlDefenseEnabled,
          weight: 25,
          critical: true,
        },
        {
          label: 'Sensitive data masked in logs (no PII)',
          value: input.dataMaskedInLogs,
          weight: 25,
          critical: true,
        },
        {
          label: 'Rate limiting implemented (100 req/15min)',
          value: input.rateLimitingImplemented,
          weight: 20,
          critical: true,
        },
        {
          label: 'Input validation/sanitization enabled',
          value: input.inputValidationEnabled,
          weight: 15,
          critical: true,
        },
        { label: 'Penetration test completed', value: input.penTestCompleted, weight: 15 },
      ]
    )
  );

  // ── 10. Human Oversight ───────────────────────────────────────────────────
  dimensions.push(
    scoreDimension(
      'G10',
      'Human Oversight',
      'Ensure human intervention for all high-stakes compliance decisions',
      'MANAGE',
      true,
      [
        'Cabinet Res 134/2025 Art.19; EU AI Act Art.14; FDL No.10/2025 Art.20; NIST AI RMF GOVERN-5',
      ],
      [
        {
          label: 'Human-in-loop for freeze/escalate verdicts',
          value: input.humanInLoopForHighRisk,
          weight: 30,
          critical: true,
        },
        {
          label: 'Four-eyes enforced for STR/CNMR/freeze',
          value: input.fourEyesEnforced,
          weight: 30,
          critical: true,
        },
        {
          label: 'Override capability exists with audit trail',
          value: input.overrideCapabilityExists,
          weight: 20,
        },
        {
          label: 'Full audit trail enabled (FDL Art.24)',
          value: input.auditTrailEnabled,
          weight: 20,
          critical: true,
        },
      ]
    )
  );

  // ── Aggregate ─────────────────────────────────────────────────────────────
  const overallScore = Math.round(
    dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length
  );

  const readiness: GovernanceReadiness =
    overallScore >= 90
      ? 'exemplary'
      : overallScore >= 75
        ? 'compliant'
        : overallScore >= 50
          ? 'developing'
          : overallScore >= 25
            ? 'deficient'
            : 'non_compliant';

  const criticalFailures = dimensions
    .filter((d) => d.isMandatory && d.score < 50)
    .flatMap((d) => d.findings.filter((f) => f.startsWith('FAIL')));

  const deploymentApproved = readiness === 'exemplary' || readiness === 'compliant';

  const regulatoryRisk: AiGovernanceReport['regulatoryRisk'] =
    criticalFailures.length >= 5
      ? 'critical'
      : criticalFailures.length >= 3
        ? 'high'
        : criticalFailures.length >= 1
          ? 'medium'
          : 'low';

  const executiveSummary = [
    `AI Governance Assessment: ${systemName}`,
    `Overall Score: ${overallScore}/100 — ${readiness.toUpperCase()}`,
    `Deployment Approved: ${deploymentApproved ? 'YES' : 'NO — Remediation required'}`,
    `Critical Failures: ${criticalFailures.length}`,
    `Regulatory Risk: ${regulatoryRisk.toUpperCase()}`,
    deploymentApproved
      ? 'System meets AI governance requirements for UAE AML/CFT deployment.'
      : `STOP: ${criticalFailures.length} critical control(s) must be remediated before deployment.`,
  ].join('\n');

  const markdownReport = buildMarkdownReport(
    input,
    systemName,
    assessedAt,
    overallScore,
    readiness,
    deploymentApproved,
    criticalFailures,
    dimensions,
    regulatoryRisk
  );

  return {
    entityId: input.entityId,
    systemName,
    assessedAt,
    overallScore,
    readiness,
    deploymentApproved,
    criticalFailures,
    dimensions,
    executiveSummary,
    markdownReport,
    regulatoryRisk,
  };
}

// ─── Markdown Report Builder ──────────────────────────────────────────────────

function buildMarkdownReport(
  input: AiGovernanceInput,
  systemName: string,
  assessedAt: string,
  overallScore: number,
  readiness: GovernanceReadiness,
  deploymentApproved: boolean,
  criticalFailures: string[],
  dimensions: GovernanceDimension[],
  regulatoryRisk: AiGovernanceReport['regulatoryRisk']
): string {
  const statusEmoji: Record<CheckStatus, string> = {
    pass: '✅',
    partial: '🟡',
    fail: '🔴',
    not_assessed: '⚪',
  };
  const readinessEmoji: Record<GovernanceReadiness, string> = {
    exemplary: '🟢',
    compliant: '🟢',
    developing: '🟡',
    deficient: '🟠',
    non_compliant: '🔴',
  };

  const lines: string[] = [
    `# 🤖 AI Governance Checklist — ${systemName}`,
    `### *Responsible AI = Trust & Safety | Hawkeye Sterling V2*`,
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| **Entity** | ${input.entityId} |`,
    `| **System** | ${systemName} |`,
    `| **Assessed At** | ${assessedAt} |`,
    `| **Overall Score** | **${overallScore}/100** |`,
    `| **Readiness** | ${readinessEmoji[readiness]} **${readiness.toUpperCase()}** |`,
    `| **Deployment Approved** | ${deploymentApproved ? '✅ YES' : '🔴 NO — Remediation required'} |`,
    `| **Critical Failures** | ${criticalFailures.length} |`,
    `| **Regulatory Risk** | ${regulatoryRisk.toUpperCase()} |`,
    '',
    '---',
    '',
    '## Governance Dimensions',
    '',
    `| # | Dimension | Score | Status | NIST Function | Mandatory |`,
    `|---|-----------|-------|--------|---------------|-----------|`,
  ];

  for (const d of dimensions) {
    lines.push(
      `| ${d.id} | ${d.name} | ${d.score.toFixed(0)}/100 | ${statusEmoji[d.status]} ${d.status.toUpperCase()} | ${d.nistFunction} | ${d.isMandatory ? '✅' : 'No'} |`
    );
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Detailed Findings');
  lines.push('');

  for (const d of dimensions) {
    lines.push(`### ${statusEmoji[d.status]} ${d.id} — ${d.name}`);
    lines.push(`> *${d.description}*`);
    lines.push('');
    lines.push(
      `**Score:** ${d.score.toFixed(0)}/100 | **Status:** ${d.status.toUpperCase()} | **NIST:** ${d.nistFunction}`
    );
    lines.push(`**Regulatory Refs:** ${d.regulatoryRefs.join('; ')}`);
    if (d.findings.length > 0) {
      lines.push('');
      lines.push('**Findings:**');
      for (const f of d.findings) lines.push(`- ${f}`);
    }
    if (d.recommendations.length > 0) {
      lines.push('');
      lines.push('**Recommendations:**');
      for (const r of d.recommendations) lines.push(`- ${r}`);
    }
    lines.push('');
  }

  if (criticalFailures.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## 🔴 Critical Failures — Must Fix Before Deployment');
    lines.push('');
    for (const f of criticalFailures) lines.push(`- ${f}`);
    lines.push('');
  }

  lines.push('---');
  lines.push(
    '*Hawkeye Sterling V2 — AI Governance Checker | NIST AI RMF 1.0 | EU AI Act 2024 | UAE AI Ethics Principles*'
  );

  return lines.join('\n');
}
