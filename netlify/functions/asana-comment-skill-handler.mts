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
const SANCTIONS_SNAPSHOT_STORE = 'sanctions-snapshots';
const ASANA_API_BASE = 'https://app.asana.com/api/1.0';

// Poison-pill defence: after this many failed attempts, the job is
// moved to a dead-letter slot and stops being retried every minute.
// Five gives a ~5-minute window of natural retries for transient
// Asana outages before we declare the job permanently poisoned.
const MAX_ATTEMPTS = 5;

// Sources the `sanctions-ingest-cron` persists snapshots for. Mirrors
// the `SanctionsSource` type in src/services/sanctionsIngest.ts —
// duplicated here to keep this handler a zero-import unit testable
// surface.
const SANCTIONS_SOURCES = [
  'OFAC_SDN',
  'OFAC_CONS',
  'UN',
  'EU',
  'UK_OFSI',
  'UAE_EOCN',
] as const;

// Cap total matches returned to the MLRO. The Asana stories API
// rejects bodies > ~65 KB; a few dozen names with aliases is well
// within that, while 1 000 matches could blow the limit. The MLRO
// can always narrow the query if the cap is hit.
const SCREEN_MAX_TOTAL_MATCHES = 25;
const SCREEN_MAX_PER_SOURCE = 8;

interface NormalisedSanction {
  source: string;
  sourceId: string;
  primaryName: string;
  aliases: string[];
  type: string;
  programmes?: string[];
  nationality?: string;
}

interface SkillJob {
  jobId: string;
  storyGid?: string;
  parentTaskGid?: string;
  userGid?: string;
  userName?: string;
  enqueuedAtIso: string;
  // attempts is undefined on freshly-enqueued jobs. The handler
  // increments it every time a retryable error is recorded.
  attempts?: number;
  lastAttemptIso?: string;
  lastErrorMessage?: string;
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

// ---------------------------------------------------------------------------
// Real skill execution
// ---------------------------------------------------------------------------
//
// Rounds 5-10 left this handler posting a canned acknowledgement for
// every slash command. This round wires real execution for the
// highest-leverage skill — `/screen` — by reading the persisted
// sanctions snapshots the `sanctions-ingest-cron` writes into the
// `sanctions-snapshots` blob store. Other skills still fall back to
// `buildStubExecution` until they are plumbed individually (follow-on
// PRs, tracked in the evaluation doc).

function normaliseQueryToken(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    // Strip combining marks (diaeresis, cedilla, tilde, etc.) so
    // `Björk` collapses to `bjork` in the same token. Done BEFORE
    // the punctuation sweep so the mark doesn't become a space and
    // split the token.
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanctionMatchesQuery(
  entry: NormalisedSanction,
  queryLower: string,
): boolean {
  if (!queryLower) return false;
  const candidates: string[] = [entry.primaryName, ...(entry.aliases ?? [])];
  for (const raw of candidates) {
    if (!raw) continue;
    const normalised = normaliseQueryToken(raw);
    if (!normalised) continue;
    if (normalised.includes(queryLower)) return true;
  }
  return false;
}

async function loadLatestSnapshot(
  source: string,
): Promise<NormalisedSanction[]> {
  try {
    const store = getStore(SANCTIONS_SNAPSHOT_STORE);
    const list = await store.list({ prefix: `${source}/` });
    if (!list.blobs || list.blobs.length === 0) return [];
    // Blob list order is not guaranteed lexicographic; sort by key
    // (prefixed with YYYY-MM-DD) and take the newest.
    const sorted = [...list.blobs].sort((a, b) => (a.key < b.key ? 1 : -1));
    const latest = sorted[0];
    const data = (await store.get(latest.key, { type: 'json' })) as
      | NormalisedSanction[]
      | null;
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

interface SkillExecutionResult {
  reply: string;
  citation: string;
  /** True when this handler produced the reply itself (vs falling
   *  back to the stub). Surfaces in the audit row for observability. */
  real: boolean;
  /** Non-fatal diagnostic messages surfaced alongside the audit
   *  row but NEVER in the Asana reply (so we do not leak internal
   *  state to the MLRO comment). */
  diagnostics?: string[];
}

async function executeScreenSkill(
  rawQuery: string,
): Promise<SkillExecutionResult> {
  const citation = 'FDL No.10/2025 Art.35; Cabinet Res 74/2020 Art.4-7';
  const diagnostics: string[] = [];

  const queryLower = normaliseQueryToken(rawQuery);
  if (!queryLower || queryLower.length < 2) {
    return {
      reply:
        'Skill `/screen` rejected: query must be at least 2 non-punctuation characters.\n\n' +
        'FDL Art.29 — do not share this reply with the subject.',
      citation,
      real: true,
    };
  }

  // Load every source snapshot in parallel so the whole command
  // completes within the Netlify 10 s default budget even when all
  // six lists are cached cold.
  const loadResults = await Promise.all(
    SANCTIONS_SOURCES.map(async (source) => {
      const snapshot = await loadLatestSnapshot(source);
      return { source, snapshot };
    }),
  );

  let totalEntriesChecked = 0;
  let totalMatches = 0;
  const perSource: Array<{
    source: string;
    total: number;
    matches: NormalisedSanction[];
  }> = [];

  for (const { source, snapshot } of loadResults) {
    totalEntriesChecked += snapshot.length;
    if (snapshot.length === 0) {
      diagnostics.push(`no snapshot for ${source}`);
      perSource.push({ source, total: 0, matches: [] });
      continue;
    }
    const matches: NormalisedSanction[] = [];
    for (const entry of snapshot) {
      if (sanctionMatchesQuery(entry, queryLower)) {
        matches.push(entry);
        if (matches.length >= SCREEN_MAX_PER_SOURCE) break;
      }
    }
    totalMatches += matches.length;
    perSource.push({ source, total: matches.length, matches });
  }

  const lines: string[] = [
    `Skill \`/screen\` — sanctions screening`,
    '',
    `Query: \`${rawQuery}\``,
    `Lists checked: ${SANCTIONS_SOURCES.join(', ')}`,
    `Entries scanned: ${totalEntriesChecked.toLocaleString('en-US')}`,
    `Matches found: ${totalMatches}${totalMatches >= SCREEN_MAX_TOTAL_MATCHES ? ' (capped)' : ''}`,
    '',
  ];

  if (totalMatches === 0) {
    lines.push('No matches across any list.');
    lines.push('');
    lines.push(
      '**Important:** a zero-match result is NOT a clearance. Re-run' +
        ' with alias variants (name order, transliteration, legal-form' +
        ' suffixes stripped) before you rely on this.',
    );
  } else {
    let surfaced = 0;
    for (const { source, total, matches } of perSource) {
      if (matches.length === 0) continue;
      lines.push(`**${source}** — ${total} match${total === 1 ? '' : 'es'}`);
      for (const m of matches) {
        if (surfaced >= SCREEN_MAX_TOTAL_MATCHES) {
          lines.push(`… plus further matches (output capped at ${SCREEN_MAX_TOTAL_MATCHES})`);
          break;
        }
        surfaced++;
        const programmes = (m.programmes ?? []).slice(0, 3).join(', ');
        const aliasSummary =
          m.aliases && m.aliases.length > 0
            ? ` — aka ${m.aliases.slice(0, 2).join(' / ')}${m.aliases.length > 2 ? ' …' : ''}`
            : '';
        const programmeSuffix = programmes ? ` [${programmes}]` : '';
        lines.push(
          `  • ${m.primaryName}${aliasSummary}${programmeSuffix}  (id: ${m.sourceId})`,
        );
      }
      lines.push('');
      if (surfaced >= SCREEN_MAX_TOTAL_MATCHES) break;
    }
    lines.push(
      '**Next step:** if any of these are plausibly the subject,' +
        ' open an incident via `/incident <case-id> sanctions-match`' +
        ' and raise the four-eyes queue.',
    );
  }

  lines.push('');
  lines.push(
    `Regulatory basis: ${citation}`,
  );
  lines.push('FDL Art.29 — no tipping off. Do not share this comment with the subject.');

  return {
    reply: lines.join('\n'),
    citation,
    real: true,
    diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
  };
}

async function executeSkillInvocation(
  routerModule: {
    buildStubExecution: (invocation: {
      skill: { name: string; category: string; description: string; citation: string };
      args: string[];
      rawComment: string;
    }) => { reply: string; citation: string };
  },
  invocation: {
    skill: { name: string; category: string; description: string; citation: string };
    args: string[];
    rawComment: string;
  },
): Promise<SkillExecutionResult> {
  const name = invocation.skill.name;
  if (name === 'screen' && invocation.args.length > 0) {
    // Concatenate args so `/screen Acme Trading LLC` is one query.
    // Trim trailing punctuation so the MLRO can copy-paste from
    // emails without losing precision.
    const query = invocation.args.join(' ').replace(/[.,;:!?]+$/g, '').trim();
    return executeScreenSkill(query);
  }
  // Any other skill — fall back to the stub. Each "real" executor is
  // added incrementally; the stub's reply body is stable so partial
  // rollout is safe for the MLRO.
  const stub = routerModule.buildStubExecution(invocation);
  return { reply: stub.reply, citation: stub.citation, real: false };
}

interface AsanaGetResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  errorSnippet?: string;
  // `notFound` is true on 404. The drain loop treats that as "the
  // story genuinely no longer exists" (MLRO deleted the comment,
  // the task was removed, etc.) and drops the job. Any other !ok
  // status (429/5xx/auth glitch) must NOT drop the job — the
  // previous implementation returned plain `undefined` on every
  // non-2xx, which made transient outages look identical to
  // permanent deletion and silently lost MLRO commands.
  notFound?: boolean;
}

async function asanaGet<T>(path: string, token: string): Promise<AsanaGetResult<T>> {
  const res = await fetch(`${ASANA_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    let snippet: string | undefined;
    try {
      snippet = (await res.text()).slice(0, 240);
    } catch { /* best-effort */ }
    return {
      ok: false,
      status: res.status,
      notFound: res.status === 404,
      errorSnippet: snippet,
    };
  }
  const json = (await res.json()) as { data?: T };
  return { ok: true, status: res.status, data: json.data };
}

interface AsanaPostResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  errorSnippet?: string;
}

// Returns an ok/status envelope so callers can distinguish a real
// transport/API failure (which should trigger a retry + audit entry)
// from a successful post. The previous helper returned `undefined`
// on any non-2xx, which the drain loop silently treated as success
// and then deleted the job — losing the MLRO's reply on any 4xx/5xx
// or network glitch.
async function asanaPost<T>(
  path: string,
  token: string,
  body: unknown
): Promise<AsanaPostResult<T>> {
  const res = await fetch(`${ASANA_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ data: body }),
  });
  if (!res.ok) {
    let snippet: string | undefined;
    try {
      // Truncate to 240 chars so a chatty Asana error body cannot
      // blow out the audit store.
      snippet = (await res.text()).slice(0, 240);
    } catch { /* snippet is best-effort */ }
    return { ok: false, status: res.status, errorSnippet: snippet };
  }
  const json = (await res.json()) as { data?: T };
  return { ok: true, status: res.status, data: json.data };
}

async function requeueOrDeadLetter(
  jobsStore: ReturnType<typeof getStore>,
  key: string,
  job: SkillJob,
  errorMessage: string,
): Promise<'retried' | 'dead_lettered'> {
  const attempts = (job.attempts ?? 0) + 1;
  const updated: SkillJob = {
    ...job,
    attempts,
    lastAttemptIso: new Date().toISOString(),
    lastErrorMessage: errorMessage.slice(0, 240),
  };
  if (attempts >= MAX_ATTEMPTS) {
    // Move to dead-letter; the next cron tick will no longer see it
    // under the `pending/` prefix that the drain loop lists.
    const deadKey = `dead-letter/${job.jobId}.json`;
    await jobsStore.setJSON(deadKey, updated);
    await jobsStore.delete(key);
    await writeAudit({
      event: 'skill_job_dead_lettered',
      jobId: job.jobId,
      attempts,
      lastError: updated.lastErrorMessage,
      deadKey,
    });
    return 'dead_lettered';
  }
  // Re-save the job under its existing pending key so the attempts
  // counter is preserved for the next tick.
  await jobsStore.setJSON(key, updated);
  return 'retried';
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
  let retried = 0;
  let deadLettered = 0;

  // Dynamic import so the cron cold-start stays cheap.
  const routerModule = await import('../../src/services/asanaCommentSkillRouter');

  for (const { key, job } of jobs) {
    try {
      // Fetch the story body from Asana.
      const storyRes = await asanaGet<{ text?: string; created_by?: { name?: string } }>(
        `/stories/${encodeURIComponent(job.storyGid!)}?opt_fields=text,created_by.name,resource_subtype`,
        token
      );
      if (!storyRes.ok) {
        if (storyRes.notFound) {
          // 404 = story genuinely gone (comment deleted, task
          // removed). Safe to drop the job permanently.
          await jobsStore.delete(key);
          drained++;
          continue;
        }
        // Any other non-2xx (429, 5xx, auth glitch) is transient —
        // bump attempts and retry on the next tick so a bad minute
        // at Asana does not silently lose MLRO commands.
        const outcome = await requeueOrDeadLetter(
          jobsStore, key, job,
          `story GET failed: ${storyRes.status} ${storyRes.errorSnippet ?? ''}`,
        );
        if (outcome === 'dead_lettered') deadLettered++;
        else retried++;
        errors++;
        continue;
      }
      const story = storyRes.data;
      if (!story?.text) {
        // Story exists but has no text (rare Asana shape — e.g. a
        // system-generated story with `html_text` only). Nothing to
        // route; drop the job.
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
        // command. If the reply post fails, retry the whole
        // job so the MLRO is not silently left without feedback.
        if (job.parentTaskGid) {
          const postRes = await asanaPost(
            `/tasks/${encodeURIComponent(job.parentTaskGid)}/stories`,
            token,
            {
              text: `Skill error: ${routed.error}\n\nFDL Art.29 — do not share this reply with the subject.`,
            }
          );
          if (!postRes.ok) {
            const outcome = await requeueOrDeadLetter(
              jobsStore, key, job,
              `unknown-skill reply post failed: ${postRes.status} ${postRes.errorSnippet ?? ''}`,
            );
            if (outcome === 'dead_lettered') deadLettered++;
            else retried++;
            errors++;
            continue;
          }
          unknown++;
        }
        await jobsStore.delete(key);
        drained++;
        continue;
      }

      // Execute the stub and post the reply. If Asana rejects the
      // post, the job is preserved with an incremented attempts
      // counter — after MAX_ATTEMPTS it is moved to the dead-letter
      // slot instead of retried forever, which previously pegged
      // the shared Asana rate limit on any poison-pill job.
      if (routed.invocation && job.parentTaskGid) {
        const execResult = await executeSkillInvocation(
          routerModule,
          routed.invocation,
        );
        if (execResult.diagnostics && execResult.diagnostics.length > 0) {
          // Diagnostics never leave the audit trail — we deliberately
          // do NOT include them in the Asana reply so operators do not
          // see the internal state of the snapshot store.
          await writeAudit({
            event: 'skill_exec_diagnostics',
            jobId: job.jobId,
            skill: routed.invocation.skill.name,
            real: execResult.real,
            diagnostics: execResult.diagnostics,
          });
        }
        const postRes = await asanaPost(
          `/tasks/${encodeURIComponent(job.parentTaskGid)}/stories`,
          token,
          { text: execResult.reply }
        );
        if (!postRes.ok) {
          const outcome = await requeueOrDeadLetter(
            jobsStore, key, job,
            `skill reply post failed: ${postRes.status} ${postRes.errorSnippet ?? ''}`,
          );
          if (outcome === 'dead_lettered') deadLettered++;
          else retried++;
          errors++;
          continue;
        }
        replied++;
      }

      await jobsStore.delete(key);
      drained++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const outcome = await requeueOrDeadLetter(jobsStore, key, job, message);
      if (outcome === 'dead_lettered') deadLettered++;
      else retried++;
      errors++;
      await writeAudit({
        event: 'skill_job_error',
        jobId: job.jobId,
        error: message,
        attempts: (job.attempts ?? 0) + 1,
        outcome,
      });
    }
  }

  await writeAudit({
    event: 'skill_handler_drain',
    drained,
    replied,
    unknown,
    errors,
    retried,
    deadLettered,
  });

  return Response.json({
    ok: true,
    drained,
    replied,
    unknown,
    errors,
    retried,
    deadLettered,
  });
};

export const config: Config = {
  schedule: '* * * * *',
};

// Exports for unit tests only. Production callers use the default
// cron handler above.
export const __test__ = {
  executeScreenSkill,
  executeSkillInvocation,
  sanctionMatchesQuery,
  normaliseQueryToken,
};
