/**
 * Compliance Decision streaming endpoint (Server-Sent Events).
 *
 * POST /api/decision/stream
 *
 * Semantically identical to /api/decision but emits intermediate
 * events as the weaponized brain progresses. Consumers (typically
 * the NORAD war-room dashboard) get real-time visibility into:
 *
 *   - plan:start           planner output (subsystem list)
 *   - execute:start        before runWeaponizedBrain
 *   - execute:verdict      verdict + confidence
 *   - extensions:*         one event per extension bundle
 *   - str:prediction       STR probability + factor breakdown
 *   - warroom:event        the war-room event emitted
 *   - attestation:sealed   zk commitment
 *   - done                 final ComplianceDecision
 *
 * The underlying `runComplianceDecision` does not natively stream —
 * this endpoint emits the "before" and "after" frames around the
 * single await point. Full-fidelity streaming (one frame per
 * subsystem as it fires) is a follow-up that requires the
 * weaponized brain to accept a progress callback.
 *
 * Regulatory basis:
 *   Same as /api/decision. The stream adds no new regulatory surface.
 */

import type { Config, Context } from '@netlify/functions';
import { authenticate } from './middleware/auth.mts';
import { checkRateLimit } from './middleware/rate-limit.mts';
import {
  runComplianceDecision,
  type ComplianceCaseInput,
} from '../../src/services/complianceDecisionEngine';

const MAX_BODY_BYTES = 512 * 1024;

/**
 * Heartbeat cadence. SSE comment frames (lines starting with `:`) are
 * ignored by `EventSource` but keep the TCP connection alive and reset
 * idle timers in any intermediate proxy / CDN / Netlify edge layer.
 * Without these, long `runComplianceDecision()` awaits produce
 * "Stream idle timeout - partial response received" on the client.
 */
const HEARTBEAT_MS = 5_000;

/**
 * Stale-emit watchdog — forces an additional keepalive if we haven't
 * pushed any byte in this window, which catches the case where the
 * heartbeat timer is enqueuing bytes but they're stuck in the
 * ReadableStream queue due to downstream backpressure.
 */
const STALE_EMIT_MS = 7_500;

/**
 * Hard cap on total stream duration. Netlify standard functions abort
 * after ~26s wall time; we close cleanly at 24s so the client receives
 * a terminal `timeout` event rather than a truncated TCP stream.
 * Consumers should retry on this event.
 */
const MAX_STREAM_MS = 24_000;

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** SSE comment frame — keep-alive ping that EventSource silently ignores. */
function sseHeartbeat(): string {
  return `: heartbeat ${Date.now()}\n\n`;
}

function coerceInput(raw: unknown): ComplianceCaseInput | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Body must be a JSON object.' };
  const body = raw as Record<string, unknown>;
  if (typeof body.tenantId !== 'string' || body.tenantId.length === 0)
    return { error: 'tenantId is required.' };
  if (typeof body.topic !== 'string' || body.topic.length === 0)
    return { error: 'topic is required.' };
  const entity = body.entity as Record<string, unknown> | undefined;
  if (!entity) return { error: 'entity is required.' };
  if (typeof entity.id !== 'string') return { error: 'entity.id is required.' };
  if (typeof entity.name !== 'string') return { error: 'entity.name is required.' };
  if (!entity.features || typeof entity.features !== 'object')
    return { error: 'entity.features is required.' };
  return body as unknown as ComplianceCaseInput;
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });

  const rl = await checkRateLimit(req, {
    clientIp: context.ip,
    max: 10,
    namespace: 'decision-stream',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response ?? Response.json({ error: 'Unauthorized' }, { status: 401 });

  // Preflight Content-Length — refuse before buffering if already
  // declared too large.
  const contentLengthHeader = req.headers.get('content-length');
  if (contentLengthHeader) {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return Response.json({ error: 'Body exceeds 512 KB limit.' }, { status: 413 });
    }
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: 'Body exceeds 512 KB limit.' }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const input = coerceInput(parsed);
  if ('error' in input) return Response.json({ error: input.error }, { status: 400 });

  const clientSignal = (req as unknown as { signal?: AbortSignal }).signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      let lastEmitAt = Date.now();
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let staleEmitTimer: ReturnType<typeof setInterval> | null = null;
      let deadline: ReturnType<typeof setTimeout> | null = null;

      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
          lastEmitAt = Date.now();
        } catch {
          // Controller already closed (client disconnect). Stop further writes.
          closed = true;
        }
      };
      const emit = (event: string, data: unknown) => {
        safeEnqueue(enc.encode(sseFrame(event, data)));
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (staleEmitTimer) clearInterval(staleEmitTimer);
        if (deadline) clearTimeout(deadline);
        if (clientSignal) clientSignal.removeEventListener('abort', onAbort);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      function onAbort() {
        cleanup();
      }
      if (clientSignal) clientSignal.addEventListener('abort', onAbort);

      // Flush response headers immediately with a zero-cost comment
      // frame plus an advisory `stream:ready` event. Some intermediaries
      // hold response headers until the first body byte arrives;
      // runComplianceDecision can take 10-20s to reach its first emit,
      // which is long enough for idle timers to trip. Pushing bytes
      // before we await anything guarantees the 200 OK reaches the
      // client synchronously.
      safeEnqueue(enc.encode(`: keepalive ${Date.now()}\n\n`));
      emit('stream:ready', {
        maxStreamMs: MAX_STREAM_MS,
        heartbeatMs: HEARTBEAT_MS,
        serverTime: new Date().toISOString(),
      });

      // Keep-alive heartbeat during the long-running runComplianceDecision
      // await. Prevents idle-timeout on any intermediate proxy.
      heartbeat = setInterval(() => {
        safeEnqueue(enc.encode(sseHeartbeat()));
      }, HEARTBEAT_MS);

      // Stale-emit watchdog — catches the case where the heartbeat
      // timer enqueued bytes but backpressure kept them in the queue.
      // The check rate is a third of STALE_EMIT_MS so we detect a
      // stall within one window rather than two.
      staleEmitTimer = setInterval(
        () => {
          if (closed) return;
          if (Date.now() - lastEmitAt >= STALE_EMIT_MS) {
            safeEnqueue(enc.encode(`: keepalive-stale ${Date.now()}\n\n`));
          }
        },
        Math.max(1_000, Math.floor(STALE_EMIT_MS / 3))
      );

      // Hard deadline: close with a terminal `timeout` event before the
      // Netlify wall-clock kills the function. Client should retry.
      deadline = setTimeout(() => {
        emit('timeout', {
          reason: 'max-stream-duration',
          maxStreamMs: MAX_STREAM_MS,
          retryable: true,
        });
        cleanup();
      }, MAX_STREAM_MS);

      try {
        emit('plan:start', {
          tenantId: input.tenantId,
          topic: input.topic,
          entityId: input.entity.id,
        });
        emit('execute:start', { at: new Date().toISOString() });

        const decision = await runComplianceDecision(input);

        emit('execute:verdict', {
          verdict: decision.verdict,
          confidence: decision.confidence,
          humanReview: decision.requiresHumanReview,
        });
        emit('str:prediction', decision.strPrediction);
        emit('warroom:event', decision.warRoomEvent);
        if (decision.attestation) {
          emit('attestation:sealed', decision.attestation);
        }
        if (decision.fourEyes) {
          emit('four-eyes', decision.fourEyes);
        }
        emit('done', decision);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit('error', { message });
      } finally {
        cleanup();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
      // Disable proxy buffering (Nginx, Netlify Edge, some CDNs).
      // Without this, intermediaries can hold SSE frames in a buffer
      // and defeat the heartbeat above — surfacing as "Stream idle
      // timeout - partial response received" on the client even while
      // the server is emitting heartbeats on schedule.
      'X-Accel-Buffering': 'no',
    },
  });
};

export const config: Config = {
  path: '/api/decision/stream',
  method: ['POST', 'OPTIONS'],
};
