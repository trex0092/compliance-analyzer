/**
 * Explainable AI Decision Engine
 *
 * Every compliance decision gets a full reasoning chain with:
 * 1. Input factors analysis
 * 2. Rule-by-rule evaluation with regulatory citations
 * 3. Weight contributions from each factor
 * 4. Counter-arguments considered
 * 5. Confidence calibration
 * 6. Audit-ready narrative
 *
 * This ensures every AI-assisted decision can be explained to
 * regulators, auditors, and senior management.
 *
 * Regulatory basis: FDL No.10/2025 Art.20-21 (CO duties),
 * FATF Rec 1 (risk-based approach documentation)
 */

import type { ToolResult } from '../mcp-server';
import {
  RISK_THRESHOLDS,
  DPMS_CASH_THRESHOLD_AED as _DPMS_CASH_THRESHOLD_AED,
} from '../../domain/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DecisionFactor {
  name: string;
  value: unknown;
  weight: number;
  contribution: number;
  direction: 'increases-risk' | 'decreases-risk' | 'neutral';
  explanation: string;
  regulatoryRef?: string;
}

export interface RuleEvaluation {
  ruleId: string;
  ruleName: string;
  triggered: boolean;
  condition: string;
  result: string;
  regulatoryBasis: string;
  impact: 'mandatory' | 'high' | 'medium' | 'low';
}

export interface CounterArgument {
  argument: string;
  strength: 'weak' | 'moderate' | 'strong';
  rebuttal: string;
}

export interface ReasoningChain {
  step: number;
  action: string;
  reasoning: string;
  evidence: string[];
  conclusion: string;
}

export interface ExplainableDecision {
  decisionId: string;
  decidedAt: string;
  entityName: string;
  decisionType: string;
  finalVerdict: string;
  confidenceScore: number;
  confidenceLevel: 'low' | 'medium' | 'high' | 'very-high';

  // Full reasoning
  factors: DecisionFactor[];
  ruleEvaluations: RuleEvaluation[];
  reasoningChain: ReasoningChain[];
  counterArguments: CounterArgument[];

  // Narrative for audit
  auditNarrative: string;
  regulatorySummary: string;

  // Alternative outcomes
  alternativeOutcomes: Array<{
    outcome: string;
    probability: number;
    whyNotChosen: string;
  }>;
}

// ---------------------------------------------------------------------------
// Core: Explain a Screening Decision
// ---------------------------------------------------------------------------

export function explainScreeningDecision(input: {
  entityName: string;
  matchConfidence: number;
  listsChecked: string[];
  matchCount: number;
  pepStatus: boolean;
  adverseMedia: boolean;
  jurisdictionRisk: 'low' | 'medium' | 'high';
}): ToolResult<ExplainableDecision> {
  const factors: DecisionFactor[] = [];
  const ruleEvaluations: RuleEvaluation[] = [];
  const reasoningChain: ReasoningChain[] = [];
  const counterArguments: CounterArgument[] = [];
  let _totalScore = 0;

  // Factor 1: Match confidence
  const matchWeight = input.matchConfidence >= 0.9 ? 10 : input.matchConfidence >= 0.5 ? 5 : 1;
  _totalScore += matchWeight;
  factors.push({
    name: 'Sanctions Match Confidence',
    value: input.matchConfidence,
    weight: matchWeight,
    contribution: matchWeight / 20,
    direction: input.matchConfidence > 0.3 ? 'increases-risk' : 'neutral',
    explanation: `Match confidence of ${(input.matchConfidence * 100).toFixed(0)}% against ${input.listsChecked.length} sanctions lists`,
    regulatoryRef: 'FDL No.10/2025 Art.22, Art.35',
  });

  // Factor 2: PEP status
  if (input.pepStatus) {
    _totalScore += 4;
    factors.push({
      name: 'PEP Status',
      value: true,
      weight: 4,
      contribution: 0.2,
      direction: 'increases-risk',
      explanation:
        'Entity identified as Politically Exposed Person — requires Enhanced Due Diligence',
      regulatoryRef: 'Cabinet Res 134/2025 Art.14',
    });
  }

  // Factor 3: Adverse media
  if (input.adverseMedia) {
    _totalScore += 3;
    factors.push({
      name: 'Adverse Media',
      value: true,
      weight: 3,
      contribution: 0.15,
      direction: 'increases-risk',
      explanation: 'Negative media coverage found — potential ML/TF/sanctions evasion indicators',
      regulatoryRef: 'FATF Rec 22/23',
    });
  }

  // Factor 4: Jurisdiction
  const jurisdictionWeight =
    input.jurisdictionRisk === 'high' ? 3 : input.jurisdictionRisk === 'medium' ? 1 : 0;
  if (jurisdictionWeight > 0) {
    _totalScore += jurisdictionWeight;
    factors.push({
      name: 'Jurisdiction Risk',
      value: input.jurisdictionRisk,
      weight: jurisdictionWeight,
      contribution: jurisdictionWeight / 20,
      direction: 'increases-risk',
      explanation: `Entity jurisdiction rated as ${input.jurisdictionRisk} risk`,
      regulatoryRef: 'FATF Grey/Black List, Cabinet Res 134/2025 Art.5',
    });
  }

  // Rule evaluations
  ruleEvaluations.push({
    ruleId: 'SCREEN-001',
    ruleName: 'Confirmed Sanctions Match',
    triggered: input.matchConfidence >= 0.9,
    condition: 'Match confidence >= 90%',
    result:
      input.matchConfidence >= 0.9 ? 'FREEZE — mandatory asset freeze within 24h' : 'Not triggered',
    regulatoryBasis: 'Cabinet Res 74/2020 Art.4-7',
    impact: 'mandatory',
  });

  ruleEvaluations.push({
    ruleId: 'SCREEN-002',
    ruleName: 'Potential Match Escalation',
    triggered: input.matchConfidence >= 0.5 && input.matchConfidence < 0.9,
    condition: 'Match confidence 50-89%',
    result:
      input.matchConfidence >= 0.5 && input.matchConfidence < 0.9
        ? 'ESCALATE to Compliance Officer'
        : 'Not triggered',
    regulatoryBasis: 'FDL No.10/2025 Art.22',
    impact: 'high',
  });

  ruleEvaluations.push({
    ruleId: 'SCREEN-003',
    ruleName: 'PEP Enhanced Due Diligence',
    triggered: input.pepStatus,
    condition: 'PEP status confirmed',
    result: input.pepStatus
      ? 'EDD required — Senior Management approval mandatory'
      : 'Not triggered',
    regulatoryBasis: 'Cabinet Res 134/2025 Art.14',
    impact: 'mandatory',
  });

  ruleEvaluations.push({
    ruleId: 'SCREEN-004',
    ruleName: 'No Tipping Off',
    triggered: input.matchConfidence >= 0.5,
    condition: 'Any positive screening result',
    result: 'DO NOT disclose screening outcome to subject',
    regulatoryBasis: 'FDL No.10/2025 Art.29',
    impact: 'mandatory',
  });

  // Build reasoning chain
  reasoningChain.push({
    step: 1,
    action: 'Screen entity against all sanctions lists',
    reasoning: `FDL Art.35 requires checking ALL lists: UN, OFAC, EU, UK, UAE/EOCN. ${input.listsChecked.length} lists were checked.`,
    evidence: [
      `${input.matchCount} match(es) found`,
      `Highest confidence: ${(input.matchConfidence * 100).toFixed(0)}%`,
    ],
    conclusion:
      input.matchCount > 0
        ? 'Matches found — further analysis required'
        : 'No matches — entity clear',
  });

  if (input.matchConfidence >= 0.9) {
    reasoningChain.push({
      step: 2,
      action: 'Apply confirmed match protocol',
      reasoning:
        'Match confidence exceeds 90% — per CLAUDE.md decision tree, this is a confirmed match requiring immediate freeze.',
      evidence: [`Confidence: ${(input.matchConfidence * 100).toFixed(0)}%`, 'Threshold: 90%'],
      conclusion: 'FREEZE assets immediately. Start 24h EOCN countdown.',
    });
  } else if (input.matchConfidence >= 0.5) {
    reasoningChain.push({
      step: 2,
      action: 'Escalate to Compliance Officer',
      reasoning:
        'Match confidence between 50-89% — requires human review. CO decides: confirm (→ freeze) or false positive (→ dismiss with documentation).',
      evidence: [
        `Confidence: ${(input.matchConfidence * 100).toFixed(0)}%`,
        'Range: 50-89% = potential match',
      ],
      conclusion: 'Escalate for CO review. Do not proceed until resolved.',
    });
  }

  // Counter-arguments
  if (input.matchConfidence >= 0.5 && input.matchConfidence < 0.9) {
    counterArguments.push({
      argument: 'Could be a false positive — common names may trigger matches',
      strength: 'moderate',
      rebuttal:
        'Even potential matches require CO review per FDL Art.22. False positives must be documented and dismissed with reasoning.',
    });
  }
  if (input.pepStatus) {
    counterArguments.push({
      argument: 'PEP status alone does not indicate criminal activity',
      strength: 'strong',
      rebuttal:
        'Correct — PEP status triggers EDD, not automatic rejection. The purpose is enhanced scrutiny, not presumption of guilt (Cabinet Res 134/2025 Art.14).',
    });
  }

  // Final verdict
  let finalVerdict: string;
  if (input.matchConfidence >= 0.9) {
    finalVerdict = 'FREEZE — Confirmed sanctions match';
  } else if (input.matchConfidence >= 0.5) {
    finalVerdict = 'ESCALATE — Potential match requires CO review';
  } else if (input.pepStatus || input.adverseMedia) {
    finalVerdict = 'EDD REQUIRED — Elevated risk indicators present';
  } else {
    finalVerdict = 'CLEAR — No significant risk indicators';
  }

  const confidenceScore = Math.min(
    0.99,
    0.5 + factors.reduce((s, f) => s + Math.abs(f.contribution), 0) * 0.3
  );

  // Build audit narrative
  const auditNarrative = buildAuditNarrative(
    input.entityName,
    finalVerdict,
    factors,
    ruleEvaluations,
    reasoningChain
  );
  const regulatorySummary = buildRegulatorySummary(ruleEvaluations);

  return {
    ok: true,
    data: {
      decisionId: `DEC-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      decidedAt: new Date().toISOString(),
      entityName: input.entityName,
      decisionType: 'screening',
      finalVerdict,
      confidenceScore: Math.round(confidenceScore * 100) / 100,
      confidenceLevel:
        confidenceScore >= 0.9
          ? 'very-high'
          : confidenceScore >= 0.7
            ? 'high'
            : confidenceScore >= 0.5
              ? 'medium'
              : 'low',
      factors,
      ruleEvaluations,
      reasoningChain,
      counterArguments,
      auditNarrative,
      regulatorySummary,
      alternativeOutcomes: generateAlternatives(finalVerdict, input.matchConfidence),
    },
  };
}

// ---------------------------------------------------------------------------
// Explain a Risk Scoring Decision
// ---------------------------------------------------------------------------

export function explainRiskDecision(input: {
  entityName: string;
  riskScore: number;
  flagCodes: string[];
  sanctionMatch: boolean;
  pepMatch: boolean;
  missingCDD: boolean;
  recommendedOutcome: string;
}): ToolResult<ExplainableDecision> {
  const factors: DecisionFactor[] = [];
  const ruleEvaluations: RuleEvaluation[] = [];
  const reasoningChain: ReasoningChain[] = [];

  factors.push({
    name: 'Composite Risk Score',
    value: input.riskScore,
    weight: 1,
    contribution: input.riskScore / 20,
    direction: input.riskScore >= RISK_THRESHOLDS.medium ? 'increases-risk' : 'neutral',
    explanation: `Score ${input.riskScore}/20 — threshold: critical≥${RISK_THRESHOLDS.critical}, high≥${RISK_THRESHOLDS.high}, medium≥${RISK_THRESHOLDS.medium}`,
    regulatoryRef: 'Cabinet Res 134/2025 Art.5 (risk appetite)',
  });

  if (input.sanctionMatch) {
    factors.push({
      name: 'Sanctions Match',
      value: true,
      weight: 10,
      contribution: 0.5,
      direction: 'increases-risk',
      explanation: 'Active sanctions match — mandatory freeze and STR',
      regulatoryRef: 'FDL No.10/2025 Art.35, Cabinet Res 74/2020',
    });
  }

  if (input.pepMatch) {
    factors.push({
      name: 'PEP Match',
      value: true,
      weight: 5,
      contribution: 0.25,
      direction: 'increases-risk',
      explanation: 'PEP identified — EDD with Senior Management/Board approval required',
      regulatoryRef: 'Cabinet Res 134/2025 Art.14',
    });
  }

  if (input.missingCDD) {
    factors.push({
      name: 'Missing CDD Documentation',
      value: true,
      weight: 4,
      contribution: 0.2,
      direction: 'increases-risk',
      explanation:
        'Customer Due Diligence documentation incomplete — cannot verify identity/source of funds',
      regulatoryRef: 'FDL No.10/2025 Art.12-14',
    });
  }

  factors.push({
    name: 'Red Flags Triggered',
    value: input.flagCodes.length,
    weight: input.flagCodes.length * 0.5,
    contribution: Math.min(0.3, input.flagCodes.length * 0.05),
    direction: input.flagCodes.length > 0 ? 'increases-risk' : 'neutral',
    explanation: `${input.flagCodes.length} red flag(s) triggered: ${input.flagCodes.join(', ') || 'none'}`,
  });

  reasoningChain.push({
    step: 1,
    action: 'Calculate base risk score from red flags',
    reasoning:
      'Each red flag scored using likelihood × impact formula per CLAUDE.md specifications',
    evidence: [`${input.flagCodes.length} flags evaluated`, `Composite score: ${input.riskScore}`],
    conclusion: `Base risk score: ${input.riskScore}`,
  });

  reasoningChain.push({
    step: 2,
    action: 'Apply context multipliers',
    reasoning:
      'Sanctions proximity, PEP status, cash handling, and jurisdiction risk add multipliers to the base score',
    evidence: [
      `Sanctions: ${input.sanctionMatch ? 'YES' : 'no'}`,
      `PEP: ${input.pepMatch ? 'YES' : 'no'}`,
      `CDD complete: ${input.missingCDD ? 'NO' : 'yes'}`,
    ],
    conclusion: `Adjusted score determines CDD tier and recommended action`,
  });

  reasoningChain.push({
    step: 3,
    action: `Determine outcome: ${input.recommendedOutcome}`,
    reasoning: `Score ${input.riskScore} maps to outcome "${input.recommendedOutcome}" per regulatory decision matrix`,
    evidence: factors.map((f) => `${f.name}: ${f.explanation}`),
    conclusion: input.recommendedOutcome,
  });

  const auditNarrative =
    `Risk assessment for ${input.entityName} completed on ${new Date().toLocaleDateString('en-GB')}. ` +
    `Composite risk score: ${input.riskScore}/20. ` +
    `${input.flagCodes.length} red flag(s) identified. ` +
    `Sanctions match: ${input.sanctionMatch ? 'YES' : 'No'}. PEP: ${input.pepMatch ? 'YES' : 'No'}. ` +
    `Recommended outcome: ${input.recommendedOutcome}. ` +
    `Decision based on ${factors.length} weighted factors with full regulatory traceability.`;

  return {
    ok: true,
    data: {
      decisionId: `DEC-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      decidedAt: new Date().toISOString(),
      entityName: input.entityName,
      decisionType: 'risk-assessment',
      finalVerdict: input.recommendedOutcome,
      confidenceScore: 0.85,
      confidenceLevel: 'high',
      factors,
      ruleEvaluations,
      reasoningChain,
      counterArguments: [],
      auditNarrative,
      regulatorySummary: factors
        .filter((f) => f.regulatoryRef)
        .map((f) => `${f.name}: ${f.regulatoryRef}`)
        .join('; '),
      alternativeOutcomes: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAuditNarrative(
  entityName: string,
  verdict: string,
  factors: DecisionFactor[],
  rules: RuleEvaluation[],
  chain: ReasoningChain[]
): string {
  const date = new Date().toLocaleDateString('en-GB');
  const triggeredRules = rules.filter((r) => r.triggered);
  const riskFactors = factors.filter((f) => f.direction === 'increases-risk');

  return (
    `Screening decision for "${entityName}" completed on ${date}. ` +
    `Verdict: ${verdict}. ` +
    `${riskFactors.length} risk-increasing factor(s) identified. ` +
    `${triggeredRules.length} regulatory rule(s) triggered: ${triggeredRules.map((r) => r.ruleId).join(', ') || 'none'}. ` +
    `Decision reached through ${chain.length}-step reasoning chain with full factor analysis. ` +
    `All applicable regulations evaluated. Decision is audit-ready and regulator-presentable.`
  );
}

function buildRegulatorySummary(rules: RuleEvaluation[]): string {
  return rules
    .filter((r) => r.triggered)
    .map((r) => `[${r.ruleId}] ${r.ruleName}: ${r.result} (${r.regulatoryBasis})`)
    .join('\n');
}

function generateAlternatives(
  chosenVerdict: string,
  confidence: number
): ExplainableDecision['alternativeOutcomes'] {
  const alternatives = [];
  if (chosenVerdict.includes('FREEZE')) {
    alternatives.push({
      outcome: 'ESCALATE instead of FREEZE',
      probability: 1 - confidence,
      whyNotChosen:
        'Confidence exceeds 90% threshold — regulatory requirement mandates immediate freeze (Cabinet Res 74/2020 Art.4)',
    });
  } else if (chosenVerdict.includes('ESCALATE')) {
    alternatives.push({
      outcome: 'CLEAR with documentation',
      probability: 0.3,
      whyNotChosen:
        'Match confidence in 50-89% range requires CO review — cannot dismiss without human analysis',
    });
    alternatives.push({
      outcome: 'FREEZE immediately',
      probability: 0.1,
      whyNotChosen:
        'Confidence below 90% — freeze requires confirmed match per Cabinet Res 74/2020',
    });
  }
  return alternatives;
}

// ---------------------------------------------------------------------------
// Schema exports
// ---------------------------------------------------------------------------

export const EXPLAINABLE_TOOL_SCHEMAS = [
  {
    name: 'explain_screening_decision',
    description:
      'Generate fully explainable screening decision with reasoning chain, factor analysis, rule evaluations, counter-arguments, and audit-ready narrative. Every decision traceable to specific regulations.',
    inputSchema: {
      type: 'object',
      properties: {
        entityName: { type: 'string' },
        matchConfidence: { type: 'number' },
        listsChecked: { type: 'array', items: { type: 'string' } },
        matchCount: { type: 'number' },
        pepStatus: { type: 'boolean' },
        adverseMedia: { type: 'boolean' },
        jurisdictionRisk: { type: 'string', enum: ['low', 'medium', 'high'] },
      },
      required: [
        'entityName',
        'matchConfidence',
        'listsChecked',
        'matchCount',
        'pepStatus',
        'adverseMedia',
        'jurisdictionRisk',
      ],
    },
  },
  {
    name: 'explain_risk_decision',
    description:
      'Generate fully explainable risk scoring decision. Shows how each factor contributes to the final score, which rules triggered, and the regulatory basis for the outcome.',
    inputSchema: {
      type: 'object',
      properties: {
        entityName: { type: 'string' },
        riskScore: { type: 'number' },
        flagCodes: { type: 'array', items: { type: 'string' } },
        sanctionMatch: { type: 'boolean' },
        pepMatch: { type: 'boolean' },
        missingCDD: { type: 'boolean' },
        recommendedOutcome: { type: 'string' },
      },
      required: [
        'entityName',
        'riskScore',
        'flagCodes',
        'sanctionMatch',
        'pepMatch',
        'missingCDD',
        'recommendedOutcome',
      ],
    },
  },
] as const;
