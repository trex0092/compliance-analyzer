/**
 * Multi-Model Compliance Screening Engine
 *
 * Races multiple LLMs (via OpenRouter) in parallel to get consensus-based
 * opinions on sanctions matches, PEP identification, and risk assessments.
 *
 * Inspired by G0DM0D3's ULTRAPLINIAN model-racing pattern:
 * - Queries N models simultaneously
 * - Scores and aggregates responses
 * - Returns consensus with confidence metrics
 *
 * Regulatory refs:
 * - FDL No.10/2025 Art.12-14 (CDD), Art.26-27 (STR)
 * - Cabinet Res 134/2025 Art.7-10 (CDD tiers), Art.14 (PEP/EDD)
 * - FATF Rec 22/23 (DPMS sector)
 */

import { RISK_THRESHOLDS } from '../domain/constants';
import type { ScreeningRun } from '../domain/screening';
import type { SanctionsMatch } from './sanctionsApi';

// ─── Configuration ─────────────────────────────────────────────────────────

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Models used for compliance screening — diverse providers reduce single-model bias */
const SCREENING_MODELS = [
  'anthropic/claude-sonnet-4-20250514',
  'openai/gpt-4o',
  'google/gemini-2.5-pro-preview',
  'mistralai/mistral-large-2411',
  'deepseek/deepseek-chat',
] as const;

/** Minimum models that must respond before we accept a consensus */
const MIN_RESPONSES = 3;

/** Hard timeout for the entire race (ms) */
const RACE_TIMEOUT_MS = 30_000;

/** Grace period after MIN_RESPONSES reached — wait for stragglers (ms) */
const GRACE_PERIOD_MS = 5_000;

// ─── Types ─────────────────────────────────────────────────────────────────

export type ScreeningType = 'sanctions' | 'pep' | 'risk-assessment' | 'adverse-media';

export interface MultiModelScreeningRequest {
  entityName: string;
  entityType: 'individual' | 'entity';
  nationality?: string;
  dateOfBirth?: string;
  additionalContext?: string;
  screeningType: ScreeningType;
  /** Existing fuzzy-match results from sanctionsApi to augment with AI analysis */
  existingMatches?: SanctionsMatch[];
}

export interface ModelOpinion {
  model: string;
  verdict: 'clear' | 'potential-match' | 'confirmed-match';
  confidence: number;
  reasoning: string;
  riskIndicators: string[];
  responseTimeMs: number;
}

export interface ConsensusResult {
  entityName: string;
  screeningType: ScreeningType;
  consensus: 'clear' | 'potential-match' | 'confirmed-match';
  consensusConfidence: number;
  agreementRatio: number;
  opinions: ModelOpinion[];
  modelsQueried: number;
  modelsResponded: number;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  topRiskIndicators: string[];
  recommendedAction: string;
  executedAt: string;
  totalDurationMs: number;
}

// ─── System Prompts ────────────────────────────────────────────────────────

function buildSystemPrompt(screeningType: ScreeningType): string {
  const base = `You are a UAE AML/CFT compliance screening analyst. You must provide objective, evidence-based assessments. Follow UAE FDL No.10/2025 and FATF Recommendations.

CRITICAL RULES:
- Never fabricate matches. If unsure, say "potential-match" not "confirmed-match".
- Always provide specific reasoning citing regulatory references.
- Err on the side of caution — false negatives are worse than false positives.
- Do NOT provide legal advice. You are a screening tool, not a lawyer.

Respond ONLY with valid JSON matching this schema:
{
  "verdict": "clear" | "potential-match" | "confirmed-match",
  "confidence": 0.0-1.0,
  "reasoning": "string explaining your assessment",
  "riskIndicators": ["array", "of", "specific", "risk", "factors"]
}`;

  const typeSpecific: Record<ScreeningType, string> = {
    sanctions: `\n\nFOCUS: Sanctions screening. Check against known UN, OFAC, EU, UK, UAE, and EOCN sanctions patterns. Consider name variations, transliterations, aliases. A "confirmed-match" means high certainty the entity IS on a sanctions list. A "potential-match" means the name or profile resembles a listed entity but requires human review.`,

    pep: `\n\nFOCUS: Politically Exposed Person (PEP) identification per Cabinet Res 134/2025 Art.14. Consider: current/former heads of state, senior government officials, senior military officers, judiciary, state enterprise executives, political party leaders, and their family members and close associates. PEP status requires Enhanced Due Diligence (EDD) plus Senior Management/Board approval.`,

    'risk-assessment': `\n\nFOCUS: Customer risk assessment per FDL Art.12-14 and Cabinet Res 134/2025 Art.7-10. Evaluate: jurisdiction risk, business type, transaction patterns, source of funds/wealth plausibility, adverse media, PEP nexus, sanctions proximity. Score risk as: clear (low risk), potential-match (medium/high risk requiring enhanced monitoring), confirmed-match (unacceptable risk — recommend rejection/exit).`,

    'adverse-media': `\n\nFOCUS: Adverse media screening. Look for indicators of: money laundering, terrorism financing, fraud, corruption, sanctions evasion, tax evasion, organized crime, environmental crime. Consider the reliability of sources and recency of information.`,
  };

  return base + typeSpecific[screeningType];
}

function buildUserPrompt(request: MultiModelScreeningRequest): string {
  let prompt = `Screen the following entity:\n\nName: ${request.entityName}\nType: ${request.entityType}`;

  if (request.nationality) prompt += `\nNationality: ${request.nationality}`;
  if (request.dateOfBirth) prompt += `\nDate of Birth: ${request.dateOfBirth}`;
  if (request.additionalContext) prompt += `\nAdditional Context: ${request.additionalContext}`;

  if (request.existingMatches && request.existingMatches.length > 0) {
    prompt += `\n\nExisting fuzzy-match results from sanctions databases:\n`;
    for (const match of request.existingMatches) {
      prompt += `- ${match.matchedName} (${match.listSource}, confidence: ${match.confidence})\n`;
    }
    prompt += `\nConsider these matches in your assessment. Validate or refute them.`;
  }

  return prompt;
}

// ─── Model Racing Engine ───────────────────────────────────────────────────

async function queryModel(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  apiKey: string
): Promise<ModelOpinion> {
  const startTime = Date.now();

  const response = await fetch(OPENROUTER_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://hawkeye-sterling.app',
      'X-Title': 'Hawkeye Sterling Compliance Screening',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 1024,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(RACE_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`${model} returned ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? '';
  const elapsed = Date.now() - startTime;

  const parsed = parseModelResponse(content, model);
  return { ...parsed, model, responseTimeMs: elapsed };
}

function parseModelResponse(
  content: string,
  model: string
): Omit<ModelOpinion, 'model' | 'responseTimeMs'> {
  try {
    const json = JSON.parse(content);
    const validVerdicts = ['clear', 'potential-match', 'confirmed-match'] as const;
    const verdict = validVerdicts.includes(json.verdict) ? json.verdict : 'potential-match';
    const confidence =
      typeof json.confidence === 'number' ? Math.max(0, Math.min(1, json.confidence)) : 0.5;

    return {
      verdict,
      confidence,
      reasoning: String(json.reasoning || 'No reasoning provided'),
      riskIndicators: Array.isArray(json.riskIndicators) ? json.riskIndicators.map(String) : [],
    };
  } catch {
    return {
      verdict: 'potential-match',
      confidence: 0.3,
      reasoning: `Failed to parse response from ${model}. Flagging for manual review.`,
      riskIndicators: ['parse-failure'],
    };
  }
}

/**
 * Race multiple models in parallel with early-exit grace period.
 * Adapted from G0DM0D3's ULTRAPLINIAN racing pattern.
 */
async function raceModels(
  request: MultiModelScreeningRequest,
  apiKey: string,
  models: readonly string[] = SCREENING_MODELS
): Promise<ModelOpinion[]> {
  const systemPrompt = buildSystemPrompt(request.screeningType);
  const userPrompt = buildUserPrompt(request);

  const opinions: ModelOpinion[] = [];
  let graceTimeout: ReturnType<typeof setTimeout> | null = null;

  return new Promise<ModelOpinion[]>((resolve) => {
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      if (graceTimeout) clearTimeout(graceTimeout);
      resolve(opinions);
    };

    // Hard timeout
    const hardTimeout = setTimeout(finish, RACE_TIMEOUT_MS);

    // Launch all models in parallel
    const promises = models.map(async (model) => {
      try {
        const opinion = await queryModel(model, systemPrompt, userPrompt, apiKey);
        opinions.push(opinion);

        // Start grace period once we have enough responses
        if (opinions.length >= MIN_RESPONSES && !graceTimeout) {
          graceTimeout = setTimeout(finish, GRACE_PERIOD_MS);
        }

        // If all models responded, finish immediately
        if (opinions.length === models.length) {
          finish();
        }
      } catch {
        // Model failed — continue with others
      }
    });

    // Safety: resolve when all promises settle (success or failure)
    Promise.allSettled(promises).then(() => {
      clearTimeout(hardTimeout);
      finish();
    });
  });
}

// ─── Consensus Aggregation ─────────────────────────────────────────────────

const VERDICT_SEVERITY: Record<string, number> = {
  clear: 0,
  'potential-match': 1,
  'confirmed-match': 2,
};

function aggregateConsensus(opinions: ModelOpinion[]): {
  consensus: 'clear' | 'potential-match' | 'confirmed-match';
  consensusConfidence: number;
  agreementRatio: number;
} {
  if (opinions.length === 0) {
    return { consensus: 'potential-match', consensusConfidence: 0, agreementRatio: 0 };
  }

  // Count verdicts weighted by confidence
  const verdictScores: Record<string, number> = {
    clear: 0,
    'potential-match': 0,
    'confirmed-match': 0,
  };

  for (const op of opinions) {
    verdictScores[op.verdict] += op.confidence;
  }

  // Safety-first: if ANY model says confirmed-match with high confidence, escalate
  const confirmedHighConf = opinions.filter(
    (o) => o.verdict === 'confirmed-match' && o.confidence >= 0.8
  );
  if (confirmedHighConf.length > 0) {
    const avgConf =
      confirmedHighConf.reduce((s, o) => s + o.confidence, 0) / confirmedHighConf.length;
    return {
      consensus: 'confirmed-match',
      consensusConfidence: avgConf,
      agreementRatio: confirmedHighConf.length / opinions.length,
    };
  }

  // Find the majority verdict (by weighted score)
  const sorted = Object.entries(verdictScores).sort((a, b) => b[1] - a[1]);
  const topVerdict = sorted[0][0] as 'clear' | 'potential-match' | 'confirmed-match';

  // Count how many models agree with the top verdict
  const agreeing = opinions.filter((o) => o.verdict === topVerdict);
  const agreementRatio = agreeing.length / opinions.length;

  // Average confidence of agreeing models
  const avgConfidence = agreeing.reduce((s, o) => s + o.confidence, 0) / agreeing.length;

  // If low agreement, bump up to potential-match for safety
  const consensus = agreementRatio < 0.5 && topVerdict === 'clear' ? 'potential-match' : topVerdict;

  return {
    consensus,
    consensusConfidence: Math.round(avgConfidence * 100) / 100,
    agreementRatio: Math.round(agreementRatio * 100) / 100,
  };
}

function computeRiskScore(opinions: ModelOpinion[]): number {
  if (opinions.length === 0) return 0;

  // Weighted average: verdict severity × confidence
  const total = opinions.reduce((sum, op) => {
    const severityWeight = VERDICT_SEVERITY[op.verdict] ?? 1;
    return sum + severityWeight * op.confidence * 10;
  }, 0);

  return Math.round(total / opinions.length);
}

function scoreToLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= RISK_THRESHOLDS.critical) return 'critical';
  if (score >= RISK_THRESHOLDS.high) return 'high';
  if (score >= RISK_THRESHOLDS.medium) return 'medium';
  return 'low';
}

function getTopRiskIndicators(opinions: ModelOpinion[], limit = 5): string[] {
  const counts = new Map<string, number>();
  for (const op of opinions) {
    for (const indicator of op.riskIndicators) {
      counts.set(indicator, (counts.get(indicator) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([indicator]) => indicator);
}

function recommendAction(
  consensus: 'clear' | 'potential-match' | 'confirmed-match',
  riskLevel: 'low' | 'medium' | 'high' | 'critical',
  screeningType: ScreeningType
): string {
  if (consensus === 'confirmed-match') {
    if (screeningType === 'sanctions') {
      return 'FREEZE IMMEDIATELY without delay (EOCN TFS Guidance 2025). File CNMR within 5 business days. Report to EOCN and Supervisory Authority. DO NOT notify the subject (Art.29 no tipping off).';
    }
    if (screeningType === 'pep') {
      return 'Apply EDD. Require Senior Management/Board approval (Cabinet Res 134/2025 Art.14). Set 3-month review cycle.';
    }
    return 'Escalate to Compliance Officer. Open case for full investigation. Apply EDD.';
  }

  if (consensus === 'potential-match') {
    return 'Escalate to Compliance Officer for manual review. Document analysis. CO decides: confirm → act per confirmed-match path, or false positive → document reasoning and dismiss.';
  }

  if (riskLevel === 'low') {
    return 'Standard CDD. Log screening result. Next review per standard cycle.';
  }

  return 'Clear with enhanced monitoring. Schedule next review based on risk rating.';
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Run multi-model compliance screening.
 *
 * Queries multiple LLMs in parallel via OpenRouter, aggregates their
 * opinions using consensus scoring, and returns an actionable result.
 *
 * @param request - The screening request details
 * @param apiKey - OpenRouter API key (from env: OPENROUTER_API_KEY)
 * @param models - Optional model list override (defaults to SCREENING_MODELS)
 * @returns ConsensusResult with verdict, confidence, risk score, and recommended action
 */
export async function runMultiModelScreening(
  request: MultiModelScreeningRequest,
  apiKey: string,
  models?: readonly string[]
): Promise<ConsensusResult> {
  const startTime = Date.now();
  const modelsToUse = models ?? SCREENING_MODELS;

  const opinions = await raceModels(request, apiKey, modelsToUse);
  const { consensus, consensusConfidence, agreementRatio } = aggregateConsensus(opinions);
  const riskScore = computeRiskScore(opinions);
  const riskLevel = scoreToLevel(riskScore);
  const topRiskIndicators = getTopRiskIndicators(opinions);
  const recommendedAction = recommendAction(consensus, riskLevel, request.screeningType);

  return {
    entityName: request.entityName,
    screeningType: request.screeningType,
    consensus,
    consensusConfidence,
    agreementRatio,
    opinions,
    modelsQueried: modelsToUse.length,
    modelsResponded: opinions.length,
    riskScore,
    riskLevel,
    topRiskIndicators,
    recommendedAction,
    executedAt: new Date().toISOString(),
    totalDurationMs: Date.now() - startTime,
  };
}

/**
 * Convert a ConsensusResult to a ScreeningRun for audit trail storage.
 */
export function consensusToScreeningRun(
  result: ConsensusResult,
  subjectId: string,
  analyst: string
): ScreeningRun {
  return {
    id: `MMS-${Date.now()}`,
    subjectType: 'entity',
    subjectId,
    executedAt: result.executedAt,
    systemUsed: `Multi-Model Screening (${result.modelsResponded}/${result.modelsQueried} models)`,
    listsChecked: result.opinions.map((o) => o.model),
    result: result.consensus,
    falsePositiveResolution:
      result.consensus === 'clear'
        ? `Consensus clear (${result.agreementRatio * 100}% agreement, ${result.consensusConfidence} confidence)`
        : undefined,
    analyst,
  };
}
