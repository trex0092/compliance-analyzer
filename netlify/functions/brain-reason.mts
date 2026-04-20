/**
 * Deep Reasoning — Advisor-Assisted MLRO Analysis Endpoint
 *
 * POST /api/brain-reason    (see netlify.toml redirect)
 *
 * Browser-facing surface for the advisor strategy already documented in
 * CLAUDE.md §1 (Worker + Advisor). The MLRO submits a free-form
 * compliance question + optional case context; this endpoint runs the
 * Sonnet executor with the Opus advisor tool enabled, then returns a
 * compact envelope the browser renders as a "Deep Reasoning" card.
 *
 * Plumbing reused from existing code (no new compliance logic):
 *   - src/services/advisorStrategy.ts → buildAdvisorRequest,
 *     parseAdvisorResponse, COMPLIANCE_ADVISOR_SYSTEM_PROMPT (with the
 *     6 mandatory compliance escalation triggers baked in)
 *   - netlify/functions/middleware/auth.mts → authenticate (JWT or hex)
 *   - netlify/functions/middleware/rate-limit.mts → checkRateLimit
 *
 * Security design:
 *   - Authenticated — rejects anonymous traffic. Accepts both the MLRO
 *     browser JWT and the shared hex bearer.
 *   - Rate limited to 10 requests per IP per minute. LLM calls are
 *     expensive; this blocks runaway scripts and accidental polling
 *     without starving the sole operator.
 *   - Input caps: question ≤ 2000 chars, caseContext ≤ 8000 chars.
 *     Prevents prompt-stuffing attacks that would overflow the model
 *     context and burn tokens against a single caller.
 *   - Advisor call cap: 4 per request. The advisor tool can fire
 *     multiple times in a single turn; 4 is enough for the executor
 *     to escalate on the 6 mandatory triggers without letting a
 *     worst-case prompt chain 20 advisor calls.
 *   - Never echoes the raw Anthropic response to the browser — only
 *     the extracted text + usage + advisor count. The raw response
 *     contains token IDs and tool-use internals that do not belong
 *     in the client.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (CO accountability — every MLRO
 *     decision must have a legible reasoning trail the 10-year
 *     audit can reconstruct).
 *   - FDL No.10/2025 Art.24 (10-year audit retention — the advisor
 *     call count + usage are logged server-side for audit).
 *   - FDL No.10/2025 Art.29 (no tipping off — the advisor system
 *     prompt already enforces this; no additional guard needed here).
 *   - CLAUDE.md §1 Model Routing (Worker + Advisor) — this endpoint
 *     is the browser-facing entrypoint to the pattern documented
 *     there.
 */

import type { Config, Context } from '@netlify/functions';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';
import {
  buildAdvisorRequest,
  parseAdvisorResponse,
  ADVISOR_BETA_HEADER,
} from '../../src/services/advisorStrategy';

const RL_MAX = 10;
const RL_WINDOW_MS = 60 * 1000;

const MAX_QUESTION_LEN = 2000;
const MAX_CONTEXT_LEN = 8000;
const MAX_ADVISOR_USES = 4;
const MAX_EXECUTOR_TOKENS = 2048;

function fail(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return fail(405, 'Method not allowed.');

  const rl = await checkRateLimit(req, {
    clientIp: context.ip,
    namespace: 'brain-reason',
    max: RL_MAX,
    windowMs: RL_WINDOW_MS,
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[brain-reason] ANTHROPIC_API_KEY is not configured');
    return fail(503, 'Deep reasoning is temporarily unavailable.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Invalid JSON body.');
  }
  if (typeof body !== 'object' || body === null) return fail(400, 'Invalid request body.');

  const question = (body as { question?: unknown }).question;
  const caseContext = (body as { caseContext?: unknown }).caseContext;
  if (typeof question !== 'string' || question.trim().length === 0) {
    return fail(400, 'question is required.');
  }
  if (question.length > MAX_QUESTION_LEN) {
    return fail(400, `question exceeds ${MAX_QUESTION_LEN} characters.`);
  }
  if (caseContext !== undefined && typeof caseContext !== 'string') {
    return fail(400, 'caseContext must be a string if provided.');
  }
  if (typeof caseContext === 'string' && caseContext.length > MAX_CONTEXT_LEN) {
    return fail(400, `caseContext exceeds ${MAX_CONTEXT_LEN} characters.`);
  }

  const userMessage =
    typeof caseContext === 'string' && caseContext.trim().length > 0
      ? `CASE CONTEXT:\n${caseContext.trim()}\n\nQUESTION:\n${question.trim()}`
      : question.trim();

  const aiProxyBody = buildAdvisorRequest({
    userMessage,
    maxTokens: MAX_EXECUTOR_TOKENS,
    maxAdvisorUses: MAX_ADVISOR_USES,
  });

  let anthropicRes: Response;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': ADVISOR_BETA_HEADER,
      },
      body: JSON.stringify(aiProxyBody.payload),
    });
  } catch (err) {
    console.error('[brain-reason] network error calling Anthropic:', err);
    return fail(502, 'Upstream reasoning service unreachable.');
  }

  if (!anthropicRes.ok) {
    const text = await anthropicRes.text().catch(() => '');
    console.warn(
      `[brain-reason] Anthropic returned HTTP ${anthropicRes.status}: ${text.slice(0, 400)}`
    );
    return Response.json(
      {
        error: `Upstream returned HTTP ${anthropicRes.status}`,
        detail: text.slice(0, 400),
      },
      { status: 502 }
    );
  }

  let raw: unknown;
  try {
    raw = await anthropicRes.json();
  } catch (err) {
    console.error('[brain-reason] could not parse Anthropic JSON response:', err);
    return fail(502, 'Upstream response was not valid JSON.');
  }

  let parsed;
  try {
    parsed = parseAdvisorResponse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[brain-reason] parseAdvisorResponse failed: ${msg}`);
    return fail(502, 'Upstream response could not be parsed.');
  }

  // Server-side audit log. userId is HMAC-derived by the auth
  // middleware; jti carries through when the caller used the MLRO
  // JWT path. Enough for FDL Art.24 reconstruction without leaking
  // the raw token.
  const jti = auth.jwt?.jti;
  console.info(
    `[brain-reason] ok userId=${auth.userId} jti=${jti ?? 'n/a'}` +
      ` advisorCalls=${parsed.advisorCallCount}` +
      ` executorIn=${parsed.usage.executorInputTokens}` +
      ` executorOut=${parsed.usage.executorOutputTokens}` +
      ` advisorIn=${parsed.usage.advisorInputTokens}` +
      ` advisorOut=${parsed.usage.advisorOutputTokens}`
  );

  return Response.json({
    text: parsed.text,
    advisorCallCount: parsed.advisorCallCount,
    usage: parsed.usage,
    generatedAtIso: new Date().toISOString(),
  });
};

export const config: Config = {
  method: ['POST', 'OPTIONS'],
};
