/**
 * Deep Reasoning — Advisor-Assisted MLRO Analysis Endpoint (streaming)
 *
 * POST /api/brain-reason    (see netlify.toml redirect)
 *
 * Streams the Sonnet-executor + Opus-advisor reply as SSE so the edge
 * gateway never hits its idle-timeout. Previous synchronous version
 * returned a 504 "Inactivity Timeout" HTML page on complex questions
 * because deep reasoning with advisor calls routinely exceeds 10-15s.
 *
 * Stream shape (to the browser):
 *   event: delta       data: {"text": "..."}
 *   event: usage       data: {"executorInputTokens": N, ...}
 *   event: advisor     data: {"advisorCallCount": N}
 *   event: done        data: {"generatedAtIso": "..."}
 *   event: error       data: {"error": "..."}
 *
 * Plumbing reused from existing code (no new compliance logic):
 *   - src/services/advisorStrategy.ts → buildAdvisorRequest with stream:true
 *   - middleware/auth.mts → authenticate (JWT or hex)
 *   - middleware/rate-limit.mts → checkRateLimit
 *
 * Security + budget design:
 *   - Authenticated, rate-limited (10/min/IP).
 *   - Input caps: question ≤ 2000, caseContext ≤ 8000.
 *   - Advisor uses capped at 3 (down from 4) and executor max_tokens
 *     capped at 1536 (down from 2048) to bound worst-case latency.
 *   - AbortController cancels the upstream fetch if the client hangs up.
 *
 * Regulatory basis: FDL No.(10)/2025 Art.20-21 (CO reasoning trail),
 * Art.24 (10-year audit retention — usage + advisor counts logged
 * server-side at stream close).
 */

import type { Config, Context } from '@netlify/functions';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';
import {
  buildAdvisorRequest,
  ADVISOR_BETA_HEADER,
} from '../../src/services/advisorStrategy';

const RL_MAX = 10;
const RL_WINDOW_MS = 60 * 1000;

const MAX_QUESTION_LEN = 2000;
const MAX_CONTEXT_LEN = 8000;
const MAX_ADVISOR_USES = 3;
const MAX_EXECUTOR_TOKENS = 1536;

// Keepalive every 4s beats the strictest observed intermediate-proxy
// idle timeout (5s on some CDN layers). The constant in ai-proxy.mts
// is 10s; this endpoint runs slightly tighter because it does NOT go
// through ai-proxy.
const STREAM_KEEPALIVE_MS = 4_000;

// Graceful close 1s before Netlify's 26s sync-function hard kill.
// Without this the socket gets torn and the browser surfaces
// "Stream idle timeout - partial response received" — the exact
// failure mode documented in docs/claude-code-stream-timeout.md.
//
// Widened from 24_000 → 25_000 on 2026-04-21 to give the advisor
// escalation (Opus sub-inference) an extra second to complete the
// multi-step reasoning chain. The 1s margin (vs the prior 2s) is
// still safely above Netlify's observed 26s hard kill even after
// accounting for the outbound HTTP latency to api.anthropic.com,
// which empirically lands inside 200-400ms.
const STREAM_WALL_CLOCK_MS = 25_000;

// Extra system-prompt guidance that steers the executor toward
// structured output cues the browser parses (CDD LEVEL, RED FLAGS,
// CITATIONS, DEADLINES, CONFIDENCE, GAPS). Stays additive to the
// baseline COMPLIANCE_ADVISOR_SYSTEM_PROMPT.
const STRUCTURED_OUTPUT_GUIDANCE = `
OUTPUT STRUCTURE — when answering a compliance question, always finish with these labelled lines so the MLRO UI can parse them (one per line, omit the line only if truly not applicable):

CDD LEVEL: <SDD | CDD | EDD | FREEZE>
RED FLAGS: <comma-separated short labels, or "none">
CITATIONS: <comma-separated articles, e.g. "FDL Art.26-27, Cabinet Res 74/2020 Art.4-7">
DEADLINES: <comma-separated action + deadline, e.g. "STR: without delay; CNMR: 5 business days; EOCN: 24h", or "none">
CONFIDENCE: <0-100 integer>%
GAPS: <comma-separated short items the MLRO should obtain, or "none">
FOLLOW-UP: <one or two concise next-questions the MLRO should ask, pipe-separated>

Precede those lines with your full reasoning in narrative + bullets. Never omit the labelled block.`;

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

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

  // Short lookup questions (empty case context, question under 400
  // chars) cap the advisor at 1 sub-inference instead of
  // MAX_ADVISOR_USES. Opus advisor round-trips run ~5-10s each; three
  // of them on a cold start routinely blow past STREAM_WALL_CLOCK_MS
  // before the executor emits any text, producing an empty timeout
  // reply (observed on the "PEP onboarding" and "OFAC SDN hit"
  // presets with no pasted context).
  //
  // One advisor call still honours the six mandatory escalation
  // triggers in COMPLIANCE_ADVISOR_SYSTEM_PROMPT (PEP, sanctions
  // match, threshold edge cases, STR narratives, freeze/escalate
  // verdicts, CDD level changes) — the cap only prevents multi-round
  // iteration that lookup-style questions don't need. FDL No.10/2025
  // Art.20-21 (CO reasoning trail) is satisfied by the single advisor
  // exchange; multi-advisor is an optimisation for complex case
  // synthesis, not a baseline regulatory requirement.
  const caseContextIsEmpty =
    typeof caseContext !== 'string' || caseContext.trim().length === 0;
  const isShortLookup = caseContextIsEmpty && question.trim().length < 400;
  const advisorUsesForThisRequest = isShortLookup ? 1 : MAX_ADVISOR_USES;

  const aiProxyBody = buildAdvisorRequest({
    userMessage,
    maxTokens: MAX_EXECUTOR_TOKENS,
    maxAdvisorUses: advisorUsesForThisRequest,
    additionalSystemPrompt: STRUCTURED_OUTPUT_GUIDANCE,
    stream: true,
  });

  const functionStartedAt = Date.now();
  const abort = new AbortController();
  // Safety cap on the upstream fetch itself (55s). The wall-clock
  // timer owns graceful stream closure; this only fires if the
  // upstream fetch never returned headers.
  const upstreamTimer = setTimeout(() => abort.abort(), 55_000);

  // SSE pass-through. The upstream fetch + reader are created INSIDE
  // the stream's start() callback so the response headers + first
  // keepalive byte flush to the browser immediately — before the
  // long wait for Anthropic's first frame. This defends against the
  // "Stream idle timeout - partial response received" failure that
  // happens when the client sees no bytes for >5s during Anthropic's
  // extended-thinking / advisor-planning latency window.
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      };
      // Flush the response body immediately with a keepalive + ready
      // event so the client's fetch() resolves with 200 OK bytes
      // right away.
      controller.enqueue(encoder.encode(': keepalive\n\n'));
      send('ready', { startedAtIso: new Date().toISOString(), keepaliveMs: STREAM_KEEPALIVE_MS, wallClockMs: STREAM_WALL_CLOCK_MS });

      let closed = false;
      const safeSend = (event: string, data: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(sseEvent(event, data))); } catch { /* closed */ }
      };
      const safeKeepalive = () => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(': keepalive\n\n')); } catch { /* closed */ }
      };

      const keepalive = setInterval(safeKeepalive, STREAM_KEEPALIVE_MS);

      // Wall-clock timer — close gracefully before Netlify tears
      // the socket. Emits a terminal event so the browser sees
      // structured truncation instead of a HTML gateway page.
      const remainingMs = Math.max(1_000, STREAM_WALL_CLOCK_MS - (Date.now() - functionStartedAt));
      const wallClockTimer = setTimeout(() => {
        safeSend('wall_clock', {
          error: 'Deep reasoning exceeded the 25s per-request budget. Partial reply above — the reasoning chain did not close in time. To get a full answer: (a) shorten the case context (paste only the rows that matter), (b) pick a simpler reasoning mode (Speed instead of Multi-perspective), or (c) split your question into two smaller ones and combine the results in the History tab.',
          elapsedMs: Date.now() - functionStartedAt,
        });
        try { abort.abort(); } catch { /* noop */ }
      }, remainingMs);

      let buffer = '';
      let executorInputTokens = 0;
      let executorOutputTokens = 0;
      let advisorInputTokens = 0;
      let advisorOutputTokens = 0;
      let advisorCallCount = 0;
      let currentBlockIsAdvisor = false;
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

      try {
        // Kick the upstream fetch NOW, after the response headers +
        // keepalive have already flushed. Errors here can still be
        // reported as SSE `error` events because the stream is open.
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
            signal: abort.signal,
          });
        } catch (fetchErr) {
          const msg = (fetchErr as Error)?.message || 'network error';
          safeSend('error', { error: 'Upstream reasoning service unreachable: ' + msg });
          return;
        }

        if (!anthropicRes.ok || !anthropicRes.body) {
          const text = await anthropicRes.text().catch(() => '');
          safeSend('error', {
            error: `Upstream returned HTTP ${anthropicRes.status}`,
            detail: text.slice(0, 400),
          });
          return;
        }

        reader = anthropicRes.body.getReader();
        safeSend('upstream_open', { httpStatus: anthropicRes.status });

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by blank lines.
          let sep;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            if (!frame.trim()) continue;

            let frameEvent = '';
            let frameData = '';
            for (const line of frame.split('\n')) {
              if (line.startsWith('event:')) frameEvent = line.slice(6).trim();
              else if (line.startsWith('data:')) frameData += line.slice(5).trim();
            }
            if (!frameData) continue;
            let parsed: any;
            try { parsed = JSON.parse(frameData); } catch { continue; }

            if (frameEvent === 'content_block_start') {
              currentBlockIsAdvisor = parsed?.content_block?.type === 'tool_use'
                && parsed?.content_block?.name === 'advisor';
              if (currentBlockIsAdvisor) {
                advisorCallCount += 1;
                safeSend('advisor', { advisorCallCount });
              }
            } else if (frameEvent === 'content_block_delta') {
              const delta = parsed?.delta;
              if (delta?.type === 'text_delta' && typeof delta.text === 'string' && !currentBlockIsAdvisor) {
                safeSend('delta', { text: delta.text });
              }
            } else if (frameEvent === 'content_block_stop') {
              currentBlockIsAdvisor = false;
            } else if (frameEvent === 'message_start') {
              const u = parsed?.message?.usage;
              if (u) {
                executorInputTokens += u.input_tokens || 0;
                executorOutputTokens += u.output_tokens || 0;
              }
            } else if (frameEvent === 'message_delta') {
              const u = parsed?.usage;
              if (u) {
                executorOutputTokens += u.output_tokens || 0;
              }
              const iters = parsed?.usage?.iterations;
              if (Array.isArray(iters)) {
                for (const it of iters) {
                  if (it?.type === 'advisor') {
                    advisorInputTokens += it.input_tokens || 0;
                    advisorOutputTokens += it.output_tokens || 0;
                  }
                }
              }
            } else if (frameEvent === 'error') {
              safeSend('error', { error: parsed?.error?.message || 'Upstream error frame.' });
            }
          }
        }

        safeSend('usage', {
          executorInputTokens,
          executorOutputTokens,
          advisorInputTokens,
          advisorOutputTokens,
        });
        safeSend('done', { generatedAtIso: new Date().toISOString(), advisorCallCount });

        const jti = auth.jwt?.jti;
        console.info(
          `[brain-reason] ok userId=${auth.userId} jti=${jti ?? 'n/a'}` +
            ` advisorCap=${advisorUsesForThisRequest}` +
            ` advisorCalls=${advisorCallCount}` +
            ` executorIn=${executorInputTokens} executorOut=${executorOutputTokens}` +
            ` advisorIn=${advisorInputTokens} advisorOut=${advisorOutputTokens}` +
            ` elapsedMs=${Date.now() - functionStartedAt}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if ((err as Error)?.name === 'AbortError') {
          console.warn('[brain-reason] aborted (wall clock or client disconnect)');
        } else {
          console.error('[brain-reason] stream error:', msg);
          safeSend('error', { error: msg });
        }
      } finally {
        closed = true;
        clearInterval(keepalive);
        clearTimeout(wallClockTimer);
        clearTimeout(upstreamTimer);
        if (reader) { try { reader.releaseLock(); } catch { /* noop */ } }
        try { controller.close(); } catch { /* noop */ }
      }
    },
    cancel() {
      try { abort.abort(); } catch { /* noop */ }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};

export const config: Config = {
  method: ['POST', 'OPTIONS'],
};
