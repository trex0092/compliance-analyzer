/**
 * Asana Comment Skill Handler Cron.
 *
 * Runs every minute. Drains the `asana-skill-jobs` blob store
 * populated by the webhook receiver, fetches each queued
 * comment story via the Asana API, routes the body through
 * the slash-command parser, executes the stub, and posts the
 * reply as a new Asana comment on the parent task.
 *
 * This is the server side of "slash commands in Asana
 * comments". The MLRO types `/screen ACME LLC` in a task
 * comment; within 60 seconds this cron fires, fetches the
 * story body, routes it, and posts the reply. No human
 * intervention.
 *
 * Today the executor is the canned stub from
 * asanaCommentSkillRouter.buildStubExecution. Real skill
 * execution can swap the stub for a subprocess call into
 * `skills/` without changing the handler contract.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (MLRO duty of care — auditable
 *     skill invocations)
 *   - FDL No.10/2025 Art.29 (no tipping off — the handler
 *     NEVER echoes subject identifiers the MLRO didn't
 *     already type in their slash command)
 *   - Cabinet Res 134/2025 Art.19 (auditable internal review)
 */

import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

const JOBS_STORE = 'asana-skill-jobs';
const AUDIT_STORE = 'asana-skill-audit';
const ASANA_API_BASE = 'https://app.asana.com/api/1.0';

interface SkillJob {
  jobId: string;
  storyGid?: string;
  parentTaskGid?: string;
  userGid?: string;
  userName?: string;
  enqueuedAtIso: string;
}

async function writeAudit(payload: Record<string, unknown>): Promise<void> {
  try {
    const store = getStore(AUDIT_STORE);
    const iso = new Date().toISOString();
    await store.setJSON(`${iso.slice(0, 10)}/${Date.now()}.json`, {
      ...payload,
      recordedAt: iso,
    });
  } catch {
    /* audit store failures are non-fatal */
  }
}

async function asanaGet<T>(path: string, token: string): Promise<T | undefined> {
  const res = await fetch(`${ASANA_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) return undefined;
  const json = (await res.json()) as { data?: T };
  return json.data;
}

async function asanaPost<T>(
  path: string,
  token: string,
  body: unknown
): Promise<T | undefined> {
  const res = await fetch(`${ASANA_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ data: body }),
  });
  if (!res.ok) return undefined;
  const json = (await res.json()) as { data?: T };
  return json.data;
}

export default async (): Promise<Response> => {
  const token = process.env.ASANA_API_TOKEN ?? process.env.ASANA_TOKEN;
  if (!token) {
    await writeAudit({ event: 'skill_handler_skipped', reason: 'no ASANA_API_TOKEN' });
    return Response.json({ ok: true, skipped: 'no token' });
  }

  const jobsStore = getStore(JOBS_STORE);
  const listing = await jobsStore.list({ prefix: 'pending/' });
  const jobs: Array<{ key: string; job: SkillJob }> = [];
  for (const blob of listing.blobs ?? []) {
    const job = (await jobsStore.get(blob.key, { type: 'json' })) as SkillJob | null;
    if (job && job.storyGid) {
      jobs.push({ key: blob.key, job });
    }
  }

  if (jobs.length === 0) {
    return Response.json({ ok: true, drained: 0 });
  }

  let drained = 0;
  let replied = 0;
  let unknown = 0;
  let errors = 0;

  // Dynamic import so the cron cold-start stays cheap.
  const routerModule = await import('../../src/services/asanaCommentSkillRouter');

  for (const { key, job } of jobs) {
    try {
      // Fetch the story body from Asana.
      const story = await asanaGet<{ text?: string; created_by?: { name?: string } }>(
        `/stories/${encodeURIComponent(job.storyGid!)}?opt_fields=text,created_by.name,resource_subtype`,
        token
      );
      if (!story?.text) {
        await jobsStore.delete(key);
        drained++;
        continue;
      }

      const routed = routerModule.routeAsanaComment(story.text);

      if (routed.notSlash) {
        // Not a slash command — silently drop the job.
        await jobsStore.delete(key);
        drained++;
        continue;
      }

      if (!routed.ok) {
        // Unknown skill or insufficient args — post a reply
        // explaining the error so the MLRO can fix their
        // command.
        if (job.parentTaskGid) {
          await asanaPost(
            `/tasks/${encodeURIComponent(job.parentTaskGid)}/stories`,
            token,
            {
              text: `Skill error: ${routed.error}\n\nFDL Art.29 — do not share this reply with the subject.`,
            }
          );
          unknown++;
        }
        await jobsStore.delete(key);
        drained++;
        continue;
      }

      // Execute the stub and post the reply.
      if (routed.invocation && job.parentTaskGid) {
        const execResult = routerModule.buildStubExecution(routed.invocation);
        await asanaPost(
          `/tasks/${encodeURIComponent(job.parentTaskGid)}/stories`,
          token,
          { text: execResult.reply }
        );
        replied++;
      }

      await jobsStore.delete(key);
      drained++;
    } catch (err) {
      errors++;
      await writeAudit({
        event: 'skill_job_error',
        jobId: job.jobId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Leave the job in the queue for the next cron tick. If
      // it fails ≥5 times we'd move it to a dead-letter store,
      // but that's a future tightening.
    }
  }

  await writeAudit({
    event: 'skill_handler_drain',
    drained,
    replied,
    unknown,
    errors,
  });

  return Response.json({
    ok: true,
    drained,
    replied,
    unknown,
    errors,
  });
};

export const config: Config = {
  schedule: '* * * * *',
};
