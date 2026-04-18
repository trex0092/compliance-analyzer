/**
 * Gemini Compliance Analyzer
 *
 * Uses Google Gemini AI to analyze UAE precious metals regulation text
 * for compliance issues, errors, and gaps.
 *
 * Security:
 *   - API key from environment variable (GOOGLE_AI_API_KEY), never hardcoded
 *   - Input validation and sanitization before processing
 *   - Rate limiting via call tracking
 *   - Structured output parsing with fallback
 *   - Full audit trail for every analysis
 *
 * Regulatory refs:
 *   - FDL No.10/2025 Art.12-14 (CDD), Art.24 (record retention)
 *   - MoE Circular 08/AML/2021 (DPMS sector guidance)
 *   - LBMA RGG v9 (responsible gold guidance)
 *   - UAE MoE RSG Framework (responsible sourcing)
 */

import {
  DPMS_CASH_THRESHOLD_AED,
  CROSS_BORDER_CASH_THRESHOLD_AED,
  UBO_OWNERSHIP_THRESHOLD_PCT,
  RECORD_RETENTION_YEARS,
} from '../domain/constants';
import { fetchWithTimeout, TimeoutError } from '../utils/fetchWithTimeout';

// ─── Configuration ──────────────────────────────────────────────────────────

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_INPUT_LENGTH = 50_000;
const REQUEST_TIMEOUT_MS = 60_000;

/** Rate limit: max requests per window */
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ComplianceAnalysisRequest {
  text: string;
  analysisType: AnalysisType;
  /** Optional entity context for more targeted analysis */
  entityName?: string;
  /** Optional jurisdiction override (defaults to UAE) */
  jurisdiction?: string;
}

export type AnalysisType =
  | 'regulation-review'
  | 'policy-gap-analysis'
  | 'transaction-review'
  | 'cdd-assessment';

export interface ComplianceIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  description: string;
  regulatoryRef: string;
  recommendation: string;
}

export interface ComplianceAnalysisResult {
  analysisId: string;
  analysisType: AnalysisType;
  executedAt: string;
  model: string;
  issues: ComplianceIssue[];
  summary: string;
  overallRiskLevel: 'low' | 'medium' | 'high' | 'critical';
  regulatoryReferences: string[];
  responseTimeMs: number;
}

export interface AuditEntry {
  analysisId: string;
  timestamp: string;
  action: string;
  user: string;
  inputLengthChars: number;
  analysisType: AnalysisType;
  resultSummary: string;
  issueCount: number;
  overallRiskLevel: string;
}

// ─── Rate Limiter ───────────────────────────────────────────────────────────

const requestTimestamps: number[] = [];

function checkRateLimit(): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  // Purge expired timestamps
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - RATE_LIMIT_WINDOW_MS) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= RATE_LIMIT_MAX) {
    const oldestInWindow = requestTimestamps[0];
    const retryAfterMs = oldestInWindow + RATE_LIMIT_WINDOW_MS - now;
    return { allowed: false, retryAfterMs };
  }
  requestTimestamps.push(now);
  return { allowed: true };
}

/** Reset rate limiter state — exposed for testing only */
export function _resetRateLimit(): void {
  requestTimestamps.length = 0;
}

// ─── Input Validation ───────────────────────────────────────────────────────

function validateInput(request: ComplianceAnalysisRequest): string | null {
  if (!request.text || typeof request.text !== 'string') {
    return 'Input text is required and must be a string';
  }
  if (request.text.trim().length === 0) {
    return 'Input text must not be empty';
  }
  if (request.text.length > MAX_INPUT_LENGTH) {
    return `Input text exceeds maximum length of ${MAX_INPUT_LENGTH} characters`;
  }
  const validTypes: AnalysisType[] = [
    'regulation-review',
    'policy-gap-analysis',
    'transaction-review',
    'cdd-assessment',
  ];
  if (!validTypes.includes(request.analysisType)) {
    return `Invalid analysis type. Must be one of: ${validTypes.join(', ')}`;
  }
  if (request.entityName && request.entityName.length > 500) {
    return 'Entity name must not exceed 500 characters';
  }
  return null;
}

/** Sanitize text to prevent prompt injection via control characters */
function sanitizeText(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // strip control chars (keep \n, \r, \t)
      .trim()
  );
}

// ─── System Prompts ─────────────────────────────────────────────────────────

function buildSystemPrompt(analysisType: AnalysisType): string {
  const base = `You are a UAE AML/CFT/CPF compliance analyst specializing in the precious metals and stones (DPMS) sector. Analyze the provided text for regulatory compliance issues.

CRITICAL RULES:
- Base all findings on actual UAE regulations (FDL No.10/2025, Cabinet Res 134/2025, MoE Circular 08/AML/2021, LBMA RGG v9).
- Cite specific articles and regulations for every finding.
- Do NOT fabricate or assume issues that are not evidenced in the text.
- Use dd/mm/yyyy date format for UAE compliance documents.
- Currency references must use AED as primary.
- Key thresholds: DPMS cash reporting AED ${DPMS_CASH_THRESHOLD_AED.toLocaleString()}, cross-border declaration AED ${CROSS_BORDER_CASH_THRESHOLD_AED.toLocaleString()}, UBO ${(UBO_OWNERSHIP_THRESHOLD_PCT * 100).toFixed(0)}%, record retention ${RECORD_RETENTION_YEARS} years.

Respond ONLY with valid JSON matching this schema:
{
  "issues": [
    {
      "severity": "critical" | "high" | "medium" | "low",
      "category": "string (e.g., CDD, STR, Sanctions, Record Keeping, Threshold)",
      "description": "string describing the issue",
      "regulatoryRef": "string citing specific law/article",
      "recommendation": "string with actionable fix"
    }
  ],
  "summary": "string — brief overall assessment",
  "overallRiskLevel": "low" | "medium" | "high" | "critical",
  "regulatoryReferences": ["array of all cited regulations"]
}`;

  const typeSpecific: Record<AnalysisType, string> = {
    'regulation-review': `\n\nFOCUS: Review regulation/policy text for errors, omissions, outdated references, and conflicts with current UAE AML/CFT/CPF law. Check that all thresholds match current legislation. Verify sanctions list references include ALL required lists (UN, OFAC, EU, UK, UAE, EOCN).`,

    'policy-gap-analysis': `\n\nFOCUS: Identify gaps in the provided compliance policy. Check for missing requirements per FDL No.10/2025 and Cabinet Res 134/2025. Verify CDD tiers (SDD/CDD/EDD) are properly defined, PEP procedures exist, STR workflow includes no-tipping-off provisions, TFS procedures meet 24-hour freeze deadline.`,

    'transaction-review': `\n\nFOCUS: Analyze transaction descriptions for compliance red flags. Check against DPMS cash threshold (AED ${DPMS_CASH_THRESHOLD_AED.toLocaleString()}), structuring patterns, round-tripping indicators, dormancy reactivation signals, and source-of-funds documentation requirements.`,

    'cdd-assessment': `\n\nFOCUS: Evaluate CDD documentation and procedures. Verify tiered approach per Cabinet Res 134/2025 Art.7-10: SDD for low-risk (score <6), CDD for standard (6-15), EDD for high-risk (>=16). Check PEP handling (Art.14), UBO identification (>25%), and ongoing monitoring frequency.`,
  };

  return base + typeSpecific[analysisType];
}

// ─── API Key Resolution ─────────────────────────────────────────────────────

function getApiKey(): string {
  const key = typeof process !== 'undefined' ? process.env.GOOGLE_AI_API_KEY : undefined;
  if (!key) {
    throw new Error(
      'GOOGLE_AI_API_KEY environment variable is not set. ' +
        'Configure it in your .env file. See .env.example for reference.'
    );
  }
  return key;
}

// ─── Audit Trail ────────────────────────────────────────────────────────────

const AUDIT_STORAGE_KEY = 'fgl_gemini_analysis_audit';

function logAuditEntry(entry: AuditEntry): void {
  try {
    const stored = localStorage.getItem(AUDIT_STORAGE_KEY);
    const entries: AuditEntry[] = stored ? JSON.parse(stored) : [];
    entries.push(entry);
    // Keep last 500 entries
    if (entries.length > 500) entries.splice(0, entries.length - 500);
    localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage unavailable (e.g., server-side) — log to console
    // eslint-disable-next-line no-console
    console.warn('[GeminiAnalyzer] Audit storage unavailable:', JSON.stringify(entry));
  }
}

export function getAuditTrail(): AuditEntry[] {
  try {
    const stored = localStorage.getItem(AUDIT_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

// ─── Core Analysis ──────────────────────────────────────────────────────────

function generateAnalysisId(): string {
  return `GCA-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseAnalysisResponse(
  content: string
): Omit<
  ComplianceAnalysisResult,
  'analysisId' | 'analysisType' | 'executedAt' | 'model' | 'responseTimeMs'
> {
  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] ?? jsonMatch[0]) : content;
    const parsed = JSON.parse(jsonStr);

    return {
      issues: Array.isArray(parsed.issues)
        ? parsed.issues.map((issue: Record<string, unknown>) => ({
            severity: ['critical', 'high', 'medium', 'low'].includes(issue.severity as string)
              ? (issue.severity as ComplianceIssue['severity'])
              : 'medium',
            category: String(issue.category ?? 'General'),
            description: String(issue.description ?? ''),
            regulatoryRef: String(issue.regulatoryRef ?? 'Not specified'),
            recommendation: String(issue.recommendation ?? ''),
          }))
        : [],
      summary: String(parsed.summary ?? 'Analysis complete — no summary provided.'),
      overallRiskLevel: ['low', 'medium', 'high', 'critical'].includes(parsed.overallRiskLevel)
        ? parsed.overallRiskLevel
        : 'medium',
      regulatoryReferences: Array.isArray(parsed.regulatoryReferences)
        ? parsed.regulatoryReferences.map(String)
        : [],
    };
  } catch {
    return {
      issues: [
        {
          severity: 'medium',
          category: 'Parse Error',
          description:
            'AI response could not be parsed as structured JSON. Raw analysis was returned.',
          regulatoryRef: 'N/A',
          recommendation: 'Retry the analysis or review the raw output manually.',
        },
      ],
      summary: content.slice(0, 500),
      overallRiskLevel: 'medium',
      regulatoryReferences: [],
    };
  }
}

/**
 * Analyze compliance text using Google Gemini AI.
 *
 * @throws Error if API key is missing, rate limit exceeded, or API call fails
 */
export async function analyzeCompliance(
  request: ComplianceAnalysisRequest,
  userId: string = 'system'
): Promise<ComplianceAnalysisResult> {
  // 1. Validate input
  const validationError = validateInput(request);
  if (validationError) {
    console.error('[GeminiAnalyzer] Input validation failed:', validationError);
    throw new Error(`Validation error: ${validationError}`);
  }

  // 2. Check rate limit
  const rateCheck = checkRateLimit();
  if (!rateCheck.allowed) {
    const retrySeconds = Math.ceil((rateCheck.retryAfterMs ?? 0) / 1000);
    console.warn(`[GeminiAnalyzer] Rate limit exceeded. Retry after ${retrySeconds}s`);
    throw new Error(
      `Rate limit exceeded (${RATE_LIMIT_MAX} requests per ${RATE_LIMIT_WINDOW_MS / 60000} minutes). ` +
        `Retry after ${retrySeconds} seconds.`
    );
  }

  // 3. Resolve API key from env
  const apiKey = getApiKey();

  // 4. Sanitize input
  const sanitizedText = sanitizeText(request.text);

  // 5. Build prompts
  const systemPrompt = buildSystemPrompt(request.analysisType);
  const userPrompt = request.entityName
    ? `Entity: ${sanitizeText(request.entityName)}\nJurisdiction: ${request.jurisdiction ?? 'UAE'}\n\nText to analyze:\n${sanitizedText}`
    : `Jurisdiction: ${request.jurisdiction ?? 'UAE'}\n\nText to analyze:\n${sanitizedText}`;

  // 6. Call Gemini API
  const analysisId = generateAnalysisId();
  const startTime = Date.now();

  const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
      }),
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
  } catch (err) {
    const elapsed = Date.now() - startTime;
    if (err instanceof TimeoutError) {
      throw new Error(`Gemini API request timed out after ${elapsed}ms`);
    }
    throw new Error(`Gemini API network error: ${(err as Error).message}`);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown');
    throw new Error(`Gemini API returned ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const elapsed = Date.now() - startTime;

  // 7. Parse structured response
  const parsed = parseAnalysisResponse(content);

  const result: ComplianceAnalysisResult = {
    analysisId,
    analysisType: request.analysisType,
    executedAt: new Date().toISOString(),
    model: GEMINI_MODEL,
    ...parsed,
    responseTimeMs: elapsed,
  };

  // 8. Audit trail — log every analysis (FDL Art.24, record retention)
  logAuditEntry({
    analysisId,
    timestamp: result.executedAt,
    action: `gemini-compliance-analysis:${request.analysisType}`,
    user: userId,
    inputLengthChars: sanitizedText.length,
    analysisType: request.analysisType,
    resultSummary: parsed.summary.slice(0, 200),
    issueCount: parsed.issues.length,
    overallRiskLevel: parsed.overallRiskLevel,
  });

  return result;
}
